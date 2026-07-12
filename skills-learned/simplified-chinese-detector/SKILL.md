---
name: simplified-chinese-detector
description: Detect simplified Chinese glyphs in source files, replace with traditional equivalents, and integrate findings into the audit scanner to prevent regressions.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-11T21:31:01.241Z
---

## Workflow

1. **Scan for simplified characters** using `grep -rn --include="*.js" --include="*.md" --include="*.sh" '[' '\u4e00-\u9fff]' ~/.openclaw/workspace/` or equivalent, targeting CJK Unified Ideographs block. Pipe through `iconv -f utf8 -t utf8//IGNORE` to avoid encoding noise.

2. **Isolate file and line** for each match. For each hit, record: file path, line number, the matched string, and the surrounding 40-character context. Group results by file to avoid re-scanning.

3. **Map each simplified character to its traditional equivalent**. Common mappings (compile a lookup table):
   - 学 → 學, 开 → 開, 网 → 網, 代码 → 代碼, 测试 → 測試
   - 开发 → 開發, 脚本 → 腳本, 错误 → 錯誤, 文件 → 文件
   - 时间 → 時間, 功能 → 功能, 问题 → 問題, 处理 → 處理

4. **Apply the replacement** by file type:
   - **Comments/docstrings**: safe to replace — update the glyph directly.
   - **String literals (error messages, logs)**: replace if visible to user; preserve if machine-parseable.
   - **Code identifiers (variable names, function names)**: **do not replace** — breaking change. Flag for manual review instead.
   - Use `sed -i '' 's/学/學/g'` for safe in-place replacement, or a node script for precise line-level edits that preserve surrounding context.

5. **Verify the fix** by re-running the same grep command and confirming zero matches. If any remain, repeat step 4 for the remaining instances.

6. **Register the rule in the audit scanner** — add `simplified-chinese` as a named rule in `scripts/audit_scanner.js` (or equivalent) so future cron runs automatically detect regressions. The rule should fire on any file matching `--include` patterns that contains simplified-only glyphs.

7. **Cross-reference with test files** — `scripts/test_dry_run_validation.js` and `scripts/test_phase3_semantic_equivalence.js` are known emitters (per audit data). Audit these files specifically and fix or exclude them from future scans if they contain intentional simplified characters.

## Pitfalls

- ⚠️ Replacing simplified Chinese in code identifiers — variable names like `开发展开` are intentionally simplified; replacing them with traditional creates a breaking change. Always check whether the glyph appears in a code token or a string literal before replacing.

- ⚠️ Accidental encoding corruption during sed replacement — if the file uses a non-UTF8 encoding, `sed` can silently corrupt multi-byte Chinese characters. Always verify with `file <path>` and `iconv -f utf8 -t utf8 <path>` before editing.

- ⚠️ Over-matching with broad grep patterns — a naive `[学开网]` class catches characters in unintended contexts (e.g., URLs, base64). Narrow the search to `--include="*.js"` / `--include="*.md"` / `--include="*.sh"` and exclude `node_modules/` and binary files.

- ⚠️ Forgetting to update the audit scanner rule — fixing existing files only solves the current incident. Without registering the rule in `audit_scanner.js`, the pattern will recur on the next `git add`. Ensure step 6 runs every time.

- ⚠️ Traditional characters that visually resemble simplified — some glyphs (e.g., 網 vs 网) are visually similar. When auditing, use a character-by-character diff tool (`diff <(echo "$traditional") <(echo "$simplified")`) rather than eyeballing to confirm the replacement is correct.

## References

See `skills-learned/code-quality-proactive-scan/SKILL.md` for the parent audit scanner workflow this rule integrates into.

---
