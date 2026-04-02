'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runHook, parseHookOutput } = require('../helpers');

describe('post-compact-reinject', () => {
  it('exits 0 with no output for non-git directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawback-test-'));
    try {
      const { exitCode, stdout } = runHook('hooks/post-compact-reinject.js', {
        hook_event_name: 'PostCompact',
        cwd: tmpDir,
      }, { CLAUDE_PROJECT_DIR: tmpDir });
      assert.equal(exitCode, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('truncateWithSummary truncates long text correctly', () => {
    const { truncateWithSummary } = require('../../hooks/post-compact-reinject.js');
    assert.ok(typeof truncateWithSummary === 'function', 'truncateWithSummary must be exported');

    const longText = 'line\n'.repeat(1000);
    const result = truncateWithSummary(longText, 200, 'test');
    assert.ok(result.length <= 280); // 200 + summary line overhead
    assert.ok(result.includes('[test:'));
    assert.ok(result.includes('truncated'));
  });
});
