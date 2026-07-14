---
id: 192
title: 觀察新版 Memory Generator 質量 (L0/L1/L2)
status: active
priority: P2
created: 2026-07-14
due: 2026-07-21
updated: 2026-07-14
progress: 0/0
---

## F - Facts（事實）

### 現況
- **L0 (July 13):** 375 bytes，太薄，只係 bullet list，冇 synthesis
- **L1 (July 12):** 2025 bytes，有啲 pattern 識別但偏 mechanical
- **L2 (July 13):** 7166 bytes，大量重複 cron watcher 訊息（"All clear" 出現 6+ 次）

### 數據/證據
| 層級 | 日期 | 大小 | 問題 |
|------|------|------|------|
| L0 | 2026-07-13 | 375 bytes | 太薄、冇 synthesis |
| L1 | 2026-07-12 | 2025 bytes | mechanical 描述多過分析 |
| L2 | 2026-07-13 | 7166 bytes | 太多重複 system logs |

### 已做改動
- EXPERT_ROLE_PROMPT v4：加入業務聯想、跨日 pattern、噪音過濾指引
- L0 wordRange：150-200 → 200-300 字
- L0 detailInstruction：移除「禁止具體數字」，加 synthesis 要求
- L1 wordRange：500-600 → 500-700 字
- L1 detailInstruction：加強分析深度、減少 mechanical 描述
- isNoiseLine()：新增 8 個 cron watcher / system status 過濾規則

## D - Decisions（決定）

### ✅ 已做決定
- 2026-07-14：Josh 批准新版 memory_generator.js 改動

### ⏳ 待做決定
- 2026-07-15：評估新版 L0/L1 質量，決定係咪要 further tuning

## Q - Questions（未解決）

### ❓ 核心問題
1. 新版 prompt 能否有效提升 L0/L1 質量？
2. 噪音過濾是否足夠（cron watcher 重複訊息）？
3. 聽日生成的 L0/L1 係咪有明顯改善？

### 🔍 追問
- 如果 L0 仍然太薄，係 prompt 問題定 model 問題？
- L1 分析深度提升幾多 %？
- L2 filter 係咪有效去除 50%+ 重複訊息？

## Progress
- [x] 2026-07-14 00:39: Josh 審批新版 prompt 改動
- [ ] 2026-07-15 00:05: 檢查新版 L0 質量
- [ ] 2026-07-15 00:35: 檢查新版 L1 質量
- [ ] 2026-07-21: 最終評估，決定係咪 close 或 further tuning

## Notes
- L0/L1 cron jobs: 00:05 / 00:35 daily (Asia/Hong_Kong)
- 觀察期: 7 days (2026-07-14 → 2026-07-21)
- 評估標準: 字數是否达标、是否有 synthesis、噪音比例是否下降
