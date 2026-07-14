## F - Facts（事實）

### Root Cause Identified (2026-07-14)
- **55% of quarantined skills** (33/60) = Missing `## Pitfalls` section
- **27% of quarantined skills** (16/60) = Workflow ends with colon (LLM output truncated mid-skill)
- Root cause: **MiniMax-M2.7 output token limit (~8K tokens)** when combined with large prompt (~27K input tokens = 82.7% of 32K context window)
- When LLM tries to generate multiple skills in one response, the last skill gets cut off mid-output
- `## Pitfalls` section is typically the last thing written → most commonly missing

### Evidence
- Quarantined skill `cross-machine-health-inspection`: 1584 bytes, ends mid-step with colon
- Validator catch rate: 80.72% (working correctly — catches truncated skills)
- Production junk rate: 44.44% (truncated skills passing through)

### Changes Applied (2026-07-14)

#### Direction B — Output Limit Cap ✅ DONE
- Added hard cap: **"Maximum 2 skills per response"**
- Each skill must be fully written (frontmatter + Workflow ≥3 steps + Pitfalls ≥3 bullets) before starting next
- If token limit reached mid-skill, must finish ALL sections of current skill before stopping

#### Direction A — Prompt Trim ✅ PARTIAL
- Removed: 55-line Pitfalls section example block (-2.8 KB)
- Removed: Pre-output self-check duplicate (now merged into concise checklist)
- Removed: Redundant "NOTE: Pitfalls is mandatory" paragraph
- Simplified example from full 12-line block to 4-line skeleton

### Prompt Size Analysis
| Component | Size | Notes |
|-----------|------|-------|
| Base prompt (`skill_reviewer.js --batch`) | 63 KB | Conversation transcript, varies per run |
| Instructions template (after trim) | 38 KB | Down from 40 KB |
| Estimated input tokens | ~27K | 82.7% of 32K context window |
| MiniMax-M2.7 output limit | ~8K tokens | ~2000-3000 Chinese chars |

## D - Decisions（決定）

### ✅ Done
- 2026-07-14: Applied Direction B (output limit cap)
- 2026-07-14: Applied Direction A partial trim (-2.8 KB from instructions)

### ⏳ Pending
- Monitor next cycle (~00:31) for improvement
- Decide if more prompt trimming needed (QW-6 still ~150 lines)

## Q - Questions（未解決）

### ❓ Will Direction B alone be sufficient?
- Direction B ensures each skill is complete even if generation stops mid-response
- Direction A reduces prompt size slightly but base prompt (63KB) is the main variable
- If truncation still occurs, may need to further limit to 1 skill per response

### ❓ Is further prompt trimming worthwhile?
- Base prompt is the dominant factor (63KB vs 38KB instructions)
- QW-6 could be trimmed (remove duplicated Description rules already in Description Spec)
- Writing Quality 5 points → 3 points possible

## Progress

- [x] Step 1: Identify truncation as root cause — DONE
- [x] Step 2: Apply Direction B (output limit cap) — DONE
- [x] Step 3: Apply Direction A partial trim — DONE
- [ ] Step 4: Monitor next skill_reviewer cycle for Missing Pitfalls rate
- [ ] Step 5: Evaluate if further Direction A trimming needed

## Closing Criteria (Day 3)

| Status | Condition |
|--------|-----------|
| ✅ PASS | Missing ## Pitfalls quarantines < 20% of total |
| 🟡 PARTIAL | Missing ## Pitfalls quarantines 20-40% |
| 🔴 REGRESSION | Missing ## Pitfalls quarantines > 40% (no improvement) |

## Rollback Plan

If Direction B causes issues:
- Remove the "Maximum 2 skills" constraint from instructions
- Keep Direction A trim (reduced example blocks are still valid)

## Notes

- **Related:** #171 (junk rate observation), #150 (previous quality fixes)
- **Parent issue:** skill_reviewer_bot.js analysis (this session)
- **Data source:** `.skill_junk_rate.jsonl`, quarantine folder timestamps
- **Decision owner:** Josh
