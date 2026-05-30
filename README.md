# Clawback

**Stop your AI coding agent from saying "Done" until your code actually typechecks and lints.**

Mechanical verification hooks for **Claude Code** and **Codex** — zero dependencies, auto-detects your stack, cross-platform.

[![Tests](https://img.shields.io/badge/tests-59%20passing-brightgreen)](#testing)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-blue)](#)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](#license)

> *Prompts are requests. Hooks are guarantees.*

---

## See it

Your agent finishes a task. Before it's allowed to stop, the Stop gate runs:

```
Claude: "Done! I've implemented the feature."
  └→ stop-verify fires
       ├→ tsc --noEmit (60s timeout)
       ├→ eslint (15s timeout)
       ├→ errors scoped to the files YOU changed (not pre-existing debt)
       └→ errors found? → BLOCKED. "Fix these first."
           └→ 3 consecutive blocks? → circuit breaker allows stop + final warning
```

**Before Clawback:** the agent says "Done!", you discover the type error.
**With Clawback:** "Done!" → blocked → fixed → *actually* done.

No more "the code compiles in my imagination."

## Install

```bash
npx @lzong.tw/clawback
```

That's it. Open Claude Code and type `/hooks` to verify. Add `--with-codex` to install the same guardrails into Codex.

```bash
# keep it around as a global binary instead
npm install -g @lzong.tw/clawback && clawback
```

```bash
# or from source
git clone https://github.com/LZong-tw/clawback.git && cd clawback && node install.cjs
```

## What you get

One install wires up hooks that fire automatically — whether the agent wants them to or not.

| Hook | Event | What it does |
|------|-------|--------------|
| **protect-files** | PreToolUse | Blocks edits to `.env`, lockfiles, `.git/` — before the agent touches them |
| **post-edit** | PostToolUse | Formats your code, then lints it (report-only) — after every edit |
| **stop-verify** | Stop | Runs full typecheck + lint — the agent can't say "Done!" until it passes |
| **post-compact** | SessionStart | Re-injects git state + `gotchas.md` on every session start, including after compaction (Codex: PostCompact) |
| **notification** | Notification | Desktop notification when the agent needs your attention |

Plus a behavioral `CLAUDE.md` that handles what hooks can't: phased execution, anti-sprawl limits, mistake logging.

Optional extras at install time: `--with-read-guard` blocks reads of common credential directories, `--strict-infra` also blocks edits under `.husky/` and `.github/workflows/`, and `--with-ui-guard` adds TSX-specific UI anti-pattern warnings after edits.

## Zero config, any stack

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

## How the two layers work

```
┌─────────────────────────────────────────────────────┐
│  CLAUDE.md (behavioral guidance)                    │
│  "Don't touch >5 files per response"                │
│  "Re-read files after 10+ messages"                 │
│  "Log mistakes to gotchas.md"                        │
│  → Claude follows these. Usually. Hopefully.        │
├─────────────────────────────────────────────────────┤
│  Hooks (mechanical enforcement)                     │
│  protect-files  → BLOCKED. Period.                   │
│  stop-verify    → tsc fails? Can't stop. Period.     │
│  post-edit      → Formatted. Linted. Every time.     │
│  → These fire whether Claude wants them to or not.  │
└─────────────────────────────────────────────────────┘
```

The prompt layer asks. The hook layer enforces. Clawback is mostly the second one.

## Failure modes & limits

We document what doesn't work instead of hiding it.

- **Bash bypass:** `echo secret > .env` via Bash bypasses protect-files. Use Claude Code's built-in [permission deny rules](https://code.claude.com/docs/en/hooks-guide) for shell safety.
- **Strict infra is opt-in:** `.husky/` and `.github/workflows/` are only blocked with `--strict-infra` (or `CLAWBACK_STRICT_INFRA_PROTECTION=1`).
- **UI guard is heuristic:** `--with-ui-guard` emits context for common TSX layout/input mistakes, not a formal compiler check.
- **Windows notifications:** Console bell only. No desktop toast. (PRs welcome.)
- **Anti-sprawl:** "Max 5 files per response" is CLAUDE.md guidance, not a hook. The hooks API has no concept of response boundaries.
- **Large TypeScript:** `tsc` timeout is 60s. Projects over 100k LOC may need incremental builds.
- **TS 5.0–5.1 monorepos:** `tsc --build --noEmit` is unsupported in those versions. Upgrade to 5.2+.

## Why this exists

On March 31, 2026, [Claude Code's source map leaked via npm](https://thehackernews.com/2026/04/claude-code-tleaked-via-npm-packaging.html). Inside, the community found **employee-only verification loops** gated behind `USER_TYPE === 'ant'` — Anthropic engineers got a Claude that checks whether generated code actually compiles before claiming it's done; everyone else got "Done!" and hope.

That leak was the prompt, not the point. The point is that *every* coding agent should refuse to call a task finished until the machine has verified it. Clawback implements that guarantee through Claude Code's and Codex's public hooks API — no flags, no auth bypass, no patched binary.

## Design principles

**Hooks are 100% stack-agnostic.** Every hook delegates to `detect-stack.cjs` — the single file that knows about languages. Adding Java support means editing one file, not five.

**Zero external dependencies.** Node.js built-ins only. No `node_modules`, no supply chain risk, no version conflicts.

**Cross-platform.** Windows (Git Bash / MINGW64), macOS, Linux. Path handling via `path.join()`, subprocess safety via platform-aware `exec.cjs`.

**Shell-safe hook commands.** Installed commands use `node "absolute/path"` rather than POSIX env-prefixes or single-quoted Windows paths, so the same command shape works in `cmd.exe`, PowerShell, and POSIX shells.

**Idempotent.** Run the installer ten times. You get one set of hooks, not ten duplicates.

**Safe to remove.** Uninstall reverses everything; your settings go back to how they were.

## Install options & uninstall

```bash
npx @lzong.tw/clawback --with-read-guard    # also block reading ~/.ssh, ~/.aws, ~/.gnupg
npx @lzong.tw/clawback --strict-infra       # also block edits to .husky/ and .github/workflows/
npx @lzong.tw/clawback --with-ui-guard      # also warn on common TSX UI anti-patterns
npx @lzong.tw/clawback --with-codex         # also install ~/.codex/hooks.json + ~/.codex/hooks/
```

**What it installs:** hook scripts + lib modules to `~/.claude/hooks/`, merges hook config into `~/.claude/settings.json` (preserving your existing hooks), and appends behavioral guidance to `~/.claude/CLAUDE.md` (preserving your existing rules). With `--with-codex`, it copies the same hooks to `~/.codex/hooks/`, merges `~/.codex/hooks.json`, and installs `verify-global-hooks.cjs` to regression-test `cmd.exe` / PowerShell / POSIX command quoting and the reinject hook's output. On Claude Code the reinject hook runs on `SessionStart`; on Codex it runs on `PostCompact`.

```bash
npx -p @lzong.tw/clawback clawback-uninstall    # if you installed via npx
clawback-uninstall                              # if you installed globally
node uninstall.cjs                              # if you installed from source
```

Any of these restores your original settings cleanly.

## Adding custom stacks

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
│   ├── detect-stack.cjs        ← sole language-aware module
│   └── exec.cjs                ← cross-platform safe subprocess
├── protect-files.cjs           ← PreToolUse (Edit|Write)
├── post-edit.cjs               ← PostToolUse (Edit|Write)
├── stop-verify.cjs             ← Stop (circuit breaker)
├── post-compact-reinject.cjs   ← SessionStart (Claude) / PostCompact (Codex)
├── notification.cjs            ← Notification
├── guard-read.cjs              ← optional PreToolUse (Read)
├── ui-antipattern-check.mjs    ← optional PostToolUse (Edit|Write)
└── clawback-manifest.json      ← tracks what was installed
```

## Testing

```bash
npm test    # 59 tests, zero dependencies
```

For Codex installs, the generated global hook file can also be checked directly:

```bash
node ~/.codex/hooks/verify-global-hooks.cjs
```

## Reviewed to death

This project went through **9 rounds of adversarial design review** before a single line of code was written, then **4 more rounds** of code-level attack on the implementation plan. Every finding was fixed. The final review returned: *"No further issues."*

[Full design spec](docs/superpowers/specs/2026-04-02-clawback-design.md) | [Implementation plan](docs/superpowers/plans/2026-04-02-clawback.md)

## Related

- **[production-verify](https://github.com/LZong-tw/production-verify)** — Production verification framework (smoke tests + architecture proofs)
- **[Claude Code Hooks Guide](https://code.claude.com/docs/en/hooks-guide)** — Official hooks documentation

## Contributing

PRs welcome. The architecture is designed for contribution:

- **New language support?** Edit `lib/detect-stack.cjs` only. No hook changes needed.
- **New hook?** Add to `hooks/`, register in `install.cjs`. Existing hooks untouched.
- **Bug fix?** 59 tests protect you from regressions.

## Author

**[LZong](https://github.com/LZong-tw)** — DevOps engineer. Building tools that make AI coding actually reliable.

## License

MIT
