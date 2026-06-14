---
name: provider-response-sanitization
description: Workflow for detecting, building, testing, and integrating provider response sanitizers — e.g., stripping reasoning leaks from MiniMax responses before delivery
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-06T19:00:00.000Z
---

## Workflow

1. **Detect the leak** — scan session transcripts or channel messages for leaked provider-internal content in delivered output. Common leak patterns:
   - `<thinking>` or `</thinking>` tags in Discord messages (MiniMax M3 reasoning leak)
   - System prompt fragments appearing in user-facing output
   - Raw JSON error objects instead of user-friendly messages
   - Provider-specific metadata in code blocks or inline text

2. **Identify the root cause** — determine which provider component is emitting the leaked content:
   - Is it in the model response body itself (e.g., MiniMax returns `response.text` containing `<thinking>` blocks)?
   - Is it injected by the OpenClaw SDK during message formatting?
   - Is it in the `reasoning` field of an OpenAI-compatible response that OpenClaw auto-emits?
   Trace the leak path from provider → SDK → delivery (e.g., Discord message output).

3. **Write a core scrubber utility** — create a standalone Node.js module that strips the leaked content. The scrubber should be:
   - **Deterministic**: same input always produces same output
   - **Composable**: can be chained with other sanitizers (e.g., strip markdown code fences after stripping thinking blocks)
   - **Self-contained**: no external dependencies, runs with Node core only
   - **Idempotent**: running twice produces same result as running once

   Example structure for `scripts/<feature>_scrubber_core.js`:
   ```js
   // Core scrubber — pure function, no side effects
   function scrub(input) {
     return input
       .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
       .replace(/```[\s\S]*?```/g, '')
       .trim();
   }
   module.exports = { scrub };
   ```

4. **Write a wrapper script** — create a CLI wrapper that reads from stdin or a file, applies the scrubber, and writes to stdout or a file:
   ```
   scripts/<feature>_reasoning_scrubber.js
   ```

5. **Test edge cases** — before integration, test the scrubber against at least these cases:
   - **Normal text** with no leaked content (pass-through, no change)
   - **Single `<thinking>` block** (removed)
   - **Multiple `<thinking>` blocks** (all removed)
   - **Nested or malformed tags** (`<thinking>...` without closing tag — handle gracefully)
   - **Mixed content** (leaked thinking + legitimate code fences — only remove thinking blocks)
   - **Empty input** (returns empty string, no crash)
   - **Already-sanitized input** (idempotent — second pass produces same output)

   Use `exec` to run the wrapper with test inputs and verify output:
   ```
   echo '<thinking>test</thinking>hello' | node scripts/<feature>_reasoning_scrubber.js
   # expected: "hello"
   ```

6. **Integrate into reply flow using `message` tool + `NO_REPLY`** — to prevent auto-delivery from leaking content again:
   - Generate the response normally
   - Apply the scrubber to strip leaked content from the response text
   - Use `message` tool with `channel=<target>`, `message=<scrubbed_text>` to send the clean version
   - End with `NO_REPLY` so OpenClaw does NOT auto-deliver the original (potentially leaky) response
   
   This pattern ensures only the scrubbed version reaches the user.

7. **Create issues to track** — document the leak with detailed findings in an issue:
   - Include root cause: file:line references in the SDK/provider code
   - Include leak evidence: real examples from session transcripts
   - List solution options with trade-offs (Express/Standard/Full)
   - Add progress checklist with remaining integration steps
   - Tag with appropriate priority label (P1 for active leaks)

8. **Test the integration** — after integrating, run a test turn that would trigger the leak:
   - Use a provider known to leak (e.g., MiniMax M3)
   - Check the delivered message for leaked content
   - Verify the scrubber removes ALL leak patterns
   - If leaks persist, iterate on the scrubber regex/pattern

## Pitfalls

- **Auto-delivery bypasses the scrubber.** If you only scrub the response text but leave auto-delivery enabled, OpenClaw will send the original (unscrubbed) response. You must use `message` tool + `NO_REPLY` to control delivery.
- **Provider updates can change leak format.** A provider may change their response format (e.g., `<thinking>` → `[reasoning]` or `reasoning` field) without notice. Periodically re-check delivered messages for new leak patterns.
- **Scrubber regex must be forgiving.** Malformed HTML/XML tags (missing closing angle bracket, whitespace in tags, nested tags) should be handled gracefully — failing open (passing content through) is better than failing closed (dropping legitimate content).
- **Edge cases with code fences.** If legitimate content contains `<thinking>` as a code example, the scrubber should not strip it. Consider context-aware matching (e.g., only strip `<thinking>` when NOT inside a code fence).
- **Integration testing requires real provider calls.** The scrubber may work on test inputs but fail on actual provider responses (different whitespace, encoding, or structure). Always test with a real turn that triggers the leak.
- **Correlate leak patterns with specific model providers.** Different orchestration providers (OpenRouter, MiniMax Portal, direct API) may format the same model's output differently. A scrubber that works for MiniMax Portal may not work for OpenRouter-minimax.
