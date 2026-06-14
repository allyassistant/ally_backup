# Error Pattern: API Aborted

> Auto-generated from errors.json
> Type ID: `api-aborted`
> Updated: 2026-06-11, 00:45:44

## Summary

| Metric | Value |
|--------|-------|
| Total Occurrences | 2 |
| Unique Instances | 1 |
| Severity Level | 3/5 |
| Confidence | 0.65 |

## Claims

- [claim::error-api-aborted] API Aborted is a recurring error pattern
  - status: supported
  - confidence: 0.65
  - freshness: fresh
  - tags: [error, pattern, api-aborted]
  - evidence:
    - source: memory/errors.json
      quote: "Request aborted"
      timestamp: 2026-06-08T21:01:02.146Z
      severity: 3


## Recent Occurrences

| Date | Problem | Count | Status |
|------|---------|-------|--------|
| 2026-06-09 | Request aborted... | 2 | ❌ |


## Prevention

- Monitor logs for "API Aborted" patterns
- Set up alerts when count exceeds threshold
- Review related issues for context

## Related

- [All Error Patterns](./error-patterns.md)
- [System Health](../system/health.md)
