# Error Classification Matrix

## Purpose

Filter `memory/errors.json` output before opening P1 issues. Prevents the
noise-flood problem that caused `error_auto_issue.js` cron to be disabled.

---

## Classification Table

| Error Type | Count (sample) | Severity | Classification | Action | Auto-resolve Window |
|-----------|---------------|----------|----------------|--------|---------------------|
| Rate Limit | 26 | 2 | 🟢 **Noise** | Suppress; log only | 14 days |
| Timeout Error | 16 | 3 | 🟡 **Observe** | Watch for repetition | 14 days |
| Cron Timeout | 11 | 3 | 🟡 **Observe** | Check cron timeout config | 14 days |
| Auth Error | 9 | 1 | 🔴 **Real bug** | Open P1 issue | None |
| Cron Error | 9 | 3 | 🟡 **Observe** | Check cron health triage | 14 days |
| MiniMax Error | 8 | 3 | 🟡 **Observe** | Monitor for pattern | 14 days |
| API Aborted | 6 | 2 | 🟢 **Noise** | Suppress | 7 days |
| DNS Error | 4 | 2 | 🟢 **Noise** | Suppress if <3/day | 14 days |
| File Error | 3 | 3 | 🟡 **Observe** | Check disk/storage health | 14 days |
| Discord Error | 1 | 1 | 🔴 **Real bug** | Open P1 issue | None |
| Kimi Error | 1 | 1 | 🔴 **Real bug** | Open P1 issue | None |

---

## Decision Logic
