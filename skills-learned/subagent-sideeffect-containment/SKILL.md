---
name: subagent-sideeffect-containment
description: Pattern for designing shared utilities with safe defaults when sub-agents may call them — opt-in side effects, call graph tracing, and surgical fixes
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-06T18:00:00.000Z
---

## Workflow

### Problem

Sub-agents (spawned sessions, cron-triggered agents, or any secondary agent process) can call shared scripts and utilities independently. If a utility has **default-on external side effects** (Discord notifications, file writes to shared state, API calls, email sends), sub-agents will trigger them unexpectedly — causing spam, state corruption, or duplicate operations.

The telltale sign: notifications or side-effect artifacts appearing more frequently than expected, with no matching user-level trigger.

### Diagnosis — Trace the Call Graph

1. **Identify the noisy function** — grep for the function that produces the external side effect (e.g., `runSystemCheckBot`, `sendMessage`, `atomicWriteJson`). This is the symptom function.

2. **Find ALL callers** — search the entire codebase (`extensions/`, `scripts/`, `cron job payloads`, `openclaw.json`) for every invocation path to the symptom function. Use:
   ```
   grep -rn "functionName" ~/.openclaw/
   ```
   Include indirect call paths (e.g., wrapper functions).

3. **Classify each caller**:
   - **User-initiated**: triggered by direct user command
   - **Cron-initiated**: triggered by scheduled job (has explicit control flags)
   - **Sub-agent-initiated**: triggered by spawned sessions, CQM verify, auto-fix, or other automated processes
   
   Pay special attention to sub-agent paths — they are the most likely to trigger unwanted side effects because they run autonomously.

4. **Verify the sub-agent hypothesis** — check timestamps of side-effect events against sub-agent spawn times. If they correlate, the hypothesis is confirmed. For cron-triggered CQM, check that the cron job already uses the opt-out flag (e.g., `--no-system-check`).

### Fix — Opt-In, Not Opt-Out

5. **Change the default to NO side effects** — the utility's default behavior should be silent/no-op. All external side effects must be opt-in via an explicit flag.

6. **Add a new opt-in flag** (e.g., `--notify`) alongside the existing opt-out flag (e.g., `--no-system-check`). The precedence rule:
   ```
   optInFlag AND NOT optOutFlag → trigger side effect
   ```
   Both flags existing is fine during migration; the opt-out flag can be deprecated later.

7. **Update ALL known callers**:
   - **Cron jobs** — they already pass the opt-out flag (verify, don't change)
   - **Direct user commands** — add the opt-in flag so they continue working
   - **Sub-agent call paths** — leave them as-is (no flag = no side effect)
   - **Documentation/help text** — update to show the new opt-in default

8. **Verify no regression** — run each caller path to confirm:
   - Cron job still produces its final notification
   - Direct user command still works (with explicit `--notify`)
   - Sub-agent paths produce no side effects

### Key Design Principles

- **Any shared utility that a sub-agent might call must default to zero external side effects.** Sub-agents are autonomous and cannot be relied upon to pass opt-out flags.
- **Opt-out flags (`--no-X`) are dangerous** because they require every caller to know about and remember to pass them. Missing one caller = side-effect leak.
- **Opt-in flags (`--X`) are safe** because the default is the conservative (silent) behavior. Only intentional callers with the flag trigger side effects.
- **Migration path**: Keep both `--no-X` (opt-out) and `--X` (opt-in) for backward compatibility. When removing the opt-out flag, switch the default first, then remove the opt-out after one release cycle.

## Pitfalls

- **Don't assume opt-out flags are sufficient** — even if the cron job passes `--no-system-check`, other call paths (sub-agents, future plugins, manual runs without the flag) will trigger the side effect. Opt-in is the only robust solution.
- **Call graph tracing must be exhaustive** — a wrapper function can hide call paths. Search for the wrapper, not just the leaf function. Use `grep -rn` with the wrapper name as well.
- **Cron jobs may already handle the opt-out correctly** — changing the default won't break them. But verify by reading the cron job payload before declaring "no regression."
- **Side effects can be subtle** — writing to a shared JSON file is a side effect even if it's not a network call. Sub-agents can corrupt shared state by writing stale data.
- **Sub-agents spawned by your own session also count** — when you spawn fix sub-agents that run CQM as part of verification, they can trigger side effects. Always use explicit flags when describing sub-agent tasks.
- **The `--notify` flag pattern applies beyond CQM** — any utility with external side effects (backup scripts, report generators, notification senders) should follow opt-in semantics when sub-agents might call it.
- **After changing the default, you must gateway restart for plugin changes to take effect.** Config-only changes (flags in a standalone script) take effect immediately on next invocation.
