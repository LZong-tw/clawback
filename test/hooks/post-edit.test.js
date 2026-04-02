'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runHook, parseHookOutput } = require('../helpers');

describe('post-edit', () => {
  it('exits 0 silently for non-source files', () => {
    const { exitCode, stdout } = runHook('hooks/post-edit.js', {
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
    const { exitCode, stdout } = runHook('hooks/post-edit.js', {
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/random-dir/app.ts' },
      cwd: '/tmp/random-dir',
    });
    assert.equal(exitCode, 0);
  });

  it('exits 0 for missing file_path', () => {
    const { exitCode } = runHook('hooks/post-edit.js', {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: {},
      cwd: '/project',
    });
    assert.equal(exitCode, 0);
  });
});
