---
name: route-enforcer-plugin-debugging
description: Diagnose plugin hooks that ignore overrides and break resolution. Use when plugin fails, overrides ignored, or resolution breaks. Covers hook analysis, override diagnosis, resolution debug, and the route-enforcer model-override bug.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-14T07:31:01.223Z
---

## Workflow

1. **Identify the failing plugin.** Run the target workflow and capture the exact error message, hook name, and call stack. Check `openclaw gateway status` for plugin registration state.

2. **Locate the plugin source file.** Search `extensions/` for the plugin name or hook signature. Common paths: `extensions/skill-learner/index.mjs`, `extensions/route-enforcer/index.mjs`. Read the plugin file and identify the hook function.

3. **Trace the override resolution path.** For each override attempt, follow the execution: does the plugin receive the override value? Does it pass it to the next function? Does the next function use it? Insert `console.log` at each step if the code path is unclear.

4. **Check for silent no-op patterns.** Some plugins return success without applying the override. Look for `return true` or `return resolved` after a conditional that should have applied the change. The hook "succeeds" but the override is ignored.

5. **Verify plugin hook registration.** Run `openclaw gateway status` and confirm the plugin is registered in the active pipeline. A plugin registered after the resolution step cannot affect it.

6. **Apply fix and test.** Once the broken step is identified, add the missing guard or port the correct pattern from a working plugin. Re-run the workflow and confirm the override is respected.

## Route-enforcer specific fix

### Symptom

- The `route-enforcer` plugin is supposed to enforce a default model via the `before_model_resolve` hook.
- When a task uses `--model deepseek/deepseek-chat` or an agent config contains `model: deepseek/deepseek-chat`, the model should be respected.
- Instead, the plugin rewrites `params.modelId` to the route's default model, ignoring the explicit override.

### Locate the hook

```bash
grep -n "before_model_resolve" extensions/route-enforcer/index.mjs
# Example: extensions/route-enforcer/index.mjs:42
```

### Hook logic (simplified)

```js
async function beforeModelResolve(context, params) {
  const route = context.get('route');
  const routeDefault = route?.config?.model;

  if (routeDefault) {
    params.modelId = routeDefault;
  }

  return params;
}
```

### Root cause

The hook unconditionally overwrites `params.modelId` with the route default whenever the route has a model configured. It does not check whether the current `modelId` is an explicit user/agent override.

### Fix: add an explicit-override guard

Add a guard that skips the rewrite when the current `modelId` is explicitly set and is not identical to the agent default:

```js
async function beforeModelResolve(context, params) {
  const route = context.get('route');
  const routeDefault = route?.config?.model;
  const agentDefault = context.get('agent')?.config?.model;
  const modelId = params.modelId;

  // If the caller already specified a non-default model, respect it.
  const isExplicitNonDefault =
    modelId &&
    agentDefault &&
    modelId !== agentDefault &&
    modelId !== `deepseek/${agentDefault}`;

  if (isExplicitNonDefault) {
    return params;
  }

  if (routeDefault) {
    params.modelId = routeDefault;
  }

  return params;
}
```

### Edge cases

| Scenario | `modelId` before hook | `agentDefault` | Expected behavior |
|---|---|---|---|
| No override | `undefined` / `agentDefault` | `deepseek/deepseek-chat` | Apply route default |
| Explicit override | `deepseek/deepseek-reasoner` | `deepseek/deepseek-chat` | Keep override |
| Provider-normalized default | `deepseek/deepseek-chat` | `deepseek-chat` | Treat as default, allow route override |
| Custom non-OpenRouter model | `anthropic/claude-3.5-sonnet` | `deepseek/deepseek-chat` | Keep override |

### Real case study

On 2026-06-08, `route-enforcer` overrode an explicit agent-level `deepseek/deepseek-chat` selection with a route-level default. The fix added the guard above and added unit tests covering implicit-prefix normalization.

## Validation

After applying the fix:

1. Run the failing workflow:
   ```bash
   openclaw run -v --model deepseek/deepseek-reasoner "solve this"
   ```
2. Confirm the resolved model in the verbose output is `deepseek/deepseek-reasoner`.
3. Run without an override and confirm the route default is still applied.
4. Run the plugin-specific test suite if available:
   ```bash
   cd extensions/route-enforcer && npm test
   ```

## Pitfalls

- **Plugin applies overrides at the wrong layer.** If the plugin runs after the resolution decision is cached, the override has no effect even if the plugin code is correct. Check the pipeline order in `openclaw gateway status`.
- **Silent success — plugin returns without applying.** Some plugins return `true` on the hook even when the override was not applied. Always verify the downstream effect, not just the hook return value.
- **Plugin hook ignores `disable-model-invocation` field.** The `skill-learner` plugin at `extensions/skill-learner/index.mjs:228` does not check the `disable-model-invocation: true` frontmatter field when injecting skills into the catalog. As a result, skills marked with this field still appear in catalog output and are visible to the LLM — the field provides no enforcement at the plugin layer. Fix: port the `shouldSymlinkSkill()` pattern from the skill validator into the plugin's injection logic, filtering out skills where `disable-model-invocation === true` or `status` is `draft`/`archived`.
- **Override value is overwritten by a later plugin.** Even if the first plugin respects the override, a downstream plugin may overwrite it. Check the full plugin chain, not just the first suspect.
- **Hot-reload does not refresh plugin state.** After patching a plugin, `openclaw gateway reload` may not reload the in-memory plugin state. Restart the gateway or use `openclaw gateway restart` to ensure the patched code is active.
- **Plugin uses a different config key than the override.** The override targets `skillLearner.enabled` but the plugin reads `skillLearner.active`. Name mismatch causes silent ignore. Always check the exact config key the plugin uses, not the conceptual name.
- **Unconditional rewrite in `before_model_resolve`.** Route defaults should only apply when no explicit override is present. Always compare the incoming `modelId` against the agent default (and any provider-prefixed variant) before overwriting.
