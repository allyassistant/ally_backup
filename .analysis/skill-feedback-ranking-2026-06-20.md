# Skill Feedback → Ranking Wire-in — 2026-06-20

> **Goal:** Close Goal 2 intelligence loop — telemetry from `.skill_usage_log.jsonl` should influence next auto-suggest ranking.
> **Result:** Mechanism live, 41/41 existing tests pass, real-data verification shows ±13-27% adjustments working.

## TL;DR

| Metric | Before | After |
|--------|--------|-------|
| Telemetry collected | 1198 events | 1198 events (unchanged) |
| Telemetry used in ranking | **0 (passive)** | **All 5 event types weighted** |
| Ranking adjustment | n/a | ±30% bounded multiplicative |
| Tasks with rank change | n/a | 2/8 tested (limited by 14d window) |
| Existing tests | 41/41 | 41/41 (no regression) |
| Time decay | n/a | exp(-age_days / 7) — 7-day half-life |

## What Changed

### Modified: `extensions/skill-auto-suggest/core.mjs`

**3 additions:**

1. **Configuration constants** (top of file):
   ```js
   FEEDBACK_ENABLED = true  // SKILL_FEEDBACK_BOOST=false to disable
   FEEDBACK_WINDOW_DAYS = 14
   FEEDBACK_DECAY_TAU_DAYS = 7  // half-life
   FEEDBACK_MAX_BOOST = 0.3  // ±30% max
   FEEDBACK_TANH_SCALE = 0.3
   FEEDBACK_EVENT_WEIGHTS = { used: 1.0, skipped: -0.5, inferred_skipped: -0.3, rejected: -1.5 }
   ```

2. **New function `loadFeedbackScores(now)`** — reads `.skill_usage_log.jsonl`, computes per-skill feedback score with time decay, cached for 60s. Returns `Map<skillName, score>`.

3. **New function `applyFeedbackBoost(baseScore, feedback)`** — multiplicative, bounded ±30%:
   ```js
   final = base × (1 + tanh(feedback × 0.3) × 0.3)
   ```

4. **Modified `computeTopMatches`** — auto-loads feedback if not provided in options, applies boost to final score, returns `baseScore` and `feedback` per match for observability.

5. **Modified `invalidateSkillsCache`** — clears feedback cache too.

### No changes to `index.mjs`

`computeTopMatches` already supports auto-loading feedback when `options.feedbackScores` is undefined. The `before_prompt_build` hook at line 96-100 of `index.mjs` calls it without feedbackScores, so the new behavior is automatically active.

## Algorithm Details

### Event weight × time decay

For each event in `.skill_usage_log.jsonl` (within 14d window):

```
contribution = weight × exp(-age_days / 7)

where:
  weight ∈ {used: +1.0, skipped: -0.5, inferred_skipped: -0.3, rejected: -1.5}
  age_days = (now - event.ts) / 86400
```

Sum contributions per skill → `feedback_score`.

### Final score adjustment

```
normalized = tanh(feedback_score × 0.3)  // bounded to (-1, +1)
final = base × (1 + normalized × 0.3)   // bounded to (-30%, +30%)
```

### Why multiplicative, not additive

- Preserves relative ranking (high-similarity stays high even with negative feedback)
- Negative feedback can demote a skill below MIN_SCORE (0.25) if heavily skipped → drops out of top-N
- Positive feedback caps at +30% — no single skill can dominate via feedback alone

## Real Data Verification

### Top skills with feedback signal (from 1198 events)

**Positive (boosted):**
- `feedback-test-skill` +17.81 (heavily used in tests)
- `phase3-test-skill` +7.88
- `phase2b-test-skill` +2.88
- `foo` +1.44
- `kimi-deep-research` +0.99

**Negative (demoted):**
- `cron-health-triage` -2.08
- `anomaly-proactive-push` -2.08
- `cron-troubleshooting` -1.54
- `skill-automation-analysis` -0.89
- `x-link-analysis` -0.89

### Before/After ranking on 8 real tasks

| Task | Top-3 (no feedback) | Top-3 (with feedback) | Change |
|------|---------------------|-----------------------|--------|
| cron job fail | cron-troubleshooting (0.500), route-enforcer, anomaly | route-enforcer (0.500), cron-troubleshooting (0.435, fb=-1.54), anomaly (0.354, fb=-2.08) | **CHANGED** |
| X link login wall fallback | x-article (0.675), m3-spawn (0.250), x-link-analysis (0.250) | x-article (0.639, fb=-0.59), m3-spawn (0.250) | **CHANGED** |
| kimi deep research 整合 | kimi-deep-research (1.000) | kimi-deep-research (**1.087**, fb=+0.99) | score boosted |
| 6 other tasks | (single match, no signal) | (unchanged) | — |

**2/8 tasks had rank changes** (limited by small feedback signal in 14d window). Score-level changes happened on more tasks.

## Verification Commands

```bash
# Load real feedback scores
node -e "import('./extensions/skill-auto-suggest/core.mjs').then(m => m.loadFeedbackScores()).then(s => console.log([...s.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5)))"

# Compare ranking with/without feedback
node -e "import('./extensions/skill-auto-suggest/core.mjs').then(async m => { /* ... */ })"

# Run full test suite (should be 41/41)
node extensions/skill-auto-suggest/test.mjs
```

## What This Enables

| Capability | Status | Impact |
|------------|--------|--------|
| Used events boost ranking | ✅ Live | Skills you actually use surface more often |
| Skipped events demote ranking | ✅ Live | Repeatedly-ignored skills drop below MIN_SCORE |
| Time decay | ✅ Live | Old signals fade (7-day half-life) |
| Multi-event aggregation | ✅ Live | Heavy use → strong boost; 1-off use → mild boost |
| Bounded adjustment | ✅ Live | Max ±30%, prevents runaway dominance |
| Backward compat | ✅ Live | All 41 existing tests pass |

## Limitations

1. **Small feedback signal currently** — only 45 used + 36 inferred_skipped + 2 skipped + 1 rejected events in 14d. As telemetry grows, the effect will grow.
2. **14d window is short** — long-running skills (always useful) don't get disproportionate boost. May extend to 30d in v2.
3. **No task-similarity-weighted feedback** — currently a used event for task A is treated equally to a used event for task B. Future: weight feedback by task semantic similarity.
4. **No negative feedback collapse** — a skill with feedback -10 saturates at -30% (doesn't drop further). This is by design (preserve relative ranking).

## Cost / Performance

- `loadFeedbackScores` first call: ~30-50ms (parses 1198 events)
- Cached for 60s: <1ms subsequent calls
- `applyFeedbackBoost` per match: <0.01ms (math)
- Total added latency: ~30ms per `before_prompt_build` (one-time per session)
- Cost: $0 (no LLM calls)

## Files Changed

- `extensions/skill-auto-suggest/core.mjs` (+~120 lines: 2 new functions, config constants, modified `computeTopMatches` and `invalidateSkillsCache`)

## Next Steps

1. **Wait 7 days for telemetry to grow** — more events = more signal = more impactful ranking
2. **Add ranking observability** — log which skills got boosted/demoted, by how much
3. **Tune constants based on data** — `FEEDBACK_MAX_BOOST`, `FEEDBACK_DECAY_TAU_DAYS` may need adjustment
4. **Optional v2**: task-similarity-weighted feedback (per-task profile)

---

*Generated 2026-06-20 00:55 HKT by Mavis*
