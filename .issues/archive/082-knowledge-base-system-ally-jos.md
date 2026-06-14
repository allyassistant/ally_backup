---
id: 082
title: Knowledge Base System - Ally-Josh 共享知識庫
status: archive
priority: P2
created: 2026-04-04
due: 2026-05-01
updated: 2026-05-09
progress: 0/5
---

## Description

建立一個 Ally-Josh 共享知識庫，實現自動學習，仿照 Karpathy 的 LLM Knowledge Management 模式。

### 目標
- 自動學習我倆的重要決定、偏好、人脈關係
- 跨 Session 恢復上下文
- 提升對話質量和長期項目追踪

### 目標架構
```
memory/
├── knowledge/            # 新增：核心知識庫
│   ├── decisions/       # 重要決定
│   ├── preferences/     # Josh 的偏好
│   ├── people/          # 人脈關係
│   └── context/         # 長期背景
├── patterns/           # 現有
├── l0-abstract/        # 現有
├── l1-overview/        # 現有
└── sessions/           # 現有
```

### Kimi Code CLI 分析結論

**可行性：** ⭐⭐⭐⭐☆（合理但有風險）

**主要風險：**
- LLM 判斷錯誤可能誤解偏好
- 知識腐敗 (Knowledge Rot)
- 需三級驗證機制

**優先級建議：**
1. Phase 1: preferences + 手動觸發 ✅ 立即做
2. Phase 2: decisions + Project 綁定 ✅ 短期做
3. Phase 3: people + 自動提取 ⚠️ 中期做
4. Phase 4: context + 自動 decay ❌ 最後做

**混合模式：**
- 自動提取 → 低風險、大量 → AI 管理
- 人手整理 → 高風險、核心 → Josh 確認

### 三級驗證機制
```
Level 1: AI 自我檢查 → 置信度 > 0.8
Level 2: 模式驗證 → 同一知識出現 >= 3 次
Level 3: 用戶確認 → 涉及 preferences/decisions
```

### 避免陷阱
- ❌ 全自動無監督 → ✅ 分級驗證
- ❌ 大量細分目錄 → ✅ 扁平結構 + metadata
- ❌ 覆蓋 AGENTS.md → ✅ 補充而非取代
- ❌ 無限累積 → ✅ TTL + decay

## Progress

### Phase 1: 基礎架構 + 手動觸發
- [ ] 建立 knowledge/ 目錄結構
- [ ] 實現「記住...」觸發機制
- [ ] 建立 preferences schema
- [ ] 設計驗證機制

### Phase 2: Decisions + Project 綁定
- [ ] 實現 decisions extraction
- [ ] Project 狀態變更觸發
- [ ] Backlinks 生成

### Phase 3: People + 自動提取
- [ ] 實現 people extraction
- [ ] 自然語言查詢介面
- [ ] 自動學習優化

### Phase 4: Context + 維護
- [ ] TTL + Decay 機制
- [ ] 衝突解決
- [ ] Consolidation 腳本

### Phase 5: 整合與測試
- [ ] 與現有 memory 系統整合
- [ ] Cross-session 恢復測試
- [ ] Kimi 效能評估

## Notes

**參考：** Karpathy LLM Knowledge Management (2026-04-04)
**分析工具：** Kimi Code CLI
**風險評估：** 中等 — 需持續監控和調整
