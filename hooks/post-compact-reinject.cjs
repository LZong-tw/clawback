'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CACHE_DIR = path.join(os.tmpdir(), 'clawback');
const BUDGET = { gitState: 4096, gotchas: 4096, total: 10240 };

let _safeExec;
function getSafeExec() {
  if (!_safeExec) {
    const libDir = [
      path.join(__dirname, 'lib'),
      path.join(__dirname, '..', 'lib'),
    ].find(d => { try { require(path.join(d, 'exec.cjs')); return true; } catch { return false; } });
    _safeExec = libDir ? require(path.join(libDir, 'exec.cjs')).safeExec : require('node:child_process').execFileSync;
  }
  return _safeExec;
}

/**
 * Truncate text with a summary line showing what was cut.
 */
function truncateWithSummary(text, limit, label) {
  if (text.length <= limit) return text;
  const lines = text.split('\n');
  let result = '';
  let included = 0;
  const reserveForSummary = 80;
  for (const line of lines) {
    if (result.length + line.length + 1 > limit - reserveForSummary) break;
    result += line + '\n';
    included++;
  }
  const truncatedBytes = text.length - result.length;
  result += `\n[${label}: ${included}/${lines.length} lines, ${truncatedBytes} bytes truncated]\n`;
  return result;
}

/**
 * Clean up stale stack cache files (>24h).
 */
function cleanupStaleCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (!f.startsWith('stack-')) continue; // only clean stack cache files
      try {
        const fp = path.join(CACHE_DIR, f);
        const age = now - fs.statSync(fp).mtimeMs;
        if (age > maxAge) fs.unlinkSync(fp);
      } catch {
        continue; // EACCES, EBUSY — skip
      }
    }
  } catch {}
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

  const cwd = (process.env.CLAUDE_PROJECT_DIR || '').trim() || input.cwd || process.cwd();
  const safeExec = getSafeExec();
  const sections = [];

  // --- Git state (all git calls via safeExec, invariant #2) ---
  try {
    safeExec('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'pipe' });

    let gitContext = '';

    // Branch
    try {
      const branch = safeExec('git', ['branch', '--show-current'], { cwd, encoding: 'utf8', timeout: 3000 });
      gitContext += `Branch: ${(typeof branch === 'string' ? branch : branch.toString()).trim()}\n`;
    } catch {}

    // Recent commits
    try {
      const log = safeExec('git', ['log', '--oneline', '-5'], { cwd, encoding: 'utf8', timeout: 3000 });
      gitContext += `Recent commits:\n${(typeof log === 'string' ? log : log.toString()).trim()}\n`;
    } catch {}

    // Staged changes (--stat only, not full diff)
    try {
      const staged = safeExec('git', ['diff', '--stat', '--cached'], { cwd, encoding: 'utf8', timeout: 3000 });
      const stagedStr = (typeof staged === 'string' ? staged : staged.toString()).trim();
      if (stagedStr) gitContext += `Staged changes:\n${stagedStr}\n`;
    } catch {}

    if (gitContext) {
      sections.push(truncateWithSummary(
        `[GIT STATE]\n${gitContext}`,
        BUDGET.gitState,
        'git state'
      ));
    }
  } catch {
    // Not a git repo — skip
  }

  // --- Gotchas ---
  const gotchasPath = path.join(cwd, 'gotchas.md');
  if (fs.existsSync(gotchasPath)) {
    try {
      const gotchas = fs.readFileSync(gotchasPath, 'utf8');
      if (gotchas.trim()) {
        sections.push(truncateWithSummary(
          `[GOTCHAS — known pitfalls]\n${gotchas}`,
          BUDGET.gotchas,
          'gotchas'
        ));
      }
    } catch {}
  }

  // Output
  if (sections.length > 0) {
    let context = sections.join('\n\n');
    if (context.length > BUDGET.total) {
      context = context.slice(0, BUDGET.total) + '\n[total context truncated to 10KB]';
    }
    process.stdout.write(JSON.stringify({ additionalContext: context }));
  }

  // Lazy cleanup
  cleanupStaleCache();

  process.exit(0);
}

// Export for testing
if (require.main === module) {
  main();
} else {
  module.exports = { truncateWithSummary };
}
