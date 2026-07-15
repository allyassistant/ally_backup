---
name: email-analysis-cantonese
description: 分析電郵時過濾空body與噪音，檢查附件後用繁體中文總結要點，沒有內容時直接告知用戶。
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-15T04:00:00Z
---

## Workflow

1. **Pre-filter HEARTBEAT_OK contamination**
   When the email body is exactly `HEARTBEAT_OK` or contains only that token with no other text, treat it as a system ping that leaked through the `aliveness-noise-reduction` layer. Return a minimal acknowledgment and stop — do not invoke the LLM.
   ```javascript
   const isPureHeartbeat = /^\s*HEARTBEAT_OK\s*$/i.test(body.trim());
   if (isPureHeartbeat) {
     return '✅'; // heartbeat already acknowledged upstream
   }
   ```

2. **Guard against noise-filter leakage**
   If the body contains `HEARTBEAT_OK` **AND** other content (subject line, body text, attachment note), the email is legitimate — process it. The presence of `HEARTBEAT_OK` alone in a larger email body is harmless noise from cross-session state; strip it before analysis.
   ```javascript
   const strippedBody = body.replace(/HEARTBEAT_OK/gi, '').trim();
   if (!strippedBody && subject && subject.length > 0) {
     // body was only HEARTBEAT_OK but subject has content — treat as valid
   }
   ```

3. **Extract email metadata**
   Read `subject`, `sender`, and `body` fields from the incoming payload. Log sender domain for Cantonese name lookup. If subject or body is empty after stripping, fall back to attachment-only analysis.

4. **Handle empty body with attachment**
   If body is empty after HEARTBEAT_OK stripping but an attachment is present, acknowledge the attachment and note its filename/type. Do not claim the email is empty if an attachment exists.

5. **Summarize in Cantonese (繁體)**
   Invoke the LLM with a terse prompt: extract 2–3 key points, market-relevant signals, or action items. Limit output to ~100 characters. Format as plain Cantonese sentences, no bullet points unless the user explicitly requests structure.
