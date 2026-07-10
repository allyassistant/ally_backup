# audit_repair_proposer.js — Deep Review

**Date:** 2026-06-24
**File:** `/Users/ally/.openclaw/workspace/scripts/audit_repair_proposer.js`
**Status:** UNTRACKED in git, created 2026-06-21, **NEVER WIRED into any cron**

---

## TL;DR

`audit_repair_proposer.js` is a well-designed Phase 2e **wire-up** script that processes audit results and either auto-fixes or proposes repairs. It is **completely dead** in the current system because:

1. **CRITICAL BUG**: `lib/proposal_store.js:49` has the same `?.` LHS assignment syntax error that broke 10 other scripts today. Any code that requires it throws SyntaxError.
2. **No cron job calls it** — the entire Phase 2d→2e→2f pipeline was designed but never wired into the schedule.
3. **Filename mismatch**: file is `audit_repair_proposer.js` but the script internally calls itself `audit_repair_wire.js` in 6+ places.
4. **Same mismatch in `audit_daily_cron.js`**: file named one thing, internally called `daily_audit_runner.js`.

The "designed schedule" is 04:30 audit_daily_cron → 04:45 audit_repair_proposer → 05:15 propose_fix_notifier. None of these crons exist.

---

## Purpose

`audit_repair_proposer.js` is **Phase 2e of a larger audit pipeline**. Its job:

1. **Read** `.state/audit_orchestrator_results.json` (output of Phase 2d audit)
2. **Classify** each issue by `(severity × file-tier)` matrix
3. **Decide** action: `auto-fix` (mechanical, low-risk) vs `propose` (needs human review)
4. **Apply** auto-fixes via `LOW_RISK_RULES` with snapshot/rollback safety net
5. **Detect** cross-script incompatibilities (Layer 2) after fixes
6. **Append** proposals to `.state/repair_proposals.json` for human review
7. **Output** result summary to `.state/audit_repair_wire_results.json`

---

## Architecture & Data Flow

```
Phase 2d: daily_audit_runner.js / audit_daily_cron.js
    │
    │  writes → .state/audit_orchestrator_results.json
    ▼
Phase 2e: audit_repair_proposer.js  ← THIS FILE
    │  reads input
    │  uses lib/LOW_RISK_RULES to detect+fix
    │  uses lib/file_snapshot for rollback
    │  uses lib/dependency_graph + lib/script_signature_detector for Layer 2
    │  uses lib/cumulative_approvals for trust gates
    │  uses fix_m3_advisory for LLM advisor
    │  uses lib/proposal_store to write proposals
    │
    │  writes → .state/repair_proposals.json
    │  writes → .state/audit_repair_wire_results.json
    ▼
Phase 2f: propose_fix_notifier.js  (Discord notification)
Phase 2f: proposal_action.js  (human review + cumulative approval)
Phase 2f: audit_to_skill_emitter.js  (proposals → skills pipeline)
```

---

## How It Works

### Step 1: Input Loading (lines 435-450)
- Reads `STATE_DIR/audit_orchestrator_results.json` (default: `~/.openclaw/workspace/.state/audit_orchestrator_results.json`)
- Extracts merged issues from `payload.results.merged`
- Errors out if file missing or malformed

### Step 2: Dependency Graph (Layer 2 setup, lines 452-464)
- If `AUDIT_REPAIR_LAYER2` env is not `false` (default ON):
  - Builds workspace-wide dependency graph (one-time, cached)
  - Cost: scans entire workspace for require/import statements

### Step 3: Issue Classification (lines 167-178, 219-280)

**File-tier classifier** (heuristic):
- `production` if path matches `scripts/cron_*`, `scripts/auto_*`, `scripts/daily_*`, `scripts/session_*`, `*_runner`, `*_monitor`, `*_triage`, `*.sh`, or under `/archive/`
- Otherwise → `utility`

**Decision matrix** (lines 219-280):

| Severity | Tier | Action | Notes |
|---|---|---|---|
| critical | any | auto-fix | always (overrides everything) |
| high | utility/debug | auto-fix | mechanical edits, no production impact |
| high | production | propose / auto-fix if trusted | cumulative approval check |
| medium | utility/debug | auto-fix | v2 NEW (was: propose) |
| medium | production | propose / auto-fix if trusted | cumulative check |
| low | utility/debug | auto-fix | v2 NEW (was: propose) |
| low | production | propose | rare, still needs human eye |

