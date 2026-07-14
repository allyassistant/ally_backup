---
name: simplified-chinese-detector
description: Detect simplified Chinese glyphs in source files, replace with traditional equivalents, and integrate findings into the audit scanner to prevent regressions.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-14T01:00:00.000Z
---

## Workflow

1. **Scan target files** — Run the audit scanner or use grep to find simplified-only glyphs in `.js`, `.md`, and `.sh` files. Common patterns include `开`, `发`, `错`, `数`, `据`, `请`, `请`, `为`.

2. **Identify the specific simplified glyphs** — Use a Unicode-aware detector to isolate characters that have traditional equivalents (e.g., `开→開`, `发→發`, `数→數`, `据→據`).

3. **Apply replacements conservatively** — Replace only the specific glyphs identified, preserving all other content. Do not run global find-replace that could break variable names or technical terms.

4. **Verify the fix** — Re-run the scanner on the same files to confirm no simplified glyphs remain, and check that the replacement did not introduce syntax errors.

5. **Integrate into the audit pipeline** — Add a pre-commit hook or integrate the detector into the weekly audit scanner to catch regressions automatically.

## Pitfalls

- ⚠️ **Over-replacing technical terms** — Some technical terms use simplified forms intentionally (e.g., API endpoint names). Verify context before replacing.

- ⚠️ **Breaking variable names or strings** — If a simplified glyph appears inside a quoted string that references a file path or API, replacing it may break the reference. Always check surrounding context.

- ⚠️ **Missing file types** — The scanner may miss `.json`, `.yaml`, or config files if not included in the scan target list. Ensure all relevant extensions are covered.

- ⚠️ **False negatives from mixed content** — Files with both simplified and traditional Chinese may have intentional simplified sections (comments in mainland codebases). Verify the intent before auto-replacing.

- ⚠️ **Not re-scanning after fixes** — Failing to verify the fix leaves the door open for the same simplified glyphs to reappear in future edits.

## References

- Top files where rule fires: `scripts/test_dry_run_validation.js`, `scripts/test_phase3_semantic_equivalence.js`
- Audit rule: `simplified-chinese` (12 occurrences in past 7 days)
- Unicode ranges: Simplified CJK (U+4E00-U+9FFF subset)
