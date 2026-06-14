---
name: ai-hot-push-workflow
description: Scheduled AI HOT content push to Discord with sub-agent execution, delivery verification, and announce-mode gotcha mitigation
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-10T06:35:00.000Z
---

## Workflow

### 1. Setup Script-based Push Infrastructure

Create a self-contained Node.js script at `scripts/ai_hot_push.js` that handles:
- Fetch RSS feeds (Bloomberg, X, NVIDIA AI Blog, etc.)
- Categorize items (headlines, products, opinions, dev, research)
- Format Discord posts (🔥 AI HOT · 精選)
- Deduplicate via `.ai_hot_seen.json`
- Send Discord push directly

### 2. Configure Cron with Thin Executor

```yaml
# In openclaw.cron.yaml or equivalent
ai-hot-push:
  schedule: "0 */2 * * *"  # Every 2 hours
  kind: agentTurn
  isolated: true
  delivery:
    mode: "webhook"  # NOT "announce" — see Pitfalls
  model: m2.7
```

### 3. Script Self-Sends to Discord

Inside `ai_hot_push.js`:
```javascript
const DISCORD_WEBHOOK_URL = process.env.DISCORD_AI_HOT_WEBHOOK;

async function sendToDiscord(formattedContent) {
  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: formattedContent })
  });
  return response.ok;
}
```

This bypasses the LLM announce wrapper entirely.

### 4. Verify Delivery Verification

- Set `delivery.mode: "none"` in cron config (so OpenClaw doesn't try to announce)
- Script handles its own delivery verification
- Monitor via `openclaw cron get ai-hot-push` — check `status: ok` and `delivered: true`

### 5. Handle Deduplication

- Maintain `.ai_hot_seen.json` file tracking seen items by URL
- Script checks this before pushing
- Periodic cleanup of stale entries (>24h)

### 6. Validate Output Format

After deployment, manually test:
```bash
node scripts/ai_hot_push.js --test  # Dry run, print to stdout
openclaw cron run ai-hot-push       # Actual run
```

Verify the Discord message matches expected 4-section detailed format.

## Pitfalls

### 🚫 delivery.mode: "announce" Truncates Output
**Gotcha**: Even if your script produces 4 detailed sections (800+ chars), `delivery.mode: "announce"` causes OpenClaw's LLM to read stdout and **rewrite a summary**. Users receive ~3 sentences instead of the full push.

**Fix**: Use `delivery.mode: "none"` or `delivery.mode: "webhook"`. Have the script POST directly to Discord webhook URL, bypassing LLM wrapper.

### 🚫 Cannot Read Target Channel History via Message Tool
**Gotcha**: `message action=read channel=...` parameter is **not respected** — it always returns the agent's current chat channel. You cannot use it to verify what was actually posted to #AI🔥熱門.

**Workaround**: Manually check Discord UI, or have the script log delivery confirmation to a file.

### 🚫 Script Output Timing ≠ Announce Timing
Script may complete in 7 seconds, but the announce phase takes additional LLM latency. Users may see the message late or out of order. Script self-send (webhook mode) eliminates this gap.

### 🚫 LLM Wrapper Override Not Configurable
There is no `prompt` override to stop the announce LLM from summarizing. The only reliable fix is to remove the announce phase entirely by using webhook/code delivery.

### 🚫 Fallback Chain Conflicts
If script calls a sub-agent or LLM internally, ensure its model config doesn't conflict with the cron's `fallback` chain. Use explicit model names in script, not environment variables.

## References

- Script path: `~/.openclaw/workspace/scripts/ai_hot_push.js`
- Cron config: in `~/.openclaw/workspace/config/cron.yaml` or equivalent
- Dedup state: `.ai_hot_seen.json` in workspace root
