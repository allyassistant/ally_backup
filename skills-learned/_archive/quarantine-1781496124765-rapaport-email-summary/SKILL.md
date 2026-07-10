---
name: rapaport-email-summary
description: Extract Rapaport diamond price index trends from email and generate Cantonese summary. Triggered when Rapaport weekly price list email arrives and user wants market highlights distilled into 2-3 concise sentences.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-15T04:15:00.000Z
---

## Workflow

1. **Identify the email type** — confirm it is a Rapaport Price List® email (寄件人包含 `rapaportpricelist@rapaport.com` 或標題包含 `Rapaport Price List`)。若不是，直接回覆用戶告知無法處理。

2. **Locate the market data block** — scan email body for these patterns:
   - `RAPI:` 或 `May RAPI:` followed by carat/percentage pairs
   - `0.30 ct.` / `0.50 ct.` / `1 ct.` / `3 ct.` with +/-% values
   - Industry news sentences mentioning Las Vegas, inventory, price correction

3. **Parse RAPI numbers** — extract all carat/percentage pairs. Format: `<size> ct. <%+-><value>%`

4. **Identify key trend** — classify each size:
   - Positive (`+`): 0.30ct, 0.50ct 通常是小鑽石
   - Negative (`-`): 1ct, 3ct 通常是大鑽石或中高價位
   - "no changes" 意味着橫行

5. **Compose Cantonese summary** — apply these hard constraints:
   - Length: 2-3 sentences, under 100 characters total
   - Language: 繁體廣東話，口語化
   - Include the most impactful RAPI figures (pick top positive + top negative)
   - Mention "no changes" only if explicitly stated
   - Add one line of industry context if present

   **Example output pattern:**
