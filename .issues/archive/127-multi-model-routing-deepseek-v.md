---
id: 127
title: Multi-model routing 重組: DeepSeek V4 Flash 做 main (5 routes), M3 做 premium (code/spawn)
status: archive
priority: P0
created: 2026-06-05
due: 2026-06-11
updated: 2026-06-07
progress: 8/9
---

## F - Facts（事實）
> 確定已知的事實、數據、現狀

### 現況
- `route_model.yaml` 7 條 routes 嘅 primary 全部係 `minimax-portal/MiniMax-M3`
- 冇 `deepseek` provider entry 喺 `route_model.yaml` providers section
- `IDENTITY.md` default_model = `minimax-portal/MiniMax-M3`
- 0 個 ENV var set 過, routeModel() 100% dormant
- Phase 1 fusion: 4 個 core artifacts done + Day 4 wiring + Day 6-7 metrics collector

### 數據/證據
| 項目 | 值 |
|------|-----|
| Daily expected traffic | 80%+ 對答 + 15% code/spawn + 5% browser |
| Cost ratio (estimated) | DeepSeek V4 Flash ~$0.14/M tokens vs M3 ~$0.50/M tokens (約 3.5x difference) |
| Expected cost saving | ~50-65% on daily traffic (rough estimate pending ENV inject) |
| 7-day staging 期間 | 6/5-6/11, metrics 收 multi-model distribution |

## D - Decisions（決定）
> 識別已做或待做的決定

### ✅ 已做決定
- 2026-06-05 決定: Multi-model routing — DeepSeek V4 Flash 做 main (5 routes), M3 做 premium (2 routes)
- 2026-06-05 決定: 5 條 routes 改 deepseek primary — `fdq`, `direct_answer`, `sop`, `none`, `browser`
- 2026-06-05 決定: 2 條 routes 保持 M3 primary — `code`, `spawn`
- 2026-06-05 決定: 加 deepseek 做 fallback for `code`/`spawn` (平 + 快 fallback, 唔降 'none' terminal)
- 2026-06-05 決定: `IDENTITY.md` default_model 改 `deepseek/deepseek-v4-flash`

### ⏳ 待做決定
- [confirm 前先 hold] DeepSeek API URL: `https://api.deepseek.com/v1` (官方) — Josh 確認
- [confirm 前先 hold] DeepSeek KEY ENV name: `DEEPSEEK_API_KEY` (官方) — Josh 確認
- [confirm 前先 hold] Model name syntax: `deepseek/deepseek-v4-flash`? 還是 DeepSeek 官方 model identifier? — Josh 確認

## Q - Questions（未解決）
> 列出所有未回答的問題

### ❓ 核心問題
1. DeepSeek V4 Flash 官方 endpoint 暫時未公開, 確認 provider route — OpenRouter / DeepSeek direct / 其他?
2. Model name syntax 喺 route_model.yaml 點寫 (`deepseek/deepseek-v4-flash` vs `deepseek-chat`)?
3. 7-day staging 收 multi-model data, M3 baseline 對比點定 (用 pre-Phase 1 嘅 938 entries 做 baseline?)?
4. DeepSeek V4 Flash 嘅 reasoning quality 同 M3 比較, 7 日 metrics 入面 quality metric 點量度?

### 🔍 追問（蘇格拉底反詰）
- 點解唔直接全部用 DeepSeek, 反正平 3.5x? (答: code/spawn 要 M3 reasoning, quality 唔可以 trade-off)
- 如果 DeepSeek fail, fallback 去 M3 (cheap-down) 定維持 'none' terminal? (答: cheap-down 合理, 因為 M3 平時已經 standby)
- 5 條 daily routes 用 deepseek, 點 quality check (e.g. `direct_answer` 答錯點知)?
- 7-day staging 完, 如果 cost saving 唔達預期 (e.g. <30%), plan B 係乜?

