---
name: github-pat-scope-update
description: "Update GitHub Personal Access Token repository scope after remote switch, repo rename, or credential rotation. Use when: git push returns 403, repo renamed in remote, PAT scope missing repo access. Key capabilities: PAT scope update, remote URL verification, credential rotation fix."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-10T09:31:01.215Z
---

## Workflow

1. **Detect the 403 block.** When `git push` fails with `403 Forbidden`, confirm the remote URL contains a `github_pat_` token:
   ```bash
   git config --get remote.origin.url
   ```
   If output contains `allyassistant:***@github.com/allyassistant/<repo>` and push fails → PAT scope issue.

2. **Extract the token.** Parse the token from the remote URL (the segment between `:` and `@`):
   ```bash
   git config --get remote.origin.url | sed 's|.*:\([^@]*\)@.*|\1|'
   ```
   Example output: `github_pat_11B5Z2TVI0zc9nhW...`

3. **Identify target repo.** From the remote URL, extract the repository name:
   ```bash
   git remote get-url origin | sed 's|.*allyassistant/||;s|\.git$||'
   ```
   Example output: `ally_backup`

4. **Update PAT scope via GitHub UI.** Instruct user to:
   - Visit [github.com/settings/tokens](https://github.com/settings/tokens)
   - Click the identified token
   - In **Repository access**, select **All repositories** OR **Only select repositories → add `<repo>`**
   - Save

5. **Wait for confirmation.** The user confirms PAT scope is updated, then retry push:
   ```bash
   git push origin main
   ```

## Pitfalls

- ⚠️ Fine-Grained PAT with restrictive repo access — Fine-Grained PATs (format `github_pat_11...`) default to zero repo access; they must be explicitly granted per-repo, unlike Classic PATs which use the `repo` scope checkbox. Classic PATs grant `repo` scope to all current and future repos under the account; Fine-Grained PATs do not.
- ⚠️ Token URL still cached in `git config` after GitHub UI update — GitHub may take 1-2 minutes to propagate scope changes. If push still fails, wait 60s and retry. Do not assume immediate propagation.
- ⚠️ Mistaking 403 for wrong password — if `git config --get remote.origin.url` shows a token (not a username:password pattern), the issue is scope, not authentication. Wrong password would be 401.
- ⚠️ Pushing to wrong remote after switch — after `git remote set-url origin <new-url>`, confirm `git remote -v` shows the correct URL before instructing user to update PAT. Pushing to the old remote after switching URLs wastes the scope update.
- ⚠️ filter-repo leaves refs but removes objects — after history rewrite (`git filter-repo --force --tree-filter`), ensure `git push --force` is used, not plain `git push`. Refs are rewritten but local history diverges from remote.
