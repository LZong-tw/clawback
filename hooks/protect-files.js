'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Lazy-load detect-stack to avoid circular deps during install
let _detectStack;
function getDetectStack() {
  if (!_detectStack) {
    try {
      _detectStack = require(path.join(__dirname, 'lib', 'detect-stack.js')).detectStack;
    } catch {
      // During testing, lib/ is at a different relative path
      try {
        _detectStack = require(path.join(__dirname, '..', 'lib', 'detect-stack.js')).detectStack;
      } catch {
        _detectStack = () => ({ lockfiles: [] });
      }
    }
  }
  return _detectStack;
}

function isGitPath(filePath) {
  const segments = filePath.split(path.sep);
  return segments.some(seg => seg === '.git');
}

function isEnvFile(basename) {
  const lower = basename.toLowerCase();
  return lower === '.env' || lower.startsWith('.env.') || lower === '.envrc';
}

function deny(reason) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(output));
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

  // Resolve paths — check both raw and symlink-resolved
  const rawPath = path.resolve(filePath);
  let resolvedPath = rawPath;
  try { resolvedPath = fs.realpathSync(rawPath); } catch {}

  const pathsToCheck = new Set([rawPath, resolvedPath]);

  for (const p of pathsToCheck) {
    const base = path.basename(p);

    // .env* check
    if (isEnvFile(base)) {
      deny(`Editing ${base} is blocked. Environment files should not be modified by AI.`);
      return;
    }

    // .git check
    if (isGitPath(p)) {
      deny(`Editing files inside .git/ is blocked.`);
      return;
    }
  }

  // Lockfile check via detect-stack
  const fileDir = path.dirname(rawPath);
  try {
    const detectStack = getDetectStack();
    const stack = detectStack(fileDir);
    const lockfiles = stack.lockfiles || [];
    const base = path.basename(rawPath).toLowerCase();
    if (lockfiles.some(lf => lf.toLowerCase() === base)) {
      deny(`Editing lockfile ${path.basename(rawPath)} is blocked. Lockfiles are auto-generated.`);
      return;
    }
  } catch {}

  // Allow
  process.exit(0);
}

main();
