---
name: git-push-auth-failure
description: Diagnose and fix Git push failures caused by expired or invalid credentials, including PAT tokens, then verify and resume the push.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-16T13:00:00.000Z
---

## Workflow

1. Run `git push` and capture the exact error message. An `HTTP 401` or `remote: HTTP/2 401 (Unauthorized)` error indicates a credential issue, typically an expired personal access token (PAT) in the remote URL.
2. Inspect the remote URL with `git remote -v` to identify the credential type: if the URL contains `https://<TOKEN>@github.com/...`, the token is embedded and has likely expired.
3. To fix an expired PAT, navigate to https://github.com/settings/tokens, generate a new classic token with the `repo` scope, and update the remote URL:
