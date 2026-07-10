---
name: osint-multi-angle-investigation-orchestration
description: Run iterative OSINT investigations by spawning sub-agents for each angle (direct profiles, mutual friends, associates, phone/email probes), tracking what's been exhausted, and using creative brainstorming to find unexplored approaches when dead ends accumulate.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-05T11:31:01.327Z
stability: experimental
---

## Workflow

1. **Define the investigation target and primary known facts.** Collect: full name(s), all known handles, phone numbers, email addresses, locations, and any associated entities (friends, companies, collaborators). Write a structured **Background block** for sub-agent prompts.

2. **Spawn the first wave of sub-agents — direct profiles.** Send one sub-agent per platform group to check the target's presence on the highest-signal platforms first:
   - Social: Facebook, Instagram, Threads, X/Twitter, TikTok, YouTube
   - Dating/professional: LinkedIn, Carousell, Patreon, GitHub, Strava
   - Messaging: Telegram, WhatsApp, WeChat, Snapchat
   - Search engines: Google, Bing, Brave for name + handle + phone variants
   - Each sub-agent uses `browser` + `web_fetch` to probe, then compiles results

3. **Compile results and identify gaps.** After the first wave returns, identify:
   - Platforms where the target exists but account is private
   - Platforms confirmed empty or non-existent
   - Mutual friends or associates who interacted with the target (these become new investigation angles)
   - Any cross-platform evidence (profile pic matching, username overlap, phone number presence)

4. **Spawn the second wave — associate investigation.** For each mutual friend or associate discovered in Step 3, spawn a sub-agent to:
   - Confirm their connection to the primary target
   - Check their public profiles for posts that tag or mention the target
   - Find new associates or entities through their social graph

5. **Spawn the third wave — indirect probes.** If direct profiles are exhausted, try:
   - Phone number OSINT: search all formats (+852, 852, leading zeros removed) across search engines, HK junk-call databases, Carousell, WhatsApp
   - Email existence probes: check if email addresses exist via login-wall responses from Gmail, Outlook, iCloud
   - HK Companies Registry (ICRIS): check `icris.cr.gov.hk` for company directorships — note: ICRIS is offline Sundays 9 AM–6 PM HKT
   - Dating app searches: try web search for the target's name/handle on popular HK/Taiwan apps
   - Government/news archives: search news databases for the person's name

6. **When dead ends accumulate (≥3 consecutive failed angles), trigger a creative brainstorming sub-agent.** Spawn a `SPAWN_QUALITY` (M3) sub-agent with:
   - The full list of what has already been tried (exact platforms, searches, results)
   - Instructions to think outside the box about platforms, databases, or techniques NOT yet attempted
   - Require concrete execution steps for each new suggestion (not just vague ideas)

7. **Track platform exhaustion state.** Maintain a running log of what has been confirmed empty vs. what was not attempted. Before spawning a new sub-agent, grep the log to avoid re-checking exhausted platforms. Common confirmed-empty patterns:
   - Instagram: private account with no tagged posts visible
   - X/Twitter: dormant since specific date, no recent activity
   - YouTube: no uploads, empty playlist
   - Tumblr/Snapchat: account exists but has never posted
   - GitHub, Strava, Patreon: no account found for any known handle variant

8. **Compile the final comprehensive report.** Merge all sub-agent results into a structured format:
