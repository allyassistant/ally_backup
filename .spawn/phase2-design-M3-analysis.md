# Phase 2 Design — Opt-in Writers for CQM `fix` + Audit Repair `applyFix`

**Issue:** #189 — Auto-Fix System Phase 0 — Disable Silent Mutations
**Phase:** 2 of 4 (Phase 0+1 ✅ DONE 2026-07-10; Phase 3 = confidence gate ≥ 0.85, Phase 4 = diff watcher — both OUT OF SCOPE)
**Author:** MiniMax M3 sub-agent (SPAWN_QUALITY route)
**Created:** 2026-07-10 12:53 HKT
**Status:** Draft for Josh review

---

## 1. Scope & Non-Goals

### 1.1 一句總結

**Phase 2 嘅目標：為 CQM `fix` 同 Audit Repair `applyFix` 引入 explicit `--apply` flag，俾 human-triggered writes 重新 enable，但係寫入動作必須由人類喺 < 60 秒內 explicit opt-in 先會發生。**

### 1.2 In scope ✅

- CQM `fix` subcommand 加 `--apply` flag（預設仍係 read-only `scan` 行為）
- Audit Repair `--apply` flag 連去 `applyFix` 寫入路徑（保留 `safeWriteSync` barrier）
- Audit trail：每次 `--apply` 觸發都 emit telemetry event 落 `.self_healing_loop.jsonl`（mirror SHL pattern）
- Cron config **保持 read-only / dry-run**，唔 re-enable auto-apply
- Surgical code change：只改 CQM `cmdFix` + `audit_repair_proposer.js` argv 解析 + telemetry emit
- HEARTBEAT.md Phase 2 row added

### 1.3 Out of scope ❌（explicit defer）

- ❌ **Confidence gate ≥ 0.85** — Phase 3（`.issues/active/189-...md` 寫明）
- ❌ **Diff watcher** — Phase 4
- ❌ **改 SHL Phase 1 env guard** — 唔郁 `extensions/self-healing-loop/index.mjs:434`
- ❌ **Refactor** — surgical only
- ❌ **改 `safeWriteSync`** — 保留 L2 barrier

---

## 2. CQM `--apply` 設計

### 2.1 設計選擇（rationale）

**Q1：default behavior 點揀？**

| Option | Description | Trade-off |
|--------|-------------|-----------|
| A. `fix` default = propose，`--apply` 先 write | 跟 Phase 0 嘅 `scan` 路線統一 | ✅ 最保守；❌ 變 breaking change（目前 `fix` 仲係 default write）|
| B. `fix` default = write，`--apply` 顯式 trigger | 保留 manual `fix` 嘅直覺性 | ❌ 違反 Phase 0 精神（auto-mutate 風險重現）；✅ backward compat |
| C. **Chosen：** `fix` default = dry-run preview，`--apply` 先 write | `fix` 變成 preview by default；要 write 必須加 `--apply` | ✅ 安全 + 直觀；✅ matches `audit_repair_proposer.js --dry-run` pattern |

**揀 Option C 嘅理由：**
1. 同 `audit_repair_proposer.js` 嘅 `--dry-run` pattern 一致（已存在，唔破壞 mental model）
2. Phase 0 嘅精神係「auto-fix 路徑全部 default-off」；Option C 維持呢個 invariant
3. Sub-agent `fix` 命令嘅 use case 通常係「我見到問題想 preview 先」 — preview 唔再需要 `--dry-run` flag

### 2.2 Flag name

**揀 `--apply`**（唔係 `--write` / `--commit` / `--execute`）

| Flag | 評分 | Reason |
|------|------|--------|
| `--apply` | ⭐⭐⭐⭐⭐ | Matches existing `proposal_action.js apply <id>`（已 ship，muscle memory）；Audit Repair `applyFix` function naming 也係 `apply` prefix |
| `--write` | ⭐⭐ | OK but 暗示 unconditional write；`--apply` 更貼近「apply this proposal」mental model |
| `--commit` | ⭐ | Confusing — `commit` 通常指 git commit；容易混淆 |
| `--execute` | ⭐⭐ | 太 generic；--apply 更有針對性 |

### 2.3 Behavior matrix

| Command | Effect | Files touched |
|---------|--------|---------------|
| `node code_quality_manager.js fix` (default, no flag) | **Preview** — like `--dry-run`；show planned fixes；exit 0 | 0 |
| `node code_quality_manager.js fix --dry-run` | Same as default — explicit preview | 0 |
| `node code_quality_manager.js fix --apply` | **Write** — applies HIGH-confidence auto-fixes via `auto_fix.js` | `scripts/*.js` (HIGH only) |
| `node code_quality_manager.js fix --apply --verbose` | Write + per-file change log | same |

