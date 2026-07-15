# HEARTBEAT.md - Cron Jobs 總覽
*版本：2026-06-10 | Ally (主力) | HA Mode: SSH Direct*

> **2026-06-10**: #1-10 由 `systemEvent+main` 轉 `agentTurn+isolated` thin executor，根治 main session 💓/👍 殘留。全部用 `deepseek/deepseek-v4-flash` + `toolsAllow:["exec"]` + `delivery.mode:"none"`。

---

## ✅ 每日 (Daily)

| # | 時間 | Job | Command | Session | 狀態 |
|---|------|-----|---------|---------|------|
| 1 | 00:05 | L0 Generator | `MEMORY_GEN_CRON=true node memory_generator.js --level L0` | isolated | ✅ |
| 2 | 00:35 | L1 Generator | `MEMORY_GEN_CRON=true node memory_generator.js --level L1` | isolated | ✅ |
| 3 | 00:40 | Wiki Bridge Import | `openclaw wiki bridge import` | isolated | ✅ |
| 4 | 00:41 | SYMBOLS.md | `node generate_symbols.js --quiet` | isolated | ✅ |
| 5 | 00:45 | Wiki Compile | `openclaw wiki compile` | isolated | ✅ |
| 6 | 00:50 | Wiki Lint | `openclaw wiki lint` | isolated | ✅ |
| 7 | 01:00 | Wiki Daily Ingest | `wiki_ingest_helper.mjs` (MEMORY+L0+L1) | isolated | ✅ |
| 8 | 01:20 | Wiki Vectorizer | `node wiki_vectorizer.js` | isolated | ✅ |
| 9 | 02:00 | Mini-Curator | `node weekly_correction_loop.js --inactivity-trigger` | isolated | ✅ |
| 10 | 04:00 | Pattern Analysis | `node pattern_analysis_daily.js --quiet` | isolated | ✅ |
| 11 | 05:00 | Daily Maintenance | `node daily_maintenance.js` | isolated | ✅ |
| 12 | 06:25 | KB Ingest | `node knowledge_ingester.js --discord-channel 1473376125584670872` | isolated | ✅ |
| 13 | 06:30 / 18:30 | Anomaly Monitor | `node anomaly_monitor.js` | isolated | ✅ |
| 14 | 06:30 | Knowledge Bootstrap | `cd workspace && node scripts/cross_session_bootstrap.js --quiet` | isolated | ✅ |
| 14 | 08:00 | Daily Synthesis | `node daily_synthesis.js` | isolated | ✅ |
| 15 | 10:00 | CQM System Check | `node code_quality_manager.js fix --quiet --enable-skill-scan` | isolated | ✅ |
| 16 | 12:00 | AI HOT 推送 | `node ai_hot_push.js` → #AI🔥熱門 (v2.0: direct POST, delivery:none) | isolated | ✅ |
| 17 | 23:50 | Discord Channel Logger | `node discord_channel_logger.js` | isolated | ✅ |
| 18 | 23:55 | Skill Junk Rate Tracker | `node skill_junk_tracker.js --days 1 --quiet` (#150) | isolated | ✅ |
| 19 | 09:00 | Skill Reviewer Daily Report | `node skill_reviewer_daily_report.js --dry-run` (report only, sends to #⚙️系統) | isolated | ✅ |
| 19 | 23:59 | Daily Summary | `node daily_summary_bot.js` → #📕日記 | main | ✅ |
| 20 | 每 2h | Daily Memory Logger | `node log_to_daily_memory.js --auto --quiet` | isolated | ✅ |

> **停用：** Memory Dreaming (03:00, disabled) · Wiki→Obsidian Sync (01:10, direct write only)

---

## 🔄 30 分鐘

| Job | Command | Session | 狀態 |
|-----|---------|---------|------|
| Skill Reviewer Pipeline | `skill_reviewer_pipeline.js --quiet` (Reviewer → Junk Pause sequential) | isolated | ✅ |

---

## 🔄 每分鐘

| Job | Command | 狀態 |
|-----|---------|------|
| Mail Monitor | `mail_monitor.js` (crontab, 非 OpenClaw cron) | ✅ |

---

## 📅 每週

| 時間 | Job | Command | Session | 狀態 |
|------|-----|---------|---------|------|
| Sun 03:00 | Weekly Correction Loop | `node weekly_correction_loop.js` | isolated | ✅ |
| Sun 04:00 | Deep System Cleanup | `node weekly_parallel.js --sunday` | isolated | ✅ |
| Sun 09:00 | Connection Surface | `node connection_surface.js + sub-agent` | isolated | ✅ |
| Mon 10:00 | Monday Parallel | `node weekly_parallel.js --monday` (#💼工作) | isolated | ✅ |

---

## ⚙️ HA Heartbeat

```
ha-state/ally/heartbeat.json      ← Ally 寫入 (每分鐘)
ha-state/bliss/heartbeat.json     ← 讀取檢查 (failover_detector.sh)
```

| 條件 | 行動 |
|------|------|
| Bliss heartbeat > 3min 無更新 | Ally 自動接管後勤 |
| Bliss 回復 | Ally 交還後勤 |

**Failover 接手掌櫃：** L0/L1 Gen · Wiki Bridge/Compile/Lint/Ingest · Stock List · Memory Compression

---

## 🎯 Skills Health

**Current state (2026-06-10 23:43 HKT):**

| Metric | Count | Status |
|--------|-------|--------|
| Active symlinks (in `skills/_learned_*`) | **41** | ✅ all absolute |
| `skills-learned/` directories | 41 | ✅ matches symlinks |
| Stale symlinks | 0 | ✅ H-1 fix |
| Junk quarantined (`_archive/quarantine-2026-06-10/`) | 10 | ✅ #149 cleanup |
| Failed-validation quarantined (`_archive/failed-validations/`) | 2 | ✅ H-2 fix |

**Recent fixes (skill pipeline 2026-06-10):**
- **H-1** 🔴 P0 — Stale symlink removal on validation fail → `skill_reviewer_bot.js:435-438`
- **H-2** 🟡 P1 — Auto-quarantine failed SKILL.md to `failed-validations/`
- **H-3** 🟡 P1 — Validator regex supports `### 1.` H3 headers → `validate_skill_file.js:95,117`
- **H-4** 🟢 P2 — Unclosed code fence early detection
- **H-5** 🔴 P0 — Quarantine gate: block symlink for quarantined skills → `skill_reviewer_bot.js:1384-1448`
  - `email-analysis-cantonese` was quarantined but cron re-created + auto-applied it anyway
  - Quarantine scan before symlink: scan `skills-learned/_archive/` (all `quarantine-*` + `failed-validations/` formats)
  - Blocked skills kept as draft; `symlinked:false` in telemetry; `QUARANTINE:` log entry
- **H-6** 🔴 P0 — Quarantine pre-write gate: drop block BEFORE SKILL.md write → `skill_reviewer_bot.js:1104-1147`
  - H-5 (symlink gate) alone wasn't enough: dedup `patch` action (sim 0.84 < 0.85) let the write proceed
  - Result: re-creation loop — SKILL.md in skills-learned/ got re-written every cron run
  - H-6 runs BEFORE any write: if proposed name in quarantine set → `continue` (block)
  - H-5 + H-6 = full quarantine defense (block write + block symlink)
  - Real root cause: `email-analysis-cantonese` re-triggered by mail_monitor cron (each new stock list email = same pattern)
- **P2 #1** — `extractFileBlocks` multi-block loop fix → `skill_reviewer_bot.js:238`
- **P2 #2** — `numSteps` regex updated for H3
- **P2 #3** — `pitfallsCount` telemetry uses H-3 compatible regex
- **P2 #4** — `workflowSteps` telemetry uses H-3 compatible regex → `skill_reviewer_bot.js:502`

**Quality trend:** `.skill_created.jsonl` post-fix junk rate < target 10% (small sample, awaiting 7-day obs per #150)
- Tracker cron: 23:55 HKT daily → `scripts/skill_junk_tracker.js` → `.skill_junk_rate.jsonl`

---

## 🚀 快速指令

```bash
# Memory
node scripts/memory_generator.js --level L0|L1
node scripts/log_to_daily_memory.js --auto

# Wiki
openclaw wiki bridge import|compile|lint|ingest

# Maintenance
node scripts/daily_maintenance.js
node scripts/code_quality_manager.js scan|fix

# Weekly
node scripts/weekly_parallel.js --monday|--sunday
node scripts/weekly_correction_loop.js
node scripts/skill_reviewer.js

# Heartbeat
~/.openclaw/workspace/scripts/heartbeat.sh
~/.openclaw/workspace/scripts/failover_detector.sh
```

---

*27 live cron + 1 per-min crontab + 3 disabled/idle*
