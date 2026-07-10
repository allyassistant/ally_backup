---
name: memory-flush-date-boundary
description: 凌晨時分 pre-compaction memory flush 因 hardcoded 日期字串而出錯的識別、除錯與修復流程
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-07T00:30:00.000Z
---

## Workflow

1. **Recognise the error signature** — When a pre-compaction memory flush fails, the error message looks like:
   ```
   ⚠️ ✍️ Write: .../memory/YYYY-MM-DD.md failed
   ```
   This prefix (`⚠️ ✍️ Write:`) is emitted by OpenClaw's **internal compaction safeguard** (`compaction.mode: "safeguard"` in gateway config), NOT by any user script or plugin. The safeguard intercepts all writes to `memory/` directory and blocks ones whose filename date doesn't match the current date.

2. **Identify the root cause immediately** — The most common cause is a **hardcoded date string** in your manual memory flush. Example:
   ```javascript
   // ❌ WRONG — hardcoded date that goes stale after midnight
   write path="memory/2026-06-06.md" content="..."
   ```
   If the current date has advanced (e.g., it's now `2026-06-07` UTC+8 but you hardcoded `2026-06-06`), the safeguard blocks the write.

3. **Diagnose the source** — If unsure where the error originates:
   - Note the exact error format: `⚠️ ✍️ Write: ... failed` — this is the **signature** of OpenClaw's internal hooks (`hooks.internal.entries.compaction-notifier`)
   - Search config (`gateway config` or `config.json`) for `compaction.mode` — if it's `"safeguard"`, the error is expected and protective
   - Search source files only if you suspect a plugin/extension issue; the compaction safeguard is NOT in any user script

4. **Fix with dynamic date detection** — Before any memory flush write, always obtain the current date at runtime:
   ```bash
   # Shell: get today's date dynamically
   exec date "+%Y-%m-%d"
   # Result: "2026-06-07" — use this as the filename
   ```
   In JavaScript/Node scripts, use `new Date().toISOString().split('T')[0]` instead of a hardcoded string.
   In the agent's flow, `exec date "+%Y-%m-%d"` before writing, then use the result in your `write` tool call.

5. **Verify the fix** — After writing to the correct `memory/YYYY-MM-DD.md` file, confirm the write succeeded. The absence of the `⚠️ ✍️ Write: ... failed` error is the confirmation — the safeguard only shows that error on rejections; successful writes are silent.

## Pitfalls

- **The safeguard is a FEATURE, not a bug.** It prevents content from scattering across wrong-date files. Without it, memory content written under the wrong date would be invisible to subsequent `date`-scoped reads and compromise the memory compaction system.
- **The date boundary is at midnight HKT (UTC+8)** — if you're running long sub-agent spawns that cross `00:00`, the date will change mid-session. Always check the date before writing, especially between 00:00 and 00:30.
- **The error appears AFTER the fact** — the `⚠️ ✍️ Write: ... failed` message is sent as a tool result feedback, not as a blocking exception. Your write operation will fail silently and return the error as output. Don't ignore it; inspect it immediately.
- **Sub-agent context can silently cross midnight** — a sub-agent spawned before midnight but completing after midnight will use the wrong date if it was instructed with a hardcoded date. Include `date` detection instructions in sub-agent task descriptions when memory writes are involved.

## Related Skills

- `cron-job-testing` — cron-related debugging patterns, including gateway restart for plugin changes
- `skill-curation-pattern` — queue management that may trigger memory flushes
