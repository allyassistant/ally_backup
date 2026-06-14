# Skill Library Gap Analysis — 2026-06-12

> **Sub-agent task** (depth 1/1): Analyze 38 active + 6 quarantined + 2 failed-validation skills, identify coverage / category / function gaps with evidence traced to issues, errors, scripts, and recurring patterns.
> **Method:** Read skills/ + issues + scripts + crons; cross-reference with `.skill_junk_rate.jsonl`, `memory/errors.json`, `HEARTBEAT.md`. Verified on disk 2026-06-12 18:02 HKT.

---

## 📊 Inventory Verified

| Source | Count | Notes |
|--------|-------|-------|
| Active skills (`skills-learned/`) | **38** | All 4 skill files contain `status: active` (verified via grep) |
| Archived (`_archive/`, non-quarantine) | **20** | Includes 8 cron-cluster (per input), 12 others |
| Quarantined (`_archive/quarantine-*`) | **6** | From 6 distinct timestamps (2026-06-08 → 2026-06-12) |
| Quarantined 2026-06-10 batch | **10** | New batch (10 = `cron-context-overflow-recovery`, `cron-p0-rescue-workflow`, `cron-passive-job-detection`, `documentation-code-drift-detection`, `issue-quality-self-review`, `m3-root-cause-analysis`, `skill-file-corruption-repair`, `skill-reviewer-bot-self-improvement`, `skill-reviewer-draft-cleanup`, `systemevent-cron-dedup-gotcha`) |
| Failed-validation (`_archive/failed-validations/`) | **2** | `ai-hot-push-workflow-1781103933`, `script-integration-analysis-1781103933` |
| Total scripts (`scripts/`) | **217** | 195 executable (.sh/.js/.py/.mjs) |
| Active cron jobs | **21** | 20 daily + 1 every-30-min (per `HEARTBEAT.md`) |
| Active issues | **35** | P1=10, P2=17, P3=2 |
| `memory/errors.json` | **66 errors** | 23 sev3 / 36 sev2 / 7 sev1; 7d = 15 errors (Rate Limit 23, Timeout 12, Cron 9+6) |

> **Input mismatch noted:** Task lists "Cron reliability (8)" but only **4 are active** (cron-config-audit, cron-health-triage, cron-migration, cron-troubleshooting). The other 8 cron-related skills listed in that bullet are all archived. Cluster name should be "Cron reliability (4 active + 8 archived)".

---

## ① Coverage Matrix (12 categories × common scenarios)

Legend: ✅ Full | 🟡 Partial | ❌ Gap | 🔵 Quarantined (exists in `_archive` but not active)

