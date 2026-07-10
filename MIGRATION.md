# MIGRATION.md — Pre-Move SOP for OpenClaw Scripts

> **Purpose:** Prevent the **"silent cron failure after script move"** class of bugs.
> See #176 (Anomaly Monitor) as the canonical incident: 3 consecutive cron failures over 5 hours before detection because `anomaly_monitor.js` was moved to `_legacy/m5-dormant-2026-06-20/` but the OpenClaw daemon cron argv still hardcoded the old path.

---

## Why this SOP exists

OpenClaw has **two sources of truth** for script paths:

1. **Filesystem** — `scripts/*.js`, `scripts/lib/*.js`, etc.
2. **OpenClaw daemon memory** — cron jobs' `payload.argv[1]` (the absolute script path)

When you `git mv` a script to `scripts/_legacy/`, the filesystem updates but the daemon memory does NOT. The next cron run will fail with `Cannot find module ...` and continue failing silently until someone notices.

The failure mode is silent because:
- No Discord alert fires (default `failureAlert` was disabled — fixed in commit 2026-06-21)
- The `cronMissing` scanner in `audit_daily_cron.js` only checks `crontab -l` (system crontab), not OpenClaw daemon crons (now fixed in commit 2026-06-21)

This SOP catches the drift **at the move source** so the daemon never gets out of sync.

---

## SOP — Before any `git mv scripts/<file>.js scripts/_legacy/<reason>/`

Run these checks **in order**. If any step finds a reference, decide before proceeding.

### Step 1: Find all OpenClaw daemon cron references

```bash
# Get all enabled cron jobs as JSON
openclaw cron list --json > /tmp/cron_list.json

# Find crons whose argv references the script
jq -r '.[] | select(.enabled == true) | .id + " " + .name + " " + (.payload.argv | join(" "))' \
  /tmp/cron_list.json | grep "<FILE>.js"
```

**If matches found → STOP.** Disable the cron(s) BEFORE moving:

```bash
openclaw cron disable <cron-id>
```

Also decide:
- Will a replacement script be created at the original path? If no → leave disabled (or remove cron entirely).
- Will the argv be updated to point to `_legacy/`? **Not recommended** — defeats M5-style cleanup intent.

### Step 2: Find all SKILL.md references

```bash
# Active skills only (exclude quarantine archive)
grep -rln "<FILE>" skills-learned/ \
  --include="SKILL.md" \
  | grep -v "_archive/" \
  | head -20
```

**If matches found → STOP.** Quarantine the SKILL.md BEFORE moving the script:

```bash
# Create quarantine dir (timestamp-prefixed)
QUAR_DIR="skills-learned/_archive/quarantine-$(date +%s%N)-<SKILL-NAME>/"
mkdir -p "$QUAR_DIR"
mv skills-learned/<SKILL-NAME>/SKILL.md "$QUAR_DIR"
# Update frontmatter status to quarantined
sed -i.bak 's/^status:.*/status: quarantined/' "$QUAR_DIR/SKILL.md"
rm "$QUAR_DIR/SKILL.md.bak"
```

### Step 3: Find all docs references (HEARTBEAT.md, TOOLS_CROSSSESSION.md, etc.)

```bash
# User-facing docs that recommend running the script
grep -rn "<FILE>" . \
  --include="*.md" \
  --exclude-dir=_legacy \
  --exclude-dir=.git \
  --exclude-dir=skills-learned \
  | head -20
```

**If matches found → STOP.** Update each doc to mark the script as archived before moving. Examples:
- `HEARTBEAT.md`: remove from active cron table, add to "停用" section with link to the tracking issue
- `TOOLS_CROSSSESSION.md`: remove from quick-reference tables, replace skill description with "已 archived" notice

### Step 4: Find all code imports (require/from)

```bash
# Active scripts that import the file
grep -rln "require.*<FILE>\|from.*<FILE>" \
  scripts/ \
  extensions/ \
  --include="*.js" --include="*.mjs" --include="*.cjs" \
  | grep -v "_legacy/" \
  | head -20
```

