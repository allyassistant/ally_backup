---
name: simplified-chinese-detector
description: Replace simplified Chinese characters in source files with traditional equivalents, with manual review for false positives like bilingual terms.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-24T11:31:01.285Z
---

## Workflow

1. **Run the audit scanner in audit mode**
   Use the audit scanner with the `simplified-chinese` rule against the target file or directory. The scanner strips comments first to avoid flagging character usage in documentation strings.

   ```bash
   # Note: audit_scanner.js archived 2026-06-20. Replacement: unified code_quality_manager
   # (rules integrated into lib/rules/low-risk.js; 'simplified-chinese' rule still active).
   # --dir requires a directory (single-file mode no longer supported):
   node scripts/code_quality_manager.js scan --dir scripts --no-system-check --quiet
   ```

2. **Review flagged hits manually**
   Not every simplified character is an error. Distinguish:
   - **Real errors**: Traditional Chinese text with unintended simplified glyphs (e.g., 資訊 written as 信息)
   - **False positives**: Technical terms that are identical in both systems (e.g., network, API, HTTP, JSON, CSV, Unicode), mixed Traditional text with English quotes, or strings that are intentionally bilingual

3. **Apply Traditional replacements**
   Replace each flagged simplified character with its Traditional equivalent. Common substitutions:

   | Simplified | Traditional |
   |------------|-------------|
   | 信息 | 資訊 |
   | 网络 | 網絡 |
   | 软件 | 軟體 |
   | 数据 | 資料 |
   | 程序 | 程式 |
   | 服务器 | 伺服器 |
   | 计算机 | 電腦 |
   | 系统 | 系統 |
   | 输入/输出 | 輸入/輸出 |
   | 登录 | 登入 |

   Use an editor or `sed` for bulk replacements, then verify each change in context.

4. **Switch to verification mode for full scan**
   After manual fixes, run the scanner in verification mode to confirm no simplified characters remain in executable code. Verification mode uses AST-based analysis to avoid comment-related false positives.

5. **Check archived files too**
   The rule has fired on archived files (`scripts/archive/daily_summary.js`, `scripts/archive/error_recovery.js`, `scripts/test_auto_fix_audit_rule_map.js`). If these files are ever revived or used as reference templates, the simplified characters will spread back into active code. Apply fixes to archived files as well, or add a pre-commit hook to prevent regression.

6. **Re-scan adjacent files for consistency**
   If one archived file has simplified characters, its neighbors likely do too. Scan the entire `scripts/archive/` directory and batch-fix in one pass.

## Pitfalls

- ⚠️ **Technical terms identical in both systems** — "API", "HTTP", "JSON", "CSV", "Unicode" contain no Chinese characters and should never be flagged. Regex patterns that are too broad will match unrelated strings. Verify each hit is in actual Chinese text before replacing.

- ⚠️ **Mixed script content** — Code comments that contain a mix of English and Chinese may have simplified characters from a paste operation. The scanner's comment-stripping mode in audit mode helps, but string literals containing Chinese are still evaluated. Review string literals carefully.

- ⚠️ **Ambiguous characters that mean different things** — Some Unicode characters appear similar but are not simplified/traditional variants of each other (e.g., "后" in Traditional means "queen" but "后" in Simplified means "after"). Regex-based substitution without context awareness can introduce incorrect characters.

- ⚠️ **Archived files that serve as templates** — If `scripts/archive/error_recovery.js` is copied into a new script, the simplified characters propagate. Either fix the archived originals or add a linter step that rejects simplified characters in new files.

- ⚠️ **Audit mode comment-stripping is imperfect** — Block comments (`/* */`) and line comments (`//`) are stripped, but string literals (single/double quotes, template literals) are not. A character inside a string that is used for display purposes may be flagged as an error when it is intentional.