| # | Category | Common Scenario | Status | Evidence |
|---|----------|-----------------|:------:|----------|
| 1 | **Cron — Failure Triage** | Single-job failure (timeout / error) | ✅ | `cron-troubleshooting` (active, 5-step diagnose) |
| 1 | **Cron — Failure Triage** | Multi-job simultaneous failure (provider outage) | 🟡 | `cron-troubleshooting` + `concurrent-session-rate-limit-avoidance` — partial |
| 1 | **Cron — Failure Triage** | SystemEvent 退化为 passive (4ms duration) | 🔵 | `cron-passive-job-detection` quarantined 2026-06-10 — NOT active |
| 1 | **Cron — Failure Triage** | L0/L1 cron specifically fail | ❌ | No skill — errors show 9 "Cron Error" + 6 "Cron Timeout" in 30d |
| 2 | **Cron — Preventive Health** | Hourly health scan → Discord | ✅ | `cron-health-triage` (active, thin executor) |
| 2 | **Cron — Preventive Health** | Pre-execution preflight check | ❌ | `scripts/cron_preflight_runner.js` exists but **no skill** wraps it (per TOOLS.md mention) |
| 2 | **Cron — Preventive Health** | Auto-degrade / disable on N consecutive errors | ❌ | No skill — manual only via `cron disable` |
| 2 | **Cron — Preventive Health** | Detect "stuck" cron (running too long) | ❌ | No skill — only post-mortem |
| 3 | **Cron — Config Audit** | Single cron config vs script mismatch | ✅ | `cron-config-audit` (active) |
| 3 | **Cron — Config Audit** | Bulk audit 21 crons for drift | 🟡 | Same skill but no cron wrapper; `HEARTBEAT.md` has 21 jobs but no auto-audit |
| 3 | **Cron — Config Audit** | Detect model/fallback config drift after OpenClaw update | 🟡 | `cron-config-audit` mentions this; `#136` proves recurring — no auto-detect |
| 4 | **Cron — Migration** | agentTurn → systemEvent | ✅ | `cron-migration` (active, 7-step) |
| 4 | **Cron — Migration** | systemEvent → agentTurn+isolated | ✅ | `systemevent-main-session-isolation` (active, + `#144`) |
| 4 | **Cron — Migration** | Ollama/local model migration (qwen2.5:3b context overflow) | 🔵 | `_archive/quarantine-2026-06-10/cron-context-overflow-recovery` — quarantined; `#153` proves need |
| 4 | **Cron — Migration** | Type B → Type A thin executor rewrite | ✅ | `cron-migration` covers + `llm-call-execfile-migration` |
| 4 | **Cron — Migration** | New OpenClaw version: re-apply patches / configs | ❌ | No skill — `#136` shows npm update wipes JS patch, manual re-apply |
| 5 | **Subagent — Orchestration** | Parallel multi-track implementation | ✅ | `parallel-subagent-implementation` (active) |
| 5 | **Subagent — Orchestration** | Sequential dependency chain (Phase 1 → 2 → 3) | 🔵 | `multi-phase-subagent-orchestration` archived — no active replacement |
| 5 | **Subagent — Orchestration** | Spawn with intent-gate (M2.7 vs M3) | ✅ | `intent-based-spawn-model-selection` (active, `#145`) |
| 5 | **Subagent — Orchestration** | Aggregating multiple sub-agent reports into one synthesis | ❌ | No skill — manual `cat` + summarize |
| 5 | **Subagent — Orchestration** | Spawn + handover to next sub-agent (chained) | ❌ | No skill — manual yield + pass context |
| 6 | **Subagent — Reliability** | M3 overload / 429 / partial completion | ✅ | `subagent-m3-reliability` (active) |
| 6 | **Subagent — Reliability** | M3 output token truncation | 🟡 | Mentioned in `subagent-m3-reliability` — no auto-retry-with-shorter-context skill |
| 6 | **Subagent — Reliability** | Sub-agent silent spawn failure | 🟡 | Covered in AGENTS.md but no skill-level procedure |
| 6 | **Subagent — Reliability** | Subagent output accessibility (post-completion read) | 🔵 | `subagent-output-accessibility-recovery` quarantined 2026-06-08 — still need |
| 6 | **Subagent — Reliability** | Side-effect containment (shared utility safety) | ✅ | `subagent-sideeffect-containment` (active) |
| 6 | **Subagent — Reliability** | QA verification of sub-agent's own work | ✅ | `subagent-qa-verification-workflow` (active) |
| 7 | **Skill Self-Curation** | Auto-create skill from recurring pattern | 🟡 | `skill-automation-analysis` (active, manual) + `skills-audit-workflow` (active) — not fully closed-loop |
| 7 | **Skill Self-Curation** | Pre-write fence / self-ref filter | ✅ | `skill-validation-failure-cleanup` + `#152` QW-2 |
| 7 | **Skill Self-Curation** | Quality heuristic tuning | ✅ | `skill-quality-verification` (active) |
| 7 | **Skill Self-Curation** | Junk rate tracking | ✅ | `error-auto-issue` (passive) + `scripts/skill_junk_tracker.js` |
| 7 | **Skill Self-Curation** | Promote skill from `_archive` → active (after fix) | ❌ | No skill — quarantined skills stay quarantined (10 in `quarantine-2026-06-10/`) |
| 7 | **Skill Self-Curation** | Coverage map (which scenarios have skills) | ❌ | **No skill / no artifact** — this analysis is first time written |
| 8 | **OpenClaw Internals** | Compaction behavior / NO_REPLY → 👍 | ✅ | `openclaw-compaction-investigation` (active) |
| 8 | **OpenClaw Internals** | JSON schema strictness workaround | ✅ | `openclaw-config-schema-debugging` (active) |
| 8 | **OpenClaw Internals** | Managed upgrade flow | ✅ | `openclaw-managed-upgrade` (active) |
| 8 | **OpenClaw Internals** | NO_REPLY silent delivery chain | ✅ | `openclaw-no-reply-chain-debugging` (active) |
| 8 | **OpenClaw Internals** | route-enforcer plugin hook debugging | ✅ | `route-enforcer-plugin-debugging` (active) |
| 8 | **OpenClaw Internals** | Patch persistence across `npm update` | ❌ | No skill — `#136` reopens indefinitely because of this |
| 8 | **OpenClaw Internals** | Plugin dev (new hook) | ❌ | No skill — only 5 active all debug existing |
| 9 | **Code / Config Quality** | Static review of new file | ✅ | `code-review-checklist` (active) |
| 9 | **Code / Config Quality** | Auto PR / rebase / commit-message | ❌ | No skill — manual `git` calls only |
| 9 | **Code / Config Quality** | Surgical code change via sub-agent | ✅ | `subagent-code-tuning-workflow` (active) |
| 9 | **Code / Config Quality** | Cross-machine code deployment | ✅ | `cross-machine-deployment` (active, 7-step) |
| 9 | **Code / Config Quality** | Bug triage (verify → fix → defense) | ✅ | `system-code-debug-triage` (active) |
| 10 | **Memory / Synthesis** | Daily synthesis (L0/L1/L2 → Obsidian) | ✅ | `daily-synthesis` (active) |
| 10 | **Memory / Synthesis** | Multi-session resumption | ✅ | `multi-session-resumption` (active) |
| 10 | **Memory / Synthesis** | Obsidian note quality check (wikilinks, frontmatter, tags) | ❌ | No skill — 21 crons write Obsidian, 0 quality check |
| 10 | **Memory / Synthesis** | Memory sanitization (PII / dedup) | 🟡 | `scripts/memory_sanitizer.js` exists; no skill |
| 10 | **Memory / Synthesis** | L0/L1 generation reliability (currently 30% junk) | 🟡 | `#102` active, no active skill for the fix pattern |
| 11 | **Model / Routing** | Model migration (rename, deprecation) | ✅ | `model-migration-workflow` (active) |
| 11 | **Model / Routing** | Fallback chain audit | ✅ | `cron-config-audit` (active, covers) |
| 11 | **Model / Routing** | Rate limit collision detection | ✅ | `concurrent-session-rate-limit-avoidance` (active) |
| 11 | **Model / Routing** | Cost dashboard / token tracking | ❌ | **No skill** — `#154` Phase 1.2 plans to add; not active yet |
| 11 | **Model / Routing** | Suppress fallback notice (recurring) | ❌ | **No skill** — `#136` in indefinite maintenance; recurring every npm update |
| 12 | **HA / Multi-Machine** | Cross-machine deployment | ✅ | `cross-machine-deployment` (active) |
| 12 | **HA / Multi-Machine** | HA heartbeat health (Ally/Bliss) | 🟡 | `scripts/failover_detector.sh` exists; `#151` 4-bug fix in observation; no skill |
| 12 | **HA / Multi-Machine** | HA failover testing (synthetic peer-down) | ❌ | No skill — `#151` Notes suggest "Recovery self-notification" not planned |
| 12 | **HA / Multi-Machine** | Heartbeat reconciliation (self vs peer drift) | ❌ | No skill — same gap as above |
| 12 | **HA / Multi-Machine** | State artifact cleanup (stale .json files) | 🟡 | `heartbeat-maintenance` (active, local only); HA-state cleanup no skill |