**If matches found → STOP.** Update the importing code (or accept the broken chain) before moving.

### Step 5: Verify no live references remain

```bash
# Combined check — should return NOTHING
{
  openclaw cron list --json 2>/dev/null \
    | jq -r '.[] | select(.enabled == true) | (.payload.argv // []) | .[]' \
    | grep "<FILE>.js" || true
  grep -rln "<FILE>" skills-learned/ --include="SKILL.md" | grep -v "_archive/" || true
  grep -rln "require.*<FILE>\|from.*<FILE>" scripts/ extensions/ --include="*.js" --include="*.mjs" 2>/dev/null | grep -v "_legacy/" || true
}
```

If anything prints → fix before moving.

### Step 6: Move + verify

```bash
# Now move
git mv scripts/<FILE>.js scripts/_legacy/<REASON>/<FILE>.js

# Verify post-move state
ls -la scripts/_legacy/<REASON>/<FILE>.js
```

### Step 7: Run cronMissing scanner (next audit cycle or manual)

The `cronMissing` scanner now covers OpenClaw daemon crons (as of 2026-06-21). It will flag any drift at the next 04:30 audit. To run immediately:

```bash
node scripts/audit_daily_cron.js --no-discord --no-dedup
# Or just the missing-cron check:
node -e "
const { runSystemAudit } = require('./scripts/lib/rules/system-audit');
const r = runSystemAudit({ scriptsDir: './scripts' });
console.log('Missing scripts referenced by crons:', r.cronMissing.length);
console.log(JSON.stringify(r.cronMissing, null, 2));
"
```

---

## Quick checklist (TL;DR)

```
[ ] Step 1: openclaw cron list | grep <FILE>           → disable if found
[ ] Step 2: grep SKILL.md | grep <FILE>                → quarantine if found
[ ] Step 3: grep *.md (excl _legacy, skills-learned)   → update if found
[ ] Step 4: grep require/from | grep <FILE>             → update importers if found
[ ] Step 5: combined verify (should be empty)
[ ] Step 6: git mv + ls verify
[ ] Step 7: run cronMissing scanner post-move
```

If any step finds a reference, **STOP** and decide before moving.

---

## Bulk migration (M5-style batch)

When moving 3+ scripts in one milestone (e.g., M5 2026-06-20 moved 4 + 1 lib file):

```bash
# Loop over each file in the batch
for FILE in anomaly_monitor.js anomaly_proactive_push.js cron_health_triage.js pattern_proactive_trigger.js baseline_store.js; do
  echo "=== Migrating: $FILE ==="
  # Inline the 5-step SOP (substitute <FILE> with $FILE)
  openclaw cron list --json 2>/dev/null \
    | jq -r --arg f "$FILE" '.[] | select(.enabled == true) | select((.payload.argv // []) | any(. == "*" + $f)) | .id' \
    | xargs -I {} openclaw cron disable {}
  grep -rln "$FILE" skills-learned/ --include="SKILL.md" | grep -v "_archive/" \
    | xargs -I {} bash -c 'F="{}"; Q="skills-learned/_archive/quarantine-$(date +%s%N)-$(basename $(dirname $F))/"; mkdir -p "$Q"; mv "$F/SKILL.md" "$Q"; sed -i "s/^status:.*/status: quarantined/" "$Q/SKILL.md"'
  git mv "scripts/$FILE" "scripts/_legacy/m5-dormant-$(date +%Y-%m-%d)/"
done

# Verify post-move
git status
node scripts/audit_daily_cron.js --no-discord --no-dedup 2>&1 | grep -A 5 "cronMissing"
```

---

## Related

- **#176** — Anomaly Monitor incident (the bug this SOP prevents)
- **#169** — Loop Engineering WP3 (failureAlert — automated alert when cron fails, complements this manual SOP)
- **`scripts/lib/rules/system-audit.js`** — `cronMissing` scanner (now also covers OpenClaw daemon crons)

---

## Versioning

- **v1.0** (2026-06-21) — Initial SOP. Triggered by #176 fix.
- Future: add hooks to Loop Engineering milestone template.
