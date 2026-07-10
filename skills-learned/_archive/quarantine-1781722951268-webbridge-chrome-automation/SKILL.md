---
name: webbridge-chrome-automation
description: Automate Chrome interactions via WebBridge CDP commands — navigate, click, fill, snapshot, and screenshot — then export results to Discord or Obsidian.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-17T19:01:01.276Z
---

## Overview

WebBridge exposes Chrome DevTools Protocol (CDP) commands over HTTP to automate a real Chrome instance. Unlike `x-article-login-wall-fallback` (which uses browser extraction for X specifically), this skill covers the full CDP automation layer: launching Chrome, loading the extension, chaining commands, and exporting results. The typical pipeline is: **navigate → interact → extract → post**.

---

## Workflow

1. **Verify WebBridge is alive.**
   Run `POST /command status` and confirm `extension_connected: true`. If false, load the extension first (see Pitfalls).

2. **Navigate to the target URL.**
   ```bash
   curl -s -X POST http://localhost:9227/command/navigate \
     -H "Content-Type: application/json" \
     -d '{"url": "https://target-site.com/page"}'
   ```
   Returns `{ok: true, tabId: <id>, frameId: <fid>}`. Store `tabId` for subsequent commands.

3. **Wait for page load, then snapshot content.**
   ```bash
   curl -s -X POST http://localhost:9227/command/snapshot \
     -H "Content-Type: application/json" \
     -d '{"tabId": <tabId>}'
   ```
   Snapshot extracts visible text. For longer pages, repeat after a short `sleep 2` to allow lazy content to render.

4. **Interact with page elements as needed.**
   Common patterns — click to focus a textbox:
   ```bash
   curl -s -X POST http://localhost:9227/command/click \
     -H "Content-Type: application/json" \
     -d '{"selector": "#prompt-input", "tabId": <tabId>}'
   ```
   Fill and submit:
   ```bash
   curl -s -X POST http://localhost:9227/command/fill \
     -H "Content-Type: application/json" \
     -d '{"selector": "#prompt-input", "value": "<input-text>", "tabId": <tabId>}'

   curl -s -X POST http://localhost:9227/command/send_keys \
     -H "Content-Type: application/json" \
     -d '{"selector": "#prompt-input", "value": "Enter", "tabId": <tabId>}'
   ```

5. **Take a screenshot for visual confirmation.**
   ```bash
   curl -s -X POST http://localhost:9227/command/screenshot \
     -H "Content-Type: application/json" \
     -d '{"tabId": <tabId>}'
   ```
   Returns base64-encoded PNG. Pipe to `base64 -d > screenshot.png` to save.

6. **Extract the final response via snapshot.**
   After interaction (e.g., Gemini analysis), run snapshot again to pull the generated content.

7. **Export results to Discord or Obsidian.**
   Post the extracted text to the appropriate Discord channel via the message tool, or write to Obsidian via the file tool.

---

## Common Patterns

### YouTube Video Summary via Gemini