### Coverage Matrix Roll-up

- **Full coverage (✅):** 21/49 scenarios = **43%**
- **Partial (🟡):** 9/49 = 18%
- **Gap (❌):** 14/49 = **29%**
- **Quarantined (🔵):** 5/49 = 10% (exists but unaccessible to active workflow)

> **Insight:** 39% of common scenarios have either gap (29%) or have a skill that's quarantined (10%). The active skill library looks denser than reality because **5 high-value skills are quarantined** and `multi-phase-subagent-orchestration` is archived without replacement.

---

## ② Top 5 Coverage Gaps (impact × effort ranked)

### Gap #1: `cost-and-fallback-dashboard` (P0, 🔶 Pipeline)

- **What:** No active skill covers token / cost tracking across 21 crons + main session + sub-agents
- **Evidence:**
  - `#154` Phase 1.2 plans `lib/llm_budget.js` + `cron_recovery_monitor.js` (planned, not implemented)
  - 30d error count: 23 Rate Limit + 12 Timeout + 6 Cron Timeout (provider cost + reliability)
  - `concurrent-session-rate-limit-avoidance` covers collision diagnosis but not aggregation
- **Impact:** Without dashboard, no way to know if 5 LLM crons (≈ $50/mo per `#154` estimate) stay in budget. Loop Engineering cost cap (`#154`) depends on this.
- **Effort:** 🔶 Pipeline — 4.5hr planned; covers 5 LLM crons, 21 non-LLM crons, main session
- **Why P0:** All future loop engineering decisions require this; without it, no automated cost circuit breaker

### Gap #2: `model-fallback-notice-suppression` (P1, 🟡 Standard)

- **What:** Recurring maintenance issue (`#136`) — every `npm update` wipes the JS patch suppressing `↪️ Model Fallback` notice. No active skill automates re-application.
- **Evidence:**
  - `#136` is **indefinite** (due date removed 2026-06-12) — explicitly tagged "recurring maintenance work, not one-off fix"
  - Hybrid C→B solution re-applied 2026-06-12 after npm update wiped patch
  - Errors show this as noise source, not blocker
- **Impact:** User-facing noise on every fallback. Manual maintenance = 5-10 min per `npm update` (estimate from 2 occurrences so far)
- **Effort:** 🟡 Standard — pre-update hook + post-update hook + watch script (~80 lines, 2-3 files)
- **Why P1:** Permanent noise + recurring effort, but not blocking

### Gap #3: `obsidian-note-quality-check` (P1, 🟡 Standard)

- **What:** 21 cron jobs write Obsidian notes (Daily Synthesis, KB Ingest, Daily Summary, AI HOT, KB Bridge, etc.) but no skill validates quality (wikilinks, frontmatter, tags, sections)
- **Evidence:**
  - `TOOLS.md` writes standard: ① cross-links ② tags ③ insight ④ inbox flow — but no automation
  - 217 scripts total; Obsidian writers = `write_to_obsidian.js` + 4-5 inline writers
  - Issue tracker: no open issue on this gap, but `obsidian-vault-maintainer` skill (system, not in `skills-learned/`) only does manual ops
- **Impact:** Junk Obsidian notes accumulate silently; cross-link graph degrades; eventually AI retrieval quality drops
- **Effort:** 🟡 Standard — wrap `write_to_obsidian.js` with quality check + post-write validator (~40 lines)
- **Why P1:** Silent degradation, but doesn't break anything immediately

### Gap #4: `cron-stuck-loop-recovery` (P1, 🟡 Standard)

- **What:** No skill detects "stuck" cron (e.g. `Skill Reviewer` 366-394s timeout × 3 consecutive in `#138`) and auto-disables / auto-recovers
- **Evidence:**
  - `#138` (MiniMax overload + deepseek timeout) — 6/7 evening: 3 consecutive deepseek fails, recovered naturally
  - `#136` mechanism relies on env var, not stuck detection
  - `concurrent-session-rate-limit-avoidance` covers diagnosis but not auto-recovery
  - 30d: 9 Cron Error + 6 Cron Timeout (errors.json)
- **Impact:** Without auto-recovery, cron runs 3× cost for nothing, then user must notice
- **Effort:** 🟡 Standard — extend `cron-health-triage` with circuit breaker (~30 lines)
- **Why P1:** Cost + noise, but `cron-health-triage` already does most of the detection

### Gap #5: `pattern-detection-auto-skill-creation` (P0, 🔴 Full+Approval)

- **What:** New recurring patterns (e.g. `#136` fallback notice, `#151` HA state stale) keep requiring manual skill creation. No closed-loop: "detect pattern → auto-create skill proposal"
- **Evidence:**
  - `skill-automation-analysis` (active) covers manual analysis
  - `skill-curation-pattern` covers curation
  - But: closing the loop "issue #N + M error.json hits + 1 conversation = auto skill proposal" — **NO skill**
  - 5 quarantined skills (2026-06-10 batch) all addressed real gaps that emerged from patterns but were created with prompt issues
- **Impact:** Manual bottleneck — every new recurring issue requires Josh's intent + sub-agent spawn. With 35 active issues (10 P1), this is blocking scalability.
- **Effort:** 🔴 Full+Approval — touches skill-automation-analysis + skill-quality-verification + AGENTS.md spawn intent gate; multi-file change
- **Why P0:** Foundational — without this, the library grows linearly with issues, not sub-linearly

---

## ③ Category Gaps (categories with zero / near-zero skill coverage)

### 3.1 User-Facing Interaction — ❌ FULLY EMPTY
- 38 active skills are **all internal / DevOps / meta**. Zero cover user-facing channels.
- **Missing:** "Discord embed best practices for X", "user intent ambiguity resolution", "reply tone (Cantonese vs English)", "user-context-switching detection"
- Evidence: 0 of 38 skills mention "user" / "Discord reply" / "tone" in description. AGENTS.md has rules but no skill.
- **Impact:** Cannot iterate on user-facing quality without a skill; quality SOP is implicit in AGENTS.md

