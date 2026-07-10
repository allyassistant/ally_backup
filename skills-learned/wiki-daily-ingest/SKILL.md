---
name: wiki-daily-ingest
description: Sync memory artifacts into Wiki via the SDK interface in one cron call, with dry-run preview and auto-fallback to yesterday's data when empty.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-19T01:10:00.000Z
---

## Workflow

1. Create a single Node.js script (e.g. `scripts/wiki_daily_ingest.js`) that uses the Wiki SDK helper (`require('/Users/ally/.openclaw/workspace/scripts/_lib/wiki_helper.js')`) instead of CLI subprocess — this avoids shell escaping issues and is faster.
2. In the script, read MEMORY.md, L0 abstracts (`memory/L0/`), and L1 overviews (`memory/L1/`). Concatenate them into structured Wiki source content with `# Daily Summary (YYYY-MM-DD)` heading.
3. Write the result to `wiki/main/sources/daily-summary-YYYY-MM-DD.md` using `fs.writeFileSync` with a `NO_REPLY` protocol marker in the frontmatter so the Wiki agent does not auto-respond.
4. Implement a `--dry-run` flag: when set, log what would be written but do not actually write the file. Always end dry-run with the message "Dry-run 成功" so the caller knows it passed.
5. Implement auto-fallback: if today's date yields an empty result (e.g. no memory artifacts yet), use yesterday's date instead. Log the fallback in the output.
6. Update the cron job from 3 separate `exec` commands (fetch MEMORY.md, fetch L0, fetch L1, write, then Wiki CLI) to a single `node scripts/wiki_daily_ingest.js` command with no arguments for production, `--dry-run` for testing.
7. Verify by running the dry-run first, then checking `wiki/main/sources/` for the output file. Update HEARTBEAT.md to reflect the new cron payload.

## Pitfalls

- ⚠️ Using `child_process.execSync` to call Wiki CLI — shell escaping breaks on special characters in memory content. Use the SDK helper directly (`require(_lib/wiki_helper.js)`) with `wikiHelper.writeSource(name, content)`.
- ⚠️ Writing to `wiki/main/sources/` without `NO_REPLY` protocol — the Wiki agent sees the new file and auto-responds, creating a response loop. Add `protocol: NO_REPLY` in the frontmatter.
- ⚠️ Hardcoding the date for the file name — if the script runs at 23:59 and crosses midnight, the file name date no longer matches the content date. Use the actual content date, not the runtime clock.
- ⚠️ Cron job still using 3 separate exec commands after migration — the whole point is reducing to 1 command. Verify with `openclaw cron list` that the payload is a single `node` call.
- ⚠️ Not running dry-run before touching production — the script may have require() errors or path issues. Always check dry-run output matches expectations before removing `--dry-run`.
