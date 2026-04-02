'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SRC_ROOT = __dirname;

const CORE_HOOKS = [
  'hooks/protect-files.js',
  'hooks/post-edit.js',
  'hooks/stop-verify.js',
  'hooks/post-compact-reinject.js',
  'hooks/notification.js',
];

const LIB_FILES = [
  'lib/detect-stack.js',
  'lib/exec.js',
];

const EXTRA_HOOKS = {
  'read-guard': 'extras/guard-read.js',
};

const MARKER_BEGIN = '<!-- clawback:v1:begin -->';
const MARKER_END = '<!-- clawback:v1:end -->';

/**
 * Build the settings.json hooks configuration.
 */
function buildHooksConfig(hooksDir, extras = []) {
  // Forward slashes for cross-platform compat (works in both cmd.exe and bash)
  const nodeCmd = (file) => `node "${path.join(hooksDir, file).replace(/\\/g, '/')}"`;

  const config = {
    PreToolUse: [
      {
        matcher: 'Edit|Write',
        hooks: [{ type: 'command', command: nodeCmd('protect-files.js') }],
      },
    ],
    PostToolUse: [
      {
        matcher: 'Edit|Write',
        hooks: [{ type: 'command', command: nodeCmd('post-edit.js') }],
      },
    ],
    Stop: [
      {
        hooks: [{ type: 'command', command: nodeCmd('stop-verify.js') }],
      },
    ],
    PostCompact: [
      {
        hooks: [{ type: 'command', command: nodeCmd('post-compact-reinject.js') }],
      },
    ],
    Notification: [
      {
        hooks: [{ type: 'command', command: nodeCmd('notification.js') }],
      },
    ],
  };

  if (extras.includes('read-guard')) {
    config.PreToolUse.push({
      matcher: 'Read',
      hooks: [{ type: 'command', command: nodeCmd('guard-read.js') }],
    });
  }

  return config;
}

/**
 * Check if a hook entry is from clawback (by command path).
 */
function isClawbackHook(hookEntry) {
  return hookEntry.hooks?.some(h =>
    h.command && (
      h.command.includes('protect-files.js') ||
      h.command.includes('post-edit.js') ||
      h.command.includes('stop-verify.js') ||
      h.command.includes('post-compact-reinject.js') ||
      h.command.includes('notification.js') ||
      h.command.includes('guard-read.js')
    )
  );
}

/**
 * Deep merge hooks config into existing settings.
 */
function mergeSettings(existing, newHooksConfig) {
  const settings = { ...existing };
  if (!settings.hooks) settings.hooks = {};

  for (const [event, newEntries] of Object.entries(newHooksConfig)) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = newEntries;
    } else {
      // Remove existing clawback entries (dedup)
      settings.hooks[event] = settings.hooks[event].filter(e => !isClawbackHook(e));
      // Add new entries
      settings.hooks[event].push(...newEntries);
    }
  }

  return settings;
}

/**
 * Install CLAUDE.md with section markers.
 */
function installClaudeMd(claudeMdPath, templatePath) {
  const template = fs.readFileSync(templatePath, 'utf8');
  let existing = '';

  if (fs.existsSync(claudeMdPath)) {
    existing = fs.readFileSync(claudeMdPath, 'utf8');
  }

  // Replace existing markers section or append
  const beginIdx = existing.indexOf(MARKER_BEGIN);
  const endIdx = existing.indexOf(MARKER_END);

  if (beginIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + MARKER_END.length);
    fs.writeFileSync(claudeMdPath, before + template + after);
  } else {
    // Append
    const separator = existing.trim() ? '\n\n' : '';
    fs.writeFileSync(claudeMdPath, existing + separator + template);
  }
}

/**
 * Main install function.
 * @param {object} options
 * @param {string} [options.home] - override home directory (for testing)
 * @param {string[]} [options.extras] - extra hooks to install
 */
function install(options = {}) {
  const home = options.home || os.homedir();
  const extras = options.extras || [];
  const claudeDir = path.join(home, '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  const libDir = path.join(hooksDir, 'lib');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
  const manifestPath = path.join(hooksDir, 'clawback-manifest.json');

  // Create directories
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });

  const installedFiles = [];

  // Copy core hooks
  for (const file of CORE_HOOKS) {
    const src = path.join(SRC_ROOT, file);
    const dest = path.join(hooksDir, path.basename(file));
    fs.copyFileSync(src, dest);
    installedFiles.push(dest);
  }

  // Copy lib files
  for (const file of LIB_FILES) {
    const src = path.join(SRC_ROOT, file);
    const dest = path.join(libDir, path.basename(file));
    fs.copyFileSync(src, dest);
    installedFiles.push(dest);
  }

  // Copy extras
  for (const extra of extras) {
    const file = EXTRA_HOOKS[extra];
    if (file) {
      const src = path.join(SRC_ROOT, file);
      const dest = path.join(hooksDir, path.basename(file));
      fs.copyFileSync(src, dest);
      installedFiles.push(dest);
    }
  }

  // Merge settings.json
  let existingSettings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      // Corrupted settings — back up and start fresh
      const backup = settingsPath + '.bak.' + Date.now();
      fs.copyFileSync(settingsPath, backup);
      console.log(`Backed up corrupted settings.json to ${backup}`);
    }
  }

  const hooksConfig = buildHooksConfig(hooksDir, extras);
  const mergedSettings = mergeSettings(existingSettings, hooksConfig);

  // Atomic write
  const tmpSettings = settingsPath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmpSettings, JSON.stringify(mergedSettings, null, 2));
    fs.renameSync(tmpSettings, settingsPath);
  } catch (err) {
    try { fs.unlinkSync(tmpSettings); } catch {}
    throw err;
  }

  // Install CLAUDE.md
  const templatePath = path.join(SRC_ROOT, 'templates', 'CLAUDE.global.md');
  installClaudeMd(claudeMdPath, templatePath);
  installedFiles.push(claudeMdPath);

  // Write manifest
  const manifest = {
    version: '1.0.0',
    installedAt: new Date().toISOString(),
    files: installedFiles,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return { installedFiles, settingsPath, manifestPath };
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const extras = [];
  if (args.includes('--with-read-guard')) extras.push('read-guard');

  try {
    const result = install({ extras });
    console.log('=== Clawback Installed ===');
    console.log(`Hooks: ${result.installedFiles.length} files installed`);
    console.log(`Settings: ${result.settingsPath}`);
    console.log(`Manifest: ${result.manifestPath}`);
    console.log('\nRun "claude" and type /hooks to verify.');
  } catch (err) {
    console.error('Install failed:', err.message);
    process.exit(1);
  }
}

module.exports = { install, mergeSettings, isClawbackHook, installClaudeMd, MARKER_BEGIN, MARKER_END };