### 3.2 Financial / Pricing / Business Domain — ❌ NEARLY EMPTY
- Only 1: `rapaport-email-summary` (diamond pricing). 0 for stock, Rapnet weekly, quotation generation, invoice, IDEX.
- Evidence: 217 scripts include `diamond_valuation.js`, `price_history.js`, `price_alert_system.js`, `quotation_generator.js`, `rapnet_weekly.js`, `invoice_generator.js` — **all without skill**
- **Impact:** Domain work runs on script muscle memory + AGENTS.md heuristics. Loss of knowledge when Josh forgets a flow.

### 3.3 Security / Auth / Secrets — ❌ EMPTY
- 0 active skills cover: SSH key rotation, API key rotation, env var validation, secret leak detection, OAuth flow, scope-aware permission.
- Evidence: `#151` (failover) hints at SSH dep, but no skill. `scripts/autoops/` exists but no wrapping skill. `security` word appears 0× in skill descriptions.
- **Impact:** Security audits are ad-hoc. Healthcheck skill (`/opt/homebrew/lib/node_modules/openclaw/skills/healthcheck/`) is system-level, not Ally-customized.

### 3.4 Testing / Coverage — ❌ NEARLY EMPTY
- `cron-job-testing` archived (per input). No active replacement.
- Evidence: 217 scripts, but `scripts/router/tests/` is the only test directory. ~3 test files vs 195 executables = <2% coverage.
- **Impact:** No skill codifies "how to test a cron job before/after migration" — relies on per-incident knowledge

### 3.5 Observability / Logging / Tracing — ❌ PARTIAL
- 4 monitoring skills (`aliveness-noise-reduction`, `anomaly-proactive-push`, `error-auto-issue`, `heartbeat-maintenance`) but no unified observability layer.
- **Missing:** "trace a single Discord message end-to-end" (channel → router → spawn → sub-agent → reply), "log correlation ID propagation", "metrics aggregation by skill/cluster"
- **Impact:** Debugging is linear grep, not graph-traced

### 3.6 Recovery / Auto-Remediation — ❌ EMPTY
- Cron cluster has `troubleshooting` + `health-triage` + `migration` but **no auto-remediation**. All workflows are diagnose-then-human-fix.
- Evidence: 23 Cron Error + 6 Cron Timeout in 30d errors.json. All require Josh or sub-agent to fix.
- **Impact:** MTTR is bottlenecked on Josh availability

### 3.7 Documentation / Knowledge Mgmt — 🟡 PARTIAL
- 1 active (`obsidian-vault-maintainer` is system, not in `skills-learned/`), 1 quarantined (`documentation-code-drift-detection`).
- **Missing:** "auto-generate skill from conversation transcript", "weekly library quality report", "skill cross-reference indexer"
- **Impact:** Documentation drift accumulates; 10 quarantined skills (2026-06-10 batch) prove this

### 3.8 Onboarding / Pattern-to-Skill Loop — ❌ EMPTY
- See Gap #5 above.

---

## ④ Function Gaps Within Active Clusters

### Cluster A: Cron reliability (4 active)
| Function | Skill | Status |
|----------|-------|--------|
| Diagnose single failure | `cron-troubleshooting` | ✅ |
| Bulk health scan (hourly) | `cron-health-triage` | ✅ |
| Config drift audit | `cron-config-audit` | ✅ |
| Type B → Type A migration | `cron-migration` | ✅ |
| systemEvent → agentTurn+isolated | `systemevent-main-session-isolation` | ✅ |
| **Preventive preflight** (before run) | `scripts/cron_preflight_runner.js` | ❌ **no skill wrap** |
| **Stuck loop detection + auto-recovery** | — | ❌ gap |
| **Ollama/local model context overflow** | `cron-context-overflow-recovery` (quarantined) | 🔵 |
| **Passive-job detection** (4ms duration) | `cron-passive-job-detection` (quarantined) | 🔵 |
| **P0 batch rescue** | `cron-p0-rescue-workflow` (quarantined) | 🔵 |

**Insight:** 5 functions are missing or quarantined. The 3 quarantined cron skills are all high-value and address real gaps proven by issues. If the QW-1~5 prompt redesign (`#152`) lands well, these could be promoted.

### Cluster B: Subagent orchestration (6 active)
| Function | Skill | Status |
|----------|-------|--------|
| Parallel multi-track | `parallel-subagent-implementation` | ✅ |
| M3 reliability / fallback | `subagent-m3-reliability` | ✅ |
| Intent-gate (M2.7 vs M3) | `intent-based-spawn-model-selection` | ✅ |
| Side-effect containment | `subagent-sideeffect-containment` | ✅ |
| QA verification | `subagent-qa-verification-workflow` | ✅ |
| Article analysis pattern | `m3-subagent-article-analysis` | ✅ |
| Surgical code tuning | `subagent-code-tuning-workflow` | ✅ |
| **Sequential multi-phase** (A → B → C with handovers) | `multi-phase-subagent-orchestration` (archived) | 🔴 gap (no replacement) |
| **Multi-agent report synthesis** (aggregate N reports → 1) | — | ❌ gap |
| **Output accessibility recovery** (post-completion read) | `subagent-output-accessibility-recovery` (quarantined 2026-06-08) | 🔵 |

