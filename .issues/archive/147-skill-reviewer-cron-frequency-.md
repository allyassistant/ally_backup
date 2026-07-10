---
id: 147
title: Skill Reviewer Cron Frequency Optimization (WARN-02 deferred from #146)
status: archive
priority: P3
created: 2026-06-10
due: 2026-06-24
updated: 2026-06-22
progress: 0/3
---

## Updated 2026-06-19 — Priority P2 → P3

降 priority 嘅原因：
1. **Phase 2f (dedup_gate) 已 integrated** into `skill_reviewer.js`，所以 queue 內有信號先 call LLM，empty run 已經 early exit（觀察: 大部分 30-min run 係 "Pipeline was paused due to a prior auto-pause condition" 然後 silent exit）
2. **Phase 2c (pattern_emitter) 已加** v=3 candidates via 4h cron，唔再 100% 靠 30-min cycle
3. **Hybrid Advisory (M10)** 已 deployed (2026-06-18)，judge layer 喺 shadow mode

剩 0/3 progress（無具體 work done 喺呢個 issue 內）— 30-min → 2hr 嘅改動仍然有道理（$0.09/day + 避免 30-min 過度激進），但 唔再 urgent。建議併入 #162 M6 (Housekeeping) milestone 一齊做。

## Original content follows
---

## Description

**問題：** Skill reviewer cron 現時每 30 分鐘行一次 (`skill_reviewer_bot.js` + `systemEvent` style 或 `agentTurn+isolated`)。queue 通常空，但 cron 仍然 spawn LLM call（雖然有 cache，hit 率 60-80% 但仍要 0.5-2s per call）。

**M3 audit 建議（#146 WARN-02）：**
- 方案 A：30 分鐘 → 2 小時
- 方案 B：加 `min-queue-size` check — queue < 3 個 signals 就 skip

**Why deferred from #146：** 改 cron config 影響 scheduling，需要單獨 review 對其他 cron 嘅 cascade effect。

## Progress
- [ ] Step 1: Measure current cache hit rate + avg queue size (3-7 days observation)
- [ ] Step 2: Decide: 2hr vs min-queue-size vs hybrid
- [ ] Step 3: Apply change + verify no missed signals

## Notes

- **Current config:** `HEARTBEAT.md` row "Skill Reviewer | 30 分鐘" — 6AM, 6:30AM, ..., 11:30PM
- **Parent issue:** #146
- **Estimated impact:** ~50% fewer LLM calls, ~$X cost saving/month (待算)
