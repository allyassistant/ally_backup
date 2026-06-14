# Error Pattern: Rate Limit

> Auto-generated from errors.json
> Type ID: `rate-limit`
> Updated: 2026-06-11, 00:45:44

## Summary

| Metric | Value |
|--------|-------|
| Total Occurrences | 22 |
| Unique Instances | 16 |
| Severity Level | 2/5 |
| Confidence | 0.95 |

## Claims

- [claim::error-rate-limit] Rate Limit is a recurring error pattern
  - status: contested
  - confidence: 0.95
  - freshness: fresh
  - tags: [error, pattern, rate-limit]
  - evidence:
    - source: memory/errors.json
      quote: "Rate limit exceeded"
      timestamp: 2026-06-08T21:01:02.149Z
      severity: 2
    - source: memory/errors.json
      quote: "429 Too Many Requests"
      timestamp: 2026-06-08T21:01:02.147Z
      severity: 2
    - source: memory/errors.json
      quote: "429 Too Many Requests"
      timestamp: 2026-06-04T19:00:53.913Z
      severity: 2


## Recent Occurrences

| Date | Problem | Count | Status |
|------|---------|-------|--------|
| 2026-06-09 | Rate limit exceeded... | 2 | ❌ |
| 2026-06-09 | 429 Too Many Requests... | 2 | ❌ |
| 2026-06-05 | 429 Too Many Requests... | 1 | ❌ |
| 2026-06-05 | Rate limit exceeded... | 1 | ❌ |
| 2026-06-03 | 429 Too Many Requests... | 1 | ❌ |
| 2026-06-03 | Rate limit exceeded... | 1 | ❌ |
| 2026-06-02 | 429 Too Many Requests... | 1 | ❌ |
| 2026-06-02 | Rate limit exceeded... | 1 | ❌ |
| 2026-06-01 | 429 Too Many Requests... | 2 | ❌ |
| 2026-06-01 | Rate limit exceeded... | 2 | ❌ |


## Prevention

- Monitor logs for "Rate Limit" patterns
- Set up alerts when count exceeds threshold
- Review related issues for context

## Related

- [All Error Patterns](./error-patterns.md)
- [System Health](../system/health.md)
