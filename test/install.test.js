'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

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
    const { install } = require('../install');
    install({ home: fakeHome });
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'protect-files.js')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'post-edit.js')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'stop-verify.js')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'post-compact-reinject.js')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'notification.js')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'lib', 'detect-stack.js')));
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'lib', 'exec.js')));
  });

  it('creates settings.json with hooks config', () => {
    const { install } = require('../install');
    install({ home: fakeHome });
    const settings = JSON.parse(fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    assert.ok(settings.hooks);
    assert.ok(settings.hooks.PreToolUse);
    assert.ok(settings.hooks.PostToolUse);
    assert.ok(settings.hooks.Stop);
    assert.ok(settings.hooks.PostCompact);
    assert.ok(settings.hooks.Notification);
  });

  it('merges with existing settings.json', () => {
    const existing = { env: { FOO: 'bar' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo test' }] }] } };
    fs.writeFileSync(path.join(fakeHome, '.claude', 'settings.json'), JSON.stringify(existing));
    const { install } = require('../install');
    install({ home: fakeHome });
    const settings = JSON.parse(fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    assert.equal(settings.env.FOO, 'bar'); // preserved
    assert.ok(settings.hooks.Stop.length >= 2); // both existing and new
  });

  it('is idempotent (no duplicate hooks on re-install)', () => {
    const { install } = require('../install');
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
    const { install } = require('../install');
    install({ home: fakeHome });
    const content = fs.readFileSync(path.join(fakeHome, '.claude', 'CLAUDE.md'), 'utf8');
    assert.ok(content.includes('<!-- clawback:v1:begin -->'));
    assert.ok(content.includes('<!-- clawback:v1:end -->'));
  });

  it('preserves existing CLAUDE.md content', () => {
    fs.writeFileSync(path.join(fakeHome, '.claude', 'CLAUDE.md'), '# My Custom Rules\n\nDo things my way.\n');
    const { install } = require('../install');
    install({ home: fakeHome });
    const content = fs.readFileSync(path.join(fakeHome, '.claude', 'CLAUDE.md'), 'utf8');
    assert.ok(content.includes('# My Custom Rules'));
    assert.ok(content.includes('<!-- clawback:v1:begin -->'));
  });

  it('writes manifest', () => {
    const { install } = require('../install');
    install({ home: fakeHome });
    assert.ok(fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'clawback-manifest.json')));
    const manifest = JSON.parse(fs.readFileSync(path.join(fakeHome, '.claude', 'hooks', 'clawback-manifest.json'), 'utf8'));
    assert.ok(Array.isArray(manifest.files));
    assert.ok(manifest.files.length > 0);
  });
});
