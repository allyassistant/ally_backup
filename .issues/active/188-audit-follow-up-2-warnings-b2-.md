---
id: 188
title: Audit follow-up: 2 warnings + B2 library bypass
status: active
priority: P3
created: 2026-07-05
due: 2026-07-25
updated: 2026-07-05
progress: 0/0
---


## F - Facts（事實）

### 現況
#182 全 session 完結時做嘅 2 輪 M3 audit (#182 #12 完成後) 發現 3 個 follow-up items，全部 P3 low severity：
1. **B2 library bypass** — `llm_judge_calibration.mjs:223` 用 raw `execFileSync('openclaw', ...)` 唔用 `discord.push()`
2. **W1 regex dup** — `auditOrchestrator.js:451` regex 有重複 `(?:\d+\s*\*\s*)*(?:\d+\s*\*\s*)*` pattern
3. **W2 whitelist 缺 `86400`** — `startup_dashboard.js:223` 用 `86400` (sec/day) 但 `TIME_CONSTANT_WHITELIST` 冇，audit 會 false positive

### 數據/證據

| 項目 | 值 |
|------|------|
| Sub-agent runtime (audit) | ~7 min |
| Sub-agent tokens (audit) | 87.5k (in 75.2k / out 12.3k) |
| Sub-agent runtime (fix) | 34s |
| Sub-agent tokens (fix) | 40.6k |
| B2 location | `scripts/llm_judge_calibration.mjs:223` |
| W1 location | `scripts/lib/auditOrchestrator.js:451` |
| W2 location | `scripts/lib/auditOrchestrator.js` (TIME_CONSTANT_WHITELIST array) |
| W2 trigger | `scripts/startup_dashboard.js:223` uses `86400` |
| Status of B1 | ✅ Fixed (try/finally pattern, +3 lines) |

## D - Decisions（決定）

### ✅ 已做決定
- **2026-07-05**: B1 temp file leak fix shipped (`scripts/llm_judge_calibration.mjs`, uncommitted)
- **2026-07-05**: 2 warnings + B2 deferred → #188
- **2026-07-05**: B2 not in scope of #182 #12 (intentionally skipped to keep surgical)

### ⏳ 待做決定

| # | Decision | Options | Trigger |
|---|----------|---------|---------|
| **D1** | B2 fix scope — 全 llm_judge_calibration.mjs 重寫用 `discord.push()`，定只 migrate Discord push section？ | full = 一致性, partial = 小改動 | 實作前 |
| **D2** | W1 regex 重寫要唔要係 #182.5 (Phase A audit improvement) 處理？ | Same = 易關連, separate = 隔離 | 評估 |
| **D3** | W2 是補 `86400` 入 whitelist 定通盤審計 startup_dashboard.js 所有時間常數？ | Quick patch = 快, audit = 完整 | 評估 |

## Q - Questions（未解決）

### ❓ 核心問題

1. **B2 改 `discord.push()` 後 file attach 仲 support 嗎？** — discord_push.js 有 `attachmentPath` 嗎？需要 verify API surface
2. **W1 regex dup 真係 bug 定是 design？** — 重複 pattern 喺 regex 內係 common optimization，定真係 typo？需要 trace git blame
3. **W2 `86400` 真係時間常數？** — startup_dashboard.js:223 用法係咩？可能係 retry interval 而不是 time conversion
4. **3 items 適合 batch fix 還是分開做？** — 3 件都唔 related，但都係 audit artifact

### 🔍 追問（蘇格拉底反詰）

- **B2 點解之前用 raw `openclaw` 而非 `discord.push()`？** — 因為個 script send 嘅係 `--file` attachment，唔係 plain `--message` text。discord_push.js 可能 API surface 唔支援 file attachment，需要擴展或用 fallback
- **W1 同 W2 點解 audit sub-agent 唔一齊 fix？** — 因為係 warnings 唔係 bugs，scope creep 風險。建議 follow-up track
- **如果 audit 經常呢類 warnings 累積，咁 audit quality 點 improve？** — 可能要加 `audit_to_skill_emitter` rule，將 repeated warnings upgrade 去 blocking checks

## Progress

### Phase 1: Recon (Day 1-3)
- [ ] **Step 1.1**: 讀 `scripts/lib/discord_push.js` 完整 source — confirm `attachmentPath` / `--file` support
- [ ] **Step 1.2**: 讀 `scripts/llm_judge_calibration.mjs` 完整 source — understand file attach context
- [ ] **Step 1.3**: 讀 `scripts/startup_dashboard.js:223` — confirm `86400` 用法 (sec/day vs retry interval)
- [ ] **Step 1.4**: 讀 `scripts/lib/auditOrchestrator.js:445-460` — 確認 W1 regex 重複是 intentional

### Phase 2: B2 Fix (Day 3-7)
- [ ] **Step 2.1**: 如果 discord_push API 支持 file attachment → migrate llm_judge_calibration
- [ ] **Step 2.2**: 如果 discord_push API 唔支持 → extend discord_push.js 加 `attachmentPath` param (亦惠及其他 use cases)
- [ ] **Step 2.3**: 移除 raw `execFileSync('openclaw', ...)` call site
- [ ] **Step 2.4**: Verify node --check + verify_edit P0 = 0

### Phase 3: W1 + W2 Fix (Day 5-10)
- [ ] **Step 3.1**: W1 — simplify regex if confirmed duplication, OR add comment explaining intentional
- [ ] **Step 3.2**: W2 — add `86400` to `TIME_CONSTANT_WHITELIST`, OR 通盤 audit startup_dashboard 嘅時間常數用法
- [ ] **Step 3.3**: Verify audit FP rate doesn't regress on 26-sample set

### Phase 4: Commit (Day 7-10)
- [ ] **Step 4.1**: Stage all 3 changes
- [ ] **Step 4.2**: Single commit "fix(audit/llm-judge): address audit follow-ups (#188)"
- [ ] **Step 4.3**: Push (will hang on tarball issue #186, but commit stays local)

### Closing criteria (Day 14, 7-19)
```
✅ PASS: All 3 items fixed + audit FP rate stable + verify clean
🟡 PARTIAL: B2 fixed, W1/W2 still pending
🟠 NEEDS MORE: B2 blocked by discord_push.js API extension (needs design)
🔴 REGRESSION: W2 patch 令其他 time constants 被 excluded (false negative)
```

### Rollback plan
- Single `git revert <commit-sha>` for the whole batch
- OR `git checkout HEAD -- scripts/lib/discord_push.js scripts/lib/auditOrchestrator.js scripts/llm_judge_calibration.mjs`

### Cross-references
- **Trigger:** #182 re-audit 2026-07-05
- **Parent:** #182 (5/5 done, ready to close)
- **Related:** `scripts/lib/discord_push.js` (potential API extension target)
- **Related:** `scripts/startup_dashboard.js` (W2 trigger script)
- **Related:** #186 (git history tarballs, blocking push)

### Out of scope
- ❌ Don't fix B2 without verifying discord_push API first
- ❌ Don't touch auditOrchestrator AST changes (#9 work) — only W1 regex dup
- ❌ Don't migrate other raw openclaw callers (different issue, scope creep)

## Notes

### Why not fix W1/W2 in the same session?

M3 sub-agent (audit) flagged them as WARNINGS (P3 severity), not BUGS:
- W1: Regex dup probably intentional, may simplify later
- W2: Whitelist miss would generate audit FP but not break anything functionally

Per #182 scope discipline, only B1 (real bug) was in-scope. Warnings tracked separately.

### B2 Complexity

`llm_judge_calibration.mjs` use case is unique — pushes a multi-line report file as attachment (`--file` flag), not inline `--message`. discord_push.js's `push()` is designed for inline message. May need API extension (`pushAttachment()` or `attachmentPath` option). Sub-agent explicitly skipped this as scope creep.

**Recommended path:** Extend discord_push.js with attachment support, then migrate llm_judge_calibration. This is a small change that benefits future use cases.
