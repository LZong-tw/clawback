'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const hooksPath = path.join(root, 'hooks.json');
const CLAWBACK_HOOK_NAMES = [
  'protect-files',
  'post-edit',
  'stop-verify',
  'post-compact-reinject',
  'notification',
  'guard-read',
  'ui-antipattern-check',
];

function fail(message) {
  process.stderr.write(`[global-hooks-verify] ${message}\n`);
  process.exitCode = 1;
}

function collectCommands(value, commands = []) {
  if (!value || typeof value !== 'object') return commands;
  if (typeof value.command === 'string') commands.push(value.command);
  if (Array.isArray(value)) {
    for (const item of value) collectCommands(item, commands);
  } else {
    for (const item of Object.values(value)) collectCommands(item, commands);
  }
  return commands;
}

function parseNodeCommand(command) {
  const match = command.match(/^node\s+"([^"]+)"(?:\s|$)/);
  if (!match) return null;
  return match[1];
}

function isClawbackCommand(command) {
  return CLAWBACK_HOOK_NAMES.some(name =>
    command.includes(`${name}.cjs`) || command.includes(`${name}.mjs`) || command.includes(`${name}.js`)
  );
}

function shellCheck(scriptPath, shell) {
  if (shell === 'cmd') {
    execFileSync('cmd.exe', ['/d', '/s', '/c', 'node', '--check', scriptPath], {
      stdio: 'pipe',
      windowsHide: true,
      timeout: 15000,
    });
    return;
  }

  if (shell === 'powershell') {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `node --check "${scriptPath}"`], {
      stdio: 'pipe',
      windowsHide: true,
      timeout: 15000,
    });
    return;
  }

  execFileSync('/bin/sh', ['-lc', 'node --check "$1"', 'verify-global-hooks', scriptPath], {
    stdio: 'pipe',
    timeout: 15000,
  });
}

function smokeReinject(command, eventName) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawback-reinject-'));
  try {
    try {
      execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe', timeout: 15000 });
    } catch (error) {
      fail(`cannot initialize temp git repo for ${eventName} smoke: ${(error.stderr || error.message).toString().trim()}`);
      return;
    }

    fs.writeFileSync(path.join(tmpDir, 'gotchas.md'), '- verify PostCompact output shape\n');
    const input = JSON.stringify({
      session_id: 'clawback-verify',
      hook_event_name: eventName,
      cwd: tmpDir,
    });
    const result = spawnSync(command, {
      cwd: tmpDir,
      shell: true,
      input,
      encoding: 'utf8',
      timeout: 15000,
    });

    if (result.status !== 0 || result.signal) {
      fail(`${eventName} smoke exited ${result.status ?? result.signal}: ${(result.stderr || result.error || '').toString().trim()}`);
      return;
    }

    const stdout = (result.stdout || '').trim();
    if (!stdout) {
      fail(`${eventName} smoke produced no JSON output`);
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (error) {
      fail(`${eventName} smoke produced invalid JSON: ${error.message}`);
      return;
    }

    const output = parsed.hookSpecificOutput;
    if (output?.hookEventName !== eventName || typeof output.additionalContext !== 'string') {
      fail(`${eventName} smoke must emit hookSpecificOutput with hookEventName=${eventName} and additionalContext`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

let hooks;
try {
  hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
} catch (error) {
  fail(`cannot parse ${hooksPath}: ${error.message}`);
}

const commands = collectCommands(hooks);
if (!commands.length) fail('no hook commands found');

for (const command of commands) {
  if (/\b[A-Za-z_][A-Za-z0-9_]*=.*\s+node\b/.test(command)) {
    fail(`POSIX env-prefix is not Windows-safe: ${command}`);
  }

  if (/\bnode\s+'/.test(command) || /'[A-Za-z]:\\/.test(command)) {
    fail(`single-quoted Windows path is not cmd.exe-safe: ${command}`);
  }

  if (!isClawbackCommand(command)) continue;

  const scriptPath = parseNodeCommand(command);
  if (!scriptPath) {
    fail(`expected command to start with node "path": ${command}`);
    continue;
  }

  if (!fs.existsSync(scriptPath)) {
    fail(`hook script does not exist: ${scriptPath}`);
    continue;
  }

  try {
    execFileSync('node', ['--check', scriptPath], { stdio: 'pipe', timeout: 15000 });
  } catch (error) {
    fail(`node --check failed for ${scriptPath}: ${(error.stderr || error.message).toString().trim()}`);
    continue;
  }

  const shells = os.platform() === 'win32' ? ['cmd', 'powershell'] : ['sh'];
  for (const shell of shells) {
    try {
      shellCheck(scriptPath, shell);
    } catch (error) {
      fail(`${shell} cannot execute quoted hook path ${scriptPath}: ${(error.stderr || error.message).toString().trim()}`);
    }
  }

  if (command.includes('post-compact-reinject')) {
    smokeReinject(command, 'PostCompact');
    smokeReinject(command, 'SessionStart');
  }
}

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write(`[global-hooks-verify] ok (${commands.length} commands)\n`);
