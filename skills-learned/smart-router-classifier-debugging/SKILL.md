---
name: smart-router-classifier-debugging
description: Debug Smart Router routing failures by tracing the classifier → model_router → route-enforcer → auxiliary classifier chain and fixing rule ordering or model config mismatches.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-07-11T14:31:01.249Z
---

## Workflow

1. **Check gateway aliveness first.** Run `openclaw gateway status` and wait until fully online before any further diagnosis — a gateway restart mid-flow means decision files may be stale or unreadable.

2. **Verify decision file freshness.** Read the latest decision file at `~/.openclaw/.session/<session_id>/decision.json` (or equivalent path). Check the `timestamp` or `age` field — if the decision was written >60s ago, the file is **stale** and the classifier is not at fault. A stale decision causes `before_model_resolve` to read `NONE` and skip overrides, which is indistinguishable from a classifier bug.

3. **Validate NONE as correct, not broken.** Not every Discord message is a SPAWN request. "試吓X得嘛？" or "幫我看一下" without explicit spawn keywords is correctly classified as `NONE`. Before suspecting a classifier bug, confirm the message contains intent keywords: spawn, 分析, 幫我, 深入, 執行, run, analyze.

4. **Trace the decision file write.** Check the `message-classifier` hook logs to confirm the classifier ran and wrote the decision file after the target message arrived. A missing write = hook not firing. A write with `route: NONE` despite SPAWN intent = classifier rule ordering bug.

5. **Inspect the classifier rules.** Read the classifier config (e.g., `~/.openclaw/workspace/scripts/router/classifier_rules.js` or equivalent). Check rule ordering — rules are evaluated top-to-bottom; generic patterns before specific ones cause premature `NONE` returns.

6. **Trace the read path.** Verify `before_model_resolve` (or equivalent) reads the correct decision file for the current session. Check the `session_id` context — a mismatch between the decision file session and the current model-resolve session causes the override to be silently skipped.

7. **Audit route-enforcer plugin.** If the decision is correct but routing still fails, check `route-enforcer` plugin hooks. The plugin may override the classifier's decision based on model config overrides or cron-context rules, silently substituting `M2.7` for `M3`.

8. **Check model config for the route.** Verify `route_model.yaml` or equivalent has an entry for the suspected route (SPAWN, CODE, etc.) and that the model assignment matches expectations. A missing entry defaults to a fallback model that may not be intended.

## Pitfalls

- ⚠️ **Gateway restart mid-flow** — a restart between `message-classifier` writing the decision and `before_model_resolve` reading it causes the decision to be silently dropped. Wait for gateway to fully restart before concluding the classifier is broken.

- ⚠️ **Stale decision file (>60s TTL)** — a decision written 560+ seconds ago will appear as `NONE` in `before_model_resolve`, making the classifier look broken when it actually ran correctly. Check file mtime first.

- ⚠️ **Interpreting NONE as a bug** — `NONE` is the correct output for general conversational messages. Only SPAWN-adjacent or tool-adjacent messages should route to SPAWN. Investigating a classifier that outputs NONE for "試吓A得嘛？" is wasted effort.

- ⚠️ **Session ID mismatch** — if multiple sessions write decision files with the same naming scheme, `before_model_resolve` may read the wrong session's file. Confirm the session context matches.

- ⚠️ **Route-enforcer overriding without logging** — the route-enforcer plugin may silently substitute the model config in `before_model_resolve` without writing to logs. Check plugin source for hardcoded model overrides before blaming the classifier.

- ⚠️ **Regex pattern ordering** — a broad `.*` or catch-all pattern early in the rules list causes all messages to short-circuit to a fixed route, masking intent-based routing.
