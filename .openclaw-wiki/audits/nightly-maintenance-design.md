# Nightly OpenClaw Maintenance — Architecture Design

**Date:** 2026-06-24
**Author:** OpenClaw Expert (agent-8fbd742b0e38)
**Trigger:** Ally asked: "Can I set up a daily 04:30 cron where YOU (OpenClaw Expert) maintain the local OpenClaw?"
**Status:** Design proposal — awaiting Ally's decision

---

## Context

Ally is running an OpenClaw installation on a Mac mini (Ally Assistant Discord bot). I (OpenClaw Expert agent) also run on the same Mac mini, with full filesystem + CLI access, but in a separate agent context.

**Goal:** Establish a daily 04:30 HKT (20:30 UTC previous day) maintenance routine where I:
1. Audit the local OpenClaw's health
2. Apply safe auto-fixes
3. Update knowledge (memory, wiki, skills)
4. Report findings back to Ally

This serves Ally's stated Goal 1 (Global bug-finding + auto-fix across all OpenClaw scripts).

---

## 3 Architecture Options

### Option 1: `mavis cron self` (recommended)

**What:** I set a self-reminder on my own session that fires at 04:30 HKT daily. The reminder prompt instructs me to run my maintenance routine.

```bash
mavis cron self openclaw-nightly-maintenance \
  --cron "30 4 * * *" \
  --tz "Asia/Hong_Kong" \
  --prompt "Run nightly OpenClaw maintenance: (1) execute scripts/maintenance/nightly_health_check.sh, (2) read its JSON report, (3) apply safe auto-fixes, (4) update memory if new knowledge discovered, (5) post summary to #⚙️系統 if anything noteworthy. Use TodoWrite to track steps."
```

**Pros:**
- True "I do it" semantics — the OpenClaw Expert agent is the actor
- Can apply judgment (what's safe to fix, what needs human review)
- Can update memory with new patterns observed
- Can post contextual summary to Discord
- Single cron, simple setup
- Self-cleaning (TTL expires after 30d, can extend)

**Cons:**
- Depends on me being reachable at 04:30 HKT (Mac mini must be awake, daemon running)
- If I'm not online, the prompt queues until I'm back (acceptable for maintenance, not real-time alerts)
- One session per fire — context resets each time (but my memory persists)

### Option 2: OpenClaw cron + agentTurn payload

**What:** An OpenClaw cron job that invokes an LLM agent to do the maintenance.

```bash
openclaw cron create \
  --name "OpenClaw Nightly Maintenance" \
  --cron "30 4 * * *" \
  --tz "Asia/Hong_Kong" \
  --command-argv '["node", "scripts/maintenance/nightly_agent_runner.js"]' \
  --command-cwd "/Users/ally/.openclaw/workspace" \
  --channel "discord" \
  --to "1473376125584670872" \
  --agent main
```

The runner script invokes a LLM (probably `minimax-m2.7` for cost) with a maintenance prompt.

**Pros:**
- Native OpenClaw cron infrastructure
- LLM does the analysis
- Cron failures (timeouts, errors) surface via standard OpenClaw cron status
- Can specify model, agent, delivery

**Cons:**
- **Not really "I" doing it** — it's a different LLM agent (likely MiniMax M2.7) doing the work
- Adds LLM cost (~$0.10–0.50 per run depending on context)
- Result quality depends on model choice — `minimax-m2.7` is cheaper but less reliable than me
- Lacks my accumulated knowledge (memory across sessions, observed patterns from this audit)
- Different agent context — won't have my memory loaded

### Option 3: Shell script + audit log + light me-review

**What:** A bash script does all the deterministic checks (no LLM), writes a report. A light `mavis cron self` reminder just pings me to review the report and act on anomalies.

```bash
# 04:30 — shell script runs (deterministic, no LLM cost)
0 30 4 * * * /Users/ally/.openclaw/workspace/scripts/maintenance/nightly_health_check.sh

# 04:35 — I wake up to review
mavis cron self openclaw-nightly-review \
  --cron "35 4 * * *" \
  --prompt "Read ~/.openclaw/workspace/.state/nightly_health_report.json. If anomalies found, apply safe fixes + post to #⚙️系統. If clean, do nothing."
```

**Pros:**
- Cheap (no LLM cost for the heavy lifting)
- Reliable (bash script is deterministic)
- I provide analysis layer only when needed
- Best of both worlds: deterministic + judgment

**Cons:**
- Two-step setup
- Shell script needs to be comprehensive (can miss things LLM would catch)
- Me-ping still depends on my availability (5 min after script)

---

## Recommended: Option 1 + Option 3 Hybrid

**Architecture:**
- **Bash script** does all deterministic work (cron audit, disk usage, broken symlinks, skill candidate review, etc.)
- **I (mavis cron self)** wake up 5 min after, read the JSON report, apply judgment (what to escalate vs. fix), update memory, post summary to Discord

```
[04:30] bash script runs (deterministic checks → JSON report)
[04:35] I wake up, read report, apply judgment
[04:40] I post summary to #⚙️系統 if noteworthy, update memory if new patterns
[04:45] Done
```

This is the "self-healing loop" + "self-learning" pattern from Ally's profile, in miniature.

---

## Concrete Schedule — What 04:30 Does

### Phase 1: Bash script (04:30, deterministic)

`scripts/maintenance/nightly_health_check.sh` produces `~/.openclaw/workspace/.state/nightly_health_report.json`:

```json
{
  "timestamp": "2026-06-24T04:30:15+08:00",
  "checks": {
    "cron_health": {
      "ok": 27,
      "error": 2,
      "silent_failure_suspected": [...],
      "overdue": [...]
    },
    "disk_usage": {
      "total": "2.1G",
      "largest": ["/Users/ally/.openclaw/memory 487M", "/Users/ally/.openclaw/tmp 561M"]
    },
    "broken_symlinks": [...],
    "tmp_cleanup_candidates": {
      "total_bytes": 50000000,
      "files": [...]
    },
    "memory_state": {
      "vector_store": "ready|unknown|error",
      "files_indexed": 3994,
      "dirty_files": 0,
      "embedding_cache_size": 8498
    },
    "plugin_health": {
      "total": 105,
      "enabled": 7,
      "hook_violations": [...]
    },
    "skill_candidates": {
      "new": 0,
      "needs_review": 3,
      "in_dedup": 12
    },
    "config_health": {
      "stale_keys": [...],
      "secret_refs_unresolved": [...],
      "openclaw_wiki_sync_status": "ok|drift"
    },
    "git_status": {
      "uncommitted_changes": 23,
      "files": [...]
    },
    "last_backup": "2026-06-23T05:00:00+08:00"
  }
}
```

### Phase 2: Me review (04:35, judgment)

I read the JSON and decide:
- **Auto-fix safe things** (e.g., clear `tmp_cleanup_candidates` files I created)
- **Escalate anomalies** (e.g., cron silent failure → investigate)
- **Update memory** if new patterns discovered
- **Post to #⚙️系統** if there's anything noteworthy (otherwise silent)

### Phase 3: Persistent state (daily)

I maintain `~/.openclaw/workspace/.state/maintenance_history.jsonl` with daily entries:
```json
{"date": "2026-06-24", "summary": "Clean run, 0 anomalies", "fixes_applied": [], "notable": []}
{"date": "2026-06-23", "summary": "Fixed 2 syntax errors, 1 broken symlink", "fixes_applied": ["fileDiscovery.js", "..."], "notable": ["CQM cron recovered"]}
```

---

## First 2 Weeks: Light Mode

To avoid over-engineering, the first 2 weeks should be:
- **Bash script**: only the 3-4 most useful checks (cron silent failures, disk usage, broken symlinks, tmp cleanup)
- **Me review**: only post to Discord if anomalies found (silent otherwise)
- **No memory updates** for the first week — observe what patterns emerge

After 2 weeks, expand based on what proved useful.

---

## Cost Analysis

| Item | Per-run cost | Monthly (30 runs) |
|---|---|---|
| Bash script | $0 (deterministic) | $0 |
| Me wake-up (Option 1/3) | ~$0.10 (small context) | ~$3 |
| OpenClaw agentTurn (Option 2) | ~$0.30 (large context, full LLM) | ~$9 |
| Discord notification | $0 (OpenClaw rate limit ok) | $0 |
| **Recommended total** | **~$0.10** | **~$3** |

For context, Ally's existing daily LLM cost is ~$40/day. $3/month for autonomous maintenance is negligible.

---

## Open Questions / Decisions Needed

1. **Discord delivery**: Where to post summaries?
   - `#⚙️系統` (system channel) — gets mixed with other noise
   - New dedicated `#🔧maintenance` channel
   - Silent unless anomaly

2. **Memory updates**: Should I write findings to:
   - My own memory (`.openclaw/workspace/.state/openclaw-expert-memory.md`?)
   - OpenClaw's MEMORY.md (Ally's persistent memory)?
   - Both? Different things?

