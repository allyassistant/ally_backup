---
name: skill-file-corruption-repair
description: Repair skill files in skills-learned/ that fail validation due to format damage — unclosed code blocks, truncated content, missing frontmatter
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-10T02:30:00.000Z
---

## Workflow

1. **Detect corruption signal**
   - Read the skill file and check validation output
   - Common signals: "unclosed code block", "unexpected end of file", "odd backtick count", "truncated content"
   - Cross-reference with `skills-audit-workflow` validation report from latest Skill Reviewer run

2. **Diagnose unclosed code blocks**
   - Count backtick pairs (```) in the file
   - If odd count → find the unpaired opening/closing fence
   - Check for missing closing fence after the last code block (most common)
   - Scan for code fences that were split by content injection

3. **Diagnose truncated content**
   - Check if file ends mid-section (no final `##` section heading)
   - Check if last section is incomplete (steps cut mid-sentence, missing closing backticks)
   - Verify all frontmatter fields are present and properly closed (`---` boundaries)
   - Distinguish truncation from intentional short content (draft stubs)

4. **Repair unclosed code blocks**
   - Add missing closing fence ```` ``` ````
   - If the block language tag is missing, add the appropriate one from context (e.g., ```` ```markdown ````)
   - Verify the fixed file has even backtick count
   - Re-validate before proceeding

5. **Repair truncated content**
   - If minor truncation (a few lines missing): complete the section from context
   - If major truncation (half the file missing): trigger `subagent-truncation-repair` workflow → spawn sub-agent to reconstruct from upstream content
   - Never guess content for core workflow steps — pull from original source if available

6. **Validate repaired file**
   - Verify all frontmatter fields: `name`, `description`, `status`, `source`, `provenance`, `generatedAt`
   - Verify even backtick count (all code blocks closed)
   - Verify file ends with complete section (not mid-sentence)
   - Check minimum size (≥1500 bytes for active skills)

7. **Update Skill Reviewer queue**
   - If repair successful → remove from draft queue, mark for re-validation on next cycle
   - If repair not possible → set `status: draft` explicitly, add note on what's missing

## Pitfalls

- **Odd backtick count ≠ always missing closing fence**: Could be a backtick-inside-code issue. Scan the actual fence structure, not just total count.
- **CRLF line endings can hide truncation**: Some editors don't show a missing final newline. Check byte count vs expected.
- **Frontmatter half-closed**: `---` at start but no `---` before content means the entire file is treated as frontmatter. This won't show as "unclosed code block" but as validation failure.
- **Multiple code blocks with mixed states**: One block might be missing closing, another might have extra opening. Trace each block boundary.
- **Don't repair drafts that are intentionally short**: Check if `status: draft` is explicit. Some skills are legitimately small (under 1500 bytes) in draft state — don't pad them.
- **The repair must not degrade content**: Adding a closing fence in the wrong place can hide real issues. Always validate after repair.

## References

- `skill-quality-verification` — quality heuristics that determine if a skill passes validation
- `skill-reviewer-draft-cleanup` — cleaning up broken draft directories (post-repair cleanup)
- `subagent-truncation-repair` — sub-agent-driven repair for major truncation cases
