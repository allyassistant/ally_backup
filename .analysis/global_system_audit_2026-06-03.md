# Global System Audit Report
**Date:** 2026-06-03  
**Auditor:** System Auditor (Ally)  
**Scope:** AGENTS.md, .spawn/ templates, skills/kimi-deep-research/SKILL.md, HEARTBEAT.md  
**Method:** Cross-reference analysis, tone comparison, orphaned reference scan, policy compliance check

---

## Executive Summary

| Metric | Result |
|--------|--------|
| **Cross-reference Integrity** | ✅ Bidirectional, accurate |
| **Template Inventory** | ⚠️ Partial (3/8 documented in table) |
| **Orphaned References** | ✅ Clean in target files |
| **Tone Consistency** | ⚠️ Minor bilingual drift |
| **Tier↔Template Mapping** | ✅ Exact match |
| **SOP↔Skill Workflow** | ⚠️ Condensed — omits pre-browser validation step |
| **sessions_yield Compliance** | ✅ Clean in target files |
| **Overall Health Score** | **7 / 10** |

---

## 1. Cross-References: AGENTS.md ↔ Skill

| Direction | Location | Target | Status |
|-----------|----------|--------|--------|
| AGENTS.md → Skill | Line 372 (SOP Index) | `skills/kimi-deep-research/SKILL.md` | ✅ Exact path, notes "詳見" |
| Skill → AGENTS.md | Line 10 (SKILL.md) | `AGENTS.md ## 📋 SOP 索引` | ✅ Exact section reference |

**Verdict:** Bidirectional linkage is present and accurate. Both files acknowledge each other by exact path/section. No broken links.

---

## 2. Template List Completeness

**Actual files in `.spawn/` (8 total):**
```
_preamble.md, code_fix.template, critic.template, research.template,
spec_writer.template, structured_spawn.template, summary_example.md, validator.template
```

**Documented in AGENTS.md table (lines 223–227):**
| Template | 用途 |
|----------|------|
| `.spawn/code_fix.template` | Express / Standard code fix |
| `.spawn/structured_spawn.template` | Standard 複雜 task / Pipeline 開頭 phase |
| `.spawn/summary_example.md` | X Link / article analysis 格式參考 |

**Missing from table:** `_preamble.md`, `critic.template`, `research.template`, `spec_writer.template`, `validator.template`

**Mitigation:** AGENTS.md explicitly says `ls .spawn/` 睇所有可用 template — this is the intended discovery mechanism. The table only covers the 3 templates directly referenced by the Pipeline Tier System.

**Verdict:** ⚠️ Not a bug, but a documentation gap. Recommend adding a footnote to the table: "其他模板見 `ls .spawn/`" to make the discovery path explicit.

---

## 3. Orphaned References to Deleted Phase System

**Scan scope:** All 5 target files + grep across entire workspace.

| File | Phase System Mention? |
|------|----------------------|
| AGENTS.md | ❌ No — was added then reverted on 2026-06-03 |
| structured_spawn.template | ❌ No |
| code_fix.template | ❌ No |
| SKILL.md | ❌ No |
| HEARTBEAT.md | ❌ No |

**Context:** Phase System was proposed (see `memory/2026-06-03-2001.md`), critiqued as overlapping with existing Pipeline Flow, and reverted. The revert was clean — no residue in active documentation.

**Verdict:** ✅ Clean. No orphaned references in the authoritative docs.

---

## 4. Spawn Template Tone Consistency

| Dimension | code_fix.template | structured_spawn.template | Issue |
|-----------|-------------------|--------------------------|-------|
| **Language mix** | English headers + Chinese constraints | English headers + Chinese intro | Consistent bilingual pattern ✅ |
| **Imperative tone** | Strong ("Do NOT refactor", "must pass") | Strong ("Do NOT edit yet", "do not continue") | Consistent ✅ |
| **Scope handling** | "If scope unclear → stop and ask, do not guess" | "If unclear → stop, report to main agent, do not wait" | Slightly different action (ask vs report) ⚠️ |
| **Cannot Do** | 7 bullets, includes dependency ban | 4 bullets, includes contradiction rule | Both comprehensive ✅ |
| **Definition of Done** | Includes "Learning captured for next run" | Includes "Source material cited" | structured_spawn missing "Learning captured" ⚠️ |
| **Unique sections** | Constraints (Chinese), Tools list | Phases, Stop Conditions | By design — different tiers ✅ |

**Tone Drift Identified:**
1. **Action divergence on unclear scope:** code_fix says "stop and ask" (user-facing); structured_spawn says "report to main agent" (sub-agent-facing). This is contextually appropriate but not harmonized.
2. **Learning capture:** code_fix.template has "Learning captured for next run" as a Done criterion; structured_spawn.template lacks this. Since structured_spawn is for 🔶 Pipeline / 🟡 Standard tasks where learning is equally valuable, this should be added.

**Verdict:** ⚠️ Minor inconsistencies. Recommend adding "Learning captured" to structured_spawn.template and harmonizing the unclear-scope action verb.

---

## 5. Pipeline Tier ↔ Template Mapping

**AGENTS.md Tier Table (lines 214–219):**

| Tier | Template Assignment |
|------|---------------------|
| 🟢 Express | `.spawn/code_fix.template` |
| 🟡 Standard | code_fix (reference) |
| 🔶 Pipeline | structured_spawn (opening phase) |
| 🔴 Full+Approval | Pipeline Flow + review |

**structured_spawn.template self-declaration (line 3):**
> "比 code_fix.template 更詳細，適用於 🟡 Standard 同 🔶 Pipeline 開頭 phase。唔啱 🟢 Express（用 code_fix.template 就夠）。"

| Tier | AGENTS.md Says | Template Says | Match? |
|------|---------------|---------------|--------|
| 🟢 Express | code_fix | code_fix (唔啱 structured_spawn) | ✅ |
| 🟡 Standard | code_fix (可參考) | structured_spawn | ⚠️ Partial — AGENTS.md says Standard "可參考 code_fix", template says Standard should use structured_spawn |
| 🔶 Pipeline | structured_spawn (開頭 phase) | structured_spawn | ✅ |

**Analysis:** AGENTS.md line 217 says 🟡 Standard → "Think in Tasks → spawn code（可參考 `.spawn/code_fix.template`）". The template itself claims to be for 🟡 Standard. There is a slight ambiguity: AGENTS.md presents code_fix as the primary reference for Standard, while structured_spawn claims it is the right tool for Standard.

In practice, the boundary between 🟡 Standard and 🔶 Pipeline is fuzzy, and both templates are valid for Standard depending on complexity. The documentation is directionally correct but could clarify: 🟡 Standard *lightweight* → code_fix, 🟡 Standard *complex* → structured_spawn.

**Verdict:** ⚠️ Minor ambiguity at the 🟡 Standard boundary. Not a mismatch, but a gap in granularity.

---

## 6. Kimi SOP in AGENTS.md vs Skill Workflow

**AGENTS.md SOP (line 372, condensed):**
```
browser open → login Google → pre-flight check → prompt → handle clarify Qs
→ output validation → write_to_obsidian + wiki_apply → close tab
如果 phase stuck→partial write；scope 太大→split 做多次
```

**SKILL.md Workflow (Step 0–5):**
```
Step 0: Validation (before browser open)
Step 1: Prompt
Step 2: Clarifying Questions
Step 3: Monitor
Step 4: Output Validation
Step 5: Write to Knowledge Base
```

| Step | SKILL.md | AGENTS.md SOP | Match? |
|------|----------|---------------|--------|
| Pre-browser validation | ✅ Step 0 (sensitive data check, wiki_search, spawn-vs-Kimi decision) | ❌ **Missing entirely** | 🔴 Gap |
| Browser open | Implicit | ✅ Mentioned | ✅ |
| Login | N/A (assumed) | ✅ Mentioned | ✅ |
| Pre-flight checklist | 6 items (login, tab clean, mode, scope≤5, keywords≤5) | Condensed to "pre-flight check（login, tab clean, mode, scope ≤5 dimensions, keywords ≤5）" | ✅ |
| Prompt | ✅ Step 1 | ✅ Mentioned | ✅ |
| Clarify Qs | ✅ Step 2 | ✅ Mentioned | ✅ |
| Monitor | ✅ Step 3 (phase system) | ❌ Not mentioned by name | ⚠️ Implied by "phase stuck→partial write" |
| Output validation | ✅ Step 4 (5 checklist items) | ✅ All 5 items condensed | ✅ |
| Write to KB | ✅ Step 5 (Obsidian + Wiki) | ✅ Mentioned | ✅ |
| Close tab | ✅ Step 5 | ✅ Mentioned | ✅ |
| Error handling (stuck/split) | ✅ Error Handling section | ✅ Mentioned | ✅ |

