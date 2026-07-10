---
name: state-file-contract
description: Contract for state file lastTopics arrays — valid entries, corruption patterns, and remediation.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-15T04:31:01.241Z
---

# State File Contract — `lastTopics[]` Array

## Schema

```json
{
  "lastTopics": ["<topic-string>", ...],
  "lastRun": "<ISO timestamp>",
  "date": "<YYYY-MM-DD>"
}
```

## Valid Entry Rules

| Rule | Description |
|------|-------------|
| Length | < 100 characters per entry |
| Shape | Concise topic string — noun phrase or short sentence fragment |
| Language | Matches the conversation language (Cantonese/English/Mixed) |
| Content | Factual, specific, non-judgmental |

## Valid Examples
