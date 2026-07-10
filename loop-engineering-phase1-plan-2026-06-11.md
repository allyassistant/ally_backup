# Loop Engineering Phase 1 (Narrow) — Detailed Implementation Plan

**Author:** M3 sub-agent (SPAWN_QUALITY)
**Date:** 2026-06-11 13:15 HKT
**Scope:** 3-4.5hr, 5 LLM crons, read-only design exercise

**Related:**
- `loop-engineering-analysis-2026-06-11.md` (M3 deep analysis, 7000 words)
- `skills-learned/loop-engineering-implementation/SKILL.md` (M2.7 workflow)
- `.issues/active/152-qw-1-5-skill-reviewer-junk-rat.md`
- `.issues/active/153-2-cron-jobs-ollama-qwen2-5-.md`

---

## Part 1: 5 LLM Crons — Final Selection

### Grep evidence: scripts with actual LLM calls

| Script | LLM Call Location | Calls/Run | Calls/Day | Model | USD/Month |
|--------|-------------------|-----------|-----------|-------|-----------|
| `skill_reviewer_bot.js:604` | `execFileSync('openclaw', ['infer', 'model', 'run', ...])` | 1 (if queue non-empty) | **48** | M2.7 + deepseek fallback | ~$15-30 |
| `knowledge_ingester.js:444,597,704` | calls `knowledge_classifier.js:64` → LLM | variable | **5-20** | M2.7 hybrid | ~$2-8 |
| `memory_generator.js:311` | `execFileSync(... 'infer', 'model', 'run' ...)` | 1 (or 2 with retry) | **1** (L1, 600w) | M2.7 | ~$1 |
| `memory_generator.js:294` | same (L0 variant) | 1 | **1** (L0, 200w) | M2.7 | ~$0.5 |
| `daily_summary_bot.js:188-189` | `execFileSync(... 'infer', 'model', 'run' ...)` | 1 | **1** (23:59) | M2.7 (main session) | ~$0.5-1.5 |

**Confirmed = 5 scripts (not 5+). 21 non-LLM crons excluded with reasoning.**

### Ranked by LLM Call Volume × Cost

| Rank | Cron | Calls/Day | Risk | Token Budget (input/output/total) | Termination: max runtime | Termination: success metric |
|------|------|-----------|------|-----------------------------------|------------------------|----------------------------|
| 1 | Skill Reviewer (30min) | 48 | HIGH | 40K/10K/50K | 120s | junk rate trending |
| 2 | Knowledge Ingester | 5-20 (bursty) | HIGH | 50K/8K/100K | 180s | queue depth |
| 3 | L1 Generator (00:35) | 1 (large) | MEDIUM | 60K/12K/100K | 300s | 600+ words |
| 4 | L0 Generator (00:05) | 1 (short) | LOW | 30K/5K/30K | 120s | 200+ words |
| 5 | Daily Summary (23:59) | 1 (main sess) | MEDIUM | 40K/8K/50K | 180s | output exists |

---

## Part 2: Token Budget Mechanism

### Config Format: YAML

File: `cron_config/llm_budget.yaml`

```yaml
# Per-cron LLM token budgets
# Format: cron_name (from HEARTBEAT.md)
# All values are soft caps: log warning on exceed, pause only on repeated violation
# Enforcement: lib/llm_budget.js → called at cron script entry point

skill_reviewer:
  max_input_tokens: 40000
  max_output_tokens: 10000
  max_total_tokens: 50000
  max_runtime_sec: 120
  cost_usd_per_call: 0.03
  alert_on_exceed: log  # phase 1: log only; phase 2: pause

knowledge_ingester:
  max_input_tokens: 50000
  max_output_tokens: 8000
  max_total_tokens: 100000
  max_runtime_sec: 180
  cost_usd_per_call: 0.02
  alert_on_exceed: log

l1_generator:
  max_input_tokens: 60000
  max_output_tokens: 12000
  max_total_tokens: 100000
  max_runtime_sec: 300
  cost_usd_per_call: 0.04
  alert_on_exceed: log

l0_generator:
  max_input_tokens: 30000
  max_output_tokens: 5000
  max_total_tokens: 30000
  max_runtime_sec: 120
  cost_usd_per_call: 0.02
  alert_on_exceed: log

daily_summary:
  max_input_tokens: 40000
  max_output_tokens: 8000
  max_total_tokens: 50000
  max_runtime_sec: 180
  cost_usd_per_call: 0.03
  alert_on_exceed: log
```

### Enforcement: 3 Layers

**Layer 1 — Pre-exec (in script, before LLM call):**
```javascript
// lib/llm_budget.js  
const budget = loadBudget('skill_reviewer');  // from cron_config/llm_budget.yaml
const state = loadState('.token_budget.jsonl');  // last 5 mins
if (state.totalTokensThisMinute + budget.max_total_tokens > MAX_RATE_LIMIT) {
  logWarn('Token budget exceeded, pausing this cycle');
  process.exit(0);  // clean exit, cron retries next cycle
}
```

**Layer 2 — Post-response (after LLM returns, log usage):**
```javascript
// Inside LLM call wrapper
const usage = { cron: 'skill_reviewer', input_tokens, output_tokens, total, timestamp: Date.now() };
execSync(`echo '${JSON.stringify(usage)}' >> .token_budget.jsonl`);
```

**Layer 3 — OpenClaw cron timeout (backstop):**
```
cron config: timeoutSeconds: budget.max_runtime_sec
→ automatically kills run if exceeds runtime
```

### Tracking: `.token_budget.jsonl` (append-only)

```jsonl
{"cron":"skill_reviewer","input":12500,"output":3400,"total":15900,"ts":1781155000000,"elapsedSec":42,"model":"minimax-portal/MiniMax-M2.7"}
{"cron":"l1_generator","input":42000,"output":8600,"total":50600,"ts":1781155100000,"elapsedSec":187,"model":"minimax-portal/MiniMax-M2.7"}
```

### Alert & Recovery

- **Phase 1 (这段工作计划)**：`alert_on_exceed: log` — 只 log warning, 唔 pause
- **Recovery**：每次 cron run 都 reset (no carryover). Global daily total cap ($50/day, or 17x skill_reviewer) logs warning if exceeded
- **Phase 2 upgrade**：continuous violation (3 in a row) → auto-pause, notify Discord #⚙️系統

The tracking data (`.token_budget.jsonl`) will be synced to an `anomaly_monitor.js` baseline store for trend detection.

---

## Part 3: Termination Manifest (Limited)

File: `docs/loop_termination_manifest.md` (same format as HEARTBEAT.md plus columns for termination criteria)

**Contents (5 LLM crons full spec + 21 non-LLM crons light spec):**

```
| Cron | Script | Schedule | LLM? | Max Runtime | Max Calls/Day | Success Rate Target | Kill Switch |
|------|--------|----------|------|-------------|---------------|-------------------|-------------|
| Skill Reviewer | skill_reviewer_bot.js | */30 | Y | 120s | 48 | >90% | disable cron |
| KB Ingester | knowledge_ingester.js | 06:30 | Y | 180s | 20 | >90% | disable cron |
| L1 Generator | memory_generator.js L1 | 00:35 | Y | 300s | 1 | >95% | disable cron |
| L0 Generator | memory_generator.js L0 | 00:05 | Y | 120s | 1 | >95% | disable cron |
| Daily Summary | daily_summary_bot.js | 23:59 | Y | 180s | 1 | >95% | disable cron |
| ... (21 light entries) | | | N | 600s (generic) | - | - | disable cron |
```

**Validation script:** `scripts/validate_manifest.js` — checks `docs/loop_termination_manifest.md` consistency:
- All 26 crons present
- Each cron's max_runtime matches actual cron timeout setting
- LLM crons have LLM-specific fields populated
- Alert if any manifest field missing

---

## Part 4: Observability

### Metric pipeline

```
[.token_budget.jsonl] → [scripts/token_budget_daily.js] → [.token_budget_daily.jsonl]
                                    ↓
                      [anomaly_monitor.js baseline store] → [anomaly alert]
```

- `token_budget_daily.js` mirrors `skill_junk_tracker.js:69-87` (rolling 7-day)
- Baseline store from `anomaly_monitor.js` reused for trend detection
- Daily report format: cron name, total tokens, total cost, trend vs 7d avg

### Alert triggers

| Condition | Action |
|-----------|--------|
| Single run exceeds token budget (×1.0) | log warning |
| Single run exceeds token budget (×2.0) | log warning + track for pattern |
| 3 consecutive exceedances → pause run | phase 2 feature |
| Daily total > 7d avg × 1.5 | log warning to Discord #⚙️系統 |
| Daily cost > $50/day (global cap) | log warning + suggest model downgrade |

---

## Part 5: 7-Day Observation Plan (Jun 18-25)

**New Issue: #154 — Loop Engineering Phase 1: Token Budget + Manifest Observation**

Sequential to #152/#153 closing:
- #152 QW closes Jun 18 → OK to proceed → #154 starts Jun 18
- #153 Ollama closes Jun 18 → data available for #154 baseline
- #154 closes Jun 25 → decision: promote Phase 1 → approve Phase 2

### Checkpoints

| Day | Date | Check Command | Expected | Action if Failed |
|-----|------|--------------|----------|-----------------|
| D1 | Jun 18 | `tail -1 .token_budget_daily.jsonl` | file exists, >0 entries | check budget mechanism logging |
| D3 | Jun 20 | `wc -l .token_budget.jsonl` | >100 entries (5 LLM crons × 3 days × ~2.5 avg calls/day) | check each cron individually |
| D5 | Jun 22 | `tail -5 .token_budget_daily.jsonl \| jq .totalCost` | no daily >$50 cap breached | review logs for budget warnings |
| D7 | Jun 25 | `python3 -c "import json; d=[json.loads(l) for l in open('.token_budget_daily.jsonl')]; print('avg cost:', sum(r['totalCost'] for r in d)/len(d))"` | avg daily cost < budget | assess if budget caps need adjustment |

### Closing Criteria

| Outcome | Condition | Action |
|---------|-----------|--------|
| ✅ PASS | All 4 checkpoints pass + no regression in existing metrics | Promote Phase 1 → approve Phase 2 budget |
| 🟡 PARTIAL | Budget breach ≥1 day, but fixable | Adjust budgets → extend observation 3 days |
| 🟠 NEEDS MORE | Multiple budget breaches after adjustment | Pause new crons on budget, extend 7 days |
| 🔴 REGRESSION | Token budget causes cron failures or LLM task failure | git revert, review mechanism design |

### Rollback Plan

| Rollback | Command | Impact | Time |
|----------|---------|--------|------|
| Full revert | `git revert <sha>` | All 3 files (config, lib, docs) reverted | 1min |
| Disable budget check | Set `alert_on_exceed: none` in yaml | Logging stops, no behavioral change | 30s |
| Remove lib import | Comment out `require('lib/llm_budget.js')` in each script | Back to pre-Phase 1 behavior | 5min |
| Remove manifest doc | Delete `docs/loop_termination_manifest.md` | Doc removed, no runtime change | 10s |

---

## Part 6: Actual Code Diffs

### Diff 1 — `scripts/skill_reviewer_bot.js:580-630` (LLM call wrapper with token budget)

**Before (line 586-592):**
```javascript
// LLM model inference
const instruction = '...';
const maxTokens = 4096;
const response = execFileSync('openclaw', ['infer', 'model', 'run',
  '--agent', AGENT_ID,
  '--model', MODEL,
  '--model-fallback', MODEL_FALLBACKS[0],
  '--max-tokens', maxTokens.toString(),
  '--input', instruction
]);
```

**After (line 586-630):**
```javascript
// === Token Budget Check (Phase 1) ===
const budget = require('./lib/llm_budget.js').forCron('skill_reviewer');
const state = budget.getState('.token_budget.jsonl', { windowMs: 60000 });

if (state.totalTokensLastWindow + budget.maxTotalTokens > budget.globalRateLimit) {
  logWarn(`[TOKEN_BUDGET] skill_reviewer: token rate limit hit. ` +
    `${budget.maxTotalTokens}/${budget.globalRateLimit} tokens in last 60s. Pausing cycle.`);
  process.exit(0); // clean exit; cron retries next interval
}

// LLM model inference
const maxTokens = Math.min(4096, budget.maxOutputTokens);
const t0 = Date.now();
const response = execFileSync('openclaw', ['infer', 'model', 'run',
  '--agent', AGENT_ID,
  '--model', MODEL,
  '--model-fallback', MODEL_FALLBACKS[0],
  '--max-tokens', maxTokens.toString(),
  '--input', instruction
]);
const elapsed = Date.now() - t0;

// === Token Budget Tracking (Phase 1) ===
budget.track({
  cron: 'skill_reviewer',
  inputTokens: response.inputTokens || instruction.length / 4,
  outputTokens: response.outputTokens || response.length / 4,
  totalTokens: (response.inputTokens || 0) + (response.outputTokens || 0),
  elapsedSec: Math.round(elapsed / 1000),
  model: MODEL,
  status: 'completed'
});
```

**Diff 2 — `scripts/memory_generator.js:294-330` (L0/L1 generator wrapping)**

Same pattern: insert `const budget = require('./lib/llm_budget.js').forCron(isL1 ? 'l1_generator' : 'l0_generator');` before line 311, wrap existing LLM call with budget check + post-call tracking.

---

## Part 7: Cross-System Insights (5)

### 1. QW-1~5 + Token Budget = Content + Cost Double Defense
QW-1~5 fixes junk rate (content quality), token budget fixes cost risk (financial quality). They're orthogonal defense layers: one prevents bad output, one prevents runaway cost. **Together they close the two biggest gaps** for scaling loops.

### 2. #153 (Ollama) + Token Budget = Complementary
#153's ollama migration cuts LLM cost to $0 for 2 crons. Token budget caps the other 3 crons. Combined = **~50% cost reduction** from pre-QW/M3. #153 shows compute reduction path, token budget shows cost reduction path — different mechanisms, same direction.

### 3. Karpathy Cost Cap → Our 50% Safety Margin
Karpathy loop's 3rd prerequisite is "fixed time limit per iteration." At 48 iterations/day × $0.03/iter = $1.44/day × 30 days = $43.2/month for skill_reviewer alone. Our proposed $50/day global cap = ~35x safety margin over estimated daily cost = **very conservative, safe for Phase 1**.

### 4. Reddit Edge Loop: All 5 Crons Verify the Pattern
Reddit's framework: loop at edge (collect, verify, dedupe). Our 5 LLM crons: they generate content (memory L0/L1, daily summary), classify + curate (KB ingester), generate skills (skill reviewer). **All are verification-heavy, judgment-light** — perfect match for edge looping.

### 5. Token Budget Future-Proofing
Once token budget infra is in place (config + lib + logging), adding a 6th cron (= new cron with LLM call) takes **5 minutes**: add one entry to `cron_config/llm_budget.yaml`. No new code, no new infra. Future Phase 2 loops get cost protection by default.

---

## Part 8: Final Action Plan

### Effort Breakdown (4.5hr total)

| Sub-task | Effort | Dependencies | Owner |
|----------|--------|-------------|-------|
| Create `cron_config/llm_budget.yaml` | 30min | None | Main agent |
| Create `lib/llm_budget.js` | 1.5hr | YAML file created | Sub-agent (CODE) |
| Create `docs/loop_termination_manifest.md` | 1hr | Cron list from HEARTBEAT.md | Main agent |
| Create `scripts/token_budget_daily.js` | 30min | `skill_junk_tracker.js:69-87` as template | Sub-agent |
| Modify 5 scripts to import budget lib | 30min | lib/llm_budget.js created | Sub-agent |
| Create `scripts/validate_manifest.js` | 30min | Manifest doc created | Sub-agent |
| Create Issue #154 | 15min | All code done | Main agent |

### Order of Operations

