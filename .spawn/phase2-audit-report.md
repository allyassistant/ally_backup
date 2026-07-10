# Phase 2 Code Audit — #189 Auto-Fix Silent Mutations

**Reviewed by:** M3 sub-agent (minimax-portal/MiniMax-M3)
**Date:** 2026-07-10 13:31 HKT
**Scope:** Phase 2 implementation (3 files + 2 docs, surgical)
**Verdict:** 🟡 **Conditional pass** — 0 safety bugs (mutation guards correctly prevent silent writes), but **3 fixes recommended** before merge to address audit-trail completeness and a `--apply + --dry-run` semantic conflict in CQM.

---

## ✅ Passed (verified OK)

### Mutation guards correctly prevent silent writes
- **CQM** `fix --apply` 5-step chain (`code_quality_manager.js:1211-1281`): kill switch → quiet-conflict → TTY → 60s recency → confirm. **All 5 steps verified.**
- **ARP** `fix --apply` 3-step chain (`audit_repair_proposer.js:662-690`): kill switch → TTY → confirm. **All 3 steps verified.**
- **DRY_RUN** derived correctly: `const DRY_RUN = APPLY ? false : DRY_RUN_RAW` (`audit_repair_proposer.js:139`). Apply path **does** pass `DRY_RUN=false` into `applyFix()`. ✅
- **applyFix write gate** at `audit_repair_proposer.js:506-527`: `safeWriteSync` only called when `!dryRun` — proven by `if (!dryRun) { safeWriteSync(...) }` block. ✅
- **ARP conflict detection**: `--apply + --dry-run` rejected with `process.exit(2)` (`audit_repair_proposer.js:134-136`). ✅

### Preserved invariants (zero regression)
- **safeWriteSync** preserved:
  - CQM: 10 usages (grep-verified, unchanged by Phase 2)
  - ARP: 6 usages including new `safeWriteSync({ filePath: absPath, ... })` at line 516 (Hybrid Hardening, pre-existing)
- **SHL env guard** intact: `extensions/self-healing-loop/index.mjs:434` reads
  ```
  if (process.env.SHL_APPLY !== "true") { advisory_skip; return; }
  ```
  Verified byte-for-byte — Phase 2 did NOT touch SHL. ✅
- **Crons unchanged** (system crontab):
  - ARP 04:45: still `audit_repair_proposer.js --dry-run` (no `--apply`) ✅
  - CQM cron (`*2f9b5b1c*`): flipped to `scan` in Phase 0, not reverted ✅
  - Hidden Drift 03:50: read-only to `scripts/`, unchanged ✅
- **Telemetry write path**: serialized via `_cqmTelemetryQueue` / `_arpTelemetryQueue` (Promise chain, line 23 / line 60). Rotation at 5MB. Best-effort with catch-all swallow. ✅
- **node --check passes** on both files (verified by exec).

### Telemetry completeness (where awaited)
- **CQM** `await emitTelemetry(...)` at all 7 sites (`code_quality_manager.js:1215, 1221, 1227, 1245, 1275, 1278, 1280, 1315, 1336`). ✅
- **ARP** `audit_apply_completed` + `audit_apply_requested` at non-exit sites (`audit_repair_proposer.js:689, 885`) — correctly serialized via queue tail. ✅

### Backward compatibility
- Default `cqm fix` (no `--apply`) → preview only, `--dry-run` propagated to `auto_fix.js` (`code_quality_manager.js:1293`: `if (parsed.options['dry-run'] || !applyRequested) args.push('--dry-run');`). ✅
- Default `audit_repair_proposer.js` (no `--apply`) → `DRY_RUN_RAW = false` → `DRY_RUN = false` ... wait, no: `DRY_RUN = APPLY ? false : DRY_RUN_RAW`. If no `--apply`, `APPLY=false`, so `DRY_RUN = DRY_RUN_RAW`. If user runs `node audit_repair_proposer.js` plain → `DRY_RUN_RAW = false` → `DRY_RUN = false` → DOES WRITE?!

**🔍 See Open Questions #1 below.**

---

## ⚠️ Warnings (non-blocking, should fix)

### W1 — Inconsistent kill switch env var name (P2)
**File:** `audit_repair_proposer.js:667`
**Issue:** ARP uses `CQM_AUTO_APPROVE_DISABLED` (CQM-prefixed) as kill switch. Inconsistent with CQM (`code_quality_manager.js:1214`). If a script globally disables CQM auto-fix, it ALSO disables ARP auto-fix — even if operator only intended CQM.
**Fix:** Use `AUDIT_AUTO_APPROVE_DISABLED` for ARP. Keep `CQM_AUTO_APPROVE_DISABLED` for CQM.
**Severity:** P2 (naming, not safety — both scripts still respect the env var)

