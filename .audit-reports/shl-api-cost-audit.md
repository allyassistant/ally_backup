# SHL API-Cost Audit Report

**Date:** 2026-06-19
**Auditor:** Mavis (for Ally)
**Scope:** Audit `~/.openclaw/extensions/self-healing-loop/index.mjs` for active or vestigial
LLM-spawn paths that could bypass budget gates and cause uncontrolled API spend.

**Conclusion:** **Zero active LLM spawn paths today.** The M3 subagent spawn path was
removed in 2026-06 and replaced with deterministic LOW_RISK_RULES (Alt A). However,
**no explicit regression guard exists**, and several vestigial telemetry events fire
without a corresponding code path. Adding a hard guard is recommended before any
future refactor accidentally re-enables LLM spawning.

---

## 1. Inventory of `spawn()` / `spawnFixer()` call sites

| # | Location | Target | LLM cost? | Budget-gated? | Status |
|---|----------|--------|-----------|---------------|--------|
| 1 | `index.mjs:204` | `node verify_edit.js <file>` (child_process) | No (local script) | **No** | Active — fires on every `after_tool_call` hook |
| 2 | `index.mjs:386` | `openclaw message send` (Discord push) | No (CLI) | **No** | Active — fires in `sendHealNotification()` |
| 3 | `index.mjs:396` | `spawnFixer()` | **No** (Alt A deterministic) | **Yes** (perFile + session) | Active — pure rule-based fix |
| 4 | `index.mjs:539` comment | (historical M3 spawn path) | Was: yes (LLM subagent) | Was: yes | **DELETED 2026-06** — comment only |

### Details per call site

**Call #1 — `spawn(process.execPath, [absScript, filePath], ...)` (line 204)**

```js
const child = spawn(process.execPath, [absScript, filePath], {
  timeout: timeoutMs,
  stdio: ["ignore", "pipe", "pipe"],
});
```

- Runs `scripts/verify_edit.js` synchronously against the edited file
- Bounded by `cfg.verifyTimeoutMs` (default 10s)
- **No budget gate** — fires on every write/edit/apply_patch
- **Cost:** Zero (local CPU only)
- **Risk:** If `verifyScript` ever points to a remote endpoint or network call,
  this becomes unbounded

**Call #2 — `spawn(NOTIFY_CLI, [...])` (line 386)**

```js
const child = spawn(NOTIFY_CLI, [
  "message", "send",
  "--channel", "discord",
  "--target", SYSTEM_CHANNEL,
  "--message", msg,
], { stdio: "ignore" });
```

- Pushes heal notifications to Discord `#⚙️系統` channel
- **No budget gate** — fires every time `sendHealNotification()` is called from `spawnFixer`
- **Cost:** Zero (Discord webhook, no LLM)
- **Risk:** None observed, but if the notify target ever changes to a paid API,
  unbounded usage becomes possible

**Call #3 — `spawnFixer(api, state, cfg, filePath, verifyErrors)` (line 396)**

- **Alt A deterministic path (current):** directly calls `LOW_RISK_RULES[i].detect()` and
  `.fix()` for each rule. Zero LLM cost. Atomic write + re-verify loop is local.
- **Gated by:** `state.fixBudget.get(filePath) ≤ cfg.perFileBudget` AND
  `state.sessionFixerCount < cfg.sessionFixerCap`
- **Cost:** Zero (deterministic text transformation)
- **Risk:** None — the path itself cannot exceed budget because it doesn't call LLM APIs

**Call #4 — historical M3 subagent spawn path**

- Comment at line 421-425 documents the removal:
  > Replaces the M3 subagent spawn path (was at lines 367–460 prior to 2026-06).
  > 48h telemetry showed the M3 path had 0% effective fix rate on real
  > production files — the 4 `spawn_fallback` errors were SDK permission
  > bugs (config already has allowModelOverride:true), not config issues.
- **Status: Removed from source.** The 4 `spawn_fallback` events in telemetry
  are historical (2026-06-17) from before the removal.

---

## 2. Vestigial telemetry events (no matching code path)

The following telemetry events fire in the JSONL log but have **no corresponding
logic in the current `index.mjs`**:

| Event | Count in log | Source? | Comment |
|-------|--------------|---------|---------|
| `spawn_ok` | 3 | Removed (M3 path) | Historical, pre-2026-06-17 |
| `spawn_fallback` | 5 | Removed (M3 path) | Historical, pre-2026-06-17 |
| `spawn_err` | 5 | Removed (M3 path) | Historical, pre-2026-06-17 |
| `verify_residual` | 1 | **Active** | Line 528 in current source — fires after re-verify shows residual issues |

