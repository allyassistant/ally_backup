# Analysis Task: Spawn System Proposed Changes

You are an expert systems analyst. Analyze two proposed changes to a spawn system used by an AI agent (Ally) to delegate tasks to sub-agents.

## CURRENT SYSTEM — Exact Content from AGENTS.md

### Spawn Principles (when to spawn)
Spawn sub-agent when:
- 答案唔肯定（需要 research / 探索性分析）
- 要讀多個 files 先答到
- 輸出係長報告 / 多個 phase
- 涉及 architecture / design 決策
- 需要第二個模型 critique 自己既 reasoning（搵盲點、挑戰 assumption，指定對應領域專家）
- 多個 sub-tasks，有先後依賴

Direct answer when:
- Yes/No 問題
- 單一文件 edit
- 系統狀態 / 已知 troubleshooting
- 日常操作（清file、cron check）
- 對話、解釋、建議

### Think in Tasks Format (MANDATORY for every spawn)

#### Required Elements
1. **Task**: 具體、窄、可完成。 ❌「分析 X.js」 ✅「搜 stock_updater.js 所有 error handling 缺失」
2. **Tools**: 明確俾或唔俾。 ❌ 預設全部開放
3. **Output**: 定義完成格式。 ❌「睇下有咩問題」
4. **Constraints**: 範圍界定。 ❌ Scope 外嘅唔改
5. **Context**（多 file analysis 用）：壓縮 input

#### Scope Block (MANDATORY)
```
📋 Scope
─────────────
✅ In scope: [改咩檔案/範圍]
❌ Out of scope: [唔改嘅]
🛑 Abort if: [停手條件]
```

#### Cannot Do Block (MANDATORY)
```
### 🚫 Cannot Do
- Do NOT refactor outside immediate fix area
- Do NOT add logging unless requested
- Do NOT modify files outside scope
- If scope unclear → stop and ask
```

#### Goal Verification (MANDATORY)
```
✅ Success criteria: [點知做完]
❌ Abort criteria: [點知 fail]
```

### Pipeline Tier System (risk-based approach)
| Tier | Condition | Approach |
|------|-----------|----------|
| 🟢 Express | 1 file, < 10 lines, trivial | Direct spawn code_fix |
| 🟡 Standard | 1-3 files, moderate logic | Think in Tasks → spawn |
| 🔶 Pipeline | ≥ 3 files / shared dep | Full Pipeline Flow |
| 🔴 Full+Approval | Auth/security / arch change | Pipeline + human approval |

Pipeline Flow: Research → Map → Pin → Chip Loop → Validate → Fix Gaps → Review → Done

## CURRENT TEMPLATE: code_fix.template
```
# Code Fix Template
## Task
[具體修復任務 — 一個 sentence]
## Tools
read, grep, edit, exec
## Output Format
- Modified files: [list]
- Verification: [pass/fail]
- Non-scope findings: [如果有]
## Definition of Done
- [ ] Output delivered to the right location
- [ ] Source material cited if applicable
- [ ] `node --check` pass
- [ ] Existing behaviour unaffected (git diff check)
- [ ] Exceptions flagged
- [ ] Next action stated
- [ ] Learning captured for next run
### 🚫 Cannot Do
- Do NOT refactor variable names outside the immediate fix area
- Do NOT add logging statements unless explicitly requested
- Do NOT modify any file not in ✅ In scope
- Do NOT change error handling approach (only fix existing pattern)
- Do NOT add new dependencies or require packages
- If asked to fix X but discover Y is broken → report Y as out-of-scope finding, do not fix Y
- Do NOT write new code that isn't directly in scope of the fix
## Constraints
- 只改指定檔案
- 唔引入新 dependency
- `node --check` must pass
- If scope is unclear → stop and ask, do not guess
- If the spec's Cannot Do rules seem to contradict each other or the ACs → stop and ask, do not pick a side
```

## CURRENT TEMPLATE: research.template
```
# Research / Analysis Template
## Task
[研究任務標題]
## Tools (Read-only)
read, grep, exec (for file stats only), web_fetch, web_search
## Output Format
- [Topic]: [具體發現]
- Sources: [URLs/list]
- Confidence: [high/medium/low]
## Additional Output (apply when task involves >3 files OR shared dependencies)
### 📊 Project Topology
Entry points: [main files that run the system]
Key modules: [important modules and their purpose]
Dependency direction: [what depends on what]
Critical files (do not change without full understanding): [list]
### ⚠️ Risk Flags
- [Risk 1: what it is, why it matters to this task]
### 🔄 Context Drift Check
Before writing findings, explicitly verify:
1. Does my understanding of the task match what the user actually asked for?
2. Are there implicit assumptions I made that could be wrong?
3. Is the scope of this task consistent with what was requested?
If context drift is detected:
→ Stop analysis immediately
→ Report: "Context drift detected: [what I assumed] vs [what task says]"
→ Do not continue until context is confirmed with main agent
## Constraints
- Read-only：唔改任何 file
- 唔分析唔創作，只搜集 + structure
- 如果資料唔夠 → 講明，唔好靠估
```

