'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const CACHE_DIR = path.join(os.tmpdir(), 'clawback');
const CACHE_TTL_MS = 60000;

try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}

function findBinary(name, projectRoot) {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const resolved = execFileSync(cmd, [name], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
      encoding: 'utf8',
    }).trim().split('\n')[0].trim();

    if (projectRoot) {
      const resolvedNorm = path.resolve(resolved);
      const projectNorm = path.resolve(projectRoot);
      if (resolvedNorm.startsWith(projectNorm + path.sep)) {
        process.stderr.write(
          `[clawback] WARNING: ${name} resolves to ${resolvedNorm} (inside project). Verify it's trusted.\n`
        );
      }
    }
    return true;
  } catch {
    return false;
  }
}

function walkUpFind(startDir, fileNames) {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    for (const name of fileNames) {
      if (fs.existsSync(path.join(dir, name))) {
        return { dir, file: name };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === root) return null;
    dir = parent;
  }
}

function getCacheKey(dirPath) {
  let resolved = dirPath;
  try { resolved = fs.realpathSync(dirPath); } catch {}
  return crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 16);
}

function readCache(key) {
  const fp = path.join(CACHE_DIR, `stack-${key}.json`);
  try {
    const stat = fs.statSync(fp);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  const fp = path.join(CACHE_DIR, `stack-${key}.json`);
  try { fs.writeFileSync(fp, JSON.stringify(data)); } catch {}
}

function cmdIf(name, args, projectRoot) {
  if (findBinary(name, projectRoot)) {
    return { cmd: name, args };
  }
  return null;
}

function detectStack(startDir) {
  const resolvedStart = path.resolve(startDir);
  const cacheKey = getCacheKey(resolvedStart);
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const result = {
    typecheck: null,
    lint: null,
    lintFile: null,
    format: null,
    test: null,
    pkg_mgr: null,
    lockfiles: [],
    sourceExtensions: [],
  };

  const configFiles = [
    'tsconfig.json', 'package.json',
    'go.mod',
    'Cargo.toml',
    'pyproject.toml', 'setup.py', 'setup.cfg',
    'composer.json',
  ];

  const found = walkUpFind(resolvedStart, configFiles);
  if (!found) {
    writeCache(cacheKey, result);
    return result;
  }

  const projectRoot = found.dir;

  // --- JS/TS ---
  if (fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) {
    let usesBuild = false;
    try {
      const tscfg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'tsconfig.json'), 'utf8'));
      if (tscfg.references) usesBuild = true;
    } catch {}

    if (usesBuild) {
      result.typecheck = cmdIf('tsc', ['--build', '--noEmit'], projectRoot);
    } else {
      result.typecheck = cmdIf('tsc', ['--noEmit'], projectRoot);
    }
    result.sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'];
  }

  if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
    if (fs.existsSync(path.join(projectRoot, 'bun.lockb'))) {
      result.pkg_mgr = 'bun';
      result.lockfiles.push('bun.lockb');
    } else if (fs.existsSync(path.join(projectRoot, 'bun.lock'))) {
      result.pkg_mgr = 'bun';
      result.lockfiles.push('bun.lock');
    } else if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) {
      result.pkg_mgr = 'pnpm';
      result.lockfiles.push('pnpm-lock.yaml');
    } else if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) {
      result.pkg_mgr = 'yarn';
      result.lockfiles.push('yarn.lock');
    } else if (fs.existsSync(path.join(projectRoot, 'package-lock.json'))) {
      result.pkg_mgr = 'npm';
      result.lockfiles.push('package-lock.json');
    }

    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
      if (pkg.scripts && pkg.scripts.lint) {
        const runner = result.pkg_mgr || 'npm';
        result.lint = { cmd: runner, args: ['run', 'lint'] };
      }
    } catch {}

    result.lintFile = cmdIf('eslint', ['--max-warnings', '0'], projectRoot);
    if (!result.lint) result.lint = result.lintFile;

    const prettierConfigs = ['.prettierrc', '.prettierrc.json', '.prettierrc.js', 'prettier.config.js', 'prettier.config.mjs', 'prettier.config.cjs'];
    if (prettierConfigs.some(c => fs.existsSync(path.join(projectRoot, c)))) {
      result.format = cmdIf('prettier', ['--write'], projectRoot);
    }

    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
      if (pkg.scripts && pkg.scripts.test) {
        const runner = result.pkg_mgr || 'npm';
        result.test = { cmd: runner, args: ['run', 'test'] };
      }
    } catch {}

    if (result.sourceExtensions.length === 0) {
      result.sourceExtensions = ['.js', '.jsx', '.mjs', '.cjs'];
    }
  }

  // --- Go ---
  if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
    result.typecheck = cmdIf('go', ['build', './...'], projectRoot);
    result.lint = cmdIf('go', ['vet', './...'], projectRoot);
    result.lintFile = cmdIf('go', ['vet'], projectRoot);
    result.format = cmdIf('gofmt', ['-w'], projectRoot);
    result.test = cmdIf('go', ['test', './...'], projectRoot);
    result.lockfiles.push('go.sum');
    result.sourceExtensions = ['.go'];
  }

  // --- Rust ---
  if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
    result.typecheck = cmdIf('cargo', ['check'], projectRoot);
    result.lint = cmdIf('cargo', ['clippy', '--', '-D', 'warnings'], projectRoot);
    result.lintFile = null;
    result.format = cmdIf('cargo', ['fmt', '--'], projectRoot);
    result.test = cmdIf('cargo', ['test'], projectRoot);
    result.lockfiles.push('Cargo.lock');
    result.sourceExtensions = ['.rs'];
  }

  // --- Python ---
  if (['pyproject.toml', 'setup.py', 'setup.cfg'].some(f => fs.existsSync(path.join(projectRoot, f)))) {
    result.typecheck = cmdIf('mypy', ['.'], projectRoot) || cmdIf('pyright', [], projectRoot);
    result.lint = cmdIf('ruff', ['check', '.'], projectRoot) || cmdIf('flake8', ['.'], projectRoot);
    result.lintFile = cmdIf('ruff', ['check'], projectRoot) || cmdIf('flake8', [], projectRoot);
    result.format = cmdIf('ruff', ['format'], projectRoot) || cmdIf('black', [], projectRoot);
    try {
      if (fs.existsSync(path.join(projectRoot, 'pyproject.toml'))) {
        const content = fs.readFileSync(path.join(projectRoot, 'pyproject.toml'), 'utf8');
        if (content.includes('pytest')) {
          result.test = cmdIf('pytest', [], projectRoot);
        }
      }
    } catch {}
    result.sourceExtensions = ['.py', '.pyx'];
  }

  // --- PHP / Laravel ---
  if (fs.existsSync(path.join(projectRoot, 'composer.json'))) {
    const vendorBin = path.join(projectRoot, 'vendor', 'bin');

    function vendorCmd(name) {
      const check = (p) => {
        try { return fs.statSync(p).isFile() ? p : null; } catch { return null; }
      };
      if (process.platform === 'win32') {
        for (const ext of ['.bat', '.cmd', '']) {
          const r = check(path.join(vendorBin, name + ext));
          if (r) return r;
        }
        return null;
      }
      return check(path.join(vendorBin, name));
    }

    const phpstanPath = vendorCmd('phpstan');
    if (phpstanPath) {
      result.typecheck = { cmd: phpstanPath, args: ['analyse'] };
    }

    const pintPath = vendorCmd('pint');
    if (pintPath) {
      result.lint = { cmd: pintPath, args: ['--test'] };
      result.lintFile = { cmd: pintPath, args: ['--test'] };
      result.format = { cmd: pintPath, args: [] };
    } else {
      const csFixerPath = vendorCmd('php-cs-fixer');
      if (csFixerPath) {
        result.lint = { cmd: csFixerPath, args: ['fix', '--dry-run', '--diff'] };
        result.lintFile = { cmd: csFixerPath, args: ['fix', '--dry-run', '--diff'] };
        result.format = { cmd: csFixerPath, args: ['fix'] };
      }
    }

    const phpunitPath = vendorCmd('phpunit');
    if (phpunitPath) {
      result.test = { cmd: phpunitPath, args: [] };
    } else if (fs.existsSync(path.join(projectRoot, 'artisan'))) {
      result.test = { cmd: 'php', args: ['artisan', 'test'] };
    }

    result.lockfiles.push('composer.lock');
    result.sourceExtensions = ['.php'];
  }

  // --- Local override ---
  const localPath = path.join(os.homedir(), '.clawback', 'detect-stack.local.js');
  if (fs.existsSync(localPath)) {
    try {
      const localFn = require(localPath);
      if (typeof localFn === 'function') {
        const localResult = localFn(resolvedStart, projectRoot);
        const validated = validateLocalResult(localResult);
        if (validated) {
          Object.assign(result, validated);
        }
      }
    } catch (err) {
      process.stderr.write(`[clawback] detect-stack.local.js error: ${err.message}\n`);
    }
  }

  writeCache(cacheKey, result);
  return result;
}