> **Idempotency check（Q1 嗰個 sub-question）：** Phase 0 之後 `node scripts/code_quality_manager.js fix`（無 flag）會變 preview — **呢個係有意 breaking change**，但影響 surface 細（manual trigger only；HEARTBEAT.md 同 AGENTS.md 都已標明「Manual human-triggered intentional — keep available」），用戶一望 help 就知。

### 2.4 UX flow (`fix --apply`)

```
$ node code_quality_manager.js fix --apply
🔧 Running auto-fix (--apply mode)...

   📋 Phase 0+2 safety checks:
   ✓ --apply flag present
   ✓ interactive terminal (TTY)
   ✓ no --quiet flag (must show intent)
   ✓ log: telemetry emitted to .self_healing_loop.jsonl

🔍 Step 1/3: Scanning 147 files...
   ✓ 8 issues found (3 HIGH, 4 MEDIUM, 1 LOW)

📊 Step 2/3: Classifying by confidence...
   ✅ HIGH (3) — eligible for --apply
   ⏸️ MEDIUM (4) — propose only, need manual review
   ⏸️ LOW (1) — skip + learn

📝 Planned changes:
   ┌──────────────────────────────────────────────────────────────┐
   │ 1. scripts/foo.js:42  [magic-number-constant-extractor]      │
   │    + const MAX_RETRIES = 3;                                  │
   │    - retry_count = 3;                                        │
   │ 2. scripts/bar.js:18  [hardcoded-home-path]                  │
   │    + const HOME = process.env.HOME;                          │
   │    - /Users/ally/.openclaw/workspace                         │
   │ 3. scripts/baz.js:99  [error-handling-missing]               │
   │    + try { ... } catch (e) { ... }                           │
   └──────────────────────────────────────────────────────────────┘

⚠️  About to write 3 files via auto_fix.js → safeWriteSync barrier.
    Each write backed up to .safe_write_backups/<file>.bak.<ISO>.
    Post-write validation runs `node --check` automatically.
    Type 'yes' to continue, anything else to abort: yes

🔧 Step 3/3: Applying...
   ✅ scripts/foo.js (HIGH) — bytes: 4123, dur: 87ms, backup: .safe_write_backups/foo.js.bak.2026-07-10T12-55-03
   ✅ scripts/bar.js (HIGH) — bytes: 2891, dur: 65ms, backup: .safe_write_backups/bar.js.bak.2026-07-10T12-55-03
   ✅ scripts/baz.js (HIGH) — bytes: 1024, dur: 32ms, backup: .safe_write_backups/baz.js.bak.2026-07-10T12-55-03

✅ Auto-fix completed (3/3 HIGH applied)
🔄 Re-scanning to verify... (no regressions found)

📊 Telemetry: cqm_apply → .self_healing_loop.jsonl
```

### 2.5 Edge cases

| Case | Behavior |
|------|----------|
| `--apply` 但 stdout 唔係 TTY（cron / pipe） | **Abort** — print error："--apply requires interactive TTY. Use --apply --yes to skip confirmation (NOT recommended for cron)". |
| `--apply --quiet` | **Abort** — print error："--apply + --quiet is forbidden (silent write). Remove --quiet." |
| `--apply` 但 AUTO_FIX_TIMEOUT_MS timeout | safeWriteSync 自己 rollback；report partial success |
| `--apply` 時 env var `CQM_AUTO_APPROVE=true` 設定咗 | Bypass confirm prompt（for trusted batch use only）; emit telemetry `cqm_apply_unattended` event |
| `--apply` 但 `audit_just_written.js` 偵測到 file 喺 < 60s 被改過 | **Abort** — print error："file was modified recently (likely race with another tool). Run scan + diff first." |

### 2.6 Surgical code change（line estimate）

| File | Line | Change |
|------|------|--------|
| `scripts/code_quality_manager.js:584-602` | `setupCommands().commands.set('fix', ...)` | 加 `{ flag: '--apply', desc: 'Apply HIGH-confidence fixes (requires TTY, no --quiet)' }` |
| `scripts/code_quality_manager.js:1153-1210` | `cmdFix(parsed)` | Branch on `parsed.options.apply`：if true → set `CQM_AUTO_APPROVE=1` + 顯示 plan + TTY confirm + delegate to auto_fix.js；if false → default = preview mode (skip auto_fix.js execFileSync entirely) |
| `scripts/code_quality_manager.js:1285-1287` | `cmdHelp()` examples | 加 `code_quality_manager.js fix --apply` |

**Estimated diff:** ~40-60 lines net（surgical; preserve all existing scan/dry-run logic）。

---

## 3. Audit Repair `--apply` 設計

