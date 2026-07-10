```skills-learned/systemevent-cron-dedup-gotcha/SKILL.md
---
name: systemevent-cron-dedup-gotcha
description: 診斷並避免 OpenClaw systemEvent cron job 因 dedup 機制而 Silent drop 問題
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T11:03:04.930Z
---

## Context

OpenClaw cron jobs can run in two modes:
- **`agentTurn`** — isolated LLM session, script execution, full delivery
- **`systemEvent`** — injects text into main session as context, LLM decides whether to act

Skill Reviewer (`56e09616-50a3-45c2-89eb-d8c427c56191`) uses `agentTurn` and works correctly (~177s). A migration to `systemEvent` was attempted but failed silently.

## The Gotcha: Deduplication Kills Subsequent Runs

**Source:** `system-events-BMZOXQOE.js` line 53-67

```js
enqueueSystemEvent(text, {
    contextKey: `cron:${jobId}`  // ← contextKey is STATIC, based on jobId
})
