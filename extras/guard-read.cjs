'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOME = os.homedir();

const SENSITIVE_DIRS = [
  path.join(HOME, '.ssh'),
  path.join(HOME, '.aws'),
  path.join(HOME, '.gnupg'),
  path.join(HOME, '.gpg'),
];

const SENSITIVE_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx'];

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
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

  const filePath = input.tool_input?.file_path;
  if (!filePath) process.exit(0);

  // Resolve path and symlinks
  const rawPath = path.resolve(filePath);
  let resolvedPath = rawPath;
  try { resolvedPath = fs.realpathSync(rawPath); } catch {}

  const pathsToCheck = new Set([rawPath, resolvedPath]);

  for (const p of pathsToCheck) {
    // Check sensitive directories
    for (const dir of SENSITIVE_DIRS) {
      if (p.startsWith(dir + path.sep) || p === dir) {
        deny(`Reading ${path.basename(p)} inside ${path.basename(dir)}/ is blocked for security.`);
        return;
      }
    }

    // Check sensitive extensions
    const ext = path.extname(p).toLowerCase();
    if (SENSITIVE_EXTENSIONS.includes(ext)) {
      deny(`Reading ${ext} files is blocked for security.`);
      return;
    }
  }

  // Allow
  process.exit(0);
}

main();
