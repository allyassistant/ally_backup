---
name: skill-validation-failure-cleanup
description: "Clean stale symlinks, archive invalid content on failure. Use when: validation fails, symlinks stale, fences needed. Key capabilities: cleanup, archiving, detection."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-10T15:03:42.199Z
activation: manual
activationReason: "archives/quarantines skills — destructive cleanup, not for auto-invocation"
---

## Workflow

1. **Detect validation failure**
   - Check `.skill_created.jsonl` for entries with `validationPassed: false`
   - Or: run `node /Users/ally/.openclaw/workspace/scripts/skill_reviewer_bot.js --quiet` and watch for "INVALID" lines
   - Cross-reference: `ls -la skills-learned/{class}/{skill}/SKILL.md` vs `_archive/` to spot orphaned files

2. **Identify stale symlink**
   - Check `skills/_learned_{className}/{skill}` symlink existence timing vs validation failure timestamp
   - If symlink was created BEFORE the failed write → stale symlink (legacy pollution, not current bug)
   - If symlink was created AFTER failed write → bug in bot's symlink logic
   - Run: `stat skills/_learned_*/{skill}` to compare mtime against the validation failure timestamp
   - Stale symlinks make invalid skills appear valid in `<available_skills>` — high severity

3. **Remove stale symlink + archive invalid content**
   - If symlink exists and validation failed: `fs.unlinkSync(symlinkPath)` — remove symlink immediately
   - Move invalid `SKILL.md` to `_archive/failed-validations/{class}/{skill}/`
   - Verify: `ls skills/_learned_{class}/` should no longer contain the stale symlink
   - This prevents Invalid skill from silently polluting `<available_skills>`

4. **Add pre-write unclosed-fence detection**
   - Before writing any skill file, scan extracted content for unclosed \`\`\` fences
   - If unclosed fence found → abort write, surface error to LLM for rewrite attempt
   - Pattern: count opening \`\`\` vs closing \`\`\` — mismatch = unclosed fence
   - This prevents the "INVALID: Unclosed code block" class of failure entirely

5. **Scan for correlated failures**
   - After one validation failure is found, scan other recent `.skill_created.jsonl` entries
   - Look for: orphaned symlinks with no recent write, validation failures with symlinks intact, missing frontmatter patterns
   - Prevent multiple failures from accumulating silently across sessions

## Pitfalls

- **Stale symlinks mask validation failures**: A pre-existing symlink from a prior cycle means the bot won't create a new symlink on update. The catalog shows the skill as active even though validation failed. This is the H-1 root cause — always unlink before symlink.
- **Symlink created before validation runs**: If a manual script pre-created symlinks (e.g., B10 retro-fix), the bot's `if (!fs.existsSync(symlinkPath))` guard prevents removal. Fix: unconditionally remove stale symlink in the `else` branch (validation failure path).
- **Unclosed fence detected post-write only**: Without pre-write fence detection, the file is written, validation fails, and content is archived — but the LLM could have fixed it on the first try. Pre-write detection is strictly better.
- **"VALID: false" in log but symlink exists**: This is the smoking gun. A valid skill gets a symlink; an invalid skill should NOT. If `validationPassed: false` AND symlink exists → H-1 stale symlink bug.
- **Pre-write size gate bypass**: Files >1500B pass the size gate but still fail validation. The size gate prevents stubs, not quality. Always check both size AND validation result.
- **Validation checks are LLM-prompt-dependent**: `validate_skill_file.js` checks for numbered steps, pitfalls, and H3 header patterns. If the LLM uses different formatting (H3 instead of numbered lists), validation fails even for substantive content. Coordinate LLM prompt with validator expectations.

## References

### `.skill_created.jsonl` entry structure
```json
{"ts":"2026-06-10T06:31:00.000Z","name":"ai-hot-push-workflow","class":"workflow","bytes":3736,"validationPassed":false,"symlinked":false,"reason":"pre-write stub (<1500B)"}
```
Key fields: `ts`, `name`, `bytes`, `validationPassed`, `symlinked`, `reason`

### Relevant code locations (skill_reviewer_bot.js)
- Line ~387-403: write flow (symlink creation + validation)
- H-1 fix: `else { if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath); ... }`
- H-4 fix: pre-write `extractFileBlocks()` returns `{content, hasUnclosedFence}` — early abort on fence mismatch

### `_archive/` structure
