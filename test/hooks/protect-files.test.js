'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runHook, parseHookOutput } = require('../helpers');

describe('protect-files', () => {
  it('allows normal source file edits', () => {
    const { exitCode, stdout } = runHook('hooks/protect-files.cjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/project/src/app.ts' },
      cwd: '/project',
    });
    assert.equal(exitCode, 0);
    const output = parseHookOutput(stdout);
    assert.equal(output, null); // no output = allow
  });

  it('blocks .env file', () => {
    const { exitCode, stdout } = runHook('hooks/protect-files.cjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/project/.env' },
      cwd: '/project',
    });
    assert.equal(exitCode, 0);
    const output = parseHookOutput(stdout);
    assert.ok(output);
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  });

  it('blocks .env.local (case-insensitive)', () => {
    const { exitCode, stdout } = runHook('hooks/protect-files.cjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/project/.ENV.LOCAL' },
      cwd: '/project',
    });
    const output = parseHookOutput(stdout);
    assert.ok(output);
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  });

  it('blocks .git directory paths', () => {
    const { exitCode, stdout } = runHook('hooks/protect-files.cjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/project/.git/config' },
      cwd: '/project',
    });
    const output = parseHookOutput(stdout);
    assert.ok(output);
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  });

  it('does not block .gitignore', () => {
    const { exitCode, stdout } = runHook('hooks/protect-files.cjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/project/.gitignore' },
      cwd: '/project',
    });
    const output = parseHookOutput(stdout);
    assert.equal(output, null);
  });

  it('does not block .envoy.yaml', () => {
    const { exitCode, stdout } = runHook('hooks/protect-files.cjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/project/.envoy.yaml' },
      cwd: '/project',
    });
    const output = parseHookOutput(stdout);
    assert.equal(output, null);
  });

  it('allows GitHub workflows by default', () => {
    const { stdout } = runHook('hooks/protect-files.cjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/project/.github/workflows/ci.yml' },
      cwd: '/project',
    });
    assert.equal(parseHookOutput(stdout), null);
  });

  it('blocks GitHub workflows when strict infra protection is enabled', () => {
    const { stdout } = runHook('hooks/protect-files.cjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/project/.github/workflows/ci.yml' },
      cwd: '/project',
    }, {}, ['--strict-infra']);
    const output = parseHookOutput(stdout);
    assert.ok(output);
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  });

  it('blocks Husky hooks when strict infra protection is enabled through env', () => {
    const { stdout } = runHook('hooks/protect-files.cjs', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/project/.husky/pre-commit' },
      cwd: '/project',
    }, { CLAWBACK_STRICT_INFRA_PROTECTION: '1' });
    const output = parseHookOutput(stdout);
    assert.ok(output);
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  });
});
