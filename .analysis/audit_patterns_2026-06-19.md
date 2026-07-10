# Audit Patterns — 2026-06-19 (Layer 4 v0)

> Window: 7 days · Threshold: 3 occurrences
> Total issues: 77 · Unique rules: 3

## Recurring Patterns (≥ threshold)

| Rule | Occurrences | Days | Files | Wrapper |
|------|-------------|------|-------|---------|
| `fsSync_missing_trycatch` | 55 | 1 | 21 | ✓ |
| `magic_numbers` | 20 | 1 | 14 | — |

## Suggested Actions

### fsSync_missing_trycatch
- **55 occurrences** across 1 days
- **21 unique files** affected
- **Suggested wrapper**: `scripts/lib/safe_fsSync_missing_trycatch.js`
- Run with `--generate` flag to write wrapper template.

### magic_numbers
- **20 occurrences** — no wrapper template yet, consider manual fix.
