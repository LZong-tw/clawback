'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runHook, parseHookOutput } = require('../helpers');

function withTempTsx(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawback-ui-guard-'));
  const filePath = path.join(dir, 'Component.tsx');
  try {
    fs.writeFileSync(filePath, content);
    return fn(filePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('ui-antipattern-check', () => {
  it('allows non-TSX files', () => {
    const { stdout } = runHook('extras/ui-antipattern-check.mjs', {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/project/src/app.ts' },
    });
    assert.equal(parseHookOutput(stdout), null);
  });

  it('warns about dropdowns that can be clipped by overflow-hidden', () => {
    withTempTsx(`
      import { Dropdown } from './Dropdown';

      export function Demo() {
        return (
          <div className="overflow-hidden">
            <Dropdown />
          </div>
        );
      }
    `, (filePath) => {
      const { stdout } = runHook('extras/ui-antipattern-check.mjs', {
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: filePath },
      });
      const output = parseHookOutput(stdout);
      assert.ok(output);
      assert.match(output.additionalContext, /overflow-hidden/);
    });
  });

  it('warns about number range validation inside onChange', () => {
    withTempTsx(`
      export function Demo() {
        return (
          <input
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (next < 1) return;
            }}
          />
        );
      }
    `, (filePath) => {
      const { stdout } = runHook('extras/ui-antipattern-check.mjs', {
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: filePath },
      });
      const output = parseHookOutput(stdout);
      assert.ok(output);
      assert.match(output.additionalContext, /Range validation/);
    });
  });
});
