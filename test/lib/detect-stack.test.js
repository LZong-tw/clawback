'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function makeTempProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawback-test-'));
  for (const [name, content] of Object.entries(files)) {
    const fullPath = path.join(dir, name);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return dir;
}

function cleanTempProject(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('detectStack', () => {
  let tempDir;

  afterEach(() => {
    if (tempDir) cleanTempProject(tempDir);
    // Clear require cache between tests
    delete require.cache[require.resolve('../../lib/detect-stack.cjs')];
  });

  it('returns all nulls for empty directory', () => {
    tempDir = makeTempProject({});
    const { detectStack } = require('../../lib/detect-stack.cjs');
    const result = detectStack(tempDir);
    assert.equal(result.typecheck, null);
    assert.equal(result.lint, null);
    assert.equal(result.lintFile, null);
    assert.equal(result.format, null);
    assert.equal(result.test, null);
    assert.equal(result.pkg_mgr, null);
    assert.deepEqual(result.lockfiles, []);
    assert.deepEqual(result.sourceExtensions, []);
  });

  it('detects TypeScript project', () => {
    tempDir = makeTempProject({
      'tsconfig.json': '{}',
      'package.json': '{"scripts":{"lint":"eslint ."}}',
    });
    const { detectStack } = require('../../lib/detect-stack.cjs');
    const result = detectStack(tempDir);
    assert.ok(Array.isArray(result.lockfiles));
    assert.ok(Array.isArray(result.sourceExtensions));
    assert.ok(result.sourceExtensions.includes('.ts'));
  });

  it('detects package manager from lockfile', () => {
    tempDir = makeTempProject({
      'package.json': '{}',
      'pnpm-lock.yaml': '',
    });
    const { detectStack } = require('../../lib/detect-stack.cjs');
    const result = detectStack(tempDir);
    assert.equal(result.pkg_mgr, 'pnpm');
    assert.ok(result.lockfiles.includes('pnpm-lock.yaml'));
  });

  it('walks up from subdirectory to find config', () => {
    tempDir = makeTempProject({
      'tsconfig.json': '{}',
      'src/components/foo.ts': '',
    });
    const { detectStack } = require('../../lib/detect-stack.cjs');
    const subDir = path.join(tempDir, 'src', 'components');
    const result = detectStack(subDir);
    assert.ok(result.sourceExtensions.includes('.ts'));
  });

  it('returns Go stack for go.mod', () => {
    tempDir = makeTempProject({ 'go.mod': 'module example.com/foo' });
    const { detectStack } = require('../../lib/detect-stack.cjs');
    const result = detectStack(tempDir);
    assert.ok(result.sourceExtensions.includes('.go'));
    assert.ok(result.lockfiles.includes('go.sum'));
  });
});
