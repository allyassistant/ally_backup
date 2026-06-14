---
id: 145
title: SPAWN Intent Gate: 區分日常 spawn (M2.7) vs on-demand M3 (SPAWN_QUALITY) + 對應 fallback chain
status: active
priority: P1
created: 2026-06-10
due: 2026-06-17
updated: 2026-06-10
progress: 5/5
---

## Description

**問題：** `route_model.yaml` 嘅 `spawn` route 原本 default 用 M3，但 AGENTS.md 寫 M3 + Josh 真正 intent 係「要 M3 時先 M3」。要區分：
- 日常「spawn sub agent 分析 X」 → M2.7（平 + 快）
- 明確「spawn MiniMax M3 sub agent」/「high quality / 仔細分析」 → M3 (premium)

**Root cause：** 
- `route_model.yaml` 同 `AGENTS.md` 嘅 SPAWN route label 配 M2.7 / M3 都有，但係**冇機制**區分 Josh 嘅 user message intent
- SPAWN_QUALITY fallback chain 用 provider-level (`[deepseek, none]`)，落到 `deepseek-v4-flash` 跌 quality
- HEARTBEAT.md drift：Skill Reviewer cron 標住 (M3) 但 script `skill_reviewer_bot.js:30` 硬寫 `const MODEL = 'minimax-portal/MiniMax-M2.7'` — 已在今次改動同步 fix

**改動範圍：**
| File | 改動 |
|------|------|
| `scripts/router/route_model.yaml` | 加 `spawn_quality` route (M3); SPAWN/SOP/CODE 全部 M2.7（保持現有架構） |
| `scripts/router/model_router.js` | `REQUIRED_ROUTES` 加 `'spawn_quality'` |
| `scripts/spawn_config.js` | `normalizeRoute()` 加 `'spawn_quality'`; 加 `ROUTE_DEFAULT_FALLBACK` map |
| `AGENTS.md` | Route Table 更新 + **新增 Spawn Intent Gate section** (keyword rule + fallback table) |
| `.spawn/structured_spawn.template` | 加 Model Selection section |
| `scripts/router/tests/spawn_config_tests.js` | 加 5 個 test cases (normalizeRoute + ROUTE_DEFAULT_FALLBACK) |
| `scripts/router/tests/e2e_test.js` | E2E-1 修名 + 加 E2E-1b M3 test |
| `HEARTBEAT.md` | Skill Reviewer (M3) → (M2.7)（同步 script 實際 config）|

**行為對比：**

| Josh message | 之前 | 之後 |
|--------------|------|------|
| 「spawn sub agent 分析 X」 | M3 | **M2.7** ✅ 慳 cost |
| **「spawn MiniMax M3 sub agent」** | M3 | **M3** ✅ |
| **「派 M3 仔細分析」** | M3 | **M3** ✅ |
| **「high quality / premium / 深入」** | M3 | **M3** ✅ |

**Fallback chain 設計：**
- SPAWN (M2.7) → M2.7 死咗 → deepseek-v4-flash (cheap default)
- **SPAWN_QUALITY (M3) → M3 死咗 → deepseek-v4-pro** (premium fallback，maintain quality)
- 兩個 route 唔互相 fallback

**驗證：**
- `deepseek-v4-pro` API health check: 200 OK ✅
- **43 條** unit/integration/E2E tests pass, 0 fail（22 spawn_config + 13 integration + 8 E2E）
- 26 條 cron jobs 0 impact（已用 thin executor pattern，唔過 `spawn_config`）

## Progress
- [x] Step 1: 確認 `route_model.yaml` 同 `AGENTS.md` 嘅 drift
- [x] Step 2: 加 `spawn_quality` route 到 yaml + model_router + spawn_config
- [x] Step 3: 加 `ROUTE_DEFAULT_FALLBACK` 機制 (M3 → pro fallback)
- [x] Step 4: AGENTS.md 加 Spawn Intent Gate section
- [x] Step 5: 寫 test cases + 全 35 條 test pass

## Notes

**Drift 教訓：** 改 routing config 一定要 yaml 為 single source of truth，AGENTS.md 表格只是 mirror。同步兩邊先 commit。

**未來優化（Issue #128 7-day validation 完之後）：**
- 觀察 M2.7 vs M3 嘅 success rate 差距
- 如果 M2.7 quality OK：考慮 `code` route 都 default M2.7
- 如果需要第三 tier：可加 `SPAWN_CRITIC` (M3 + critic pattern)

**Related：**
- 完整 analysis 報告: `~/.spawn/reports/spawn_model_selection_2026-06-10.md`
- 詳細 fallback 設計分析: `~/.spawn/reports/spawn_model_selection_2026-06-10.md` (方案 A-E 對比)
- Issue #128: 7-day validation (6/5-6/11) 試 deepseek + M3 premium pattern — 今次係 refinement

## Rollback Plan

如果呢個改動造成問題（例如 M2.7 質量唔夠、SPAWN_QUALITY 唔再需要、drift 失控），可完整 rollback。

