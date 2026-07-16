---
id: 131
title: Dynamic Workflow Pilot — 1st judgment-heavy skill (spawn_prompt_review)
status: archive
priority: P2
created: 2026-06-06
due: 2026-06-14
updated: 2026-07-16
progress: 1/3
---

## F - Facts（事實）
> 確定已知的事實、數據、現狀 (updated 2026-06-11 per M3 analysis)

### 現況
我哋現有 `weekly_correction_loop.js`（每星期日 11:00 run），初時認為係 **linear script**，但 M3 深入睇 code 後發現實際係 **structured state machine**：
- 1657 lines, 5 phases
- 19+ sub-steps
- 10 helper functions
- 4 reason codes + `--inactivity-trigger` variant
- Deterministic state checks in every phase
- Already integrated with cron via `--inactivity-trigger`

**所以 #131 嘅原始 problem statement (linear loop → rewrite) 唔成立。** 現有架構已經 solve 咗 Artem 提到嘅 3 個痛點 (agent laziness / self-preferential bias / goal drift) — 因為每個 cron 都有 deterministic state checks。

**Vox (@Voxyz_ai) 嘅 insight 仍然有效**：我哋 13 個 cron scripts 全部係 light task (auto scan/fix) — 冇一個係 **judgment-heavy skill**。

### M3 Feasibility Analysis (2026-06-11)

**Model:** MiniMax-M3 (SPAWN_QUALITY) | **Duration:** 9m45s | **Tokens:** 2.9M total

| Approach | Effort | Value | Risk | Verdict |
|----------|--------|-------|------|---------|
| A. Do nothing (close) | 0 | 0 | 0 | ❌ Reject — 留低 #121 重疊問題 |
| **B. Pilot 1 judgment-heavy skill** | **1-2 days** | **Medium-High** | **Low** | **✅ Recommended** |
| C. Full rewrite (Dynamic Workflow) | 1-2 weeks | 0 (wrong problem) | High | ❌ Defer |
| D. Hybrid (add judgment step) | 2-3 days | Low | Med | ⚠️ Fallback |

**M3 recommended first pilot: `spawn_prompt_review`** (NOT `brand_voice_review` from the original list — Ally's own output review is not Josh's judgment)

**點解 `spawn_prompt_review`：**
| Criterion | Score | Why |
|-----------|-------|-----|
| Frequency | ★★★★★ | 每個 spawn 都用 (multi-day task chain) |
| Error cost | ★★★★ | Compound — bad spawn = bad sub-agent result |
| Deterministic ratio | ★★★★☆ | 80% structural (Scope/Cannot Do/Goal Verification/task verb) |
| Self-measurable | ★★★★★ | Easy A/B: 5 spawns w/ review vs 5 w/o |
| Blast radius | Low | Internal — not email/business-critical |
| Thin executor ready | ★★★★★ | Intercept before `sessions_spawn` |

