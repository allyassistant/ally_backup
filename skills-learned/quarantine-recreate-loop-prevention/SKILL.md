---
name: quarantine-recreate-loop-prevention
description: Break skill re-creation loops by checking quarantine state before write, blocking patch actions on already-quarantined skill sources.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-15T06:47:00Z
---

## Workflow

1. **Identify re-creation cycle.** Run `ls -la skills-learned/` and check for skills that appear repeatedly despite quarantine gates. Flag skills whose source files survive in `skills-learned/` after quarantine blocks their symlink.

2. **Trace write trigger.** Read the pipeline script (`writeSkillFiles` or equivalent) and locate the write gate. Find where `safeWriteFileSync` is called — this is where the file gets re-written even after quarantine blocks the symlink.

3. **Add pre-write quarantine check.** Insert a quarantine inspection step **right after the self-referential filter and before `safeWriteFileSync`**:
   ```javascript
   // Check if skill source already exists in _quarantine/ before writing
   const quarantinePath = path.join(skillsDir, '_quarantine', skillName + '.md');
   if (fs.existsSync(quarantinePath)) {
     console.log(`[quarantine-gate] SKIP write for quarantined skill: ${skillName}`);
     return; // Do NOT write — block the re-creation loop here
   }
   ```
   This check must come **before** dedup similarity scoring, because `sim=0.84` falls into `patch` (proceed) and the file still gets written even with high similarity.

4. **Verify quarantine state at dedup gate.** The quarantine check in Step 3 handles the write block. Additionally, ensure the dedup gate logs quarantine status so future debugging can trace whether a skill was previously quarantined:
   ```javascript
   const quarantined = fs.existsSync(path.join('_quarantine', skillName + '.md'));
   if (quarantined) {
     console.log(`[dedup] quarantined skill detected — skipping patch: ${skillName}`);
     return;
   }
   ```

5. **Confirm fix with test run.** Trigger the pipeline with a known re-creation target (e.g., send an email that previously triggered `email-analysis-cantonese` re-creation). Verify the source file does **not** get written to `skills-learned/` and the quarantine entry remains.

## Pitfalls

- ⚠️ **Pre-write quarantine check placed after dedup** — if the check runs after similarity scoring, the `patch` action still proceeds and writes the file. The quarantine check must fire before `safeWriteFileSync`, not after dedup evaluation.

- ⚠️ **Quarantine gate only blocks symlink, not source write** — the H-5 fix blocked symlink creation, but the source file was still re-written. This is the classic trap: quarantine appears to work but the re-creation loop continues because the file survives on disk. Always verify the source file itself is not being re-written.

- ⚠️ **Dedup `patch` action proceeds on high similarity** — `sim=0.84` falls into `patch` (proceed), which writes the full SKILL.md. A high-similarity patch is still a write. Only a `skip` or `quarantine` action blocks the write. Ensure the dedup gate converts quarantine state into a `skip` action.

- ⚠️ **Email arrival re-triggers skill creation** — each new email triggers a fresh conversation that re-observes the skill and may re-create it. The fix must live in the write path, not just the dedup logic, because the dedup gate can only classify what the LLM outputs, not prevent the LLM from outputting it.

- ⚠️ **Checking `_quarantine/` vs `_archive/`** — `_archive/` stores old versions; `_quarantine/` stores blocked skills. The write gate must check `_quarantine/` to catch blocked skills, not `_archive/`.
