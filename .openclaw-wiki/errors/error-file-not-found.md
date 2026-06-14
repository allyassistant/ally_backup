# Error Pattern: File Not Found

> Auto-generated from errors.json
> Type ID: `file-not-found`
> Updated: 2026-04-25, 00:41:05

## Summary

| Metric | Value |
|--------|-------|
| Total Occurrences | 67 |
| Unique Instances | 4 |
| Severity Level | 3/5 |
| Confidence | 0.95 |

## Claims

- [claim::error-file-not-found] File Not Found is a recurring error pattern
  - status: supported
  - confidence: 0.95
  - freshness: fresh
  - tags: [error, pattern, file-not-found]
  - evidence:
    - source: memory/errors.json
      quote: "File not found (ENOENT)"
      timestamp: 2026-04-07T16:03:24.628Z
      severity: 3
    - source: memory/errors.json
      quote: "File not found (ENOENT)"
      timestamp: 2026-04-06T17:18:00.177Z
      severity: 3
    - source: memory/errors.json
      quote: "File not found (ENOENT)"
      timestamp: 2026-04-04T17:07:26.902Z
      severity: 3


## Recent Occurrences

| Date | Problem | Count | Status |
|------|---------|-------|--------|
| 2026-04-08 | File not found (ENOENT)... | 9 | ❌ |
| 2026-04-07 | File not found (ENOENT)... | 43 | ❌ |
| 2026-04-05 | File not found (ENOENT)... | 3 | ❌ |
| 2026-04-04 | File not found (ENOENT)... | 12 | ❌ |


## Prevention

- Monitor logs for "File Not Found" patterns
- Set up alerts when count exceeds threshold
- Review related issues for context

## Related

- [All Error Patterns](./error-patterns.md)
- [System Health](../system/health.md)
