---
id: 148
title: Historical Skill Symlink Audit (WARN-05 deferred from #146)
status: archive
priority: P3
created: 2026-06-10
due: 2026-06-30
updated: 2026-06-10
progress: 0/3
---

## Description

**問題：** M3 audit 發現 3 個 historical skill symlinks 係 relative path 而非 absolute path（`../skills-learned/...`）。OpenClaw 嘅 file traversal 接受呢啲 relative symlinks，但係：
- Cross-platform 唔 portable（Windows 同 Linux 解讀唔同）
- 將來 skill review 工具改用 absolute check 會 break
- Security 風險（理論上 attacker 可利用 relative path traverse）

**Why deferred from #146：** 3 個 symlinks 仍 working 唔郁，唔影響當前 system。但係需要 audit 確保冇其他 stale relative symlinks。

## Progress
- [ ] Step 1: Find all symlinks in `skills/` and check if relative
- [ ] Step 2: Replace with absolute paths (atomic)
- [ ] Step 3: Verify all symlinks resolve correctly

## Notes

- **Audit command:** `find ~/.openclaw/workspace/skills/ -type l -exec readlink {} \;`
- **Expected:** All should be absolute (or pointing within `skills-learned/`)
- **Parent issue:** #146
