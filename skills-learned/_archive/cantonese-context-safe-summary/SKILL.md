---
name: cantonese-context-safe-summary
description: Generate Cantonese summaries for short tasks without triggering context overflow, detecting Cantonese exec loops and recovering by delivering output directly without tool calls.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-24T13:01:02.000Z
---

## Workflow

1. **Detect Cantonese request markers** — Check if user input contains Cantonese script markers: Traditional Chinese characters (唔, 咁, 幾, 點, 你, 我, 佢, 我哋, 你哋, 佢哋, 幾時, 點解, 做咩, 係, 喺, 㗎, 囉, 咋, 啫, 咋嘛, 呢, 嗰, 啲, 噉, 嚟, 去, 嚟, 之, 嘢), Cantonese-specific punctuation (「」『』), or explicit Cantonese keywords (總結, 簡報, 撮要, 摘要, 重點).

2. **Detect Cantonese exec loop** — If the session is producing repeated HEARTBEAT_OK responses (≥3 consecutive HEARTBEAT_OK without substantive output), this is a Cantonese exec loop. The exec tool is looping without producing the Cantonese summary. Do NOT make additional exec calls.

3. **Switch to direct Cantonese output** — Abandon the exec/tool-call approach. Generate the Cantonese summary directly as a text response, bypassing the tool layer entirely. This is the correct behavior for Cantonese tasks — the LLM produces Cantonese natively without needing to invoke exec to run scripts.

4. **Check for Rapaport/RapNet content** — If the email is from Rapaport (寄件人 contains `rapaport.com`) and contains market data (diamond prices, price lists, market updates), trigger `rapaport-email-summary` as a subroutine for structured market extraction.

5. **Generate token-safe Cantonese summary** — Keep the summary concise: 2–3 sentences, under 100 Chinese characters. Use Cantonese grammar and vocabulary. Avoid invoking additional LLM calls or exec loops within the same response.

## Pitfalls

- ⚠️ HEARTBEAT_OK exec loop on Cantonese tasks — The exec tool loops producing only HEARTBEAT_OK without advancing toward a Cantonese summary. Detecting this at turn 3+ and switching to direct LLM output is the recovery path. Do not keep calling exec.
- ⚠️ Context overflow from full email injection — When the original email (including HTML, headers, and boilerplate) is injected into the LLM context for summarization, it can consume significant token budget. Strip non-essential fields (HTML tags, repeated headers, footers) before passing to the summarizer.
- ⚠️ Triggering rapaport-email-summary without market data — Not every Rapaport email contains market data. Price list notifications, account notices, and generic alerts do not warrant the full rapaport-email-summary treatment. Only invoke when diamond prices, market trends, or trade data are explicitly present.
- ⚠️ Using Cantonese script as sole detection signal — Traditional Chinese alone is not sufficient (繁體中文 users in Taiwan/HK write in traditional but not necessarily Cantonese). Require Cantonese-specific markers or explicit Cantonese keywords to trigger this skill.
- ⚠️ Forgetting token budget check before spawning sub-agent — If a sub-agent is needed for deep analysis, check remaining token budget first. If <20% budget remains, generate summary directly without sub-agent spawn.
