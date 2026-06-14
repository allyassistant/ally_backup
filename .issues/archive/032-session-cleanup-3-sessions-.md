---
id: 032
title: Session Cleanup 改為 3 日並加入活躍 sessions 歸檔
status: archive
priority: P2
created: 2026-03-11
due: 2026-03-20
updated: 2026-03-18
progress: pending
---

## Description

觀察 L0/L1 生成系統是否正常運作 3 日，確認唔會失憶後，先至 implement session cleanup 改為 3 日。

## 背景

- 現有 session cleanup 清理 7+ 日既 sessions
- 改為 3 日
- 加入活躍 sessions 歸檔功能（寫入 Apple Notes + memory/_archive/）

## 觀察項目

- [ ] L0 (每日 00:05) 正常生成
- [ ] L1 (每日 00:35) 正常生成
- [ ] Discord Channel Logger (23:30) 正常生成
- [ ] 記憶系統完整，問過往事項有回應

## Note

因為 L0/L1/L2 架構既設計，session cleanup 唔會令我失憶：
- L2 = daily memory (永久)
- L1 = topics/decisions (永久)
- L0 = abstract (永久)

## Progress
- [ ] 觀察 3 日
- [ ] 確認 L0/L1 正常
- [ ]  implement cleanup changes
