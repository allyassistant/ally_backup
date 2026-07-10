---
id: 134
title: Weekly Correction Loop: monitor skill curation + integration (2 weeks)
status: archive
priority: P2
created: 2026-06-06
due: 2026-06-20
updated: 2026-06-22
progress: 0/0
---

## Description

**Background：** Integrated Skill Curation (Hermes-inspired Curator) into the existing `weekly_correction_loop.js` as Phase 1b, plus cleaned up unused skills from `workspace/skills/`.

### Changes made

**`workspace/scripts/weekly_correction_loop.js`** — Added Phase 1b: Skill Curation
- Scans `workspace/skills-learned/` for auto-generated skills
- Promotes drafts to active when `patternRepeats >= 3 && age > 1 day`
- Creates symlink in `workspace/skills/` (`_learned_<name>.md`) for promoted skills
- Archives stale active skills (>14 days without modification) to `_archive/`
- Removes symlinks on archive
- Reports skill stats in weekly Discord notification

**`workspace/skills/` cleanup**
- Archived 11 `.bak` files → `skills/_archive/`
- Archived 9 unused `.js` stub skills (no matching scripts) → `skills/_archive/`

### Monitoring (until Jun 20)
```bash
# Check curation results after Sunday run
cat /Users/ally/.openclaw/workspace/memory/correction_suggestions.json | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('skillStats','N/A'))" 2>/dev/null

# Check symlinks created in skills/
ls -la /Users/ally/.openclaw/workspace/skills/_learned_* 2>/dev/null

# Check archived skills
ls /Users/ally/.openclaw/workspace/skills/_archive/ | wc -l

# Check correction loop ran successfully
grep "Skill Curation" /Users/ally/.openclaw/logs/*.log 2>/dev/null | tail -5
```

### Expected outcomes
- Sunday 03:00 HKT cron runs Phase 1b automatically
- Qualified drafts are promoted + symlinked
- Stale skills are archived
- Discord report includes skill stats
- No errors in the correction loop

### If issues arise
1. Promotion not happening → check `patternRepeats >= 3 && daysSinceGen > 1` condition
2. Symlinks not working → check `SKILLS_ACTIVE` path and filesystem permissions
3. Archive too aggressive → increase `STALE_DAYS` (currently 14)
4. Script crash → check `node --check weekly_correction_loop.js`
