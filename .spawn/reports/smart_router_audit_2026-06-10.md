# Smart Router Audit Report
*日期：2026-06-10*

## Summary

- 🟢 **5 functional areas pass** (YAML config, model_router validation, spawn_config fallback chain, test suites, deepseek-v4-pro validity)
- 🟡 **1 documentation drift** found (AGENTS.md has duplicate "Fallback 行為" sections with contradictory content)
- 🟢 **0 critical bugs**
- 🟢 **0 cron impact** (no cron job uses spawn_config.js; skill_reviewer_bot.js hardcodes M2.7)
- 🟢 **0 test failures** (22 + 13 + 8 = 43 tests all pass)

整體 verdict：**🟡 Minor issues** — one documentation drift to fix; implementation is correct and well-tested.

---

## Bugs Found (🔴)

### 1. AGENTS.md duplicate "Fallback 行為" section with contradictory content

**Severity:** Medium (documentation drift — confusing but non-blocking)

**File:** `AGENTS.md`, lines 257-265 (the Spawn Intent Gate section)

**Description:** The "🎯 Spawn Intent Gate (M3 on-demand)" section contains TWO consecutive "**Fallback 行為：**" blocks with **mutually exclusive** content:

```markdown
# First block (line 257-260) — CORRECT (matches code behavior)
**Fallback 行為：**
- SPAWN (M2.7) primary → M2.7 死咗 → deepseek-v4-flash
- SPAWN_QUALITY (M3) primary → M3 死咗 → deepseek-v4-pro（維持 premium quality，唔係 flash）
- 兩個 route 唔互相 fallback（M3 死咗唔降級去 M2.7）

# Second block (line 262-265) — INCORRECT (contradicts code, contradicts first block)
**Fallback 行為：**
- SPAWN (M2.7) primary → M2.7 死咗 → deepseek-v4-flash
- SPAWN_QUALITY (M3) primary → M3 死咗 → deepseek-v4-flash    ← WRONG
- 兩個 route 唔互相 fallback（M3 死咗唔降級去 M2.7）
```

**Evidence (code is correct, second block is wrong):**
- `scripts/spawn_config.js:47` — `ROUTE_DEFAULT_FALLBACK['spawn_quality'] = 'deepseek-v4-pro'`
- `scripts/router/tests/spawn_config_tests.js:144-145` (S14a) — explicitly asserts `ROUTE_DEFAULT_FALLBACK['spawn_quality'] === 'deepseek-v4-pro'`
- `scripts/router/tests/spawn_config_tests.js:152-153` (S14c) — `resolveFallbackModel('spawn_quality', 'deepseek') === 'deepseek-v4-pro'`
- `scripts/spawn_config.js:14-15` comment header — explicitly says "SPAWN_QUALITY → deepseek-v4-pro (M3 fallback maintains quality)"
- `scripts/router/route_model.yaml:51-56` — `spawn_quality` primary M3, fallback chain deepseek → triggers deepseek-v4-pro via ROUTE_DEFAULT_FALLBACK

**Likely cause:** Leftover from a draft/early iteration. The rollback plan in Issue #145 Step 4 references "Flash" version, so this is probably an old version of the table that wasn't cleaned up after the implementation was finalized to "Pro".

**Recommended fix:** Remove the second "**Fallback 行為：**" block (lines 262-265). Keep only the first block (lines 257-260).

**File:** `/Users/ally/.openclaw/workspace/AGENTS.md`

---

## Warnings (🟡)

### 1. Skills-learned `intent-based-spawn-model-selection` is in "draft" status

**Severity:** Low (informational)

**File:** `skills-learned/intent-based-spawn-model-selection/SKILL.md`

**Description:** The skills-learned file documenting this exact workflow is marked as `status: draft` and `source: skill-reviewer`. This is the meta-skill that captures the workflow used to make today's change. The skill is correctly identified and saved, but its draft status means it hasn't been formally promoted yet.

**Recommendation:** No action needed for this audit (skill is being created, not the audit target). The skill's content correctly captures the pitfalls and matches the actual implementation.

---

### 2. Auxiliary classifier could mis-route "M3" prompts at the L1 layer

