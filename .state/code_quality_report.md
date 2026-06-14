# Code Quality Report

Generated: 2026-06-14, 10:00:11

## Summary

- **Total Issues**: 34
- **Critical**: 0 🔴
- **High**: 11 🟠
- **Medium**: 0 🟡
- **Low**: 23 🟢
- **Auto-fixable**: 0

## Issues

### ⚠️ High Priority Issues (11)

- **scripts/skill_reviewer_bot.js:37**
  - Rule: `fsSync_missing_trycatch`
  - fs.*Sync function found without try-catch protection

- **tests/test_umbrella_consolidation.js:218**
  - Rule: `fsSync_missing_trycatch`
  - fs.*Sync function found without try-catch protection

- **tests/test_umbrella_consolidation.js:306**
  - Rule: `fsSync_missing_trycatch`
  - fs.*Sync function found without try-catch protection

- **tests/test_umbrella_consolidation.js:312**
  - Rule: `fsSync_missing_trycatch`
  - fs.*Sync function found without try-catch protection

- **tests/test_umbrella_consolidation.js:324**
  - Rule: `fsSync_missing_trycatch`
  - fs.*Sync function found without try-catch protection

- **tmp_d_search.js:2**
  - Rule: `fsSync_missing_trycatch`
  - fs.*Sync function found without try-catch protection

- **tmp_rapaport.js:7**
  - Rule: `fsSync_missing_trycatch`
  - fs.*Sync function found without try-catch protection

- **tmp_search.js:2**
  - Rule: `fsSync_missing_trycatch`
  - fs.*Sync function found without try-catch protection

- **tmp_search2.js:2**
  - Rule: `fsSync_missing_trycatch`
  - fs.*Sync function found without try-catch protection

- **tmp_search3.js:2**
  - Rule: `fsSync_missing_trycatch`
  - fs.*Sync function found without try-catch protection

*... and 1 more*

### ℹ️ Low Priority Issues (23)

- **scripts/ai_hot_push.js:252**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 9999. Should be named constant.

- **scripts/anomaly_proactive_push.js:157**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 3600. Should be named constant.

- **scripts/cron_health_triage.js:209**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 3600000. Should be named constant.

- **scripts/cron_health_triage.js:216**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 3600. Should be named constant.

- **scripts/cross_session_bootstrap.js:737**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 20480. Should be named constant.

- **scripts/error_auto_issue.js:189**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 3600. Should be named constant.

- **scripts/memory_generator.js:66**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 1440. Should be named constant.

- **scripts/memory_generator.js:67**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 1440. Should be named constant.

- **scripts/skill_matcher_metrics.js:59**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 86400000. Should be named constant.

- **scripts/skill_matcher_metrics.js:64**
  - Rule: `magic_numbers`
  - Hardcoded magic number: 86400000. Should be named constant.

*... and 13 more*

