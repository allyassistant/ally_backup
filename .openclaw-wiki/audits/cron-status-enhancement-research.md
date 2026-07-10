# OpenClaw Cron Status Enhancement — Research Report

**Date:** 2026-06-23
**Trigger:** KB Ingester 06:25 silent 401 failure (marked `ok` despite 0 messages processed)
**Decision:** NO ACTION — research only, file for future reference

---

## Problem Statement

OpenClaw cron plugin marks a job as `status: ok` whenever the script exits with code 0. Scripts that **silently fail** (e.g., 401 caught → return empty array → exit 0) get marked as successful despite producing zero side effects.

Three real-world examples uncovered during the 2026-06-23 audit:

1. **Knowledge Base Ingest** (06:25 yesterday): 401 Unauthorized caught as "0 new messages" → exit 0 → `status: ok`. Real side effect: 0 messages ingested.
2. **Gate Evaluation** (every 30 min): Reads empty `.llm_judge_shadow.jsonl` → verdict `ABORT | Hard veto on validSamples` → exit 0 → `status: ok`. Verdict completely ignored.
3. **Daily Memory Logger / Skill Junk Rate Tracker / Pattern Analysis Daily** (multiple): "no output" diagnostics, exit 0, marked `ok` but actual file mtimes prove they DO write (diagnostic simply doesn't capture stdout).

## Core Constraint

OpenClaw's status determination is hardcoded in a single line of compiled JS:

**File:** `/opt/homebrew/lib/node_modules/openclaw/dist/server-cron-DfOwaY9F.js:121`

```js
const ok = result.code === 0 && !result.killed && result.termination !== "timeout" && result.termination !== "no-output-timeout" && result.termination !== "signal";
const status = ok ? "ok" : "error";
```

**Only 4 possible values for `status`:** `ok` / `error` / `skipped` / `unknown` (UI distinguishes these visually).

**No extension points discovered:**
- No `customStatus`, `statusFilter`, or `partialAllowed` config field
- No `beforeRunCronJob` / `afterRunCronJob` plugin hook
- No env-var override for status
- The status field is set in `applyJobResult()` and is not exposed for modification

**File is writable** (owner: ally, perm 600) but is **homebrew-managed** — `brew upgrade openclaw` or `npm install -g openclaw` would overwrite any patch.

## 3 Implementation Options

### Option A: Patch the plugin

**What:** Edit `server-cron-DfOwaY9F.js` to:
1. Parse stdout for `__CRON_STATUS__:partial` marker
2. Add `"partial"` to recognized status set
3. Update UI cron-*.js to render partial chip

**Effort:** ~10 lines of plugin code + UI update

**Pros:**
- Real `partial` status with proper UI rendering
- Scripts only need to add a `console.log('__CRON_STATUS__:partial')` line
- Small, focused patch

**Cons:**
- Blown away on `brew upgrade openclaw` / `npm install -g openclaw`
- Need patch maintenance script
- Modifying internals of npm-managed package is risky
- Mitigation: `brew pin openclaw` or write auto-reapply patch script

### Option B: Wrapper script approach

**What:** Create `scripts/lib/cron_smart_wrapper.sh`:
```bash
#!/bin/bash
# 1. Run actual command, capture stdout + exit code
# 2. Analyze output for "0 processed", "0 條消息", "ABORT", "401", "no new", etc.
# 3. If silent failure detected → exit 1 → cron status: error
# 4. Else exit 0 → cron status: ok
```

**Change:** Each cron's argv from `["node", "script.js"]` to `["bash", "cron_smart_wrapper.sh", "--", "node", "script.js"]`

**Pros:**
- No plugin patch, survives all updates
- Scripts don't need to change, just wrap
- Immediately surfaces all silent failures
- UI shows red error chip

**Cons:**
- No `partial` status — becomes `error` (over-alert)
- argv gets ugly
- "error" + ok output makes you read diagnostic for everything
- Need to maintain pattern list as scripts evolve

### Option C: Side-channel audit cron

**What:** Add 2 new crons:
1. **"Cron Silent Failure Auditor"** every 30 min:
   - Read `openclaw cron list --all --json`
   - Analyze each job's `lastDiagnosticSummary` + `lastDurationMs` + `consecutiveErrors`
   - Detect patterns: "exit 0 + 0 messages", "ABORT in output", "401/ENOTFOUND in stderr"
   - Write detected failures to `~/.openclaw/.state/cron_silent_failures.json`

2. **"Cron Silent Failure Notifier"** hourly:
   - Read the silent-failures state file
   - Post to dedicated Discord channel
   - Reset counters when next run succeeds

**Pros:**
- No plugin patch
- Auto-detects ALL silent failures (not just known patterns)
- Independent channel, doesn't pollute original cron status
- Cumulative history (track when which jobs silently failed)
- Easy to extend (add patterns without plugin code)

**Cons:**
- 30 min detection delay
- 2 new crons to maintain
- `Partial` status still doesn't exist — just adds visibility layer
- Doesn't fix root problem (misleading status field), only adds audit trail

## Comparison

| Dimension | Option A (patch) | Option B (wrapper) | Option C (audit) |
|---|---|---|---|
| Real `partial` status | ✓ | ✗ (becomes error) | ✗ (audit layer) |
| Immediate surface of silent fail | ✓ | ✓ | △ 30min delay |
| Survive update | ✗ breaks | ✓ | ✓ |
| Maintenance cost | Medium (patch script) | Medium (pattern list) | Low (pure detection) |
| Modify existing crons | No | Yes (argv) | No |
| Production safety | △ Medium risk | ✓ Safe | ✓ Safe |
| Future-proof | ✗ (breaks on update) | △ (pattern drift) | ✓ (OpenClaw may add real partial later) |

## Recommendation

If Ally wants:

- **Real `partial` status:** Option A (requires patch maintenance commitment)
- **Immediately surface silent failures** while keeping plugin stock: **Option C** (side-channel audit) — detects and alerts, doesn't change status field
- **Most pragmatic, no plugin touch:** **Option B** (wrapper script) — simple, effective, accepts "error" for partial cases

**Author's pick before user override: Option C** — non-invasive, accumulates audit history, easy to retire when OpenClaw adds real partial status.

## Decision

**NO ACTION** — research only, file for future reference.

User decided not to implement at this time. Reasons likely:
- OpenClaw may add native `partial` support in future versions
- Implementation cost (any option) vs. benefit (visibility only) not justified
- Current monitoring via `lastDiagnosticSummary` + manual review is sufficient for now

## When to Re-evaluate

Revisit this if:
- Silent failures start causing real data loss (vs. just visibility loss)
- OpenClaw adds plugin SDK for cron status customization
- A new pattern of silent failure emerges (e.g., a script that silently breaks after 30 days of running)
- User adds a critical cron that must NOT silently fail (e.g., backup, sync to production)

## Key Files / References

- **Plugin source:** `/opt/homebrew/lib/node_modules/openclaw/dist/server-cron-DfOwaY9F.js`
  - Line 121: status determination (binary)
  - Line 1263: `job.state.lastRunStatus = result.status;`
  - Line 3646: `runCommandJob` entry point
  - Line 100-130: `runCronCommandJob` (exit code → status)

- **Status schema:** `/opt/homebrew/lib/node_modules/openclaw/dist/store-CTgKMVJa.d.ts`
  - `CronRunStatus` type (4 values)

- **UI rendering:** `/opt/homebrew/lib/node_modules/openclaw/dist/control-ui/assets/cron-*.js`
  - Status pill colors: `cron-job-status-ok` / `cron-job-status-error` / `cron-job-status-skipped`

- **Failure alert config:** `failureAlert` field in cron job config (only fires on `error`, not on `partial` because partial doesn't exist)

## Memory References

- `MEMORY.md` → `### ⚠️ Cron audit lessons (2026-06-23) — 3 silent-failure patterns` covers the KB Ingester / Gate Evaluation / "no output" findings
- `openclaw-operational-quirks.md` → `## Cron audit patterns (2026-06-23) — silent failure detection` covers prevention checklist

This research file (`cron-status-enhancement-research.md`) is the "what to do about it" follow-up.
