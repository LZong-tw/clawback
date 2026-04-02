# Clawback Design Spec (v9 — Final)

> Platform-agnostic, language-agnostic Claude Code hooks kit.
> Core philosophy: "Prompts are requests, hooks are guarantees."

## What It Is

A user-level (~/.claude/) hooks kit that enforces "employee-grade" verification loops mechanically via Claude Code hooks, not prompt wishes. Implemented in Node.js with zero external npm dependencies. Works on Windows, macOS, and Linux.

## Two-Layer Architecture

| Layer | Location | Purpose |
|-------|----------|---------|
| Hook layer | `~/.claude/hooks/` | Mechanical enforcement (typecheck, lint, format, file protection, context re-injection) |
| Prompt layer | `~/.claude/CLAUDE.md` + project `CLAUDE.md` | Behavioral guidance (phased execution, plan-vs-build, anti-sprawl, mistake logging) |

## File Structure

```
clawback/
├── package.json
├── install.js
├── uninstall.js
├── lib/
│   ├── detect-stack.js
│   └── exec.js
├── hooks/
│   ├── protect-files.js
│   ├── post-edit.js
│   ├── stop-verify.js
│   ├── post-compact-reinject.js
│   └── notification.js
├── extras/
│   └── guard-read.js
├── templates/
│   ├── CLAUDE.global.md
│   └── CLAUDE.project.md
├── test/
│   ├── helpers.js
│   ├── lib/
│   ├── hooks/
│   └── ...
└── README.md
```

## Component Specifications

### lib/exec.js — Cross-Platform Safe Execution

- `safeExec(cmd, args, options)` — the sole subprocess interface
- Unix: `execFileSync` without shell (zero injection surface)
- Windows: `shell: true` for .cmd shim resolution, args validated against `/[&|<>()!%]/`
- Throws `ClawbackExecError` on unsafe args (never returns mixed types)
- Returns `Buffer` on success (standard execFileSync behavior)
- Default timeout: 15000ms

### lib/detect-stack.js — Stack Detection (Sole Language-Aware Module)

- Walks UP from edited file's directory to find nearest config
- Verifies binary exists via `which`/`where` before returning non-null
- Warns (stderr) if resolved binary is inside project tree
- Returns structured object:

```js
{
  typecheck:        { cmd: string, args: string[] } | null,
  lint:             { cmd: string, args: string[] } | null,   // full-project (stop-verify)
  lintFile:         { cmd: string, args: string[] } | null,   // per-file (post-edit), file arg appended
  format:           { cmd: string, args: string[] } | null,
  test:             { cmd: string, args: string[] } | null,
  pkg_mgr:          string | null,
  lockfiles:        string[],
  sourceExtensions: string[]
}
```

- `lint` = full-project command (may be `npm run lint`), used by stop-verify
- `lintFile` = direct tool command (e.g., `eslint`), file path appended, used by post-edit
- No stack detected -> all null, lockfiles/sourceExtensions empty -> hooks no-op
- Supported stacks: TS/JS, Go, Rust, Python, PHP/Laravel
- Monorepo-aware: checks tsconfig for `references` -> uses `tsc --build --noEmit` (TS 5.2+)
- Cache: 60s TTL, key = SHA-256 of `realpathSync(nearest-config-directory)`, fallback to cwd
- Extensible: `~/.clawback/detect-stack.local.js` loaded first, return merged over built-in, schema-validated

### hooks/protect-files.js — PreToolUse (matcher: `Edit|Write`)

- Checks `tool_input.file_path` from stdin JSON
- Dual-path check: `path.resolve()` AND `fs.realpathSync()` (catches symlinks)
- Own knowledge: `.env` / `.env.*` / `.envrc` (case-insensitive) + `.git` (path segment check)
- Delegated: lockfiles from `detectStack(path.dirname(filePath)).lockfiles`
- Match -> JSON `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "..." } }`

### hooks/post-edit.js — PostToolUse (matcher: `Edit|Write`)

- Extension check: skip if file extension not in `stack.sourceExtensions`
- Format: `safeExec(format.cmd, [...format.args, filePath])` (modifies file)
- Lint: `safeExec(lintFile.cmd, [...lintFile.args, filePath])` (report-only, NO --fix, per-file)
- Returns format diffs + lint errors via `{ additionalContext: "..." }`
- No stack or non-source file -> exit 0
- Note: uses `lintFile` (direct tool), not `lint` (may be npm script runner)

### hooks/stop-verify.js — Stop (no matcher)

- Reads `session_id` from stdin (fallback: `process.pid + Date.now()`)
- Reads `stop_hook_active` from stdin — if true, exit 0 (prevent infinite loop)
- Circuit breaker: counter in `os.tmpdir()/clawback/stop-counter-${sessionId}.json`
  - Atomic write (write temp + rename, try/finally cleanup)
  - 3 consecutive blocks -> allow stop + final warning in additionalContext
  - Reset ONLY on success (zero errors)
