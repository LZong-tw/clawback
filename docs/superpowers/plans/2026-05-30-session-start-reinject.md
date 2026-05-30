# Session-start Context Reinjection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Clawback's git-state + `gotchas.md` reinjection to an event that actually injects context — `SessionStart` on Claude Code (all sources), keeping `PostCompact` on Codex.

**Architecture:** The reinject hook (`hooks/post-compact-reinject.cjs`) is already event-agnostic — it echoes `input.hook_event_name` into `hookSpecificOutput.hookEventName`. The only defect is the wiring in `install.cjs`, which registers it under `PostCompact` (a no-op for injection on Claude Code). We add a per-platform `useSessionStartReinject` option to `buildHooksConfig` (mirroring the existing `includeNotification` option): Claude Code gets `SessionStart` (no matcher = all sources), Codex passes `false` to keep `PostCompact`. Tests lock both the wiring and the emitted shape.

**Tech Stack:** Node.js (CommonJS `.cjs`), `node:test` runner, no external deps.

> **Commit note:** This repo's owner commits only on explicit request. Commit steps are included per TDD convention; when executing, confirm before each `git commit`.

---

### Task 1: Migrate reinject wiring — Claude Code → SessionStart, Codex stays PostCompact

**Files:**
- Modify: `install.cjs:35-67` (`buildHooksConfig`) and `install.cjs:274-277` (Codex call)
- Test: `test/install.test.js:42` (Claude assertion) and `test/install.test.js:114-133` (Codex assertion)

- [ ] **Step 1: Update the failing tests in `test/install.test.js`**

Replace the Claude-side assertion (currently `assert.ok(settings.hooks.PostCompact);` at line 42) with:

```js
    assert.ok(settings.hooks.SessionStart);
    // Reinject must be wired to SessionStart — PostCompact cannot inject on Claude Code.
    const sessionStartCommands = settings.hooks.SessionStart
      .flatMap(entry => entry.hooks || [])
      .map(hook => hook.command);
    assert.ok(sessionStartCommands.some(c => c.includes('post-compact-reinject.cjs')));
    assert.equal(settings.hooks.PostCompact, undefined);
```

In the `installs Codex hooks with shell-safe quoted commands` test, add after line 129
(`assert.ok(commands.some(command => command.includes('ui-antipattern-check.mjs')));`):

```js
    assert.ok(commands.some(command => command.includes('post-compact-reinject.cjs')));
    assert.ok(codexHooks.hooks.PostCompact, 'Codex keeps PostCompact for reinject');
    assert.equal(codexHooks.hooks.SessionStart, undefined, 'Codex install does not add SessionStart');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/install.test.js`
Expected: FAIL — `installs all hooks...` fails because `settings.hooks.SessionStart` is `undefined` (install still wires `PostCompact`).

- [ ] **Step 3: Edit `buildHooksConfig` in `install.cjs`**

Replace lines 41-67 (from `const protectArgs` through the closing `};` of the `config` object) with:

```js
  const protectArgs = options.strictInfra ? ['--strict-infra'] : [];
  const includeNotification = options.includeNotification !== false;
  // Claude Code's PostCompact is side-effect-only (no additionalContext), so the
  // context reinject hook must run on SessionStart, which fires on every session
  // start including after compaction and DOES support additionalContext. Codex's
  // PostCompact consumes the injected output, so Codex passes
  // useSessionStartReinject:false to keep PostCompact.
  const useSessionStartReinject = options.useSessionStartReinject !== false;

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
  };

  // Reinject git state + gotchas.md. SessionStart (no matcher) covers all
  // sources: startup | resume | clear | compact.
  const reinjectEntry = { hooks: [{ type: 'command', command: nodeCmd('post-compact-reinject.cjs') }] };
  if (useSessionStartReinject) {
    config.SessionStart = [reinjectEntry];
  } else {
    config.PostCompact = [reinjectEntry];
  }
```

Then update the Codex call (lines 274-277) to pass the flag:

```js
    const codexHooksConfig = buildHooksConfig(codexHooksDir, extras, {
      strictInfra: Boolean(options.strictInfra),
      includeNotification: false,
      useSessionStartReinject: false,
    });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/install.test.js`
Expected: PASS (all install tests green, including the Codex `PostCompact` assertion).

- [ ] **Step 5: Commit**

```bash
git add install.cjs test/install.test.js
git commit -m "fix: wire context reinject to SessionStart on Claude Code (PostCompact can't inject)"
```

---

### Task 2: Lock the SessionStart output shape (unit regression)

**Files:**
- Test: `test/hooks/post-compact-reinject.test.js` (add a case alongside the existing PostCompact case)

Note: the hook is already event-agnostic, so this test passes immediately. Its purpose is to lock
the SessionStart shape so a future refactor cannot silently break injection (the original failure
mode was a silent no-op).

- [ ] **Step 1: Add the SessionStart test**

Append this `it(...)` block inside the `describe('post-compact-reinject', ...)` block (after the
existing `emits hook-specific PostCompact context output` test, before the closing `});`):

```js
  it('emits SessionStart context output (all-source reinjection)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawback-test-'));
    try {
      execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(tmpDir, 'gotchas.md'), '- keep the lesson\n');

      const { exitCode, stdout } = runHook('hooks/post-compact-reinject.cjs', {
        hook_event_name: 'SessionStart',
        source: 'compact',
        cwd: tmpDir,
      }, { CLAUDE_PROJECT_DIR: tmpDir });

      assert.equal(exitCode, 0);
      const output = parseHookOutput(stdout);
      assert.equal(output?.hookSpecificOutput?.hookEventName, 'SessionStart');
      assert.match(output?.hookSpecificOutput?.additionalContext || '', /\[GOTCHAS/);
      assert.equal(output?.additionalContext, undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `node --test test/hooks/post-compact-reinject.test.js`
Expected: PASS (3 existing + 1 new = all green).

- [ ] **Step 3: Commit**

```bash
git add test/hooks/post-compact-reinject.test.js
git commit -m "test: lock SessionStart reinject output shape"
```

---

### Task 3: Extend the global-hooks smoke to validate the SessionStart shape

**Files:**
- Modify: `hooks/verify-global-hooks.cjs:73-123` (`smokePostCompact`) and `:173-175` (call site)

The verifier ships with the Codex install (which keeps `PostCompact`), but the reinject hook is
event-agnostic. Smoke it under BOTH events so a real install proves the hook emits a valid injection
shape for `SessionStart` and `PostCompact`.

- [ ] **Step 1: Generalize `smokePostCompact` to take an event name**

Replace the function signature line and the input/assertion lines inside it. Change the declaration
`function smokePostCompact(command) {` to:

```js
function smokeReinject(command, eventName) {
```

Inside that function, change the input object's event name from the hardcoded
`hook_event_name: 'PostCompact',` to:

```js
      hook_event_name: eventName,
```

And change the final shape assertion (currently checking `hookEventName !== 'PostCompact'`) to:

```js
    const output = parsed.hookSpecificOutput;
    if (output?.hookEventName !== eventName || typeof output.additionalContext !== 'string') {
      fail(`${eventName} smoke must emit hookSpecificOutput with hookEventName=${eventName} and additionalContext`);
    }
```

Also update the two earlier `fail(...)` strings in that function that mention "PostCompact smoke"
to use a generic label, e.g. replace `PostCompact smoke` with `${eventName} smoke` in the
`cannot initialize temp git repo`, `exited`, `produced no JSON output`, and `produced invalid JSON`
messages, and update the temp-dir prefix `clawback-postcompact-` to `clawback-reinject-`.

- [ ] **Step 2: Update the call site**

Replace lines 173-175:

```js
  if (command.includes('post-compact-reinject')) {
    smokePostCompact(command);
  }
```

with:

```js
  if (command.includes('post-compact-reinject')) {
    smokeReinject(command, 'PostCompact');
    smokeReinject(command, 'SessionStart');
  }
```

- [ ] **Step 3: Verify the file parses and the existing install smoke still passes**

Run: `node --check hooks/verify-global-hooks.cjs`
Expected: no output (valid syntax).

Run: `node --test test/install.test.js`
Expected: PASS — the `keeps existing Codex hooks...` and `installs Codex hooks...` tests run the
verifier end-to-end and must stay green.

- [ ] **Step 4: Commit**

```bash
git add hooks/verify-global-hooks.cjs
git commit -m "test: smoke reinject hook under both SessionStart and PostCompact"
```

---

### Task 4: Update documentation

**Files:**
- Modify: `README.md:33`, `README.md:127`, `README.md:189`
- Modify: `templates/CLAUDE.global.md:54-55`

- [ ] **Step 1: Update the README hook table (line 33)**

Replace:

```markdown
| **post-compact** | PostCompact | Re-injects git state + `gotchas.md` after context compaction |
```

with:

```markdown
| **post-compact** | SessionStart | Re-injects git state + `gotchas.md` on every session start, including after compaction (Codex: PostCompact) |
```

- [ ] **Step 2: Update the Codex install note (line 124-127)**

Replace the clause `and Codex-compatible \`PostCompact\` JSON output.` (line 127) with:

```markdown
  and the reinject hook's injection output. On Claude Code the reinject hook runs on `SessionStart`;
  on Codex it runs on `PostCompact`.
```

- [ ] **Step 3: Update the structure diagram (line 189)**

Replace:

```
├── post-compact-reinject.cjs   ← PostCompact
```

with:

```
├── post-compact-reinject.cjs   ← SessionStart (Claude) / PostCompact (Codex)
```

- [ ] **Step 4: Update the behavioral template (lines 54-55)**

Replace:

```markdown
After ANY correction from the user, log the pattern to gotchas.md. The PostCompact
hook re-injects gotchas.md after context compaction, so lessons persist.
```

with:

```markdown
After ANY correction from the user, log the pattern to gotchas.md. The reinject hook
re-injects gotchas.md on session start (including after compaction), so lessons persist.
```

- [ ] **Step 5: Commit**

```bash
git add README.md templates/CLAUDE.global.md
git commit -m "docs: describe reinject as SessionStart (Claude) / PostCompact (Codex)"
```

---

### Task 5: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the complete real test suite**

Run: `node --test test/*.test.js test/hooks/*.test.js test/lib/*.test.js test/extras/*.test.js`
Expected: PASS — all suites green, fail 0. (Do NOT use bare `node --test`: it auto-discovers
`test/fixtures/*.js` and reports them as failures.)

- [ ] **Step 2: Sanity-check a Claude install into a throwaway HOME**

Run:
```bash
node -e "const os=require('os'),fs=require('fs'),path=require('path');const h=fs.mkdtempSync(path.join(os.tmpdir(),'cb-'));require('./install.cjs').install({home:h});const s=JSON.parse(fs.readFileSync(path.join(h,'.claude','settings.json')));console.log('SessionStart:',!!s.hooks.SessionStart,'PostCompact:',!!s.hooks.PostCompact);fs.rmSync(h,{recursive:true,force:true});"
```
Expected: `SessionStart: true PostCompact: false`

- [ ] **Step 3: Final commit (if any uncommitted verification artifacts)**

```bash
git status
```
Expected: clean tree (all changes already committed in Tasks 1-4).

---

## Self-review

**Spec coverage** (against `docs/superpowers/specs/2026-05-30-session-start-reinject-design.md`):
- Wiring (SessionStart Claude / PostCompact Codex, per-platform option) → Task 1.
- Hook code unchanged + cwd note → no code change needed; SessionStart shape locked in Task 2.
- Tests: unit SessionStart case → Task 2; install wiring (both platforms) → Task 1; verify-global-hooks
  smoke → Task 3.
- Docs (README ×3, CLAUDE.global.md) → Task 4.
- All-sources injection (no matcher) → Task 1 Step 3 (`config.SessionStart = [reinjectEntry]`, no matcher).
- Verification strategy (unit + install + real-install smoke) → Tasks 2, 1, 3; final suite → Task 5.

**Out of scope (unchanged, per spec):** `hooks/post-edit.cjs` PostToolUse fix; hook-file rename;
Codex session-start symmetry.

**Placeholder scan:** none — every code step shows complete before/after content.

**Type/name consistency:** `useSessionStartReinject` used identically in `buildHooksConfig` and the
Codex call; `smokeReinject(command, eventName)` defined and called with matching arity in Task 3;
`reinjectEntry` defined before use.
