'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runHook, parseHookOutput } = require('../helpers');

const CACHE_DIR = path.join(os.tmpdir(), 'clawback');

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
    // Should allow stop without checking
    assert.ok(!output || !output.hookSpecificOutput?.decision);
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
    assert.ok(output?.additionalContext?.includes('Circuit breaker'));
  });
});
