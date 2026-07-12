---
name: cross-machine-deployment
description: Workflow for deploying local fixes/updates to remote peer machines via SSH with sync verification
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-11T10:30:00.000Z
disable-model-invocation: true
activation: manual
activationReason: "SSH cross-machine deploy affects Ally + Bliss HA pair"
---

# Cross-machine Deployment

Workflow for deploying fixes, scripts, or configuration changes from the current machine (source) to a peer machine (target) with verification. Used when both Ally and Bliss run the same HA service scripts.

## Workflow

1. **Identify deployment scope**
   - List files changed: scripts, configs, templates
   - Note dependencies: does the target need new directories, env vars, or backup?
   - Check if target already has a local modified version (diff risk)

2. **Backup target's current version**
   ```bash
   ssh <target> "cp <filepath> <filepath>.bak.$(date +%Y%m%d_%H%M%S)"
   ```
   - Name backup with timestamp for rollback traceability
   - Confirm backup file exists before proceeding

3. **Push file to target**
   ```bash
   rsync -avz <source-file> <target>:<target-filepath>
   # or
   scp <source-file> <target>:<target-filepath>
   ```
   - Use `rsync` for directory syncs, `scp` for single files
   - Verify exit code is 0

4. **Verify file integrity (MD5 checksum)**
   ```bash
   source_md5=$(md5 <source-file> | awk '{print $NF}')
   target_md5=$(ssh <target> "md5 <target-filepath>" | awk '{print $NF}')
   if [ "$source_md5" = "$target_md5" ]; then echo "✅ Match"; else echo "❌ Mismatch"; fi
   ```
   - Must match exactly before proceeding
   - If mismatch, re-push or debug SSH/SCP issues

5. **Clean up stale artifacts on target**
   - Check for orphaned temp files, old state files, stale backups
   - Remove if confirmed unused (grep for references in scripts first)
   - Update issue/notes documenting what was removed

6. **Verify functional state on target**
   - Run a dry-run test (if script is executable and safe)
   - Check that new fields/logs appear correctly
   - Compare running state: same script version on both sides

7. **Update issue tracking**
   - Log what was deployed, when, and to which machines
   - Record MD5 checksums in case of future drift detection
   - Mark deployment as complete, move to observation period if needed

## Pitfalls

- **Stale state files on target**: If the target has old heartbeat/status files from a previous version, the new script may read them incorrectly. Always check and clean before/after deployment.
- **SSH key rotation**: If the peer's SSH keys were rotated, `scp`/`ssh` commands may silently fail. Always verify exit codes.
- **Machine-specific configs**: If the target has machine-specific config (e.g. hostname-based paths, different credentials), copying blindly will break. Check for variables in the source that reference the source machine.
- **Backup naming collision**: Running multiple deployments in one day overwrites `.bak` files with the same date. Always include timestamp to minute precision.
- **Permission mismatch**: If the script needs execute permission and the target copy lost it, add `chmod +x` in step 3 or 4.
- **Race condition on test**: Running the script on target immediately after deploy may trigger false alerts (e.g. heartbeat detector seeing both machines' new state). Prefer dry-run or `--check` flags.

## References

- `system-code-debug-triage` — for the analysis + fix phase before deployment
- `cron-job-testing` — for verifying cron-integrated scripts post-deployment
