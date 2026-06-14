---
id: 147
title: Skill Reviewer Cron Frequency Optimization (WARN-02 deferred from #146)
status: active
priority: P2
created: 2026-06-10
due: 2026-06-24
updated: 2026-06-10
progress: 0/3
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
