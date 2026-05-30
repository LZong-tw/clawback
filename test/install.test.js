'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

describe('install', () => {
  let fakeHome;

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clawback-install-'));
    fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('creates hooks directory and copies files', () => {
    const { install } = require('../install.cjs');
    install({ home: fakeHome });
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'protect-files.cjs')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'post-edit.cjs')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'stop-verify.cjs')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'post-compact-reinject.cjs')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'notification.cjs')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'lib', 'detect-stack.cjs')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'lib', 'exec.cjs')));
  });

  it('creates settings.json with hooks config', () => {
    const { install } = require('../install.cjs');
    install({ home: fakeHome });
    const settings = JSON.parse(fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    assert.ok(settings.hooks);
    assert.ok(settings.hooks.PreToolUse);
    assert.ok(settings.hooks.PostToolUse);
    assert.ok(settings.hooks.Stop);
    assert.ok(settings.hooks.SessionStart);
    // Reinject must be wired to SessionStart — PostCompact cannot inject on Claude Code.
    const sessionStartCommands = settings.hooks.SessionStart
      .flatMap(entry => entry.hooks || [])
      .map(hook => hook.command);
    assert.ok(sessionStartCommands.some(c => c.includes('post-compact-reinject.cjs')));
    assert.equal(settings.hooks.PostCompact, undefined);
    assert.ok(settings.hooks.Notification);
  });

  it('merges with existing settings.json', () => {
    const existing = { env: { FOO: 'bar' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo test' }] }] } };
    fs.writeFileSync(path.join(fakeHome, '.claude', 'settings.json'), JSON.stringify(existing));
    const { install } = require('../install.cjs');
    install({ home: fakeHome });
    const settings = JSON.parse(fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    assert.equal(settings.env.FOO, 'bar'); // preserved
    assert.ok(settings.hooks.Stop.length >= 2); // both existing and new
  });

  it('is idempotent (no duplicate hooks on re-install)', () => {
    const { install } = require('../install.cjs');
    install({ home: fakeHome });
    install({ home: fakeHome });
    const settings = JSON.parse(fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    // Should not have duplicate entries
    const preToolUseHooks = settings.hooks.PreToolUse;
    const clawbackEntries = preToolUseHooks.filter(e =>
      e.hooks?.some(h => h.command?.includes('clawback') || h.command?.includes('protect-files'))
    );
    assert.equal(clawbackEntries.length, 1);
  });

  it('installs CLAUDE.md with section markers', () => {
    const { install } = require('../install.cjs');
    install({ home: fakeHome });
    const content = fs.readFileSync(path.join(fakeHome, '.claude', 'CLAUDE.md'), 'utf8');
    assert.ok(content.includes('<!-- clawback:v1:begin -->'));
    assert.ok(content.includes('<!-- clawback:v1:end -->'));
  });

  it('preserves existing CLAUDE.md content', () => {
    fs.writeFileSync(path.join(fakeHome, '.claude', 'CLAUDE.md'), '# My Custom Rules\n\nDo things my way.\n');
    const { install } = require('../install.cjs');
    install({ home: fakeHome });
    const content = fs.readFileSync(path.join(fakeHome, '.claude', 'CLAUDE.md'), 'utf8');
    assert.ok(content.includes('# My Custom Rules'));
    assert.ok(content.includes('<!-- clawback:v1:begin -->'));
  });

  it('writes manifest', () => {
    const { install } = require('../install.cjs');
    install({ home: fakeHome });
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'clawback-manifest.json')));
    const manifest = JSON.parse(fs.readFileSync(path.join(fakeHome, '.claude', 'hooks', 'clawback-manifest.json'), 'utf8'));
    assert.ok(Array.isArray(manifest.files));
    assert.ok(manifest.files.length > 0);
  });

  it('installs strict infra protection as an explicit protect-files argument', () => {
    const { install } = require('../install.cjs');
    install({ home: fakeHome, strictInfra: true });
    const settings = JSON.parse(fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    const protectCommand = settings.hooks.PreToolUse
      .flatMap(entry => entry.hooks || [])
      .find(hook => hook.command.includes('protect-files.cjs')).command;
    assert.match(protectCommand, /--strict-infra/);
  });

  it('installs the optional UI guard extra', () => {
    const { install } = require('../install.cjs');
    install({ home: fakeHome, extras: ['ui-guard'] });
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'ui-antipattern-check.mjs')));
    const settings = JSON.parse(fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    const postToolCommands = settings.hooks.PostToolUse.flatMap(entry => entry.hooks || []).map(hook => hook.command);
    assert.ok(postToolCommands.some(command => command.includes('ui-antipattern-check.mjs')));
  });

  it('installs Codex hooks with shell-safe quoted commands', () => {
    const { install } = require('../install.cjs');
    install({ home: fakeHome, codex: true, extras: ['ui-guard'] });

    assert.ok(fs.existsSync(path.join(fakeHome, '.codex', 'hooks', 'protect-files.cjs')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.codex', 'hooks', 'post-edit.cjs')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.codex', 'hooks', 'verify-global-hooks.cjs')));

    const codexHooks = JSON.parse(fs.readFileSync(path.join(fakeHome, '.codex', 'hooks.json'), 'utf8'));
    const commands = Object.values(codexHooks.hooks)
      .flat()
      .flatMap(entry => entry.hooks || [])
      .map(hook => hook.command);

    assert.ok(commands.some(command => command.includes('protect-files.cjs')));
    assert.ok(commands.some(command => command.includes('ui-antipattern-check.mjs')));
    assert.ok(commands.some(command => command.includes('post-compact-reinject.cjs')));
    assert.ok(codexHooks.hooks.PostCompact, 'Codex keeps PostCompact for reinject');
    assert.equal(codexHooks.hooks.SessionStart, undefined, 'Codex install does not add SessionStart');
    assert.ok(commands.every(command => command.startsWith('node "')));
    assert.ok(commands.every(command => !command.includes("node '")));
    assert.ok(commands.every(command => !/\b[A-Za-z_][A-Za-z0-9_]*=.*\s+node\b/.test(command)));
  });

  it('keeps existing Codex hooks and dedupes Clawback entries', () => {
    fs.mkdirSync(path.join(fakeHome, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.codex', 'hooks.json'), JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo custom-hook' }] }],
        PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'node "C:/old/protect-files.cjs"' }] }],
      },
    }));

    const { install } = require('../install.cjs');
    install({ home: fakeHome, codex: true });
    install({ home: fakeHome, codex: true });

    const codexHooks = JSON.parse(fs.readFileSync(path.join(fakeHome, '.codex', 'hooks.json'), 'utf8'));
    const preToolCommands = codexHooks.hooks.PreToolUse
      .flatMap(entry => entry.hooks || [])
      .map(hook => hook.command)
      .filter(command => command.includes('protect-files.cjs'));

    assert.equal(preToolCommands.length, 1);
    assert.ok(JSON.stringify(codexHooks).includes('custom-hook'));

    const verifier = path.join(fakeHome, '.codex', 'hooks', 'verify-global-hooks.cjs');
    const output = execFileSync(process.execPath, [verifier], {
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.match(output, /ok \(\d+ commands\)/);
  });

  it('installs a Codex hook verifier that passes for generated hooks', () => {
    const { install } = require('../install.cjs');
    install({ home: fakeHome, codex: true, extras: ['ui-guard'] });

    const verifier = path.join(fakeHome, '.codex', 'hooks', 'verify-global-hooks.cjs');
    const output = execFileSync(process.execPath, [verifier], {
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.match(output, /ok \(\d+ commands\)/);
  });
});
