'use strict';

const { execFileSync } = require('node:child_process');

class ClawbackExecError extends Error {
  constructor(message, { skipped = false } = {}) {
    super(message);
    this.name = 'ClawbackExecError';
    this.skipped = skipped;
  }
}

const UNSAFE_CHARS = /[&|<>()!%]/;

function validateArgs(args) {
  for (const arg of args) {
    if (UNSAFE_CHARS.test(arg)) {
      throw new ClawbackExecError(
        `Unsafe argument for Windows shell: "${arg}". ` +
        `Characters &|<>()!% are not allowed when shell:true is used.`,
        { skipped: true }
      );
    }
  }
}

function safeExec(cmd, args, options = {}) {
  const opts = {
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  };

  if (process.platform === 'win32') {
    validateArgs(args);
    opts.shell = true;
  }

  return execFileSync(cmd, args, opts);
}

module.exports = { safeExec, ClawbackExecError, validateArgs };
