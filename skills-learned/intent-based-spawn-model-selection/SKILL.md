---
name: intent-based-spawn-model-selection
description: 為 SPAWN route 添加 intent-based 品質分層——默認用 M2.7（平快），明確要求時用 M3（高質量），並確保 fallback chain 不降級到不符合品質預期的模型
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-10T04:07:38.906Z
---

## Workflow

1. **識別需求** — 當用戶要求「spawn sub agent 分析」但冇明確指定 M3 時，意圖是預設 M2.7；當用戶明確要求「M3」「quality」「詳細分析」時，意圖是 premium M3
2. **規劃 route 分層** — 若現有 SPAWN route 全部用同一模型，新增一個 premium route（如 `spawn_quality`）指向 M3，保持原 SPAWN route 指向 M2.7
3. **更新 route_model.yaml** — 在 primary model 之外，確認 fallback_chain 內所有降級模型的質量是否符合該 route 的品質預期
4. **更新 model_router.js** — 將新 route 加入 `REQUIRED_ROUTES` array，確保 router 驗證通過
5. **更新 spawn_config.js** — `normalizeRoute()` 加入新 route label；更新 DEFAULT_MODELS map 確保 fallback 目標符合品質要求（如 M3 死後不應 fallback 到 deepseek-v4-flash）
6. **更新 AGENTS.md** — Route Table 加入新 route，並加「Spawn Intent Gate」章節說明如何根據用戶意圖選擇 route
7. **更新 structured_spawn.template** — 加入 Model Selection section，引導 sub-agent 在有 quality 需求時使用正確的 route
8. **驗證** — 運行 unit tests、integration tests、E2E tests，確認新 route 的 model resolution 正確

## Pitfalls

- **Fallback 降級不符合品質預期** — M3 死後自動 fallback 到 `deepseek-v4-flash`，但 `spawn_quality` route 的用戶期望是 premium quality，flash 會導致品質斷崖。解決：將 `DEFAULT_MODELS` 的 `deepseek` 改為 `deepseek-v4-pro`，或在 route_model.yaml 的 fallback_chain 中指定具體模型
- **System prompt alias 未同步** — `deepseek-pro: deepseek-v4-pro` 在 system prompt 的 Model Aliases 表中已定義，但 active config（spawn_config.js）未引用。解決：在 DEFAULT_MODELS 中使用該 alias，或在 fallback_chain 中指定 `deepseek-v4-pro`
- **Intent 判斷不一致** — 若 Ally（user）每次 explicit 寫 `model=M3` 或 `route=spawn_quality`，會增加認知負擔。解決：在 AGENTS.md 中明確定義「如何根據用戶訊息判斷 intent」，減少每次的 explicit 指定
- **Cron jobs 未同步更新** — 新 route 若被 cron job 使用，必須同步更新 cron 的 route 配置，否則 cron 仍用舊 route
- **沒有 E2E test coverage** — 新 route 需要獨立的 E2E test 驗證，確保 model resolution chain 在各種情境下正確

## Context Window Savings

- 避免每次都 explicit 指定 `model=M3`，減少 token 浪費
- 日常 spawn 用 M2.7 可節省成本，同時保持 on-demand M3 的高質量選項

## References

- Route configuration: `~/.openclaw/workspace/scripts/router/route_model.yaml`
- Router logic: `~/.openclaw/workspace/scripts/router/model_router.js`
- Spawn config: `~/.openclaw/workspace/scripts/spawn_config.js`
- Model aliases: 見 AGENTS.md 的 Model Aliases 表