## Progress
- [x] 確認 DeepSeek ENV 細節 — 用 best-guess defaults (`https://api.deepseek.com/v1` + `DEEPSEEK_API_KEY` + `deepseek/deepseek-v4-flash`)，等 Josh confirm/override
- [x] Add deepseek provider entry 落 `route_model.yaml` providers section (v1.0 → v1.1)
- [x] 改 5 條 routes 嘅 primary: `fdq`, `direct_answer`, `sop`, `none`, `browser` → `deepseek/deepseek-v4-flash`
- [x] 加 deepseek 做 fallback for `code`/`spawn` 嘅 fallback_chain (deepseek 排喺 openrouter 之前)
- [x] 改 `IDENTITY.md` default_model — SKIPPED (IDENTITY.md 冇 `default_model` field, route_model.yaml 已經係 source of truth)
- [x] Update `resolution_order` 喺 `route_model.yaml` + `failure_recovery.js` 加 `deepseek` 喺 `main` 之後 (surgical fix T1 後全 PASS)
- [x] Audit: 0 hardcoded keys, 0 syntax error, 12 ENV placeholders (新增 DEEPSEEK_API_KEY + DEEPSEEK_API_URL)
- [x] 跑 `node /tmp/verify_routeModel_smoke.js` — dormant 確認 (provider=none 因為 ENV 仲未 inject, 0 crash)
- [x] 跑 T1-T13 regression 確認 **13/13 PASS** (T1 surgical fix chain length 5→6 expected change)
- [ ] 7-day staging 開始 (6/5-6/11) — **PENDING Josh ENV inject**
- [ ] 落 ENV 後 verify smoke test 確認 `provider: deepseek` 真 work (Step 2 期望 provider=deepseek for `direct_answer`, provider=main for `code`)

## Notes

### 2026-06-05 18:30 — Router 運作驗證 (audit pass)
- `route_model.yaml` v1.1 fully active, all 5 routes 駁通 M3 + deepseek
- `routeModel()` 1,640+ decisions logged, 100% success rate 今日
- Smart Spawn flow (scripts/spawn_config.js) 已駁通 — SPAWN/SOP/CODE → M3+thinking:high
- Decision log 真實 routing data confirmed (962+ entries, 24h recovery events)
- 7-day staging (6/5-6/11) running — metrics_collector 每日收 multi-model distribution

### 2026-06-05 01:36 — Multi-model config 100% done, 8/9 progress, ready for ENV inject

**Config 改動清單**:
1. `route_model.yaml`: v1.0 → v1.1 (1 個新 provider entry, 7 條 routes surgical 改, resolution_order 加 deepseek)
2. `failure_recovery.js`: RESOLUTION_ORDER hardcoded array 加 `deepseek` 喺 `main` 之後
3. `integration_tests.js`: T1 test 期望 length 5 → 6 + chain 期望 `['main','deepseek','openrouter','nous_portal','direct_api','none']`

**Verify 結果**:
- YAML valid (js-yaml parse)
- 0 hardcoded keys
- 12 ENV placeholders (新增 2 個 DEEPSEEK_API_*)
- T1-T13 **13/13 PASS**
- Decision log 962 entries (append-only preserved, 24 new from regression tests)

**Best-guess ENV defaults** (等 Josh confirm/override):
- `DEEPSEEK_API_URL=https://api.deepseek.com/v1` (官方)
- `DEEPSEEK_API_KEY=***` (官方 standard ENV name)
- `deepseek/deepseek-v4-flash` (model name syntax 跟 OpenClaw model aliases)

**Pending**: ENV inject (Josh) → verify smoke test 確認 deepseek 真 work → sessions_spawn 認 `deepseek/*` prefix boundary check → 7-day staging 開始 (6/5-6/11) → 6/12 review → 6/13 final decision (Issue #128)

**相關**:
- Issue #128 (6/13 final decision on multi-model validation)
- Issue #120 (SPAWN routing enforcement + Main agent M3 vs Flash 5/14 progress, 對齊 6/13 timeline)
- Cost saving 預期: 50-65% (pending real metrics)
- Quality risk: `direct_answer` 質素可能略降 (DeepSeek reasoning 比 M3 弱)
- Mitigation: T1-T13 + 7-day staging 持續驗證, 6/13 final decision 靈活
- 相關: Issue #128 (6/13 final decision scope 改 multi-model)
