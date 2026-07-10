---
id: 114
title: Routing Phase 4 — Cross-channel Routing + Dynamic HA Load Balancing
status: archive
priority: P3
created: 2026-05-20
due: 2026-07-01
updated: 2026-07-04
progress: 0/3
---

## 目的

Phase 4 係 routing system 嘅高階目標：跨 channel 統一 routing 同 HA 動態負載均衡。

---

## Task 1 — Unified Cross-channel Routing

**問題：** 而家 Discord/Signal/WhatsApp 各自獨立收到 message，routing logic 只喺 `message_received.js` hook 執行。如果其他 channel 嘅 message 要 routing，就要各自 implement。

**方案：** 將 routing rule engine 提升為 shared layer
- `router/classifier.js` + `model_router.js` 已經係 channel-agnostic（純 text input）
- 只需要確保每個 channel 嘅 message handler 都 call classifier
- Discord ✅（message_received.js hook）
- Signal/WhatsApp ❌（未有）

**Effort：** 2-4hr
**Impact：** 中（統一 routing 體驗）

---

## Task 2 — Dynamic HA Load Balancing

**問題：** 而家 HA failover 係 binary（睇 heartbeat >3min 就接管）。唔根據負載或任務類型動態調整。

**方案：** 根據 routing load 動態分配任務
- Phase 0 概念：Ally 主力對話，Bliss 後勤
- 而家：Ally overload 時，Bliss 只係 standby
- Phase 4：當 routing 偵測到 Ally 負載高（多 concurrent tasks），自動 defer 部分任務到 Bliss

```
Ally routing load > threshold
  ↓
router 自動 mark 部分 SPAWN tasks 做 "deferrable"
  ↓
Bliss（經 SSH）接 deferrable tasks
  ↓
完成後 sync 結果返 Ally
```

**Effort：** 6-8hr
**Impact：** 高（真正 HA 利用閒置資源）
**Conditions：**
- 需要 SSH sync（已經有 `backup_to_bliss.sh` 基礎）
- 需要 task queue（目前未有）
- 需要 Bliss run OpenClaw（Bliss already has it）

---

## Task 3 — Router Agent Re-evaluation

**問題：** Phase 2 嘅 `router_agent_study.md` 結論係「暫時唔建議做」，因為 multi-step task 佔比得 ~10-15%

**條件：** 當以下條件 **全部滿足** 先值得再次考慮：
1. Phase 1 routing data 累積 >1 個月
2. Multi-step task 佔比 >30%（由 `report.js` 數據確認）
3. Phase 3 feedback loop 已自動化且準確度 >80%
4. Phase 4 task queue 已存在

**建議 timeline：** 2026-07 月中 review

**Effort：** N/A（只係 review）
**Impact：** 待決定

---

## Phase 4 Summary

| Task | Effort | Impact | Blockers |
|------|--------|--------|----------|
| 1. Cross-channel routing | 2-4hr | 中 | — |
| 2. Dynamic HA load balancing | 6-8hr | 高 | SSH sync, task queue |
| 3. Router Agent re-evaluation | ~1hr review | 待決定 | 等 data 累積 |
| **Total** | **8-13hr** | | |

## Links

- Issue #112 — Phase 1-2 base
- Issue #113 — Phase 3 prerequisite
- `scripts/failover_detector.sh` — 現有 binary HA
- `scripts/router/report.js` — routing data 收集
- HEARTBEAT.md — cron jobs 總覽

---

*Created: 2026-05-20 | Progress: 0/3*

## 現狀（2026-05-20）

### Task 1 — Cross-channel routing ⏸️
- Router system currently Discord-only
- Signal/WhatsApp routing 未 implement
- 等 Phase 3 data 累積後再決定方向

### Task 2 — Dynamic HA load balancing ⏸️
- 需要 task queue infrastructure + SSH sync
- 目前 binary failover（>3min heartbeat）足夠
- 等 Phase 4 Task 1 完成先做

### Task 3 — Router Agent re-evaluation ⏸️
- 已做研究（`router_agent_study.md`）
- Conclusion: multi-step task ~10-15%，唔值得 Router Agent
- 等 1 month routing data + multi-step >30% 先 reconsider

### 最新決定
- Phase 4 全部 ⏸️，等 Phase 1-3 data 累積 1-2 週
- 現有 binary HA continue
- Prune 咗嘅 files keep idle，唔 delete

### 2026-05-20 最新決策
- All Phase 4 tasks remain ⏸️
- No timeline for revisit