**Insight:** Cluster strong on **reliability + safety** but weak on **synthesis + chaining**. AGENTS.md describes the pattern but no skill codifies.

### Cluster C: Skill self-curation (6 active)
| Function | Skill | Status |
|----------|-------|--------|
| Junk rate tracking | `error-auto-issue` + `skill_junk_tracker.js` | ✅ |
| Quality heuristic | `skill-quality-verification` | ✅ |
| Audit workflow | `skills-audit-workflow` | ✅ |
| Validation cleanup | `skill-validation-failure-cleanup` | ✅ |
| Automation analysis (manual) | `skill-automation-analysis` | ✅ |
| Curation pattern | `skill-curation-pattern` | ✅ |
| Code review checklist | `code-review-checklist` | ✅ |
| **Auto-promote quarantine → active** (after QW fix) | — | ❌ gap |
| **Coverage map** (this report) | — | ❌ gap |
| **Close-the-loop pattern detection** | — | ❌ gap |

**Insight:** Strong curation but no **promotion workflow** for quarantined skills. The 10 quarantined in `quarantine-2026-06-10/` may sit indefinitely unless QW-1~5 succeeds.

### Cluster D: OpenClaw internals (5 active)
| Function | Skill | Status |
|----------|-------|--------|
| Compaction investigation | `openclaw-compaction-investigation` | ✅ |
| Schema debugging | `openclaw-config-schema-debugging` | ✅ |
| Managed upgrade | `openclaw-managed-upgrade` | ✅ |
| NO_REPLY chain | `openclaw-no-reply-chain-debugging` | ✅ |
| route-enforcer plugin | `route-enforcer-plugin-debugging` | ✅ |
| **Patch persistence across `npm update`** | — | ❌ gap (`#136` proof) |
| **New plugin development** | — | ❌ gap |
| **Schema extension** (workaround for `additionalProperties: false`) | `openclaw-config-schema-debugging` | 🟡 partial (covers diagnosis, not automation) |

**Insight:** All 5 are **debugging** skills (fix existing), 0 are **development** skills (build new). Limits ability to extend OpenClaw.

### Cluster E: Memory / synthesis (2 active)
| Function | Skill | Status |
|----------|-------|--------|
| Daily cross-system synthesis | `daily-synthesis` | ✅ |
| Multi-session resumption | `multi-session-resumption` | ✅ |
| **Obsidian note quality** (frontmatter, wikilinks, tags) | — | ❌ gap |
| **Memory sanitization** (PII, dedup) | `scripts/memory_sanitizer.js` | 🟡 script only |
| **L0/L1 generation reliability** | — | ❌ gap (`#102` unresolved) |

### Cluster F: Maintenance / monitoring (4 active)
| Function | Skill | Status |
|----------|-------|--------|
| Heartbeat / aliveness noise filter | `aliveness-noise-reduction` | ✅ |
| Proactive alert push | `anomaly-proactive-push` | ✅ |
| Auto-issue from errors | `error-auto-issue` | ✅ |
| Heartbeat file cleanup | `heartbeat-maintenance` | ✅ |
| **Cost / token aggregation** | — | ❌ gap |
| **HA heartbeat (Ally ↔ Bliss)** | `scripts/failover_detector.sh` | 🟡 script only (`#151` 4-bug fix) |
| **Severity=3 instant Discord alert** | — | ❌ gap (`#155` in plan, 7-day delay) |

### Cluster G: Domain-specific (3 active)
| Function | Skill | Status |
|----------|-------|--------|
| Rapaport email summary | `rapaport-email-summary` | ✅ |
| X article login wall | `x-article-login-wall-fallback` | ✅ |
| Loop engineering | `loop-engineering-implementation` | ✅ |
| **Rapnet weekly workflow** | `scripts/rapnet_weekly*.js` | 🟡 scripts only |
| **Diamond grading (GIA OCR → grading)** | `scripts/gia_*.js` (5+ scripts) | 🟡 scripts only |
| **Stock merge / inventory** | `scripts/stock_*.js` (2 scripts) | 🟡 scripts only |
| **Quotation / invoice generation** | `scripts/quotation_generator.js`, `invoice_generator.js` | 🟡 scripts only |

