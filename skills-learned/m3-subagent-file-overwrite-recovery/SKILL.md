---
name: m3-subagent-file-overwrite-recovery
description: Protect script versions with a git baseline before sub-agent runs, then verify and restore from the named checkpoint if overwritten.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-22T11:31:01.250Z
---

## Workflow

1. **Identify critical files before spawning.** Before dispatching M3 sub-agents that may write to shared scripts or configs, enumerate target files. Run `git log --oneline -5 -- <file>` to check recent changes — if the file was modified in the last 24h by a prior agent, flag it as a "protected target."

2. **Commit a baseline before spawning.** Before spawning parallel M3 sub-agents, run:
   ```bash
   git add <protected-file> && git commit -m "m3-baseline: pre-agent lock $(date -u +%Y%m%dT%H%M%SZ)"
   ```
   This creates a named baseline. If a later agent overwrites, `git diff HEAD -- <file>` instantly reveals what changed.

3. **Verify fix integrity after each agent completes.** After a sub-agent yields, immediately check the target file for expected changes:
   ```bash
   git diff HEAD -- <file>   # should show expected fix
   grep -c "aihot.virxact.com" <file>  # count occurrences of fixed value
   ```
   If the fix is missing, the agent wrote a stale/old version.

4. **Restore from baseline if overwrite detected.** If verification in step 3 shows the fix was lost:
   ```bash
   git checkout HEAD~1 -- <file>   # restore pre-agent baseline
   # then re-apply the fix manually or re-spawn the agent
   ```

5. **Pin script versions in a `HARDENED.md` tracker.** For scripts that are frequently target by M3 agents (e.g., `scripts/ai_hot_push.js`), create a lightweight lockfile:
   ```bash
   echo "<file>: <git-commit-sha>" >> scripts/HARDENED.md
   ```
   Before any M3 agent writes to a tracked file, check the sha. If sha matches but content differs, the agent is working from a stale copy — abort and re-fetch.

6. **Enforce write-order discipline in parallel spawns.** When spawning 3+ M3 sub-agents in parallel that may target the same file class, assign each agent a non-overlapping file slice (e.g., Agent 1 → `scripts/a*.js`, Agent 2 → `scripts/b*.js`). Document the slice in the spawn prompt to prevent overlap.

## Pitfalls

- ⚠️ Spawning parallel M3 agents without pre-commit baseline — if Agent B writes `ai_hot_push.js` with a cached/stale version, Agent A's earlier fix is silently lost. No diff is available because neither version is committed. Always `git add && git commit` before spawning.

- ⚠️ Relying on `git status` alone — `git status` only shows uncommitted changes. After Agent A commits and Agent B overwrites, `git status` shows nothing because both agents committed. Use `git log --oneline` to compare commit sequence, not just `git status`.

- ⚠️ Assuming `--force` flags in scripts mean "always fetch fresh" — `ai_hot_push.js` fetched feeds successfully but wrote an old DNS value (`aihot?.virxact.com`). The fetch logic was fresh; the write logic was stale. Verify written content, not just fetch success.

- ⚠️ Multi-agent write coordination without file-slicing — spawning 3 agents all targeting `scripts/*.js` guarantees overlap. At least one agent will overwrite another's fix. Assign explicit non-overlapping file ranges in each agent's prompt.

- ⚠️ Forgetting to update HARDENED.md after applying a fix — if the lockfile still lists the old commit sha, a future agent sees "sha matches" and skips re-fetching, perpetuating the stale version. Update HARDENED.md atomically with the fix commit.

## Background

This pattern emerged from an incident where a MiniMax M3 sub-agent fixed 6 instances of `aihot?.virxact?.com` → `aihot.virxact.com` in `scripts/ai_hot_push.js` at 01:46. A later M3 sub-agent (Fix 1-4 pipeline) ran and wrote an old cached version of the file, overwriting all 6 fixes. The root cause was not a code bug but a multi-agent content-integrity failure: subsequent agents wrote from a stale in-memory or disk snapshot rather than the latest committed version. The fix was to use `git commit` as a content lock and verify written state immediately after each agent completes.
