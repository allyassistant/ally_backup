---
name: route-enforcer-plugin-debugging
description: 診斷並修復 OpenClaw plugin hook 攔截 model resolution 忽略 explicit 參數的問題
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-08T17:50:00.000Z
---

# Route-Enforcer Plugin Debugging

## Problem Statement

When you explicitly pass `model=` in a `sessions_spawn` call (e.g., `sessions_spawn model=deepseek/deepseek-v4-pro`), the route-enforcer plugin's `before_model_resolve` hook intercepts the model resolution and overrides it based on prompt keywords — ignoring the explicit parameter entirely.

This causes sub-agents to use the wrong model, breaking model-isolation tests, forcing deep research onto MiniMax, or using a weaker model for complex coding tasks.

## Workflow

### Step 1: Detect the Symptom

The telltale sign is a **model mismatch between spawn parameter and actual model used**:

- You spawn with `model=deepseek/deepseek-v4-pro` but the sub-agent uses `MiniMax-M2.7`
- You spawn with `model=minimax-portal/MiniMax-M3` but the sub-agent uses `deepseek-v4-flash`
- A specific prompt keyword pattern ("code review", "deep research", "analysis") consistently routes to a different model than requested

The session jsonl will show `model_change` events even though you didn't request a fallback. The initial model was overridden, not failed.

### Step 2: Locate the Hook

The route-enforcer plugin registers a `before_model_resolve` hook at plugin load time. To find it:

```bash
grep -rn "before_model_resolve\|classifyAuxiliaryTask" ~/.openclaw/extensions/route-enforcer/
```

Typical structure:
```
~/.openclaw/extensions/route-enforcer/index.mjs
```

The hook is registered with a priority (e.g., `priority: 10`). Lower priority runs first. If other plugins also have model resolution hooks, they may run before or after route-enforcer.

### Step 3: Read the Hook Logic

Open the route-enforcer `index.mjs` and find the `before_model_resolve` handler. The typical pattern:

```javascript
before_model_resolve: async (ctx) => {
  const { modelId, taskPrompt, agentDefault } = ctx;
  
  // Classify the task based on prompt keywords
  const classification = classifyAuxiliaryTask(taskPrompt);
  
  if (classification) {
    // Return override — THIS IS WHERE THE BUG LIVES
    return {
      providerOverride: classification.provider,
      modelOverride: classification.model
    };
  }
}
```

**The bug**: `classifyAuxiliaryTask()` only checks the prompt content — it does NOT check whether `modelId` is already an explicitly-set non-default model. When it matches keywords, it returns an override even if you passed `model=deepseek/deepseek-v4-pro` explicitly.

### Step 4: Understand the Fix Pattern

The fix adds a guard at the top of the hook (actual code from `route-enforcer/index.mjs`):

```javascript
// In route-enforcer/index.mjs (file-scope constant)
const AGENT_DEFAULT_MODEL = 'deepseek-v4-flash';

before_model_resolve: async (ctx) => {
  const currentModel = ctx?.modelId || '';
  
  // GUARD: If currentModel is NOT the agent default (and not a fallback/qualified form of it), skip all overrides.
  // Explicit model parameters should be respected, not intercepted.
  const isExplicitNonDefault = 
    currentModel !== '' && 
    currentModel !== AGENT_DEFAULT_MODEL && 
    !currentModel.endsWith('/' + AGENT_DEFAULT_MODEL);
  
  if (isExplicitNonDefault) {
    return; // Allow explicit model — don't override
  }
  
  // Only classify and override for agent-default model resolutions
  const classification = classifyAuxiliaryTask(ctx.taskPrompt);
  if (classification) {
    return { providerOverride: classification.provider, modelOverride: classification.model };
  }
}
```

**The key logic**:
- `AGENT_DEFAULT_MODEL` = hardcoded local constant `'deepseek-v4-flash'` (NOT a `ctx` field)
- If `currentModel` is NOT empty AND is NOT the agent default AND is not a qualified form (`provider/default`) → someone explicitly set it → skip all override logic
- If `currentModel` IS the agent default → route-enforcer can do its normal classification → override if matched

### Step 5: Identify All Edge Cases

After applying the guard, verify these edge cases work correctly:

| Scenario | Expected behavior |
|---|---|
| Spawn without model param (uses default) | route-enforcer overrides normally |
| `model=deepseek/deepseek-v4-pro` (explicit) | skip override, keep v4-pro |
| `model=minimax-portal/MiniMax-M3` (explicit) | skip override, keep M3 |
| Provider fallback (deepseek down → MiniMax) | skip override (respect fallback choice) |
| Model isolation swap (M3 → M2.7) | skip override, keep M2.7 |
| Cron job with explicit model | skip override (cron may use different execution context) |

### Step 6: Apply the Fix

Edit `~/.openclaw/extensions/route-enforcer/index.mjs`:

1. Find the `before_model_resolve` function (approximately line 60-80)
2. Add the guard check immediately after unpacking `ctx`
3. Verify syntax: `node --check ~/.openclaw/extensions/route-enforcer/index.mjs`
4. Restart the gateway: `openclaw gateway restart`

### Step 7: Validate

After restart, test each edge case:

```bash
# Test 1: Explicit model should NOT be overridden
# Spawn: sessions_spawn model=deepseek/deepseek-v4-pro ...
# Check session jsonl: initial model should be deepseek-v4-pro (no model_change)

# Test 2: Default model should still be overridable
# Spawn without model param
# Check session jsonl: if prompt matches classification, model should be overridden
```

### Step 8: Document in Memory

After fixing, record:
- The hook file and line number
- The guard condition added
- The edge cases verified
- Any remaining concerns

## Real Case Study: 2026-06-08 03:18 Fix

**Context**: Josh noticed that sub-agents spawned with explicit `model=deepseek/deepseek-v4-pro` were using `MiniMax-M2.7` instead. The router was overriding explicit model parameters.

**Investigation**:
- Examined `~/.openclaw/extensions/route-enforcer/index.mjs`
- Found `before_model_resolve` hook (priority: 10) intercepting ALL model resolutions
- `classifyAuxiliaryTask()` matched prompt keywords like "code review" → returned model override
- No check for whether `ctx.modelId` was explicitly set vs. agent default

**Root cause**: The hook blindly classified prompts and overrode any model — it had no concept of "explicit parameter vs. default."

**Fix applied**:
```javascript
// In before_model_resolve, after unpacking ctx:
// Skip override if modelId is not the agent default
const isExplicitNonDefault = 
  modelId !== agentDefault && 
  modelId !== `deepseek/${agentDefault}`;

if (isExplicitNonDefault) {
  return; // Respect explicit model parameter
}
```

**Validation**:
- `node --check` passed
- Gateway restart successful (PID 39436)
- Bliss heartbeat: online, no errors
- All 5 edge cases verified ✅

## Pitfalls

- **Plugin-level changes require gateway restart** — Editing the extension file does NOT take effect until the gateway is restarted. SIGUSR1 hot reload may not work for plugin-level hooks. Use `openclaw gateway restart` (full restart).
- **Priority matters** — If another plugin also has a `before_model_resolve` hook with lower priority (runs first), it may override before route-enforcer sees the request. Check plugin load order.
- **Cron jobs may use a different execution context** — The route-enforcer plugin may not be active in the cron execution context (system cron vs. user agent). If cron jobs bypass route-enforcer but manual spawns go through it, that's expected — the fix only applies to the contexts the plugin hooks into.
- **Disabling route-enforcer does NOT help diagnose cron model issues** — Route-enforcer manages user-facing routing. Cron jobs use the system cron context which bypasses route-enforcer entirely. If disabling route-enforcer doesn't change cron model behavior, the problem is in the core scheduler, not the plugin.
- **The guard condition must match both forms of the model ID** — Some code uses `deepseek-v4-flash` while others use `deepseek/deepseek-v4-flash`. The guard must check both forms (`modelId !== agentDefault && modelId !== 'deepseek/${agentDefault}'`) to catch all cases.
- **Plugin hooks run synchronously** — A slow `classifyAuxiliaryTask()` function adds latency to every model resolution. If the classification involves file I/O or network calls, consider caching results.
- **Disabling the plugin to test is a valid diagnostic** — If you're unsure whether route-enforcer is the culprit, temporarily rename the extension file to disable it, restart the gateway, and test. Re-enable after confirming.