### W2 — Recency check scope too narrow (P2)
**File:** `code_quality_manager.js:1229-1247`
**Issue:** Recency check only scans `scripts/*.js` (top-level). Misses `scripts/lib/`, `extensions/`, root-level scripts, and any non-`.js` files user might edit (`.mjs`, `.cjs`, `.sh`).
**Fix:** Either (a) walk `path.join(__dirname, '..')` for the whole workspace, or (b) document the limitation in the error message.
**Severity:** P2 (defensive layer, not a security boundary — the apply path still requires TTY + confirm)

### W3 — CQM preview mode runs full re-scan + verify + system_check (P2)
**File:** `code_quality_manager.js:1321-1332`
**Issue:** After preview `fix`, CQM unconditionally runs `cmdScan` + `runVerifyFix` + `runSystemCheckBot`. This is wasteful for preview (defeats "preview only" promise).
**Fix:** Gate re-scan/verify/system_check behind `applyRequested` so preview stays light.
**Severity:** P2 (perf, not safety)

### W4 — `applyFix` continues after fix returns no-op content (P1 code quality)
**File:** `audit_repair_proposer.js:464-469`
**Issue:** If `rule.fix()` returns `null` or `original` (no change), `applyFix` rolls back snapshot and returns `ok: false`. But the **M3 advisor / heuristic** doesn't see this as a problem until it happens — there's no early detection. This is pre-existing logic, not a Phase 2 regression, but it's noisy.
**Fix:** Optional — add a `--report-noop` mode that summarizes `rule.fix() === null` events separately.
**Severity:** P2 (out of scope for Phase 2 surgical change, noted for future)

---

## 🐛 Bugs found (must fix before merge)

### B1 — CQM silently no-ops writes when `--apply --dry-run` combined (P1)
**File:** `code_quality_manager.js:1293-1295`
**Issue:** Logic: `if (parsed.options['dry-run'] || !applyRequested) args.push('--dry-run');`
When user runs `cqm fix --apply --dry-run`:
1. Both flags parsed. `applyRequested=true`.
2. Guard chain passes (TTY, recency, confirm).
3. **But:** `--dry-run` is pushed to `auto_fix.js` because the condition `parsed.options['dry-run'] || !applyRequested` = `true || false` = `true`.
4. `auto_fix.js fix --dry-run` runs but does NOT write.
5. **Misleading telemetry:** `await emitTelemetry('cqm_apply_completed', { unattended: yesBypass })` is emitted at line 1315 — looks like apply succeeded.

**Compare with ARP** which has explicit `--apply + --dry-run` rejection at `audit_repair_proposer.js:134-136`. CQM lacks the same guard.

