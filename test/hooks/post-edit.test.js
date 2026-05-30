'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runHook, parseHookOutput } = require('../helpers');

describe('post-edit', () => {
  it('exits 0 silently for non-source files', () => {
    const { exitCode, stdout } = runHook('hooks/post-edit.cjs', {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/project/README.md' },
      cwd: '/project',
    });
    assert.equal(exitCode, 0);
    const output = parseHookOutput(stdout);
    assert.equal(output, null);
  });

  it('exits 0 silently when no stack detected', () => {
    const { exitCode, stdout } = runHook('hooks/post-edit.cjs', {
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/random-dir/app.ts' },
      cwd: '/tmp/random-dir',
    });
    assert.equal(exitCode, 0);
  });

  it('exits 0 for missing file_path', () => {
    const { exitCode } = runHook('hooks/post-edit.cjs', {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: {},
      cwd: '/project',
    });
    assert.equal(exitCode, 0);
  });

  describe('output schema', () => {
    it('nests additionalContext inside hookSpecificOutput for PostToolUse', () => {
      const { buildContextOutput } = require('../../hooks/post-edit.cjs');
      const out = buildContextOutput('[LINT ERRORS]\nsomething', 'PostToolUse');
      assert.equal(out.hookSpecificOutput?.hookEventName, 'PostToolUse');
      assert.equal(out.hookSpecificOutput?.additionalContext, '[LINT ERRORS]\nsomething');
      // PostToolUse ignores a bare top-level additionalContext — it must be nested.
      assert.equal(out.additionalContext, undefined);
    });

    it('defaults hookEventName to PostToolUse when none is provided', () => {
      const { buildContextOutput } = require('../../hooks/post-edit.cjs');
      const out = buildContextOutput('msg');
      assert.equal(out.hookSpecificOutput?.hookEventName, 'PostToolUse');
    });
  });
});
