---
name: daily-synthesis
description: "Synthesize daily learning across memory and Obsidian. Use when: synthesis triggers, patterns needed, connections required. Key capabilities: memory scan, Obsidian, highlighting."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-08T12:32:49.948Z
---

## Workflow

1. **Set time window** — Determine synthesis date (default: today). Content window = L0 (abstract) + L1 (overview) for that date, plus L2 (raw memories) and Obsidian daily notes from the same date.
2. **Check L0/L1 availability** — Query `memory/` for today's L0 abstract and L1 overview files (`YYYY-MM-DD` prefix). If both exist, proceed. If either is missing, abort with "L0/L1 content not ready — cron may be running before凌晨 flush" and do NOT attempt synthesis.
3. **Collect new L2** — Scan `memory/YYYY-MM-DD-*.md` for new topics not yet in L0. Skip any entry already covered by today's L0 abstract.
4. **Diff against previous day** — Read previous day's Obsidian daily note (if exists). Only include L2 topics that represent genuinely new patterns, connections, or contradictions compared to prior synthesis.
5. **Build Discord embed** — Format output as a compact Discord embed: date header, 3-5 bullet highlights (patterns / connections / contradictions), total topic count, and a "New vs. prior day" delta line.
6. **Write Obsidian daily note** — Append synthesis results to `obsidian/daily/YYYY-MM-DD.md` under a `## 每日合成` section with wikilinks to source L2 files.
7. **Deliver** — Send Discord embed to the configured channel via `discord-notify` or equivalent webhook. Log result to HEARTBEAT.md.

## Cron Timing (Critical)

| Setting | Value |
|---------|-------|
| Schedule | `0 2 * * *` (02:00 HKT daily) |
| Rationale | After凌晨 L0/L1 flush; before morning human review |

**Do NOT schedule at 08:00 HKT** — by that time the pipeline may not have completed L0/L1 generation for the current date. The 08:00 run will find L0/L1 missing and abort with an error state.

The thin executor script (`scripts/daily_synthesis.js`) validates L0/L1 presence at startup and exits cleanly if content is not ready.

## Pitfalls

- **Premature cron execution (08:00 HKT)**: If the cron fires before凌晨 flush, L0/L1 will be absent. The script will report "❌ L0/L1 not ready" and abort. Fix: reschedule to `0 2 * * *`.
- **Running outside the agent session**: The thin executor (`node scripts/daily_synthesis.js`) is self-contained and requires no LLM. Do not trigger via `agentTurn` message — use the script directly with appropriate flags (`--date`, `--dry-run`, `--discord-channel`).
- **False-positive "new" topics**: If L2 contains entries from days before the target date (e.g., stale memory files), they may appear as new. Always filter `memory/YYYY-MM-DD-*.md` strictly by date prefix.
- **Missing Discord channel**: The script requires `--discord-channel <id>`. Without it, synthesis results are written to Obsidian but not delivered. Provide channel ID explicitly in cron command.
- **Duplicate Discord delivery**: If the cron fires twice (e.g., manual re-run), the same embed may be posted twice. The script does not deduplicate; use `--dry-run` to preview before live delivery.

## Flags

| Flag | Description |
|------|-------------|
| `--date YYYY-MM-DD` | Synthesis date (default: today) |
| `--dry-run` | Preview output without sending to Discord |
| `--discord-channel <id>` | Target Discord channel ID |
| `--quiet` | Suppress console output |
| `--help` | Show full usage |

## Related Skills

- `cron-job-testing` — Testing cron job behavior and timing
- `cron-thin-executor-migration` — Converting agentTurn cron jobs to self-contained scripts
- `multi-phase-subagent-orchestration` — Spawning analysis + fix sub-agents for multi-step fixes
