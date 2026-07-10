---
id: 131
title: Dynamic Workflow Pilot — 1st judgment-heavy skill (spawn_prompt_review)
status: closed
priority: P2
created: 2026-06-06
due: 2026-07-06
closed: 2026-07-10
updated: 2026-07-10
progress: 5/5
outcome: "Closed via Option A — AGENTS.md §Spawn 原則 → Pre-Spawn Quality Checklist (5 bullets) replaces skill-based pilot. Pilot 核心價值已實現，零 overhead。5 條 deterministic checks 直接 hardcoded 喺 Ally system prompt，每次 spawn Ally 自動 self-check。"
scope_change: "2026-06-11 M3 feasibility analysis: problem statement corrected. weekly_correction_loop.js (1657 lines, 5 phases, 19 sub-steps, 10 helpers, 4 reason codes) is NOT linear — already a structured state machine. Artem's Dynamic Workflow 3 pain points (laziness/self-bias/goal-drift) DON'T EXIST in this architecture. Real gap: judgment-heavy skills per Vox framework."
rewrite_history:
  - "2026-06-22 Round 6 triage rewrite — original observation period (6/11-6/14) expired 8 days ago, pilot never started. Reopening with reset Step 2 (Josh go/no-go decision still pending)."
  - "2026-07-10 14:40 HKT — Josh go/no-go: NO-GO on skill-based pilot. Deploy Option A (AGENTS.md bullets) instead. Closed."
---


## F - Facts（事實）
> Updated 2026-06-22 — Round 6 audit (8 days after original observation expired)

### Round 6 Status (2026-06-22)

- **Original observation period expired 8 days ago** (was 2026-06-11 → 2026-06-14, ended 2026-06-14 00:48 HKT)
- **Pilot never started.** No `spawn_prompt_review` SKILL.md, no thin executor, no A/B test data
- **Reason:** 6/14 後冇 review trigger，#131 跌入 Round 6 triage stale bucket
- **M3 verdict from 6/11 still stands:** spawn_prompt_review 係 recommended first pilot

### 5 Deterministic Checks — Current Enforcement State

| Check | AGENTS.md enforce? | scripts/ enforce? | Skill enforce? |
|-------|--------------------|--------------------|----------------|
| **CHECK 1: Scope Block completeness** | ✅ AGENTS.md L284-325 (Scope Block 強制 section) | ❌ No pre-spawn validator | ❌ No skill |
| **CHECK 2: 🚫 Cannot Do present** | ✅ AGENTS.md L327-334 | ❌ No pre-spawn validator | ❌ No skill |
| **CHECK 3: ✅ Goal Verification** | ✅ AGENTS.md L336-342 | ❌ No pre-spawn validator | ❌ No skill |
| **CHECK 4: Task verb presence** | ⚠️ Partially (mentioned in THINK 原則) | ❌ No pre-spawn validator | ❌ No skill |
| **CHECK 5: Reference completeness** | ⚠️ Implicit (research spawn 講「壓縮 input，避免 sub-agent 自己 read 成個 file」) | ❌ No pre-spawn validator | ❌ No skill |

**Gap:** 所有 5 checks 都喺 AGENTS.md prompt template (manual enforcement)，冇任何 **pre-spawn** script-level enforcement。`scripts/spawn_config.js` (131 lines) 純係 model router wrapper — 冇 prompt validation hook。`spawn-prompt-review` skill 唔存在於 `skills/` 或 `skills-learned/`。

### Cross-Check: Live Spawn-Related Skills (2026-06-22)

```
skills/                     → 冇 spawn-related skill
skills-learned/             → 冇 spawn-related skill
~/.openclaw/workspace/.spawn/reports/dynamic_workflow_feasibility/
                           → 唔存在 (M3 raw analysis 6/11 後未 persist 成 folder)
```

### M3 Original Feasibility Analysis (2026-06-11)

**Model:** MiniMax-M3 (SPAWN_QUALITY) | **Duration:** 9m45s | **Tokens:** 2.9M total

| Approach | Effort | Value | Risk | Verdict |
|----------|--------|-------|------|---------|
| A. Do nothing (close) | 0 | 0 | 0 | ❌ Reject — 留低 #121 重疊問題 |
| **B. Pilot 1 judgment-heavy skill** | **1-2 days** | **Medium-High** | **Low** | **✅ Recommended** |
| C. Full rewrite (Dynamic Workflow) | 1-2 weeks | 0 (wrong problem) | High | ❌ Defer |
| D. Hybrid (add judgment step) | 2-3 days | Low | Med | ⚠️ Fallback |

**M3 recommended first pilot: `spawn_prompt_review`**

