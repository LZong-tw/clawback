'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runHook, parseHookOutput } = require('../helpers');
const { blockStop } = require('../../hooks/stop-verify.cjs');

const CACHE_DIR = path.join(os.tmpdir(), 'clawback');

// Capture whatever blockStop writes to stdout, return parsed JSON.
function captureBlockStop(reason) {
  const original = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += chunk.toString();
    return true;
  };
  try {
    blockStop(reason);
  } finally {
    process.stdout.write = original;
  }
  return JSON.parse(captured);
}

describe('stop-verify', () => {
  beforeEach(() => {
    // Clean up any stale counter files
    try {
      for (const f of fs.readdirSync(CACHE_DIR)) {
        if (f.startsWith('stop-counter-test')) {
          fs.unlinkSync(path.join(CACHE_DIR, f));
        }
      }
    } catch {}
  });

  it('exits 0 when stop_hook_active is true', () => {
    const { exitCode, stdout } = runHook('hooks/stop-verify.cjs', {
      hook_event_name: 'Stop',
      stop_hook_active: true,
      session_id: 'test-session-1',
      cwd: '/tmp',
    });
    assert.equal(exitCode, 0);
    const output = parseHookOutput(stdout);
    // Should allow stop without checking — no top-level block decision.
    assert.ok(!output || output.decision !== 'block');
  });

  it('exits 0 when no stack detected', () => {
    const { exitCode, stdout } = runHook('hooks/stop-verify.cjs', {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      session_id: 'test-session-2',
      cwd: '/tmp/nonexistent-project',
    });
    assert.equal(exitCode, 0);
  });

  it('allows stop after circuit breaker reaches MAX_STRIKES', () => {
    const counterPath = path.join(CACHE_DIR, 'stop-counter-test-cb.json');
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(counterPath, JSON.stringify({ count: 3, ts: Date.now() }));

    const { exitCode, stdout } = runHook('hooks/stop-verify.cjs', {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      session_id: 'test-cb',
      cwd: '/tmp',
    });
    assert.equal(exitCode, 0);
    const output = parseHookOutput(stdout);
    assert.ok(output?.systemMessage?.includes('Circuit breaker'));
  });

  describe('blockStop schema', () => {
    it('emits top-level decision:block with reason containing the error text', () => {
      const errorText = '[TYPECHECK ERRORS]\nsrc/app.ts(1,1): error TS2304: Cannot find name';
      const output = captureBlockStop(errorText);
      assert.equal(output.decision, 'block');
      assert.equal(output.reason, errorText);
      assert.ok(output.reason.includes('error TS2304'));
    });

    it('does NOT nest decision inside hookSpecificOutput and emits no additionalContext', () => {
      const output = captureBlockStop('some error');
      assert.equal(output.hookSpecificOutput, undefined);
      assert.equal(output.additionalContext, undefined);
    });
  });
});
