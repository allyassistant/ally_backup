---
id: 189
title: Auto-Fix System Phase 0 — Disable Silent Mutations
status: archive
priority: P1
created: 2026-07-10
due: 2026-07-10
updated: 2026-07-10
progress: 5/5
---

## Description

Stop the workspace's auto-fix system from silently mutating `scripts/*.js` files.

**Context:** 2026-07-09/10 發現 5 silent file corruptions in `scripts/*.js`，由 SHL + CQM auto-fix 觸發。6 個 M3 sub-agent 達成共識：所有 auto-fix tools 都會隨時間默認自動 drift 到 OFF，今晚係最平嘅翻牌時機。

**Phase 0 = flag flip，零 code change。** Phase 1-3（opt-in writers / confidence gate / diff watcher）之後先做。

**Strategic decision (Option B)：** Keep rules as advisors, kill auto-apply.

## F - Facts

### 現狀（2026-07-10 00:55 HKT）

| Component | Auto-write path? | 已 disable? |
|-----------|------------------|-------------|
| CQM 10:00 openclaw cron | ✅ YES（`fix --quiet --enable-skill-scan`，last run fixed 2 files） | ❌ NO |
| Audit Repair Proposer 04:45 system crontab | ✅ YES（`applyFix` 透過 `safeWriteSync`，no `--dry-run` in crontab） | ❌ NO |
| Hidden Drift Detector 03:50 system crontab | ❌ NO（only writes to `.state/drift_alerts.jsonl`） | ✅ N/A |
| SHL extension `~/.openclaw/openclaw.json` | ✅ YES（`mode: "fix-syntax"` auto-applies syntax fixes via safeWrite） | ❌ NO |
| `cron_failure_watcher.js` | ❌ NO（SHADOW mode only） | ✅ Already safe |
| `safe_write.js` infrastructure | N/A（pure library，無 auto-trigger） | ✅ Keep |

### 觸發 source

- 2026-07-09/10: 5 scripts/*.js corrupted by SHL + CQM auto-fix
- 6 prior M3 sub-agents reached consensus: organic drift to default-OFF
- HEARTBEAT.md 已記 CQM 10:00 `fix` + Audit Repair 04:45 `SHADOW_MODE` (但其實 applyFix 仍會 write)

### 數據/證據

| 指標 | before (2026-07-10 00:34) | after (target end-of-Phase-0) |
|------|---------------------------|---------------------------------|
| Auto-fixable files written / cron cycle | 2 (CQM 10:00) + 1-3 (Audit Repair) + 0-1 (SHL post-edit) | **0** |
| `scripts/*.js` silent mutations / 24h | 5+ observed | 0 |
| Phase 1+ surface (still mutating) | SHL `mode: "fix-syntax"` | SHL `mode: "log"` (Phase 1) |

## D - Decisions

### ✅ 已做決定

- [2026-07-10] **Option B** — keep rules as advisors, kill auto-apply path
- [2026-07-10] **Phase 0 = config/flag flip only**，zero code change
- [2026-07-10] **CQM 10:00:** `fix --quiet --enable-skill-scan` → `scan --quiet --enable-skill-scan`
- [2026-07-10] **Audit Repair 04:45 system crontab:** add `--dry-run` to prevent `applyFix` writes
- [2026-07-10] **Hidden Drift Detector 03:50:** verify read-only, no change
- [2026-07-10 00:55] **Phase 1 ✅ DONE** — SHL extension `enqueueFix()` guarded by `process.env.SHL_APPLY !== "true"`. Default behavior: detect-and-log only (`advisory_skip` telemetry event). No fixer subagent spawned, no file mutation. Reversible via `SHL_APPLY=true` env var. Surgical single-edit to `extensions/self-healing-loop/index.mjs:434`. `node --check` passes. HEARTBEAT.md `⚠️ 已知問題` section updated with Phase 1 note.

### ⏳ 待做決定 (Phase 2+)

- [Phase 2] **Opt-in writers:** introduce explicit `--apply` flag for CQM `fix` and Audit Repair `applyFix`
- [Phase 3] **Confidence gate:** require confidence ≥ 0.85 + human approval for auto-apply
- [Phase 4] **Diff watcher:** notify Discord on any `scripts/*.js` mutation not from git checkout

### Rule of thumb after Phase 0

> "If a script writes to `scripts/*.js` without being explicitly invoked by a human in the last 60 seconds, it's a bug."

## Q - Questions

- ❓ **SHL config flip 需要 restart gateway 嗎？** Plugin config 喺 `api.register` 讀取，likely requires gateway reload。Phase 0 唔做（out of scope）。
- ❓ **Audit Repair `--dry-run` 後 0 writes 出現，dashboard 點 alert?** Phase 1 設計 fix：add `--apply-only` mode + Discord notification on next morning summary
- ❓ **CQM `scan` 仍有 --enable-skill-scan，會唔會 auto-promote skill fixes?** Read scan source to confirm (currently scan only reports — no writes)
- ❓ **Phase 1 schedule:** 喺 2026-07-11 之後做，定等其他 M3 sub-agent follow up？

### 🔍 蘇格拉底追問

- Q: 點解唔直接刪晒 CQM `fix` subcommand 而係 flip flag？
- A: Phase 1 可能會重新 enable `fix` 做 opt-in（human-triggered），所以保留 subcommand 唔好 break

## Progress

### Phase 0 (config flips) — 8/8 ✅ DONE 2026-07-10 00:55

- [x] Step 1: Read cron list + HEARTBEAT.md + CQM + audit_repair_proposer + hidden_drift_detector source
- [x] Step 2: Create tracking issue #189
- [x] Step 3: Flip CQM openclaw cron `2f9b5b1c-...` (10:00) — `fix` → `scan`
- [x] Step 4: Add `--dry-run` to audit_repair_proposer system crontab (04:45)
- [x] Step 5: Verify hidden_drift_detector read-only — already safe (writes to `.state/drift_alerts.jsonl` only)
- [x] Step 6: Update HEARTBEAT.md (CQM 10:00 row + Audit Repair 04:45 row + Drift 03:50 row note)
- [x] Step 7: Document SHL `mode: "fix-syntax"` location — Phase 1
- [x] Step 8: Verify `node scripts/code_quality_manager.js scan --quiet` works

### Phase 1 (SHL advisory-only surgical edit) — ✅ DONE 2026-07-10 00:55

- [x] Step 1: Read SHL source — identified `enqueueFix()` as the bottleneck (one location prevents fixer spawn + safeWrite path)
- [x] Step 2: Picked Option B (env guard) over Option A (mode=advisory) because `mode: "log"` already exists but skips verify entirely (no detection) — env guard preserves detect-and-log semantics
- [x] Step 3: Inserted `if (process.env.SHL_APPLY !== "true") return;` at `extensions/self-healing-loop/index.mjs:434`. SHL still calls `verify_edit.js` + `audit_just_written`, still emits telemetry, but enqueueFix logs `advisory_skip` instead of queueing
- [x] Step 4: `node --check` PASSED. Simulated guard with 3 test cases (unset / `=true` / `=false`) all behaved correctly
- [x] Step 5: HEARTBEAT.md `⚠️ 已知問題` table — added Phase 1 row with reversal instruction (`SHL_APPLY=true` env var)
- [x] Step 6: Issue #189 updated — Phase 1 ✅ done, Phase 2/3/4 renumbered, Progress section added

### Phase 2+ (next sprint)

- [x] Phase 2: opt-in `--apply` flag for CQM + audit_repair
     - `code_quality_manager.js` — preview default, `--apply` guard chain (kill switch, TTY, quiet conflict, 60s recency, confirm prompt, telemetry)
     - `audit_repair_proposer.js` — `--apply` flag re-enables applyFix writes (TTY confirm, kill switch, telemetry)
     - Telemetry: 8 events (`cqm_apply_*`, `audit_apply_*`) → `.self_healing_loop.jsonl`
     - Cron config: unchanged (read-only)
     - safeWriteSync: preserved
- [ ] Phase 3: confidence-gate (≥ 0.85) + Discord approval before auto-apply
- [ ] Phase 4: diff watcher notify on any unsanctioned `scripts/*.js` mutation

## Notes

### Cross-references

- Source SOP: AGENTS.md → 🚨 Coding Standards（"Surgical Changes: 只改指定範圍"）
- Related issue: #182 (Phase A follow-up), #183 (SHL Coverage Extension — different but related SHL work)
- safe_write.js: 已 ship 2026-07-09 (L1 backup + validation barrier，繼續 keep available)

### What stops mutating silently after Phase 0+1

| Mutator | Status post-Phase-0 | Status post-Phase-1 |
|---------|---------------------|---------------------|
| CQM cron 10:00 | 🟢 Read-only scan, no writes | 🟢 (unchanged) |
| Audit Repair Proposer 04:45 | 🟢 `--dry-run` = propose only | 🟢 (unchanged) |
| Hidden Drift Detector 03:50 | 🟢 Read-only (no change) | 🟢 (unchanged) |
| SHL extension `enqueueFix()` | 🔴 STILL AUTO-APPLIES | 🟢 Env-gated; default advisory-only, no spawn, no write |

### Residual surface (Phase 2+)

- **Manual `node scripts/auto_fix.js fix`:** human-triggered, intentional — keep
- **Manual `node scripts/code_quality_manager.js fix`:** human-triggered, intentional — keep
- **SHL with `SHL_APPLY=true` set:** when human sets this env var explicitly, fixes are re-enabled. Audit trail via telemetry shows when this happens.

### Verification commands

```bash
# CQM now scan-only
node scripts/code_quality_manager.js scan --quiet --enable-skill-scan | head -10

# Audit repair now dry-run only
node scripts/audit_repair_proposer.js --dry-run | head -10

# Verify cron updated
openclaw cron get 2f9b5b1c-328a-4589-8f4b-a33a7ec387d5 | grep argv

# Verify crontab updated
crontab -l | grep audit_repair_proposer
```