3. **Auto-fix scope**: What can I auto-fix vs. require Ally approval?
   - Safe to auto-fix: tmp cleanup, broken symlinks I created, expired backups
   - Require approval: code changes, config changes, deletion of user data

4. **Frequency**: 04:30 daily enough, or also weekly deeper audit (Sunday 04:00)?

5. **Failure handling**: If I detect something catastrophic (e.g., gateway down, db corrupt), should I:
   - Just report (current plan)
   - Page Ally (Discord DM)
   - Try to auto-recover (launchctl kickstart, etc.)

---

## Comparison

| Dimension | Option 1 (cron self) | Option 2 (agentTurn) | Option 3 (hybrid) |
|---|---|---|---|
| True "I do it" | ✓ | ✗ (different LLM) | ✓ |
| LLM cost/month | ~$3 | ~$9 | ~$3 |
| My memory loaded | ✓ | ✗ | ✓ |
| Judgment layer | ✓ (full) | △ (model-dependent) | ✓ (judgment) |
| Deterministic reliability | ✗ (LLM flaky) | △ (LLM flaky) | ✓ (bash) + △ (me) |
| Setup complexity | Low | Low | Medium |
| Survive OpenClaw upgrade | ✓ | ✗ (cron config) | ✓ |
| Fail-safe (if I'm offline) | △ (queue) | ✓ (other LLM) | △ (queue) |

---

## Recommendation

**Option 3 (hybrid)** — best of both worlds, addresses all 3 concerns.

**Why not Option 1 alone:** LLM cost is negligible, but the bash script's reliability for the deterministic layer is significantly better. A bash script won't have a hallucination failure mode.

**Why not Option 2 alone:** It's not really "I" doing the work. MiniMax M2.7 is cheaper than me but lacks my accumulated knowledge. Plus, it adds a separate agent context that diverges from my main memory.

**Concrete next step** (after Ally approves):
1. Write `scripts/maintenance/nightly_health_check.sh` — ~80 lines bash
2. Set up `mavis cron self openclaw-nightly-review` for 04:35
3. First run is dry-run (just produce report, no fixes)
4. After 3 days of dry-run, enable auto-fix for safe categories
5. After 2 weeks, evaluate what to add/remove

---

## Decision

**Awaiting Ally's response** on:
- Go with Option 3 (recommended)?
- Discord delivery preference (Q1)?
- Auto-fix scope (Q3)?
- Anything else?
