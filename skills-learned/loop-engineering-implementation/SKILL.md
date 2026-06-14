---
name: loop-engineering-implementation
description: Workflow for analyzing, planning, and implementing Loop Engineering phases — from Phase 1 termination manifest to quality verification and multi-session coordination
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-11T12:31:06.216Z
---

## Context

Loop Engineering = systematic improvement of agent self-correction loops (Karpathy/Boris/Reddit loop taxonomies). Work proceeds in phases. Each phase requires:
1. **Analysis** (M3 subagent deep research)
2. **Value assessment** (M2.7 quick verdict)
3. **Decision gate** (wait for observation data or commit to implementation)

---

## Workflow

### Phase 0 — Intake & Scope Narrowing

1. User requests Loop Engineering work → classify as new Phase or continuation
2. If new Phase: spawn M3 subagent for deep analysis (`SPAWN_QUALITY` route = MiniMax-M3)
3. M3 subagent produces comprehensive report → saved to workspace as `loop-engineering-<phase-name>-<date>.md`
4. Send focused Discord summary (3-dimension framework, 4-tier quality system) to #🧑🏻‍💻編程
5. M2.7 quick value assessment to validate Phase scope

### Phase 1 — Termination Manifest & Token Budget (Example: Narrow Scope)

6. Spawn M3 subagent with narrow scope: "1.2 + 1.1 限縮版 點做"
7. M3 produces 8-part implementation plan covering:
   - **D1** — "行完" definition: 3 signals (file exists + size > 0 + log pattern matches)
   - **D2** — "質量標準": 6 quality checks (length/structural/judge/sanity/cross-ref/idempotency)
   - **D3** — "失敗點 handle": 4 quality tiers + 4 recovery tiers
8. Save full report (target: ~60KB, ~10K words) to workspace
9. Send Discord summary with 3-dimension framework

### Decision Gate — Observation Period

10. Evaluate: wait for existing #152 (QW-1~5) observation data before committing to Phase 1 implementation
11. **Wait criteria**: #152 has 7 days of observation remaining; junk rate improvement unknown; Phase 1 scope (~4.5hr) + observation + fix = ~2 weeks commitment
12. **Commit criteria**: if observation data confirms direction, proceed; if direction shifts, config threshold adjustment (not full rewrite)

### L2 Issue Creation for Implementation Tracking

13. Create L2 issue in issues/ directory (not L1 basic F/D/Q)
14. Upgrade L1 → L2 with comprehensive sections:
    - **Background**: Phase context and prior analysis
    - **Decision Points**: explicit numbered list (target: 5 decision points)
    - **Implementation Steps**: concrete, numbered, with ownership
    - **Quality Gates**: how to verify completion
    - **Observation Data**: #152 results to reference before execution
15. Send Discord update confirming L2 issue is ready

### Implementation Execution (Log-Only Mode)

16. All Phase 1 work is **additive code** — git revert-able, no rollback risk
17. Run in log-only mode first — does not affect existing crons
18. Maximum risk: 7 days later direction shift → adjust config threshold, not full rewrite
19. Quality verification: D1 signal checks + D2 quality checks + D3 recovery tiers

---

## Quality Framework (3-Dimension)

| Dimension | Meaning | Signals |
|-----------|---------|---------|
| D1 行完 | Completion definition | file exists + size > 0 + log pattern matches |
| D2 質量標準 | Quality bar | 6 checks: length/structural/judge/sanity/cross-ref/idempotency |
| D3 失敗點 handle | Failure recovery | 4 quality tiers + 4 recovery tiers |

---

## Pitfalls

- **Stub risk**: Loop Engineering skills can be thin (565B) if M3 analysis not completed. Always require full report (≥50KB) before validating — don't promote stubs.
- **Premature commitment**: Don't commit Phase 1 implementation before #152 observation period completes. Wasted effort if direction shifts.
- **Duplicate completion events**: Subagent task completion may be reported twice (same session, same task). Recognize duplicate and skip re-processing.
- **Log-only mode bypass**: Log-only mode is safe but teams sometimes skip it and go straight to active deployment. Enforce log-only first pass.
- **Stub promotion**: If a skill file is <1500B, missing ## Pitfalls, or content is truncated → reject, do not promote. The reviewer bot enforces this.

---

## Multi-Session Coordination

- Subagent results propagate via inter-session `subagent_announce` messages
- Main session receives completion event + extracts report to workspace
- Discord summary sent to #🧑🏻‍💻編程 for human visibility
- Memory updated with key decisions before turn ends
- L2 issue created for persistent tracking across sessions

---

## References

- `loop-engineering-manifest-quality-2026-06-11.md` — full M3 report (Phase 1 narrow scope)
- `loop-engineering-phase1-plan-2026-06-11.md` — implementation plan with 8 parts
- Issue #154 — L2 tracking issue for Termination Manifest + Token Budget
