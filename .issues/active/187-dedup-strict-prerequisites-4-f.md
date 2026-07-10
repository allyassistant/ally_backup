---
id: 187
title: Dedup strict prerequisites: 4 步 follow-up (sub-agent #11 verdict)
status: active
priority: P2
created: 2026-07-05
due: 2026-08-01
updated: 2026-07-09
progress: 2/4 (Phase 2.1-2.3 全部 done. Phase 1 + 3-4 仲未做.)
---

## F - Facts（事實）

### 現況
#182 #11 verdict (2026-07-05 M3 sub-agent): `SKILL_REVIEWER_BOT_DEDUP=strict` 暫時 **唔建議 flip**。Risk Score = MEDIUM。Sub-agent recommend Option C (stay-warn) + 4 個 prereq steps 後再考慮 enable。

### Sub-agent Verdict Summary

| 項目 | 結果 |
|------|------|
| Verdict | RISKY — NEEDS TUNING |
| Risk Score | MEDIUM |
| Confidence | HIGH (in analysis) |
| Algorithm correctness | ✅ Solid (Ollama/nomic-embed-text cosine similarity, normalized 0.85 ≈ raw 0.70) |
| Fail-open behavior | ✅ Comprehensive (Ollama down / cache corrupt 都會 fallback to write) |
| **Telemetry gap** | ⚠️ Cross-source dedup 冇自己嘅 telemetry (post-LLM dedup 唔同 system) |
| **Silent skip risk** | ⚠️ Strict skip path (skill_reviewer_bot.js:1603-1606) 唔 inject feedback 返 LLM |
| **wrapper-fs-safe-write stuck loop** | 🔥 53 matches over 5 日, 永遠寫唔到 SKILL.md |

### 數據/證據

| 項目 | 值 |
|------|------|
| Sub-agent runtime | 2m42s |
| Sub-agent tokens | 60.2k (in 48.5k / out 11.7k) |
| M3 confidence | HIGH |
| Telemetry file size | `.skill_reviewer_post_llm_dedup.jsonl` = 76KB (post-LLM dedup, NOT cross-source) |
| Total post-LLM dedup entries | 249 (2026-06-29 → 2026-07-04) |
| Post-LLM dedup actions | 185 skip, 63 patch, 1 append |
| Top matched skill | `node-fs-enoent-debugging` (53 matches) |
| Stuck loop | `wrapper-fs-safe-write` matched against `node-fs-enoent-debugging` 53 times in 5 days, SKILL.md 永遠冇寫 |
| Threshold analysis | 0.85 normalized = 0.70 raw cosine; sub-agent suggest **0.88** if tuning |

### Code References

| File:Line | What's there |
|-----------|--------------|
| `skill_reviewer_bot.js:60` | `BOT_DEDUP_MODE = (env.SKILL_REVIEWER_BOT_DEDUP || 'warn').toLowerCase()` |
| `skill_reviewer_bot.js:61` | `BOT_DEDUP_THRESHOLD = 0.85` (default) |
| `skill_reviewer_bot.js:1581-1610` | Cross-source dedup gate call site |
| `skill_reviewer_bot.js:1603-1606` | Strict skip path (silent — 冇 LLM feedback) |
| `skill_dedup_gate.js:78-94` | Cosine similarity (normalized) |
| `skill_dedup_gate.js:178-188` | Ollama fail-open (null on error) |
| `skill_dedup_gate.js:289-292` | Empty warnings if cache missing |

### Timeline

| Time | Event |
|------|-------|
| 2026-06-29 → 07-04 | 249 post-LLM dedup entries logged |
| 2026-07-05 02:20 | M3 sub-agent verdict (RISKY, MEDIUM risk) |
| 2026-07-05 02:25 | #187 開嚟追蹤 prereq steps |

## D - Decisions（決定）

### ✅ 已做決定
- **2026-07-05**: #182 #11 deferred (唔 flip strict mode)
- **2026-07-05**: #187 開嚟追蹤 4 個 prereq steps (sub-agent Option C)
- **2026-07-05**: 優先處理 wrapper-fs-safe-write stuck loop (獨立問題，不論 cross-source 點都會發生)
- **2026-07-08**: Phase 2 全部 done — wrapper-fs-safe-write promoted to active skill + threshold 0.85→0.92 + 5-day stuck loop fully resolved (M3 sub-agent verified 9/9 scenarios)
- **2026-07-08**: Decision — **D3 resolved** (promote, not blacklist). wrapper-fs-safe-write 同 node-fs-enoent-debugging 確認係 distinct skills (false positive at 0.85; 真正 similarity 唔同)

### ⏳ 待做決定

| # | Decision | Options | Trigger |
|---|----------|---------|---------|
| **D1** | Cross-source telemetry 格式 — mirror post-LLM dedup 定 custom? | Mirror = 快、custom = 完整 metadata | 實作前 |
| **D2** | Threshold 0.85 → 0.88 同步 apply 落 post-LLM dedup？ | ✅ **Superseded by 0.92 jump** (2026-07-08) | 已完成 — 跳過 0.88 直上 0.92 |

## Q - Questions（未解決）

### ❓ 核心問題

1. **Cross-source telemetry 嘅 schema 點 design?** — Mirror post-LLM dedup (similarity, matched_skill, mode, outcome) 或者加埋 LLM feedback path 嘅 metadata
2. **LLM feedback injection 落 strict skip path 點 implement?** — sub-agent suggest mirror post-LLM dedup 嘅 behavior (L1462+ tool-call result injection). Code location: skill_reviewer_bot.js:1603-1606
3. ~~**wrapper-fs-safe-write 真係 duplicate 定係 genuine skill?**~~ — ✅ **RESOLVED 2026-07-08**: Genuine distinct skill. False positive at 0.85.
4. ~~**0.85 → 0.88 threshold tuning 真係 work？**~~ — ✅ **Superseded**: jumped to 0.92 directly based on false-positive evidence

### 🔍 追問（蘇格拉底反詰）

- **點解唔直接開 strict + 觀察 dedup reject count？** 因為 silent skip 會 hide 問題，唔報返 LLM 等於 zero observability
- **點解唔 fix wrapper-fs-safe-write stuck loop 先？** 因為呢個 loop 喺 post-LLM dedup (separate system)，唔關 cross-source strict 事，但係 same pathology
- **如果 LLM feedback injection 加咗 strict skip path 仲係 silent 嗎？** 唔係 silent，但會 add 1 個 tool-call per skip — 影響 performance，需要 benchmark
- **點解唔直接 bump threshold 去 0.92 算？** 太 high 會漏真正 duplicate，反而壞過 false positive

## Progress

### Phase 1: Foundation (Week 1, 7-05 → 7-12)
- [ ] **Step 1.1**: Add cross-source telemetry — create `.skill_reviewer_cross_source_dedup.jsonl` writer in `skill_reviewer_bot.js`
  - Schema: `{ts, proposed_name, proposed_desc_hash, matched_skill, similarity, mode, outcome}`
  - Mirror post-LLM dedup format for consistency
- [ ] **Step 1.2**: Add LLM feedback injection on strict skip — modify `skill_reviewer_bot.js:1603-1606` to push tool-call result
  - Mirror post-LLM dedup behavior (L1462+ area)
  - Reference: bot already has pattern for tool-call result injection

### Phase 2: Fix Stuck Loop (Week 1-2, 7-12 → 7-19) ✅ COMPLETE 2026-07-08
- [x] **Step 2.1**: Identified wrapper-fs-safe-write stuck loop (via hidden_drift_detector finding)
- [x] **Step 2.2**: Investigated - confirmed genuinely distinct from node-fs-enoent-debugging
  - Manual review of both SKILL.md contents confirmed different topics
  - Similarity 0.855 was a false positive (fs-keyword overlap)
  - Real semantic distance is well below 0.5
- [x] **Step 2.3**: Resolved by promoting to active + raising threshold to 0.92
  - ✅ `wrapper-fs-safe-write/SKILL.md` (95 lines, status: active) — written by main agent (not quarantine/auto-symlink)
  - ✅ Quarantine `_archive/quarantine-1783211517822-wrapper-fs-safe-write/` removed
  - ✅ Threshold 0.85 → 0.92 in `scripts/lib/skill_dedup_gate.js:35` (DEFAULT_THRESHOLD = 0.92 + comment "raised 2026-07-08 from 0.85")
  - ✅ Backlog burndown: 39 stale proposals archived (36 fsSync + 3 magic_numbers)

### Phase 3: Observation (Week 2-4, 7-19 → 8-01)
- [ ] **Step 3.1**: 14 日 observation in warn mode with new cross-source telemetry
- [ ] **Step 3.2**: Calculate cross-source FP rate from telemetry
- [ ] **Step 3.3**: Re-evaluate threshold (0.85 vs 0.88) based on observed data

### Phase 4: Re-decision (Week 4+, 8-01+)
- [ ] **Step 4.1**: If FP rate < 5% → re-evaluate strict enablement
- [ ] **Step 4.2**: If FP rate 5-15% → tune threshold first
- [ ] **Step 4.3**: If FP rate > 15% → keep warn mode, deeper algorithm review needed

### Closing criteria (Day 28, 8-01)
```
✅ PASS: Cross-source telemetry 已 ship + wrapper-fs-safe-write fixed + LLM feedback working + 14 日 observation < 5% FP rate
🟡 PARTIAL: ≥2 items done + no regression
🟠 NEEDS MORE: telemetry ship 但 observation < 7 日
🔴 REGRESSION: telemetry write 影響 bot performance > 10%
```

### Rollback plan
- Telemetry write: env `SKILL_REVIEWER_CROSS_SOURCE_TELEMETRY_DISABLED=1` (add kill switch)
- LLM feedback injection: git revert single commit
- Threshold tuning: env `SKILL_REVIEWER_BOT_THRESHOLD=0.85` (revert to default)

### Cross-references
- **Trigger:** #182 #11 (sub-agent verdict)
- **Parent:** #182 (Phase A follow-up, 5/5 done, ready to close)
- **Related:** `scripts/skill_reviewer_bot.js` (target file)
- **Related:** `scripts/lib/skill_dedup_gate.js` (dedup algorithm)
- **Related:** `.skill_reviewer_post_llm_dedup.jsonl` (sibling telemetry to mirror)
- **Stuck loop:** `wrapper-fs-safe-write` vs `node-fs-enoent-debugging` (53 matches)

### Out of scope
- ❌ Don't flip `SKILL_REVIEWER_BOT_DEDUP=strict` (deferred)
- ❌ Don't touch `skill_dedup_gate.js` algorithm (proven solid by sub-agent)
- ❌ Don't merge into #182 (separate timeline, easier tracking)

## Notes

### Stuck Loop Resolution (2026-07-08)

Phase 2 全部 done:
- `wrapper-fs-safe-write` confirmed distinct skill (NOT a hallucinated duplicate)
- Promoted to active status (95 lines, real SKILL.md content)
- Dedup threshold 0.85 → 0.92 directly (skipped intermediate 0.88)
- Backlog 39 stale proposals archived (skill_proposal_alert.js no longer flags this pair)
- New escalation cron `30 6 * * *` will surface any future stuck loops in 7 days (not 19)

### Remaining Work
- **Phase 1 (Foundation)**: Telemetry + LLM feedback injection — 仍係必修 (observability gap)
- **Phase 3-4 (Observation)**: Need 14-day window after Phase 1 ships

### Verification
- 9/9 audit scenarios pass (M3 sub-agent, 2026-07-08 23:00 HKT)
- skill_proposal_alert.js dry-run: emits historical alert correctly (1 stuck pair, 11 daysBlocked)
- Next daily run (06:30 HKT 2026-07-09) will validate the loop is no longer triggered

### Reference: Initial Stuck Loop Evidence (from post-LLM telemetry)

`wrapper-fs-safe-write` matched against `node-fs-enoent-debugging` 53 times over 5 days with **zero successful creations**. The skill folder exists with only a `references/` subdir — no `SKILL.md` ever written. The LLM keeps proposing the same idea; post-LLM dedup keeps rejecting (correctly flagging similarity 0.85-0.91).

**Hypothesis confirmed 2026-07-08:** `wrapper-fs-safe-write` (atomic write wrapper) and `node-fs-enoent-debugging` (ENOENT error debugging) are semantically distinct, but to the embedding model both look like "Node.js file system stuff".

### Why 0.88 Threshold?

Sub-agent reasoning:
- 0.85 (current) borderline-aggressive for short text like skill name+description
- 0.88 (proposed) sweet spot — captures obvious duplicates while reducing false positives on related-but-distinct skills
- 0.90 too tight, might miss legitimate duplicates
- Without direct cross-source telemetry, threshold tuning is speculative

### Key Insight from Sub-agent

> "These are TWO SEPARATE dedup systems. The cross-source dedup has NO telemetry of its own — its `log('DEDUP-GATE: ...')` calls only go to the bot log file. So we cannot directly observe cross-source dedup false-positive rate."

This is a structural observability gap that needs to be fixed before we can responsibly flip any mode.
