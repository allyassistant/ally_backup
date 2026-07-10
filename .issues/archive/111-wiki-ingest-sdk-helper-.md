---
id: 111
title: Wiki ingest SDK helper — 觀察一星期
status: archive
priority: P2
created: 2026-05-19
due: 2026-06-09
updated: 2026-06-18
progress: 1/7: ✅ Dry run 3/3 passed
---

## 目的

觀察 `openclaw wiki ingest` CLI timeout hang fix 之後一星期有冇出現問題。

## 背景

兩個 cron jobs（Wiki Daily Ingest 01:00、Knowledge Base Daily Ingest 06:00）一直 timeout：
- `spawnSync('openclaw wiki ingest', timeout: 30000)` → CLI 內部 model call hang 喺 "model-call-started"
- cron timeout 300s → 成個 job 死

**Fix 演進：**
1. ~~SDK direct import~~（v1.0，但 SDK 冇 exposed ingest 功能）
2. ✅ **v3.0/v1.2 — async spawn + direct write fallback**（2026-06-02 已 deploy）

**Fix 細節：**
- `knowledge_ingester.js` v3.0: `tryWikiIngestSpawn()` — async spawn `openclaw wiki ingest`，300s timeout，fail → direct write fallback
- `wiki_ingest_helper.mjs` v1.2: `tryCliIngestAsync()` — async spawn + 300s timeout + resolve(false) bug fix + direct write fallback
- Cron timeout: 300s → **600s**（比 script internal timeout 多一倍 buffer）

## 觀察點

| 日期 | 結果 |
|------|------|
| 2026-06-02 | ✅ Dry run 3/3 通過 (knowledge_ingester + wiki_ingest_helper) |
| 2026-06-03 01:00 + 06:00 | |
| 2026-06-04 01:00 + 06:00 | |
| 2026-06-05 01:00 + 06:00 | |
| 2026-06-06 01:00 + 06:00 | |
| 2026-06-07 01:00 + 06:00 | |
| 2026-06-08 01:00 + 06:00 | |

## 驗證方法

檢查 ⚙️系統 channel 嘅 cron job delivery：
- 06:00 Knowledge Base Daily Ingest — 唔應該再出現 error/timeout
- 01:00 Wiki Daily Ingest — 應該正常 ingest MEMORY.md + L0 + L1

## 完成條件

- [ ] Day 1: 2026-06-02 — Dry run 3/3 通過 ✅
- [ ] Day 2: 2026-06-03 01:00 + 06:00 — cron 成功
- [ ] Day 3: 2026-06-04 01:00 + 06:00 — cron 成功
- [ ] Day 4: 2026-06-05 01:00 + 06:00 — cron 成功
- [ ] Day 5: 2026-06-06 01:00 + 06:00 — cron 成功
- [ ] Day 6: 2026-06-07 01:00 + 06:00 — cron 成功
- [ ] Day 7: 2026-06-08 01:00 + 06:00 — cron 成功
- [ ] 連續一星期兩個 cron jobs 都 success，冇 timeout / hang
- [ ] 關閉此 issue
