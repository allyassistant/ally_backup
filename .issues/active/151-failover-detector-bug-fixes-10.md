---
id: 151
title: Failover Detector Bug Fixes + 10d Observation
status: active
priority: P2
created: 2026-06-11
due: 2026-06-21
updated: 2026-06-11
progress: 1/4
---


## F - Facts（事實）

### 背景
- **2026-06-11 01:45 HKT:** 💓 message 喺 #🧑🏻‍💻編程 出現 (Message ID: 1514324550375051287)
- **Initial hypothesis:** 可能係 systemEvent cron 未完全 migrate 或 HA failover 觸發
- **Investigation find:** `ha-state/ally/current_task.json` 自 **2026-03-25** 起 stale，一直寫住「測試緊Failover功能」 — 已修復
- **Root cause analysis done:** `docs/failover-bug-analysis.md`

### Bugs Identified & Fixed

| Bug | Problem | Fix | Files Changed |
|-----|---------|-----|---------------|
| #1+#2 | Reboot → failover_detector 即刻檢查 peer → 網絡未 ready → 誤判 peer offline | Self-recovery grace period (120s) | `scripts/failover_detector.sh` |
| #3 | `last_status_*` 跨 crash 殘留，兩邊狀態不一致 | Recovery 時 reset `last_status_*` + `offline_since_*` | `scripts/failover_detector.sh` |
| #4 | Uni-directional network blip → false "peer offline" notification | Debounce (2 consecutive checks) | `scripts/failover_detector.sh` |
| Stale artifact | `current_task.json` stuck on "測試緊Failover功能" since 2026-03-25 | Reset to "待機中" | `ha-state/ally/current_task.json` |

### Files Modified
- **`scripts/failover_detector.sh`** — 新增 self-recovery grace period + peer offline debounce + state reset on recovery
- **`ha-state/ally/current_task.json`** — 修復 3-month stale artifact
- **Bliss side:** `failover_detector.sh` 同步推咗相同版本 (backup: `failover_detector.sh.bak.2026-06-11`)

### New State Files (auto-generated)
- `ha-state/self_heartbeat_diff_<NODE>` — 追蹤 previous self heartbeat diff
- `ha-state/peer_check_count_<PEER>` — offline debounce counter
- `ha-state/last_status_<PEER>` — existed before, but now reset on self-recovery
- `ha-state/offline_since_<PEER>` — existed before, but now cleaned up on self-recovery

### 已知剩餘嘅 HA artifacts（有待 cleanup）
| File | Stale Since | Status |
|------|-------------|--------|
| `ha-state/last_hb_bliss` | 2026-03-29 | ✅ 已刪除 (2026-06-11) |

## D - Decisions

### ✅ 已做決定
- 2026-06-11 決定：修復 failover_detector.sh 4 個 bugs + deploy to both nodes
- 2026-06-11 決定：觀察 10 日 (6/11 → 6/21) 確認新版運作正常

### ⏳ 待做決定
- 2026-06-21: Close issue (如果 10 日內冇 anomaly) vs extend observation
- 2026-06-21: 決定係咪加 suggested improvements (見下方 Q section)

## Q - Questions

### ❓ 觀察期問題 (6/11 → 6/21)
1. **Debounce 有效？** Uni-directional blip 出現時，debounce 阻止咗 false notification 未？
2. **Self-recovery grace 順暢？** 如果 Ally reboot，failover_detector 會唔會喺 2 min grace 後正常運作？
3. **False negative risk？** Debounce (+2 checks) 會唔會延遲真正 failover 通知？ (原本 3min threshold → 而家 ~5min 先 notify：3min stale + 2min check 間隔)
4. **💓 仍然出現？** 之前 01:45 嘅 💓 係 compaction trigger，failover detector fix 唔會直接影響，但如果仍然每朝出現，要進一步查
5. **Recovery notification 仍然正常？** 當 peer 真正恢復時，係咪仍然正確發送 ✅ 通知？

### 🔍 Side findings
- `💓` at 01:45 HKT — 好大機會係 OpenClaw gateway compaction 機制，唔係 HA failover 問題。如果每朝長 session 後都出現，可能需要另外睇 compaction threshold
- `last_hb_bliss` (stale since 2026-03-29) — ✅ 已刪除 (2026-06-11)

### 🚀 Suggested Next Improvements (optional, not planned yet)
1. **Recovery self-notification:** Self-recovery 後 send `🔁 [node] 已自行恢復` 去 #⚙️系統 (目前 silence)
2. **Daily health digest:** 00:00 cron send `🟢 HA Status: Ally 正常 | Bliss 正常 | 上日 offline events: 0`
3. **HA state cleanup script:** 週期性清除 >30 日嘅 stale files

### ✅ Already Done (during fix deployment)
- **`last_hb_bliss` cleanup:** 刪除 3 個月 stale file (2026-06-11) — was originally suggestion #3

## Progress
- [x] Step 1: Analysis — identify, fix, and deploy 4 bugs (2026-06-11)
- [ ] Step 2: Observation (2026-06-11 → 2026-06-21) — 10 days of production monitoring
- [ ] Step 3: Check for anomaly vs expected behavior
- [ ] Step 4: Close issue — or extend/triage based on findings

## Notes
- **Memory:** `memory/2026-06-11.md` has full session summary
- **Analysis doc:** `docs/failover-bug-analysis.md`
- **Bliss backup:** `.bak.2026-06-11` preserved on Bliss side
- **First deployment:** 2026-06-11 02:09 HKT (Ally side), 02:14 HKT (Bliss side)
- **10-day window:** 2026-06-11 02:00 → 2026-06-21 02:00 HKT
- **Test artifacts:** Debounce test (2026-06-11 02:10) triggered artificial「Bliss 已番咗上線」notification 送去 #⚙️系統 (Message ID 1514330989323747338) — 內容準確反映當時 state，冇誤導但可辨識為測試輸出
