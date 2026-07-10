---
name: memory-flush-tool-awareness
description: Detect pre-compaction memory flush mode and defer non-memory file writes until flush completes, avoiding silent tool failures.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-22T21:31:01.259Z
---

## Workflow

1. **Detect flush mode** — Watch for `exec` calls that succeed but `write`/`edit` calls that fail silently or return no confirmation. Also watch for "HEARTBEAT_OK" responses without substantive output across multiple turns, which often coincides with memory flush blocking tool execution.

2. **Identify what flush mode blocks** — When in flush mode, the `write` and `edit` tools are restricted for workspace files. File writes to the `memory/` directory are typically still permitted as the flush targets. The restriction applies to arbitrary workspace files (scripts, configs, notes).

3. **Defer non-memory writes** — Instead of writing directly to workspace files, append the intended content to `memory/<date>.md` using `exec` with `echo` or `tee`. The cron dispatcher (`openclaw cron dispatch`) also writes to `memory/`, so this path survives flush.

4. **Handle cron-vs-main-session collision** — If a cron job runs and its follow-up write fails (cron reports success but file is not created), the main session may be in flush mode. Check `~/.openclaw/memory/` for recently appended entries. If the intended write landed in memory, it will be ingested by the wiki-daily-ingest cron later.

5. **Recover after flush** — Once the session exits flush mode (signaled by normal write tool responses returning confirmation), replay deferred writes by reading `memory/<date>.md` and committing the content to the intended target files.

## Pitfalls

- ⚠️ **Silent cron success masking flush block** — A cron task completes and reports success, but its downstream `write` call was silently blocked by memory flush. The file never appears on disk. Solution: after any cron-triggered write, verify the file exists with `exec test -f <path>` before treating the operation as complete.

- ⚠️ **Assuming flush mode is global** — Flush mode applies per-session. A cron job running in an isolated session may successfully write while the main session is in flush mode. Do not assume that because one session is in flush, all writes globally fail.

- ⚠️ **Heartbeat responses during flush** — The session may respond only with `HEARTBEAT_OK` during flush. This is not a bug — it means the session is alive but deferring non-critical work. Continue polling for substantive output; do not interpret `HEARTBEAT_OK` alone as a failure.
