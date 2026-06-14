# Code Quality Report

Generated: 2026-04-06T08:07:15.738Z

## Summary

- **Total Issues**: 458
- **Critical**: 0 🔴
- **High**: 28 🟠
- **Medium**: 0 🟡
- **Low**: 430 🟢
- **Auto-fixable**: 0

## Issues

### HIGH (28)

- **_legacy/scripts/test_whatsapp.js:6**
  - Rule: `execSync_missing_trycatch`
  - execSync or execFileSync found without try-catch protection

- **scripts/__tests__/auto_fix/test_runner.js:12**
  - Rule: `execSync_missing_trycatch`
  - execSync or execFileSync found without try-catch protection

- **scripts/apple_reminders_calendar.js:14**
  - Rule: `execSync_missing_trycatch`
  - execSync or execFileSync found without try-catch protection

- **scripts/autoops/health_monitor.js:12**
  - Rule: `execSync_missing_trycatch`
  - execSync or execFileSync found without try-catch protection

- **scripts/autoops/token_monitor.js:12**
  - Rule: `execSync_missing_trycatch`
  - execSync or execFileSync found without try-catch protection

- **scripts/kimi_cli_runner.js:156**
  - Rule: `execSync_missing_trycatch`
  - execSync or execFileSync found without try-catch protection

- **scripts/lib/rules/system-audit.js:32**
  - Rule: `execSync_missing_trycatch`
  - execSync or execFileSync found without try-catch protection

- **scripts/log_to_daily_memory.js:153**
  - Rule: `execSync_missing_trycatch`
  - execSync or execFileSync found without try-catch protection

- **scripts/memory_maintenance.js:9**
  - Rule: `execSync_missing_trycatch`
  - execSync or execFileSync found without try-catch protection

- **scripts/pattern_analysis_daily.js:11**
  - Rule: `execSync_missing_trycatch`
  - execSync or execFileSync found without try-catch protection

*... and 18 more*

### LOW (430)

- **_legacy/scripts/extract_4ct_price.js:21**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 73067059554046536028016011554222. Should be named constant.

- **_legacy/scripts/extract_all_ranges.js:117**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 9999. Should be named constant.

- **_legacy/scripts/extract_all_ranges_v2.js:24**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 9999. Should be named constant.

- **_legacy/scripts/extract_all_ranges_v2.js:26**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 9999. Should be named constant.

- **_legacy/scripts/extract_all_ranges_v3.js:29**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 9999. Should be named constant.

- **_legacy/scripts/extract_all_ranges_v3.js:30**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 9999. Should be named constant.

- **_legacy/scripts/extract_all_ranges_v3.js:45**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 9999. Should be named constant.

- **_legacy/scripts/extract_all_ranges_v3.js:74**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 9999. Should be named constant.

- **_legacy/scripts/extract_all_tables.js:26**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 9999. Should be named constant.

- **_legacy/scripts/extract_final.js:24**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 1320. Should be named constant.

*... and 420 more*

