---
id: 128
title: 6/13 final decision on multi-model routing (DeepSeek V4 Flash main + M3 premium, 7-day validation)
status: archive
priority: P0
created: 2026-06-05
due: 2026-06-13
updated: 2026-06-11
progress: 1/5
---

## F - Facts（事實）
> 確定已知的事實、數據、現狀

### 現況
- 原本 scope: 6/13 final decision = 揀 M3 main agent 定 alternatives
- 新 scope (2026-06-05 update): multi-model routing validation
  - DeepSeek V4 Flash 做 daily default (5 routes)
  - MiniMax M3 做 premium (2 routes: code/spawn)
- 7-day staging 期間 (6/5-6/11) 收集 multi-model metrics
- 6/12 review, 6/13 final go/no-go 決定

### 數據/證據
| 項目 | 值 |
|------|-----|
| Phase 1 7-day staging 期間 | 2026-06-05 → 2026-06-11 |
| Review window | 2026-06-12 |
| Final decision date | 2026-06-13 |
| 7 日 metrics collector cron | `55 23 * * *` 23:55 HKT daily |
| Rollup path | `metrics/YYYY-MM-DD.json` (auto-generated) |
| Pre-Phase 1 baseline | 938 entries decision_log (1.7% real model decisions, 100% fallback) |
| Expected cost saving | 50-65% on daily traffic (rough estimate) |
| Quality risk | `direct_answer` quality 可能略降 |

## D - Decisions（決定）
> 識別已做或待做的決定

### ✅ 已做決定
- 2026-06-05 決定: 6/13 final decision scope 改 multi-model validation
- 2026-06-05 決定: 7-day staging 收 2 種 model 嘅 distribution (deepseek count + M3 count + cost + quality)
- 2026-06-05 決定: Quality metric 喺 staging 期間以 (success rate) + (fallback rate) + (latency) 三維量度

### ⏳ 待做決定
- 2026-06-12 待做: Review 7-day metrics, 比較 deepseek vs M3 cost/quality
- 2026-06-13 待做: Final go/no-go 決定 (multi-model production rollout)
- 2026-06-12 待做: Cost saving threshold 點定 (5% / 10% / 20%)?
- 2026-06-12 待做: Quality regression threshold 點定 (e.g. direct_answer success rate < 95% 就要 roll back?)

## Q - Questions（未解決）
> 列出所有未回答的問題

### ❓ 核心問題
1. DeepSeek V4 Flash 嘅 reasoning quality 同 M3 比較, 7 日 metrics 入面 quality metric 點量度?
2. Cost saving 達標 threshold (e.g. > 30%) 但 quality regress (e.g. direct_answer 答錯率升), 取捨點定?
3. Multi-model production rollout 後, 點 monitor 兩個 model 嘅 drift / degradation?
4. DeepSeek V4 Flash 暫時未公開 endpoint, 6/13 之前會唔會出? 如果 6/13 之前未出, fallback plan 係乜?
5. 5 條 daily routes 嘅 quality 入面 `direct_answer` 答錯率點 detect? (用 user feedback? 自動 eval?)

### 🔍 追問（蘇格拉底反詰）
- 6/13 final decision 真係 binary 嘅? 還是 spectrum (e.g. 4 條 deepseek + 3 條 M3)?
- 7 日 metrics 唔夠代表性點算 (e.g. 撞正週末 traffic 低)? 延 1 週?
- 假設 DeepSeek 出咗重大 incident (e.g. rate limit), 7 日內點 detect + fallback?
- Cost saving 達 50% 但 quality 跌 5%, trade-off 接受? 定 reverse?

## Progress
- [x] Issue #127 同步執行 — multi-model config change 100% done (8/9 progress), pending Josh ENV inject
- [ ] Josh inject ENV (DEEPSEEK_API_URL + DEEPSEEK_API_KEY) 啟動 active state
- [ ] 7-day staging 期間 metrics 收集 (6/5-6/11, auto via cron 23:55 HKT)
- [ ] 2026-06-12 Review 7-day metrics (deepseek vs M3 cost/quality)
- [ ] 2026-06-12 確認 cost saving + quality threshold
- [ ] 2026-06-13 Final go/no-go 決定 (multi-model production rollout)

## Notes
- Phase 1 fusion critical path 100% done
- Multi-model config (Issue #127) 8/9 done, ready for ENV inject
- 7-day staging 100% scaffold ready (metrics_collector + cron 23:55 HKT)
- 0% 影響原有 router system (try-catch fail-safe 100% 有效)
- T1-T13 13/13 PASS 確認 surgical config change 唔 break baseline
- Multi-model 屬於 Phase 1 enhancement, 唔影響 Phase 2 (Hermes 0.15.2) timeline
- Cost saving 預期 50-65% on daily traffic (pending 7-day metrics 驗證)
- Quality risk: `direct_answer` quality 可能略降 (DeepSeek reasoning 比 M3 弱) — mitigation: T1-T13 + 7-day staging 持續驗證
- 相關: Issue #127 (multi-model config change 8/9 done), Issue #120 (SPAWN routing enforcement 5/14 progress, 對齊 6/13 timeline)

### 2026-06-05 01:36 — Multi-model config 100% done, 1/5 progress (Issue #127 完成 → 等 ENV inject 啟動 staging)

**Next milestone triggers**:
1. Josh `export DEEPSEEK_API_URL=*** && export DEEPSEEK_API_KEY=***` (or set 喺 shell rc)
2. 跑 `node /tmp/verify_routeModel_smoke.js` 確認 `provider: deepseek` 真 work for `direct_answer` route
3. 跑 sessions_spawn boundary check 確認 OpenClaw core 認 `deepseek/*` prefix
4. 7-day staging 自動啟動 (cron 23:55 HKT daily 收集 metrics)
5. 6/12 review, 6/13 final go/no-go 決定
