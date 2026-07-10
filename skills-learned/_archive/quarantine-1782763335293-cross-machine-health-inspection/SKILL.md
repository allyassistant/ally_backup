---
name: cross-machine-health-inspection
description: Run consistent diagnostic commands across multiple named machines over SSH, aggregate the output, and identify which machine has diverged or failed.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-29T20:01:01.251Z
stability: experimental
---

## Workflow

1. **Identify machines and diagnostic scope.**
   Parse the user's request for named machines (e.g. "Ally", "Bliss") and the subsystem or component to inspect (e.g. failover detector, cron health, disk space). Build a list of `<hostname, subsystem>` pairs.

2. **Define the canonical diagnostic command per subsystem.**
   For each subsystem type, choose the right read-only command:
   - Failover detector: check status file or watchdog service (e.g. `cat /var/run/failover-detector/status`, `systemctl status fd`, or `openclaw health`)
   - Cron health: `openclaw cron list` or `crontab -l`
   - Disk/memory: `df -h`, `free -m`
   - Process aliveness: `pgrep -a <process>` or `systemctl is-active <service>`
   Keep commands read-only — this is inspection, not modification.

3. **SSH into each machine and run the diagnostic in parallel.**
   Use `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10` for resilience. Run the same command against each hostname and capture stdout + stderr separately:
   ```bash
   ssh host1 "diagnostic-command" > /tmp/inspect-host1.out 2>&1
   ssh host2 "diagnostic-command" > /tmp/inspect-host2.out 2>&1
   ```

4. **Aggregate and compare outputs.**
   Read each output file. Produce a comparison table:
