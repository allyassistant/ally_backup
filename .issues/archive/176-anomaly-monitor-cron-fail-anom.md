---
id: 176
title: Anomaly Monitor cron fail — anomaly_monitor.js moved to _legacy but cron argv not updated
status: archive
priority: P1
created: 2026-06-21
due: 2026-06-25
updated: 2026-06-22
progress: 0/4
---

## TL;DR

Anomaly Monitor cron (#13, 06:30 + 18:30 daily) 連續 fail，因為 `scripts/anomaly_monitor.js` 已被搬到 `scripts/_legacy/m5-dormant-2026-06-20/`（Loop Engineering dormant phase），但 cron argv 仍然 hardcode 舊 path。修復方案：**disable cron job**（唔再用 anomaly monitor — Loop Engineering 已 plan 取代方案）。

---

## F - Facts（事實）

### 現況

- **Cron job 失敗**：`Anomaly Monitor` (id: `3d125d4f-e11d-4ac7-a6bc-ebfe630958f9`)，連續 **3 次 fail**（6/20 18:30, 6/21 06:30, 仲有最少 1 次之前）
- **Root cause**: `argv[1]` = `/Users/ally/.openclaw/workspace/scripts/anomaly_monitor.js`，但 file 已被搬到 `/Users/ally/.openclaw/workspace/scripts/_legacy/m5-dormant-2026-06-20/anomaly_monitor.js`
- **No fallback**: cron 直接 exit 1，冇 graceful degradation

### 數據/證據

| 項目 | 值 |
|------|-----|
| Cron ID | `3d125d4f-e11d-4ac7-a6bc-ebfe630958f9` |
| Schedule | `30 6,18 * * *` (06:30 + 18:30 daily HKT) |
| Session | isolated (thin executor) |
| Model | none (純 script exec) |
| Last run | 2026-06-21 06:30:00 HKT |
| Status | error (consecutiveErrors: 3) |
| Duration | 67ms (即係 script load 就 fail，唔係 run 中 fail) |
| Error | `Error: Cannot find module '/Users/ally/.openclaw/workspace/scripts/anomaly_monitor.js'` |
| Script location now | `/Users/ally/.openclaw/workspace/scripts/_legacy/m5-dormant-2026-06-20/anomaly_monitor.js` |
| Last successful run | 2026-06-14 之前 (script 仲喺 scripts/ 嗰陣) |
| Move date | 2026-06-20 (Loop Engineering dormant batch move) |

### Move context

`_legacy/m5-dormant-2026-06-20/` 入面有 5 個 scripts：
- `anomaly_monitor.js`
- `anomaly_proactive_push.js`
- `baseline_store.js`
- `cron_health_triage.js`
- `pattern_proactive_trigger.js`

Loop Engineering Phase 1 (#154) dormant 化咗，準備 migration。當時冇 audit cron argv dependency。

---

## D - Decisions（決定）

### ✅ 已做決定

- [2026-06-21 12:xx] 決定：**disable Anomaly Monitor cron via `openclaw cron disable <id>`**（唔係 `cron update --enabled false` — 後者唔存在），唔 restore script。原因見下方。
- [2026-06-21 12:xx] 決定：唔修 `anomaly_monitor.js` 直接改 cron argv。原因：Loop Engineering Phase 1 已 dormant 化呢組 scripts（5 個全部），restore 1 個會 break consistency。再者，anomaly_monitor 內部 `require('./lib/baseline_store')` 都已同時 archived，transitive dependency 都 break。
- [2026-06-21 12:xx] 決定：功能**"degraded but acceptable"**—— error_auto_issue 覆蓋 error count（但用 threshold 而非 σ-deviation），L0/L1 file sizes + CQM metrics + disk usage + σ-deviation baseline methodology **未有人 cover**。過去 7 日冇 alert 冇人 notice → signals 唔 load-bearing，但 capability loss 要 acknowledge。

### ⏳ 待做決定

- [2026-06-30] 待定：**5 個 dormant scripts 嘅最終命運**（永久 disable？重寫做新型 pattern？merge 入 daily synthesis？）。見 #169 Loop Engineering WP1-WP5。
- [2026-06-30] 待定：**Loop Engineering Phase 1 嘅 anomaly 取代方案**。Candidate: 由 daily_synthesis.js（08:00）+ pattern_analysis_daily.js（04:00）合併做 anomaly detection。

---

## Q - Questions（未解決）

### ❓ 核心問題

1. **點解 script 搬到 `_legacy/` 嗰陣冇 audit cron argv？** — 應該有 pre-move checklist 包括「search all cron jobs using this script」。
2. **5 個 dormant scripts 裏面，仲有冇其他 cron hardcode 舊 path？** — 需要 audit 其餘 4 個（`anomaly_proactive_push.js`, `baseline_store.js`, `cron_health_triage.js`, `pattern_proactive_trigger.js`）。
3. **點解呢個 bug 要等 5h（last fail 6/21 06:30）先被發現？** — `failureAlert` config 應該有自動通知（#169 Loop Engineering WP3 嘅 work）但暫時未 set。

### 🔍 追問

- **Loop Engineering 嘅 dormant phase 應該有 migration SOP** — 包括「disable all dependents + audit cron references」。如果冇呢個 SOP，所有 future dormant moves 都會有同樣問題。
- **點樣 prevent regression？** — 加 pre-commit hook：detect `scripts/` file move → check openclaw cron list argv references？

---

## Progress

- [x] 2026-06-21 11:54 — Issue created (從 issue #138 closing review 發現)
- [x] 2026-06-21 11:54 — Root cause confirmed: argv hardcode 舊 path, script 已被 move
- [x] 2026-06-21 12:18 — **Disabled Anomaly Monitor cron** via `openclaw cron disable 3d125d4f-e11d-4ac7-a6bc-ebfe630958f9`. Verified `enabled: false`. Will not fire on next 18:30 schedule.
- [x] 2026-06-21 12:18 — **Audited 4 其他 dormant scripts** (`anomaly_proactive_push`, `baseline_store`, `cron_health_triage`, `pattern_proactive_trigger`) for SKILL.md / docs / cron refs:
  - NO active cron ref for any of 4 (only `anomaly_monitor.js` had cron)
  - NO active SKILL.md ref (3 skills already quarantined earlier today)
  - NO active code imports
  - 1 stale doc ref found: `TOOLS_CROSSSESSION.md` 4 lines recommend `pattern_proactive_trigger.js`
  - SYMBOLS.md refs all correctly point to `_legacy/` path (not stale)
- [x] 2026-06-21 12:18 — **Bonus audit (verifier-建議)**: 全部 28 OpenClaw daemon crons argv paths — only `anomaly_monitor.js` broken, all 27 others point to existing active scripts/. **Bug 唔係 systemic 喺其他 crons**, but future M5-style moves 同樣可能撞到。
- [x] 2026-06-21 12:21 — **Updated HEARTBEAT.md L24**: removed Anomaly Monitor from active cron table; added to 停用 section with link to #176 (precedent: Memory Dreaming, Wiki→Obsidian Sync)。
- [x] 2026-06-21 12:21 — **Updated TOOLS_CROSSSESSION.md** (4 edits): removed directory tree entry, removed quick-start example, replaced skill description with archived notice, removed quick reference table row. 2 informational refs kept (directory tree note + archived section header).
- [ ] 2026-06-22 — Verify next 06:30 cron fire does NOT execute (status remains "disabled" in daemon state)
- [ ] 2026-06-25 — Review: should we revert disable if #169 Loop Engineering Phase 1 ships anomaly replacement (due 2026-07-01)?
- [ ] 2026-06-22 — Track in #169 WP3 (failureAlert) — auto-notify when cron argv points to non-existent file (prevent 5h detection delay repeating)
- [ ] 2026-06-22 — Add to `MIGRATION.md` / `AGENTS.md` 嘅 pre-move SOP: "before `git mv scripts/X.js scripts/_legacy/`, run `openclaw cron list --json | jq '.[] | select(.payload.argv[] | contains(\"X.js\"))'` and disable all hits" (per verifier, pre-commit hook 同 overkill)

---

## Notes

### Cross-references

- **#138** — MiniMax overload + deepseek timeout（已 close）。Anomaly Monitor 雖然係 cron job，但 issue #138 focus 喏 provider reliability，呢個 bug 係 dormant script move 嘅 argv sync issue，係獨立問題。
- **#169** — Loop Engineering WP1-WP5 architecture（含 dormant migration plan）
- **#154** — Loop Engineering Phase 1 (Narrow): Termination Manifest

### Fix command（待執行）

```bash
# Option A: Disable cron
openclaw cron update 3d125d4f-e11d-4ac7-a6bc-ebfe630958f9 --enabled false

# Option B: Restore argv to legacy path（唔建議，breaking consistency）
# openclaw cron update 3d125d4f-... --payload argv '["node", "/Users/ally/.openclaw/workspace/scripts/_legacy/m5-dormant-2026-06-20/anomaly_monitor.js", "--quiet"]'
```

**建議 Option A**：disable cron，唔 restore script。等 #169 Loop Engineering Phase 1 決定最終 anomaly 取代方案。

### Rollback plan

- 如果 disable 之後需要 anomaly detection — re-enable cron + restore script via `git mv` 或直接 disable command restore。
