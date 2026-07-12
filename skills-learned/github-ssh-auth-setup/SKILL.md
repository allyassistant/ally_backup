---
name: github-ssh-auth-setup
description: "Set up SSH public key authentication for GitHub push operations with full agent lifecycle. Use when: SSH auth fails for push, public key not registered, HTTPS credential blocks push. Key capabilities: ssh-agent lifecycle, GitHub web UI key add, connectivity verification."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-10T10:05:00.000Z
---

## Workflow

1. **Check if SSH key already exists.** Run `ls -la ~/.ssh/` and look for `id_ed25519` or `id_rsa` key pairs. If a key exists, skip to step 3.

2. **Generate a new SSH key if needed.** Run `ssh-keygen -t ed25519 -C "your_email@example.com"` and follow the prompts. Accept the default file location and set a passphrase.

3. **Verify the key is loaded in the SSH agent.** Run `ssh-add -l`:
   - If it outputs a fingerprint → key is loaded. Proceed to step 5.
   - If it says "The agent has no identities" → key is not loaded. Continue to step 4.

4. **Load the key into the SSH agent.** Run:
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```
   Then re-run `ssh-add -l` to confirm the key is now listed.

5. **Retrieve the public key for GitHub.** Run `cat ~/.ssh/id_ed25519.pub` and copy the full output (starts with `ssh-ed25519 AAAAC3...`).

6. **Add the public key to GitHub via the web UI.** Navigate to [github.com/settings/keys](https://github.com/settings/keys), click **New SSH key**, enter a descriptive title (e.g., `Mac-mini`, `Work-Laptop`), paste the full public key into the key field, and click **Add SSH key**.

7. **Verify GitHub connectivity.** Run `ssh -T git@github.com`. A successful response reads: `Hi <username>! You've successfully authenticated, but GitHub does not provide shell access.`

8. **Retry the git operation.** Re-run the original `git push` or `git pull` command that triggered the authentication request.

## Pitfalls

- ⚠️ SSH key exists but is not loaded in the agent — GitHub rejects the connection with `Permission denied (publickey)` even though the key is present on disk. The agent session is ephemeral; after a terminal restart or new session, `ssh-add -l` returns empty. Always re-run step 4 in fresh sessions.

- ⚠️ Adding the private key instead of the public key to GitHub — GitHub rejects anything that does not start with `ssh-ed25519 AAAAC3...` or `ssh-rsa AAAA...`. The private key (no `.pub` extension) cannot be added. Paste only `~/.ssh/id_ed25519.pub` content.

- ⚠️ GitHub shows the key as added but `ssh -T git@github.com` still fails — check that the key was added to the correct GitHub account (personal vs. organization), and verify the key has the expected fingerprint with `ssh-keygen -lf ~/.ssh/id_ed25519.pub`.

- ⚠️ Corporate proxies or VPN filters intercept port 22 (SSH) — GitHub alternative is to use HTTPS with a Personal Access Token instead. If SSH is blocked, fall back to `git remote set-url origin https://github.com/user/repo.git` and use token-based authentication.

- ⚠️ GitHub deprecated DSA and RSA-SHA1 keys — new keys must use `ed25519`. Old `id_rsa` keys still work if added before the deprecation date, but GitHub may reject them on push. Migrate to `ed25519` if push fails with older key types.

- ⚠️ Multiple SSH keys in `~/.ssh/` — SSH client tries keys in default order. If a wrong key is tried first, GitHub may reject the auth attempt. Use `ssh -vT git@github.com` to see which key is being offered and add `IdentityFile ~/.ssh/id_ed25519` to `~/.ssh/config` to force the correct key.

- ⚠️ GitHub PAT scope insufficient after SSH key was the intended method — the `repo` scope is needed for push. If switching from SSH to HTTPS PAT auth, update the remote URL and ensure the PAT has `repo` scope enabled.

- ⚠️ Key added to wrong GitHub account (e.g., personal vs. work) — `ssh -T git@github.com` returns the account name in the success message. If the account name does not match the repo owner, push will fail with 403. Re-add the key to the correct account.

## Edge Cases

- **Key protected with passphrase:** `ssh-add` prompts for the passphrase once per session. Use `ssh-add ~/.ssh/id_ed25519` before any git operations in a new session. The `SSH_ASKPASS` trick or `ssh-agent` forwarding can automate this in cron contexts, but for interactive use, entering the passphrase is acceptable.

- **Clone via SSH fails but push works:** GitHub may block inbound SSH from certain network locations. Use `ssh -o ConnectTimeout=10` to detect timeouts vs. auth failures.

- **Deploy key (machine-specific, not user-level):** If this is a server deploying from a shared CI/CD account, use a deploy key instead of a user-level SSH key. Add the public key to the repo's **Settings → Deploy keys** section instead of the user account.
