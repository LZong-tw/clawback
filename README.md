# Clawback

Platform-agnostic Claude Code hooks kit for employee-grade verification loops.

> "Prompts are requests, hooks are guarantees."

## What It Does

Installs 5 hooks + 2 library modules to `~/.claude/hooks/` that automatically:

- **Format + lint** your code after every edit (PostToolUse)
- **Block completion** if typecheck/lint errors exist (Stop)
- **Protect** .env, lockfiles, and .git from AI edits (PreToolUse)
- **Re-inject context** after compaction — git state + gotchas.md (PostCompact)
- **Notify** you when Claude needs attention (Notification)

All hooks are 100% stack-agnostic. Language detection is handled by `lib/detect-stack.js`.

## Supported Stacks

| Config File | Typecheck | Lint | Format |
|---|---|---|---|
| `tsconfig.json` | tsc --noEmit | eslint | prettier |
| `go.mod` | go build | go vet | gofmt |
| `Cargo.toml` | cargo check | cargo clippy | cargo fmt |
| `pyproject.toml` | mypy / pyright | ruff / flake8 | ruff / black |
| `composer.json` | phpstan | pint / php-cs-fixer | pint |

No stack detected? Hooks silently no-op.

## Install

```bash
git clone <repo-url> clawback
cd clawback
node install.js
```

With optional read guard (blocks reading ~/.ssh, ~/.aws, ~/.gnupg):

```bash
node install.js --with-read-guard
```

## Uninstall

```bash
node uninstall.js
```

## Adding Custom Stacks

Create `~/.clawback/detect-stack.local.js`:

```js
module.exports = function(startDir, projectRoot) {
  const fs = require('fs');
  const path = require('path');
  if (fs.existsSync(path.join(projectRoot, 'build.gradle'))) {
    return {
      lint: { cmd: 'checkstyle', args: ['-c', '/google_checks.xml'] },
      sourceExtensions: ['.java', '.kt'],
      lockfiles: ['gradle.lockfile'],
    };
  }
  return null;
};
```

## Known Limitations

- **Bash bypass:** File writes via Bash (`echo > .env`) bypass protect-files.js.
  Use Claude Code's permission deny rules for shell command safety.
- **Windows notifications:** Console bell only. No desktop toast.
- **Anti-sprawl:** The "max 5 files per response" rule is in CLAUDE.md (advisory),
  not enforced by hooks (no response-boundary awareness in hook API).
- **Large TypeScript projects:** tsc timeout is 60s. Projects >100k LOC may timeout.
- **Symlink TOCTOU:** Symlinks created between check and write can bypass protection.

## Architecture

```
~/.claude/hooks/
├── lib/
│   ├── detect-stack.js    ← sole language-aware module
│   └── exec.js            ← cross-platform subprocess helper
├── protect-files.js       ← PreToolUse (Edit|Write)
├── post-edit.js           ← PostToolUse (Edit|Write)
├── stop-verify.js         ← Stop
├── post-compact-reinject.js ← PostCompact
├── notification.js        ← Notification
└── clawback-manifest.json ← install tracking
```

## Testing

```bash
npm test
```

## License

MIT
