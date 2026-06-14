---
name: auto-router
description: "Automatically run router.py on every message to determine if sub-agent spawning is needed"
homepage: https://github.com/openclaw/auto-router-hook
metadata:
  {
    "openclaw":
      {
        "emoji": "🔀",
        "events": ["message:preprocessed"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "workspace", "kind": "openclaw-workspace", "label": "Workspace scripts" }],
      },
  }
---

# Auto Router Hook

Automatically runs `router.py` on every incoming message to determine if a sub-agent should be spawned.

## What It Does

1. **Listens** to `message:preprocessed` events (fires after message is received, before agent responds)
2. **Executes** `router.py` with the message content
3. **Stores** the routing decision to `~/.openclaw/workspace/.router-decision.json`
4. **Logs** the decision for debugging

## Output Format

The routing decision is stored as JSON:

```json
{
  "decision": "spawn",
  "agentLabel": "coder",
  "suggestedModel": "kimi",
  "complexity": "medium",
  "reason": "coder任務",
  "timestamp": 1773590340000,
  "message": "帮我写一个 Node.js script"
}
```

## How the Main Agent Uses This

The main agent (Ally) should check `.router-decision.json` before responding:

```python
# In the main agent's response logic:
import json

def should_spawn():
    try:
        with open("~/.openclaw/workspace/.router-decision.json") as f:
            decision = json.load(f)
            return decision.get("decision") == "spawn"
    except:
        return False
```

## Requirements

- **Router script**: `~/.openclaw/workspace/scripts/router.py` must exist
- **Workspace dir**: Must be configured in OpenClaw

## Configuration

No additional configuration required. The hook reads the message content from the event context.

## Files

| File | Purpose |
|------|---------|
| `HOOK.md` | This metadata file |
| `handler.js` | The hook implementation |