**Step 1: 還原 `route_model.yaml`**

```bash
# 移除 spawn_quality route block
edit ~/.openclaw/workspace/scripts/router/route_model.yaml
# 刪除呢 3 行：
#   spawn_quality:
#     primary: { provider: minimax-portal, model: minimax-portal/MiniMax-M3, ... }
#     fallback_chain: [deepseek, none]
#     cooldown_seconds: 60
#     cost_weight: 0.5
```

**Step 2: 還原 `model_router.js`**

```bash
edit ~/.openclaw/workspace/scripts/router/model_router.js
# REQUIRED_ROUTES:
const REQUIRED_ROUTES = [
  'fdq', 'direct_answer', 'sop', 'spawn', 'code', 'browser', 'none',
];
```

**Step 3: 還原 `spawn_config.js`**

```bash
edit ~/.openclaw/workspace/scripts/spawn_config.js
# 1. 刪除 ROUTE_DEFAULT_FALLBACK const
# 2. normalizeRoute() 還原:
function normalizeRoute(route) {
  const r = String(route).toLowerCase().replace(/^ROUTER_/, '');
  if (['fdq', 'direct_answer', 'sop', 'spawn', 'code', 'browser', 'none'].includes(r)) {
    return r;
  }
  return 'spawn';
}
# 3. model resolution 還原:
const model = cfg.model || DEFAULT_MODELS[cfg.provider] || 'deepseek-v4-flash';
# 4. 還原 comment header (刪除 M3 example + ROUTE_DEFAULT_FALLBACK 註解)
```

**Step 4: 還原 `AGENTS.md`**

```bash
# Route Table 還原（刪除 SPAWN_QUALITY row, 改 SPAWN/SOP/CODE 返 M3）:
# | SPAWN | MiniMax-M3 | high 🧠 | minimax-portal |
# | SOP | MiniMax-M3 | high 🧠 | minimax-portal |
# | CODE | MiniMax-M3 | high 🧠 | minimax-portal |

# 刪除成個 "🎯 Spawn Intent Gate" section
# Fallback 行為段落 (留唔留可, 改返舊版 "如果 routeModel() resolve 到 fallback provider...")
```

**Step 5: 還原 `.spawn/structured_spawn.template`**

```bash
# 刪除 "## Model Selection" section (最頂 3 行)
```

**Step 6: 還原 test files**

```bash
# 刪除 test 6b (spawn_quality normalizeRoute)
# 刪除 tests 14a, 14b, 14c, 14d (ROUTE_DEFAULT_FALLBACK)
# 還原 e2e_test.js: 刪除 E2E-1b, 還原 E2E-1 名
```

**Step 7: 驗證**

```bash
cd ~/.openclaw/workspace
node scripts/router/tests/spawn_config_tests.js  # 預期 17 pass (無 6b/14a-d)
node scripts/router/tests/integration_tests.js   # 預期 13 pass
node scripts/router/tests/e2e_test.js            # 預期 7 pass (無 1b)
# 如 HEARTBEAT.md 之前 update 咗 Skill Reviewer (M2.7) — 要還原返 (M3)
node scripts/spawn_config.js --route SPAWN --task "test"  # 應返 M2.7
node scripts/spawn_config.js --route SPAWN_QUALITY --task "test"  # 應 throw (unknown route)
```

**一鍵 rollback script（save as `/tmp/rollback_issue_145.sh`）：**

```bash
#!/bin/bash
# Rollback Issue #145 changes
set -e
cd ~/.openclaw/workspace

echo "⚠️  Rolling back Issue #145: SPAWN Intent Gate"

# 1. yaml — 移除 spawn_quality block
sed -i '' '/^  spawn_quality:/,/^    cost_weight: 0.5$/d' scripts/router/route_model.yaml

# 2. model_router.js — 移除 'spawn_quality' from REQUIRED_ROUTES
sed -i '' "s/'spawn_quality', //g" scripts/router/model_router.js

# 3. spawn_config.js — 移除 ROUTE_DEFAULT_FALLBACK + 還原 normalizeRoute + model resolution
# (手動處理 sed 比較脆弱，建議手動 edit)

# 4. AGENTS.md — 還原 Route Table + 刪除 Spawn Intent Gate section
# (手動處理)

# 5. .spawn/structured_spawn.template — 刪除 Model Selection section
# (手動處理)

# 6. Tests — 刪除 6b/14a-d + 還原 E2E
# (手動處理)

echo "✅ Done. Run tests to verify:"
echo "   node scripts/router/tests/spawn_config_tests.js"
echo "   node scripts/router/tests/integration_tests.js"
echo "   node scripts/router/tests/e2e_test.js"
```

**回滾決策準則：**
- M2.7 quality 跌太多（success rate < 90%）→ 改回 M3
- 7-day metrics 顯示 M3 唔值得 premium（99% 用唔到）→ 考慮 downgrade
- AGENTS.md 同 YAML 再 drift → 加 pre-commit hook 防 drift