## CURRENT TEMPLATE: spec_writer.template
```
# Spec Writer Template
## Task
Write a technical brief for: [USER'S REQUEST]
## Tools
read (read-only codebase analysis), grep, web_fetch
## Output Format
### 📋 User Story
[One paragraph: who wants this, what they want, why it matters]
### ✅ Acceptance Criteria
- [AC1: specific, testable]
### 🏗️ Data Model
### 🔌 API Surface
### 📁 Files to Modify
| File | Action | Rationale |
### 🔄 Sequence / Flow
### ✅ Definition of Done
### 🛑 Cannot Do
- Do NOT write any implementation code
- Do NOT modify files not listed in Files to Modify
- Do NOT make architectural decisions beyond the stated scope
- Do NOT add new dependencies
- If anything is ambiguous → write "[NEEDS CLARIFICATION]" inline, do not guess
### ⚠️ Constraints I'm Uncertain About
## Constraints
- Output must be specific enough that a builder could implement from it without asking questions
- Keep brief under 200 lines
```

---

## PROPOSED CHANGE 1: Add Phase System

Current spawn prompts have free-form steps. Proposal is to add a structured 6-phase system to EVERY spawn prompt:

**Phase 1 — Pre-flight** (5 questions to validate before starting)
1. Do I have all inputs? (spec / requirements / context)
2. Is the scope crystal clear? (can I draw a box around what to change)
3. Are the constraints explicit? (what MUST NOT change)
4. Is the completion criteria testable? (how do I know I'm done)
5. Is my toolset sufficient? (do I have read/write/execute access as needed)
→ If any answer is NO → STOP and ask main agent

**Phase 2 — Discovery** (read & map)
- Read relevant files
- Note dependencies and patterns
- Build mental model

**Phase 3 — Analysis** (reason)
- Connect dots
- Identify risks
- Formulate approach

**Phase 4 — Execution** (implement)
- Make changes
- Verify as you go

**Phase 5 — Validation** (check)
- Run tests / checks
- Verify against completion criteria
- Check for regressions

**Phase 6 — Handoff** (report)
- Summarize what was done
- Note what was NOT done (out of scope)
- State next actions

**Optional Cost Control**: Each phase has a max token budget: Pre-flight (low), Discovery (medium), Analysis (medium), Execution (high), Validation (medium), Handoff (low).

---

## PROPOSED CHANGE 2: Plan for the Plan

For complex tasks, split into two spawns:
1. First spawn: planning agent only — "Read the context, propose an approach, list files to change, define completion criteria. Do NOT execute."
2. Human (Josh) approves the plan
3. Second spawn: execution agent — implements the approved plan

Simplified prompt for planning agent:
```
## Task
Plan ONLY — do not implement. Analyze the request, read relevant files, and produce:
1. Approach summary
2. Files to modify (with rationale)
3. Completion criteria
4. Risk flags
## Constraints
- Do NOT write any code
- Do NOT create or modify any files
- Do NOT run any commands that change state
## Output
A plan document that a human can approve before execution begins.
```

---

## ANALYSIS QUESTIONS — Answer ALL six with specificity

### 1. Compatibility
Do these changes conflict with our existing Think in Tasks format? Are they additive or disruptive? Reference exact AGENTS.md content.

### 2. Net Benefit
For what % of our spawn tasks would the Phase system genuinely improve output? (vs just adding overhead)
Consider:
- 🟢 Express tier: 1 file, <10 lines
- 🟡 Standard tier: 1-3 files, moderate logic
- 🔶 Pipeline tier: ≥3 files / shared dep
- 🔴 Full+Approval tier: auth/security / arch change
- Research/analysis spawns (read-only)
- Spec writer spawns

### 3. Plan for the Plan — Context Handoff Problem
When we spawn a planning agent, then an execution agent, the second spawn loses context from the first. How do we handle context handoff? Is this pattern actually feasible in our architecture where sub-agents are isolated sessions? Consider:
- Our Compaction Contract (session handoff with .cross_session_context.md)
- The fact that each spawn is a NEW isolated session with no memory of previous spawns
- Token costs of passing full plan context into execution spawn
- Human approval bottleneck

### 4. Scope Question — The Gate Check
The Phase 1 "Pre-flight" (5 questions) is similar to a "Gate Check" concept from the source document but NOT explicitly proposed for implementation. Should the Gate Check be included? When is it valuable vs when is it noise?

### 5. Implementation Location
Should these go in:
a) The spawn template file (.spawn/code_fix.template)
b) AGENTS.md (Think in Tasks section)
c) New .spawn/planning.template
d) Both

Consider maintainability, discoverability, and enforcement.

### 6. Verdict
Go / No-go / Conditional-go for each change. Be specific about conditions.

---

## OUTPUT FORMAT REQUIRED

```
## Executive Summary
[2-3 sentence bottom line]

## Q1: Compatibility
[Detailed answer with AGENTS.md line references]

## Q2: Net Benefit
[Percentage breakdown by tier + reasoning]

## Q3: Plan for the Plan Feasibility
[Analysis of context handoff problem + architecture feasibility]

## Q4: Gate Check Scope
[Should it be included? When?]

## Q5: Implementation Location
[Recommendation with rationale]

## Q6: Verdict
| Change | Verdict | Conditions |
|--------|---------|------------|
| Phase System | Go/No-go/Conditional-go | [if conditional, what conditions] |
| Plan for the Plan | Go/No-go/Conditional-go | [if conditional, what conditions] |

## Recommended Next Steps
[If conditional-go or go, what to implement first]
```
