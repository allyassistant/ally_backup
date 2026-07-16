---
id: 157
title: Cron sessionKey context overflow fix — 觀察期
status: archive
priority: P2
created: 2026-06-12
due: 2026-06-19
updated: 2026-07-16
progress: 1/7
---

## F - Facts（事實）

### 現況
總共 **15 個 cron jobs** 因為共用 sessionKey 可能有 context overflow 風險 (gateway restart → catch-up retry 同一秒 → session 互撞)。行 3 波 delete + recreate，全部移除 sessionKey。

### Wave 1 — wiki batch (21:45 HKT 2026-06-12)
最初發現嘅 6 個，全部 share `#🧑🏻‍💻編程` sessionKey，喺 01:43:29 同一秒 fail。

| Job | 排程 | 新 ID | 舊 sessionKey |
|-----|------|-------|---------------|
| Discord Channel Logger | 23:50 | `fd645808` | `#⚙️系統` |
| Wiki Bridge Import | 00:40 | `8ce0632c` | `#🧑🏻‍💻編程` |
| Generate SYMBOLS.md | 00:41 | `6af155d5` | `#🧑🏻‍💻編程` |
| Wiki Compile | 00:45 | `128479bc` | `#🧑🏻‍💻編程` |
| Wiki Lint | 00:50 | `a72d5b55` | `#🧑🏻‍💻編程` |
| Wiki Daily Ingest | 01:00 | `ce52ebfe` | `#🧑🏻‍💻編程` |

### Wave 2 — non-announce (01:32 HKT 2026-06-13)
另外 6 個都有 sessionKey，但 run 唔同時間，risk low。Delete + recreate 清乾淨。

| Job | 排程 | 新 ID | 舊 sessionKey |
|-----|------|-------|---------------|
| Daily Memory Logger | 每 2h | `91f3394b` | `#🧑🏻‍💻編程` |
| Anomaly Monitor | 06:30/18:30 | `3d125d4f` | `#🧑🏻‍💻編程` |
| Knowledge Bootstrap | 06:30 | `419bd05f` | `#🧑🏻‍💻編程` |
| AI HOT 推送 | 12:00 | `fe0d22a3` | `#🧑🏻‍💻編程` |
| Wiki Vectorizer | 01:20 | `97167765` | `#🧑🏻‍💻編程` |
| Weekly Correction | Sun 03:00 | `79786378` | `#🧑🏻‍💻編程` |

### Wave 3 — announce delivery (01:34 HKT 2026-06-13)
3 個用 announce mode，已經有 explicit delivery channel config，remove sessionKey 唔應該影響 routing。

| Job | 排程 | 新 ID | 舊 sessionKey |
|-----|------|-------|---------------|
| Daily Synthesis | 08:00 | `57349a2f` | `#⚙️系統` |
| Deep System Cleanup | Sun 04:00 | `9f91864f` | `#🧑🏻‍💻編程` |
| Monday Parallel | Mon 07:00 | `d2805515` | `#🧑🏻‍💻編程` |

### Baseline (fix 前)
- Wave 1 (6個) 全部喺 01:43:29 HKT 同一秒 fail
- Wave 2 (6個) 從未出過事（不同時間 run）
- Wave 3 (3個) — Daily Synthesis 本身有 timeout 問題，同 sessionKey 無關
- Error: 「Context overflow: prompt too large for the model」
- consecutiveErrors: 2 each (Wave 1)
- 冇自動 recovery — 需要人手 recreate

## D - Decisions（決定）

### ✅ 已做決定
- [2026-06-12] **Wave 1：delete + recreate 6 wiki crons 移除 sessionKey** — ✅ Night 0/7: 5/6 first-pass pass, 1 timeout (fix: timeout 120→300)
- [2026-06-13] **Wave 2：delete + recreate 6 non-announce crons 移除 sessionKey** — low risk, clean-up
- [2026-06-13] **Wave 3：delete + recreate 3 announce crons 移除 sessionKey** — announce routing 需 verify
- [2026-06-13] **開 P2 issue 觀察 7 日** — 確保 fix 後冇 side effect

### ⏳ 待做決定
- [2026-06-19] 如果 7 日內全部 pass → close issue
- [2026-06-19] 如果有任何 1 個重複 fail → escalate to P1 + 深挖 root cause

## Q - Questions（未解決）

### ❓ 核心問題
1. **唔同嘅 cron 唔同時間 run 但共用 sessionKey 點解會撞？** → 唔係平時撞，而係 gateway restart 後 catch-up 將 backlog 全部同一秒 retry
2. **Gateway restart 係咪會繼續發生？** → 每次 update/config apply 都會 restart，但 catch-up 行為係 normal
3. **有冇其他 cron 共用 sessionKey 會撞？** → **冇.** 全線 15 個 active cron 已全部清理。剩低 5 個已 disable。

### 🔍 追問
- 下次 gateway restart 時呢 15 個 cron 會點？→ 每個 independent isolated session，唔會互相影響
- Announce delivery without sessionKey work？→ 理論上 work（config 有 explicit channel/to），但 Daily Synthesis (08:00) 係第一個真正 test
- 如果 Daily Synthesis announce fail 點做？→ 係 timeout 問題定 announce routing 問題要區分

## Progress

### 🎯 Checkpoints（每晚睇 cron state）

**Day 0 — 2026-06-12 (第一晚大考) ✅ 6/6 wiki pass**
- [x] Discord Channel Logger (23:50) — ✅ 44.8s
- [x] Skill Junk Rate Tracker (23:55) — ✅ 4.6s
- [x] Wiki Bridge Import (00:40) — ✅ 8.5s
- [x] Generate SYMBOLS.md (00:41) — ✅ 4.7s
- [x] Wiki Compile (00:45) — ✅ 11.7s
- [x] Wiki Lint (00:50) — ✅ 56.7s
- [x] Wiki Daily Ingest (01:00) — ⚠️ timeout 120s → ✅ auto-retry 15s (timeout bumped 120→300)
- [x] Wiki Vectorizer (01:20) — ✅ 3.7s

**Day 1 — 2026-06-13**
- [ ] Wave 1 (6 wiki): all consecutiveErrors = 0
- [ ] Wave 2 (6 non-announce): all consecutiveErrors = 0
- [ ] Wave 3 (3 announce): all lastRunStatus = ok
- [ ] Daily Synthesis (08:00) — announce without sessionKey + 300s timeout fix

**Day 3 — 2026-06-15**
- [ ] 48h consecutives 冇 repopulate
- [ ] Gateway restart 至少 1 次

**Day 7 — 2026-06-19 (Closing)**
- [ ] 全部 15 個 consecutiveErrors = 0
- [ ] Gateway restart 至少 2 次後仍然正常

### 📋 每日 Verify Commands
```bash
# Check all 15 cron status (run after 01:30 HKT for full day results)
openclaw cron list --enabled | json -a id name -a state.lastRunStatus state.consecutiveErrors
```

### 🎯 Closing Criteria (2026-06-19 08:00 HKT)

| Day | Criteria | Action |
|-----|----------|--------|
| ✅ PASS | 全部 15 個 consecutiveErrors = 0 連續 7 日 | Close issue |
| 🟡 PARTIAL | 1-2 crons 有 isolated fail (non-repeat) | 延 3 日觀察，記錄 root cause |
| 🟠 NEEDS MORE | 任何 cron consecutiveErrors ≥2 | Escalate #156-type fix (timeout 或 script bug) |
| 🔴 REGRESSION | Wave 1 任何 cron context overflow 重現 | 即時 P1 + rollback 舊 sessionKey config |

### 🛡️ Rollback Plan
- 如果 fix 搞出問題：用舊 ID 重新 add cron + 補返 sessionKey
- Drift watch：gateway restore backup 可能帶返舊 cron config（有 sessionKey），要用 cron list check

**Wave 1 (wiki batch) 舊 ID:**
  - Discord Logger: `5a89fef1-ba05-4955-89ce-ca3ae171dedd`
  - Wiki Bridge: `38568db2-1042-4012-8625-05c261f75ae9`
  - SYMBOLS.md: `a97c959e-51c6-4eca-b5b4-f4f5cb74fa21`
  - Wiki Compile: `466c4150-0a17-4602-a9fc-2159e289b88e`
  - Wiki Lint: `bc386593-0b05-4dbe-b650-aaf9ac3bf22a`
  - Wiki Ingest: `6f6ec289-1c4c-4212-b403-29fdf227cb5f`

**Wave 2 (non-announce) 舊 ID:**
  - Daily Memory Logger: `3ad2bf02-0cbb-4ae7-a2b3-09fa563db4ea`
  - Anomaly Monitor: `02cb43e1-a9fe-47a4-84e2-d06fea3cc740`
  - Knowledge Bootstrap: `4e082577-a20e-432d-9e2a-99f02106579a`
  - AI HOT: `27d479e7-5c64-456d-9b6a-a14c578b3b72`
  - Wiki Vectorizer: `5cf1c6af-c3c9-4a23-9c8e-6985b6710b8a`
  - Weekly Correction: `a0d746b4-8554-4a5b-bb88-660a42181a31`

**Wave 3 (announce) 舊 ID:**
  - Daily Synthesis: `3c11c009-ac02-4ead-8b61-646af5e46408`
  - Deep Cleanup: `64edc696-0911-4ca6-bb57-787870dc506d`
  - Monday Parallel: `e547e533-513b-4cf9-bca5-fefbee117675`

## Notes
- Fix 完成時間：Wave 1 21:45 HKT 2026-06-12 / Wave 2+3 01:32-01:34 HKT 2026-06-13
- Gateway restart 係 fix trigger chain 嘅 root cause (#136 patch 應用)
- M3 sub-agent 分析發現 Anomaly Monitor 用同一個 sessionKey 但 run fine（獨自 run 冇碰撞）— 證明 sessionKey 本身唔係 bug，係 concurrent access 問題
- 同 session (#157) 有關連：Skill Junk Rate Tracker context overflow (#153 ollama rollout) 係唔同 root cause
- **總計：15 個 active cron 已全部清理 sessionKey**，全線 fresh isolated context
- **剩低 announce test：** Daily Synthesis (08:00) 係第一個 announce without sessionKey test

### Cross-references
- **#156** Daily Synthesis timeout fix (300s) — same cron, 08:00 係 announce + timeout 雙重 test
- **#144** Gateway restart trigger — 原 root cause, 確認 restart 後 15 cron 唔會 collision
- **#153** Skill Junk Tracker context overflow — 唔同 root cause (ollama rollout), 獨立處理
