---
name: rapaport-email-summary
description: Extract Rapaport diamond price index trends from email and generate Cantonese summary. Use when Rapaport weekly price list email arrives and user wants market highlights distilled into 2-3 concise sentences.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-14T23:31:01.230Z
---

## Workflow

1. **Identify the email type.** Confirm sender is `rapaportpricelist@rapaport.com` and subject contains "Rapaport Price List" — this triggers the extraction flow.

2. **Detect no-change signal.** Scan the opening paragraph for "no changes to the prices" or equivalent. If found, lead the summary with a one-sentence stability statement (e.g., 本週鑽石價格無變動).

3. **Extract RAPI data.** Look for the `May RAPI:` or `RAPI:` line. Parse the pattern `<size> <pct>%` for each carat tier. Format as Cantonese summary:
   - Positive: `<size>`上漲`<pct>`
   - Negative: `<size>`下跌`<pct>`
   - Example: 0.30克拉+2.1%、0.50克拉+0.9%、1克拉-0.3%、3克拉-0.5%

4. **Check for industry news.** Scan for `News:` or `Industry` paragraphs — mention Las Vegas shows, inventory corrections, or Botswana signals only if content is substantive (not boilerplate). Include only if it adds context beyond the RAPI data.

5. **Detect exclusive member content.** Flag if an exclusive interview or member-only link appears (e.g., "EXCLUSIVE Members-only access to..."). Mention it briefly only if it relates to market outlook.

6. **Compose final output.** Output exactly 2–3 sentences in 廣東話, ≤100 Chinese characters total. Structure:
   - Sentence 1: Price stability status
   - Sentence 2: Key RAPI highlights (biggest mover + notable counter-trend)
   - Sentence 3: (Optional) One-sentence industry context if material

7. **Verify character count.** Count Chinese characters — enforce ≤100. Trim adjectives and redundant qualifiers to stay within limit.

## Pitfalls

- ⚠️ Counting bytes instead of Chinese characters — a 100-byte limit is far too loose for Chinese text; enforce character count (each Chinese character = 1) not byte length.
- ⚠️ Including every RAPI tier in the summary — leads to 5+ numbers in one sentence, exceeding character limit; pick the 2 most impactful moves only (largest positive + largest negative, or largest positive if all positive).
- ⚠️ Treating the no-change opening as the entire summary — stopping after "no price changes" ignores the RAPI data which is the actual market intelligence payload.
- ⚠️ Ignoring the email sender/subject match — a generic diamond market email from a different sender may require a different extraction approach; confirm it's the Rapaport price list specifically.
- ⚠️ Including login instructions — the email always contains "please login via..." boilerplate; this is not market intelligence and must be excluded from the summary.
