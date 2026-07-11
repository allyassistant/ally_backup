---
name: m3-subagent-article-analysis
description: "Spawn M3 sub-agent to analyze articles and write Obsidian. Use when: analysis needed, fit assessed, notes required. Key capabilities: article analysis, architecture assessment, Obsidian notes."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-11T19:31:00.000Z
---

## Workflow

1. **Identify source**
   - User provides article URL or text content
   - If URL, fetch page content via browser tool or x-article-login-wall-fallback workflow

2. **Prepare analysis prompt**
   - Construct prompt for M3 sub-agent: analyze architecture, extract key patterns, assess applicability to current system
   - Include source URL, title, and user context in prompt
   - Set output expectations: concise summary + Obsidian-compatible markdown

3. **Spawn M3 sub-agent**
   - Use spawn model selection: intent-based (M3 for high-quality analysis)
   - Pass full context: article content, analysis criteria, output format requirements
   - Set appropriate timeout for article analysis workload

4. **Collect sub-agent output**
   - Receive structured response from M3 sub-agent
   - Validate output contains: summary, key findings, applicability assessment
   - Handle partial completion gracefully (see Pitfalls)

5. **Write to Obsidian**
   - Create new note in designated vault location
   - Include frontmatter: source URL, analysis date, tags
   - Format content for future retrieval

6. **Return summary to user**
   - Concise Cantonese summary (2-3 sentences, <100 chars) if user requests short format
   - Link to Obsidian note for full analysis
   - Highlight applicability to current system

## Pitfalls

- **Output token limit truncation**: M3 sub-agent may hit output token limit mid-analysis, producing truncated summary. Always check if output ends mid-sentence or lacks closing markdown fences. If truncated, either:
  - Re-spawn with shorter scope (analyze one section at a time)
  - Fall back to M2.7 for the analysis task
  - See `subagent-m3-reliability` for recovery patterns

- **Partial completion without error**: M3 may return a seemingly complete response that omits key sections (e.g., missing applicability assessment). Validate response structure before writing to Obsidian. If critical sections missing, re-spawn.

- **x.com login wall bypass failure**: If using x-article-login-wall-fallback and all 6 layers fail, the sub-agent receives no content. Explicitly check for empty content and notify user before spawning analysis.

- **Obsidian write permission errors**: Sub-agent may not have write permissions to vault. Verify vault path exists and is writable before spawning. If permission denied, write to a temp location and alert user.

- **Stale article content**: Articles may be behind paywalls or updated after fetch. Include fetch timestamp in Obsidian frontmatter. If analysis seems off, verify content matches current article state.

- **Mixed language output**: M3 may respond in English when user expects Cantonese. Explicitly set language requirement in prompt: "回應用繁體中文/廣東話" or "summary in Cantonese".

- **Missing Pitfalls section validation**: The skill-reviewer script blocks writing if this section is absent. Ensure at least 3 pitfall items exist before any skill promotion.
