# Full Auto Skill Pipeline — Deep Feasibility Analysis
*Generated 2026-06-12 19:00 HKT by M3 sub-agent*

---

## 0. Reality Check: What's Actually Already in Place

Before verdicts, **important corrections to the task brief** based on file evidence:

| Brief says | Reality (with citation) |
|---|---|
| "而家要 Josh 1-click react 👍/👎 先至 enable" | **No approval UI exists.** Auto-symlink is already wired: `skill_reviewer_bot.js:410` `fs.symlinkSync(dir, symlinkPath, 'dir')` runs IF validator passes. 117 `_learned_*` symlinks already exist. |
| "想加新 step：有冇現成 skill 可以 cover" | **Already partially done in reverse**: `skill-learner/index.mjs:228` injects full `<categorized_skills>` block into `before_prompt_build` — every model call already sees all skills. The LLM (not the router) decides. |
| "before-model hook: 唔可以 async LLM call" | **Async is allowed.** `route-enforcer/index.mjs:84,130` already use `async` and `await routeModel(...)`. Constraint is "must be quick" not "must be sync." |
| "routing.yaml 點 extend" | `scripts/router/route_model.yaml` is provider/route model mapping, not skill matching. Skill matching is a **separate dimension** — belongs in `before_prompt_build` context or a new plugin, NOT the route model yaml. |

**This changes the verdicts significantly: A is mostly done; D is the new surface that needs design.**

---

## 1. Verdicts

### A. Full-auto skill generation (0 manual approval) — 🟢 **Already done. Just add safety net.**

