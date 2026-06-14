# Error Pattern: Manual

> Auto-generated from errors.json
> Type ID: `manual`
> Updated: 2026-06-11, 00:45:44

## Summary

| Metric | Value |
|--------|-------|
| Total Occurrences | 1 |
| Unique Instances | 1 |
| Severity Level | 2/5 |
| Confidence | 0.65 |

## Claims

- [claim::error-manual] Manual is a recurring error pattern
  - status: supported
  - confidence: 0.65
  - freshness: fresh
  - tags: [error, pattern, manual]
  - evidence:
    - source: memory/errors.json
      quote: "記住上次merge_stock.js崩潰係因為OOM"
      timestamp: 2026-04-17T08:29:14.184Z
      severity: 2


## Recent Occurrences

| Date | Problem | Count | Status |
|------|---------|-------|--------|
| 2026-04-17 | 記住上次merge_stock.js崩潰係因為OOM... | 1 | ❌ |


## Prevention

- Monitor logs for "Manual" patterns
- Set up alerts when count exceeds threshold
- Review related issues for context

## Related

- [All Error Patterns](./error-patterns.md)
- [System Health](../system/health.md)
