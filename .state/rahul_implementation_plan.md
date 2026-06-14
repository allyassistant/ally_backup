# Rahul 7-Agent Software Factory → Ally Spawn System Implementation Plan

**Author:** Architecture Analysis Subagent  
**Date:** 2026-05-27  
**Sources:** Rahul @sairahul1 (Software Factory), 老金 (Surgical Changes), Kanika (4 Roles/3 Architectures), Ally current spawn system

---

## 1. Gap Analysis: Rahul's 7 Agents vs Current Ally System

### Rahul's 7 Agents (with Ally equivalents)

| # | Rahul Agent | Ally Equivalent? | Gap Analysis |
|---|-------------|------------------|--------------|
| **1** | **Codebase Researcher** (read-only, maps files/patterns/risks) | ⚠️ Partial — `research.template` exists, but no systematic "map project" step before code changes | **Missing:** Pre-flight codebase topology scan. No concept of "throw conversation away if context drift detected" |
| **2** | **Story Writer** (user story + acceptance criteria) | ❌ None — Ally spawns directly into code, no story/ticket step | **Critical gap:** No human checkpoint before implementation starts |
| **3** | **Spec Writer** (technical brief: data model, API, every file) | ❌ None — No spec document phase | **Missing:** Implementation is not spec-first. No "brief" that validator can compare against |
| **4** | **Backend Builder** | ✅ Partially — `code_fix.template` covers this, but no separation between backend/frontend | **Gap:** Backend + Frontend not separated. One agent does everything → context overload |
| **5** | **Frontend Builder** | ❌ Same as above — merged with Backend Builder | **Missing:** No dedicated frontend context/tools block |
| **6** | **Test Verifier** (acceptance tests, reports pass/fail) | ⚠️ Partial — `critic.template` exists, but it's a general review, not a dedicated test-runner agent | **Gap:** No automated acceptance test writing + execution step |
| **7** | **Implementation Validator** (compares code vs brief, impartial, sees only disk) | ❌ None — Ally's `critic.template` is too generic | **Missing:** Impartial validator that checks "does implementation match spec?" Not "does code look good?" |

---

### Rahul Concepts We Completely Lack

| Concept | Why It Matters | Current State |
|---------|----------------|---------------|
| **3 human checkpoints** (Approve story → Approve brief → Approve PR) | Prevents wasted work by getting sign-off at each phase | ❌ None — we go straight to code |
| **Context Drift = discard + restart** | Prevents compounding errors from wrong assumptions | ❌ None — we try to recover from bad context |
| **CLAUDE.md as permanent project memory** (100-300 lines) | Project knowledge persists across sessions | ⚠️ We have AGENTS.md/SOUL.md but not project-specific memory |
| **Agent "cannot do" rules** (strict boundaries) | Prevents scope creep within agent | ❌ Partial — our Scope Block is good but no per-agent "cannot do" |
| **Validator sees only disk** (impartial, no ego) | Validator can't be biased by who wrote code | ❌ Our critic reviews everything, biased by context |
| **Spec-first (brief) before any code** | Guarantees implementation has a reference point | ❌ We do code-first, spec is implicit |

---

## 2. Top 5 Specific Changes to "Borrow" from Rahul

### Change #1 — Add Spec Writer Phase (P0)

**What:** Create `.spawn/spec_writer.template` — a dedicated spec document phase before any code is written.  
**Why:** Rahul's most impactful concept. Spec-first catches misunderstandings before code is written.

**Exact template:**
```markdown
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
- [AC2: specific, testable]
- [AC3: specific, testable]

### 🏗️ Data Model
```
[Entity: fields, types]
[Relationship: one-to-many/many-to-one]
```

### 🔌 API Surface
```
POST/GET/PUT/DELETE /endpoint
Request: { fields }
Response: { fields }
```

### 📁 Files to Modify
| File | Action | Rationale |
|------|--------|-----------|
| path/to/file.js | create/modify | reason |

### 🛑 Cannot Do
- Do not write any implementation code
- Do not modify files not listed above
- Do not make architectural decisions beyond the scope

## Constraints
- Output must be specific enough that a builder could implement from it without asking questions
- If anything is ambiguous → write "[NEEDS CLARIFICATION]" inline, do not guess
- Keep brief under 200 lines
```

