---
id: 119
title: Daily Maintenance cron 撞 compaction memoryFlush race condition
status: archive
priority: P1
created: 2026-05-30
due: 2026-06-04
updated: 2026-06-08
progress: 0/5
---

## Description

Daily Maintenance cron (05:00 HKT, isolated session) 撞到 OpenClaw 內部 compaction memoryFlush background process，導致 `EmbeddedAttemptSessionTakeoverError: session file changed while embedded prompt lock was released`。

## 根因

`agents.defaults.compaction.memoryFlush.enabled = true` 令 compaction daemon 喺背景寫入 session files。當 Daily Maintenance isolated session release lock 等 DeepSeek API response 時，compaction 同步改咗個 `.jsonl` file → lock re-acquire 時 hash mismatch → error。

## 已執行

- [x] 清除孤兒 session file（da135e7b）
- [x] Daily Maintenance cron model 改為 `minimax-portal/MiniMax-M2.7`（避免 DeepSeek 90s+ timeout）
- [x] `memoryFlush.enabled` 已重新啟用（Josh 要求保留）

## 觀察期（5日）

- [ ] Day 1 — 2026-05-31 05:00 ✅ / ❌
- [ ] Day 2 — 2026-06-01 05:00 ✅ / ❌
- [ ] Day 3 — 2026-06-02 05:00 ✅ / ❌
- [ ] Day 4 — 2026-06-03 05:00 ✅ / ❌
- [ ] Day 5 — 2026-06-04 05:00 ✅ / ❌

## 判定標準

- 5 日內有 >= 1 次 error → 問題未解決，需要揾其他方案
- 5 日內全部 ✅ → MiniMax 方案有效

## 連結

- Session: da135e7b-e6ba-4106-81d7-d9674e55ac14
- Cron ID: aee7c6d9-8c07-43e9-8395-830fc0a8db62