| Criterion | Score | Why |
|-----------|-------|-----|
| Frequency | ★★★★★ | 每個 spawn 都用 |
| Error cost | ★★★★ | Compound — bad spawn = bad sub-agent result |
| Deterministic ratio | ★★★★☆ | 80% structural |
| Self-measurable | ★★★★★ | Easy A/B: 5 spawns w/ review vs 5 w/o |
| Blast radius | Low | Internal — not email/business-critical |
| Thin executor ready | ★★★★★ | Intercept before `sessions_spawn` |

### Vox's 5 Problems — Existing Architecture Coverage

| Vox Problem | Existing Solution |
|-------------|-------------------|
| Collaborate | ✅ Discord #⚙️系統 channel |
| Overlap | ✅ `correction_suggestions.json` state |
| When to step in | ✅ Cron fixed schedules |
| Share state | ✅ weekly_correction_loop |
| Continuously improve | ✅ pattern_proactive_trigger |

### Round 6 Verdict Reference

#131 survives Round 6 stale triage (今朝 closed 9 個, 留 #131 + #140) — 因為 judgment-heavy framework 仍然 valuable，問題只係 execution 從未啟動。

## D - Decisions（決定）
> Updated 2026-06-22 — Round 6 rewrite

### ✅ 已做決定
- **2026-06-22 取消「改寫 correction loop」方向** — `weekly_correction_loop.js` already structured state machine，original problem 唔存在 (per 6/11 M3 analysis)
- **2026-06-22 確認 pilot target = `spawn_prompt_review`** — M3 Round 5 verdict 仍然 valid (highest frequency, lowest blast radius)
- **2026-06-11 Josh 口頭決定**: 觀察多 3 日再 go/no-go（觀察期已過，go/no-go decision 仍然 pending）
- **2026-06-11 Priority 降級 P1 → P2** (唔 urgent)

### ⏳ 待做決定
- **2026-07-06 之前 — Josh go/no-go on `spawn_prompt_review` pilot** (NEW due date，14 日後)
- **3 個 alternative pilot 嘅 priority ranking** (if spawn_prompt_review 否決):
  1. `email_judgment` — business-critical, 每日 1-3 次
  2. `obsidian_quality_review` — cross-link validation，每次 write
  3. _（仲有冇更新嘅 candidate？舊 list 嘅 `brand_voice_review` / `memory_synthesis_review` 已 reject）_

## Q - Questions（未解決）
> Round 6 fresh questions

### ❓ 核心問題
1. **過去 8 日 (6/14-6/22) 有冇 spawn prompt 出過 confusion/wasted work？** —— 如果冇，可能 pilot 嘅 urgency 再降；如果有，反而係 pilot 嘅 strong justification。
2. **`spawn_prompt_review` 仲係 right first pilot 嗎？** —— 14 日後嘅今天，frequency / error cost 嘅 ranking 可能有變（特別係 Kimi WebBridge recovery / skill-reviewer pipeline 等新 routine）。
3. **Pilot 嘅 thin executor integration 應該 hook 入邊度？**
   - Option A: **Pre-spawn wrapper** — `sessions_spawn` 之前行 check（需要 sessions_spawn 工具 wrapper，唔實際）
   - Option B: **spawn_config.js 內部 hook** — extend `scripts/spawn_config.js` 加 validation step（131 lines → ~180 lines，cleanest）
   - Option C: **Standalone `scripts/spawn_prompt_review.js`** — Ally 自己 spawn 前 `exec` 一次，純 manual workflow
4. **80/20 deterministic + 20% LLM judgment 嘅 ratio 仲啱嗎？** —— Round 6 期間 LLM cost sensitivity 增加，可能要降到 95/5 或 pure deterministic first。

### ❌ 已關閉
- ~~`brand_voice_review`~~ (Ally output = not Josh judgment)
- ~~`memory_synthesis_review`~~ (already cron-verified)
- ~~改寫 correction loop~~ (problem 不存在)

## Progress
- [x] Step 1: M3 feasibility analysis (2026-06-11) — problem statement corrected, approach B recommended
- [x] **Step 2a: Round 6 audit (2026-06-22)** — re-evaluate 8 days later, verdict unchanged but execution never started
- [x] **Step 2b: Josh go/no-go decision (2026-07-10)** — **No-go on skill-based pilot**. Reason: skill-auto-suggest similarity-based loading 不可靠（task description 不一定 match 到 `spawn_prompt_review`）。改用 Option A — hardcode 5 bullets 入 `AGENTS.md §Spawn 原則 → Pre-Spawn Quality Checklist`。
- [x] **Step 3 (替代方案 2026-07-10 14:40 HKT)：** AGENTS.md 已 deploy Pre-Spawn Quality Checklist section (line 284-292)。5 條 deterministic checks 同原本 `spawn_prompt_review` skill 嘅 spec 完全對應。Pilot 核心價值已實現，零 overhead。
- [x] **Step 4：** AGENTS.md edit verified — 5 bullets + close-out note rendered correctly
- [x] **Step 5: Close-out (2026-07-10 14:40 HKT)** — Verdict: Option A (AGENTS.md bullets) 取代 skill-based pilot。Auto-suggest 5 checks 從此係 hardcoded rule，每次 spawn Ally 都會 self-check。Issue close。

