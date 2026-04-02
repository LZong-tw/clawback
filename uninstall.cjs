'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { isClawbackHook, MARKER_BEGIN, MARKER_END } = require('./install.cjs');

/**
 * Remove clawback hooks from settings.json.
 */
function cleanSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return;

  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (!settings.hooks) return;

    for (const event of Object.keys(settings.hooks)) {
      settings.hooks[event] = settings.hooks[event].filter(e => !isClawbackHook(e));
      if (settings.hooks[event].length === 0) {
        delete settings.hooks[event];
      }
    }

    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    // Atomic write
    const tmp = settingsPath + '.tmp.' + process.pid;
    try {
      fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
      fs.renameSync(tmp, settingsPath);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch {}
      throw err;
    }
  } catch (err) {
    console.error(`Warning: could not clean settings.json: ${err.message}`);
  }
}

/**
 * Remove clawback section from CLAUDE.md.
 */
function cleanClaudeMd(claudeMdPath) {
  if (!fs.existsSync(claudeMdPath)) return;

  let content = fs.readFileSync(claudeMdPath, 'utf8');
  const beginIdx = content.indexOf(MARKER_BEGIN);
  const endIdx = content.indexOf(MARKER_END);

  if (beginIdx !== -1 && endIdx !== -1) {
    const before = content.slice(0, beginIdx).trimEnd();
    const after = content.slice(endIdx + MARKER_END.length).trimStart();
    content = before + (before && after ? '\n\n' : '') + after;
    fs.writeFileSync(claudeMdPath, content);
  }
}

/**
 * Main uninstall function.
 */
function uninstall(options = {}) {
  const home = options.home || os.homedir();
  const claudeDir = path.join(home, '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  const manifestPath = path.join(hooksDir, 'clawback-manifest.json');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');

  // Read manifest
  let manifest = { files: [] };
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {}
  }

  // Remove installed files
  for (const file of manifest.files) {
    try {
      if (fs.existsSync(file)) {
        // Don't delete CLAUDE.md — just clean the section
        if (path.basename(file) === 'CLAUDE.md') continue;
        fs.unlinkSync(file);
      }
    } catch (err) {
      console.warn(`Warning: could not remove ${file}: ${err.message}`);
    }
  }

  // Clean lib directory if empty
  const libDir = path.join(hooksDir, 'lib');
  try {
    if (fs.existsSync(libDir) && fs.readdirSync(libDir).length === 0) {
      fs.rmdirSync(libDir);
    }
  } catch {}

  // Clean settings.json
  cleanSettings(settingsPath);

  // Clean CLAUDE.md
  cleanClaudeMd(claudeMdPath);

  // Remove manifest
  try { fs.unlinkSync(manifestPath); } catch {}

  return { removed: manifest.files.length };
}

// CLI entry point
if (require.main === module) {
  try {
    const result = uninstall();
    console.log('=== Clawback Uninstalled ===');
    console.log(`Removed ${result.removed} files`);
    console.log('Settings and CLAUDE.md cleaned.');
  } catch (err) {
    console.error('Uninstall failed:', err.message);
    process.exit(1);
  }
}

module.exports = { uninstall, cleanSettings, cleanClaudeMd };
