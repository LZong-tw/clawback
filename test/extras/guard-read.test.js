'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { runHook, parseHookOutput } = require('../helpers');

describe('guard-read', () => {
  it('allows reading normal files', () => {
    const { exitCode, stdout } = runHook('extras/guard-read.js', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/project/src/app.ts' },
    });
    assert.equal(exitCode, 0);
    assert.equal(parseHookOutput(stdout), null);
  });

  it('blocks reading ~/.ssh/', () => {
    const sshPath = path.join(os.homedir(), '.ssh', 'id_rsa');
    const { exitCode, stdout } = runHook('extras/guard-read.js', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: sshPath },
    });
    const output = parseHookOutput(stdout);
    assert.ok(output);
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  });

  it('blocks reading ~/.aws/', () => {
    const awsPath = path.join(os.homedir(), '.aws', 'credentials');
    const { exitCode, stdout } = runHook('extras/guard-read.js', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: awsPath },
    });
    const output = parseHookOutput(stdout);
    assert.ok(output);
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  });
});
