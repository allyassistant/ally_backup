---
name: git-history-pii-scrubbing
description: Remove leaked credentials and PII from git history with dry-run preview, git filter-branch/filter-repo, and env-var replacement before re-commit.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-10T11:01:01.242Z
---

## Workflow

1. **Identify PII targets** — Scan workspace for known credential patterns before touching git:
   - Hong Kong phone numbers: `+852` prefix, 8-digit local numbers
   - Personal names alongside contact info: `Joshua`, `Desanna`
   - Hardcoded secrets: API keys, tokens, passwords in source files
   - WhatsApp/Chrome session files: `_legacy/whatsapp-auth/`, session files in `_cache/`
   - `.bak` backup files in non-backup directories

2. **Dry run preview** — Always run interactive filter commands with `--dry-run` or equivalent first:
   ```bash
   git filter-repo --dry-run --invert-paths --path <target>
   # or
   git filter-branch --force --tree-filter 'rm -f <target>' --prune-empty --dry-run HEAD
   ```
   Present the dry run results to the user as a table: file → content type → risk level (🔴 high / 🟡 medium / 🟢 low). Wait for confirmation before proceeding.

3. **Execute the scrub** — After user confirms, run the filter command for real:
   ```bash
   git filter-repo --invert-paths --path <target> --force
   ```
   For targeted file removal from history, use `--invert-paths` to exclude rather than delete.
   For regex-based content replacement (e.g. phone numbers), use `git filter-repo --replace-text`:

4. **Replace hardcoded secrets with env vars** — If secrets are in code (not just committed accidentally), replace the hardcoded value with `process.env.VARNAME` or similar, then ensure `.env` is in `.gitignore`:
   ```bash
   sed -i 's/const MAIL_SIGNATURE = ".*"/const MAIL_SIGNATURE = process.env.MAIL_SIGNATURE/' scripts/mail_tool.js
   echo ".env" >> .gitignore
   ```

5. **Force push and verify** — After scrub, the remote will reject the push (history diverged). Force push:
   ```bash
   git push origin --force --all
   git push origin --force --tags
   ```
   Then verify with `git log --oneline` and `git grep` for the pattern to confirm it is gone.

6. **Report completion** — Present a summary table: what was removed, what was replaced, what risks remain for user decision.

## Pitfalls

- ⚠️ Forgetting `--force` on `git filter-repo` — silently does nothing; history is not rewritten. Always include `--force`.
- ⚠️ Pushing before verifying the scrub worked — force push with a dirty history spreads the leak further. Always `git grep <pattern>` AFTER filter-repo and BEFORE push.
- ⚠️ WhatsApp/Chrome session files under `_legacy/` contain browser cookies and auth tokens — these are high-severity PII even if they look like "just cache". Mark 🔴 and prioritize for removal.
- ⚠️ `git filter-branch` is deprecated and slower than `git filter-repo` — prefer `git filter-repo` for all new operations. If `git filter-repo` is not installed, install it with `pip install git-filter-repo`.
- ⚠️ Re-committing the scrubbed history without a coordination plan — collaborators will see a divergent history. Communicate the force-push window before executing.
- ⚠️ GitHub PAT scope may reject a force push if the token was created with read-only permissions — check `repo` scope before pushing.
- ⚠️ `.bak` files in `credentials/` and `memory/` directories are intentional system backups — exclude these from the scrub target list to avoid breaking system restoration paths.
