---
name: smart-router-classifier-debugging
description: Debug Smart Router routing failures by tracing the classifier → model_router → route-enforcer → auxiliary classifier chain and fixing rule ordering or model config mismatches.
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2024-12-01T08:00:00.000Z
---

## Workflow

1. **Check gateway logs for hook events** — Run `tail -n 500 ~/.openclaw/logs/gateway.log` and grep for `before_model_resolve`, `before_prompt_build`, `MROUTE`, `MODEL:`, and `route-enforcer`. Absence of these keywords means the hooks are not firing.

2. **Inspect route-enforcer plugin enabled state** — Check both:
   - `~/.openclaw/extensions/route-enforcer/openclaw.plugin.json` — confirm `enabled: true` and `hooks` array includes `before_model_resolve`
   - `~/.openclaw/openclaw.json` → `plugins.enabled` — ensure `"route-enforcer"` is listed

3. **Verify decision file exists and is readable** — The route-enforcer plugin reads from `/tmp/last_routing_decision.json` (set by the auto-router hook). If this file does not exist, the plugin logs `Could not read routing decision from /tmp/last_routing_decision.json` and silently falls back to default routing. Check with:
