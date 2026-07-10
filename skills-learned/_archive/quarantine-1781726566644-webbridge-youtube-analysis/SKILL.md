---
name: webbridge-youtube-analysis
description: Analyze YouTube videos and generic WebBridge-controlled Chrome automation tasks via M3 sub-agent, persisting results to Obsidian and Discord when requested.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-17T20:01:01.226Z
---

## Workflow

1. **Detect the trigger** — User asks about WebBridge + Chrome automation, mentions Kimi WebBridge, or pastes a YouTube URL. Use this skill for any browser-automation task where Chrome must be controlled programmatically.

2. **Spawn M3 sub-agent with compressed context** — Gather current system state (WebBridge status, active Chrome sessions, any relevant memory notes), then spawn via `sessions_spawn` with a focused prompt:
   - What is the user's specific automation goal?
   - Is WebBridge already active/configured?
   - What is the output destination (Obsidian, Discord, both)?
   - Include relevant file paths (memory/, obsidian vault path).

   ```bash
   sessions_spawn "Analyze how to practically use Kimi WebBridge-controlled Chrome for <goal>. System: WebBridge active, Chrome PID <pid>, vault at <path>. Output: step-by-step automation plan + key file locations."
   ```

3. **Collect sub-agent result** — Wait for yield/poll cycle, read the structured output. The plan should include: WebBridge CDP commands, file paths to scripts or Obsidian notes, Discord webhook if push is needed.

4. **Present architectural recommendation** — Synthesize the sub-agent output into:
   - Which WebBridge commands to use (navigate, extract, screenshot)
   - Where to persist results (Obsidian note path, Discord channel)
   - Any pre-requisites (Chrome remote debugging port, extension loaded, session state)
   - Decision tree: if WebBridge unavailable → fallback to browser extraction or search fallback

5. **Write Obsidian note** — If the task involves analysis or findings, persist to the vault under the appropriate layer:
   - `Knowledge/` for category-based notes
   - `03-Output/<YYYY-MM-DD>/` for timeline-indexed results
   - `MOCs/` for cross-links if new topic emerges

6. **Push Discord summary** — If Discord push is requested, use the webhook with concise Cantonese summary (2-3 sentences, <100 characters per line).

7. **Update skill state** — If the workflow was novel (not YouTube-specific), note the pattern in memory so future sessions can reference it. Avoid re-triggering M3 for repeated identical tasks.

## Trigger Conditions

- User pastes a YouTube URL and asks for analysis or summary
- User explicitly asks how to use WebBridge / Chrome automation for their architecture
- User requests browser-based extraction where login walls or dynamic content require Chrome
- M3 sub-agent spawn is requested for web automation / browser control tasks

## Decision Tree
