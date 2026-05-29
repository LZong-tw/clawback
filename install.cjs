'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SRC_ROOT = __dirname;

const CORE_HOOKS = [
  'hooks/protect-files.cjs',
  'hooks/post-edit.cjs',
  'hooks/stop-verify.cjs',
  'hooks/post-compact-reinject.cjs',
  'hooks/notification.cjs',
];

const LIB_FILES = [
  'lib/detect-stack.cjs',
  'lib/exec.cjs',
];

const EXTRA_HOOKS = {
  'read-guard': 'extras/guard-read.cjs',
  'ui-guard': 'extras/ui-antipattern-check.mjs',
};

const VERIFY_HOOK = 'hooks/verify-global-hooks.cjs';

const MARKER_BEGIN = '<!-- clawback:v1:begin -->';
const MARKER_END = '<!-- clawback:v1:end -->';

/**
 * Build the settings.json hooks configuration.
 */
function buildHooksConfig(hooksDir, extras = [], options = {}) {
  // Forward slashes for cross-platform compat (works in both cmd.exe and bash)
  const nodeCmd = (file, args = []) => {
    const suffix = args.length ? ` ${args.join(' ')}` : '';
    return `node "${path.join(hooksDir, file).replace(/\\/g, '/')}"${suffix}`;
  };
  const protectArgs = options.strictInfra ? ['--strict-infra'] : [];
  const includeNotification = options.includeNotification !== false;

  const config = {
    PreToolUse: [
      {
        matcher: 'Edit|Write',
        hooks: [{ type: 'command', command: nodeCmd('protect-files.cjs', protectArgs) }],
      },
    ],
    PostToolUse: [
      {
        matcher: 'Edit|Write',
        hooks: [{ type: 'command', command: nodeCmd('post-edit.cjs') }],
      },
    ],
    Stop: [
      {
        hooks: [{ type: 'command', command: nodeCmd('stop-verify.cjs') }],
      },
    ],
    PostCompact: [
      {
        hooks: [{ type: 'command', command: nodeCmd('post-compact-reinject.cjs') }],
      },
    ],
  };

  if (includeNotification) {
    config.Notification = [
      {
        hooks: [{ type: 'command', command: nodeCmd('notification.cjs') }],
      },
    ];
  }

  if (extras.includes('read-guard')) {
    config.PreToolUse.push({
      matcher: 'Read',
      hooks: [{ type: 'command', command: nodeCmd('guard-read.cjs') }],
    });
  }

  if (extras.includes('ui-guard')) {
    config.PostToolUse.push({
      matcher: 'Edit|Write',
      hooks: [{ type: 'command', command: nodeCmd('ui-antipattern-check.mjs'), timeout: 10 }],
    });
  }

  return config;
}

/**
 * Check if a hook entry is from clawback (by command path).
 */
function isClawbackHook(hookEntry) {
  // Match both .cjs (current) and .js (legacy) to clean up old installs
  const HOOK_NAMES = [
    'protect-files',
    'post-edit',
    'stop-verify',
    'post-compact-reinject',
    'notification',
    'guard-read',
    'ui-antipattern-check',
    'verify-global-hooks',
  ];
  return hookEntry.hooks?.some(h =>
    h.command && HOOK_NAMES.some(name =>
      h.command.includes(name + '.cjs') || h.command.includes(name + '.mjs') || h.command.includes(name + '.js')
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

function packageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SRC_ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function copyHookFiles(hooksDir, libDir, extras = [], options = {}) {
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });

  const installedFiles = [];

  for (const file of CORE_HOOKS) {
    const src = path.join(SRC_ROOT, file);
    const dest = path.join(hooksDir, path.basename(file));
    fs.copyFileSync(src, dest);
    installedFiles.push(dest);
  }

  for (const file of LIB_FILES) {
    const src = path.join(SRC_ROOT, file);
    const dest = path.join(libDir, path.basename(file));
    fs.copyFileSync(src, dest);
    installedFiles.push(dest);
  }

  for (const extra of extras) {
    const file = EXTRA_HOOKS[extra];
    if (file) {
      const src = path.join(SRC_ROOT, file);
      const dest = path.join(hooksDir, path.basename(file));
      fs.copyFileSync(src, dest);
      installedFiles.push(dest);
    }
  }

  if (options.includeVerifier) {
    const src = path.join(SRC_ROOT, VERIFY_HOOK);
    const dest = path.join(hooksDir, path.basename(VERIFY_HOOK));
    fs.copyFileSync(src, dest);
    installedFiles.push(dest);
  }

  return installedFiles;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    const backup = filePath + '.bak.' + Date.now();
    fs.copyFileSync(filePath, backup);
    console.log(`Backed up corrupted JSON to ${backup}`);
    return {};
  }
}