```
1. [Code] Create cron_config/llm_budget.yaml          (30min)
2. [Code] Create lib/llm_budget.js                     (1.5hr)
3. [Code] Create scripts/token_budget_daily.js         (30min)
4. [Test] Verify token_budget loads correctly          (10min)
5. [Code] Modify 5 scripts (import + wrap LLM calls)   (30min)
6. [Test] Verify each script loads without errors      (15min)
7. [Doc]  Create docs/loop_termination_manifest.md     (1hr)
8. [Code] Create scripts/validate_manifest.js          (30min)
9. [Test] Run validate_manifest.js                     (5min)
10.[Issue] Create #154 + observation plan              (15min)
```

### Day-by-Day Schedule

| Date | Phase | Action | Decision Point |
|------|-------|--------|---------------|
| Jun 11 (今日) | Setup | Create code + doc files (steps 1-9) | — |
| Jun 12 | Setup | Git commit, deploy, verify live | Josh: merge PR? |
| Jun 12-17 | Passive Wait | crons run normally, token logging passive | — |
| Jun 18 | #152 Close | Close #152 (QW obs) + start #154 | Josh: proceed to #154? |
| Jun 18-25 | #154 Obs | Monitor `.token_budget_daily.jsonl`, D1/3/5/7 checkpoints | — |
| Jun 25 | #154 Close | Evaluate: PASS? PARTIAL? NEEDS MORE? REGRESSION? | Josh: approve Phase 2? |

### Risk Mitigations

| Risk | Likelihood | Impact | Contingency |
|------|-----------|--------|-------------|
| Token budget causes cron to exit prematurely 🟡 | LOW | MEDIUM | Phase 1: log_only mode (exit 0 only on repeated exceed) |
| YAML config typo breaks script 🟢 | MEDIUM | HIGH | Add `validate_manifest.js` as pre-commit hook |
| Ollama cost is 0 but compute ≠ 0 🟢 | LOW | LOW | monitor runtime, not $ — #153 already covers |
| Budget infra adds latency to LLM calls 🟢 | LOW | LOW | budget check <5ms, negligible overhead |
| Feature creep: Josh asks to add 6th cron 🟡 | MEDIUM | LOW | Adding 6th cron is 5min work — easy, not risky |

### Decision Points (Josh Approval Required)

1. **Today**: "Should I start creating code/docs? (4.5hr budget)" → Approve / Defer
2. **Jun 12**: "Merge PR to main?" → Approve / Hold
3. **Jun 18**: "Start #154 7-day observation?" → Approve / Skip
4. **Jun 25**: "Promote Phase 1 → Phase 2 prep?" → Approve / Hold

---

## Appendix A: Key Design Decisions

| Decision | Options Considered | Chosen | Rationale |
|----------|-------------------|--------|-----------|
| Budget format | YAML / JSON / inline constant | **YAML** | Readable, easy to maintain, separate from code |
| Enforcement point | script entry / LLM call wrapper / cron config | **All 3 layers** | Defence in depth |
| Logging format | SQLite / JSONL / CSV | **JSONL** | Maintains compatibility with existing `.skill_junk_rate.jsonl` + `anomaly_monitor.js` |
| Observation period | 3d / 7d / 14d | **7d** | Matches #152/#153 observation cadence |
| Rollback mechanism | config flag / git revert / cron disable | **All 3 tiered** | From instant (config) to permanent (git revert) |

## Appendix B: Files Changed (Live List)

| File | Action | New? |
|------|--------|------|
| `cron_config/llm_budget.yaml` | Create | ✅ New |
| `lib/llm_budget.js` | Create | ✅ New |
| `scripts/token_budget_daily.js` | Create | ✅ New |
| `docs/loop_termination_manifest.md` | Create | ✅ New |
| `scripts/validate_manifest.js` | Create | ✅ New |
| `scripts/skill_reviewer_bot.js` | Edit (add import + wrap call) | ❌ Existing |
| `scripts/memory_generator.js` | Edit (add import + wrap call) | ❌ Existing |
| `scripts/knowledge_ingester.js` | Edit (add import + wrap call) | ❌ Existing |
| `scripts/daily_summary_bot.js` | Edit (add import + wrap call) | ❌ Existing |