## Notes

### Cross-References
- **#162** (parent skill pipeline master issue — referenced as overall skill-automation umbrella)
- **#121** (weekly-correction-loop overlap — overlap 仍然 unsolved, 是 pilot 嘅 motivation)
- **M3 raw analysis (6/11):** `.spawn/reports/dynamic_workflow_feasibility/` 未建立 folder，原始 output 只喺 sub-agent session memory
- **AGENTS.md L284-342:** Scope Block + Cannot Do + Goal Verification 嘅 manual enforcement sections

### ✅ Ready-to-Implement Checklist: 5 Deterministic Checks (preserved from 6/11 body)

```
CHECK 1: Scope Block completeness
  - Has `📋 Scope` header?
  - Has at least 1 `✅ In scope:` line?
  - Has at least 1 `❌ Out of scope:` line?
  → FAIL if missing any

CHECK 2: 🚫 Cannot Do section present
  - Has `### 🚫 Cannot Do` header?
  - Has at least 1 line starting with `- Do NOT`?
  → WARN if missing (20% cases need LLM review)

CHECK 3: ✅ Goal Verification block
  - Has `✅ Success criteria:` line?
  - Has `❌ Abort criteria:` line?
  → FAIL if missing any

CHECK 4: Task verb presence
  - Prompt starts with an action verb (Analyze/Search/Fix/Implement/Create/Review)?
  - Or starts with a clear noun + verb pattern?
  → WARN if passive voice or ambiguous opening

CHECK 5: Reference completeness
  - If mentions a script/file → file exists?
  - If references another issue → issue exists?
  → WARN if dangling reference
```

### 🏗️ SKILL.md Skeleton (draft v0.1 — preserved from 6/11 body)

```markdown
# spawn-prompt-review SKILL.md

Capture spawn prompt quality before sessions_spawn.

## Trigger
Before every `sessions_spawn` call with prompt >100 chars.

## Procedure
1. Run 5 deterministic checks (see checklist above)
2. If all pass AND prompt <500 tokens → pass, no LLM call
3. If ≥1 WARN OR prompt >500 tokens → spawn M2.7 judgment sub-agent
4. Integrate result: prefix to spawn response OR flag to user

## Output Format
[spawn-review]
  checks: ✅✅✅✅✅ (5/5 pass)
  judgment: skipped (deterministic pass)
  verdict: ✅ clean spawn

or

[spawn-review] ⚠️ Check 3 FAIL (missing Goal Verification)
  Suggest adding:
  ✅ Success criteria: sub-agent outputs analysis
  ❌ Abort if: can't read the file

## Limits
- Skip LLM judgment for prompts <100 chars (trivial yes/no questions)
- Skip for cron agentTurn prompts (already thin executor validated)
- 3s timeout on deterministic checks; 10s on LLM judgment (with M2.7 flash)
```

### 🎯 Acceptance Criteria (preserved from 6/11 body)

**Pass (Pilot successful, scale to next skill):**
- 5 A/B test spawns: judgment layer catches ≥1 issue that Josh agrees is valuable
- Cyn ratio > 0.5 (Josh overrides/approves ≥50% of suggestions)
- False-positive rate < 20% (Josh dismisses <20% of alerts)
- Thin executor runtime < 5s per check (no regression to spawn latency)

**Blocked (need iteration before scale):**
- Judgment layer catches issues but Josh disagrees with ≥50%
- Cyn ratio 0.2-0.5 (some value but patterns unclear)
- Thin executor integration breaks existing spawn flow

**Fail (kill pilot, close #131):**
- No issues caught in 5 test spawns
- Judgment layer catches only trivial syntax issues (no judgment value)
- Thin executor adds >5s latency per spawn
- Josh consistently disagrees with >80% of suggestions

## 📅 6/22 Decision Checklist (replaces 6/14 Decision Checklist)

When reopening this issue on next session (or by 2026-07-06):

- [ ] Did any spawn prompt cause confusion or wasted work in the last 8 days (6/14-6/22)?
- [ ] Is `spawn_prompt_review` still the right first pilot? Or has a more urgent judgment skill emerged from Round 6/7 work?
- [ ] Josh go/no-go decision recorded (with date + reason)?
- [ ] If go: Step 3 implementation — SKILL.md + spawn_config.js extension (Option B) + A/B test (1-2 days)
- [ ] If no-go: Close #131, document reason, move content to knowledge base
- [ ] If deferred: Set new observation period, record why not ready yet
