---
name: cron-sessionkey-cascade-recovery
description: Diagnose and recover from cron context overflow cascade triggered by gateway restart — when catch-up retries bind to the same session and overflow it
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-12T14:05:00.000Z
---

## Workflow

1. **Detect cascade pattern**: Multiple cron jobs failing simultaneously with `context overflow` errors, all occurring right after a gateway restart. Check OpenClaw logs for timestamp clusters — if 3+ crons failed within 2 minutes of gateway restart, this is a cascade.

2. **Verify root cause**: List all cron jobs with `openclaw cron list`. Check each job's config for `sessionKey` field:
   `openclaw cron config show <job-id> | grep sessionKey`
   Jobs with `sessionKey` bound to active sessions (especially `#general` or high-activity channels) are vulnerable.

3. **Save existing job config**: Before modifying, save each affected job's full config:
   `openclaw cron config show <job-id> > /tmp/cron_backup_<job-id>.json`
   This enables rollback if the fix doesn't work.

4. **Recreate without sessionKey**: For each affected job, the gateway API cannot clear `sessionKey` — you must delete and recreate:
