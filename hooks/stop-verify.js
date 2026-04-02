'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const CACHE_DIR = path.join(os.tmpdir(), 'clawback');
const MAX_STRIKES = 3;

try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}

let _detectStack, _safeExec;
function getModules() {
  if (!_detectStack) {
    const libDir = [
      path.join(__dirname, 'lib'),
      path.join(__dirname, '..', 'lib'),
    ].find(d => { try { require(path.join(d, 'detect-stack.js')); return true; } catch { return false; } });

    if (libDir) {
      _detectStack = require(path.join(libDir, 'detect-stack.js')).detectStack;
      _safeExec = require(path.join(libDir, 'exec.js')).safeExec;
    } else {
      _detectStack = () => ({ typecheck: null, lint: null });
      _safeExec = () => Buffer.from('');
    }
  }
  return { detectStack: _detectStack, safeExec: _safeExec };
}

/**
 * Get list of files modified in the current git working tree.
 * Returns string[] or null if cannot determine.
 * Uses safeExec for all git calls (invariant #2).
 */
function getModifiedFiles(cwd) {
  const { safeExec } = getModules();

  // Try HEAD
  try {
    safeExec('git', ['rev-parse', 'HEAD'], { cwd, stdio: 'pipe' });
    const out = safeExec('git', ['diff', '--name-only', 'HEAD'], { cwd, encoding: 'utf8', timeout: 5000 });
    const files = (typeof out === 'string' ? out : out.toString()).trim().split('\n').filter(Boolean);
    return files; // may be empty array = no modified files
  } catch {}

  // Fallback: staged files
  try {
    const out = safeExec('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf8', timeout: 5000 });
    const files = (typeof out === 'string' ? out : out.toString()).trim().split('\n').filter(Boolean);
    if (files.length > 0) {
      process.stderr.write('[clawback] HEAD not available, using staged files for error scoping\n');
      return files;
    }
    return []; // no staged files either
  } catch {}

  // Fallback: ls-files --modified
  try {
    const out = safeExec('git', ['ls-files', '--modified'], { cwd, encoding: 'utf8', timeout: 5000 });
    const files = (typeof out === 'string' ? out : out.toString()).trim().split('\n').filter(Boolean);
    if (files.length > 0) {
      process.stderr.write('[clawback] Using ls-files --modified for error scoping\n');
      return files;
    }
    return [];
  } catch {}

  process.stderr.write('[clawback] Cannot determine modified files, all errors will be reported\n');
  return null;
}

/**
 * Filter tsc output to only show errors in the given files.
 */
function filterTscErrors(tscOutput, modifiedFiles, cwd) {
  if (!modifiedFiles) return tscOutput; // no scoping possible
  if (modifiedFiles.length === 0) return ''; // no files modified = no relevant errors

  const lines = tscOutput.split('\n');
  const relevant = [];
  for (const line of lines) {
    // tsc format: "path/file.ts(line,col): error TSxxxx: message"
    const match = line.match(/^(.+?)\(\d+,\d+\):/);
    if (!match) continue;
    const errorFile = path.resolve(cwd, match[1]);
    if (modifiedFiles.some(f => path.resolve(cwd, f) === errorFile)) {
      relevant.push(line);
    }
  }
  return relevant.join('\n');
}

/**
 * Read circuit breaker counter.
 */
function readCounter(counterPath) {
  try {
    const data = JSON.parse(fs.readFileSync(counterPath, 'utf8'));
    return data.count || 0;
  } catch {
    return 0;
  }
}

/**
 * Write circuit breaker counter (atomic).
 */
function writeCounter(counterPath, count) {
  const tmp = counterPath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ count, ts: Date.now() }));
    fs.renameSync(tmp, counterPath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

function blockStop(errors) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      decision: 'block',
    },
    additionalContext: errors,
  }));
}

async function main() {
  let input;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    process.exit(0);
  }

  // Prevent infinite loop
  if (input.stop_hook_active) {
    process.exit(0);
  }

  const sessionId = input.session_id || `fallback-${process.pid}-${Date.now()}`;
  const cwd = (process.env.CLAUDE_PROJECT_DIR || '').trim() || input.cwd || process.cwd();
  const counterPath = path.join(CACHE_DIR, `stop-counter-${sessionId}.json`);

  // Circuit breaker check
  const count = readCounter(counterPath);
  if (count >= MAX_STRIKES) {
    // Allow stop but warn
    process.stdout.write(JSON.stringify({
      additionalContext: `[clawback] Circuit breaker: allowing stop after ${MAX_STRIKES} consecutive verification failures. Errors may remain.`,
    }));
    process.exit(0);
  }

  const { detectStack, safeExec } = getModules();

  let stack;
  try {
    stack = detectStack(cwd);
  } catch {
    process.exit(0);
  }

  // No verification tools available
  if (!stack.typecheck && !stack.lint) {
    process.exit(0);
  }

  const modifiedFiles = getModifiedFiles(cwd);

  // If no modified files (empty array), allow stop
  if (Array.isArray(modifiedFiles) && modifiedFiles.length === 0) {
    writeCounter(counterPath, 0); // reset on success
    process.exit(0);
  }

  const errors = [];

  // Typecheck (60s timeout)
  if (stack.typecheck) {
    try {
      safeExec(stack.typecheck.cmd, stack.typecheck.args, {
        timeout: 60000,
        cwd,
        encoding: 'utf8',
      });
    } catch (err) {
      if (err.skipped || err.code === 'ENOENT') {
        // Tool not available
      } else if (err.killed) {
        errors.push('[TYPECHECK TIMEOUT] Type checking exceeded 60s. Results unverified.');
      } else {
        const output = ((err.stdout || '') + (err.stderr || '')).trim();
        if (output) {
          const filtered = filterTscErrors(output, modifiedFiles, cwd);
          if (filtered.trim()) {
            errors.push(`[TYPECHECK ERRORS]\n${filtered.slice(0, 3000)}`);
          }
        }
      }
    }
  }

  // Lint — full-project command, output filtered to git-dirty files (15s timeout)
  if (stack.lint) {
    try {
      safeExec(stack.lint.cmd, stack.lint.args, {
        timeout: 15000,
        cwd,
        encoding: 'utf8',
      });
    } catch (err) {
      if (err.skipped || err.code === 'ENOENT') {
        // Tool not available
      } else {
        const output = ((err.stdout || '') + (err.stderr || '')).trim();
        if (output && modifiedFiles) {
          // Filter lint output to git-dirty files with word-boundary matching
          const lines = output.split('\n');
          const relevantLines = lines.filter(line => {
            return modifiedFiles.some(f => {
              const idx = line.indexOf(f);
              if (idx === -1) return false;
              const after = line[idx + f.length];
              return !after || /[:\s()\[\]]/.test(after);
            });
          });
          if (relevantLines.length > 0) {
            errors.push(`[LINT ERRORS]\n${relevantLines.join('\n').slice(0, 2000)}`);
          }
        } else if (!modifiedFiles) {
          // Can't scope — report all
          errors.push(`[LINT ERRORS]\n${output.slice(0, 2000)}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    // Increment circuit breaker
    writeCounter(counterPath, count + 1);
    blockStop(errors.join('\n\n'));
  } else {
    // Reset circuit breaker on success
    writeCounter(counterPath, 0);
    process.exit(0);
  }
}

main();
