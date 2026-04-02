'use strict';

const path = require('node:path');

let _detectStack, _safeExec;
function getModules() {
  if (!_detectStack) {
    const libDir = [
      path.join(__dirname, 'lib'),
      path.join(__dirname, '..', 'lib'),
    ].find(d => { try { require(path.join(d, 'detect-stack.cjs')); return true; } catch { return false; } });

    if (libDir) {
      _detectStack = require(path.join(libDir, 'detect-stack.cjs')).detectStack;
      _safeExec = require(path.join(libDir, 'exec.cjs')).safeExec;
    } else {
      _detectStack = () => ({ format: null, lint: null, sourceExtensions: [] });
      _safeExec = () => Buffer.from('');
    }
  }
  return { detectStack: _detectStack, safeExec: _safeExec };
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

  const filePath = input.tool_input?.file_path;
  if (!filePath) process.exit(0);

  const { detectStack, safeExec } = getModules();
  const fileDir = path.dirname(path.resolve(filePath));

  let stack;
  try {
    stack = detectStack(fileDir);
  } catch {
    process.exit(0);
  }

  // Extension check: skip non-source files
  const ext = path.extname(filePath).toLowerCase();
  if (!stack.sourceExtensions || !stack.sourceExtensions.includes(ext)) {
    process.exit(0);
  }

  const messages = [];
  const resolvedFile = path.resolve(filePath);

  // Step 1: Format (modifies file)
  if (stack.format) {
    try {
      safeExec(stack.format.cmd, [...stack.format.args, resolvedFile], { timeout: 15000 });
    } catch (err) {
      if (!err.skipped && err.code !== 'ENOENT') {
        messages.push(`[FORMAT ERROR] ${err.message}`);
      }
      // skipped or ENOENT: silently ignore
    }
  }

  // Step 2: Lint per-file (report-only, NO --fix)
  if (stack.lintFile) {
    try {
      safeExec(stack.lintFile.cmd, [...stack.lintFile.args, resolvedFile], {
        timeout: 15000,
        encoding: 'utf8',
      });
    } catch (err) {
      if (err.skipped || err.code === 'ENOENT') {
        // Tool not available, skip
      } else if (err.stdout || err.stderr) {
        const lintOutput = (err.stdout || '') + (err.stderr || '');
        const trimmed = lintOutput.trim();
        if (trimmed) {
          messages.push(`[LINT ERRORS in ${path.basename(filePath)}]\n${trimmed.slice(0, 2000)}`);
        }
      }
    }
  }

  // Output
  if (messages.length > 0) {
    const output = { additionalContext: messages.join('\n\n') };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
}

main();
