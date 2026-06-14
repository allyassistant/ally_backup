---
id: 126
title: ENV inject (4 vars: DEEPSEEK_API_URL + DEEPSEEK_API_KEY + MINIMAX_PORTAL_URL + MINIMAX_PORTAL_KEY) + verify smoke test
status: archive
priority: P0
created: 2026-06-05
due: 2026-06-11
updated: 2026-06-07
progress: 1/5
---

## F - Facts（事實）
> 確定已知的事實、數據、現狀

### 現況
- `route_model.yaml` v1.1, 多 model routing: 5 routes deepseek main + 2 routes M3 premium
- `DEEPSEEK_API_URL` + `DEEPSEEK_API_KEY` 仲未 set (placeholder `${DEEPSEEK_API_URL}` 同 `${DEEPSEEK_API_KEY}`)
- `MINIMAX_PORTAL_URL` + `MINIMAX_PORTAL_KEY` — KEY 已 set, URL 未 set
- 其他 6 個 vars (openrouter/nous/anthropic/custom/direct) 屬於 fallback chain, 唔 urgent
- 0 個 ENV inject → routeModel() 100% dormant (fall through 落 'none' provider)
- 一 inject 4 vars → routeModel() active, 7-day staging 自動開始

### 數據/證據
| 項目 | 值 |
|------|-----|
| ENV required for main | 4 vars (DEEPSEEK_API_URL + DEEPSEEK_API_KEY + MINIMAX_PORTAL_URL + MINIMAX_PORTAL_KEY) |
| ENV optional (fallback) | 6 vars (OPENROUTER_KEY, NOUS_PORTAL_URL, NOUS_PORTAL_KEY, ANTHROPIC_API_KEY, CUSTOM_PROVIDER_URL, CUSTOM_PROVIDER_KEY) |
| Time estimate | 5 min set vars + 5 min smoke test |
| Trigger | `export DEEPSEEK_API_URL=https://api.deepseek.com/v1 && export DEEPSEEK_API_KEY=***` |
| Verify | `node /tmp/verify_routeModel_smoke.js` |
| Issue dependency | Issue #127 (config 8/9 done, wait ENV) + Issue #128 (wait 7-day staging) |

## D - Decisions（決定）
> 識別已做或待做的決定

### ✅ 已做決定
- 2026-06-05 決定: ENV scope 由 10 vars 縮至 4 vars (deepseek main + M3 premium)
- 2026-06-05 決定: 其他 6 vars 屬於 fallback chain, 唔 urgent
- 2026-06-05 決定: best-guess ENV defaults (`https://api.deepseek.com/v1` + `DEEPSEEK_API_KEY` + `deepseek/deepseek-v4-flash`)

### ⏳ 待做決定
- Josh confirm/override best-guess ENV defaults (URL, KEY name, model name syntax)
- 決定 inject 位置: shell export / .zshrc / .env file / OpenClaw config?

## Q - Questions（未解決）
> 列出所有未回答的問題

### ❓ 核心問題
1. DeepSeek V4 Flash 官方 endpoint 暫時未公開, 確保 provider route (OpenRouter / DeepSeek direct / 其他)?
2. `MINIMAX_PORTAL_URL` 係乜? 需要你提供 (MINIMAX_PORTAL_KEY 已 set, URL 未 set)
3. ENV inject 位置: shell export (一次性) / .zshrc (persistent) / OpenClaw config secret?
4. Best-guess model name `deepseek/deepseek-v4-flash` — OpenClaw sessions_spawn 認唔認得?

### 🔍 追問（蘇格拉底反詰）
- 點解唔一次 inject 10 vars? (答: 其他 6 個 fallback chain 唔 urgent, inject 4 vars 就夠 active multi-model routing)
- DeepSeek V4 Flash 仲有 rate limit / quota concerns? 7-day staging 期間點 detect? (答: metrics_collector 每日收 fallback rate, rate limit 過多就 fallback 落 'none')

## Progress
- [x] Issue #127 multi-model config 100% done (route_model.yaml v1.1, 8 providers, 12 ENV placeholders)
- [ ] Josh inject DEEPSEEK_API_URL + DEEPSEEK_API_KEY (同 MINIMAX_PORTAL_URL 如果未 set)
- [ ] 跑 `node /tmp/verify_routeModel_smoke.js` 確認 `provider: deepseek` 真 work
- [ ] Hand-run sessions_spawn boundary check (認 `deepseek/*` prefix)
- [ ] 7-day staging 自動啟動 (cron 23:55 HKT)

## Notes

### 2026-06-05 18:30 — ENV inject 狀態確認 (audit)
- `DEEPSEEK_API_URL` + `DEEPSEEK_API_KEY` ✅ set (router 100% 揾到 deepseek)
- `MINIMAX_PORTAL_URL` + `MINIMAX_PORTAL_KEY` ✅ set (M3 1,640+ decisions 全部 success)
- 4 main vars 全部 active — router 唔再 dormant, full multi-model routing online
- Issue 已經 function-complete; 7-day staging 跑緊 (6/5-6/11)
- 其他 6 個 fallback chain vars (openrouter/nous/anthropic/custom/direct) 仲未 set, scope 保持唔 urgent

### 2026-06-05 01:50 — 之前
- 與 Issue #127 (multi-model config 8/9 done) 同 Issue #128 (6/13 final decision) 鏈接
- Inject 後 routeModel() active, classifier/route-enforcer 嘅 enrichment path fire
- Decision log 開始收真實 routing data (唔再係 test entries)
- Cost saving 預期 50-65% on daily traffic (pending 7-day metrics 驗證)
- Logging: ENV key 長度已避開 log, `node /tmp/verify_routeModel_smoke.js` 用 mask() 函數
- 見 Issue #127 Notes 2026-06-05 01:36 section 有完整 tracking
