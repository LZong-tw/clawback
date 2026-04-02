'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { safeExec, ClawbackExecError } = require('../../lib/exec');

describe('safeExec', () => {
  it('executes a command and returns Buffer', () => {
    const result = safeExec('node', ['--version']);
    assert(result.toString().startsWith('v'));
  });

  it('throws on non-existent binary', () => {
    assert.throws(
      () => safeExec('nonexistent-binary-xyz', ['--version']),
      (err) => err.code === 'ENOENT' || err.status !== 0
    );
  });

  it('throws on timeout', () => {
    // On Windows, use a safe file path without parentheses/braces for shell:true
    const fixtureFile = path.join(__dirname, '..', 'fixtures', 'timeout.js');
    assert.throws(
      () => safeExec('node', [fixtureFile], { timeout: 500 }),
      (err) => err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM' || err.killed === true
    );
  });

  it('throws ClawbackExecError for unsafe args on win32', () => {
    const { validateArgs } = require('../../lib/exec');
    assert.throws(
      () => validateArgs(['--write', 'foo & bar.ts']),
      (err) => err instanceof ClawbackExecError && err.skipped === true
    );
  });

  it('allows safe args in validation', () => {
    const { validateArgs } = require('../../lib/exec');
    assert.doesNotThrow(() => validateArgs(['--write', 'src/app.ts']));
    assert.doesNotThrow(() => validateArgs(['--noEmit']));
  });
});