| Aspect | Finding |
|---|---|
| Feasibility | 🟢 HIGH — already 80% there |
| Blockers | None technical. **Validator gate is the safety net**, already in place (post-#146: 7.14% junk-in-prod, 52% catch rate per `.skill_junk_rate.jsonl`). |
| Dependencies | None new. Uses existing `skill_reviewer_bot.js:410` symlink logic. |
| Effort | **0.5–1 day** to add (a) double-gate enforcement, (b) daily report to #⚙️系統, (c) junk-rate auto-pause. |
| Risk | 🟢 Low — every write already goes through pre-write + post-write validator. Worst case: a junk skill gets symlinked → manually unlink. Already a manual unlink path exists. |
| Recommend? | ✅ **Yes — but rename framing.** "Promote existing auto-symlink from implicit to explicit policy with safety nets." |

**What's actually missing for A:**
- A `auto_apply: true` flag in `skill_reviewer_bot.js` config (currently always-on, but undocumented)
- A daily report: count of new skills yesterday, junk-rate trend, top-3 by cluster coverage
- A pause mechanism: if 24h junk rate > 15% → stop symlinking new ones for 24h, alert Josh
- These 3 items = ~6 hours of work

### B. Daily QC pass — 🟡 **Feasible, but is it needed?**

| Aspect | Finding |
|---|---|
| Feasibility | 🟡 MEDIUM — needs new script + cron slot |
| Blockers | (1) Cron slot — 09:30 or 14:00 are open. (2) LLM call cost — 1 M2.7 call/day (~50¢). (3) **Question of value:** post-#146, 7d production junk is 7.14% (target <10% ✅). Is 1 more LLM layer buying real value? |
| Dependencies | `scripts/skill_junk_tracker.js` (v2 split metrics) — already measures junk rate, but on **per-write** basis, not **per-day-aggregate utility**. |
| Effort | **2–3 days**: (a) `scripts/daily_skill_qc.js` reading `.skill_created.jsonl` past 24h, (b) prompt template asking LLM "is this useful + generic?", (c) quarantine decision, (d) cron registration, (e) Discord report. |
| Risk | 🟡 MEDIUM — adding LLM to the loop adds latency + cost + false-positive quarantine risk. With 7.14% prod junk already, marginal value is low. **Risk of over-quarantining good skills** is the main concern. |
| Recommend? | ⚠️ **Defer 1 sprint.** Validate #150 (7-day observation) first (due 2026-06-24). If junk rate stabilizes <5%, skip B entirely. If stays >10%, do B as a thin executor (no LLM, only structural heuristics + coordinator LLM only when ambiguous). |

### C. Manual trigger entry point — 🟢 **Trivially already possible**

| Aspect | Finding |
|---|---|
| Feasibility | 🟢 HIGH |
| Blockers | None |
| Dependencies | `skill_reviewer_bot.js` already standalone-runnable. |
| Effort | **1–2 hours** for a thin CLI wrapper, OR 0 hours if Josh just says "run skill reviewer now" via Discord. |
| Risk | 🟢 Low |
| Recommend? | ✅ **Yes — but minimal.** Just a CLI wrapper `scripts/skill_pipeline_trigger.js` that Josh can call from Discord. Discord slash commands require bot-level OAuth reconfiguration (out of scope). |

**Three options ranked by ROI:**

| Option | Setup | Friction | Verdict |
|---|---|---|---|
| **A. Plain Discord message** | 0 | Low | ✅ **Use this.** Main session already calls `exec("node skill_reviewer_bot.js")` via standard code path. |
| B. CLI wrapper | 1h | Same as A but explicit | 🟡 Optional polish. |
| C. Discord slash command | 2-3 days | Bot OAuth + interaction registration | 🔴 Overkill. |

**My pick: A only.** No code needed.

### D. Smart router hook: pre-model skill-match check — 🟡 **Feasible, but design carefully**

| Aspect | Finding |
|---|---|
| Feasibility | 🟡 MEDIUM-HIGH — leverages existing `before_prompt_build` hook (used by 4 other plugins) |
| Blockers | (1) **Don't duplicate skill-learner** — `skill-learner/index.mjs:228` already injects full `<categorized_skills>` block; the LLM already has them. (2) Latency budget for `before_prompt_build` is shared with other plugins (priorities: 1, 5, 10, 20). (3) False-positive risk — over-suggesting skills could break "use judgment" intent. |
| Dependencies | None new. Can extend `skill-learner` plugin (priority 5) or create a new plugin (priority 7). |
| Effort | **1.5–2 days** for new plugin + matching algorithm + telemetry. **0.5 days** if extending `skill-learner` (since it already has the skills list). |
| Risk | 🟡 MEDIUM — (a) LLM latency in hook path, (b) signal-to-noise (bad matches annoy Josh), (c) prompt bloat (full skills list is ~4-6KB; another block adds more) |
| Recommend? | ✅ **Yes, but as a new lightweight plugin** with deterministic matching, NOT an LLM call inside the hook. |

---

## 2. Full Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  PHASE 1 — SKILL GENERATION (existing, all in place)                    │
│                                                                          │
│  [agent_end hook in skill-learner plugin]                                │
│       ↓ (queue entry)                                                    │
│  [skill_reviewer_bot.js, every 30 min cron, isolated session]            │
│   1. Read .skill_review_queue.jsonl                                      │
│   2. buildReviewPrompt() → injects 117 skills table for dedup            │
│   3. LLM (M2.7) → SKILL.md content                                       │
│   4. Validator pre-write (QW-3, ≥1500B, ≥3 pitfalls)                     │
│   5. atomic write → skills-learned/<name>/SKILL.md                       │
│   6. fs.symlinkSync → skills/_learned_<name>  ← AUTO PROMOTION           │
│   7. log → .skill_created.jsonl                                          │
│   8. Discord #⚙️系統 push                                                │
└──────────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────────┐
│  PHASE 2 — DAILY QC (new, gated on #150 observation closure)            │
│                                                                          │
│  [scripts/daily_skill_qc.js, cron 09:30 or 14:00]                        │
│   1. Read .skill_created.jsonl past 24h, filter passed=true               │
│   2. Structural heuristics: (size, word count, pitfalls, dedup)          │
│   3. If ambiguous → 1 batched M2.7 LLM call (up to 10 skills)            │
│   4. Move bad → _archive/quarantine-bad-utility/<name>/                   │
│   5. fs.unlinkSync skills/_learned_<name> (auto-demote)                   │
│   6. Discord #⚙️系統 daily report                                         │
└──────────────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────────────┐
│  PHASE 3 — SMART ROUTER INTEGRATION (new, the real design work)         │
│                                                                          │
│  [skill-suggester plugin, before_prompt_build, priority 7]                │
│   1. Hook receives: user message + system context                         │
│   2. Lightweight: keyword extract (5KB Jieba) → match against            │
│      pre-computed inverted index (rebuilt daily by QC pass)              │
│   3. If 1+ match score > 0.6:                                            │
│      → inject `<skill_suggestions>` block into system context             │
│      → "[Ally] Detected 2 candidate skills for this task: X, Y.          │
│         If useful, consider them. Otherwise continue."                    │
│   4. If no match → no-op (zero overhead)                                 │
│   5. Telemetry: hit rate, false-positive rate, override rate              │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Smart Router Hook Detailed Design (D)

### Plugin: `skill-suggester`

**Hook:** `before_prompt_build` (priority 7 — between channel-context:5 and route-enforcer:10)

### Lookup Table Format

**File:** `~/.openclaw/workspace/.skill_suggester_index.json`
**Rebuilt:** Daily by `daily_skill_qc.js` (Phase 2)
**Format:**
```json
{
  "version": 1,
  "builtAt": "2026-06-12T09:30:00.000Z",
  "skills": [
    {
      "name": "cron-troubleshooting",
      "description_keywords": ["cron", "failing", "timeout", "diagnose"],
      "trigger_keywords": ["cron failed", "cron 死咗", "timeout"],
      "category": "Cron Reliability",
      "quality_score": 0.92
    }
  ],
  "inverted_index": {
    "cron": ["cron-troubleshooting", "cron-health-triage", "cron-migration"],
    "timeout": ["cron-troubleshooting", "subagent-m3-reliability"]
  }
}
```

### Matching Algorithm (deterministic, no LLM)

```js
function matchSkill(userMessage, index) {
  const tokens = tokenize(userMessage.toLowerCase()); // 5KB Jieba + fallback split
  const scores = new Map();
  for (const token of tokens) {
    const candidates = index.inverted_index[token] || [];
    for (const name of candidates) {
      scores.set(name, (scores.get(name) || 0) + 1);
    }
  }
  // Normalize by skill description length
  const ranked = [...scores.entries()]
    .map(([name, raw]) => {
      const skill = index.skills.find(s => s.name === name);
      const norm = raw / Math.sqrt(skill.description_keywords.length);
      return [name, norm * skill.quality_score];
    })
    .filter(([_, s]) => s > 0.4)  // threshold
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);  // top 3 only
  return ranked;
}
```

### Response Format

Injected into system context only if 1+ match:
```xml
<skill_suggestions>
The following existing skills may help with the current request. Consider using them instead of generating new code:
- **cron-troubleshooting** (score 0.78, Cron Reliability) — Diagnose cron failures, build timeline, identify provider vs script vs session issues
- **cron-health-triage** (score 0.62, Cron Reliability) — Hourly cron health scan, push to #⚙️系統

These are detected via keyword matching. Ignore if not relevant.
</skill_suggestions>
```

### Performance Budget

| Operation | Target | Actual (estimated) |
|-----------|--------|--------------------|
| Tokenize user message | <5ms | 1-3ms (Jieba small dict) |
| Lookup inverted index | <10ms | 1-5ms (Map.get) |
| Compute scores + sort | <5ms | <1ms (≤3 candidates) |
| Build suggestion block | <2ms | <1ms |
| **Total per message** | **<25ms** | **<10ms** |

Compare with current `before_prompt_build` budget: route-enforcer 50-150ms, channel-context 5-20ms. Skill-suggester adds <10ms overhead. Well within budget.

### False-Positive Mitigation

- **Threshold 0.4** filters weak matches (avoid noise)
- **Top 3 cap** prevents overwhelming context
- **Jie's "consider them, ignore if not relevant"** wording (Josh can override)
- **Daily rebuild** ensures fresh data (no stale suggestions)
- **Override rate telemetry**: track how often Josh manually bypasses a suggestion → tune threshold

---

## 4. Auto-Skill Safety Mechanisms (A)

### ❌ Forbidden
- Auto-apply skill 喺 production critical path（已避免：skills 只係供 LLM reference，唔係直接執行）
- Auto-symlink 跳過 validator（已避免：`skill_reviewer_bot.js:365` 強制 pre-write gate）
- Skip post-write audit（已避免：line 422 second validator run）

### ✅ Required
| Mechanism | Status | Implementation |
|-----------|--------|----------------|
| Pre-write validator (QW-3, ≥1500B, ≥3 pitfalls) | ✅ Existing | `skill_reviewer_bot.js:365` |
| Post-write validator (second pass) | ✅ Existing | `skill_reviewer_bot.js:422` |
| Atomic write (tmp + rename) | ✅ Existing | BUG-06 fix |
| Junk rate tracker | ✅ Existing (v2 split) | `skill_junk_tracker.js` |
| Auto-pause on junk rate spike | ❌ **Missing** | Add: if 24h rate > 15% → disable symlink for 24h, alert |
| Daily report to #⚙️系統 | ❌ **Missing** | Add: count, top-3 by cluster, junk rate trend |
| Auto-rollback on critical issue | 🟡 Partial | Manual `unlinkSync` exists; could add: if validator fails on re-check → auto-unlink |
| Pre-write fence (self-reference detection) | ✅ Existing | QW-2 from #152 |

### Recommended Safety Net Additions (~6 hours total)

```js
// skill_reviewer_bot.js add:
- config.auto_apply: true (default on, but documented)
- After 30-min cycle: 
    - Read .skill_junk_rate.jsonl last 24h
    - If junkRatePercent > 15: 
        - skip symlink for next 24h
        - log to .skill_reviewer_pause.jsonl
        - push to Discord
- Daily 23:55: 
    - Generate report (count, top cluster, junk trend)
    - Push to #⚙️系統
```

---

## 5. Manual Trigger Plugin (C)

**Pick: A. Plain Discord message** — no code needed.

**Convention:** When Josh types:
- "run skill reviewer" / "整 skill" / "skill review now" → main session calls `exec("node skill_reviewer_bot.js")`
- "spawn sub-agent 分析 X" → already works via smart router

**Optional CLI wrapper** (`scripts/skill_pipeline_trigger.js`, 1-2 hours):
```bash
node scripts/skill_pipeline_trigger.js --mode manual --force-rebuild --batch-size 5
```

**Why not Discord slash command:** 2-3 days OAuth reconfiguration, OpenClaw version-specific, high maintenance.

---

## 6. 3-Week Implementation Roadmap

### Week 1 — Safety Nets for A (low risk, high value)

| Day | Task | Effort | Output |
|-----|------|--------|--------|
| 1 | Add `auto_apply: true` flag to `skill_reviewer_bot.js` + document | 1h | Config flag |
| 1 | Add 24h junk rate check + auto-pause | 2h | Pause mechanism |
| 2 | Add daily 23:55 report generator | 2h | Daily report |
| 2 | Test: trigger 5 junk skills → verify auto-pause kicks in | 1h | Verified pause |
| 3 | Test: trigger 5 good skills → verify normal flow | 1h | Verified flow |
| 3 | Update HEARTBEAT.md with new behaviors | 0.5h | Doc |

**Total: ~7.5h**

### Week 2 — Manual Trigger (C) + Daily QC (B)

| Day | Task | Effort | Output |
|-----|------|--------|--------|
| 1 | `scripts/skill_pipeline_trigger.js` CLI wrapper | 1.5h | CLI tool |
| 1 | Document Discord trigger convention in AGENTS.md | 0.5h | Doc |
| 2 | `scripts/daily_skill_qc.js` (thin executor + structural heuristics) | 3h | QC script |
| 3 | Cron registration: 09:30 daily | 0.5h | Cron |
| 3 | Test: trigger 10 known skills (5 good, 5 bad) | 1h | Verified QC |
| 4-5 | Buffer for issues | 4h | — |

**Total: ~10.5h**

**Gating:** Week 2 Day 2 QC implementation blocked on **#150 7-day observation closure** (2026-06-24). If junk rate stabilizes <5% before then, skip B entirely.

### Week 3 — Smart Router Skill-Suggester (D)

| Day | Task | Effort | Output |
|-----|------|--------|--------|
| 1 | `plugin/skill-suggester/index.mjs` skeleton | 1.5h | Plugin skeleton |
| 1 | `before_prompt_build` hook registration (priority 7) | 0.5h | Hook registered |
| 2 | `daily_skill_qc.js` outputs `.skill_suggester_index.json` | 2h | Index builder |
| 2 | Tokenize + inverted index lookup algorithm | 2h | Matching engine |
| 3 | Inject `<skill_suggestions>` block + tune threshold (0.4) | 1.5h | Suggestion injection |
| 3 | Telemetry: hit rate, override rate, latency | 1h | Metrics |
| 4 | Test 20 messages: 10 with skills, 10 without | 1.5h | Verified matching |
| 4 | Test 10 false-positive scenarios | 1h | FP check |
| 5 | Buffer + telemetry tuning | 2h | — |

**Total: ~13h**

**Gating:** Week 3 Day 2 index builder needs Week 2 QC to be running. Sequence is strict.

### Summary

| Week | Sub-goals | Effort | Cumulative |
|------|-----------|--------|------------|
| 1 | A safety nets | 7.5h | 7.5h |
| 2 | C + B (gated) | 10.5h | 18h |
| 3 | D | 13h | 31h |

**Total: ~31 hours across 3 weeks** (vs earlier 8-10h estimate for D-only)

---

## 7. Resource Estimate + Dependencies + Risks

### Total Effort
- **Without D:** 18h
- **With D:** 31h
- **D alone is 13h** — earlier estimate of 6-8h was wrong because we missed the inverted-index + threshold tuning

### Dependencies
- `skill_reviewer_bot.js` (existing, mature)
- `validate_skill_file.js` (existing, post-#146)
- `skill_junk_tracker.js` v2 (existing, post-M3 split)
- `pattern_proactive_trigger.js` (existing, for alerts)
- OpenClaw plugin SDK (existing, supports async before_prompt_build)
- `jieba` or similar tokenizer (NEW: 5KB Jieba small dict for Cantonese-friendly tokenization)
- `cron` slot 09:30 or 14:00 (open)
- `cron` slot 23:55 for daily report (existing, but new payload)

### Top 3 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|:----------:|:------:|------------|
| **Auto-pause triggers on bad signal** (false positive pause) | 🟡 MED | Stuck pipeline for 24h | Add: Josh can manually override pause via Discord reaction or `node skill_pipeline_trigger.js --resume` |
| **Skill-suggester false positive overloads** Josh with bad suggestions | 🟡 MED | Annoyance + trust erosion | Threshold 0.4 + top-3 cap + override rate telemetry + "consider, ignore if not relevant" wording |
| **Daily QC over-quarantines good skills** (LLM is conservative) | 🟡 MED | Knowledge loss | Strict: only quarantine if validator ALSO fails (double-gate); never LLM-only quarantine |

### Other Risks
- OpenClaw plugin SDK version compat: tested 2026.4.x; should check on 2026.5.x
- LLM cost: 1 M2.7 call/day = ~50¢ × 30 = $15/month per QC pass
- Index rebuild race condition: if daily QC fails → skill-suggester uses stale index; mitigate: 2-day TTL with alert

---

## Summary

| Sub-goal | Verdict | Effort | Status |
|----------|:-------:|:------:|--------|
| A. Full-auto skill generation | 🟢 Mostly done | 7.5h | Recommend this week |
| B. Daily QC pass | 🟡 Defer | 10.5h | Gated on #150 (06-24) |
| C. Manual trigger | 🟢 Trivial | 1-2h | Optional polish |
| D. Smart router skill-suggester | 🟡 New surface | 13h | After A+B done |

**Sequenced roadmap:** Week 1 (A) → Week 2 (C+B) → Week 3 (D)

**Total: 31 hours across 3 weeks** = sustainable pace, each week has 1 deliverable.

**Key insight:** A is mostly already done — the auto-symlink exists. The "missing" 1-click approval UI was a misread. The real gap is **safety nets** + **intelligence** (D), not automation permission.
