---
name: simplified-chinese-detector
description: Detect simplified Chinese glyphs in source files, replace with traditional equivalents, and integrate findings into the audit scanner.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-16T00:00:00.000Z
---

## Workflow

1. **Scan target file for simplified-only glyphs.**
   Run a regex scan targeting the common simplified character set. The most reliable pattern targets character ranges and known simplified-only glyphs:

   ```javascript
   // Scan pattern — simplified-only glyphs (not shared with traditional)
   const SIMPLIFIED_ONLY = /[儿两顾压厂广发点干于亏亡才门飞马丑专专业业东丝丢两严丧个临丸丹为主丽举么义之乌乐乔习乡书买乱亩弯临为临为丽举么义之/;
   ```

   Or use the audit scanner hook if `audit_scanner.js` is integrated:
   ```bash
   node scripts/audit_scanner.js --rule=simplified-chinese scripts/test_dry_run_validation.js
   ```

2. **List all detected simplified glyphs with line:col evidence.**
   For each hit, record the exact location before touching anything:
   ```bash
   grep -n --color='auto' -P '[儿两顾压厂广发点干于亏亡才门飞马丑专]' scripts/test_dry_run_validation.js
   ```
   This gives `filename:line:col` evidence needed for the fix report.

3. **Apply targeted replacement — never bulk-replace shared characters.**
   Traditional Chinese and Simplified Chinese share many glyphs (e.g., 發/发, 雲/云). Only replace characters confirmed as **simplified-only**. The safe replacement map:
   ```javascript
   const REPLACEMENT_MAP = {
     '儿': '兒', '两': '兩', '顾': '顧', '压': '壓', '厂': '廠',
     '广': '廣', '发': '發', '点': '點', '干': '乾', '于': '於',
     '亏': '虧', '亡': '亾', '才': '緕', '门': '門', '飞': '飛',
     '马': '馬', '丑': '醜', '专': '專', '业': '業', '东': '東',
     '丝': '絲', '丢': '丟', '严': '嚴', '丧': '喪', '个': '個',
     '临': '臨', '丸': '丸', '丹': '丹', '为': '為', '丽': '麗',
     '举': '舉', '么': '麼', '义': '義', '之': '之', '乌': '烏',
     '乐': '樂', '乔': '喬', '习': '習', '乡': '鄉', '书': '書',
     '买': '買', '乱': '亂', '亩': '畝', '弯': '彎',
   };
   ```
   Apply via `sed` with confirmation flag:
   ```bash
   sed -i 's/儿/兒/g; s/两/兩/g; s/发/發/g; s/门/門/g; s/马/馬/g' scripts/test_dry_run_validation.js
   ```

4. **Verify replacement with grep after edit.**
   ```bash
   grep -c '儿\|两\|发\|门\|马' scripts/test_dry_run_validation.js
   # Should return 0 after clean fix
   ```

5. **Run the file's own test suite to confirm no regression.**
   ```bash
   node scripts/test_dry_run_validation.js 2>&1 | tail -5
   # If tests pass → commit with descriptive message:
   git add -A && git commit -m "fix: 簡體→繁體 glyph replacement in $(basename $FILE)"
   ```

## Preconditions

This rule should trigger **only** when:
- File extension is `.js`, `.md`, `.sh`, or `.ts`
- File is in `scripts/` or `skills-learned/` (not vendor/node_modules)
- File contains 2+ simplified-only glyphs (not single-char typos)
- The glyph is in user-facing text (comments, strings, messages) — not code identifiers

Do **not** trigger this rule for:
- Files with mixed traditional+simplified intentional content (e.g., legacy data dumps)
- Single-character typos in identifiers (treat as code bug, not language issue)
- Binary or minified files

## Pitfalls

- ⚠️ **Bulk-replacing shared glyphs corrupts valid traditional text** — `发` in traditional means 發展/發展, replacing it with `發` in a file that already uses `發` causes duplication or inconsistency. Only replace glyphs confirmed as simplified-only in context.
- ⚠️ **Missing the `厂`→`廠` class of substitutions** — Many simplified-only glyphs like `厂` (not a traditional character, traditional is `廠`) are easy to miss. Use the full replacement map, not a partial one.
- ⚠️ **sed in-place edit without backup** — `sed -i` modifies in place with no undo trail. Always `git add` first and verify with `git diff` before committing.
- ⚠️ **Triggering on auto-generated files** — Files in `node_modules/` or build output directories should be excluded from scan. Pattern-matched files like `dist/*.js` should be skipped.
- ⚠️ **Misidentifying intentional simplified characters in config** — Some config files intentionally use simplified Chinese for compatibility (e.g., locale settings). Do not replace without confirming the context supports traditional.
