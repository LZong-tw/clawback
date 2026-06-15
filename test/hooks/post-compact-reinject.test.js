'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { runHook, parseHookOutput } = require('../helpers');

describe('post-compact-reinject', () => {
  it('exits 0 with no output for non-git directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawback-test-'));
    try {
      const { exitCode, stdout } = runHook('hooks/post-compact-reinject.cjs', {
        hook_event_name: 'PostCompact',
        cwd: tmpDir,
      }, { CLAUDE_PROJECT_DIR: tmpDir });
      assert.equal(exitCode, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('truncateWithSummary truncates long text correctly', () => {
    const { truncateWithSummary } = require('../../hooks/post-compact-reinject.cjs');
    assert.ok(typeof truncateWithSummary === 'function', 'truncateWithSummary must be exported');

    const longText = 'line\n'.repeat(1000);
    const result = truncateWithSummary(longText, 200, 'test');
    assert.ok(result.length <= 280); // 200 + summary line overhead
    assert.ok(result.includes('[test:'));
    assert.ok(result.includes('truncated'));
  });

  it('emits hook-specific PostCompact context output', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawback-test-'));
    try {
      execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(tmpDir, 'gotchas.md'), '- keep the lesson\n');

      const { exitCode, stdout } = runHook('hooks/post-compact-reinject.cjs', {
        hook_event_name: 'PostCompact',
        cwd: tmpDir,
      }, { CLAUDE_PROJECT_DIR: tmpDir });

      assert.equal(exitCode, 0);
      const output = parseHookOutput(stdout);
      assert.equal(output?.hookSpecificOutput?.hookEventName, 'PostCompact');
      assert.match(output?.hookSpecificOutput?.additionalContext || '', /\[GOTCHAS/);
      assert.equal(output?.additionalContext, undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('emits SessionStart context output (all-source reinjection)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawback-test-'));
    try {
      execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(tmpDir, 'gotchas.md'), '- keep the lesson\n');

      const { exitCode, stdout } = runHook('hooks/post-compact-reinject.cjs', {
        hook_event_name: 'SessionStart',
        source: 'compact',
        cwd: tmpDir,
      }, { CLAUDE_PROJECT_DIR: tmpDir });

      assert.equal(exitCode, 0);
      const output = parseHookOutput(stdout);
      assert.equal(output?.hookSpecificOutput?.hookEventName, 'SessionStart');
      assert.match(output?.hookSpecificOutput?.additionalContext || '', /\[GOTCHAS/);
      assert.equal(output?.additionalContext, undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('reinjects AirClaude route context from environment metadata', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawback-airclaude-test-'));
    try {
      const { exitCode, stdout } = runHook('hooks/post-compact-reinject.cjs', {
        hook_event_name: 'SessionStart',
        cwd: tmpDir,
      }, {
        CLAUDE_PROJECT_DIR: tmpDir,
        AIRCLAUDE_PROFILE: 'demo-lowcost',
        AIRCLAUDE_MODE: 'pro',
        AIRCLAUDE_STATUSLINE_LABEL: 'airclaude pro strong-coder',
        AIRCLAUDE_ROUTE_DEFAULT: 'demo,strong-coder',
        AIRCLAUDE_ROUTE_THINK: 'demo,strong-coder',
        AIRCLAUDE_ROUTE_LONG_CONTEXT: 'demo,strong-coder',
        AIRCLAUDE_RESTORE_MODEL: 'claude-sonnet-4-6',
      });
      const output = parseHookOutput(stdout);

      assert.equal(exitCode, 0);
      assert.equal(output?.hookSpecificOutput?.hookEventName, 'SessionStart');
      const context = output?.hookSpecificOutput?.additionalContext || '';
      assert.match(context, /\[AIRCLAUDE SESSION\]/);
      assert.match(context, /Mode: pro/);
      assert.match(context, /Default route: demo,strong-coder/);
      assert.match(context, /Claude-compatible restore model: claude-sonnet-4-6/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
