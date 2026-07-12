---
id: 140
title: Daily Synthesis Migration + Skill Automation Next Steps
status: archive
priority: P1
created: 2026-06-08
due: 2026-06-15
updated: 2026-07-12
progress: 2/10
---

## Description

追蹤今日 (2026-06-08) 嘅 Daily Synthesis migration 進度同 M3 評估嘅「逐個逐個做」skill automation 後續 items。

呢個 issue 集 monitor + plan 喺一齊：
- **7 日後 (2026-06-15)** 跟進：睇下 migration 落咗 7 日嘅健康度 + 推進過咗邊幾個 item
- **同日 (2026-06-11 01:45 HKT)** 仲有 7-day review cron (0e9d6913) — 正式 observation window

## Context

### 今日完成（2026-06-08）嘅 Daily Synthesis 改動

| 改動 | 細節 |
|------|------|
| **Thin executor migration** | Cron 從 LLM-driven agentTurn → deterministic script (`scripts/daily_synthesis.js`, 25,664B) |
| Token 改善 | 15,253→457 in, 2,490→290 out (~15x reduction) |
| Duration 改善 | 31.7s → 11.5s |
| **Discord push 移除** | Script default channel 改 `''` (off), skip guard 加咗 |
| **Delivery channel 改去 #⚙️系統** | 由 #🎓學習 (1473382857949970515) → #⚙️系統 (1473376125584670872) |
| **HEARTBEAT.md fix** | 解決咗「Cron no longer pushes to Discord」矛盾 — 改為清晰區分 synthesis content (Obsidian) vs cron status (Discord) |
| **Minor cleanup** | Date validation 加 month/day range check, stale sessionKey 清咗 |

### M3 Sub-Agent 10-Dimension Verification

✅ **Ship, no critical issues.** Major contradiction found and fixed (HEARTBEAT.md consistency).
- Sub-agent sessions: `d5de539d` (analysis), `a057cd7b` (execution)
- Full report: `.spawn/reports/` (如果有)

## Progress

### Tonight (2026-06-08)
- [x] M3 評估「逐個逐個做」應唔應該繼續做 Item 1 (provider sanitizer) 同 Item 2 (cron-failure auto-spawn)
- [x] **結論：唔做** — 紀律 > 速度，3 個 regression buffer 唔夠，今日已 ship 咗 3 個 code change

### Tomorrow (2026-06-09) — 08:00 HKT Cron Run
- [ ] 觀察 Daily Synthesis cron 首次真實跑 (08:00 HKT)
- [ ] 驗證以下信號：
  - [ ] Cron 成功跑完 (exit 0)
  - [ ] Discord push 落入 #⚙️系統 (唔係 #🎓學習)
  - [ ] Token usage < 2K
  - [ ] 冇 reasoning leak 喺 message layer
  - [ ] 冇 `consecutiveErrors` alert
  - [ ] Obsidian note 寫成功
  - [ ] Heartbeat timestamp 有更新

### After Migration Validated (Sequenced Plan)

按 risk-adjusted ROI 排序：

| # | Item | Mode | Effort | Risk | 預計時間 |
|---|------|------|--------|------|----------|
| 1 | `code-review-checklist` → bake into `verify_edit.js` | Script | 1h | 🟢* | 明日下午 |
| 2 | `pipeline-heartbeat-debugging` retry wrapper | Code | 1h | 🟢 | 2026-06-10 |
| 3 | `cron-failure-investigation` auto-spawn (改良版) | Cron | 2h | 🟢 | 2026-06-11 |
| 4 | `rapaport-email-summary` cron (週五 09:00) | Cron | 2h | 🟢 | 2026-06-12 (週四 prepare) |
| 5 | `provider-response-sanitization` hook (off-by-default) | Integration | 3h | 🟡 | 2026-06-13-14 |

*Note: `code-review-checklist` Item 1 嘅 risk 喺 M3 report 評為 🟢 Low，但我 challenge 過 — `verify_edit.js` 係 post-edit 自動 validation tool，影響每個 file edit，實際 risk 至少 🟡。做嘅時候要留意。

### Item 3 (改良版 cron-failure auto-spawn) 嘅 Specific Specs

M3 建議嘅改良：
- `consecutiveErrors` 改 3 (唔係 2) — 減少 false positive
- Cooldown 1h per cron — 避免 provider outage 期間重複 spawn
- Daily token budget cap 100K — 避免 cascade 燒晒
- **Off by default** + per-cron opt-in — 唔會自動 cover 所有 cron
- **Batched spawn** — 多個 cron 同時 fail 只 spawn 1 個 M3 session 處理全部

### Item 5 (provider sanitizer) 嘅 Specific Specs

- **Off-by-default flag** — 預設關，避免 silent drop 影響所有 message
- **Dry-run mode** — 先 log 偵測到嘅 leak，唔 silent drop
- **先確認 `memory_sanitizer.js` 現狀** — 避免 double-handling 同一個 leak
- **逐 channel opt-in** — 唔係 all-or-nothing

## 7-Day Review Sync (0e9d6913 @ 2026-06-11 01:45 HKT)

呢個 cron 會自動 review：
- AGENTS.md consistency
- 新 skills 使用情況
- Channel topics 效果
- 矛盾/contradictions

**到時 (2026-06-11 02:00 之後) 手動睇結果同呢個 issue 對齊進度。**

## Notes

- M3 評估 sub-agent session: `9b60c6fc-9472-447c-99b0-ca79f770b14b`
- Issue 創建時間: 2026-06-08 22:08 HKT
- 原始討論喺 #🧑🏻‍💻編程 channel: Discord message 1513544833824854251
- 7-day review cron ID: 0e9d6913-c32d-45ee-b669-1acdd9282be2
- Daily Synthesis cron ID: 3c11c009-ac02-4ead-8b61-646af5e46408

## Cross-References

- Memory: `memory/2026-06-08.md` sections 17-20 (Daily Synthesis migration + minor fixes)
- HEARTBEAT.md section 20 (Daily Synthesis)
- Skills: `skills-learned/daily-synthesis/`, `cron-thin-executor-migration/`, `cron-model-selection-verification/`, `provider-response-sanitization/`, `cron-failure-investigation/`, `pipeline-heartbeat-debugging/`, `code-review-checklist/`, `rapaport-email-summary/`
- Skills audit report: `.spawn/reports/skill_audit_2026-06-08.md` (24 active skills)