- Modified files: `git diff --name-only HEAD` -> `--cached` -> `ls-files --modified` -> null
  - Empty array = no modified files = allow stop
  - null = cannot determine = report all errors
- Typecheck: 60s timeout, output filtered to git-dirty files only (regex parse tsc format)
- Lint: 15s timeout, full-project `lint` command, output filtered to git-dirty files (word-boundary match)
- Errors found -> `{ hookSpecificOutput: { hookEventName: "Stop", decision: "block" } }`

### hooks/post-compact-reinject.js — PostCompact (no matcher)

- Re-injects: git branch, last 5 commits (oneline), staged changes (--stat only)
- Reads `gotchas.md` if exists
- Structured truncation budget: git state 4KB, gotchas 4KB, total 10KB
- `truncateWithSummary(text, limit, label)` — tail truncation with summary line
- Lazy cleanup: deletes `stack-*.json` files >24h in `os.tmpdir()/clawback/` (per-file try/catch)
- Returns via `{ additionalContext: "..." }`

### hooks/notification.js — Notification (no matcher)

- macOS: `osascript` with hardcoded message (no string interpolation of external data)
- Linux: `notify-send` with hardcoded args (fallback: skip)
- Windows: console bell `\x07` (documented limitation)
- All wrapped in try/catch, failures silent
- All notification calls via `safeExec` (invariant #2)

### extras/guard-read.js — PreToolUse Read (opt-in)

- Blocks: `~/.ssh/*`, `~/.aws/*`, `~/.gnupg/*`, `**/*.pem`, `**/*.key`
- Uses `fs.realpathSync()` to resolve symlinks (try/catch, fallback to resolve)
- Installed via `install.js --with-read-guard`

### install.js

- Copies `hooks/*.js` + `lib/*.js` to `~/.claude/hooks/` + `~/.claude/hooks/lib/`
- Deep merges `settings.json` (additive, dedup by command path)
- CLAUDE.md: `<!-- clawback:v1:begin -->` / `<!-- clawback:v1:end -->` section markers
- `--with-read-guard` installs `extras/guard-read.js`
- Writes manifest to `~/.claude/hooks/clawback-manifest.json`
- Idempotent (safe to run multiple times)

### uninstall.js

- Reads manifest, removes files (path-based, no checksum)
- Removes hook entries from settings.json (searches for `clawback` in command path)
- Removes CLAUDE.md section markers and content between them
- Warns on missing files instead of crashing

### templates/CLAUDE.global.md

Behavioral guidance that hooks cannot enforce:
- Phased execution (<=5 files per response)
- Plan != Build separation
- Context decay awareness (re-read after 10+ messages)
- Sub-agent swarming (>5 files -> parallel agents)
- Mistake logging -> gotchas.md
- Edit safety (multi-path search on renames)
- Hook behavior documentation (so Claude knows not to manually run tsc/eslint)

### templates/CLAUDE.project.md

Project override template for edge cases where auto-detection is wrong.

## 15 Design Invariants

1. Zero external npm dependencies (Node.js built-in only)
2. All subprocess calls via `lib/exec.js` (safeExec)
3. All file paths normalized via `path.resolve()` or `fs.realpathSync()`
4. All temp files in `os.tmpdir()/clawback/` subdirectory
5. All `JSON.parse` wrapped in try/catch with permissive fallthrough
6. Zero shell string interpolation
7. Circuit breaker per-session (`session_id` with PID fallback), reset on success only
8. `tsc` only in stop-verify, not per-edit
9. Per-file lint 15s timeout; typecheck 60s timeout
10. CLAUDE.md uses versioned section markers
11. `install.js` is idempotent
12. Hooks are 100% stack-agnostic; `detect-stack.js` is the sole language-aware module
13. All binaries verified to exist before returning non-null commands
14. tsc/lint errors scoped to git-dirty files only
15. Source file extension check before format/lint (non-code files skipped)

## Known Limitations (Documented)

- Bash-based file writes bypass protect-files.js (use Claude Code permission deny rules)
- Symlink TOCTOU: symlink created between check and write can bypass protection
- Windows desktop notifications: console bell only (no toast)
- Anti-sprawl (5 files per response): CLAUDE.md guidance only, hooks lack response-boundary awareness
- Per-edit typecheck deferred to stop-verify for performance
- 60s tsc timeout may be insufficient for very large (100k+ LOC) TypeScript projects
- TypeScript 5.0-5.1 monorepos: `tsc --build --noEmit` not supported, typecheck may silently pass
- Monorepo `tsc --build`: may emit files if `noEmit` not set in tsconfig (TS < 5.2)
