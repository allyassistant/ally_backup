---
id: 080
title: Ollama 模型測試結果記錄
status: archive
priority: P2
created: 2026-04-03
due: 2026-04-10
updated: 2026-04-09
progress: 2/3
---

## Description
記錄 Ollama 模型測試結果，包括 Gemma 4:e4b、e2b 和 Qwen 2.5:3b 的速度、RAM 佔用、質量比較

## Progress
- [x] 測試記錄
- [ ] 更新 TOOLS.md（模型選擇建議）
- [ ] 更新 MEMORY.md（如有需要）

## 📊 測試結果

### 速度對比
| 模型 | 速度 | 備註 |
|------|------|------|
| Qwen 2.5:3b | ~14 秒 | 最快 |
| Gemma 4:e2b | ~45 秒 | 中等 |
| Gemma 4:e4b | ~31 秒 | 較慢 |

### RAM 佔用對比
| 模型 | 模型大小 | Wired Memory | 備註 |
|------|----------|--------------|------|
| Qwen 2.5:3b | ~2 GB | ~1 GB | 極低 |
| Gemma 4:e2b | 7.2 GB | ~7.4 GB | 中等 |
| Gemma 4:e4b | 9.6 GB | ~11 GB | 極高 |

### 完整比較表
| 指標 | Qwen 2.5:3b | Gemma 4:e2b | Gemma 4:e4b |
|------|-------------|--------------|--------------|
| 速度 | ⚡⚡⚡ (~14秒) | ⚡ (~45秒) | ⚡⚡ (~31秒) |
| RAM 需求 | 🟢 極低 (~1GB) | 🟡 中 (~7.4GB) | 🔴 高 (~11GB) |
| VRAM | ~2GB | ~4GB | ~4-8GB |
| 質量 | 實用直接 | 詳細結構化 | 詳細+思考 |
| 適合 | 快速任務 | 中等推理 | 深度推理 |

## 💡 建議用途
- 日常快速任務 → Qwen 2.5:3b
- 23:59 每日總結 → Gemma 4:e2b（更安全）
- 深度代碼審計 → Gemma 4:e4b（如 RAM 允許）

## 備註
- Mac mini 16GB RAM
- Gemma 4:e4b 已刪除（RAM 佔用太高）
- 測試問題：「用繁體中文解釋乜嘢係 JWT token-based authentication，包括佢嘅優缺點」

## 改動記錄 (2026-04-03)

### daily_summary_bot.js 轉換
- 模型：qwen2.5:3b → gemma4:e2b
- 狀態：✅ 已完成
- 時間：2026-04-03 15:48 HKT
- 影響：今晚 23:59 每日總結將使用 Gemma 4:e2b 生成
