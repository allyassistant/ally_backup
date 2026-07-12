---
id: 159
title: KB Ingest --no-llm quality + infer endpoint fix
status: archive
priority: P1
created: 2026-06-13
due: 2026-06-20
updated: 2026-07-12
progress: 0/0
---

## F - Facts（事實）
> 確定已知的事實、數據、現狀

### 現況
- KB Ingest cron (`9ebd92c9-c19e-47e8-a43f-3c940ecfdede`) 改用 `--no-llm` flag，bypass LLM classifier，直接用 keyword 模式分類
- 改動於 2026-06-13 23:25 HKT 套用
- Cron 排程：每日 06:25 HKT
- 之前 error 模式：580s timeout (`LLM request failed.`) 連續多日

### 數據/證據（M3 diagnostic）
| Metric | 之前 (LLM mode) | 之後 (--no-llm) |
|--------|----------------|----------------|
| Cron duration | 580s (timeout, exit 1) | TBD |
| 100 msgs 處理時間 | ~2000s (理論) / 580s (cron cut) | TBD |
| 分類方法 | LLM (M2.7 16.5s → deepseek 3s) | Keyword regex 5 categories |
| 分類準確度 | ~90-95% (LLM 估算) | ~70-80% (keyword 估算) |
| 連續 errors | 3+ | TBD (Day 1-7) |

### 580s timeout root cause (M3 診斷)
- M2.7 latency 9.5-23s vs 30s per-call timeout → 經常 exceed
- M2.7 timeout → fallback deepseek 3s → 成功
- Net: ~18-23s/msg × 100 msgs = ~2000s (cron 580s cutoff kill)
- 「LLM request failed.」其實只係 M2.7 慢 + timeout，唔係真死

## D - Decisions（決定）
> 識別已做或待做的決定

### ✅ 已做決定
- [2026-06-13 23:25] 決定：cron argv 加 `--no-llm` flag 緊急 fix 580s timeout
- [2026-06-13 23:30] 決定：觀察 7 日 keyword 分類質量後再決定 LLM mode 點整
- [2026-06-13 23:30] 決定：keyword-only 暫時夠用，唔急住重排 model fallback

### ⏳ 待做決定（Day 7 評估後）
- [2026-06-20] 待定：keyword 質量 OK？→ 永久留 keyword-only
- [2026-06-20] 待定：質量唔夠？→ 實作 LLM-mode config toggle
- 觸發條件：見下方 Closing criteria

## Q - Questions（未解決）
> 列出所有未回答的問題

### ❓ 核心問題
1. **Keyword classifier 質量真係夠用？** — 70-80% 估算 vs LLM 90-95%，損失幾多 insight？
2. **錯誤分類走咗去邊？** — 睇 daily summary output 有冇明顯 misclassify (e.g. 技術文入咗 insight)
3. **Discord #⚙️系統 summary 仲有冇「100/100 成功」訊息？** — 觀察 run 仲有冇真正完成
4. **M2.7 真係 always slow 定係 peak hour 慢？** — 之後整返 LLM mode 要唔要 schedule avoidance？

### 🔍 追問（蘇格拉底反詰）
- 點解唔直接用 `minimax-portal/MiniMax-M2.7` 取代 deepseek 做 fallback？（已知 M2.7 慢）
- 100 條 msg 入面有幾多真係「需要 LLM 理解」？可能 keyword 對 80% 已經夠
- 如果 --no-llm 質量 OK，係咪應該 document 落 AGENTS.md 當 best practice？
- 有冇可能 keyword classifier 本身太 broad，導致 80% 全部入 `default` bucket？

## Progress
- [x] Day 0 (2026-06-13): Apply `--no-llm` cron fix
- [ ] Day 1-2 (2026-06-14 ~ 2026-06-15): 觀察 2 個 cron run
- [ ] Day 3 (2026-06-16): Mid-check，睇 run 模式
- [ ] Day 5 (2026-06-18): 後段評估
- [ ] Day 7 (2026-06-20): Closing decision
- [ ] Closing 後：更新 closure section + 決定 LLM-mode config 實作與否

### Day-by-day 觀察 checklist
- Day 1 (06-14 06:25 HKT 跑完之後):
  - [ ] `openclaw cron runs 9ebd92c9-c19e-47e8-a43f-3c940ecfdede --limit 1` 睇 status
  - [ ] 預期：`status=ok`, `durationMs < 60000` (1 min)
  - [ ] Discord #⚙️系統 收到 summary 唔係 LLM 解讀版（會有少少 format 差異）
- Day 3-5: 同上 check，睇有冇 regression 或 misclassify
- Day 7: 跑 closing criteria 評估

### Closing criteria (Day 7 評分)
- ✅ **PASS** (永久留 keyword-only): 7 個 run 全 success AND duration < 60s AND 0 嚴重 misclassify
- 🟡 **PARTIAL** (延 7 日再睇): 6/7 success OR duration < 120s OR 有少少 misclassify
- 🟠 **NEEDS MORE** (實作 LLM-mode config): 4-5/7 success OR duration 120-300s
- 🔴 **REGRESSION** (立即 rollback + 重整): ≤3/7 success OR 出現 P0 issue

### Rollback plan
- **完整 revert**: `openclaw cron edit 9ebd92c9-c19e-47e8-a43f-3c940ecfdede --command-argv '["node", "/Users/ally/.openclaw/workspace/scripts/knowledge_ingester.js", "--discord-channel", "1473376125584670872"]'` 1 分鐘
- **改行 deepseek-first**: 重排 `knowledge_classifier.js:60-61` LLM_MODELS array
- **觸發條件**: 連續 3 日失敗 / 0% success rate / 出現 P0 分類錯誤 (e.g. security sensitive 入錯 bucket)

## Notes
### LLM-mode reactivation plan (deferred, Day 7+ 考慮)
如果 keyword 質量唔夠，實作 config-based toggle：

1. **Reorder model fallback** — `knowledge_classifier.js:60-61` LLM_MODELS:
   ```js
   const LLM_MODELS = [
     'deepseek/deepseek-v4-flash',  // 2.8s, fast
     'minimax-portal/MiniMax-M2.7'  // 16.5s, slow fallback
   ];
   ```
2. **Lower timeout**: 30s → 15s (fail fast)
3. **Env var toggle**: 加 `KB_INGEST_USE_LLM=true` check
4. **Auto-disable**: 3 consecutive fails → 6h cooldown
5. **Cron command**: `KB_INGEST_USE_LLM=true node knowledge_ingester.js --discord-channel X`

### Cross-references
- Memory: `memory/2026-06-13.md` (KB Ingest --no-llm fix section)
- M3 sub-agent: `agent:main:subagent:9ae7d221-0a8d-41f7-8183-32ac1da72a07` (infer endpoint diagnostic)
- Cron: `9ebd92c9-c19e-47e8-a43f-3c940ecfdede`
- Related: issue #149 (skill pipeline 觀察期, 7-day template reference)

### Metrics sources
- `openclaw cron runs 9ebd92c9-c19e-47e8-a43f-3c940ecfdede --limit 7`
- Discord #⚙️系統 (kb ingest summary 推送 channel 1473376125584670872)
- `memory/2026-06-14.md` ~ `2026-06-20.md` (L2 daily logs)
