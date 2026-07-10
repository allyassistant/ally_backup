---
name: cantonese-exec-loop-recovery
description: Diagnose Cantonese heartbeat loops where the assistant echoes HEARTBEAT_OK instead of advancing the task, then break the cycle.
status: active
source: skill-reviewer
provenance: agent
stability: stable
generatedAt: 2026-06-27T10:17:06.000Z
---

## Workflow

1. **Detect Cantonese markers** — Scan for Cantonese/Jyutping characters (嘅、咗、唔、咁、喇、啲、嘢、幾時、何時) or explicit user requests in 廣東話/Cantonese/Hong Kong.

2. **Check loop depth before spawning sub-agent** — If the request is already 3+ turns into a loop (HEARTBEAT_OK repeated), do not spawn another sub-agent with the same prompt. Instead, generate the Cantonese content in the main session and deliver it directly without tool calls.

3. **Spawn with compressed input when sub-agent is needed** — If a sub-agent is required, pre-gather only the essential context (email subject, key dates, location) in plain text before spawning. Do NOT pass full conversation history or HEARTBEAT_OK markers to the sub-agent, as these trigger re-execution loops.

4. **Force direct Cantonese output delivery** — After spawning, if the sub-agent returns HEARTBEAT_OK without content, the main session must intercept and deliver the Cantonese summary directly. Do not re-spawn; generate the summary inline and output it without invoking any tool.

5. **Target output format** — Cantonese summary: 2–3 sentences, ≤100 characters. Structure: event name + dates + location. Use natural Cantonese phrasing (唔係..., 而係..., 話...), avoid Mandarin syntax (不是...而是...).

## Pitfalls

- ⚠️ **Spawning sub-agent with full HEARTBEAT_OK history** — Passing conversation history containing HEARTBEAT_OK markers causes the sub-agent to re-enter the same exec loop. Always strip history and provide only the raw task input when spawning for Cantonese content.

- ⚠️ **Re-spawning after sub-agent returns HEARTBEAT_OK** — If the first sub-agent yields HEARTBEAT_OK, spawning a second sub-agent with the same prompt produces identical results. The main session must break the cycle and generate the output inline without further tool calls.

- ⚠️ **Cantonese syntax contamination** — Using Mandarin grammatical patterns (「不是...而是...」）in Cantonese output sounds unnatural. Verify output uses Cantonese-specific constructions (「唔係...而係...」、「話...」）and avoids Mandarin-style punctuation (，「」）in favor of Cantonese punctuation （，「」）.

- ⚠️ **Sub-agent token budget exhaustion masking Cantonese exec loops** — When a sub-agent hits token limits while generating Cantonese content, it may return HEARTBEAT_OK with no visible error. Distinguish by checking if the Cantonese summary was actually delivered; if not within 2 turns, assume loop and deliver inline.