**Insight:** 6+ business-domain scripts with no wrapping skill. Risk: knowledge lives in Josh's head + script comments.

---

## ⑤ Suggestion List — 10 Skill Proposals

> Format: **Name** | Cluster | Trigger | Effort | Priority | 1-line description

| # | Name | Cluster | Trigger | Effort | Priority | Description |
|---|------|---------|---------|:------:|:--------:|-------------|
| 1 | **`cost-and-fallback-dashboard`** | Model/Routing | Any cron run / 30-min aggregate | 🔶 Pipeline | **P0** | Aggregate token cost + fallback count across 5 LLM crons + sub-agents, push daily digest + circuit-breaker on $X/day threshold |
| 2 | **`pattern-detection-auto-skill-creation`** | Skill Curation | 3+ same-pattern issues in 7d, OR error.json repeat ≥ 3× | 🔴 Full+Approval | **P0** | Closed loop: detect recurring issue pattern → spawn sub-agent → auto-create `skills-learned/<name>/SKILL.md` proposal → present to Josh for review |
| 3 | **`obsidian-note-quality-check`** | Memory/Synthesis | Post-write (every `write_to_obsidian.js` call) | 🟡 Standard | **P1** | Validate frontmatter, wikilinks, tags, `## 啟發` section; auto-fix missing fields; push warnings to `#💼工作` if 3+ notes/week have gaps |
| 4 | **`cron-stuck-loop-recovery`** | Cron Reliability | `cron-health-triage` flags same job `error` 3 consecutive runs | 🟡 Standard | **P1** | Auto-disable job → notify `#⚙️系統` → if 24h no manual fix, escalate to P1 issue with full trace |
| 5 | **`model-fallback-notice-suppression`** | OpenClaw Internals | Post `npm update` OR Discord reply contains `↪️ Model Fallback` | 🟡 Standard | **P1** | Pre-update hook backup patch + post-update re-apply + watch script auto-alert when notice re-emits (`#136` indefinite fix) |
| 6 | **`ha-failover-synthetic-test`** | HA / Multi-Machine | Weekly Sunday 03:00 OR manual `node scripts/test_ha_failover.sh` | 🟡 Standard | **P1** | Synthetic peer-down test → verify `failover_detector.sh` debounce + self-recovery grace + notification correctness (extends `#151` observation) |
| 7 | **`obsidian-crosslink-indexer`** | Memory/Synthesis | Daily 02:30 (after L1 Gen) | 🟢 Express | **P2** | Build `[[wikilink]]` reverse-index for vault; detect orphan notes + suggest 3-5 cross-links per note; output `## 啟發` enrichment |
| 8 | **`rapnet-weekly-workflow`** | Domain (Diamond) | Friday 17:00 OR manual `node scripts/rapnet_weekly_workflow.js` | 🟡 Standard | **P1** | Wrap `rapnet_weekly.js` + `rapnet_ai_summary.js` + Discord `#💼工作` delivery into single SOP, including error handling for non-delivery |
| 9 | **`subagent-multi-report-synthesis`** | Subagent | After 2+ sub-agent spawns in same task | 🟡 Standard | **P1** | Aggregate N sub-agent reports (JSON, MD, or stdout) into unified synthesis with conflict detection, citation, deduplication |
| 10 | **`ha-state-artifact-cleanup`** | HA / Multi-Machine | Daily 04:30 (after Pattern Analysis) | 🟢 Express | **P2** | Sweep `ha-state/{ally,bliss}/*.json` for files > 30d stale; archive to `ha-state/_archive/YYYY-MM/`; auto-cleanup known-temp files |

### Prioritization Logic
- **P0 (2 skills):** Foundational, blocks future work (`#154` cost dashboard; close-the-loop pattern detection)
- **P1 (5 skills):** Address recurring pain (`#136`, `#151`, `#153`, `#155`) + domain workflows + observability
- **P2 (3 skills):** Nice-to-have automation; low risk, low value
- **Effort distribution:** 1 🔴, 1 🔶, 6 🟡, 2 🟢 → **lean toward Standard** (per AGENTS.md "唔好 default 行 full pipeline")

