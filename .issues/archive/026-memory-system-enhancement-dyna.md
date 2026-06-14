---
id: 026
title: Memory System Enhancement - Dynamic Priority Management
status: archive
priority: P2
created: 2026-03-01
due: 2026-04-15
updated: 2026-03-26
progress: 0/3
---

## Description
參考 Memory-Like-A-Tree 概念，改良現有 P0-P3 記憶優先級系統，加入動態升級/降級機制。

## 背景
- 原文：https://www.youtube.com/watch?v=xxx (OpenClaw丨我的龍蝦為自己種了一棵會迭代的記憶樹)
- 原作者：@Lory
- 現有架構：L0/L1/L2 三層記憶 + P0-P3 四級優先級

## 改良方案 (簡化版)

### Auto-Promote 自動升級
```
P1 知識如果被引用 3 次 → 自動升級為 P0 (永不過期)
```
**例子：** 「Excel 置中格式」被引用 3 次後自動變 P0

### Auto-Demote 自動降級  
```
P2 知識如果 60日內無人引用 → 自動降級為 P3 (30日後刪除)
```
**例子：** 臨時設定無人用，提早清理慳空間

## 實際效果

| 指標 | 而家 | 改良後 |
|------|------|--------|
| 重要知識流失風險 | 中 (靠手動標 P0) | 低 (自動升級) |
| 過期垃圾堆積 | 中 (等 TTL) | 低 (提早降級) |
| MEMORY.md 大小 | 慢慢增長 | 更穩定 |
| 手動維護成本 | 要定期 review | 自動化 |
| 實現複雜度 | 簡單 | 中等 |

## 實現計劃

### Phase 1: 追蹤引用次數
- [ ] 修改 memory_search.js，記錄每個區域被引用次數
- [ ] 儲存引用數據到 `memory/reference-counts.json`

### Phase 2: 自動升級/降級
- [ ] 創建 `scripts/priority_manager.js`
- [ ] 實現 auto-promote (P1→P0，引用≥3次)
- [ ] 實現 auto-demote (P2→P3，60日無引用)
- [ ] 加入 heartbeat 每日運行

### Phase 3: 測試同微調
- [ ] 測試升級/降級邏輯
- [ ] 調整閾值 (3次/60日)

## 簡化實現 (Heartbeat 集成)

```bash
# 每日 heartbeat 加呢兩句：
node scripts/priority_manager.js auto-promote  # P1→P0
node scripts/priority_manager.js auto-demote   # P2→P3
```

## 建議啟動時機
- 當 MEMORY.md 超過 1000 行
- 或 P1/P2 區域數量超過 50 個

## 與現有系統對比

| 特性 | 現有 (L0/L1/L2 + P0-P3) | Memory-Like-A-Tree | 改良後 (混合) |
|------|------------------------|-------------------|--------------|
| 核心理念 | 時間維度 + 重要性維度 | 使用頻率 + 置信度衰減 | 時間 + 動態重要性 |
| Decay 機制 | TTL (180/90/30日) | 每日 -0.004 ~ -0.008 | TTL + 引用檢查 |
| 升級機制 | 無 (P級固定) | 使用時 +0.03 ~ +0.95 | 引用≥3次自動升 |
| 實現複雜度 | 簡單 | 複雜 (每2小時 indexing) | 中等 (每日) |
| 可預測性 | 高 | 中 | 高 |

## 決策
暫時唔實現，等記憶檔案大到需要時先啟用。但已設計好方案，可以一鍵實施。

---

*Created: 2026-03-01*
*参考: Memory-Like-A-Tree by @Lory*

## 2026-03-16 Update

Extended to 2026-04-15. Waiting for trigger condition:
- MEMORY.md > 1000 lines (current: check with wc -l)
- OR P1/P2 sections > 50

Design is complete. Ready to implement when triggered.
