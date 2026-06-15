---
name: main-session-execution-loop-recovery
description: Detect and recover from HEARTBEAT_OK loops where the session stops executing user tasks. Break the loop, identify the pending request, execute it manually, and restore normal flow.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-15T02:31:01.228Z
---

## Workflow

1. **Detect the loop** — Count consecutive `HEARTBEAT_OK` responses. If a session produces 3 or more consecutive `HEARTBEAT_OK` tool-call results without any substantive assistant reply, the session is in a loop. A second signal: the tool-call count is disproportionately high relative to the conversation turns (e.g., 125 calls across 534 turns with no output = loop).

2. **Break the loop explicitly** — Send a direct, non-HEARTBEAT tool call to interrupt the cycle. Use `exec` with a simple command (`echo "loop broken"`) or a `read` of a known file to force a non-heartbeat response. Do not send another HEARTBEAT — that re-triggers the loop.

3. **Identify the pending user request** — Read the last user message from the conversation transcript. The request is still in context; the session never consumed it. Common patterns: email summarization, file analysis, code generation.

4. **Execute the task manually** — Fulfill the user's original request directly. The session was stalled, not failed — context is still valid. Produce the answer, summary, or output the user asked for.

5. **Confirm and resume** — After producing the output, wait for the next user message. Normal flow is restored once a non-HEARTBEAT tool-call result appears.

## Pitfalls

- ⚠️ Continuing to send HEARTBEAT probes after detecting the loop — each probe increments the call count and deepens the loop; you must break with a non-heartbeat tool call.
- ⚠️ Assuming the user request was already answered — in a HEARTBEAT_OK loop, the session produced no output; the request is still pending and must be fulfilled manually.
- ⚠️ Treating the loop as a model timeout or rate-limit issue — HEARTBEAT_OK loops are execution-layer stalls, not API failures; retrying the same tool call will not resolve it.
- ⚠️ Running tool calls without reading conversation context first — you may miss the user's actual request and produce a generic or irrelevant response.
- ⚠️ Not counting tool calls — a small number of HEARTBEAT_OK responses are normal; the threshold for a loop is ≥3 consecutive without output, or a call-count-to-turn ratio >0.2.
