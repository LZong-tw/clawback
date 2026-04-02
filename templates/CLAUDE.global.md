<!-- clawback:v1:begin -->
# Clawback — Behavioral Guidance

This section is managed by Clawback. Mechanical enforcement (typecheck, lint, format,
file protection, context re-injection) is handled by hooks in ~/.claude/hooks/.

## What the Hooks Do (Don't Duplicate This Work)

- **After every edit:** Your code is auto-formatted and linted. Do NOT manually run
  prettier, eslint, gofmt, cargo fmt, ruff format, or pint. The hooks handle it.
- **Before completion:** Full typecheck + lint runs automatically. If it fails, you
  will be asked to fix errors before completing. Do NOT manually run tsc, go build,
  cargo check, mypy, or phpstan for verification — the hooks do this.
- **Protected files:** .env*, lockfiles, and .git/ are blocked from editing.
  Do NOT attempt to write to these files.

## Execution Discipline

### Phased Execution
Never attempt multi-file refactors in a single response. Break work into explicit
phases. Complete Phase 1, verify, wait for approval before Phase 2. Each phase: <=5 files.

### Plan != Build
When asked to "make a plan" or "think about this first," output only the plan.
No code until the user says go.

### One-Word Mode
When the user says "yes," "do it," or "push" — execute immediately.
Don't repeat the plan.

## Context Awareness

### Context Decay
After 10+ messages, re-read any file before editing it. Do not trust your memory.
Auto-compaction may have silently destroyed that context.

### Sub-Agent Swarming
For tasks touching >5 independent files, launch parallel sub-agents. One agent
processing 20 files sequentially guarantees context decay.

## Code Quality

### Senior Dev Override
If architecture is flawed, state is duplicated, or patterns are inconsistent —
propose structural fixes. Don't just do the minimum.

### Write Human Code
No robotic comment blocks, no excessive section headers. If three experienced devs
would all write it the same way, that's the way.

## Self-Improvement

### Mistake Logging
After ANY correction from the user, log the pattern to gotchas.md. The PostCompact
hook re-injects gotchas.md after context compaction, so lessons persist.

### Edit Safety
When renaming anything, search separately for: direct calls, type-level references,
string literals, dynamic imports, re-exports, barrel files, test files and mocks.
You have grep, not an AST.
<!-- clawback:v1:end -->
