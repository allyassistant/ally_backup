---
id: 017
title: Obsidian 整合方案 - 建立長期記憶系統
status: archive
priority: P2
created: 2026-02-24
due: 2026-03-31
updated: 2026-03-26
progress: 0/0
---

## Description

將 OpenClaw Agent 既產出同步到 Obsidian，建立長期記憶系統。

### 背景
而家既記憶系統：
- Session Reset → 短期記憶清空
- MEMORY.md → 要人手維護，容易過期
- Apple Notes → 冇雙鏈功能，AI 難讀取

### 方案概念
```
Telegram → OpenClaw Agent → 每日收集/創作/分析
    ↓
自動寫入 Obsidian 對應目錄
    ↓
Agent 可以反查歷史，實現真正長期記憶
```

### 優點
- ✅ 本地儲存，數據完全自己控制
- ✅ Markdown 格式，任何軟件都讀到
- ✅ 雙鏈筆記 `[[wikilinks]]` 建立知識網絡
- ✅ 比 Apple Notes 更適合結構化知識管理
- ✅ AI 容易讀取（純文字）
- ✅ 可用 Git 做版本控制

### 同 Apple Notes 分別
| 功能 | Obsidian | Apple Notes |
|------|----------|-------------|
| 儲存 | 本地 | iCloud |
| 格式 | Markdown | 蘋果專用 |
| 連結 | `[[雙鏈]]` | 唔支援 |
| 搜索 | 極快 | 一般 |
| AI 讀取 | 容易 | 要 AppleScript |

### 實施步驟
- [ ] 評估現有 Apple Notes 內容轉移可行性
- [ ] 設置 Obsidian vault 結構
- [ ] 安裝 obsidian-cli 工具
- [ ] 開發同步腳本
- [ ] 整合到 Heartbeat 系統
- [ ] 測試雙向同步
- [ ] 完整文檔

### 參考資源
- Obsidian: https://obsidian.md
- obsidian-cli: https://github.com/yakitrak/obsidian-cli

## Notes

**狀態：** ⏸️ 待討論，暫時用 Apple Notes 繼續

**提出日期：** 2026-02-24

**優先級：** P2（重要但非緊急）
