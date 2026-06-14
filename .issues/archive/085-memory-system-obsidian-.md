---
id: 085
title: Memory System: 實現 Obsidian 風格混合連結制
status: archive
priority: P2
created: 2026-04-05
due: 2026-04-19
updated: 2026-04-16
progress: 0/3
---

## Description

借鑒 Obsidian 架構優化 Memory 系統，建立混合制連結系統。

## Kimi 分析結論

### 混合制連結格式

| 內容類型 | 格式 | 例子 |
|---------|------|------|
| 每日對話記錄 | 日期制 | `[[2026-04-05]]` |
| 主題知識頁 | 主題制 | `[[Stock Processing]]` |
| Issue 頁面 | 主題制 | `[[Auto Dreaming]]` |
| L0/L1 摘要 | 日期制 | `[[2026-04-05-L1]]` |
| 錯誤記錄 | 主題制 | `[[Error: API Aborted]]` |

### 三階段實施

**Phase 1：基礎建設（1-2日）**
- [ ] 創建 `memory/topic-graph.json` 索引
- [ ] 創建連結解析工具 `scripts/memory_link_resolver.js`
- [ ] 更新 `memory/errors.json` schema 加入 `links` 欄位

**Phase 2：內容標記（持續）**
- [ ] 新 Memory 檔案加入連結
- [ ] 為重要 Issue 添加 `memoryLinks` 欄位

**Phase 3：自動化整合（1週）**
- [ ] 修改 L0/L1 Generator 自動插入主題連結
- [ ] 建立反向連結功能

## 風險評估

| 風險 | 可能性 | 影響 |
|------|--------|------|
| 連結解析歧義 | 中 | 中 |
| 檔案重命名後連結失效 | 高 | 中 |
| 現有檔案冇連結導致斷層 | 高 | 低 |

## 相關分析檔案

- `.analysis/option3_analysis.md` - Kimi 初步分析
- `.analysis/date_vs_topic.md` - Kimi 詳細建議

## Status Notes

- 2026-04-05: Issue created based on Kimi Code CLI analysis