function validateLocalResult(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const valid = {};

  for (const key of ['typecheck', 'lint', 'lintFile', 'format', 'test']) {
    if (!(key in obj)) continue;
    if (obj[key] === null) {
      valid[key] = null;
      continue;
    }
    if (typeof obj[key] === 'object' && typeof obj[key].cmd === 'string' && Array.isArray(obj[key].args)) {
      valid[key] = obj[key];
    } else {
      process.stderr.write(`[clawback] detect-stack.local.js: invalid "${key}" shape, ignoring\n`);
    }
  }

  if ('lockfiles' in obj) {
    if (Array.isArray(obj.lockfiles) && obj.lockfiles.every(s => typeof s === 'string')) {
      valid.lockfiles = obj.lockfiles;
    } else {
      process.stderr.write(`[clawback] detect-stack.local.js: invalid lockfiles, ignoring\n`);
    }
  }

  if ('sourceExtensions' in obj) {
    if (Array.isArray(obj.sourceExtensions) && obj.sourceExtensions.every(s => typeof s === 'string')) {
      valid.sourceExtensions = obj.sourceExtensions;
    } else {
      process.stderr.write(`[clawback] detect-stack.local.js: invalid sourceExtensions, ignoring\n`);
    }
  }

  if ('pkg_mgr' in obj) {
    if (typeof obj.pkg_mgr === 'string' || obj.pkg_mgr === null) {
      valid.pkg_mgr = obj.pkg_mgr;
    }
  }

  return Object.keys(valid).length > 0 ? valid : null;
}

module.exports = { detectStack, findBinary, walkUpFind, validateLocalResult };
