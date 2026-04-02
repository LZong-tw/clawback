# Clawback

**Give Claude Code the verification loops Anthropic reserves for their own engineers.**

[![Tests](https://img.shields.io/badge/tests-39%20passing-brightgreen)](#testing)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue)](#)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](#license)

---

## The Story

On March 31, 2026, [Claude Code's source map leaked via npm](https://thehackernews.com/2026/04/claude-code-tleaked-via-npm-packaging.html). Inside 512,000 lines of code, the community discovered something interesting: **employee-only verification loops** gated behind `USER_TYPE === 'ant'`.

Anthropic engineers get a Claude that checks whether generated code actually compiles before claiming it's done. The rest of us get a Claude that says "Done!" and hopes for the best.

**Clawback takes those patterns back.** Not by hacking flags or bypassing auth -- but by implementing the same behavioral guarantees through Claude Code's public hooks API.

> *"Prompts are requests, hooks are guarantees."*

## What It Does

One `node install.js` and your Claude Code gets 5 hooks that fire automatically:

| Hook | Event | What It Does |
|------|-------|--------------|
| **protect-files** | PreToolUse | Blocks edits to `.env`, lockfiles, `.git/` -- before Claude touches them |
| **post-edit** | PostToolUse | Formats your code, then lints it (report-only) -- after every edit |
| **stop-verify** | Stop | Runs full typecheck + lint -- Claude can't say "Done!" until it passes |
| **post-compact** | PostCompact | Re-injects git state + `gotchas.md` after context compaction |
| **notification** | Notification | Desktop notification when Claude needs your attention |

Plus a behavioral CLAUDE.md that handles what hooks can't: phased execution, anti-sprawl limits, mistake logging.

### The Stop Gate

This is the core feature. When Claude tries to complete a task:

```
Claude: "Done! I've implemented the feature."
  └→ stop-verify.js fires
       ├→ tsc --noEmit (60s timeout)
       ├→ eslint (15s timeout)
       ├→ errors scoped to files YOU changed (not pre-existing debt)
       └→ errors found? → BLOCKED. "Fix these first."
           └→ 3 consecutive blocks? → circuit breaker allows stop + final warning
```

No more "the code compiles in my imagination."

## Zero Config, Any Stack

Clawback auto-detects your project. You don't configure anything.

| Detected via | Typecheck | Lint | Format |
|---|---|---|---|
| `tsconfig.json` | `tsc --noEmit` | `eslint` | `prettier` |
| `go.mod` | `go build` | `go vet` | `gofmt` |
| `Cargo.toml` | `cargo check` | `cargo clippy` | `cargo fmt` |
| `pyproject.toml` | `mypy` / `pyright` | `ruff` / `flake8` | `ruff` / `black` |
| `composer.json` | `phpstan` | `pint` / `php-cs-fixer` | `pint` |

**No config file found?** Hooks silently no-op. No errors, no noise.

**Monorepo?** Walk-up detection finds the nearest config from the edited file's directory. Different sub-projects use different tools automatically.

**Your stack not listed?** [Extend it](#adding-custom-stacks) without forking.

## Install

```bash
git clone https://github.com/LZong-tw/clawback.git
cd clawback
node install.js
```

That's it. Open Claude Code, type `/hooks` to verify.

### Options

```bash
node install.js --with-read-guard    # Also block reading ~/.ssh, ~/.aws, ~/.gnupg
```

### What it installs

- 5 hook scripts + 2 lib modules to `~/.claude/hooks/`
- Merges hook config into `~/.claude/settings.json` (preserves your existing hooks)
- Appends behavioral guidance to `~/.claude/CLAUDE.md` (preserves your existing rules)

### Uninstall

```bash
cd clawback
node uninstall.js    # Clean removal, restores your original settings
```

## Design Principles

**Hooks are 100% stack-agnostic.** Every hook delegates to `detect-stack.js` -- the single file that knows about languages. Adding Java support means editing one file, not five.

**Zero external dependencies.** Node.js built-in modules only. No `node_modules`, no supply chain risk, no version conflicts.

**Cross-platform.** Windows (Git Bash / MINGW64), macOS, Linux. Path handling via `path.join()`, subprocess safety via platform-aware `exec.js`.

**Idempotent.** Run `node install.js` ten times. You get one set of hooks, not ten duplicates.

**Safe to remove.** `node uninstall.js` reverses everything. Your settings go back to how they were.

## Adding Custom Stacks

Create `~/.clawback/detect-stack.local.js`:

```js
module.exports = function(startDir, projectRoot) {
  const fs = require('fs');
  const path = require('path');

  if (fs.existsSync(path.join(projectRoot, 'build.gradle'))) {
    return {
      typecheck: { cmd: 'javac', args: ['-d', '/tmp/clawback/classes'] },
      lint: { cmd: 'checkstyle', args: ['-c', '/google_checks.xml'] },
      lintFile: { cmd: 'checkstyle', args: ['-c', '/google_checks.xml'] },
      sourceExtensions: ['.java', '.kt'],
      lockfiles: ['gradle.lockfile'],
    };
  }
  return null;
};
```

Your local overrides take priority over built-in detection.

## Architecture

```
~/.claude/hooks/
├── lib/
│   ├── detect-stack.js         ← sole language-aware module
│   └── exec.js                 ← cross-platform safe subprocess
├── protect-files.js            ← PreToolUse (Edit|Write)
├── post-edit.js                ← PostToolUse (Edit|Write)
├── stop-verify.js              ← Stop (circuit breaker)
├── post-compact-reinject.js    ← PostCompact
├── notification.js             ← Notification
└── clawback-manifest.json      ← tracks what was installed
```

### How the Two Layers Work

```
┌─────────────────────────────────────────────────────┐
│  CLAUDE.md (behavioral guidance)                    │
│  "Don't touch >5 files per response"                │
│  "Re-read files after 10+ messages"                 │
│  "Log mistakes to gotchas.md"                       │
│  → Claude follows these. Usually. Hopefully.        │
├─────────────────────────────────────────────────────┤
│  Hooks (mechanical enforcement)                     │
│  protect-files.js → BLOCKED. Period.                │
│  stop-verify.js   → tsc fails? Can't stop. Period.  │
│  post-edit.js     → Formatted. Linted. Every time.  │
│  → These fire whether Claude wants them to or not.  │
└─────────────────────────────────────────────────────┘
```

## Known Limitations

We believe in documenting what doesn't work, not hiding it.

- **Bash bypass:** `echo secret > .env` via Bash bypasses protect-files. Use Claude Code's built-in [permission deny rules](https://code.claude.com/docs/en/hooks-guide) for shell safety.
- **Windows notifications:** Console bell only. No desktop toast. (PRs welcome.)
- **Anti-sprawl:** "Max 5 files per response" is CLAUDE.md guidance, not a hook. The hooks API has no concept of response boundaries.
- **Large TypeScript:** `tsc` timeout is 60s. Projects over 100k LOC may need incremental builds.
- **TS 5.0-5.1 monorepos:** `tsc --build --noEmit` not supported in these versions. Upgrade to 5.2+.

## Testing

```bash
npm test    # 39 tests, zero dependencies
```

## Reviewed to Death

This project went through **9 rounds of adversarial design review** before a single line of code was written. The implementation plan was then reviewed through **4 more rounds** of code-level attack. Every finding was fixed. The final review returned: *"No further issues."*

[Full design spec](docs/superpowers/specs/2026-04-02-clawback-design.md) | [Implementation plan](docs/superpowers/plans/2026-04-02-clawback.md)

## Related

- **[claude-code-showcase](https://github.com/LZong-tw/claude-code-showcase)** -- Comprehensive Claude Code project configuration example with hooks, skills, agents, and workflows
- **[production-verify](https://github.com/LZong-tw/production-verify)** -- Production verification framework (smoke tests + architecture proofs)
- **[Claude Code Hooks Guide](https://code.claude.com/docs/en/hooks-guide)** -- Official hooks documentation

## Contributing

PRs welcome. The architecture is designed for contribution:

- **New language support?** Edit `lib/detect-stack.js` only. No hook changes needed.
- **New hook?** Add to `hooks/`, register in `install.js`. Existing hooks untouched.
- **Bug fix?** 39 tests protect you from regressions.

## Author

**[LZong](https://github.com/LZong-tw)** -- DevOps engineer. Building tools that make AI coding actually reliable.

## License

MIT