**Critical Gap:** AGENTS.md SOP **omits Step 0 (Validation)** entirely. The SOP jumps straight to "browser open" but SKILL.md mandates validation *before* opening the browser (check sensitive data, wiki_search for duplicates, decide spawn vs Kimi). This is a workflow-breaking omission — a user following only AGENTS.md might open the browser for a task that should have been handled by spawn MiniMax or skipped due to sensitive data.

**Secondary Gap:** AGENTS.md omits the paid/free distinction. SKILL.md Pre-flight item 4 says "係咪用 Deep Research mode？（agent-swarm 係 paid）". AGENTS.md says "mode" without clarifying that agent-swarm requires paid tier. This could lead to a blocked workflow.

**Verdict:** ⚠️ Moderate issue. Step 0 omission is the most significant. Recommend updating AGENTS.md SOP to include pre-browser validation.

---

## 7. sessions_yield Violations

**Policy (AGENTS.md lines 82, 111–114):**
> "❌ 唔好 yield — 用戶會以為你 hung 咗，send multiple messages"  
> "spawn sub-agent 後，先覆用戶一句話俾佢知進度，唔好 sessions_yield。"

| File | sessions_yield Mention | Context | Violation? |
|------|----------------------|---------|------------|
| AGENTS.md | ✅ Forbidden explicitly | Policy line | N/A (source of rule) |
| structured_spawn.template | ❌ None | — | ✅ Clean |
| code_fix.template | ❌ None | — | ✅ Clean |
| SKILL.md | ❌ None | — | ✅ Clean |
| HEARTBEAT.md | ❌ None | — | ✅ Clean |

**Workspace scripts note:** `scripts/closed_loop_v11_runner.js` and `scripts/pure_audit_runner.js` reference `sessions_yield` as a technical mechanism for multi-agent coordination. These are infrastructure scripts, not user-facing workflows, and operate outside the scope of the "Sub-agent Response Rule" which governs *user communication* behavior. No action needed.

**Verdict:** ✅ Clean in all 5 target files. Policy is clear and unviolated.

---

## 8. Additional Findings (HEARTBEAT.md)

| Issue | Location | Detail | Severity |
|-------|----------|--------|----------|
| Duplicate job number | Daily table | #12 appears twice: "Daily Summary" and "Knowledge Bootstrap" | Low |
| Job count mismatch | Header says "14" daily, footer says "18 Cron Jobs" | Actual: 15 daily rows (14 unique), 1 minutely, 4 weekly, 1 monthly = 21 total; 2 disabled = 19 active | Low |
| Stale timestamp | Footer | "Last Updated: 2026-05-10" but Mail Monitor and Connection Surface marked "新増" (added after May 10) | Low |
| Orphaned job ID | ID lookup table | `0029a681-7be1-4ccd-970e-abce5ddb8925` "Wiki to Obsidian Daily Sync" listed, but job disabled (⏸️ 已停用 → direct write only) | Low |

---

## Recommendations

| Priority | File | Action |
|----------|------|--------|
| **P1** | AGENTS.md | Add Step 0 (pre-browser validation) to Kimi Deep Research SOP line 372 |
| **P1** | AGENTS.md | Add paid/free mode note to Kimi SOP pre-flight checklist |
| **P2** | AGENTS.md | Add footnote to Template table: "其他模板見 `ls .spawn/`" |
| **P2** | structured_spawn.template | Add "Learning captured for next run" to Definition of Done |
| **P2** | structured_spawn.template | Harmonize unclear-scope action with code_fix ("stop and ask" vs "report to main agent") |
| **P2** | HEARTBEAT.md | Fix duplicate #12, update total count to 21 (19 active), update Last Updated date |
| **P3** | AGENTS.md | Clarify 🟡 Standard tier: lightweight → code_fix, complex → structured_spawn |

---

## Health Score: 7/10

| Category | Score | Notes |
|----------|-------|-------|
| Reference Integrity | 9/10 | Bidirectional links solid; one gap in SOP condensation |
| Documentation Accuracy | 6/10 | HEARTBEAT.md has counting errors and stale timestamps |
| Policy Compliance | 9/10 | sessions_yield rule clear and respected |
| Internal Consistency | 7/10 | Templates mostly aligned; minor tone/done-criteria drift |
| Architectural Cleanliness | 8/10 | No orphaned Phase System; Tier↔Template mapping sound |
| **Weighted Average** | **7/10** | System is functional and well-structured, with documentation polish gaps |

---

*Audit completed: 2026-06-03 20:52 HKT*