**Action:** `spawn_ok` / `spawn_fallback` / `spawn_err` events should be
re-classified as legacy telemetry and the JSONL consumer (`fix-digest.sh`)
should filter them out by default.

---

## 3. Regression risks

### Risk 3.1 — No hard guard against re-enabling LLM spawning

**Severity: Medium-High**

If a future contributor refactors `spawnFixer()` and re-adds LLM subagent spawning
(e.g. for "smarter" rule application), **no mechanism prevents it**. The budget
gates (`perFileBudget` / `sessionFixerCap`) cap the count but not the per-call cost.

**Example regression:** A PR adds an optional LLM path with comment "improves
fix quality for edge cases". Passes review because existing tests pass. Runs in
production, exceeds Anthropic API rate limit, gets throttled, retries, $$$

### Risk 3.2 — `sendHealNotification` has no rate limit

**Severity: Low (currently)**

Every successful `spawnFixer()` call pushes a Discord message. If `perFileBudget`
is raised to a higher number in the future and many files are fixed in a single
session, the Discord channel will flood.

### Risk 3.3 — Generic `spawn()` (verify + notify) lacks budget gate

**Severity: Low (currently)**

The two generic `spawn()` calls (lines 204, 386) are not budget-gated. Currently
benign because they don't call paid APIs. If `verifyScript` is ever misconfigured
to point at a network endpoint, the after_tool_call hook will fire unbounded.

---

## 4. Recommended hardening (4-patch plan)

### Patch A — Hard guard against LLM re-introduction

Add to top of `index.mjs`:

```js
// HARD GUARD: SHL is fully deterministic as of 2026-06. Any future PR
// that re-introduces LLM subagent spawning must remove this guard AND
// document the API cost impact in CHANGELOG.md.
const LLM_SPAWN_BLOCKED = true;
function assertNoLLMSpawn(model) {
  if (!LLM_SPAWN_BLOCKED) return;
  if (model && !String(model).startsWith("deterministic:")) {
    void logTelemetry(state, "spawn_llm_attempted", { model, blocked: true });
    throw new Error(
      `SHL: LLM spawn blocked (model=${model}). ` +
      `Remove LLM_SPAWN_BLOCKED and document cost impact in CHANGELOG if intentional.`
    );
  }
}
```

Call `assertNoLLMSpawn(actualModel)` at the top of every spawnFixer path before
any LLM call could occur.

### Patch B — Telemetry event `spawn_llm_attempted`

Add new event name and emit on every LLM spawn attempt (successful or blocked).
Currently the JSONL has no record of LLM-spawn attempts vs successes, which makes
it impossible to detect silent regression.

### Patch C — Rate-limit `sendHealNotification`

Wrap notification in a per-session counter:

```js
let notificationCountThisSession = 0;
function sendHealNotification(...) {
  if (notificationCountThisSession >= cfg.notificationPerSessionCap) {
    void logTelemetry(state, "notification_rate_limited", {...});
    return;
  }
  notificationCountThisSession++;
  // ... existing code
}
```

Add `notificationPerSessionCap` to configSchema (default 10).

### Patch D — Generic spawn budget gate

Add `verifyRunCap` and `notifyRunCap` to configSchema, and gate the generic
spawn calls the same way `spawnFixer` is gated. Defaults: verify=1000/session,
notify=10/session.

---

## 5. Backwards compatibility

- **Existing budget gates** (`perFileBudget`, `sessionFixerCap`) **unchanged**
- **New telemetry events** (`spawn_llm_attempted`, `notification_rate_limited`) are additive
- **Config schema additions** (`notificationPerSessionCap`, `verifyRunCap`) are optional with sensible defaults
- **Hard guard** (Patch A) is the only behavior change — but since current code
  is fully deterministic, the guard is unreachable in current usage

---

## 6. Verification

After patches are applied, verify:

1. Run `bash scripts/shl-rule-audit.mjs` — should still pass 62/62
2. Run `bash scripts/fix-digest.sh` — should report no `spawn_ok` events from current source
3. Temporarily remove the LLM_SPAWN_BLOCKED guard → any LLM spawn should throw
4. Restore the guard → confirm `spawn_llm_attempted` event appears in JSONL

---

## 7. Deliverable scope

This audit is **read-only** — no source changes have been made to
`index.mjs`. Implementation requires explicit go-ahead from Ally.
The accompanying `fix-digest.sh` (separate deliverable) provides the
weekly observability needed to detect any future regression.
