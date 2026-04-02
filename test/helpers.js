'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function runHook(hookPath, stdinData, env = {}) {
  const fullPath = path.join(ROOT, hookPath);
  const input = JSON.stringify(stdinData);
  try {
    const stdout = execFileSync(process.execPath, [fullPath], {
      input,
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, CLAWBACK_TEST: '1', ...env },
      cwd: env.CLAUDE_PROJECT_DIR || process.cwd(),
    });
    return { exitCode: 0, stdout: stdout || '', stderr: '' };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      stdout: (err.stdout || '').toString(),
      stderr: (err.stderr || '').toString(),
    };
  }
}

function parseHookOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

module.exports = { runHook, parseHookOutput, ROOT };
