---
name: script-live-fetch-verification
description: Detect when a scheduled script claims to fetch live data but produces stale output by comparing cache mtime, tracing script logic, and identifying live-fetch stubs.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-22T04:05:00.000Z
---

## Workflow

1. **Identify the suspect script.** Look for scripts labeled as data-fetch or data-update in cron job manifests (`MONDAY_JOBS`, `CRON_JOBS` arrays). Note the cache file path and the script's apparent purpose.

2. **Check cache mtime against current date.** Run `stat <cache_file>` and compute age in days. If the cache is 30+ days old despite the script running on a schedule, flag it as potentially stale.

3. **Trace the script's fetch logic.** Read the script source and identify: (a) does it call a live HTTP/API fetcher? (b) does it have a fallback that uses existing cache? (c) is the live fetcher function actually invoked in the main execution path?

4. **Compare script name against actual behavior.** A script named `idex_fetcher_bot.js` that only calls `touch()` or bumps a timestamp on an old cache file is a **live-fetch stub** — it satisfies the "ran successfully" check without producing fresh data.

5. **Check for the actual live fetcher.** Many pipelines have a standalone live fetcher (`idex_fetcher.js`) that the cron script (`idex_fetcher_bot.js`) never calls. Verify the orchestrator actually invokes the live fetcher, not just the bot wrapper.

6. **Audit the fallback chain.** If the script has a live → cache fallback, verify the fallback does not execute silently on success. The fallback should log a warning when using stale data, not return exit 0 with no indication of staleness.

7. **Fix or report.** If a live-fetch stub is found: add the live fetcher call to the execution path, or replace the stub with the actual fetcher. Report findings with before/after cache age.

## Pitfalls

- ⚠️ Timestamp-bump illusion — a script that calls `fs.utimes()` or JSON-re-serialization with the same content produces a fresh `mtime` on the cache file, making it appear recently updated. The data content can be 95+ days stale while `mtime` is today. Always check data content timestamps, not file mtime.
- ⚠️ Silent fallback on live-fetch failure — when the live fetcher fails and the script falls back to stale cache, many scripts exit 0 with no warning. The cron shows "success" but the output is stale. Add explicit logging when fallback activates.
- ⚠️ Stub script in cron, live fetcher exists but is never called — the orchestrator script (`*_bot.js`) is scheduled but delegates to a live fetcher (`*.js`) that is never imported or executed. The bot only updates metadata. Fix by wiring the live fetcher into the orchestrator.
- ⚠️ Schedule frequency mismatch — a script that runs weekly cannot produce "daily" data. If the cache age exceeds the schedule interval by 2x, it is definitively stale regardless of script logic. A 95-day cache for a weekly job is a guaranteed staleness signal.
- ⚠️ Cache file exists but is empty or corrupted — `fs.existsSync()` returns true but the file has no valid content. The script reads the empty/partial cache and proceeds. Check `JSON.parse()` success or file byte size, not just existence.