**Cumulative approval**: When a rule has been manually approved 3+ times (per `lib/cumulative_approvals.js`), future production-tier auto-fix is enabled without human review. Honors Ally's "high LLM trust" preference.

### Step 4: Auto-Fix Path (lines 283-411)

For each `auto-fix` decision, `applyFix()` does:

1. **Read** source file
2. **Snapshot** → `.fix_snapshots/<base>.<ts>.<pid>.pre` (unless `--no-snapshot`)
3. **Detect**: run `rule.detect(content)` to confirm problem still present
4. **Fix**: run `rule.fix(content)` to compute new content
5. **Write** atomically (`.fix.tmp` → `rename`)
6. **Re-detect**: run `rule.detect(newContent)` to verify fix actually works
7. **Rollback**: if re-detect finds issue still present, restore from snapshot
8. **Layer 2 cross-script check**: extract function signatures pre+post, find incompatible callers, emit follow-up proposals

**Fail-open**: any error in one issue does not abort the whole run.

### Step 5: Proposal Path

For each `propose` decision, build a proposal object with:
- `file`, `line`, `rule`, `severity`, `message`
- `tier`, `reason`
- `autoFixCandidate: !!findLowRiskRule(issue)` — could be auto-fixed but we chose propose
- `m3Advisory` — verdict from LLM advisor if invoked

Then `appendProposal()` calls `proposalStore.append()` which deduplicates and saves.

### Step 6: M3 LLM Advisor (lines 499-543)

`fix_m3_advisory` is an LLM-based override. It can:
- Upgrade `propose` → `auto-fix` if M3 says "approve" with high confidence (non-critical, low/medium risk only)
- Downgrade `auto-fix` → `propose` if M3 says "reject" (non-critical, not high risk)

Two modes:
- **shadow mode** (default): just log M3 verdict, don't change decision
- **active mode**: actually override heuristic decision

### Step 7: Layer 2 Cross-Script Propagation (lines 371-402)

After a successful auto-fix:
1. Extract function signatures before + after (using `script_signature_detector`)
2. Find incompatible callers in dependent files (using `dependency_graph`)
3. Emit follow-up proposals with `autoFixCandidate: false` (require human review)
4. Non-fatal — if Layer 2 fails, just log warning and continue

### Step 8: Summary (lines 614-646)

Writes to `.state/audit_repair_wire_results.json`:
- `autoFixes[]` — list of all attempted auto-fixes with ok/error
- `proposals[]` — list of all proposals with writtenToFile flag
- `crossScriptProposals[]` — Layer 2 follow-ups
- `skipped[]` — count of skipped (mostly file-not-found)
- `summary` — totals
- `meta` — input path, dry-run flag, layer2 enabled, startedAt

Cleanup: `snapshot.cleanOldSnapshots(14)` — removes snapshots older than 14 days.

---

## Dependencies (all 8 lib modules verified present + working)

| Module | Lines | Status |
|---|---|---|
| `lib/config` | 100 | ✓ Working |
| `lib/rules/low-risk` | 709 | ✓ Working |
| `lib/file_snapshot` | 159 | ✓ Working |
| `lib/dependency_graph` | 284 | ✓ Working |
| `lib/script_signature_detector` | 355 | ✓ Working |
| `lib/cumulative_approvals` | 246 | ✓ Working |
| `lib/proposal_store` | 136 | ✗ **HAS BUG** (see below) |
| `fix_m3_advisory` | 365 | ✓ Working |

---

## Bugs Found

### BUG #1 (CRITICAL): `lib/proposal_store.js:49` has the same `?.` LHS syntax error

```js
// line 49
data?.meta?.lastUpdated = new Date().toISOString();
//       ^^^^^^^^^^^^^^^ Invalid left-hand side in assignment
```

This is **the exact same bug** that broke 10 other scripts today (audit, fileDiscovery, skill_pattern_emitter, etc.). I fixed those in my earlier audit but missed `lib/proposal_store.js`.

**Impact**: Any code that requires `proposal_store.js` throws `SyntaxError: Invalid left-hand side in assignment` at load time. The proposer itself never even gets to run.

**Fix**: `data.meta = data.meta || {}; data.meta.lastUpdated = new Date().toISOString();`

### BUG #2 (DESIGN): Filename doesn't match internal references

File is `audit_repair_proposer.js` but internally calls itself `audit_repair_wire.js` in:
- Line 3: comment header
- Line 35-40: usage docs
- Line 90: CLI help text
- Line 429: `log()` at start of main
- Line 556, 591: log() per-issue
- Line 630: final summary

This suggests the file was **renamed** at some point (or originally named `audit_repair_wire.js` and later renamed to `_proposer.js`) but the internals weren't updated. If anyone tries to use the docstring as reference, they'll be confused.

**Fix**: pick one name and update all internal references. The filename is more recent (mentions "proposer" which matches the new lib/proposal_store.js interface), so keep `audit_repair_proposer.js` and update the internals.

### BUG #3 (DESIGN): Same issue in `audit_daily_cron.js`

The file `audit_daily_cron.js` (the supposed Phase 2d orchestrator) has its docstring say "daily_audit_runner.js" in 2 places. Same renamestorm.

### BUG #4 (ARCHITECTURE): Pipeline never wired

The **entire Phase 2d→2e→2f pipeline is not wired into any cron job**. Looking at the comment in `propose_fix_notifier.js`:

> Schedule: cron 15 5 * * * (after audit_repair_proposer @ 04:45, after ...)

The designed schedule is:
- **04:30** — `audit_daily_cron.js` (Phase 2d: run audit)
- **04:45** — `audit_repair_proposer.js` (Phase 2e: wire → auto-fix/propose)
- **05:15** — `propose_fix_notifier.js` (Phase 2f: Discord notify)

But the actual crons at those times are:
- 04:00 — Gate Evaluation (different)
- 05:00 — Daily Maintenance (different)
- 10:00 — System Check (CQM, but different — uses `code_quality_manager.js` directly)

**The 4 untracked scripts exist but nobody runs them on a schedule.** They'd need to be wired via `openclaw cron create` for each.

### BUG #5 (MINOR): `findLowRiskRule` has inconsistent rule ID naming

In the `aliases` map (line 191-198):
```js
const aliases = {
  'fsSync_missing_trycatch': 'fs-sync-trycatch',
  'execSync_missing_trycatch': 'fs-sync-trycatch',  // <-- same target as above
  'simplified-chinese': 'simplified-chinese',
  'optional_chaining': 'optional-chaining',
  'magic_numbers': 'magic-numbers-safe',
  'magic_numbers_safe': 'magic-numbers-safe',
};
```

Notice:
- `fsSync_missing_trycatch` and `execSync_missing_trycatch` both alias to `fs-sync-trycatch` (probably wrong — should be different rules?)
- `magic_numbers` and `magic_numbers_safe` are both in the aliases (one is legacy)

This is a code smell suggesting the audit_orchestrator (producer) uses different rule names than the LOW_RISK_RULES. The aliases are a workaround, not a fix.

### BUG #6 (NIT): `results?.autoFixes?.push(...)` in line 547, etc.

The whole script uses optional chaining on **array methods** which is safe (returns undefined if not exists), but creates questions:
- If `results.autoFixes` is undefined, the push silently no-ops, losing data
- Better: assert at top of main that `results.autoFixes = []`

This isn't a bug per se (works correctly), but it's defensive paranoia that hides bugs.

---

## Connected/Dependent Scripts

### Writers of `repair_proposals.json` (audit_repair_proposer is one of 5)
- `audit_repair_proposer.js` (this file)
- `audit_to_skill_emitter.js` (separate pipeline)
- `daily_telemetry_digest.js` (legacy)
- `proposal_action.js` (Phase 2f human action)
- `propose_fix_notifier.js` (Phase 2f notification)