function writeJsonFileAtomic(filePath, value) {
  const tmp = filePath + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

/**
 * Main install function.
 * @param {object} options
 * @param {string} [options.home] - override home directory (for testing)
 * @param {string[]} [options.extras] - extra hooks to install
 * @param {boolean} [options.strictInfra] - block .husky/ and .github/workflows/
 * @param {boolean} [options.codex] - also install Codex global hooks
 */
function install(options = {}) {
  const home = options.home || os.homedir();
  const extras = options.extras || [];
  const installCodex = Boolean(options.codex);
  const claudeDir = path.join(home, '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  const libDir = path.join(hooksDir, 'lib');
  const settingsPath = path.join(claudeDir, 'settings.json');
  const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
  const manifestPath = path.join(hooksDir, 'clawback-manifest.json');

  const installedFiles = copyHookFiles(hooksDir, libDir, extras);

  // Merge settings.json
  const existingSettings = readJsonFile(settingsPath);
  const hooksConfig = buildHooksConfig(hooksDir, extras, {
    strictInfra: Boolean(options.strictInfra),
  });
  const mergedSettings = mergeSettings(existingSettings, hooksConfig);
  writeJsonFileAtomic(settingsPath, mergedSettings);

  let codexHooksPath = null;
  if (installCodex) {
    const codexDir = path.join(home, '.codex');
    const codexHooksDir = path.join(codexDir, 'hooks');
    const codexLibDir = path.join(codexHooksDir, 'lib');
    codexHooksPath = path.join(codexDir, 'hooks.json');

    installedFiles.push(...copyHookFiles(codexHooksDir, codexLibDir, extras, { includeVerifier: true }));

    const existingCodexHooks = readJsonFile(codexHooksPath);
    const codexHooksConfig = buildHooksConfig(codexHooksDir, extras, {
      strictInfra: Boolean(options.strictInfra),
      includeNotification: false,
    });
    const mergedCodexHooks = mergeSettings(existingCodexHooks, codexHooksConfig);
    writeJsonFileAtomic(codexHooksPath, mergedCodexHooks);
  }

  // Install CLAUDE.md
  const templatePath = path.join(SRC_ROOT, 'templates', 'CLAUDE.global.md');
  installClaudeMd(claudeMdPath, templatePath);
  installedFiles.push(claudeMdPath);

  // Write manifest
  const manifest = {
    version: packageVersion(),
    installedAt: new Date().toISOString(),
    options: {
      extras,
      strictInfra: Boolean(options.strictInfra),
      codex: installCodex,
    },
    files: installedFiles,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return { installedFiles, settingsPath, codexHooksPath, manifestPath };
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const extras = [];
  const strictInfra = args.includes('--strict-infra');
  const codex = args.includes('--with-codex') || args.includes('--codex');
  if (args.includes('--with-read-guard')) extras.push('read-guard');
  if (args.includes('--with-ui-guard')) extras.push('ui-guard');

  try {
    const result = install({ extras, strictInfra, codex });
    console.log('=== Clawback Installed ===');
    console.log(`Hooks: ${result.installedFiles.length} files installed`);
    console.log(`Settings: ${result.settingsPath}`);
    if (result.codexHooksPath) console.log(`Codex hooks: ${result.codexHooksPath}`);
    console.log(`Manifest: ${result.manifestPath}`);
    console.log('\nRun "claude" and type /hooks to verify.');
    if (result.codexHooksPath) console.log('For Codex, run: node ~/.codex/hooks/verify-global-hooks.cjs');
  } catch (err) {
    console.error('Install failed:', err.message);
    process.exit(1);
  }
}

module.exports = {
  install,
  buildHooksConfig,
  mergeSettings,
  isClawbackHook,
  installClaudeMd,
  MARKER_BEGIN,
  MARKER_END,
};
