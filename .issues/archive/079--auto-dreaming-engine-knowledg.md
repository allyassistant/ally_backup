---
id: 079
title: 自動做夢 (Auto Dreaming) - Engine + Knowledge Base 整合
status: archive
priority: P2
created: 2026-04-02
due: 2026-04-30
updated: 2026-04-16
progress: 0/10
---

## 最終架構：**Engine + Storage 分層**

```
Auto Dreaming (引擎) ──→ Knowledge Base (存儲)
     │                         │
  發現/分析                結構化存儲
  觸發/整理                驗證/TTL
```

### 兩層分工

| 層 | 職責 | Scripts |
|----|------|---------|
| **Engine (Auto Dreaming)** | 自動發現、分析、觸發、整理 | heartbeat_recall, cross_session_context, pattern_analysis, memory_temporal_search |
| **Storage (Knowledge Base)** | 結構化存儲、驗證、decay | kb_*, preferences/, decisions/, people/ |

---

## 概念

模仿人類睡眠時的「做夢」機制，喺後台自動整理對話記憶 + 建立共享知識庫。

---

## Scripts 對應表

| Script | 歸屬 | 職責 |
|--------|------|------|
| `heartbeat_recall.js` | **引擎** | 觸發時機 |
| `memory_temporal_search.js` | **引擎** | 查詢介面 |
| `cross_session_context.js` | **引擎** | 跨Session分析 |
| `pattern_analysis_daily.js` | **引擎** | 規律發現 |
| `memory_generator.js` | **引擎** | L0/L1生成 |
| `preference_tracker.js` | **存儲** | 整合→knowledge/preferences/ |
| `(新) kb_decisions.js` | **存儲** | decisions/ |
| `(新) kb_people.js` | **存儲** | people/ |
| `(新) kb_backlinks.js` | **存儲** | backlinks/ |
| `(新) kb_ttl_decay.js` | **存儲** | TTL+Decay |

---

## 優先整合步驟

| 優先 | Phase | 工作 | 說明 |
|------|-------|------|------|
| **P1** | Phase 1 | 統一偏好系統 | `preference_tracker.js` → `knowledge/preferences/` |
| **P1** | Phase 2 | 統一 Context 存儲 | 消除 context 重疊 |
| **P1** | Phase 7 | 整合 Weekly Correction Loop | Engine 餵給 KB |
| **P2** | Phase 3 | 新增 Decisions | `kb_decisions.js` |
| **P2** | Phase 4 | 新增 People | `kb_people.js` |
| **P2** | Phase 5 | 新增 Backlinks | `kb_backlinks.js` |
| **P3** | Phase 6 | TTL + Decay | `kb_ttl_decay.js` |

---

## Knowledge Base 存儲結構

```
memory/knowledge/
├── preferences/           # 偏好（Phase 1）
│   └── josh-preferences.md
├── decisions/             # 決定（Phase 3）
│   └── YYYY-MM-DD-[hash].md
├── people/               # 人脈（Phase 4）
│   └── [name].md
├── context/             # 長期背景（Phase 2）
│   └── relationship.md
└── backlinks/           # 關聯（Phase 5）
    └── index.json
```

---

## 三級驗證機制

```
Level 1: AI 自我檢查 → 置信度 > 0.8
Level 2: 模式驗證 → 同一知識出現 >= 3 次
Level 3: 用戶確認 → 涉及 preferences/decisions
```

---

## 避免陷阱

| ❌ 唔好做 | ✅ 應該做 |
|----------|----------|
| 全自動無監督 | 分級驗證 |
| 完全融合兩系統 | Engine + Storage 分層 |
| 過度細分目錄 | 扁平結構 + metadata |
| 無限累積 | TTL + Decay |

---

## Progress

### Phase 1: 統一偏好系統 (P1)
- [ ] 創建 `knowledge/preferences/` 目錄
- [ ] `preference_tracker.js` → 寫入 `knowledge/preferences/`
- [ ] 設計 preferences schema
- [ ] 消除與 USER.md 重疊

### Phase 2: 統一 Context 存儲 (P1)
- [ ] 定義 context 範圍
- [ ] 消除與 L1 Overview 重疊
- [ ] Engine 負責整理，KB 負責存儲

### Phase 3: Decisions (P2)
- [ ] 建立 `kb_decisions.js`
- [ ] decisions extraction
- [ ] Project 狀態變更觸發
- [ ] Backlinks 生成

### Phase 4: People (P2)
- [ ] 建立 `kb_people.js`
- [ ] people extraction
- [ ] 與 USER.md 整合

### Phase 5: Backlinks (P2)
- [ ] 建立 `kb_backlinks.js`
- [ ] 自動生成關聯
- [ ] 索引優化

### Phase 6: TTL + Decay (P3)
- [ ] 建立 `kb_ttl_decay.js`
- [ ] 防止知識腐敗
- [ ] 衝突解決

### Phase 7: 整合 Weekly Correction Loop (P1)
- [ ] WCL output → KB input
- [ ] Engine 餵給 Storage
- [ ] 雙向同步

---

## 風險評估

| 風險類型 | 等級 | 緩解措施 |
|----------|------|----------|
| 複雜度 | ★★★☆☆ | 分 Phase 控制 |
| 破壞性 | ★★☆☆☆ | 保持 API 兼容 |
| 過度工程 | ★★★☆☆ | Phase 6 延後 |

---

## Notes

**靈感來源：** 人類睡眠時整理日間記憶的機制
**參考：** Karpathy LLM Knowledge Management (2026-04-04)
**分析工具：** Kimi Code CLI
**架構結論：** Engine + Storage 分層 (2026-04-04)
**風險評估：** 中等 — 需持續監控和調整