### 3.1 設計選擇（rationale）

**Q2：propose/apply 流程點 split？**

| Option | Description | Trade-off |
|--------|-------------|-----------|
| A. 同一 script `audit_repair_proposer.js` 加 `--apply` | `--apply` = propose + apply combined | ❌ Confusing — `--apply` 但 cron 又用 `--dry-run`；mental load |
| B. Separate script `audit_repair_applier.js` | 只做 apply；propose 仍喺 proposer | ✅ 單一職責；❌ 多一個 file 要 maintain |
| C. **Chosen：** Same script，`--apply` = 同時 propose + apply（auto-apply mode） | `--apply` flag = "not just propose, also call applyFix for eligible issues" | ✅ Simple；✅ matches SHL pattern；✅ backward compat（唔加 flag = same as `--dry-run`） |

**揀 Option C 嘅理由：**
1. `audit_repair_proposer.js` 已經 export `applyFix`（line 819），separate script 要重新 wire — 重複 effort
2. `proposal_action.js apply <id>` 已 ship 嘅 single-proposal apply path；Phase 2 嘅 `--apply` 係 batch version
3. Phase 0 crontab 已經用 `--dry-run`；Phase 2 唔需要 rewire cron，**crons 繼續 `--dry-run`**

### 3.2 Flag name

**`--apply`** — same as CQM（consistency；一個 mental model）

### 3.3 Behavior matrix

| Command | Effect | Files touched |
|---------|--------|---------------|
| `node audit_repair_proposer.js` (no flag, default) | Same as Phase 0 cron path — propose only, NO applyFix writes | 0 |
| `node audit_repair_proposer.js --dry-run` | Explicit preview | 0 |
| `node audit_repair_proposer.js --apply` | **Propose + Apply** auto-fix eligible issues (via `applyFix()` via `safeWriteSync`) | `scripts/*.js` (auto-fix eligible only) |
| `node audit_repair_proposer.js --apply --dry-run` | Conflicting flags → error "use --apply OR --dry-run" | 0 |
| `node audit_repair_proposer.js --proposals-only` | Existing dry-run semantics, propose to JSON, no apply | 0 |

> **Phase 0 backward compat：** default no-flag behavior 唔變（仍 propose only / dry-run）。`--apply` 係 opt-in。

### 3.4 UX flow (`--apply`)

```
$ node audit_repair_proposer.js --apply
🔧 audit_repair_proposer.js — Phase 2e: audit → AUTO-APPLY (Phase 2 --apply mode)

📥 Reading: .state/audit_orchestrator_results.json
   ✓ 12 issues parsed (3 high, 5 medium, 4 low)

🎯 Decision matrix:
   ┌──────────┬─────────┬──────────────────┐
   │ Severity │ Tier    │ Action           │
   ├──────────┼─────────┼──────────────────┤
   │ high     │ utility │ ✅ auto-fix      │
   │ high     │ product │ 📝 propose       │
   │ medium   │ utility │ ✅ auto-fix      │
   │ medium   │ product │ 📝 propose       │
   │ low      │ any     │ 📝 propose       │
   └──────────┴─────────┴──────────────────┘

🔧 Will apply 4 auto-fixes via applyFix() → safeWriteSync barrier.
   Each write backed up to .fix_snapshots/<file>.<ts>.<pid>.pre AND .safe_write_backups/<file>.bak.<ISO>.
   M3 advisory (shadow mode): 4 calls budget (FIX_M3_MAX_PER_RUN).

⚠️  About to write 4 files. Type 'yes' to continue, anything else to abort: yes

🔧 Applying...
   ✅ scripts/foo.js:42 (high/utility) — bytes: 4123, dur: 87ms
   ✅ scripts/bar.js:18 (high/utility) — bytes: 2891, dur: 65ms
   ✅ scripts/baz.js:99 (medium/utility) — bytes: 1024, dur: 32ms
   ✅ scripts/qux.js:12 (medium/utility) — bytes: 540, dur: 21ms
   📝 8 proposals written to .state/repair_proposals.json (production-tier, need manual approve)

✅ Audit Repair --apply completed (4 applied, 8 proposed)

📊 Telemetry: audit_apply → .self_healing_loop.jsonl
```

### 3.5 Safety barrier preservation

**Q2 sub-question：** `applyFix` 透過 `safeWriteSync`，Phase 2 應該保留呢個 safety barrier 抑或改？

**Answer：保留 100%。** 三層 defense 都唔郁：

1. **L1 (proposer-internal snapshot):** `.fix_snapshots/<file>.<ts>.<pid>.pre`（line ~388 `snapshot.snapshotFile(absPath)`）
2. **L2 (safeWriteSync barrier):** `.safe_write_backups/<file>.bak.<ISO>` + atomic tmp+rename + post-write `node --check`（line ~469 `safeWriteSync({ ... })`）
3. **L3 (validation gate):** `validateFix()` syntax/identifier/semantic check BEFORE write（line ~430-450）

**Phase 2 只加一層 L0 (entry gate):** 進入 `applyFix` 路徑必須通過 `--apply` flag + TTY + confirm prompt。

### 3.6 Surgical code change（line estimate）

| File | Line | Change |
|------|------|--------|
| `scripts/audit_repair_proposer.js:96-98` | `args = new Set(process.argv.slice(2))` | Add `const APPLY = args.has('--apply');` |
| `scripts/audit_repair_proposer.js:96-98` | 同上 | Add conflict check：`if (APPLY && DRY_RUN) { console.error('❌ --apply and --dry-run are mutually exclusive'); process.exit(2); }` |
| `scripts/audit_repair_proposer.js:98-100` | `DRY_RUN = args.has('--dry-run')` | Override：`if (APPLY) DRY_RUN = false;` (apply path can't also be dry-run) |
| `scripts/audit_repair_proposer.js:114-122` | `printHelp()` | Add `--apply` row |
| `scripts/audit_repair_proposer.js:361-405` | `applyFix(absPath, issue, dryRun, graph)` | Add early-stage TTY + 60s recency check（同 CQM 一樣 pattern）|
| `scripts/audit_repair_proposer.js:706-720` | `decision.action === 'auto-fix'` branch | Wrap `applyFix(...)` call with confirm prompt（only when `APPLY && !DRY_RUN`）|
| `scripts/audit_repair_proposer.js:790-795` | Final summary | Add `if (APPLY) console.log(\`   ⚠️  APPLY MODE — ${autoFixCount} files modified\`);` |
| `scripts/audit_repair_proposer.js:815-825` | exports | Add `APPLY` to `module.exports` for testing |

**Estimated diff:** ~50-80 lines net（surgical）。

### 3.7 Crontab 唔郁

`crontab -l | grep audit_repair` 而家係：
```
45 4 * * * ... node scripts/audit_repair_proposer.js --dry-run >> ...
```

**Phase 2 唔改。** Cron 繼續 `--dry-run`（propose only）。理由：
- Cron 唔可能過 TTY confirm prompt（defense-in-depth）
- Cron 嘅 surface 已經 read-only by Phase 0；re-enable 等於開返 Phase 0 嘅 box
- 如果將來要 cron-driven apply，應該喺 Phase 3（confidence gate）先做 — 唔係 Phase 2 嘅 scope

---

## 4. Cron Config

### 4.1 Phase 2 之後 cron 狀態

| Cron | Phase 0 state | Phase 2 state | Verdict |
|------|---------------|---------------|---------|
| CQM `2f9b5b1c-...` 10:00 | `scan --quiet --enable-skill-scan` | **unchanged** | ✅ keep scan-only |
| Audit Repair (system crontab 04:45) | `--dry-run` | **unchanged** | ✅ keep propose-only |
| Hidden Drift Detector 03:50 | unchanged (read-only) | **unchanged** | ✅ keep |

### 4.2 唔建議嘅 patterns（紅旗）

| Pattern | Why NOT |
|---------|---------|
| 週末 maintenance window：`30 3 * * 0 ... --apply` | Cron 唔可能 TTY confirm；即使加 `CQM_AUTO_APPROVE=true` 都係 revert 返 Phase 0 嘅 silent-mutation 風險 |
| Discord reaction-based approval → cron check + apply | 可能係 Phase 3 / 4 scope；但**唔係 Phase 2 surgical change** |
| `--apply` 開返 cron 自動 mode | 直接違反 Phase 0 嘅「zero new silent mutations」目標 |

**結論：** Crons 100% read-only / dry-run，永久。

### 4.3 唯一 acceptable cron usage

**冇。** `--apply` 純粹 human-triggered（TTY required）。

---

## 5. Telemetry Events

### 5.1 SHL pattern（reference）

從 `extensions/self-healing-loop/index.mjs:434`:
```javascript
if (process.env.SHL_APPLY !== "true") {
  void logTelemetry(state, "advisory_skip", {
    file: filePath,
    errors: verifyErrors.length,
    mode: cfg.mode,
    hint: "set SHL_APPLY=true to re-enable auto-fix",
  });
  return;
}
```

→ Event name: `advisory_skip`；payload: `{ file, errors, mode, hint }`；log 落 `.self_healing_loop.jsonl` (line 96).

### 5.2 Phase 2 telemetry events（mirror pattern）

| Event name | Trigger | Payload schema |
|------------|---------|----------------|
| `cqm_apply_requested` | `fix --apply` invoked | `{ ts, user, tty, files_planned: N, files_to_apply: N, confidence_threshold: 'HIGH' }` |
| `cqm_apply_confirmed` | TTY confirm passed | `{ ts, files_planned: N, files_to_apply: N }` |
| `cqm_apply_aborted` | TTY confirm rejected / TTY missing / --quiet + --apply | `{ ts, reason: 'tty_missing' \| 'user_rejected' \| 'quiet_conflict' \| 'recency_check', files_planned: N }` |
| `cqm_apply_completed` | All files written successfully | `{ ts, files_written: N, total_bytes: N, duration_ms: N, backups: ['.safe_write_backups/foo.js.bak.X', ...] }` |
| `cqm_apply_partial` | Some writes failed | `{ ts, files_written: N, files_failed: N, errors: [{ file, error }] }` |
| `audit_apply_requested` | `--apply` invoked | `{ ts, user, tty, total_issues: N, auto_fix_eligible: N, propose_only: N }` |
| `audit_apply_confirmed` | TTY confirm passed | `{ ts, auto_fix_eligible: N }` |
| `audit_apply_completed` | All auto-fixes applied | `{ ts, applied: N, proposed: N, duration_ms: N, m3_advisory_calls: N }` |
| `audit_apply_failed` | Validation rejected | `{ ts, attempted: N, failed: [{ file, rule, reason }] }` |

### 5.3 Telemetry writer

**Q4 sub-question：** SHL 用 `logTelemetry(state, event, fields)` async 寫 `.self_healing_loop.jsonl` with rotation (5MB)。Phase 2 應該 mirror。

**推薦：** Reuse `logTelemetry` 個 pattern，**唔**直接 call SHL extension（decoupling）。Phase 2 喺 CQM 同 Audit Repair 各加一個 local helper：

```javascript
// CQM (code_quality_manager.js top-level)
function emitTelemetry(event, fields) {
  try {
    const TELEMETRY_FILE = path.join(WS, '.self_healing_loop.jsonl');
    const record = {
      ts: new Date().toISOString(),
      event,
      source: 'cqm', // 'cqm' | 'audit_repair'
      ...fields,
    };
    fs.appendFileSync(TELEMETRY_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (e) {
    // Telemetry is best-effort. Never let it break the host.
  }
}
```

→ Same file path (`.self_healing_loop.jsonl`) + same rotation strategy (5MB) + same JSONL schema (ts + event + sessionKey + fields)。**冇 coupling** with SHL extension — 兩邊各自 emit 落同一 file（後續可以 grep `event: "cqm_apply_*"` filter）。

> **Why same file?** Single audit trail surface（Phase 4 diff watcher 嘅 input source）。統一方便 grep / dashboard / Discord notify。

### 5.4 Dashboard / alert wiring（Phase 2 唔做，但留 hook）

Phase 4（diff watcher）會自動 listen `.self_healing_loop.jsonl`，所以 Phase 2 唔需要加 Discord notification。**但**可以加一個 Phase 3 hook：`cqm_apply_completed` event trigger Discord summary post（out of scope）。

---

## 6. Surgical Code Changes Summary

### 6.1 File-by-file diff estimate

| File | LoC change | Risk |
|------|-----------|------|
| `scripts/code_quality_manager.js` | +50/-10 (cmdFix + cmdHelp) | 🟡 Low（新增 branch；default behavior 改但向後兼容 preview）|
| `scripts/audit_repair_proposer.js` | +60/-5 (argv parse + applyFix wrapper + printHelp) | 🟡 Low（新增 branch；`--dry-run` path 完全唔郁）|
| `HEARTBEAT.md` | +15 (Phase 2 row added to 🚦 Auto-Fix section) | 🟢 Trivial |
| `.issues/active/189-...md` | +20 (Phase 2 progress section) | 🟢 Trivial |

**Total:** ~3 files, ~145 LoC net add, 0 LoC removed-from-existing-behavior.

### 6.2 Files NOT touched（explicit）

| File | Why NOT |
|------|---------|
| `extensions/self-healing-loop/index.mjs` | Phase 1 已 ship；Phase 2 唔郁 SHL |
| `scripts/auto_fix.js` | 已有 `--dry-run`；Phase 2 唔變 default；only called by CQM via execFileSync |
| `scripts/safe_write.js` | L2 barrier 唔郁 |
| `scripts/snapshot.js` | L1 barrier 唔郁 |
| `scripts/proposal_action.js apply` | 已經 ship；single-proposal apply 唔變；Phase 2 係 batch version |
| `extensions/skill-auto-suggest/index.mjs` | Skill scan 唔郁 |

---

## 7. Test Plan

### 7.1 Unit-level tests

| Test | Setup | Expected |
|------|-------|----------|
| T1. `cqm fix` (no flag) → preview mode | Run `node code_quality_manager.js fix` on workspace | exit 0；0 files touched；preview printed |
| T2. `cqm fix --dry-run` → same as T1 | Same | Same |
| T3. `cqm fix --apply` in TTY → confirm prompt + apply | Run interactively；type "yes" | exit 0；HIGH-confidence files modified；safeWriteSync backup created；telemetry emitted |
| T4. `cqm fix --apply` in pipe (no TTY) → abort | `echo "" \| node code_quality_manager.js fix --apply` | exit 1；error "--apply requires interactive TTY" |
| T5. `cqm fix --apply --quiet` → abort | Same | exit 1；error "--apply + --quiet is forbidden" |
| T6. `audit_repair_proposer.js` (no flag) → propose only | Run with `.state/audit_orchestrator_results.json` fixture | 0 files touched；proposals written to `.state/repair_proposals.json` |
| T7. `audit_repair_proposer.js --dry-run` → same as T6 | Same | Same |
| T8. `audit_repair_proposer.js --apply` in TTY → confirm + apply | Run interactively | exit 0；auto-fix eligible files modified；proposals written |
| T9. `audit_repair_proposer.js --apply --dry-run` → conflict error | Same | exit 2；error "--apply and --dry-run are mutually exclusive" |
| T10. `audit_repair_proposer.js --apply` with no auto-fix eligible issues | Empty fixture | exit 0；"0 auto-fix eligible, N propose" |

### 7.2 Integration tests

| Test | Setup | Expected |
|------|-------|----------|
| T11. Crontab 不變 | `crontab -l \| grep -E "audit_repair\|cqm"` | `audit_repair` 行仍然 `--dry-run`；CQM cron 仍然 `scan`（唔係 `fix --apply`）|
| T12. SHL env guard 不變 | `grep "SHL_APPLY" extensions/self-healing-loop/index.mjs` | `if (process.env.SHL_APPLY !== "true")` 仍然存在 |
| T13. Telemetry file format | After T3 + T8 | `.self_healing_loop.jsonl` 包含 `cqm_apply_*` + `audit_apply_*` events；JSONL valid；rotation OK |
| T14. Backup recovery | After T3 manually break a file via SHL | Restore from `.safe_write_backups/<file>.bak.<ISO>` works |
| T15. Recency check | Run T3 → immediately re-run T3 | T3 second time should warn "file modified recently" (within 60s) |

### 7.3 Idempotency check（Q1 sub-question）

| Test | Setup | Expected |
|------|-------|----------|
| T16. `cqm fix --apply` after Phase 0 disabled | `node code_quality_manager.js fix --apply` | Works — `fix --apply` 仍識 work（manual human-triggered path 完整）|
| T17. `audit_repair_proposer.js --apply` after Phase 0 | Same | Works — `--apply` flag 重新 enable `applyFix` writes |

### 7.4 Negative tests (防 silent regression)

| Test | Setup | Expected |
|------|-------|----------|
| T18. Cron-based apply should fail | 嘗試 inject `* * * * * ... --apply` | 預期 dry-run on non-TTY → exit 1 with TTY error |
| T19. `--apply` without confirm → no write | `echo "" \| node ... --apply` | exit 1；0 files modified |
| T20. Verify safeWriteSync barrier intact | `node --check` on each modified file | syntax check PASS（safeWrite barrier 自動跑過）|

### 7.5 Verification commands（post-implementation）

```bash
# 1. CQM --apply flag exists
node scripts/code_quality_manager.js help | grep -- "--apply"

# 2. Audit Repair --apply flag exists  
node scripts/audit_repair_proposer.js --help | grep -- "--apply"

# 3. Default behavior unchanged (preview only)
node scripts/code_quality_manager.js fix | head -20  # Should show preview, no write

# 4. Crons unchanged
crontab -l | grep audit_repair_proposer  # Still --dry-run
openclaw cron get 2f9b5b1c-328a-4589-8f4b-a33a7ec387d5 | grep argv  # Still ["scan", ...]

# 5. Telemetry works
node scripts/code_quality_manager.js fix --apply  # In TTY; type yes
tail -5 .self_healing_loop.jsonl | grep cqm_apply

# 6. safeWrite backup created
ls -la .safe_write_backups/*.bak.* | tail -5

# 7. Syntax check
node --check scripts/code_quality_manager.js
node --check scripts/audit_repair_proposer.js
```

---

## 8. Rollback Plan

### 8.1 Per-component rollback（< 5 minutes each）

| Component | Rollback command | Reversal time |
|-----------|------------------|---------------|
| CQM `--apply` | `git checkout HEAD -- scripts/code_quality_manager.js` | < 1 min |
| Audit Repair `--apply` | `git checkout HEAD -- scripts/audit_repair_proposer.js` | < 1 min |
| HEARTBEAT.md Phase 2 row | `git checkout HEAD -- HEARTBEAT.md` | < 1 min |
| Issue #189 progress | `node scripts/issue_manager.js progress 189 --step 0/4` | < 30s |

### 8.2 Full revert

```bash
git revert <phase-2-commit-sha> --no-edit
```

→ Reverts all 3 files; HEARTBEAT.md back to Phase 1 state; crons unchanged.

### 8.3 Emergency disable (without revert)

如果 `--apply` 出事但又未 commit：

```bash
# Option 1: chmod -x to make non-executable
chmod -x scripts/code_quality_manager.js scripts/audit_repair_proposer.js

# Option 2: env var kill switch
export CQM_AUTO_APPROVE_DISABLED=true  # If implemented (recommended for Phase 2)

# Option 3: alias hijack (user's interactive shell)
alias 'node scripts/code_quality_manager.js fix --apply'='echo "Phase 2 disabled"'
```

**Recommendation:** Phase 2 應該加 `CQM_AUTO_APPROVE_DISABLED=1` env var 作為 kill switch（mirrors SHL pattern：disable without code change）。

### 8.4 Data recovery (if writes happened)

```bash
# Restore any file from safeWrite backup
node scripts/safe_write.js restore <file>  # If helper exists
# OR
cp .safe_write_backups/<file>.bak.<ISO> <file>

# Restore from snapshot (Audit Repair)
cp .fix_snapshots/<file>.<ts>.<pid>.pre <file>

# Last resort: git
git checkout HEAD -- <file>
```

### 8.5 Rollback trigger conditions

| Trigger | Action |
|---------|--------|
| T3/T8 失敗超過 1 次 | Revert Phase 2 |
| safeWriteSync backup corrupted | Revert + investigate safe_write.js |
| Telemetry event schema invalid (`.self_healing_loop.jsonl` parse fails) | Revert Phase 2 (independent feature; safe to drop) |
| Cron 無意中被改變 | Revert single crontab line + open follow-up issue |
| 出現 Phase 0 嘅「silent auto-apply」回歸 | **EMERGENCY**: revert immediately + lock down |

---

## 9. Risks & Open Questions

### 9.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `--apply` 寫入破壞 syntax（safeWrite 漏網） | Low (safeWriteSync 已 ship) | High (P0 corruption) | 保留 safeWrite barrier；T20 syntax check；auto rollback if validation fails |
| TTY detection 唔可靠（CI 環境） | Medium | Medium | 加 `--apply --yes` explicit bypass flag for trusted batch use（但要 emit `cqm_apply_unattended` event） |
| Telemetry file collision with SHL | Low (independent event names) | Low | 兩邊各自 emit 落同一 file；JSONL 自然 append-only；Phase 4 watcher 統一 listen |
| User 預期 `fix` = write (Phase 0 之前嘅 mental model) | Medium (UX confusion) | Low (manual trigger only) | HEARTBEAT.md + cmdHelp 標明；doc updated |
| `audit_repair_proposer.js --apply` + M3 advisory blocking | Low (FIX_M3_MODE=shadow by default) | Low | Phase 2 唔郁 M3 integration；m3 advisory 仍係 shadow |
| Recency check false positive (legitimate rapid edits) | Medium | Medium | Window 60s；user can disable via `--apply --skip-recency-check` if needed |
| Cron 環境變數 `CQM_AUTO_APPROVE=true` 漏出嚟 | Low | Medium | 文件化 kill switch `CQM_AUTO_APPROVE_DISABLED=1` |
| `--apply --no-snapshot` 組合 (audit repair only) | Low | High (lose L1 defense) | Explicit error if both passed |

### 9.2 Open Questions（待 Josh 答）

1. **Q1:** `audit_repair_proposer.js --apply` 是否要保留 `proposal_action.js apply <id>` 嘅 manual approve-then-apply 流程？定係 `--apply` 完全 bypass approve？
   - **Recommend:** `--apply` 只 auto-apply `decision.action === 'auto-fix'` 嘅 issues；`proposal_action.js apply <id>` 處理 production-tier（需要手動 approve）。
   - 即係 `--apply` = 「auto-apply eligible (utility-tier)」，proposals 仍要 manual review for production。

2. **Q2:** `--apply` 嘅 TTY confirm prompt 應該 hard requirement 抑或 soft (with `--yes` bypass)？
   - **Recommend:** Hard default；`--apply --yes` 作為 opt-in bypass for batch use（emit different telemetry event）

3. **Q3:** Telemetry event name 用 `cqm_apply_*` / `audit_apply_*` 定 generic `apply_*`？
   - **Recommend:** Source-prefixed（`cqm_apply_*` / `audit_apply_*`）— 方便 grep filter；matches SHL pattern

4. **Q4:** HEARTBEAT.md 應該加 "🚦 Auto-Fix Phase 2 ✅" section，定只係 append Phase 0+1 section？
   - **Recommend:** Replace existing "🚦 Auto-Fix Phase 0 (#189)" section with "🚦 Auto-Fix Phase 0+1+2 (#189) — 2026-07-10" combined section

5. **Q5:** `code_quality_manager.js fix` 嘅 default behavior 改變算 breaking change。要唔要 update AGENTS.md 「Manual `node scripts/code_quality_manager.js fix`」條目？
   - **Recommend:** Yes, update HEARTBEAT.md line 222-223 from 「⚠️ Manual `node scripts/code_quality_manager.js fix` (human-triggered, intentional — keep available)」 to 「✅ Manual `fix --apply` (opt-in write, TTY required); `fix` default = preview」

6. **Q6:** Phase 2 嘅 telemetry emit frequency — `--apply` 每次 run 一行？定每 file 一行？
   - **Recommend:** 每次 run 一行（request → confirm → completed）；file-level detail 喺 safeWriteSync logs（已 ship）

7. **Q7:** 60s recency check window 點 define？「Last modified time」定「Last written via safeWrite」？
   - **Recommend:** `fs.statSync(file).mtimeMs` — simple + reliable；user can bypass via `--skip-recency-check`

### 9.3 Decision points requiring Josh sign-off

| # | Decision | Recommendation |
|---|----------|----------------|
| 1 | CQM `fix` default behavior | **Preview by default** (Option C) — most aligned with Phase 0 spirit |
| 2 | Audit Repair script structure | **Same script, --apply flag** (Option C) — least invasive |
| 3 | Flag name | **`--apply`** — matches existing `proposal_action.js apply` |
| 4 | Crons behavior | **Keep read-only / dry-run 100%** — zero new silent mutations |
| 5 | Telemetry schema | **Mirror SHL: event name + ts + source + fields, append to `.self_healing_loop.jsonl`** |
| 6 | TTY requirement | **Hard default, `--yes` bypass with different telemetry event** |
| 7 | safeWriteSync preservation | **100% preserved, no changes to L1/L2/L3 barriers** |

---

## 10. Implementation Checklist（for Josh review）

Phase 2 implementation（after Josh signs off）:

- [ ] **Step 1:** Apply CQM `--apply` flag to `code_quality_manager.js:584-602,1153-1210,1285-1287`
- [ ] **Step 2:** Apply Audit Repair `--apply` flag to `audit_repair_proposer.js:96-100,114-122,361-405,706-720,815-825`
- [ ] **Step 3:** Add `emitTelemetry()` helper to both scripts (mirror SHL pattern)
- [ ] **Step 4:** Run all tests T1-T20 (unit + integration + negative)
- [ ] **Step 5:** Verify crons unchanged (T11)
- [ ] **Step 6:** Verify SHL env guard unchanged (T12)
- [ ] **Step 7:** Update HEARTBEAT.md Phase 2 row + Manual fix surface note
- [ ] **Step 8:** Update issue #189 progress (Phase 2 → ✅ done)
- [ ] **Step 9:** Git commit with message "Phase 2 #189: opt-in --apply for CQM + Audit Repair (TTY + safeWriteSync preserved)"
- [ ] **Step 10:** Run end-of-session handoff (`node scripts/session_end.js`)

---

## 11. Cross-References

| Reference | Where | Why |
|-----------|-------|-----|
| `AGENTS.md` 🚨 Coding Standards | workspace | Surgical changes rule |
| `.issues/active/189-auto-fix-system-phase-0-disabl.md` | workspace | Original issue + Phase 0/1 progress |
| `extensions/self-healing-loop/index.mjs:434` | workspace | Phase 1 reference env guard pattern |
| `scripts/safe_write.js:222,341` | workspace | L2 barrier — preserved as-is |
| `scripts/proposal_action.js:170-220` | workspace | Existing single-proposal apply (different surface) |
| `HEARTBEAT.md:198-228` | workspace | Current Phase 0/1 state |
| `scripts/audit_repair_proposer.js:361-405` | workspace | `applyFix` body — preserved with --apply guard wrapper |
| `scripts/code_quality_manager.js:1153-1210` | workspace | `cmdFix` body — surgical --apply branch added |

---

*End of Phase 2 design. Awaiting Josh review before implementation.*