### Cross-Reference to Issues
| Skill Proposal | Triggered By | Status of Underlying Issue |
|----------------|--------------|----------------------------|
| #1 cost dashboard | `#154` (planned Phase 1.2) | Awaiting Josh D1-D5 decisions |
| #2 pattern → auto-skill | 35 active issues, 10 P1 | New proposal |
| #3 obsidian quality | 21 crons writing Obsidian, 0 checks | New proposal |
| #4 stuck loop recovery | `#138` (3 consecutive fails), `#151` | Issue open, in observation |
| #5 fallback notice | `#136` (indefinite) | Issue open, reopens on every npm update |
| #6 HA failover test | `#151` Notes suggest improvement | Issue in observation |
| #7 cross-link indexer | Daily Synthesis `#156` timeout | Separate work |
| #8 Rapnet weekly | 217 scripts include 4+ rapnet scripts | New proposal |
| #9 multi-report synthesis | AGENTS.md Step 4 Parallel spawn logic | Implicit in current workflow |
| #10 HA state cleanup | `#151` cleanup of `last_hb_bliss` | 1-of-many stale files |

---

## ⑥ Strategic Recommendations

### Recommendation A: Promote 3 high-value quarantined skills within 30 days
The 2026-06-10 batch quarantined 10 skills, 3 of which are particularly high-value (proven by issues):
1. `cron-context-overflow-recovery` → connects to `#153` (already closed, but pattern remains)
2. `cron-passive-job-detection` → would catch the 4ms duration bug
3. `cron-p0-rescue-workflow` → wraps `#144` systemEvent migration

If QW-1~5 (`#152`) succeeds in 7 days, the prompt quality issue blocking these is resolved. Schedule re-eval for 2026-06-19.

### Recommendation B: Build the "Pattern → Skill" closed loop as Q1 priority
With 35 active issues, 10 P1, and an indefinite issue (`#136`), the manual rate of skill creation cannot keep up. The `pattern-detection-auto-skill-creation` skill (suggestion #2) is the single highest-leverage addition. Estimated effort: 6-8 hours, but enables sub-linear growth of library vs issues.

### Recommendation C: Cost + fallback dashboard is blocking `#154`
Issue `#154` cannot proceed without cost aggregation. Make this P0 in next sprint. Estimated 4.5hr matches `#154` Phase 1.2 plan; can reuse `cron_recovery_monitor.js` design.

### Recommendation D: Domain-skill wrapping is the 2nd biggest gap
217 scripts vs 38 skills = **5.7 scripts per skill**. Cluster G shows 6+ business-domain scripts (Rapnet, diamond, stock, quotation) without skill wrappers. Each is a single-effort 🟡 Standard skill, but cumulative knowledge recovery is high.

### Recommendation E: Reject 4 suggestion-list skills as out-of-scope
For 30-day focus, drop or defer:
- #7 `obsidian-crosslink-indexer` (P2, low immediate value)
- #10 `ha-state-artifact-cleanup` (P2, can be cron-only)
- #9 `subagent-multi-report-synthesis` (defer to Q3 — current AGENTS.md pattern works)
- #6 `ha-failover-synthetic-test` (defer until `#151` observation closes 2026-06-21)

**Net recommended additions: 6 skills (P0×2 + P1×4) over 30 days.** Total estimated effort: ~18 hours (P0×2 = 10hr, P1×4 = 8hr).

---

## 📌 Summary

| Metric | Value | Note |
|--------|-------|------|
| Active skills | 38 | Verified on disk |
| Quarantined (proposed value) | 10 (2026-06-10 batch) | 3 are high-value, blocked by `#152` QW-1~5 |
| Coverage (full) | 21/49 scenarios (43%) | Matrix table |
| Coverage (gap) | 14/49 (29%) | Critical operational gaps |
| Coverage (quarantined) | 5/49 (10%) | Real coverage is 53%, not 43% |
| Top gap category | User-facing + Cost + Recovery | 3 categories with 0% coverage |
| Top suggested skill | `cost-and-fallback-dashboard` | Blocks `#154` |
| Most strategic gap | `pattern-detection-auto-skill-creation` | Closes the manual bottleneck |
| Recommended 30-day effort | 6 skills / ~18 hours | 2 P0 + 4 P1 |

**Final verdict:** The library is **dense in coverage of internal DevOps** (cron, subagent, OpenClaw internals, skill self-curation) but **sparse in coverage of user-facing, financial, security, testing, observability, and recovery**. The strategic bottleneck is not skill count but **lack of closed-loop pattern detection** — without it, the library grows linearly with issues rather than sub-linearly.

---

*Generated 2026-06-12 18:02 HKT by subagent (depth 1/1) on behalf of main agent. Method: filesystem verification + issue/memory cross-reference. Source: 35 active issues, 66 errors, 217 scripts, 21 crons, 38 active + 20 archived + 6 quarantined + 2 failed skills.*
