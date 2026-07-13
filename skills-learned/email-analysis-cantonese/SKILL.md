---
name: email-analysis-cantonese
description: Verify email tool output and extract content before summarizing in Cantonese, with empty-body fallback and HEARTBEAT_OK noise filtering.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-13T14:31:01.241Z
---

## Workflow

1. **Receive email request** — user asks for Cantonese summary of an email, typically specifying length (2-3 sentences, ≤100 characters).

2. **Verify email tool output is valid** — check that the email content block is not null, undefined, or a plain `{}`. If the tool returned `null` or a structurally empty object, skip to step 5 immediately.

3. **Extract and clean content** — parse the email body. Remove any `HEARTBEAT_OK` noise signals, strip whitespace, and confirm the body is not empty (no content after "內容:" or equivalent header). If content is empty or noise-only, skip to step 5.

4. **Generate Cantonese summary** — produce 2-3 concise sentences (≤100 characters for strict limits) in traditional Cantonese, highlighting sender, subject, and key content points.

5. **Handle empty/no-content case** — if email body is empty, missing, or contains only noise, respond with a standard acknowledgment in Cantonese (e.g.,「暫時無email內容，稍後再試。」) and **stop** — do not loop or retry the email tool.

## Pitfalls

- ⚠️ **Responding to heartbeat noise as email content** — if `HEARTBEAT_OK` appears in the email body field, the assistant may treat it as the actual email content and summarize "HEARTBEAT_OK" instead of the real message. Always filter HEARTBEAT_OK before attempting to summarize.
- ⚠️ **Assuming email tool always returns content** — the email tool may return an empty body (null, {}, or whitespace-only) even when the call succeeded. Checking `if (!body || body.trim() === '')` before summarizing is mandatory.
- ⚠️ **Getting trapped in a heartbeat response loop** — if HEARTBEAT_OK keeps appearing, the assistant may keep responding with `HEARTBEAT_OK` instead of checking the email body. The emptiness check in step 2 breaks this loop.
- ⚠️ **Exceeding character limit in Cantonese summary** — Cantonese characters can be multi-byte; enforce the ≤100 character count strictly. If the user specified a limit, check it before responding.
- ⚠️ **Forgetting to filter HTML from email body** — some email tools return HTML. If the body contains `<` tags, strip HTML before summarizing to avoid garbled output.
