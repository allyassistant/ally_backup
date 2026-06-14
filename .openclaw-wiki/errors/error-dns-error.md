# Error Pattern: DNS Error

> Auto-generated from errors.json
> Type ID: `dns-error`
> Updated: 2026-06-11, 00:45:44

## Summary

| Metric | Value |
|--------|-------|
| Total Occurrences | 4 |
| Unique Instances | 4 |
| Severity Level | 3/5 |
| Confidence | 0.75 |

## Claims

- [claim::error-dns-error] DNS Error is a recurring error pattern
  - status: supported
  - confidence: 0.75
  - freshness: fresh
  - tags: [error, pattern, dns-error]
  - evidence:
    - source: memory/errors.json
      quote: "DNS lookup failed (ENOTFOUND)"
      timestamp: 2026-06-04T19:00:53.915Z
      severity: 3
    - source: memory/errors.json
      quote: "DNS lookup failed (ENOTFOUND)"
      timestamp: 2026-05-24T20:00:06.142Z
      severity: 3
    - source: memory/errors.json
      quote: "DNS lookup failed (ENOTFOUND)"
      timestamp: 2026-05-22T20:00:04.416Z
      severity: 3


## Recent Occurrences

| Date | Problem | Count | Status |
|------|---------|-------|--------|
| 2026-06-05 | DNS lookup failed (ENOTFOUND)... | 1 | ❌ |
| 2026-05-25 | DNS lookup failed (ENOTFOUND)... | 1 | ❌ |
| 2026-05-23 | DNS lookup failed (ENOTFOUND)... | 1 | ❌ |
| 2026-05-18 | DNS lookup failed (ENOTFOUND)... | 1 | ❌ |


## Prevention

- Monitor logs for "DNS Error" patterns
- Set up alerts when count exceeds threshold
- Review related issues for context

## Related

- [All Error Patterns](./error-patterns.md)
- [System Health](../system/health.md)