**File:** Create at `~/.openclaw/workspace/.spawn/spec_writer.template`  
**Priority:** **P0** — biggest bang for buck, prevents wasted implementation  
**Impact:** Reduces rework by catching spec errors before code is written. Aligns with Josh's "複雜任務要先問用戶" rule

---

### Change #2 — Add Human Checkpoint Discipline (P0)

**What:** Add to AGENTS.md a mandatory "human checkpoint" rule for spec-first workflow.  
**Why:** Without checkpoints, spec phase is just extra paperwork.

**Add to AGENTS.md:**
```markdown
## 🚦 Human Checkpoints (Rahul-inspired)

### Phase Gate System
Before any implementation begins on non-trivial tasks:

| Phase | Checkpoint | What Happens |
|-------|------------|-------------|
| Story | User approves user story + acceptance criteria | User says "yes, implement this" |
| Spec | User approves technical brief | User says "yes, this is what I want" |
| Code | User reviews final output | User says "yes, merge it" |

### Trigger Conditions
- Task involves >1 new file → Spec phase required
- Task changes shared dependency → Spec phase required
- Task involves auth/security/permission → Story + Spec both required

### ❌ Abort Criteria
If at any checkpoint the user says "no" or asks for changes:
→ Return to the appropriate phase, discard downstream work
→ Do NOT try to "salvage" work from a misunderstood phase
→ Context drift = throw away + restart from checkpoint
```

**File:** Edit `~/.openclaw/workspace/AGENTS.md` — add new section after "Spawn 原則"  
**Priority:** **P0** — enforce discipline, not just tooling  
**Impact:** Prevents wasted work. Complements existing rule "複雜任務要先問用戶"

---

### Change #3 — Add Implementation Validator Agent (P1)

**What:** Create `.spawn/validator.template` — an impartial agent that only compares spec vs implementation on disk.  
**Why:** Our `critic.template` is a general reviewer. Rahul's validator is purposefully blind — sees only disk, not who wrote the code or what the intention was.

**Exact template:**
```markdown
# Implementation Validator Template

## Task
Validate that implementation matches the spec. Be impartial — you see only files on disk, not who wrote them or what the intention was.

## Spec Reference
[ Paste or reference the approved spec brief here ]

## Tools
read, exec (for running tests/linters only)

## Validation Checklist

### ✅ Acceptance Criteria Check
For each AC from the spec:
- [ ] Can you verify AC1 from disk/files alone?
- [ ] Can you verify AC2 from disk/files alone?
- [ ] Can you verify AC3 from disk/files alone?

### 📁 File Coverage
For each file in the spec:
- [ ] File exists at specified path
- [ ] File contains described functionality
- [ ] No extra files created that aren't in spec

### 🧪 Test Coverage
- [ ] Acceptance tests exist and are runnable
- [ ] Tests cover all acceptance criteria
- [ ] All tests pass

### ⚠️ Gap Report
For any gap found:
```
Gap: [What spec says should happen]
Disk: [What you actually found]
Severity: [P0/P1/P2]
Recommendation: [Specific fix]
```

## Output Format
```
## Validation Result: [PASS / PARTIAL / FAIL]

### AC Coverage
- AC1: ✅ PASS / ❌ FAIL / ⚠️ PARTIAL
- AC2: ...
- AC3: ...

### Gap Summary
[P0 gaps, then P1, then P2]

### 🛑 Abort if:
- >3 P0 gaps found → FAIL immediately
- Spec reference not provided → FAIL immediately
```

## Constraints
- You are NOT a code reviewer — you are a spec compliance checker
- Do not suggest code style improvements unless spec explicitly requires it
- "I don't like this approach" = not a gap. "Spec says X but code does Y" = gap
- Run `node --check` and existing tests, report results
```

**File:** Create at `~/.openclaw/workspace/.spawn/validator.template`  
**Priority:** **P1** — builds quality gate without changing existing workflow  
**Impact:** Forces spec compliance, reduces "looked good but wrong thing" bugs

---

### Change #4 — Add Codebase Researcher Step for >3 files (P1)

**What:** Enhance `research.template` to include systematic project topology mapping when task involves >3 files.  
**Why:** Pre-flight scan prevents building on wrong assumptions. Rahul's first agent is purely read-only mapping.

**Add to `research.template`:**
```markdown
## Additional Output (when task involves >3 files)

### 📊 Project Topology
```
Entry points: [list]
Key modules: [list]
Dependency direction: [description]
Critical files (no changes without understanding): [list]
```

### ⚠️ Risk Flags
- [Risk 1: what it is, why it matters]
- [Risk 2: what it is, why it matters]

### 🔄 Context Drift Check
Before writing findings, verify:
1. Does my understanding of the task match the user's actual request?
2. Are there any implicit assumptions I made that could be wrong?

If context drift is detected:
→ Stop analysis immediately
→ Report: "Context drift detected: [what I assumed] vs [what task says]"
→ Do not continue until context is confirmed
```

**File:** Edit `~/.openclaw/workspace/.spawn/research.template`  
**Priority:** **P1** — low effort, high impact on complex tasks  
**Impact:** Catches wrong assumptions before they cascade into implementation

---

### Change #5 — Per-Agent "Cannot Do" Rules (P2)

**What:** Add "cannot do" block to each template, explicitly listing what the agent should NOT do.  
**Why:** Rahul's strict agent boundaries prevent role creep. Our templates are too open.

**Example addition to `code_fix.template`:**
```markdown
### 🚫 Cannot Do
- Do not refactor variable names outside the immediate fix area
- Do not add logging statements unless explicitly requested
- Do not modify any file not in ✅ In scope
- Do not change error handling approach (only fix existing pattern)
- Do not add new dependencies or require packages
- If asked to fix X but discover Y is wrong → report Y, do not fix Y (out of scope)
```

**File:** Edit `~/.openclaw/workspace/.spawn/code_fix.template` (and apply to all templates)  
**Priority:** **P2** — nice to have, depends on template adoption  
**Impact:** Reduces scope creep within agents, especially on complex tasks

---

## 3. Implementation Roadmap

### Phase 1: Foundation (Week 1)

**Goal:** Add spec-first discipline without disrupting current workflow.

| # | Change | File | Action | Verification |
|---|--------|------|--------|--------------|
| 1.1 | Create `spec_writer.template` | `.spawn/spec_writer.template` | Write new template (see Change #1 above) | Template renders correctly in test spawn |
| 1.2 | Add Phase Gate rules to AGENTS.md | `AGENTS.md` | Add "Human Checkpoints" section (see Change #2 above) | Josh reviews and approves |
| 1.3 | Add context drift detection to `research.template` | `.spawn/research.template` | Edit template (see Change #4 above) | Test with >3 file research task |

**Verification:** 
- Spawn a test task with spec writer → review output quality
- AGENTS.md parses without syntax error
- Josh confirms Phase Gate is acceptable

---

### Phase 2: Quality Gates (Week 2-3)

**Goal:** Build the validator agent and refine code/ critic templates.

| # | Change | File | Action | Verification |
|---|--------|------|--------|--------------|
| 2.1 | Create `validator.template` | `.spawn/validator.template` | Write new template (see Change #3 above) | Template exists and is callable |
| 2.2 | Add "cannot do" rules to all templates | All `.spawn/*.template` | Edit each template | Each template has explicit cannot-do block |
| 2.3 | Test full pipeline: spec → code → validate | `.spawn/*` + AGENTS.md | Spawn test task through full pipeline | Output passes validator |

**Verification:**
- Validator correctly identifies gaps in intentionally incomplete spec
- Pipeline completes without errors
- No file modification outside declared scope

---

### Phase 3: Optimization (Week 4+)

**Goal:** Fine-tune based on real usage, add observability.

| # | Change | File | Action | Verification |
|---|--------|------|--------|--------------|
| 3.1 | Add template usage logging | `router/` | Track which templates are used, success/fail rates | Log entries visible in routing report |
| 3.2 | Add "story writer" for complex multi-file tasks | `.spawn/story.template` (new) | Create simple story writer template | Tested on real complex task |
| 3.3 | CLAUDE.md-style project memory section | `MEMORY.md` section or `.spawn/project_context.md` | Add project-specific context that persists | Survives session reset |

**Verification:**
- Template usage logged successfully
- Story writer output approved by Josh
- Project context survives `/reset`

---

## 4. What NOT to Borrow from Rahul + Why

| Rahul Concept | Why Not for Us | Alternative |
|---------------|----------------|-------------|
| **7 separate agents** | Our scale doesn't need 7 distinct agents — too much coordination overhead for our workload | Keep 4-5 focused templates; not 7 agent definitions |
| **Parallel execution** | Kanika notes synthesis cost is high; our tasks are sequential by nature | Sequential / Hierarchical per AGENTS.md — correct for our scale |
| **100-300 line CLAUDE.md** | We already have AGENTS.md/SOUL.md/MEMORY.md — too much project doc | Keep existing structure; add focused project context only when needed |
| **Full story/spec/ticket workflow for EVERY task** | Josh's "複雜任務要先問用戶" already handles this — lightweight, not formal | Only trigger spec phase when AGENTS.md Phase Gate rules say so, not for every task |
| **"Throw conversation away" discipline** | Good in theory but hard to operationalize | Replace with: "If context drift detected, report to main agent and ask for clarification" |

**Core principle:** Rahul's system is designed for a team of humans + agents doing large PRs. Our system is a personal assistant with a small number of focused scripts. Borrow philosophy, not structure.

---

## 5. Integration with Existing Spawn System (Reset-Safe)

### How These Changes Survive `/reset`

| Change Type | Reset-Safe? | Mechanism |
|-------------|-------------|-----------|
| New template files in `.spawn/` | ✅ Yes | Files on disk, not in session memory |
| AGENTS.md edits | ✅ Yes | File on disk, always loaded at session start |
| MEMORY.md additions | ✅ Yes | File on disk, loaded at session start |
| Template usage logging | ✅ Yes | Writes to `router/` log files on disk |
| Project context (`.spawn/project_context.md`) | ✅ Yes | File on disk, survives reset |

### Backward Compatibility

All changes are **additive** — no existing template is removed, no existing rule is broken.

- New `spec_writer.template` → only used when Phase Gate triggers
- New `validator.template` → only used for complex validation tasks
- Phase Gate rule → only applies to tasks that meet trigger conditions (no change to existing simple tasks)

**Default behavior unchanged:** Yes/No, single file edits, status checks → same flow as before.

### Session Recovery

On `/reset`, the system loads:
1. AGENTS.md (with Phase Gate rules)
2. All `.spawn/*.template` files
3. MEMORY.md (with project context if added)

All Phase 1-3 changes survive reset because they're file-based, not session-based.

---

## Summary: Actionable Next Steps

| Priority | Action | File | Owner |
|----------|--------|------|-------|
| **P0** | Create `spec_writer.template` | `.spawn/spec_writer.template` (new) | This analysis → implemented |
| **P0** | Add Human Checkpoints section to AGENTS.md | `AGENTS.md` (edit) | This analysis → implemented |
| **P1** | Create `validator.template` | `.spawn/validator.template` (new) | This analysis → implemented |
| **P1** | Update `research.template` with context drift detection | `.spawn/research.template` (edit) | This analysis → implemented |
| **P2** | Add "cannot do" rules to all templates | All `.spawn/*.template` (edit) | Later phase |

**Immediate next step:** Implement Phase 1 (Changes #1 + #2) — create spec_writer template and add Phase Gate rules to AGENTS.md.

---

*Analysis complete. Recommendations are actionable and prioritized. All changes are reset-safe (file-based).*