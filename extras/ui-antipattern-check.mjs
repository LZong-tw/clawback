#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function readHookInput() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return null;
  }
}

function addOverflowClippingWarning(content, warnings) {
  if (!content.includes('overflow-hidden')) return;

  const hasAbsoluteOrFixed =
    /className\s*=\s*\{?["'`][^"'`]*\b(absolute|fixed)\b/m.test(content) ||
    /className\s*=\s*\{`[^`]*\b(absolute|fixed)\b/m.test(content);
  const hasDropdownImport =
    /import\s+.*\b(FieldSelect|Dropdown|CustomDropdown|Select|Popover|DropdownMenu|Menu)\b/m.test(content);

  if (hasAbsoluteOrFixed || hasDropdownImport) {
    warnings.push(
      '\u26a0\ufe0f UI Risk: overflow-hidden on a container that has absolute/fixed positioned children. ' +
        'Dropdown menus will be clipped. Use createPortal() or remove overflow-hidden.',
    );
  }
}

function addOnChangeRangeWarning(content, warnings) {
  const onChangePattern = /onChange\s*=\s*\{(?:\s*\([^)]*\)\s*=>|[^}]*function)/g;
  let match;

  while ((match = onChangePattern.exec(content)) !== null) {
    const lines = content.slice(match.index).split('\n');
    const window = lines.slice(0, 15).join('\n');
    const hasNumberParsing = /\b(parseInt|parseFloat|Number\s*\()\b/.test(window);
    const hasRangeCheck = /[^=!<>][<>]=?\s*\d|Math\.(min|max|clamp)\b|\bclamp\s*\(/.test(window);

    if (hasNumberParsing && hasRangeCheck) {
      warnings.push(
        '\u26a0\ufe0f UI Risk: Range validation in onChange handler blocks partial input. ' +
          'Use local useState for display value + validate on onBlur only.',
      );
      break;
    }
  }
}

function addDropdownPortalWarning(content, warnings) {
  const hasRelative = /className\s*=\s*\{?["'`][^"'`]*\brelative\b/m.test(content);
  const hasAbsoluteWithZ =
    /className\s*=\s*\{?["'`][^"'`]*\babsolute\b[^"'`]*\bz-/m.test(content) ||
    /className\s*=\s*\{?["'`][^"'`]*\bz-[^"'`]*\babsolute\b/m.test(content);
  const hasCreatePortal = /\bcreatePortal\b/.test(content);

  if (hasRelative && hasAbsoluteWithZ && !hasCreatePortal) {
    warnings.push(
      '\u26a0\ufe0f UI Risk: Custom dropdown with absolute positioning but no Portal. ' +
        "Will be clipped by overflow-hidden ancestors. Import createPortal from 'react-dom'.",
    );
  }
}

export function collectUiWarnings(content) {
  const warnings = [];
  addOverflowClippingWarning(content, warnings);
  addOnChangeRangeWarning(content, warnings);
  addDropdownPortalWarning(content, warnings);
  return warnings;
}

async function main() {
  const input = await readHookInput();
  const filePath = input?.tool_input?.file_path;
  if (!filePath || extname(filePath).toLowerCase() !== '.tsx') process.exit(0);

  let content;
  try {
    content = readFileSync(resolve(filePath), 'utf8');
  } catch {
    process.exit(0);
  }

  const warnings = collectUiWarnings(content);
  if (warnings.length > 0) {
    process.stdout.write(JSON.stringify({ additionalContext: warnings.join('\n\n') }));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
