---
name: discord-channel-logger
description: Fetch recent Discord channel messages via the API and append them to a dated memory file, then reply NO_REPLY to suppress notification.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-10T17:02:57.390Z
---

## Workflow

1. **Resolve the date** — Run `date +%Y-%m-%d` to get today's ISO date string for the output filename. Store this in a variable for use in both the file path and the memory write.

2. **Fetch each channel's recent messages** — Use the `message` tool (or equivalent Discord API call) against each target channel ID, requesting the 10 most recent messages. Common target channels:
   - `#一般` — channel ID `1473343330170572904`
   - `#💼工作` — channel ID `1473383064565710929`
   - `#🧑🏻‍💻編程` — channel ID `1473384999003619500`
   (Adjust IDs to match the current Discord server configuration.)

3. **Format each message entry** — For each fetched message, extract the author's display name and the message content. Truncate content to a maximum of 200 characters to keep the output file compact. Format as:
