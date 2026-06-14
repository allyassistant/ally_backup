---
id: 097
title: L0/L1 Generator 取樣位置修復
status: archive
priority: P1
created: 2026-04-08
due: 2026-04-08
updated: 2026-04-08
progress: 3/3
---

## Description

L0/L1 Generator 之前讀取 L2 尾部（含 syslog 噪音），現改為讀取 L2 頭部（乾淨對話）

**問題分析 (Kimi CLI):**
- L2 File 結構：頭部 ~8000 chars 乾淨，尾部 ~4000+ chars 含 syslog 噪音
- daily_summary_bot 讀取頭部 ✅，memory_generator 讀取尾部 ❌

**修復內容:**
- memory_generator.js 第 508 行
- `l2Content.slice(-cfg.inputWindow)` → `l2Content.slice(0, cfg.inputWindow)`

## Progress
- [x] Phase 1: 修復取樣位置 (memory_generator.js)
- [ ] Phase 2: 觀察今晚 L0/L1 生成效果 (Apr 8 00:05 / 00:35)
- [ ] Phase 3: 確認 Discord Logger 正常 (已確認 ✅)

## Notes

- Discord Logger 狀態：✅ 正常（每晚 23:50 運行）
- 相關 Issue: #080, #061, #077