**Severity:** Low (informational, separate from today's change)

**File:** `scripts/router/auxiliary_classifier.js` + `scripts/router/auxiliary_routing.json`

**Description:** When a Josh message contains "M3" or "深入" keywords, the classifier.js classifies to SPAWN (correct), and then `auxiliary_classifier.js` also runs keyword matching and returns `{"task":"deep_research", "model":"minimax-portal/MiniMax-M2.7"}`. This means even if Ally routes to SPAWN_QUALITY (M3), the auxiliary_classifier L1 layer might override to M2.7 based on prompt keywords.

**Evidence:**
```bash
$ node -e "..." 
M3 query: {"task":"deep_research","model":"minimax-portal/MiniMax-M2.7","provider":"minimax-portal"}  ← M2.7 wins
quality query: null  ← "high quality" not in any category
plain query: {"task":"deep_research","model":"minimax-portal/MiniMax-M2.7","provider":"minimax-portal"}
```

**Note:** This was a pre-existing behavior. The `skills-learned/route-enforcer-plugin-debugging/SKILL.md` documents a fix for this exact bug (guard condition to skip override when explicit model is set). The fix has been applied.

**Action needed for this audit:** None — this is out of scope for the spawn_quality changes. The audit confirmed no regression from today's changes.

---

## Functional Verification ✅

### Manual smoke tests (with mocked env)

| Test | Result |
|------|--------|
| `node scripts/spawn_config.js --route SPAWN` | `{"model":"deepseek-v4-flash","provider":"none"}` — correctly falls back to DEFAULT_MODELS[deepseek] when all providers unhealthy |
| `node scripts/spawn_config.js --route SPAWN_QUALITY` | `{"model":"deepseek-v4-pro","provider":"none"}` — **correctly** uses ROUTE_DEFAULT_FALLBACK, NOT DEFAULT_MODELS |
| `node scripts/spawn_config.js --route SPAWN_QUALITY --task "..."` | parses task correctly |
| `node scripts/spawn_config.js --route SPAWN_QUALITI` (typo) | falls back to `spawn` (safe) |
| `node scripts/spawn_config.js --route` (no value) | falls back to `spawn` (safe) |
| `node scripts/spawn_config.js` (no args) | defaults to `SPAWN` |
| `node scripts/spawn_config.js --route SPAWN_QUALITY` (no env vars) | works, uses ROUTE_DEFAULT_FALLBACK |

### Case sensitivity (verified via normalizeRoute)

| Input | Output |
|-------|--------|
| `SPAWN_QUALITY` | `spawn_quality` ✅ |
| `spawn_quality` | `spawn_quality` ✅ |
| `Spawn_Quality` | `spawn_quality` ✅ |
| `ROUTER_SPAWN_QUALITY` | `spawn_quality` ✅ (regex strips `ROUTER_` prefix) |
| `SPAWN_QUALITI` (typo) | `spawn` (safe fallback) ✅ |

### Edge cases

| Scenario | Behavior | Verdict |
|----------|----------|---------|
| ROUTE_DEFAULT_FALLBACK missing key | `ROUTE_DEFAULT_FALLBACK[route] \|\| DEFAULT_MODELS[cfg.provider] \|\| 'deepseek-v4-flash'` — triple-fallback chain | ✅ Safe |
| minimax-portal unhealthy, SPAWN_QUALITY → deepseek | `cfg.model = ''` from router, then `ROUTE_DEFAULT_FALLBACK['spawn_quality']` fills `deepseek-v4-pro` | ✅ Correct |
| All providers unhealthy (provider = 'none') | Returns `{provider: 'none', model: 'deepseek-v4-flash' or 'deepseek-v4-pro'}` — still emits valid model string | ✅ Safe (sessions_spawn may fail downstream, but config is valid) |
| Decision logger logs `spawn_quality` route | Yes — verified 19 occurrences in `decision_log.jsonl` | ✅ |
| `deepseek-v4-pro` validity | **VERIFIED via DeepSeek API** — `curl https://api.deepseek.com/v1/models` lists `deepseek-v4-pro`; `chat/completions` with `model: "deepseek-v4-pro"` returns 200 OK | ✅ Valid |

---

## Test Results

| Suite | Pass | Fail | Notes |
|-------|------|------|-------|
| `spawn_config_tests.js` | **22** | 0 | New tests S6b (normalizeRoute for SPAWN_QUALITY), S14a-d (ROUTE_DEFAULT_FALLBACK) all pass |
| `integration_tests.js` | **13** | 0 | T1-T13 all pass; no spawn_quality-specific tests but base router validation works |
| `e2e_test.js` | **8** | 0 | New E2E-1b (SPAWN_QUALITY route → MiniMax-M3) passes; all existing E2E tests pass |
| **Total** | **43** | **0** | 100% pass rate |

### Test coverage gaps (informational, not bugs)

1. **No integration test for spawn_quality → deepseek fallback** — the new route's fallback path (M3 unhealthy → deepseek-v4-pro) is only covered by unit tests (S14a-c). An E2E test that mocks `minimax-portal` unhealthy and verifies `spawn_config --route SPAWN_QUALITY` outputs `deepseek-v4-pro` would be valuable.

2. **No classifier test update** — but classifier doesn't need it (SPAWN_QUALITY is an Ally-decided route, not user-classified).

3. **No ROUTE_DEFAULT_FALLBACK missing-key test** — the triple-fallback chain (`ROUTE_DEFAULT_FALLBACK || DEFAULT_MODELS || 'deepseek-v4-flash'`) is not explicitly tested. Adding a test that uses an unknown route name would verify the chain.

**Recommendation:** Consider adding 1-2 more E2E tests for spawn_quality fallback path in a future PR. Not blocking.

---

## Naming / Consistency

| Check | Status | Notes |
|-------|--------|-------|
| `SPAWN_QUALITY` vs `spawn_quality` consistency | ✅ | Both forms used appropriately: `SPAWN_QUALITY` (uppercase) in CLI args / AGENTS.md user-facing; `spawn_quality` (lowercase) in YAML keys / JS internal / log entries |
| Comment headers in `spawn_config.js` | ✅ | Line 14-15 explicitly documents both routes; matches actual behavior |
| AGENTS.md Route Table ↔ route_model.yaml | ✅ | Table at line 224-229 matches YAML exactly |
| HEARTBEAT.md Skill Reviewer | ✅ | Line 41 says `(M2.7)` which matches `scripts/skill_reviewer_bot.js:30` hardcoded `MODEL = 'minimax-portal/MiniMax-M2.7'` |
| Issue #145 file reference | ✅ | `.issues/active/145-spawn-intent-gate-spawn-m2-7-v.md` has full description, rollback plan, progress 5/5 |

---

## Cron Impact ✅

**No cron impact identified.** All checks pass:

1. **No cron job calls `spawn_config.js`:**
   ```bash
   grep -rn "spawn_config.js" /Users/ally/.openclaw/workspace/scripts /Users/ally/.openclaw/workspace/.openclaw
   # Only references in: spawn_config.js (self), test files, skills/, AGENTS.md
   # No cron, no shell scripts
   ```

2. **`skill_reviewer_bot.js` hardcodes model, doesn't use spawn_config:**
   ```javascript
   // Line 30
   const MODEL = 'minimax-portal/MiniMax-M2.7';
   const MODEL_FALLBACKS = ['deepseek/deepseek-v4-flash'];
   ```
   Hardcoded M2.7 + its own fallback list. Today's change makes the HEARTBEAT.md label `(M2.7)` match the script's actual behavior — a **drift fix**, not a behavior change.

3. **No cron job previously used the "old M3 spawn" behavior:**
   - All cron jobs use isolated sessions, agentTurn mode, and direct model selection (not via `spawn_config`).
   - The 26 cron jobs mentioned in Issue #145 are unaffected.

---

## Files Read

### Core changes (all read, all correct)
- ✅ `scripts/router/route_model.yaml` — `spawn_quality` route added correctly (lines 51-56)
- ✅ `scripts/router/model_router.js` — `REQUIRED_ROUTES` includes `spawn_quality` (line 38)
- ✅ `scripts/spawn_config.js` — `normalizeRoute()` includes `spawn_quality` (line 70), `ROUTE_DEFAULT_FALLBACK` correctly defined (line 47), comment headers accurate
- ✅ `.spawn/structured_spawn.template` — `## Model Selection` section (lines 5-9) documents both routes clearly

### Test files (all run, all pass)
- ✅ `scripts/router/tests/spawn_config_tests.js` — 22 pass / 0 fail
- ✅ `scripts/router/tests/integration_tests.js` — 13 pass / 0 fail
- ✅ `scripts/router/tests/e2e_test.js` — 8 pass / 0 fail
- ✅ `scripts/router/tests/classifier_tests.js` — exists, not modified today, not re-run (out of scope)

### Reference files (read, behavior confirmed)
- ✅ `scripts/router/classifier.js` — does NOT need update; SPAWN_QUALITY is Ally-decided, not user-classified
- ✅ `scripts/router/config_loader.js` — YAML loading + ENV resolution works correctly
- ✅ `scripts/router/failure_recovery.js` — provider chain resolution works correctly with new route
- ✅ `scripts/router/config.js` — paths correct
- ✅ `scripts/router/auxiliary_classifier.js` + `auxiliary_routing.json` — out of scope for today's change (no regression)
- ✅ `scripts/router/report.js` — read; logs `spawn_quality` as a route label (no code change needed, will appear in reports)

### Files NOT found (no impact)
- ❌ `scripts/router/decision_logger.js` — does NOT exist (only archived in `_archive/`). Decision logging is done by `model_router.js` itself (line 234, `appendDecisionLog`). No update needed.
- ❌ `scripts/router/normalize_route.js` — does NOT exist. `normalizeRoute()` is only inlined in `spawn_config.js` and replicated in tests. No duplication to consolidate (acceptable pattern).

### Config files
- ⚠️ `AGENTS.md` — **1 bug found** (duplicate Fallback 行為 section; see Bug #1)
- ✅ `HEARTBEAT.md` — Skill Reviewer label correctly updated to `(M2.7)`
- ✅ `.issues/active/145-spawn-intent-gate-spawn-m2-7-v.md` — issue properly documented, progress 5/5

---

## Verdict

**🟡 Minor issues** — One documentation drift bug in AGENTS.md (duplicate contradictory "Fallback 行為" section). The implementation, configuration, and tests are all correct and well-tested (43 tests, 100% pass rate). Recommended fix: delete lines 262-265 of AGENTS.md to remove the duplicate/incorrect fallback table.

No critical bugs. No cron impact. No regression. Safe to use.

---

## Confidence

| Area | Confidence | Notes |
|------|------------|-------|
| Functional correctness of spawn_config fallback chain | **High** | Manually tested with various inputs; verified `deepseek-v4-pro` is a valid DeepSeek model via API call |
| YAML config validity | **High** | Loaded successfully; matches AGENTS.md table; matches Required_Routes |
| REQUIRED_ROUTES validation | **High** | Test T11 verifies it rejects missing routes; model_router.js loadRouteModelYaml() works |
| Test coverage of new route | **Medium** | Unit tests cover normalizeRoute + ROUTE_DEFAULT_FALLBACK; E2E-1b covers primary path; **no E2E for spawn_quality → deepseek-v4-pro fallback path** (though it's covered by unit S14c) |
| Cron impact | **High** | grep confirmed no cron uses spawn_config; skill_reviewer_bot hardcodes model |
| AGENTS.md bug | **High** | Verified by reading lines 257-265; second block contradicts code and unit test S14a |
| `decision_logger.js` not existing | **High** | Verified via `ls`; only in `_archive/`; logging is done by `model_router.js` |
| Auxiliary classifier impact on M3 routing | **Medium** | Tested via `node -e`; auxiliary_classifier returns M2.7 for "M3 深入" prompts, but this is pre-existing behavior + has a documented fix in route-enforcer-plugin-debugging skill |

### Open questions for the user

None. The audit is complete and the verdict is clear. The one bug found is purely cosmetic (documentation) and easily fixed.

---

## Recommended Action

**Priority:** Low (cosmetic fix; safe to defer until next AGENTS.md edit)

**Edit `/Users/ally/.openclaw/workspace/AGENTS.md`:** Delete lines 262-265 to remove the duplicate/incorrect fallback table.

**Optional enhancement (not required):** Add E2E test for `spawn_quality → deepseek-v4-pro` fallback path in `scripts/router/tests/e2e_test.js`.