### Readers of `audit_orchestrator_results.json` (the input)
- `audit_repair_proposer.js` (this file)
- `daily_report.js` (reporting)
- `code_quality_manager.js` (the cron'd CQM tool)
- `test_e2e_phase3.js` (E2E tests)
- `lib/audit_history.js`, `lib/batch_verifier.js`, `lib/auditOrchestrator.js`
- `e2e_layer3_demo.js`
- `audit_daily_cron.js` (writes it, doesn't read)
- `_legacy/daily-telemetry-digest.js`

### Callers of `audit_repair_proposer`
**None** (other than references in test files and SYMBOLS.md). No production script requires it.

### Callers of `audit_daily_cron`
- `audit_just_written.js` (mentions it)
- `test_e2e_phase3.js` (E2E test)
- `SYMBOLS.md` (auto-generated)

### Callers of `audit_just_written`
- `daily_report.js` (mentions)
- `auto_fix.js` (the SHL Phase A)
- `test_auto_fix_audit_rule_map.js` (test)

### `audit_just_written.js` is part of the **Self-Healing Loop** (SHL)
- Per audit notes: "Phase A immediate audit: `audit_just_written.js` runs on every successful write, fires Discord warning on `severity:critical` (system channel `#⚙️系統` hardcoded)"
- Hooked via SHL `after_tool_call` event
- This part of the pipeline IS working — it's why SHL has been detecting my `?.` syntax errors

---

## Current System State (Observed via File mtimes)

```
.state/audit_orchestrator_results.json  — Jun 24 04:30  (21KB)  ← being written
.state/repair_proposals.json             — Jun 24 04:47  (84KB)  ← being written
.state/audit_repair_wire_results.json    — Jun 24 04:47  (16KB)  ← being written
```

**Something IS writing these files daily**. The 17-min gap (04:30 → 04:47) suggests:
1. 04:30: audit_orchestrator runs (writes orchestrator_results.json)
2. 04:47: SOMETHING ELSE writes repair_proposals.json + audit_repair_wire_results.json

If `audit_repair_proposer.js` is broken (SyntaxError), it can't be the writer. So there must be **another version of the proposer running** somewhere. Possible candidates:
- Different file on a different path
- Modified version that doesn't import proposal_store
- A pre-fix version

**This needs investigation**.

---

## Recommended Fixes (in priority order)

### P0: Fix `lib/proposal_store.js:49` (5 minutes)

```js
// Before
data?.meta?.lastUpdated = new Date().toISOString();

// After
data.meta = data.meta || {};
data.meta.lastUpdated = new Date().toISOString();
```

This unblocks the entire Phase 2e pipeline.

### P1: Decide pipeline fate (architectural decision)

Three options:
1. **Wire it up**: Create 3 cron jobs (audit_daily_cron @ 04:30, audit_repair_proposer @ 04:45, propose_fix_notifier @ 05:15). Test for 1 week. Enable M3 active mode after.
2. **Defer**: Mark as "designed but not deployed" with clear docstring. Re-evaluate when Ally has bandwidth.
3. **Simplify**: Merge the 3 phases into a single orchestrator script (less moving parts, fewer cron points of failure).

### P2: Fix filename mismatches (10 minutes)

- `audit_repair_proposer.js`: replace all `audit_repair_wire.js` references in docstring/CLI/logs
- `audit_daily_cron.js`: replace all `daily_audit_runner.js` references in docstring

### P3: Investigate "what's writing repair_proposals.json daily?"

If something else is writing these files, the new audit_repair_proposer may not be needed, or there's a parallel implementation. Need to find the actual writer.

### P4: Reduce optional-chain noise (cosmetic)

Replace `results?.autoFixes?.push(...)` with assertions or refactor to ensure `results.autoFixes` exists at top of main.

### P5: Resolve rule ID aliasing (deeper)

Either:
- Update `audit_orchestrator` to emit rule IDs matching `LOW_RISK_RULES` names
- Or update `LOW_RISK_RULES` to use the orchestrator's names

Currently the aliases are a maintenance burden.

---

## What Works Well

Despite the bugs, the script is **well-designed**:

1. **Defense in depth** — snapshot before fix, re-detect after fix, rollback on re-detect failure. Cannot leave file in broken state.
2. **Fail-open per issue** — one bad issue doesn't kill the whole run.
3. **Layered safety** — file-tier classifier + severity + cumulative approval + M3 advisor. Conservative defaults.
4. **Atomic writes** — `.fix.tmp` → `rename`, no partial writes.
5. **Comprehensive logging** — `verbose` flag, structured result JSON, console summary.
6. **Good separation of concerns** — lib modules are focused, script is glue logic.
7. **CLI ergonomics** — `--dry-run`, `--no-snapshot`, `--no-layer2`, `--verbose`, `--help`.
8. **Cross-script awareness** — Layer 2 detects downstream breakage, emits follow-up proposals.
9. **Trust accumulation** — Phase 2f cumulative approval reduces human review over time.

The bug is **not in the design**, it's in the dependency chain (proposal_store.js broken) and in the **lack of cron wiring**.

---

## TL;DR for Decision

The author designed a beautiful pipeline. It just never got deployed. The fix is:
1. 5-min syntax fix in `lib/proposal_store.js`
2. 3 cron jobs to wire it up
3. Maybe a rename for consistency

The design is worth keeping. Just needs the missing infrastructure.
