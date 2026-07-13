---
name: rapaport-email-summary
description: Extract Rapaport diamond price index trends from email and generate Cantonese summary. Use when Rapaport weekly price list email arrives and user wants market highlights distilled into 2-3 concise sentences.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-01T00:00:00.000Z
---

## Workflow

1. **Verify email content** — Read the email body. Confirm it contains Rapaport price data (look for "RAPI", price percentages, carat categories, or market terminology).

2. **Extract key trends** — Identify price movements: up ticks (↑), down ticks (↓), and flat/unchanged categories. Note any significant moves (>1%) or notable patterns.

3. **Summarize in Cantonese** — Write 2–3 sentences in Cantonese summarizing the week's market direction. Use 冇/係/唔/靚. Keep under 100 words.

4. **Empty body fallback** — If no price data found, respond: 「今期 Rapaport 報告內容為空，請稍後再試。」

## Pitfalls

- ⚠️ Summarizing non-Rapaport emails — only apply this skill when the email is from Doron Paz/dndiamonds.com with diamond price data.
- ⚠️ Including HEARTBEAT_OK noise — always strip system keepalive messages before analysis.
- ⚠️ Using Mandarin phrasing — maintain Cantonese output with proper particles and vocabulary.