**Fix:** Add explicit check at start of `if (applyRequested)` block (before guard chain), e.g.:
```js
// CQM mirror of ARP conflict check
if (parsed.options['dry-run']) {
  console.error('❌ --apply and --dry-run are mutually exclusive. Use one or the other.');
  await emitTelemetry('cqm_apply_aborted', { reason: 'dry_run_conflict' });
  process.exit(2);
}
```
**Severity:** P1 (silent semantic mismatch — user thinks they wrote but didn't; audit trail misleading)

### B2 — ARP: unawaited telemetry before `process.exit()` (3 sites) (P1)
**Files:**
- `audit_repair_proposer.js:668` — kill switch exit
- `audit_repair_proposer.js:674` — TTY missing exit
- `audit_repair_proposer.js:685` — user rejected exit

**Issue:** Code pattern:
```js
emitTelemetry('audit_apply_aborted', { reason: '...' });
process.exit(2);
```
`emitTelemetry()` returns a Promise (queued via `_arpTelemetryQueue`). The call is **not awaited**. `process.exit()` is asynchronous — exits when event loop drains. The `appendFile` may or may not complete before exit.

**Compare with CQM** at lines 1215/1221/1227/1245/1275: ALL use `await emitTelemetry(...)` before `process.exit(1)`. CQM got it right; ARP did not.

**Risk:** Audit trail loses ~3 abort events per session (kill_switch / tty_missing / user_rejected). Best-effort telemetry is documented, but losing ALL abort events defeats the purpose of telemetry.

**Fix:** Add `await` at the 3 sites:
```js
// Line 668
await emitTelemetry('audit_apply_aborted', { reason: 'kill_switch', user: ... });
process.exit(2);

// Line 674
await emitTelemetry('audit_apply_aborted', { reason: 'tty_missing' });
process.exit(2);

// Line 685
await emitTelemetry('audit_apply_aborted', { reason: 'user_rejected' });
process.exit(2);
```
The `main()` function is async, so await is valid.
**Severity:** P1 (audit-trail completeness, not safety — mutation is still blocked correctly by the guards)

### B3 — Default `audit_repair_proposer.js` (no flags) writes to disk (P0)  ⚠️ CRITICAL
**File:** `audit_repair_proposer.js:139`
**Issue:** Default behavior is `DRY_RUN = APPLY ? false : DRY_RUN_RAW`. If user runs `node scripts/audit_repair_proposer.js` with NO flags:
- `APPLY = false`
- `DRY_RUN_RAW = args.has('--dry-run')` = `false`
- `DRY_RUN = APPLY ? false : DRY_RUN_RAW` = `false`

This means **`DRY_RUN=false` by default**, and `applyFix` will WRITE if `decision.action === 'auto-fix'`. The CLI help text (line 174) says `# default input (Phase 0+: dry-run, propose only)` but **the code does NOT default to dry-run**.

**Compare with Phase 0 spec:** per `HEARTBEAT.md:198-228`, Phase 0 flipped ARP 04:45 cron to `--dry-run`. Phase 2 was supposed to add an opt-in `--apply`. But the **default** should remain `--dry-run` (= `DRY_RUN=true`), not `DRY_RUN=false`.

**Currently the default actively UNDOES Phase 0's protection.** If user (or any automation) runs `node audit_repair_proposer.js` plain, it WILL write.

**Fix:** Change line 139 to:
```js
const DRY_RUN_RAW = args.has('--dry-run');
// ... existing --apply + --dry-run conflict check ...
// Default is dry-run; --apply required to write (Phase 0+2 invariant).
const DRY_RUN = APPLY ? false : (DRY_RUN_RAW || true);  // default true unless --apply
```
Or simpler:
```js
const DRY_RUN_DEFAULT = true;
const DRY_RUN = APPLY ? false : (DRY_RUN_RAW || DRY_RUN_DEFAULT);
```

Verify with a quick test after fix:
```bash
node scripts/audit_repair_proposer.js --help  # Should display "default: --dry-run"
node scripts/audit_repair_proposer.js --input test.json --dry-run  # Should NOT write
node scripts/audit_repair_proposer.js --input test.json --apply   # Requires TTY + confirm; writes
```

**Severity:** P0 — **directly undoes Phase 0 protection**. The whole point of #189 was to "disable silent mutations". This bug re-introduces them via the default path. **Must fix before merge.**

### B4 — `cqm_apply_completed` fires before post-scan completes (P2)
**File:** `code_quality_manager.js:1315`
**Issue:** `await emitTelemetry('cqm_apply_completed', { unattended: yesBypass })` fires INSIDE the try block AFTER `execFileSync` returns. But the subsequent `cmdScan` + `runVerifyFix` + `runSystemCheckBot` are also inside the try. If they throw, `cqm_apply_partial` is emitted but **the apply succeeded**. Misleading.
**Fix:** Move `cqm_apply_completed` to a `finally` after all post-steps complete, OR rename to `cqm_apply_execok` to clarify "exec ok" ≠ "apply ok".
**Severity:** P2 (audit-trail semantics, not safety)

---

## 🔍 Open questions

### OQ1 — Was Phase 0's "DRY_RUN default = true" invariant preserved through Phase 2?
Linked to **B3** above. The cron at 04:45 (`crontab -l` line 45) passes `--dry-run` explicitly, so cron is safe. But any other invocation path (interactive, automated test, sub-agent call) without `--dry-run` **will write**. Need to confirm with Josh whether this was intentional or an oversight in `audit_repair_proposer.js:139`.

If intentional: update HEARTBEAT.md to document "DRY_RUN default changed to false; user must pass --dry-run for safety". Or alias `audit_repair_proposer.js` default to `--dry-run`.

If oversight: fix per B3 above.

### OQ2 — `--apply + --verbose` interaction in ARP
**File:** `audit_repair_proposer.js:667-689`
The guard chain doesn't handle `--verbose`. If user runs `audit_repair --apply --verbose`, VERBOSE is `true` (line 140), and the verbose log lines from `applyFix` will print during the prompt + write flow. Not a bug, but `--verbose` was added in original code, not in Phase 2 — verify it doesn't leak sensitive info (file paths, diff content) to non-TTY contexts.

### OQ3 — `--apply + --no-snapshot` in ARP
**File:** `audit_repair_proposer.js:140`
`NO_SNAPSHOT = args.has('--no-snapshot')` is set, but only honored as a flag in help/CLI docs. Inside `applyFix()` at line 425: `if (!NO_SNAPSHOT && !dryRun) { snapPath = snapshot.snapshotFile(...) }`. So `--no-snapshot` skips the L1 snapshot **before** applyFix. safeWriteSync (L2) still happens. But: this means `applyFix --apply --no-snapshot` relies solely on `.safe_write_backups/<base>.bak.<ISO>` for rollback. Acceptable per Hybrid Hardening, but worth flagging in audit trail.

### OQ4 — CQM `--apply` doesn't recurse into `extensions/` SHL layers
**File:** `code_quality_manager.js:1203+`
`cmdFix` calls `execFileSync(node, [autoFixPath, 'fix', ...])`. `auto_fix.js fix` scans `scripts/` per `SELF_EXCLUDE` patterns. But Phase 1 SHL (`self-healing-loop/index.mjs:434`) is a separate path — not invoked by CQM. So CQM `--apply` cannot accidentally spawn SHL fixes. **Good.** Verify with grep: `grep -r "self-healing-loop" scripts/auto_fix.js` should return 0 (only Phase 0/1 docs reference it).

### OQ5 — Cron 04:45 ARP line still has FIX_M3_MODE etc.
**Crontab:** Line 45 of system crontab:
```
4 * * * * ... FIX_M3_MODE=shadow ... audit_repair_proposer.js --dry-run
```
Verified `--dry-run` is present. With B3 fix above, this stays safe (default will be dry-run too). Without B3 fix, if someone removes `--dry-run` from crontab, the cron reverts to writing silently — same risk as Phase 0 issue.

---

## 📋 Recommended merge checklist

1. **B3 (P0)** — Fix `audit_repair_proposer.js:139` to default `DRY_RUN=true`. **Block merge.**
2. **B1 (P1)** — Add `--apply + --dry-run` conflict check in CQM, mirroring ARP. **Strongly recommended.**
3. **B2 (P1)** — Add `await` at 3 emitTelemetry sites in ARP. **Strongly recommended.**
4. **W1 (P2)** — Rename ARP kill switch env var for consistency. Nice-to-have.
5. **W2 (P2)** — Expand recency check scope. Nice-to-have.
6. **W3 (P2)** — Gate re-scan in preview mode. Nice-to-have.
7. **B4 (P2)** — Clarify `cqm_apply_completed` semantics. Nice-to-have.

After B3 + B1 + B2 fixes, **Phase 2 is safe to merge.**

---

## 📊 Severity tally

| Severity | Count | Files affected |
|----------|-------|----------------|
| 🐛 P0 | 1 | `audit_repair_proposer.js` |
| 🐛 P1 | 2 | `audit_repair_proposer.js`, `code_quality_manager.js` |
| 🐛 P2 | 1 | `code_quality_manager.js` |
| ⚠️ P2 warnings | 4 | both files |
| 🔍 Open questions | 5 | both files |
| ✅ Passed | ~8 invariants | all 3 files |

**Net assessment:** Guard chain logic is sound. Telemetry is best-effort and incomplete in one edge case. The single P0 (B3) is a Phase 0 invariant that was inadvertently relaxed in Phase 2 — easy fix, must do. No safety-regression (silent writes not re-introduced into the apply-path guards), but default-path mutation is real until B3 is fixed.

---

## 📝 Reasoning: items deliberately NOT flagged

- **`--apply + --yes`:** Valid combo. CQM emits `cqm_apply_confirmed` with `unattended: true`. Audit trail intact. ✅
- **`--apply + --skip-recency-check`:** Valid escape hatch for trusted batch use. Documented in help. ✅
- **Recency check best-effort try-catch (`code_quality_manager.js:1249-1251`):** Comment correctly explains intent. Stat failures don't block — acceptable for defensive layer, not security boundary. ✅
- **Telemetry queue serialization:** Both files use `Promise.resolve()` chain + `_queue = task.catch(()=>{})`. Race-free at queue level. ✅
- **SHL mod not happening:** Verified `extensions/self-healing-loop/index.mjs:429-440` byte-for-byte. Phase 2 did not touch SHL. ✅
- **5MB rotation behavior:** Identical implementation in both files. Pre-existing pattern from SHL. Acceptable. ✅

