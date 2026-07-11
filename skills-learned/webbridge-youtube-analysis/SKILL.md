---
name: webbridge-youtube-analysis
description: Analyze YouTube videos and web articles via browser/web_fetch, write structured Obsidian notes, and post Discord summaries with graceful degradation when tools are blocked.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-11T10:31:01.260Z
---

## Workflow

1. **Detect request type** — If a YouTube URL (`youtu.be` / `youtube.com`) is received, prefer `browser` tool; otherwise use `web_fetch`. Set `client-side render` hint in browser args for dynamic pages.

2. **Authenticate Chrome profile** — Before launching WebBridge browser, check which Chrome profile `openclaw` uses (`~/.config/google-chrome/` or custom path). If using `~/chrome-debug-profile` (clean/isolated), Google services (including YouTube Premium) may show login walls. Run a probe page (`https://www.youtube.com/account`) to detect auth state before full extraction.

3. **Extract content** — Use browser snapshot or `web_fetch` to pull the full article/video page. For YouTube, also attempt `web_fetch` as a fallback if browser fails on the login wall. Extract: title, author/channel, date, main body text, key timestamps (for videos).

4. **Save to Obsidian** — Write structured notes to `~/openclaw/workspace/ObsidianVault/`, following the vault's existing MOC patterns. Include frontmatter with source URL, extraction timestamp, and content type tag (`#YouTube` / `#Article`).

5. **Post Discord summary** — Deliver a concise 2-3 sentence summary to the user's configured Discord channel. If both browser and `web_fetch` fail, post a degraded note indicating the content was inaccessible and link to the original URL.

6. **Handle login wall gracefully** — If login wall detected, attempt `web_fetch` fallback first before declaring failure. If fallback succeeds, note the auth state in the Obsidian frontmatter (`authWall: true`). If both fail, post the URL + error state to Discord so the user can manually retrieve content.

## Pitfalls

- ⚠️ **WebBridge Chrome debug profile lacks login state** — `~/chrome-debug-profile` is an isolated clean profile. YouTube and Gemini will show login walls, causing extraction to fail silently or return empty content. Always probe for auth state before full extraction.

- ⚠️ **YouTube `noembed` / oEmbed endpoints expose limited metadata** — `web_fetch` on `noembed.com` or YouTube's oEmbed API returns only title, thumbnail, and author — not the article body. Use these as a last resort fallback only, not the primary extraction path.

- ⚠️ **`web_fetch` blocked by CORS or paywall** — Some news sites and video pages return 403 via `web_fetch` while working in browser. If `web_fetch` fails with 4xx, fall back to `browser` tool and note the CORS constraint in the output.

- ⚠️ **Browser profile path mismatch** — OpenClaw may use different Chrome profile paths on different machines (`~/.config/google-chrome/`, `~/Library/Application Support/Google/Chrome/`, etc.). Always verify the profile path via `openclaw config get` or `openclaw gateway status` before assuming login state.

- ⚠️ **Obsidian write fails silently** — If `write_to_obsidian_generic_link_safety` detects broken `[[links]]`, it may refuse to write. Check the return value and re-write with auto-skeleton creation if links are broken.

- ⚠️ **Discord NO_REPLY on summary post** — After posting to Discord, check for `NO_REPLY`. If received, the post succeeded server-side but the confirmation was lost; do not re-post without checking Discord history first.
