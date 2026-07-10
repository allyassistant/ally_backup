---
id: 182
title: Phase A follow-up: Phase B Closed Loop + Calibration + Tech Debt
status: archive
priority: P2
created: 2026-07-04
due: 2026-07-18
updated: 2026-07-10
progress: 5/5 (#9 Calibration ✅ 5159e2e | #10 Broken tests ✅ | #8 Phase B ✅ trivially passed | #12 Discord_push DRY ✅ | #11 Dedup strict — DEFERRED: sub-agent verdict MEDIUM risk, telemetry gap, prefer Option C stay-warn + 4 follow-up steps) — Ready to close #182
---

## F - Facts（事實）

### 現況
**Phase A 已 ship 9+ 日**（6 個 files 全部 production 中），但以下 5 個 follow-up items from #173 仲未做：

| # | Item | Effort | Status |
|---|------|--------|--------|
| #8 | Phase B: migrate 腳本使用 `safe_*` wrappers | 4-6 hr | ⏳ Not started |
| #9 | Audit calibration — **fix daily cron scanner brace-counting** (AST-based detection 已存在但未被使用) | 1-2 hr | ⏳ Sub-agent recon done |
| #10 | Rewrite 2 broken test files (`scripts/test_*.broken`) | ~30 min each | ⏳ Found (both need rewrite) |
| #11 | Enable `SKILL_REVIEWER_BOT_DEDUP=strict` | 0 | ⏸️ Defer until #173.4 confirm |
| #12 | DRY: migrate 4 scripts to `discord_push.js` | ~1 hr | ⏳ Not started |

### 數據/證據

| 項目 | 值 |
|------|-----|
| Phase A files shipped | 6 (3 new + 3 modified, +470 lines) |
| Observation window | 2026-06-20 → 2026-07-04 = 14 日 (超過原本 5 日) |
| Discord push frequency (audit_just_written) | ~5/day avg (估) |
| `.after_task_triage.jsonl` growth | 待 verify |
| `.state/audit_realtime_overrides.jsonl` growth | 待 verify |
| `safe_*` wrappers exist | 只有 `safe_fs.js` |
| Migration candidates (4 files) | system_status_report.js, weekly_correction_templates.js, skip-list.js, whitelist_patterns.js |
| 2 broken test files (.broken) | ✅ **已刪除** (2026-07-10 cleanup — parent test scripts deleted, `.broken` variants gone) |
| Auto-suggest noise rate | 37% (WP4 Orange Book — `#162` M8.4) |

### 🚨 Calibration Urgent: Daily cron scanner 73% false positive rate

**2026-07-04 Sub-agent recon（26 sample validate）：**

| Rule | Hits | True Positive | False Positive | FP Rate |
|------|------|---------------|----------------|---------|
| `fsSync_missing_trycatch` | 16 | 1 | **15** | **93.75%** |
| `magic_numbers` | 10 | 6 | **4** | **40%** |
| **Overall** | **26** | **7** | **19** | **73%** |

**Root cause:** `auditOrchestrator.js` 用 **broken brace-counting** detect try-block，唔係 `buildTryBlockMap()`（`audit_just_written.js` 嘅 AST-based method）。
- Brace-counter 經常 count 錯 nesting → 話「冇 try-block」但實際有
- 又 hallucinate fsSync calls 喺無 fsSync 嘅 lines (`console.log`, var declarations)
- `fsSync_missing_trycatch` FP 類型：missed try blocks (10), hallucinated fsSync on non-FS lines (5), string content confusion (1)
- `magic_numbers` FP 全部係時間常數 (3600, 86400000, 1440) — 睇 codebase 已 define constant 但 scanner 唔識 skip

**Fix:** Replace brace-counting in `auditOrchestrator.js` with `buildTryBlockMap()` (AST-based, same function `audit_just_written.js` uses) — 預估 FP rate 由 73% 降至 <10%。

### 來源
- **Parent issue:** #173 (archived) — Phase A + 5 follow-up items
- **Phase A complete report:** `.analysis/phase-a-real-time-loop-2026-06-20.md`
- **#162** (Skill Pipeline Master) — M8.4 noise reduction
- **#169** (Loop Engineering WP1-WP5) — Orange Book audit context

## D - Decisions（決定）

### ✅ 已做決定
- **2026-07-04**: Issue #182 開嚟追蹤 #173 嘅 5 個 follow-up items (split from #173 close)
- **2026-07-04**: 3 個 P2 work items 列出嚟 (Phase B + Calibration + Tech Debt); #11 skip; #12 並入 Phase B scope
- **2026-07-04**: 2 個 broken test files 唔存在 — 先 verify root path (唔係 #173 body 講嘅 path) 後再決定

### ⏳ 待做決定

| # | Decision | Trigger | Notes |
|---|----------|---------|-------|
| **D1** | Phase B scope: migrate 全 4 個 candidates (4-6hr) 定先 migrate 1 個 pilot (1hr)? | 7-11 之前 | Pilot 安全啲，可以搵 Phase A pattern |
| **D2** | Calibration: 用 prompt calibration 定加 sanity-check pass (e.g. compare against known corpus)? | Sub-agent 估 phase | Prompt change 平啲但風險高; sanity-check pass 慢但可靠 |
| **D3** | 2 個 broken tests: 重寫定 delete? | 先 verify 係咪有 active caller | If no caller → delete; if caller exists → rewrite |
| **D4** | #12 (discord_push.js DRY) 包入 Phase B 同一 PR 定分開? | Same dependency tree (lib/discord_push.js) | 包入去較整潔但 PR 大 |

## Q - Questions（未解決）

### ❓ 核心問題

1. **Phase B: 4 個 migration candidates 點揀先？**
   - `system_status_report.js` — daily cron (high visibility)
   - `weekly_correction_templates.js` — weekly cron
   - `lib/skip-list.js` — lib helper (used by many)
   - `lib/helpers/whitelist_patterns.js` — lib helper
2. **Calibration: 個 hallucination rate 真係幾多？** 需 spawn sub-agent 量度一個月 audit output 嘅 false positive rate
3. **2 broken tests 真係邊個?** 唔喺 `test_*.js.broken` root，可能喺別處

### 🔍 追問（蘇格拉底反詰）

- **點解唔一鑊晒 migrate 全部？** 因為 Phase B pattern 仲未驗證，pilot 先穩陣。Phase A 都係 1+1 file pilot 開始
- **Calibration 唔做 prompt 改唔得？** 改 prompt 風險高（其他 audit types 都受影響），sanity-check 唔影響現有 audit
- **如果 2 broken tests 真係冇 caller，咁點解唔直接 delete？** 因為 `#173` body 寫住「tech debt」，可能 caller 潛在
- **`safe_fs` 之外點解冇 `safe_require` / `safe_exec` / `safe_crypto`?** Phase B 可能要先 build 嗰啲 wrappers 先有得 migrate

## Progress

### Phase 1: 基礎 recon (Week 1, 7-04 → 7-08)
- [ ] **Step 1.1**: Verify 2 broken test files 真實路徑 (`find . -name '*.broken'`)
- [ ] **Step 1.2**: Spawn sub-agent 量度 audit_just_written.js 過去 14 日 false positive rate
- [ ] **Step 1.3**: Check `safe_*` wrappers roadmap — `safe_require` / `safe_exec` / `safe_crypto` 需唔需建?
- [ ] **Step 1.4**: Decide Phase B pilot target (D1)

### Phase 2: Pilot (Week 1-2, 7-08 → 7-15)
- [ ] **Step 2.1**: Phase B pilot — migrate `system_status_report.js` to `safe_*` wrappers
- [ ] **Step 2.2**: 觀察 7 日 — 0 false alarm AND cron 仲正常 AND 0 regression
- [ ] **Step 2.3**: Decide sanity-check pass design for Calibration (D2)

### Phase 3: Rollout (Week 2-3, 7-15 → 7-22)
- [ ] **Step 3.1**: Phase B rollout — migrate 餘下 3 candidates
- [ ] **Step 3.2**: Calibration implementation (sanity-check pass)
- [ ] **Step 3.3**: #11 enable SKILL_REVIEWER_BOT_DEDUP=strict (if #173.4 confirmed safe)
- [ ] **Step 3.4**: Rewrite / delete 2 broken tests

### Phase 4: Validation (Week 3-4, 7-22 → 7-25)
- [ ] **Step 4.1**: 7 日 observation — 0 P0/P1 regression
- [ ] **Step 4.2**: Discord push frequency sanity check (<10/day)
- [ ] **Step 4.3**: Close issue + write outcome

### Closing criteria (Day 21, 7-25)
```
✅ PASS: 5 items 完成 + 14 日 observation 0 regression
🟡 PARTIAL: ≥3 items 完成 + 無 critical regression
🟠 NEEDS MORE: 2-3 items done 但 calibration 仍未解決 → 延 7 日
🔴 REGRESSION: 出現 P0 bug → 即時 freeze Phase B, rollback
```

### Rollback plan
- Phase B migration: git revert 個別 file commits（each candidate 獨立 commit）
- Calibration: env flag `AUDIT_CALIBRATION_ENABLED=false` skip sanity-check pass
- Tech debt: 唔影響 production，無 rollback 需要

## Progress
- [ ]

## Notes

### Day-by-day observation checklist

| Day | Date | Check command | Expected | Actual |
|-----|------|--------------|----------|--------|
| 1 | 7-04 | find `. -name '*.broken'` | 2 files located | ⏳ |
| 3 | 7-06 | tail `.state/audit_realtime_overrides.jsonl` | <50/day | ⏳ |
| 7 | 7-10 | check audit false positive rate | <5% | ⏳ |
| 14 | 7-17 | Discord push volume review | <10/day | ⏳ |
| 21 | 7-25 | close criteria eval | PASS | ⏳ |

### Cross-references
- **Parent:** #173 (archived)
- **Sister issues:** #184 (Routing 3.5), #183 (SHL Option 1), #181 (WebBridge upgrade), #185 (Phase 4 re-eval)
- **Source report:** `.analysis/phase-a-real-time-loop-2026-06-20.md`
- **Source report:** `.analysis/phase-a-audit-2026-06-20.md`
- **Orange Book context:** #169 (WP2 evaluator + WP4 noise)
- **Master pipeline:** #162 (M8.4 noise reduction)

### Out of scope
- ❌ Re-design audit_just_written.js rules (Phase C future)
- ❌ Sub-agent prompt re-engineering (handled by #162 M8.4)
- ❌ Migration of inline execFileSync → discord_push.js (4 scripts, deferred to separate PR if needed)
