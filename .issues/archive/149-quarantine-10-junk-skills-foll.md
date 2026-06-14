---
id: 149
title: Quarantine 10 現有 junk skills (follow-up to #146)
status: archive
priority: P1
created: 2026-06-10
due: 2026-06-13
updated: 2026-06-10
progress: 4/4
---

## Description

**問題：** 49 個 skills 之中 10 個係 junk（7 niche + 2 duplicate + 1 stub per M3 audit）。雖然 #146 嘅 fix 防止將來再產生 junk，但現有 10 個仍然喺度污染 search / matcher。

**10 個 junk skills（M3 audit 識別）：**
- 7 niche (very specific use case，唔 generalize)
- 2 duplicate (overlap 已有 skills)
- 1 stub (< 1500B)

**Action：** 搬去 `skills-learned/_archive/quarantine-2026-06-10/` 保留 reference 但移離 active list。

## Progress
- [ ] Step 1: Confirm 10 個 junk list 同 M3 audit 一致
- [ ] Step 2: Backup → 搬去 `_archive/quarantine-2026-06-10/<name>/`
- [ ] Step 3: 移除 `skills/_learned_<name>` symlinks
- [ ] Step 4: Verify `<available_skills>` system prompt 唔再 inject 呢 10 個

## Notes

- **Source:** `.spawn/reports/skill_reviewer_audit_2026-06-10.md` section "Junk Inventory"
- **Parent issue:** #146
- **Reversible:** 是 — 全部 preserve 喺 `_archive/`
