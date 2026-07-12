---
id: 102
title: L0/L1 Quality - 每日摘要質素提升
status: archive
priority: P2
created: 2026-04-16
due: 2026-06-01
updated: 2026-07-12
progress: 0/0
---

# Issue #102: L0/L1 Quality - 每日摘要質素提升

## 📋 任務目標
提升 L0/L1 每日記憶摘要的質量，確保 AI 生成有意義的 summary。

## 📅 建立日期
2026-04-16

## 背景資料

### L0/L1 記憶系統
| 層級 | 時間 | 功能 | 模型 |
|------|------|------|------|
| L0 | 00:05 daily | 200字精華摘要 | Ollama gemma4:e2b |
| L1 | 00:35 daily | 600字詳細摘要 | Ollama gemma4:e2b |

### 輸入來源
- L2: `memory/YYYY-MM-DD-HHMM.md` (每 2 小時歸檔的原始對話)
- 昨日 L2 → 今日 L0/L1 生成

### 現有問題
1. **摘要可能重複** - 如果對話內容單調，summary 會相似
2. **Context 限制** - gemma4:e2b 可能 miss 重要細節
3. **時間點問題** - 00:05/00:35 生成，但可能仲有新對話

## 觀察項目

### 質素指標
- [ ] L0/L1 嘅 summary 係咪反映出今日重要事件？
- [ ] 有冇重複內容？（與昨日/前幾日相比）
- [ ] 關鍵决策/教訓係咪有記錄？
- [ ] 用家可以從 summary 快速了解今日發生咩事？

### 模型比較
- 現有：gemma4:e2b (Ollama, 2B params)
- 考慮：qwen2.5:3b (可能更好的繁體中文理解)
- 考慮：MiniMax (更高質量但有 API cost)

## Progress

- [ ] Step 1: 分析最近 7 日的 L0/L1，識別 pattern
- [ ] Step 2: 比較 gemma4 vs qwen2.5 输出一致性
- [ ] Step 3: 根據分析結果制定改善方案
- [ ] Step 4: Implement 並觀察效果

## 預期成果

改善後的 L0/L1 應該：
1. 每日有独特內容（唔會大量重複）
2. 包含重要决策和教訓
3. 用家可以快速回顧今日
4. 為 SOUL.md 提供有價值的 learning signal

## Notes

參考 Issue #096 (L0/L1/L2 記憶系統觀察) - 該 issue 專注於架構，呢個專注於質素。

*Updated: 2026-04-16 | Priority: P2 | Due: 2026-05-20*
