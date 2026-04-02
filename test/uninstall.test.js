'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

describe('uninstall', () => {
  let fakeHome;

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clawback-uninstall-'));
    // Install first
    const { install } = require('../install.cjs');
    install({ home: fakeHome });
  });

  afterEach(() => {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('removes all installed hook files', () => {
    const { uninstall } = require('../uninstall.cjs');
    uninstall({ home: fakeHome });
    assert.ok(!fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'protect-files.cjs')));
    assert.ok(!fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'post-edit.cjs')));
    assert.ok(!fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'stop-verify.cjs')));
  });

  it('removes clawback hooks from settings.json', () => {
    const { uninstall } = require('../uninstall.cjs');
    uninstall({ home: fakeHome });
    const settings = JSON.parse(fs.readFileSync(path.join(fakeHome, '.claude', 'settings.json'), 'utf8'));
    // No clawback hooks should remain
    for (const entries of Object.values(settings.hooks || {})) {
      for (const entry of entries) {
        const hasClawback = entry.hooks?.some(h => h.command?.includes('protect-files') || h.command?.includes('post-edit'));
        assert.ok(!hasClawback, 'Found clawback hook in settings after uninstall');
      }
    }
  });

  it('removes CLAUDE.md section markers', () => {
    const { uninstall } = require('../uninstall.cjs');
    uninstall({ home: fakeHome });
    const content = fs.readFileSync(path.join(fakeHome, '.claude', 'CLAUDE.md'), 'utf8');
    assert.ok(!content.includes('clawback:v1:begin'));
  });

  it('removes manifest', () => {
    const { uninstall } = require('../uninstall.cjs');
    uninstall({ home: fakeHome });
    assert.ok(!fs.existsSync(path.join(fakeHome, '.claude', 'hooks', 'clawback-manifest.json')));
  });
});
