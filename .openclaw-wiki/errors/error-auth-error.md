# Error Pattern: Auth Error

> Auto-generated from errors.json
> Type ID: `auth-error`
> Updated: 2026-06-11, 00:45:44

## Summary

| Metric | Value |
|--------|-------|
| Total Occurrences | 6 |
| Unique Instances | 4 |
| Severity Level | 1/5 |
| Confidence | 0.85 |

## Claims

- [claim::error-auth-error] Auth Error is a recurring error pattern
  - status: supported
  - confidence: 0.85
  - freshness: fresh
  - tags: [error, pattern, auth-error]
  - evidence:
    - source: memory/errors.json
      quote: "Invalid API key"
      timestamp: 2026-06-08T21:01:02.151Z
      severity: 1
    - source: memory/errors.json
      quote: "401 Authentication failed"
      timestamp: 2026-06-08T21:01:02.150Z
      severity: 1
    - source: memory/errors.json
      quote: "Invalid API key"
      timestamp: 2026-06-04T19:00:53.916Z
      severity: 1


## Recent Occurrences

| Date | Problem | Count | Status |
|------|---------|-------|--------|
| 2026-06-09 | Invalid API key... | 2 | ❌ |
| 2026-06-09 | 401 Authentication failed... | 2 | ❌ |
| 2026-06-05 | Invalid API key... | 1 | ❌ |
| 2026-06-03 | Invalid API key... | 1 | ❌ |


## Prevention

- Monitor logs for "Auth Error" patterns
- Set up alerts when count exceeds threshold
- Review related issues for context

## Related

- [All Error Patterns](./error-patterns.md)
- [System Health](../system/health.md)
