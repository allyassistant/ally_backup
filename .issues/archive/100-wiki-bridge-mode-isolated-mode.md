---
id: 100
title: Wiki Bridge Mode - 改為 Isolated Mode
status: archive
priority: P2
created: 2026-04-10
due: 2026-05-10
updated: 2026-05-23
progress: 0/3
---

## Description

研究後決定保持現有 memory scripts，改為 isolated mode 消除 warning。

## 研究結論

### Bridge Mode 問題
- Bridge mode 從 memory-core plugin 讀取 artifacts
- 我哋所有 memory scripts (L0/L1/L2) 都直接操作 `memory/` 目錄，唔經 memory-core plugin
- `agents.list` 係空，所以 bridge queue 永遠係 empty
- Warning 訊息：「Bridge mode is enabled but the active memory plugin is not exporting any public memory artifacts yet.」

### 兩種模式比較
| Mode | 用途 | 適合我哋？|
|------|------|----------|
| **bridge** | 從 memory-core plugin 讀取 artifacts | ❌ 唔需要 |
| **isolated** | 直接 file-based ingest | ✅ 係 |

### 結論
- Memory-core plugin 唔會令記憶生成更可靠
- 我哋現有系統完整，唔需要為「官方」改架構
- 改為 isolated mode 即可消除 warning

## Action Plan

- [ ] 執行：`openclaw config set plugins.entries.memory-wiki.config.vaultMode "isolated"`
- [ ] Restart gateway
- [ ] 驗證 warning 消失

## 相關檔案

- Wiki 設定：`~/.openclaw/wiki/main/.openclaw-wiki/state.json`
- Bridge state：`~/.openclaw/wiki/main/.openclaw-wiki/bridge-state.json`

## 備註

已取消 4 個 Wiki cron jobs 的 Discord 通知（2026-04-10 02:38）
