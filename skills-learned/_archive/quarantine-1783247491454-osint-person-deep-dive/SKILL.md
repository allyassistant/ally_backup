---
name: osint-person-deep-dive
description: Investigate a person's online presence across multiple social platforms by spawning a sub-agent to run systematic platform checks and compile a structured findings report.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-05T10:31:00.000Z
stability: experimental
---

## Activation condition
Promote to status: active when the skill has been recalled (via skill-auto-suggest or direct invocation) ≥3 times in a rolling 7-day window with no quality regression or user override.

## Workflow

1. **Gather known handles and identifiers** — Collect all known usernames, phone numbers, email addresses, and platform URLs from the conversation context before spawning. List variants (e.g. `yvettetsang`, `tsangwailing`, `曾慧玲`, `+852 6144 4491`). Use these as separate search targets, not just the primary name.

2. **Define the execution plan** — Structure the sub-agent prompt with a clear execution plan section listing each platform to check and the specific data to extract:
   - Facebook: profile pic, bio, friends list, recent posts, tagged photos
   - Instagram: bio, posts count, follower/following ratios, tagged posts
   - X/Twitter: join date, last post date, tweet content, replies
   - YouTube: channel creation date, video count, playlist content
   - Threads: profile status (public/private), post history
   - Pinterest, Tumblr, Snapchat, Telegram: account existence and content
   - HK-specific: Carousell, HK Discuss, local forums
   - Cross-reference: check if profile pics match across platforms

3. **Spawn the sub-agent with M2.7** — Use `sessions_spawn` with M2.7 model for OSINT investigations (cost-effective for structured data gathering). Pass the full execution plan as part of the spawn prompt. Set depth limit (e.g. `depth 1/1`) to prevent infinite recursion.

4. **Execute parallel browser and web_fetch checks** — In the sub-agent, run platform checks in parallel batches:
   - Group independent platform checks together (e.g. 3–4 web_fetch calls simultaneously)
   - Use `browser` tool for JavaScript-heavy pages (Facebook, Instagram) that require session/cookie handling
   - Use `web_fetch` for static pages (X/Twitter, YouTube, forums)
   - For each platform: extract URL, profile status, key data points, and timestamp of last activity

5. **Compile findings into a structured report** — Present results in a consistent table format:
