# Obsidian Note Format for X Link Analysis

## Reference: Obsidian Note Structure

When analyzing an X.com link, each note saved to the Obsidian vault follows this structure:

```markdown
---
title: "[Author] - [Topic Summary]"
category: "AI|Tech|Concept|Business"
type: "reference"
tags: [topic-tag, purpose-tag]
links: "[[Related Note 1]],[[Related Note 2]]"
source: "X post by @username"
---

[Author] - [Topic Summary]

## Summary

1-2 sentence overview of the thread/post content.

## Key Points

- Point 1 with technical details
- Point 2 with supporting evidence
- Point 3 with implications

## Technical Details

Deep dive into any tools, frameworks, or methodologies mentioned.

## Insights

Personal takeaways and how this relates to ongoing work.

## Cross-links

- [[Related Concept]]
- [[Parallel Project]]
```

## Usage

This file is loaded by the x-link-analysis SKILL.md workflow when writing structured notes. The `write_to_obsidian.js` script accepts piped markdown content in this exact format.

## Validation

Before writing, validate:
- [ ] Title: `[Author] - [Topic]`
- [ ] Category: one of AI, Tech, Concept, Business
- [ ] Tags: at least 1 topic + 1 purpose
- [ ] Links: 3-5 cross-links to existing vault notes
- [ ] Insights: `## 啟發` section present
