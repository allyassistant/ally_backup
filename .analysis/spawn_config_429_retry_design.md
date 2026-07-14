# Design: 429 Fallback Retry Logic for spawn_config.js

**Status:** Design proposal (for Josh review before implementation)
**Author:** Ally subagent (code review route)
**Scope:** `spawn_config.js`, `model_router.js`, `failure_recovery.js`, AGENTS.md workflow

---

## 1. Current Architecture (Findings)

### 1.1 Flow Trace

```
caller (LLM)
  └─ exec: node scripts/spawn_config.js --route SPAWN --task "..."
      └─ spawn_config.js
          ├─ dedup guard (30s window on route+task)
          ├─ modelRouter.routeModel({text, route, context})
          │   └─ builds chain: [primary, ...fallback_chain] (deduped, ordered)
          │   └─ failureRecovery.resolveProvider(chain) → returns first healthy
          │   └─ returns { provider, model, baseUrl, apiKey, timeout, extraBody,
          │                 fallbackChain, fallbackDepth, decisionId }
          ├─ resolveThinking(provider, extraBody) → 'adaptive' | undefined
          └─ output: { model, thinking, provider, decisionId }   ← fallbackChain DROPPED here
  └─ parses JSON, calls sessions_spawn model=... thinking=... task=...
      └─ if 429 → error bubbles up, no retry attempted
```

### 1.2 Key Observation: fallbackChain Is Already Built but Discarded

`model_router.routeModel()` already returns `fallbackChain` (full ordered chain of providers).
`spawn_config.js` strips it before output. The information is there — we just don't expose it.

### 1.3 The kimi `type: noop` Problem (Confirmed)

`route_model.yaml` has `kimi: { type: noop }`. The probe in `failure_recovery.js` returns `true` immediately without HTTP check. **Kimi's 429 cannot be detected proactively via probes.**

This means the solution MUST rely on **runtime 429 → caller-driven retry**, not proactive probe-based avoidance.

---

## 2. Option Analysis

| Option | Verdict | Reason |
|--------|---------|--------|
| **B1**: Output fallbackChain, caller retries | ✅ **Recommended** | spawn_config is stateless CLI — can't catch runtime 429. Only caller (LLM) sees the error. |
| **B2**: sessions_spawn catches 429 and auto-retries | ❌ Out of scope | sessions_spawn is the OpenClaw runtime tool, not in workspace. Cannot modify. |
| **B3**: spawn_config exports a retry wrapper | ❌ Reduces to B1 | Wrapper can't invoke `sessions_spawn` (only LLM has that tool). Best it can do is return a retry plan = B1 in a different shape. |

**Decision: B1 with two enhancements:**
- (a) Output `retryChain` so caller knows what to try next
- (b) Expose `recordRateLimit(provider)` so caller can mark the provider as unhealthy → next `spawn_config` call avoids it

---

## 3. Design Changes

### 3.1 `spawn_config.js`

**Changes:**

1. **Capture `fallbackChain` from router result** (currently discarded)
2. **Build `retryChain`**: filter out current resolved provider and `'none'`, keep order. Cap at 2 candidates (matches max 2 retries requirement).
3. **Output `retryChain`** in JSON output (additive — backward compatible)
4. **Update dedup key** to include model (so retry with fallback model doesn't get short-circuited)
5. **Re-export `recordRateLimit`** from failure_recovery for caller convenience

### 3.2 `failure_recovery.js`

**Changes:**

1. **Add `recordRateLimit(providerName, error)`** function:
   - Marks provider with **short cooldown** (30s, distinct from the regular 60s failure-based cooldown)
   - Sets `failureCount = 1` (not the threshold-3) — rate limit is a soft signal, not a hard failure
   - After cooldown expires, probe re-evaluates
   - Logs `event: 'rate_limit'` to decision_log

### 3.3 `model_router.js`

**No changes needed.** It already returns `fallbackChain`.

### 3.4 AGENTS.md (Workflow Update)

Add a "429 Retry Workflow" subsection under the spawn workflow integration steps.

---

## 4. Exact Code Changes

### 4.1 `scripts/router/failure_recovery.js`

Add the `recordRateLimit` function. Insert after `markProviderSuccess` (around line 178) and export it.

```javascript
// ─── Rate Limit Tracking ───────────────────────────────────────────────────

/**
 * Mark a provider as rate-limited (HTTP 429) with a SHORT cooldown.
 *
 * Distinct from markProviderFailure() because:
 *  - Rate limits are transient (seconds to minutes), not structural
 *  - failureCount = 1 (NOT the threshold-3) — one 429 is enough signal to
 *    route around the provider, but we don't want to lock it out for the
 *    full COOLDOWN_MS duration like a hard failure
 *  - Short cooldown (RATE_LIMIT_COOLDOWN_MS, default 30s) — covers most
 *    provider rate-limit windows without over-blocking
 *
 * Call this AFTER observing a 429 from sessions_spawn. The next spawn_config
 * invocation will skip this provider via the existing resolveProvider()
 * health check, picking the next item in fallbackChain.
 *
 * @param {string} providerName
 * @param {Error|string} [error]
 */
const RATE_LIMIT_COOLDOWN_MS = 30_000;

function recordRateLimit(providerName, error) {
  if (!healthCache.has(providerName)) throw new Error(`unknown provider: ${providerName}`);
  const entry = healthCache.get(providerName);
  const now = Date.now();
  entry.cooldownUntil = now + RATE_LIMIT_COOLDOWN_MS;
  entry.lastError = error ? (error.message || String(error)) : 'rate limited';
  entry.lastCheck = now;
  // Note: we do NOT set healthy=false here — resolveProvider() checks
  // cooldownUntil > now independently of healthy flag. This keeps the
  // marker narrow (cooldown-only) so the provider is automatically
  // reconsidered after the window.
  appendDecisionLog({
    ts: new Date().toISOString(), event: 'rate_limit',
    provider: providerName, cooldownUntil: entry.cooldownUntil,
    cooldownMs: RATE_LIMIT_COOLDOWN_MS, lastError: entry.lastError,
  });
}
```

Update `module.exports` at the bottom of `failure_recovery.js`:

```javascript
module.exports = {
  resolveProvider,
  isProviderHealthy,
  markProviderFailure,
  markProviderSuccess,
  recordRateLimit,         // ← NEW
  runHealthCheckLoop,
  _probeProvider: probeProvider,
  _loadConfig: loadConfig,
  _getHealthCache: () => healthCache,
  _RESET: resetAll,
  _RATE_LIMIT_COOLDOWN_MS: RATE_LIMIT_COOLDOWN_MS,  // ← NEW (for tests)
};
```

### 4.2 `scripts/spawn_config.js`

**Change A: Build retryChain and include in output.**

Replace the section after the `cfg` is resolved and before `console.log(JSON.stringify(output))`:

```javascript
  /** @type {import('./router/model_router').RouteModelResult} */
  let cfg;
  try {
    cfg = await modelRouter.routeModel({ text: task || rawRoute, route, context: {} });
  } catch (err) {
    console.error(`[spawn_config] routeModel() error: ${err.message}`);
    cfg = { provider: 'minimax-portal', model: '', extraBody: {}, fallbackChain: [], decisionId: 'fallback' };
  }

  // Model: use resolved model, or route-specific fallback, or provider default
  const model = cfg.model || ROUTE_DEFAULT_FALLBACK[route] || DEFAULT_MODELS[cfg.provider] || 'minimax-portal/MiniMax-M2.7';

  // Thinking: map router reasoning intent to runtime-accepted value
  const thinking = resolveThinking(cfg.provider, cfg.extraBody);

  // Build retry chain for 429 fallback. Filter out:
  //   - current resolved provider (already tried)
  //   - 'none' (terminal, not a real provider)
  // Cap at 2 candidates (primary + 1 fallback retry).
  // Full chain is also exposed for callers that want more.
  const retryChain = (cfg.fallbackChain || [])
    .filter(p => p !== cfg.provider && p !== 'none')
    .slice(0, 2);

  const output = {
    model,
    thinking,
    provider: cfg.provider,
    decisionId: cfg.decisionId || 'unknown',
    // NEW: retry candidates for 429 fallback. Caller should iterate these
    // in order if sessions_spawn returns HTTP 429. To make the provider
    // sticky for the next spawn_config call, also call recordRateLimit().
    retryChain,
    // Full fallback chain (kept for debugging and for callers that want
    // more than 2 retries). Includes current provider as [0].
    fallbackChain: cfg.fallbackChain || [],
  };
```

**Change B: Update dedup key to include model.**

Currently the dedup key is `(route, task)`. This means if a spawn fails with 429 and the caller retries with a different model, the dedup guard would short-circuit. Fix: include `model` in the key.

Replace the `dedupKey` function:

```javascript
function dedupKey(route, task, model) {
  const crypto = require('crypto');
  const normalizedTask = (task || '').trim().replace(/\s+/g, ' ');
  const normalizedModel = (model || '').trim();
  return crypto
    .createHash('sha256')
    .update(`${route}\x00${normalizedTask}\x00${normalizedModel}`)
    .digest('hex')
    .slice(0, 16);
}
```

Update the call sites in `main()`:

```javascript
  // Double-spawn guard: short-circuit if same route+task+model was just resolved.
  if (!skipDedup) {
    // Compute preliminary model for dedup key (before routeModel resolves provider).
    // This is best-effort: if router picks a different model, the key won't match,
    // which is correct (different model = different intent).
    const preliminaryModel = ROUTE_DEFAULT_FALLBACK[route] || 'unknown';
    const key = dedupKey(route, task, preliminaryModel);
    const existing = readDedup(key);
    // ... (existing logic)
  }
```

Actually, the simpler and more correct approach is to compute the dedup key AFTER the model is resolved (so we know the actual model). Update `main()`:

```javascript
  // (existing routeModel call)
  // ...

  // Build output (existing code)
  const output = { /* ... */ };

  // Persist dedup record with the resolved model
  if (!skipDedup) {
    const key = dedupKey(route, task, model);  // ← include resolved model
    // (existing dedup write + TOCTOU check)
  }
```

And remove the preliminary-key short-circuit at the top of `main()`:

```javascript
  // REMOVE this block:
  // if (!skipDedup) {
  //   const key = dedupKey(route, task);
  //   const existing = readDedup(key);
  //   if (existing) { ... return cached ... }
  // }
```

(Trade-off: dedup no longer protects against the case where the SAME args resolve to a DIFFERENT provider between two rapid calls. In practice, this is fine — same args → same router decision.)

**Change C: Re-export `recordRateLimit` for caller convenience.**

```javascript
// At top of file, alongside the modelRouter require:
const failureRecovery = require(path.join(ROUTER_DIR, 'failure_recovery'));

module.exports = {
  resolveThinking,
  DEFAULT_MODELS,
  ROUTE_DEFAULT_FALLBACK,
  normalizeRoute,
  // Re-export for callers that want to record 429 after spawn fails.
  // Usage: const { recordRateLimit } = require('./spawn_config');
  //        recordRateLimit('kimi', error);
  recordRateLimit: failureRecovery.recordRateLimit,
  // Exposed for tests / external callers
  dedupKey,
  readDedup,
  writeDedup,
  DEDUP_TTL_MS,
};
```

### 4.3 `scripts/router/model_router.js`

**No changes.** It already returns `fallbackChain`.

(Confirmed by reading lines 195-220: `return { provider, model, baseUrl, apiKey, timeout, extraBody, fallbackChain, fallbackDepth, decisionId };`)

### 4.4 `AGENTS.md` Workflow Update

Add a new subsection under "TOOLS.md 整合 workflow" in the "Smart Spawn" SOP row, OR add a new entry in the "SOP 索引" table. The cleanest place is a new SOP entry:

```markdown
### 🔁 429 Retry Workflow

**When:** `sessions_spawn` returns HTTP 429 (rate limit) for the model returned by `spawn_config.js`.

**Why:** Provider's primary model is rate-limited. `spawn_config.js` resolves the first *healthy* provider, but kimi is `type: noop` in `route_model.yaml` so health probes don't catch 429s. We must retry at runtime.

**Steps (LLM caller):**

1. **Catch the 429** from `sessions_spawn`. Identify the failing provider from the error.
2. **Record rate limit** so the next spawn_config call avoids this provider:
   ```bash
   node -e "require('./scripts/spawn_config').recordRateLimit('kimi', new Error('429 from spawn'))"
   # Or via failure_recovery directly:
   node -e "require('./scripts/router/failure_recovery').recordRateLimit('kimi')"
   ```
3. **Read retryChain from cached spawn_config output**:
   ```bash
   cfg=$(node scripts/spawn_config.js --route SPAWN --task "...")  # picks next healthy
   # Or read from previous spawn's JSON if you kept it
   ```
4. **Re-spawn with the next candidate**:
   ```bash
   model=$(echo "$cfg" | jq -r .model)
   sessions_spawn model=$model task="..."   # ← retry
   ```
5. **Loop** through `retryChain` until one succeeds or all are exhausted.
6. **If all exhausted**: surface error to Josh with the rate-limit history.

**Limits:**
- Max 2 retries (primary + 1 fallback) — encoded in spawn_config's `retryChain` (capped at 2).
- Don't retry on non-429 errors (network, auth, timeout) — those are likely structural.

**Why not auto-retry inside spawn_config?** spawn_config is a stateless CLI. It runs once, returns config, exits. The 429 happens AFTER it exits, inside `sessions_spawn`. Only the LLM caller sees the error and can decide to retry.
```

---

## 5. Output JSON Shape

**Before:**
```json
{
  "model": "kimi/kimi-for-coding",
  "thinking": "adaptive",
  "provider": "kimi",
  "decisionId": "uuid-..."
}
```

**After:**
```json
{
  "model": "kimi/kimi-for-coding",
  "thinking": "adaptive",
  "provider": "kimi",
  "decisionId": "uuid-...",
  "retryChain": ["minimax-portal"],
  "fallbackChain": ["kimi", "minimax-portal", "none"]
}
```

If `spawn_config` is invoked again after `recordRateLimit('kimi')`:
- `failureRecovery.resolveProvider(['kimi', 'minimax-portal', 'none'])` skips kimi (cooldown active)
- Returns `'minimax-portal'`
- `cfg.provider === 'minimax-portal'`
- `retryChain = []` (no more healthy providers after this one)
- `model = 'minimax-portal/MiniMax-M2.7'`

---

## 6. Backward Compatibility

| Concern | Impact | Mitigation |
|---------|--------|-----------|
| Existing callers parse JSON with `jq -r .model` | ✅ No break | New fields are additive |
| Cron scripts that pipe `cfg` into `sessions_spawn` | ✅ No break | Same output shape for required fields |
| Tests using `resolveThinking`, `normalizeRoute`, etc. | ✅ No break | New exports are additive |
| Dedup behavior change (key now includes model) | ⚠️ Subtle change | Documented: same task + different model = different dedup slot (intentional — different model = different intent) |
| Other code that requires `spawn_config` | ✅ No break | All existing exports preserved; new exports additive |

**One real change:** dedup no longer catches the case where the same `node scripts/spawn_config.js --route SPAWN --task "X"` is invoked twice rapidly with the router picking a *different* provider the second time. This is acceptable — same args should deterministically resolve to the same provider.

---

## 7. Test Cases

### Unit Tests (extend `scripts/test_spawn_config.js`)

```javascript
// ─── New tests for retry chain building ──────────────────────────────────

const { buildRetryChain } = require('./spawn_config');  // needs new export

test('retryChain filters out current provider', 
  JSON.stringify(buildRetryChain(['kimi', 'minimax-portal', 'none'], 'kimi')) === 
  JSON.stringify(['minimax-portal']));

test('retryChain filters out "none" terminal',
  JSON.stringify(buildRetryChain(['minimax-portal', 'kimi', 'none'], 'minimax-portal')) === 
  JSON.stringify(['kimi']));

test('retryChain caps at 2 candidates',
  JSON.stringify(buildRetryChain(['a', 'b', 'c', 'd'], 'a')) === 
  JSON.stringify(['b', 'c']));

test('retryChain empty when only fallback is "none"',
  JSON.stringify(buildRetryChain(['kimi', 'none'], 'kimi')) === 
  JSON.stringify([]));

// ─── New tests for recordRateLimit ────────────────────────────────────────

const { recordRateLimit } = require('./router/failure_recovery');
const { isProviderHealthy, _RESET } = require('./router/failure_recovery');

_RESET();  // clean state

test('recordRateLimit puts provider in cooldown',
  !isProviderHealthy('kimi').healthy);  // initially healthy → after record → unhealthy

// (Note: failure_recovery uses module-level Map state. Use _RESET() to clean
// between tests.)
```

### Integration Tests (manual or scripted)

```bash
# Test 1: Happy path
node scripts/spawn_config.js --route SPAWN --task "test happy path"
# Expected: { "model": "kimi/kimi-for-coding", ..., "retryChain": ["minimax-portal"] }

# Test 2: After marking kimi rate-limited
node -e "require('./scripts/router/failure_recovery').recordRateLimit('kimi')"
node scripts/spawn_config.js --route SPAWN --task "test after 429"
# Expected: { "model": "minimax-portal/MiniMax-M2.7", ..., "retryChain": [] }

# Test 3: Dedup key includes model
node scripts/spawn_config.js --route SPAWN --task "dedup test" --no-dedup > /tmp/cfg1.json
node scripts/spawn_config.js --route SPAWN --task "dedup test" > /tmp/cfg2.json  # different model expected

# Test 4: retryChain empty for single-provider route (theoretical)
# (Not currently in routes — all routes have fallback_chain with 2+ entries)

# Test 5: Decision log entry
node -e "require('./scripts/router/failure_recovery').recordRateLimit('kimi')"
tail -1 scripts/router/decision_log.jsonl | jq '.event, .provider, .cooldownMs'
# Expected: "rate_limit", "kimi", 30000
```

### Manual Verification (after deployment)

1. Run normal spawn, verify `retryChain` field appears
2. Trigger 429 by setting `MAX_REQUESTS_PER_MINUTE` low (or temporarily re-route kimi to a 429-returning mock)
3. Verify caller can iterate retryChain and successfully spawn on fallback
4. Verify health cache reflects rate-limit cooldown (`isProviderHealthy('kimi').cooldownUntil > now`)
5. After 30s cooldown, verify next spawn_config invocation returns kimi as healthy again

---

## 8. Implementation Order

1. ✅ Add `recordRateLimit` to `failure_recovery.js` (smallest, no deps)
2. ✅ Update `spawn_config.js`: capture `fallbackChain`, build `retryChain`, output new fields
3. ✅ Update `spawn_config.js`: dedup key includes model
4. ✅ Update `spawn_config.js`: re-export `recordRateLimit`
5. ✅ Add unit tests to `test_spawn_config.js`
6. ✅ Update AGENTS.md with 429 retry workflow
7. ⚠️ **Verify with Josh** before deployment: confirm re-export shape, retry count (2 vs more), cooldown duration (30s)

---

## 9. Risks & Open Questions

| Risk | Mitigation |
|------|-----------|
| LLM forgets to retry on 429 | Document in AGENTS.md + add a "429 detected" reminder in the workflow. Consider adding a cron-based "429 self-test" that simulates a 429 and verifies retry works. |
| Over-retry storm (all spawns retry simultaneously after 429 burst) | 30s cooldown prevents this. The next spawn_config invocation skips rate-limited providers automatically. |
| `recordRateLimit` not called by caller | Optional — if caller doesn't call it, retry still works via fallbackChain. Just less efficient (next spawn picks same provider and 429s again). |
| Health cache state across processes | Each spawn_config invocation is a separate process. healthCache is module-level — created fresh each time. ⚠️ **This means recordRateLimit's cooldown doesn't persist across spawn_config invocations.** |

### 🚨 Open Issue: Health Cache Is Process-Local

**The health cache in `failure_recovery.js` is in-memory (module-level Map).** Each `node scripts/spawn_config.js` invocation is a fresh process → fresh empty cache → no record of past rate limits.

This means:
- `recordRateLimit('kimi')` from a caller process only persists for THAT process
- A subsequent `node scripts/spawn_config.js` invocation won't see the rate limit
- Within a SINGLE spawn_config invocation, if the caller does:
  ```
  node scripts/spawn_config.js ... # process A: returns kimi
  # A fails with 429
  node scripts/spawn_config.js ... # process B: starts fresh, picks kimi again
  ```
  Process B won't know kimi was just rate-limited.

**Mitigation options:**

1. **Persist health cache to disk** (best long-term fix, but out of scope per "no route_model.yaml changes" — but disk persistence is in `failure_recovery.js`, not YAML, so it IS in scope). Adds complexity.
2. **Caller-driven fallback only** (simpler): after 429, caller reads previous output's `retryChain` and manually calls `sessions_spawn model=<retryChain[0]>` — bypassing spawn_config entirely on retry. This works because the caller already has the chain.
3. **Pass health state via env var** (hacky): caller passes the rate-limited provider list via `--skip-providers kimi` flag. Spawn_config passes it to `routeModel` context.

**Recommendation: Option 2 for now (MVP), Option 1 later.** The MVP works because:
- retryChain is in the original spawn_config output
- Caller can use it directly without calling spawn_config again
- `recordRateLimit` becomes optional (best-effort, helps within long-lived processes but doesn't help across invocations)

Update the AGENTS.md workflow to reflect this:

```markdown
### 🔁 429 Retry Workflow (MVP)

**On 429 from sessions_spawn:**

1. **Identify failing provider** from the error message
2. **Read retryChain from the cached cfg** you already have (don't re-call spawn_config):
   ```bash
   fallback=$(echo "$cfg" | jq -r '.retryChain[0]')  # first retry candidate
   ```
3. **Re-spawn directly with the fallback model**:
   ```bash
   # Use the corresponding model from DEFAULT_MODELS
   fallback_model=$(node -e "
     const { DEFAULT_MODELS } = require('./scripts/spawn_config');
     console.log(DEFAULT_MODELS['$fallback'] || '');
   ")
   sessions_spawn model=$fallback_model task="..."
   ```
4. **Loop** through retryChain until success or exhaustion
5. **Optional: record the rate limit** (helps if a long-lived process spawns multiple times):
   ```bash
   node -e "require('./scripts/spawn_config').recordRateLimit('kimi', new Error('429'))"
   ```
```

This MVP doesn't require health cache persistence, works in the existing architecture, and is testable end-to-end.

---

## 10. Recommendation Summary

**Implement Option B1 (with MVP retry via cached retryChain):**

1. `failure_recovery.js`: Add `recordRateLimit(provider, error?)` (10 lines)
2. `spawn_config.js`: 
   - Capture `fallbackChain` from router
   - Build `retryChain` (filter current provider + 'none', cap at 2)
   - Include in output JSON
   - Update dedup key to include model
   - Re-export `recordRateLimit`
3. `model_router.js`: No change
4. AGENTS.md: Document 429 retry workflow
5. Tests: Add 5-7 unit tests + integration verification

**Defer (out of scope for MVP):**
- Health cache disk persistence (Option 1 above) — wait until MVP proves the need
- B2 (sessions_spawn auto-retry) — requires OpenClaw runtime changes, out of workspace
- B3 (wrapper script) — would reduce to B1 anyway

**Approximate diff size:**
- `failure_recovery.js`: +30 lines (recordRateLimit + exports)
- `spawn_config.js`: +20 lines (retryChain build, dedup update, re-export)
- `model_router.js`: 0 lines
- `AGENTS.md`: +30 lines (new SOP section)
- Tests: +20 lines

Total: ~100 lines, low risk, backward compatible.

---

**Awaiting Josh's approval to proceed with implementation.**