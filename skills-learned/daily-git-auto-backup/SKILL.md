---
name: daily-git-auto-backup
description: Commit and push workspace changes to a GitHub remote on a schedule, using a timestamped message and silencing notifications for unattended runs.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-10T17:02:57.390Z
---

## Workflow

1. Navigate to the workspace root that holds the git repo.
   ```bash
   cd ~/.openclaw/workspace
   ```
   If the cron job's `workingDir` is already set to the repo root, skip this step.

2. Stage all changes with `git add -A`. This captures new, modified, and deleted files but respects `.gitignore`.

3. Create a timestamped commit. Use `$(date +%F)` so each run produces a unique commit message:
   ```bash
   git commit -m "auto: daily backup $(date +%F)"
   ```
   If `git diff --cached --quiet` returns 0 (nothing to commit), `git commit` will exit non-zero — wrap with `|| true` or check `git status` first to avoid breaking the cron.

4. Push to the default remote branch. Assumes `origin` is configured and credentials are available (SSH key, token, or credential helper):
   ```bash
   git push origin master
   ```
   For SSH-backed remotes, verify `git remote -v` shows `git@github.com:` URLs rather than `https://` to avoid interactive authentication prompts.

5. Verify push success by checking `git log -1 --oneline` or capturing the commit hash from `git push` output. A successful push prints something like `* [new branch] master -> master` or updates the branch tip.

6. Reply `NO_REPLY` when called from a cron job — suppress any user-visible confirmation unless a failure occurs.

## GitHub Repo Pre-flight Checklist

Before the first run, ensure the repo is clean and ready:

- **Hardcoded paths removed**: Scan tracked files for `~/<path>` or `/Users/<name>/` patterns. Replace with relative or `$(pwd)`-derived paths.
- **`.gitignore` updated**: Add patterns for machine-specific artifacts (`.bugfix`, `__pycache__`, `.DS_Store`, IDE caches) to prevent re-tracking.
- **Credentials configured**: Use `git remote -v` to confirm the URL scheme. For HTTPS, ensure a credential helper or `GIT_ASKPASS` env var is set. For SSH, confirm the key is added to the SSH agent and registered in GitHub settings.
- **Branch protection**: If the repo is public, verify `.gitignore` prevents leaking credentials or private config files before pushing.

## Pitfalls

- ⚠️ **Nothing to commit but `git commit` still runs** — cron exits non-zero, triggering false failure alerts. Guard with `git diff --cached --quiet || exit 0` before committing.
- ⚠️ **HTTPS credential helper not configured** — `git push` hangs waiting for interactive password input. Pre-configure `git config credential.helper store` or set `GIT_ASKPASS` in the cron environment.
- ⚠️ **Large binary files tracked** — `git add -A` stages everything, bloating the repo. Ensure `.gitignore` excludes `.mp4`, `.zip`, node_modules, and similar large artifacts before the first backup.
- ⚠️ **Timestamp in non-UTC timezone** — `date +%F` uses the system TZ, producing inconsistent commit messages across machines. Use `date -u +%F` for UTC consistency.
- ⚠️ **SSH key not loaded in cron environment** — cron sessions start with a minimal PATH and no SSH agent. Load the key explicitly: `ssh-add ~/.ssh/id_ed25519` before `git push`, or use `GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519"`.
- ⚠️ **Repo dirty from previous failed run** — uncommitted changes accumulate if `git push` fails silently. Add a pre-flight `git status` check or a lock file to prevent duplicate commits in the same day.
