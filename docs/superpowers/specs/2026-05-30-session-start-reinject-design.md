# Session-start context reinjection — design

Date: 2026-05-30
Status: Approved (brainstorming), pending implementation plan
Related: stop-gate schema fix (same hook-output-schema class of bug)

## Problem

Clawback advertises that it "re-injects git state + `gotchas.md` after context compaction, so
lessons persist" (see `templates/CLAUDE.global.md` and `README.md`). The hook
`hooks/post-compact-reinject.cjs` is wired **only** to the `PostCompact` event for Claude Code
(`install.cjs` `buildHooksConfig`, the `PostCompact` entry).

Verified against the official Claude Code hooks docs (https://code.claude.com/docs/en/hooks):

- `PostCompact` has **no decision control** and **does not support `additionalContext`** — it is
  side-effect/cleanup only. So on Claude Code the hook's injected context is silently dropped: the
  flagship "lessons persist" behavior is a no-op.
- `PreCompact` likewise does not support `additionalContext`.
- `SessionStart` **does** support `additionalContext` injection
  (`{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "..." } }`,
  and plain stdout also reaches the model for this event). It fires with a `source` field of
  `startup` | `resume` | `clear` | `compact`, and **fires with `source: "compact"` after a
  compaction**. Entries can be matched on `source`.

So the correct Claude Code mechanism is `SessionStart`, not `PostCompact`.

Codex is different: the recent commit "fix: emit Codex-compatible PostCompact output" indicates
Codex's `PostCompact` **does** consume this output shape. Clawback installs the same
`buildHooksConfig` map to `~/.codex/hooks.json` (`install.cjs`, the `installCodex` branch), so the
two platforms currently share one event map but behave oppositely on `PostCompact`.

## Decisions (from brainstorming)

1. **Injection timing — all session boundaries.** Reinject git state + `gotchas.md` on every
   `SessionStart` (`compact`, `startup`, `resume`, `clear`), not only after compaction. Rationale:
   the goal is for `gotchas.md` lessons to persist; `gotchas.md` is not part of `CLAUDE.md`, so it
   is otherwise absent at session start. Cost: one bounded (≤10KB) injection per session start.

2. **Platform split — each platform uses the event it actually honors (Approach A).**
   - Claude Code → `SessionStart` (no matcher = all sources).
   - Codex → keep `PostCompact`.
   Rationale: matches Clawback's existing per-platform option pattern (`includeNotification: false`
   for Codex); keeps the hook code essentially unchanged; does not bet on Codex capabilities we have
   not verified.

3. **Keep the hook filename** `post-compact-reinject.cjs`. Renaming would churn `install.cjs`
   (`FILES`, `HOOK_NAMES`), the manifest, tests, `verify-global-hooks.cjs`, README, and docs for
   low value. The name is now slightly broader than literal; acceptable.

## Design

### Wiring — `install.cjs` / `buildHooksConfig` (the core change)

Add a per-platform option (mirroring `includeNotification`), e.g. `useSessionStartReinject`,
defaulting to `true`.

- Claude Code call (default): emit a `SessionStart` entry instead of `PostCompact`:
  ```js
  SessionStart: [
    { hooks: [{ type: 'command', command: nodeCmd('post-compact-reinject.cjs') }] },
  ]
  ```
  No `matcher` → matches all sources (`startup|resume|clear|compact`).
- Codex call: pass `useSessionStartReinject: false` → keep the existing `PostCompact` entry.

`isClawbackHook` / `HOOK_NAMES` already match by hook filename, so detection and uninstall keep
working for whichever event the entry lives under. Confirm `mergeSettings` cleanly handles the new
`SessionStart` key (it iterates events generically, so it should).

### Hook code — `hooks/post-compact-reinject.cjs` (minimal/no change)

The hook is already event-agnostic: it emits
`{ hookSpecificOutput: { hookEventName: input.hook_event_name || 'PostCompact', additionalContext } }`.
Invoked under `SessionStart`, `input.hook_event_name` is `"SessionStart"`, producing the correct
shape. `cleanupStaleCache()` remains a valid side effect on this path.

Implementation checks:
- Confirm Claude Code's `SessionStart` payload provides `cwd` (or that `CLAUDE_PROJECT_DIR` is set);
  the hook resolves `cwd = CLAUDE_PROJECT_DIR || input.cwd || process.cwd()`.
- No behavioral change for the Codex/`PostCompact` path.

### Tests + real-install verification (addresses the "silent failure" root cause)

- `test/hooks/post-compact-reinject.test.js`: add a `SessionStart` case asserting
  `output.hookSpecificOutput.hookEventName === 'SessionStart'` and a non-empty `additionalContext`;
  keep the existing `PostCompact` case (Codex).
- `hooks/verify-global-hooks.cjs`: `smokePostCompact` currently asserts `hookEventName ===
  'PostCompact'`. Update so the global-install smoke validates the Claude `SessionStart` path (and
  retains a Codex `PostCompact` check), so a real install is verified end-to-end rather than
  asserting a no-op shape.
- `test/install.test.js`: assert the Claude install produces `settings.hooks.SessionStart` wired to
  the reinject hook, and the Codex install produces `PostCompact`.

### Docs

- `README.md` (hook table ~line 33, "Codex-compatible PostCompact" ~line 127, structure diagram
  ~line 189): describe Claude Code reinjection as `SessionStart` (all sources, incl. post-compaction)
  and Codex as `PostCompact`.
- `templates/CLAUDE.global.md` (~line 54): reword "The PostCompact hook re-injects gotchas.md after
  context compaction" → "re-injects on session start (including after compaction)".

## Verification strategy

The original defect was a *silent* no-op. Verification bar for this change:
1. Unit: the hook emits the correct `SessionStart` schema (asserted directly).
2. Install: `test/install.test.js` confirms the wiring lands on `SessionStart` (Claude) / `PostCompact`
   (Codex).
3. Real install: `verify-global-hooks.cjs` smoke-runs the installed hook for the Claude
   `SessionStart` path and checks a valid injection shape comes back.

## Risks / assumptions

- **Codex SessionStart support unverified.** Approach A avoids depending on it (Codex stays on
  `PostCompact`). Consequence: Codex reinjects only after compaction, not at startup/resume/clear.
  Revisit only if Codex symmetry is wanted and Codex's event model is confirmed.
- **SessionStart cwd availability** must be confirmed at implementation (above).
- **Per-session token cost**: injection now runs on every session start, bounded by the existing
  `BUDGET.total` (10KB) cap.

## Out of scope

- `hooks/post-edit.cjs` (PostToolUse) emits top-level `additionalContext` instead of nesting it in
  `hookSpecificOutput` — a separate, simpler schema bug, tracked independently.
- Renaming the hook file.
- Codex event-model expansion for session-start symmetry.

## Affected files

- `install.cjs` (wiring + per-platform option)
- `hooks/post-compact-reinject.cjs` (verify-only; likely comment/no logic change)
- `hooks/verify-global-hooks.cjs` (smoke test)
- `test/hooks/post-compact-reinject.test.js`
- `test/install.test.js`
- `README.md`
- `templates/CLAUDE.global.md`
