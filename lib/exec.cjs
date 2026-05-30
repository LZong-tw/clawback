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

  try {
    return execFileSync(cmd, args, opts);
  } catch (err) {
    // On Windows with shell:true, a missing binary doesn't surface as ENOENT;
    // cmd.exe returns a non-zero status instead. Detect that via a PATH probe
    // (see isMissingBinary) and re-throw as a skippable error so callers treat
    // the tool as unavailable rather than as a real verification failure.
    if (process.platform === 'win32' && isMissingBinary(cmd, err)) {
      throw new ClawbackExecError(`Command not found: ${cmd}`, { skipped: true });
    }
    // Preserve the original error (stdout/stderr/status/killed) for real failures.
    throw err;
  }
}

/**
 * Decide whether a win32 execFileSync failure was caused by a missing binary.
 * The authoritative signal is a PATH probe (`where`), not the cmd.exe error
 * text: that text is localized on non-English Windows AND collides with common
 * tool output ("Cannot find name/module" from tsc), so matching it would
 * misclassify real verification failures as a missing tool and silently skip
 * them. status 9009 is kept only as an unambiguous fast path.
 */
function isMissingBinary(cmd, err) {
  if (err.killed) return false; // timeout / signal kill, not a missing binary
  if (err.status === 9009) return true; // cmd.exe "command not found"; never a real exit code
  // A present-but-failing tool resolves here (`where` exits 0) so its real
  // error is preserved; only a genuinely absent binary is treated as skippable.
  // Runs only after a failure, so it adds no cost on the success path.
  try {
    execFileSync('where', [cmd], { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
    return false; // resolvable -> a real failure, not a missing binary
  } catch {
    return true; // not on PATH -> missing binary
  }
}

module.exports = { safeExec, ClawbackExecError, validateArgs };