**Foundational skills check (Vox's 5 problems — existing architecture ALL covers):**
| Vox Problem | Existing Solution |
|-------------|-----------------|
| Collaborate | ✅ Through Discord #⚙️系統 channel |
| Overlap | ✅ Through `correction_suggestions.json` state |
| When to step in | ✅ Through cron fixed schedules |
| Share state | ✅ Through weekly_correction_loop |
| Continuously improve | ✅ Through `pattern_proactive_trigger` |

## D - Decisions（決定）
> 識別已做或待做的決定 (updated 2026-06-11)

### ✅ 已做決定
- 2026-06-06 決定：要改寫 correction loop 用 Dynamic Workflow pattern（Josh 口頭表示「幫我記入issue先」）
- 2026-06-11 M3 analysis：原始 problem statement 唔成立 (loop already structured)，但 Vox's judgment-heavy framework 仍然 valuable
- 2026-06-11 Josh 決定：觀察多 3 日再決定係咪做 `spawn_prompt_review` pilot
- 2026-06-11 Priority 降級 P1 → P2 (唔 urgent)

### ⏳ 待做決定
- 2026-06-14 觀察期結束後：Go/no-go on `spawn_prompt_review` pilot

## Q - Questions（未解決）
> 列出所有未回答的問題 (updated 2026-06-11)

### ❓ 核心問題
1. ~~**Scope 重新對齊**：由「改 correction loop」升級做「Build judgment-heavy skill library」— 第一個 skill 應該係咩？~~ **M3 answered: spawn_prompt_review**
2. ~~Claude Dynamic Workflow 係 Claude Code 功能，我哋 main session 可以點用？~~ **M3 resolved: MiniMax M3 spawn 已經夠做**
3. ~~現有 `.cross_session_context.md` / `correction_suggestions.json` 係咪可以直接做 Phase 1 inputs？~~ **M3 confirmed: yes, but not needed for pilot**
4. ~~13 個 cron scripts 入面有冇任何一個可以 convert 做 judgment-heavy skill？~~ **M3 confirmed: 全部都係 light task，新 pilot 要獨立寫**
5. **觀察期間 (6/11-6/14) 確認：** 需要做 `spawn_prompt_review` pilot？定有其他 judgment skill 更 urgent？
6. Pilot 成功後點 scale？`email_judgment` 做第二個？

### ❌ 已關閉
- ~~`brand_voice_review`~~ (Ally 自己 output 唔係 Josh 嘅 judgment)

### 🎯 候選 Skills（按「personal double-check」頻率）
| Task | 頻率 | 候選 SKILL | M3 Verdict |
|------|------|-----------|------------|
| Discord 訊息語氣 review | 每日多次 | brand_voice_review | ❌ Ally output = not Josh judgment |
| Email draft review | 每日 1-3 次 | email_judgment | ⚠️ 2nd pilot (business-critical) |
| L0/L1 generation verify | 每日 2 次 | memory_synthesis_review | ❌ Already verified by cron |
| Obsidian cross-link validation | 每次 write | obsidian_quality_review | ⚠️ Good but lower frequency |
| Spawn prompt clarity check | 每次 spawn | spawn_prompt_review | ✅ **Recommended first pilot** |

## Progress
- [x] Step 1: M3 feasibility analysis (2026-06-11) — problem statement corrected, approach B recommended
- [ ] Step 2: Observation (2026-06-11 → 2026-06-14) — 3 days to confirm `spawn_prompt_review` pilot
- [ ] Step 3: Implement pilot — SKILL.md + thin executor + A/B test

## Notes

- **M3 analysis date:** 2026-06-11 | **Model:** MiniMax-M3 | **Duration:** 9m45s | **Tokens:** 2.9M
- **Recommended pilot:** `spawn_prompt_review` (NOT `brand_voice_review` — wrong first pick)
- **Why not C (full rewrite):** weekly_correction_loop.js (1657 lines, 5 phases, 19 sub-steps, 10 helpers, 4 reason codes) is already a structured state machine. Dynamic Workflow pain points DON'T APPLY.
- **Why not A (do nothing):** #121 overlap issue remains unsolved
- **Observation window:** 2026-06-11 00:48 → 2026-06-14 00:48 HKT
- **M3 raw analysis:** `.spawn/reports/dynamic_workflow_feasibility/` (or sub-agent taskName: `dynamic_workflow_feasibility`)

## 🎯 Acceptance Criteria — `spawn_prompt_review` Pilot

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

## 📋 Spawn Prompt Review — 5 Deterministic Checks

80% of validation is structural. These 5 checks should be hard-coded (no LLM needed):

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

**20% LLM judgment layer** — For prompts >500 tokens or CHECK 1-4 all pass:
- Spawn M2.7 sub-agent: "Evaluate this spawn prompt for clarity, scope creep risk, and missing context. Output: (a) Likely success rate 1-10 (b) 1 specific concern (c) 1 improvement suggestion"
- Integrate result into response: `[spawn-review] confidence=7/10 concern="scope creep on file changes" suggestion="add 🛑 Abort if: modifies files outside scripts/"`

## 🏗️ SKILL.md Skeleton (Step 3)

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
```
[spawn-review]
  checks: ✅✅✅✅✅ (5/5 pass)
  judgment: skipped (deterministic pass)
  verdict: ✅ clean spawn
```

or

```
[spawn-review] ⚠️ Check 3 FAIL (missing Goal Verification)
  Suggest adding:
  ✅ Success criteria: sub-agent outputs analysis
  ❌ Abort if: can't read the file
```

## Limits
- Skip LLM judgment for prompts <100 chars (trivial yes/no questions)
- Skip for cron agentTurn prompts (already thin executor validated)
- 3s timeout on deterministic checks; 10s on LLM judgment (with M2.7 flash)
```

## 📅 6/14 Decision Checklist

When reopening this issue on 2026-06-14:

- [ ] Did any spawn prompt cause confusion or wasted work in the last 3 days?
- [ ] Is `spawn_prompt_review` still the right first pilot? Or has a more urgent judgment skill emerged?
- [ ] If go: Step 3 implementation — SKILL.md + thin executor + A/B test (1-2 days)
- [ ] If no-go: Close #131, document reason, move content to knowledge base
- [ ] If deferred: Set new observation period, record why not ready yet
