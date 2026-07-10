---
id: 173
title: Phase A Real-time Closed Loop — Observation & Remaining Work
status: archive
priority: P2
created: 2026-06-20
due: 2026-06-25
updated: 2026-07-04
progress: 0/7
---

## Description

Phase A + A+ shipped 2026-06-20 03:30 HKT (real-time audit + failure detection + smart dedup + 3 bug fixes). This issue tracks the **observation window** (2026-06-20 → 2026-06-25) and the **remaining work** needed to fully close the loop.

Tracked in #162 M12.

## Shipped (deployed 2026-06-20)

### New files
| File | Lines | Purpose |
|------|-------|---------|
| `scripts/after_task_skill_candidate.js` | 240 | Detects 3 failure signals → emits v=3 skill candidates |
| `scripts/audit_just_written.js` | 328 | Real-time 4-rule audit on freshly written files |
| `scripts/lib/audit_realtime_dedup.js` | 246 | Override log + file filter for smart dedup |
| `extensions/skill-auto-suggest/lib/after-task-triage.mjs` | 158 | Fire-and-forget subprocess spawner for triage hook |

### Modified files
| File | Change |
|------|--------|
| `extensions/skill-auto-suggest/index.mjs` | New `agent_end` hook → `analyzeTaskEnd` (priority 5) |
| `extensions/self-healing-loop/index.mjs` | `after_tool_call` → audit call + 5 telemetry events + Discord push on critical |
| `scripts/audit_daily_cron.js` | Filter files via dedup BEFORE audit; `--no-dedup` + `--dedup-stats` flags |
| `scripts/skill_reviewer_bot.js` | dedup_gate bridge (cross-source cosine) + async `writeSkillFiles` |
| `scripts/lib/rules/system-audit.js` | `extractCronScriptPaths` + `resolvePathCandidates` helpers (cronMissing 3→0) |
| `scripts/lib/auditOrchestrator.js` | 7 `console.log` → `console.error` (JSON stdout fix) |

### Refactor (DRY)
| New module | Lines | Replaces duplication in |
|------------|-------|------------------------|
| `scripts/lib/discord_push.js` | 124 | 5 callers (audit_orchestrator, daily_telemetry, propose_fix_notifier, after-task-triage, audit_just_written) |
| `scripts/lib/proposal_store.js` | 126 | 5 callers (audit_repair_proposer, propose_fix_notifier, proposal_action, audit_to_skill_emitter, daily_telemetry) |

## Net capability delta

| Loop step | Before | After Phase A |
|-----------|--------|---------------|
| LLM-written file bug → Discord warning | ⏰ 16h delay (04:30 cron) | ⚡ 5s |
| Task failure → skill candidate | ⏰ 4h max (cron) | ⚡ 5s |
| Re-audit clean files | 🔁 always | ⏭️ skip (smart dedup) |
| Cross-source bot duplicates | ❌ missed | ✅ detected (85%+ similarity) |
| JSON cron output parseability | ❌ stdout polluted | ✅ clean |

## Open TODOs (observation + remaining work)

### Phase 1: Verify production deployment (immediate)
- [ ] **#1** — Next 04:30 cron run (next: 2026-06-21 04:30 HKT) — verify `auto_fix_report.json:systemAudit.cronMissing = 0` (was 3 false positives, now should be 0)
- [ ] **#2** — Verify Discord push works on critical severity (manual test if needed: `node scripts/audit_just_written.js /tmp/test.js` with bad code → check #⚙️系統 channel)
- [ ] **#3** — Verify dedup JSON output: `node scripts/audit_daily_cron.js --dry-run --no-discord --json` shows `filesDiscovered: N, filesScanned: ≤N, dedupApplied: true`

### Phase 2: 5-day observation (2026-06-20 → 2026-06-25)
- [ ] **#4** — Track `.after_task_triage.jsonl` growth (expect ~10-50 entries/day based on LLM usage)
- [ ] **#5** — Track `.state/audit_realtime_overrides.jsonl` growth (expect ~5-20 entries/day)
- [ ] **#6** — Track Discord push volume (manual review: too noisy → tune threshold)
- [ ] **#7** — Track any false positives from real-time audit (real bugs that didn't exist, or noise flagged as bugs)

### Phase 3: Remaining work (post-observation)
- [ ] **#8** — **Phase B (Layer 4 v1)** — auto-migrate existing scripts to use `scripts/lib/safe_<rule>.js` wrappers (4-6h effort, requires M12.7 baseline data)
- [ ] **#9** — **OpenClaw LLM audit reliability calibration** (meta-issue) — sub-agent hallucinated 2 issues today (gateway cache dead code + 8 callers count). Need: prompt calibration OR sanity-check pass for audit output
- [ ] **#10** — **2 quarantined test files** tech debt — `test_backfill_skill_tiers.js.broken` + `test_dependency_graph.js.broken` need rewrite (sub-agent pre-existing bug, ~30 min each)

### Phase 4: Optional improvements
- [ ] **#11** — Enable `SKILL_REVIEWER_BOT_DEDUP=strict` env on bot cron (currently default warn) — after verifying no false-positive dedup
- [ ] **#12** — Migrate 4 other scripts (health_monitor.js, auto_remember.js, weekly_correction_templates.js, reminder_discussion_bot.js) from inline `execFileSync('openclaw', 'message', 'send', ...)` to `discord_push.js` (DRY, but out of scope)

## Success criteria (close #173)

```
✅ PASS (close by 2026-06-25):
   - 5-day observation complete with no critical regression
   - Dedup speedup measurable (cron runtime -30% on days with LLM activity)
   - Discord push frequency reasonable (<10/day)
   - At least 1 skill candidate emitted via failure detection OR 0 false-positive skills written
   - cronMissing confirmed = 0 in next auto_fix_report

🟡 PARTIAL (extend 7d):
   - Some noise but workable
   - <50% reduction in cron runtime
   - Need threshold tuning

🔴 REGRESSION (rollback):
   - LLM false positives break existing skills
   - Discord push flooding
   - Cron timeout caused by dedup errors
```

## Files & Reports
- **Phase A complete report:** `.analysis/phase-a-real-time-loop-2026-06-20.md`
- **Audit report (8 passes):** `.analysis/phase-a-audit-2026-06-20.md`
- **Cron refactor report:** `.analysis/cron-refactor-2026-06-20.md`
- **Master issue:** #162 (M12 tracks this work)
- **Closed predecessor:** #146 (skill reviewer pipeline bugs — 13/13 done)

## Notes
- Conservative defaults: dedup gate in `warn` mode (not `strict`) — won't break bot even if false positive
- Fail-open everywhere: any error in any hook → log + continue, never break model
- Performance budget: <35ms total per task (audit 0-2ms + triage ~30ms spawn)
