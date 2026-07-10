/**
 * self-healing-loop — OpenClaw self-healing edit loop plugin
 *
 * Mirrors the Claude Code "self-healing edits" loop: after any write/edit/
 * apply_patch tool call, re-run the post-edit verifier (`scripts/verify_edit.js`)
 * on the touched file. If the verifier reports syntax or P0 issues, enqueue a
 * fire-and-forget fixer subagent to repair the file before the model observes
 * the broken state.
 *
 * Loop safeguards (defense in depth):
 *   1. Per-file cap    — `perFileBudget` (default 1): at most one auto-fix per
 *                        file per session. Prevents infinite edit/fix thrash.
 *   2. Session cap     — `sessionFixerCap` (default 1): at most one fixer
 *                        subagent spawn per session. Prevents token blowup.
 *   3. Tool filter     — only `edit` / `write` / `apply_patch` trigger verify.
 *                        Read-only tools are skipped.
 *   4. Mode gate       — `config.mode` ∈ {log, fix-syntax, fix-all}:
 *                        - log        → record, never auto-fix (default)
 *                        - fix-syntax → auto-fix only on SyntaxError/P0
 *                        - fix-all    → auto-fix on any verifier error
 *   5. Async isolation — `spawnFixer` is fire-and-forget; failure or hang
 *                        can never break the host tool call.
 *
 * 3-Layer Defense (skill-reviewer coexistence):
 *   Layer 1 (PRIMARY)   — Caller session check: isolated/cron sessions
 *                         (skill reviewer) skip SHL entirely. Detected via
 *                         session-key fingerprint ("isolated:", "cron",
 *                         "skill-reviewer"). Telemetry: `skip_skill_session`.
 *   Layer 2 (BACKUP)    — Path-based skip: files under `skills-learned/` or
 *                         `skills/_learned_/...` (subdirectories of skills/
 *                         whose name starts with `_learned_`) are skipped.
 *                         Uses path.sep delimited prefix to prevent
 *                         substring collision.
 *                         Telemetry: `skip_skill_path`.
 *   Layer 3 (FIX-TYPE)  — When fixing files in skill paths, only syntax-error
 *                         and undefined-symbol fixes are allowed. Judgment-
 *                         class errors (magic-numbers, console-log, unused-
 *                         import, working notes TBD markers, P0 try-catch)
 *                         block the fix entirely (conservative). Telemetry:
 *                         `skill_fix_blocked`.
 *
 * Telemetry: append JSONL events to `~/.openclaw/workspace/.self_healing_loop.jsonl`
 *   Event shapes: {ts, event: "verify_ok"|"verify_fail"|"enqueue"|"spawn"|
 *                              "skip_budget"|"skip_mode"|"skip_tool"|"cleanup"|
 *                              "skip_skill_session"|"skip_skill_path"|
 *                              "skill_fix_blocked",
 *                  file, sessionKey, mode, errors, runId?}
 *
 * Plugin SDK: definePluginEntry (matches skill-auto-suggest / route-enforcer)
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { spawn } from "node:child_process";
import {
  readFileSync,
  statSync,
  appendFileSync,
  copyFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  isIsolatedCronSession,
  isSkillPath,
  classifyErrorForSkillPath,
  gateSkillPathFix,
  ISOLATED_CRON_PATTERNS,
  SKILL_PATH_MARKERS,
  SKILL_ALLOWED_PATTERNS,
  SKILL_BLOCKED_PATTERNS,
  TELEMETRY_SKIP_SKILL_SESSION,
  TELEMETRY_SKIP_SKILL_PATH,
  TELEMETRY_SKILL_FIX_BLOCKED,
} from "./lib/skill-gate.mjs";

// ── Constants ─────────────────────────────────────────────────────────────
const HOME = os.homedir();
const WORKSPACE = process.env.OPENCLAW_WORKSPACE_DIR || path.join(HOME, ".openclaw", "workspace");

// Hybrid Hardening (2026-07-09): universal safeWrite barrier for code rewrites.
// Loaded after WORKSPACE is defined so the require path resolves correctly.
const _require = createRequire(import.meta.url);
const { safeWrite, SafeWriteError } = _require(path.join(WORKSPACE, "scripts/safe_write.js"));

const TELEMETRY_DIR = WORKSPACE;
const TELEMETRY_FILE = path.join(TELEMETRY_DIR, ".self_healing_loop.jsonl");

const VERIFY_SCRIPT_DEFAULT = "scripts/verify_edit.js";
const VERIFY_TIMEOUT_DEFAULT_MS = 10_000;
const TELEMETRY_MAX_BYTES = 5 * 1024 * 1024; // 5 MB — rotate .jsonl when exceeded

// System notification channel (#⚙️系統)
const SYSTEM_CHANNEL = "channel:1473376125584670872";
const NOTIFY_CLI = "openclaw";

// One-shot diagnostic event name (fired from module top-level on import).
const TELEMETRY_PLUGIN_LOADED = "plugin_loaded";

// ── CJS Bridge (Alt A — Deeper SHL surgery) ──────────────────────────────
// Deterministic fixer path needs `LOW_RISK_RULES` from `scripts/auto_fix.js`.
// That module is CommonJS; bridge ESM/CJS via `createRequire(import.meta.url)`.
// Path is two levels up because this file lives in `extensions/self-healing-loop/`.
const requireCJS = createRequire(import.meta.url);
const { LOW_RISK_RULES } = requireCJS("../../scripts/lib/rules/low-risk.js");
// Phase A (2026-06-20): immediate audit on freshly written files.
// audit_just_written.js is a fast CJS scanner (<2s typical, 0-2ms on small files).
const { auditFile: auditJustWritten } = requireCJS("../../scripts/audit_just_written.js");
// ── Layer 2 Bridge (Phase 2h) ────────────────────────────────────────────
// After a deterministic fix runs, scan for cross-file rename events and
// propagate the change to dependents. Fail-open: any throw inside the
// rename propagator must not break the host plugin.
let renamePropagator = null;
let dependencyGraph = null;
try {
  renamePropagator = requireCJS("../../scripts/lib/rename_propagator.js");
  dependencyGraph = requireCJS("../../scripts/lib/dependency_graph.js");
} catch (layer2Err) {
  // Layer 2 modules missing or failed to load — degrade silently. Layer 1
  // (single-file fix) continues working unchanged.
  console.error(`[self-healing-loop] Layer 2 modules unavailable: ${layer2Err?.message || layer2Err}`);
}

// Telemetry event names for Alt A deterministic fixer (added 2026-06).
const TELEMETRY_RULE_APPLIED = "rule_applied";
const TELEMETRY_FIXES_APPLIED = "fixes_applied";
// Telemetry event names for Phase A immediate audit (added 2026-06-20).
const TELEMETRY_AUDIT_OK = "audit_just_written_ok";
const TELEMETRY_AUDIT_CRITICAL = "audit_just_written_critical";
const TELEMETRY_AUDIT_HIGH = "audit_just_written_high";
const TELEMETRY_AUDIT_SKIP = "audit_just_written_skip";
const TELEMETRY_AUDIT_ERROR = "audit_just_written_error";
// Telemetry event names for Layer 2 rename propagation (added 2026-06, Phase 2h).
const TELEMETRY_L2_RENAME_DETECTED = "l2_rename_detected";
const TELEMETRY_L2_RENAME_PLANNED = "l2_rename_planned";
const TELEMETRY_L2_RENAME_APPLIED = "l2_rename_applied";
const TELEMETRY_L2_RENAME_FAILED = "l2_rename_failed";
const TELEMETRY_L2_RENAME_SKIPPED = "l2_rename_skipped";

// Snapshot directory for rollback (L1 defense before any file mutation).
const SNAPSHOT_DIR = path.join(WORKSPACE, ".fix_snapshots");

// One-shot diagnostic: record module load + mtime. Helps detect "restart"
// that didn't actually re-load the module (ESM cache staleness). Synchronous
// so it fires before any plugin-host shutdown, and never depends on the
// async telemetry queue. Fire-and-forget — failures are silently swallowed.
try {
  const selfPath = fileURLToPath(import.meta.url);
  const s = statSync(selfPath);
  appendFileSync(
    TELEMETRY_FILE,
    JSON.stringify({
      ts: new Date().toISOString(),
      event: TELEMETRY_PLUGIN_LOADED,
      sessionKey: null,
      moduleMtime: s.mtime.toISOString(),
      modulePath: selfPath,
    }) + "\n",
    "utf8"
  );
} catch { /* diagnostic only — never fail module load */ }

// Tools that mutate file content (others are read-only and skipped).
const WRITE_TOOLS = new Set(["edit", "write", "apply_patch"]);

// ── Per-plugin state (closed-over inside register()) ──────────────────────
function createState() {
  return {
    /** Map<filePath, { errors, ts, attempts }> — files awaiting fix. */
    pendingQueue: new Map(),
    /** Map<filePath, count> — per-file fix attempts this session. */
    fixBudget: new Map(),
    /** Total fixer subagent spawns this session. */
    sessionFixerCount: 0,
    /** Total Layer 2 rename propagations this session (Phase 2h). */
    sessionL2Count: 0,
    /** Cached dependency graph for Layer 2 (rebuilt lazily). */
    _l2Graph: null,
    /** Current sessionKey — set on session_start, cleared on session_end. */
    sessionKey: null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Best-effort path extraction from a tool call payload.
 * `edit`/`write`/`apply_patch` all return `params.path` / `params.file_path`
 * (or `params.target_file` for edit). Falls back to null.
 *
 * 2026-06-23: Normalize path to absolute. LLM tool calls mix relative
 * (e.g. `Users/ally/...`) and absolute (`/Users/ally/...`) paths; before
 * this fix, telemetry events had inconsistent leading-slash patterns that
 * made filtering/grouping by file path awkward. Relative paths are now
 * resolved against WORKSPACE so the field is always absolute and consistent.
 */
function extractFilePath(toolName, params) {
  if (!params || typeof params !== "object") return null;

  // Defensive: `params` is `Record<string, unknown>`. Pick the first candidate
  // that is a non-empty string. Avoids truthy-but-wrong values (arrays,
  // objects, empty strings) from malformed payloads propagating downstream.
  const pick = (...candidates) =>
    candidates.find((c) => typeof c === "string" && c.length > 0) || null;

  let raw = null;
  if (toolName === "write") {
    raw = pick(params.path, params.file_path);
  } else if (toolName === "edit") {
    raw = pick(params.path, params.file_path, params.target_file);
  } else if (toolName === "apply_patch") {
    raw = pick(params.path, params.file_path);
    if (!raw && typeof params.input === "string") {
      // applyPatchSchema: file path lives inside the `input` marker block
      //   *** Begin Patch
      //   *** Update File: /path/to/file.js
      //   @@ ... @@
      const m = params.input.match(/\*\*\*\s+(?:Update|Add|Delete|Move)\s+File:\s+([^\r\n]+)/);
      if (m) raw = m[1].trim();
    }
  } else {
    return null;
  }

  if (!raw) return null;

  // Normalize: relative paths resolve against WORKSPACE so downstream
  // telemetry/grouping is always consistent.
  if (path.isAbsolute(raw)) return raw;
  // If raw starts with "~/" or "~", expand to HOME
  if (raw === "~" || raw.startsWith("~/") || raw.startsWith("~\\")) {
    return path.join(HOME, raw.slice(1));
  }
  // Otherwise treat as workspace-relative
  return path.resolve(WORKSPACE, raw);
}

/**
 * Run the post-edit verifier against a file. Returns { ok, errors[], raw }.
 * Never throws — every error path returns { ok, errors: [{msg: '...'}] }.
 */
function runVerify(filePath, verifyScriptRel, timeoutMs) {
  return new Promise((resolve) => {
    const absScript = path.isAbsolute(verifyScriptRel)
      ? verifyScriptRel
      : path.join(WORKSPACE, verifyScriptRel);

    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(process.execPath, [absScript, filePath], {
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      const output = stdout + stderr;
      if (code === 0) return resolve({ ok: true, errors: [], raw: output });
      const errors = parseVerifyErrors(output);
      return resolve({ ok: false, errors, raw: output });
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      return resolve({ ok: false, errors: [{ msg: `spawn error: ${err.message}`, line: 0 }], raw: "" });
    });
  });
}

/**
 * Phase A (2026-06-20): fire-and-forget Discord push when audit_just_written
 * finds a critical issue in a freshly written file. Spawns a detached child
 * process so a Discord hang can't break the host tool call.
 *
 * @param {string} filePath — file that was just written/edited
 * @param {object} auditResult — { severity, issueCount, issues, durationMs }
 */
function notifyAuditCritical(filePath, auditResult) {
  try {
    const topIssues = (auditResult.issues || []).slice(0, 3)
      .map((i) => `L${i.line} ${i.rule}: ${i.msg}`).join("\n");
    const message = `🚨 **Audit Just-Written** — ${path.basename(filePath)}\n` +
      `severity: **critical** (${auditResult.issueCount} issues, ${auditResult.durationMs}ms)\n` +
      `${topIssues}\n\n` +
      `⚠️ LLM 啱啱寫嘅 file 有 critical bug。Write **冇被 block**（fail-open），但建議即刻檢查。`;

    const discordPath = path.join(WORKSPACE, "scripts", "lib", "discord_push.js");
    // Inline JS that imports discord_push and pushes. Uses child_process.exec
    // via -e to keep the call isolated and detached.
    const inlineCode = `require(${JSON.stringify(discordPath)}).pushSystemChannel(${JSON.stringify(message)}).catch(()=>{});`;
    const child = spawn(process.execPath, ["-e", inlineCode], {
      stdio: "ignore",
      detached: true,
    });
    child.unref(); // detach so it can outlive the parent
  } catch (e) {
    // Never propagate — this is a fire-and-forget notification.
  }
}

/**
 * Parse verify_edit.js output for error descriptions.
 * Lines like:
 *   🚨 path/to/file.js:17 — execSync( 外面冇 try-catch
 */
function stripAnsi(str) {
  return str.replace(/\u001b\[[0-9;]*m/g, "");
}

function parseVerifyErrors(output) {
  const clean = stripAnsi(output);
  const errors = [];
  // 1. Pre-scan: look for `node --check` style `/path/to/file.js:N` markers
  //    on lines preceding `SyntaxError:`. Capture line number.
  const allLines = clean.split("\n");
  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    const pathMatch = line.match(/^(\/[\s\S]+?):(\d+)\s*$/);
    if (pathMatch && i + 1 < allLines.length) {
      const next = allLines.slice(i, i + 5).join("\n");
      const errMatch = next.match(/SyntaxError[^\n]*/);
      if (errMatch) {
        errors.push({ msg: errMatch[0], line: Number(pathMatch[2]) });
        continue;
      }
    }
  }
  // 2. Fall back to the original emoji-based parser for verify_edit.js output
  const lines = allLines.filter((l) => l.includes("🚨") || l.includes("✗") || l.includes("Error"));
  for (const line of lines) {
    // Skip lines already captured by pathMatch loop
    if (errors.some((e) => line.includes(e.msg))) continue;
    const match = line.match(/(?:🚨|✗|Error)\s*(?:\S+\s*)?[—\-–]\s*(.+)/);
    errors.push({
      msg: match ? match[1].trim() : line.trim(),
      line: 0,
    });
  }
  if (errors.length === 0 && clean.trim()) {
    errors.push({ msg: clean.trim().split("\n").pop() || "unknown error", line: 0 });
  }
  return errors;
}

// ── Atomic write helper (Alt A — Deeper SHL surgery) ──────────────────────
// Same pattern as scripts/lib/state.js: write to temp file then rename.
// Used by spawnFixer to make LOW_RISK_RULES fixes safe against partial-write
// corruption. Best-effort: caller is responsible for deciding whether to invoke.
//
// Hybrid Hardening (2026-07-09): wraps `safeWrite` to add the safety net —
// backup before write, `node --check` after, and rollback on syntax failure.
// This is the universal write barrier that all 3 repair writers (SHL, CQM,
// Audit Repair Proposer) now go through. The previous version here was just
// atomic-rename with no backup and no validation, which is why the 2026-07-09
// corruption incident could happen.
async function atomicWriteSync(filePath, content) {
  // Defer to safeWrite. We use a sync-style throw contract for compatibility
  // with the existing call site (which is in an async context but uses
  // try/catch synchronously around the call). safeWrite is async — we await it
  // and let any SafeWriteError propagate. SafeWriteError extends Error so the
  // existing `throw err` path in callers still works.
  return await safeWrite({ filePath, content, mode: "overwrite" });
}

// ── Telemetry ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget JSONL telemetry append. Never throws.
 *
 * Serialized via a single in-flight promise queue to avoid the file-
 * rotation race where two concurrent calls both pass the size check,
 * then the second `fs.rename` overwrites the first's just-rotated
 * `.1` file (default rename semantics replace destination on macOS/Linux).
 */
let _telemetryQueue = Promise.resolve();
async function logTelemetry(state, event, fields = {}) {
  const task = _telemetryQueue.then(async () => {
    try {
      await mkdir(TELEMETRY_DIR, { recursive: true });

      // Rotate if oversized. Best-effort — failure to rotate does not block.
      try {
        const stat = await import("node:fs").then((fs) => fs.promises.stat(TELEMETRY_FILE));
        if (stat.size > TELEMETRY_MAX_BYTES) {
          await import("node:fs").then((fs) => fs.promises.rename(TELEMETRY_FILE, TELEMETRY_FILE + ".1"));
        }
      } catch { /* file not exist yet or rename failed — continue */ }

      const record = {
        ts: new Date().toISOString(),
        event,
        sessionKey: state.sessionKey,
        ...fields,
      };
      await appendFile(TELEMETRY_FILE, JSON.stringify(record) + "\n", "utf8");
    } catch {
      // Telemetry is best-effort. Never let it break the host.
    }
  });
  // Never let one rejection stall the chain; subsequent calls proceed.
  _telemetryQueue = task.catch(() => {});
  return task;
}

// ── Queue & Fixer ─────────────────────────────────────────────────────────

/**
 * Enqueue a file for potential auto-fix. Respects per-file budget.
 * In `log` mode, this is a no-op (observes only).
 *
 * Phase 1 (2026-07-10): SHL held in advisory mode — verify still runs and
 * errors are surfaced via telemetry, but no fixer subagent is ever spawned
 * and no file is ever mutated. Root cause tonight was `hardcoded-home-path`
 * rule producing 5 file corruptions despite the safeWrite barrier (the
 * write was syntactically valid, so safeWrite let it through). Reversible
 * in <1 min via env var: `SHL_APPLY=true node openclaw ...`
 */
function enqueueFix(state, filePath, verifyErrors, cfg) {
  // Phase 1 guard: advisory-only by default. SHL still detects and logs
  // proposed fixes (audit trail), but never mutates files.
  if (process.env.SHL_APPLY !== "true") {
    void logTelemetry(state, "advisory_skip", {
      file: filePath,
      errors: verifyErrors.length,
      mode: cfg.mode,
      hint: "set SHL_APPLY=true to re-enable auto-fix",
    });
    return;
  }
  const effectivePerFileBudget = cfg.loopBudgetOverride ? 999 : cfg.perFileBudget;
  const used = state.fixBudget.get(filePath) || 0;
  if (used >= effectivePerFileBudget) {
    void logTelemetry(state, "skip_budget", { file: filePath, used, limit: effectivePerFileBudget });
    return;
  }
  state.pendingQueue.set(filePath, { errors: verifyErrors, ts: Date.now(), attempts: used });
  void logTelemetry(state, "enqueue", { file: filePath, errors: verifyErrors.length });
}

/**
 * Drain the pending queue and spawn fixer subagents. Fire-and-forget.
 * Respects session cap.
 */
async function drainQueue(api, state, cfg) {
  if (state.pendingQueue.size === 0) return;
  if (state.sessionFixerCount >= cfg.sessionFixerCap) {
    void logTelemetry(state, "skip_session_cap", { queued: state.pendingQueue.size });
    return;
  }

  // Snapshot the queue: avoids live-iterator surprises if concurrent
  // `after_tool_call` hooks add entries during the `await` below.
  const entries = Array.from(state.pendingQueue.entries());
  for (const [filePath, entry] of entries) {
    if (state.sessionFixerCount >= cfg.sessionFixerCap) break;
    await spawnFixer(api, state, cfg, filePath, entry.errors);
  }
}

/**
 * Fire-and-forget subagent spawn to fix a file.
 * Never blocks the host — failure is logged, not surfaced.
 */
/**
 * Fire-and-forget notification to system channel.
 */
function sendHealNotification(filePath, fixedCount, actualModel, remaining) {
  const shortPath = filePath.startsWith(WORKSPACE)
    ? filePath.slice(WORKSPACE.length + 1)
    : filePath;
  const fixed = actualModel.includes("fallback") ? actualModel : actualModel.split("/").pop();
  let msg = `🛠️ 自動修復: \`${shortPath}\` — 修復咗 ${fixedCount} 個問題 (${fixed})`;

  if (remaining && remaining.length > 0) {
    const leftover = remaining
      .map((e) => `• ${e.msg?.replace(/`/g, "'").substring(0, 80) || "?"}`)
      .join("\n");
    msg += `\n⚠️ 仲有 ${remaining.length} 個未處理:\n${leftover}`;
  }

  const child = spawn(NOTIFY_CLI, [
    "message", "send",
    "--channel", "discord",
    "--target", SYSTEM_CHANNEL,
    "--message", msg,
  ], { stdio: "ignore" });
  child.on("error", () => { /* swallow ENOENT etc. — notification is best-effort */ });
  child.unref();
}

async function spawnFixer(api, state, cfg, filePath, verifyErrors) {
  const fixBudget = state.fixBudget.get(filePath) || 0;
  state.fixBudget.set(filePath, fixBudget + 1);
  state.sessionFixerCount += 1;
  state.pendingQueue.delete(filePath);
  // ── Layer 3 (FIX-TYPE GATE): final defense inside spawnFixer ──
  // Even though the after_tool_call hook already filters skill paths via
  // Layer 2, this is a final safety net. If the path is somehow skill-like
  // (e.g. queue replay, manual invocation, future hook-evolution bugs),
  // restrict to allowed fix types and block on judgment-class errors.
  if (cfg.enableFixTypeGate && isSkillPath(filePath)) {
    const gate = gateSkillPathFix(verifyErrors);
    if (!gate.allowed) {
      void logTelemetry(state, TELEMETRY_SKILL_FIX_BLOCKED, {
        file: filePath,
        stage: "spawnFixer",
        blockedCount: gate.blockedMsgs.length,
        allowedCount: gate.allowedMsgs.length,
        sample: gate.blockedMsgs[0] || gate.allowedMsgs[0] || null,
      });
      return;
    }
  }

  // ── Alt A: Deeper SHL surgery (deterministic LOW_RISK_RULES caller) ──
  // Replaces the M3 subagent spawn path (was at lines 367–460 prior to 2026-06).
  // 48h telemetry showed the M3 path had 0% effective fix rate on real
  // production files — the 4 `spawn_fallback` errors were SDK permission
  // bugs (config already has allowModelOverride:true), not config issues.
  //
  // Alt A invokes LOW_RISK_RULES from scripts/auto_fix.js (CJS) directly via
  // createRequire. Rules are applied in registry order; each rule's `detect`
  // guards its `fix`. Snapshot for rollback is taken before any mutation.
  const startMs = Date.now();
  const actualModel = "deterministic:low_risk_rules";
  let rulesApplied = 0;
  let snapshotPath = null;

  try {
    // Pre-fix snapshot for rollback (L1 defense).
    try {
      mkdirSync(SNAPSHOT_DIR, { recursive: true });
      snapshotPath = path.join(
        SNAPSHOT_DIR,
        `${path.basename(filePath)}.${Date.now()}.${process.pid}.pre`
      );
      copyFileSync(filePath, snapshotPath);
    } catch { /* snapshot is best-effort — continue without it */ }

    // Read current content (wrapped per P0: readFileSync must be in try-catch).
    let originalContent;
    try {
      originalContent = readFileSync(filePath, "utf8");
    } catch (readErr) {
      void logTelemetry(state, "read_err", {
        file: filePath,
        error: readErr?.message || String(readErr),
      });
      throw readErr;
    }
    let modifiedContent = originalContent;

    // Apply LOW_RISK_RULES in registry order.
    // Each rule exposes `detect(content, filePath)` and `fix(content, filePath)`.
    // `detect` returns { found, details, lines, severity?, suggestion? }.
    // `fix` returns the modified content, or null/undefined/unchanged when
    // there's nothing to do. We treat any string that differs from the input
    // as a successful mutation.
    for (const rule of LOW_RISK_RULES) {
      if (!rule || typeof rule.detect !== "function" || typeof rule.fix !== "function") {
        continue;
      }
      let detection;
      try {
        detection = rule.detect(modifiedContent, filePath);
      } catch (detectErr) {
        void logTelemetry(state, "rule_detect_err", {
          file: filePath,
          rule: rule.id,
          error: detectErr?.message || String(detectErr),
        });
        continue;
      }
      if (!detection || detection.found !== true) continue;

      let nextContent;
      try {
        nextContent = rule.fix(modifiedContent, filePath);
      } catch (fixErr) {
        void logTelemetry(state, "rule_fix_err", {
          file: filePath,
          rule: rule.id,
          error: fixErr?.message || String(fixErr),
        });
        continue;
      }

      if (typeof nextContent === "string" && nextContent !== modifiedContent) {
        modifiedContent = nextContent;
        rulesApplied++;
        void logTelemetry(state, TELEMETRY_RULE_APPLIED, {
          file: filePath,
          rule: rule.id,
          name: rule.name,
          details: detection.details || null,
          lines: Array.isArray(detection.lines) ? detection.lines.length : 0,
          snapshot: snapshotPath,
        });
      }
    }

    // Only write if at least one rule actually changed the content.
    if (rulesApplied > 0 && modifiedContent !== originalContent) {
      try {
        // atomicWriteSync is now an async wrapper around safeWrite. It will:
        //   1. Back up the original to <filePath>.safe_write_backups/<base>.bak.<ISO>
        //   2. Atomic write (temp + rename)
        //   3. Run `node --check` to verify syntax (for .js/.mjs/.cjs)
        //   4. Rollback from backup if validation fails
        //   5. Throw SafeWriteError with details on any failure
        await atomicWriteSync(filePath, modifiedContent);
      } catch (writeErr) {
        void logTelemetry(state, "write_err", {
          file: filePath,
          error: writeErr?.message || String(writeErr),
          snapshot: snapshotPath,
          safeWrite: true,
        });
        throw writeErr;
      }
    }

    // ── Layer 2 (Phase 2h): cross-file rename propagation ──
    // A LOW_RISK_RULES fix MAY optionally return a rename signal via the
    // special sentinel `{ __rename: { oldPath, newPath } }` — used when the
    // rule has moved/renamed a file as part of the fix (e.g. consolidating
    // two files into one). When that signal is detected, we fan out to
    // every dependent and update their require()/import specifiers.
    //
    // Capped at 1 propagation per session (state.sessionL2Cap) to prevent
    // runaway fan-outs. Fail-open: any throw inside the propagator is
    // logged but does NOT fail the host plugin.
    if (renamePropagator && dependencyGraph && cfg.enableLayer2) {
      try {
        const renameSignal = (() => {
          // We check the LAST-applied rule's fix result (modifiedContent
          // now contains a JSON-ish sentinel) — this is a poor man's
          // structured return; rules use this when they rename a file.
          // For now, since no existing rule emits this, the path is
          // dormant but the wiring is in place for future rules.
          if (typeof modifiedContent === "string" && modifiedContent.includes("__rename:")) {
            try {
              const m = modifiedContent.match(/__rename:\s*(\{[^}]+\})/);
              if (m) return JSON.parse(m[1]);
            } catch (_) { /* malformed sentinel — ignore */ }
          }
          return null;
        })();
        if (renameSignal && renameSignal.oldPath && renameSignal.newPath) {
          if ((state.sessionL2Count || 0) >= (cfg.sessionL2Cap ?? 1)) {
            void logTelemetry(state, TELEMETRY_L2_RENAME_SKIPPED, {
              reason: "session_cap",
              file: filePath,
              cap: cfg.sessionL2Cap ?? 1,
            });
          } else {
            state.sessionL2Count = (state.sessionL2Count || 0) + 1;
            void logTelemetry(state, TELEMETRY_L2_RENAME_DETECTED, {
              file: filePath,
              oldPath: renameSignal.oldPath,
              newPath: renameSignal.newPath,
            });
            // Build a graph (cached in state) and plan propagation.
            // Graph build is O(workspace); we cache it for the session so
            // multiple renames don't re-walk.
            if (!state._l2Graph) {
              try {
                state._l2Graph = dependencyGraph.buildDependencyGraph(WORKSPACE);
              } catch (graphErr) {
                void logTelemetry(state, TELEMETRY_L2_RENAME_FAILED, {
                  stage: "graph_build",
                  error: graphErr?.message || String(graphErr),
                });
                state._l2Graph = null;
              }
            }
            if (state._l2Graph) {
              let rewrites = [];
              try {
                rewrites = renamePropagator.planRename(
                  state._l2Graph,
                  renameSignal.oldPath,
                  renameSignal.newPath
                );
                void logTelemetry(state, TELEMETRY_L2_RENAME_PLANNED, {
                  oldPath: renameSignal.oldPath,
                  newPath: renameSignal.newPath,
                  rewrites: rewrites.length,
                  dependents: dependencyGraph.getDependents(state._l2Graph, renameSignal.oldPath).length,
                });
              } catch (planErr) {
                void logTelemetry(state, TELEMETRY_L2_RENAME_FAILED, {
                  stage: "plan",
                  error: planErr?.message || String(planErr),
                });
              }
              if (rewrites.length > 0) {
                try {
                  const result = renamePropagator.applyRenames(state._l2Graph, rewrites, { snapshot: true });
                  void logTelemetry(state, TELEMETRY_L2_RENAME_APPLIED, {
                    oldPath: renameSignal.oldPath,
                    newPath: renameSignal.newPath,
                    applied: result.applied.length,
                    failed: result.failed.length,
                    failedSample: result.failed.slice(0, 3).map((f) => f.error),
                  });
                } catch (applyErr) {
                  void logTelemetry(state, TELEMETRY_L2_RENAME_FAILED, {
                    stage: "apply",
                    error: applyErr?.message || String(applyErr),
                  });
                }
              }
            }
          }
        }
      } catch (l2Err) {
        // FAIL-OPEN: never let Layer 2 break the host. Log + continue.
        void logTelemetry(state, TELEMETRY_L2_RENAME_FAILED, {
          stage: "outer",
          error: l2Err?.message || String(l2Err),
        });
      }
    }

    // Re-verify to surface remaining issues (incl. new syntax errors that
    // a fix may have introduced). Do NOT filter — that would hide regressions.
    let remaining = [];
    try {
      const recheck = await runVerify(filePath, cfg.verifyScript, cfg.verifyTimeoutMs);
      remaining = recheck.errors || [];
      if (remaining.length > 0) {
        void logTelemetry(state, "verify_residual", {
          file: filePath,
          errors: remaining.length,
          sample: String(remaining[0]?.msg || "").substring(0, 500),
        });
      }
    } catch { /* best-effort — notification still fires */ }

    // Compute fixedCount: original errors − remaining errors (clamped ≥ 0).
    // This is the previously-missing observability signal: previously the
    // spawnFixer returned spawn_ok but never told the host how many of the
    // detected issues were actually resolved.
    const fixedCount = Math.max(0, verifyErrors.length - remaining.length);

    if (fixedCount > 0) {
      void logTelemetry(state, TELEMETRY_FIXES_APPLIED, {
        file: filePath,
        model: actualModel,
        original: verifyErrors.length,
        fixed: fixedCount,
        rulesApplied,
        durationMs: Date.now() - startMs,
        snapshot: snapshotPath,
      });
    } else if (rulesApplied > 0) {
      // Rules fired but verify still sees same issues — record for forensics.
      void logTelemetry(state, "fixes_no_progress", {
        file: filePath,
        model: actualModel,
        original: verifyErrors.length,
        rulesApplied,
        remaining: remaining.length,
        durationMs: Date.now() - startMs,
      });
    }

    try {
      sendHealNotification(filePath, fixedCount, actualModel, remaining);
    } catch { /* best-effort */ }
    return; // success — skip outer catch
  } catch (err) {
    void logTelemetry(state, "spawn_err", {
      file: filePath,
      error: err?.message || String(err),
      stage: "alt-a-deterministic",
      rulesApplied,
      snapshot: snapshotPath,
    });
  } finally {
    // Always decrement: allows next file in queue to be processed.
    // Without this, sessionFixerCount is monotonic and caps at 1 forever.
    state.sessionFixerCount = Math.max(0, state.sessionFixerCount - 1);
  }
}

/**
 * Read the fixer subagent prompt template and inject context.
 */
function readFixerPrompt(filePath, verifyErrors) {
  const promptDir = path.dirname(new URL(import.meta.url).pathname);
  const promptPath = path.join(promptDir, "fixer-prompt.md");
  const errorsText = verifyErrors.map((e) => `- ${e.msg}`).join("\n");
  try {
    const template = readFileSync(promptPath, "utf8");
    return template.replace("{{FILE_PATH}}", filePath).replace("{{ERRORS}}", errorsText);
  } catch {
    return `Fix syntax and P0 issues in ${filePath}:\n${errorsText}`;
  }
}

// ── Plugin Entry ──────────────────────────────────────────────────────────

export default definePluginEntry({
  id: "self-healing-loop",
  name: "Self-Healing Loop",
  description:
    "Claude Code-style self-healing edit loop: verify edits, auto-spawn fixer subagent on failure. " +
    "Loop-safe (per-file + session caps), opt-in via config.mode.",

  configSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["log", "fix-syntax", "fix-all"],
        default: "log",
      },
      perFileBudget: {
        type: "number",
        minimum: 0,
        maximum: 5,
        default: 1,
      },
      sessionFixerCap: {
        type: "number",
        minimum: 0,
        maximum: 5,
        default: 1,
      },
      loopBudgetOverride: {
        type: "boolean",
        default: false,
      },
      verifyScript: {
        type: "string",
        default: VERIFY_SCRIPT_DEFAULT,
      },
      verifyTimeoutMs: {
        type: "number",
        minimum: 1000,
        maximum: 60_000,
        default: VERIFY_TIMEOUT_DEFAULT_MS,
      },
      // ── 3-Layer Defense knobs (additive, optional) ──
      // All default to enabled; flip to false to disable a layer.
      enableSessionGate: {
        type: "boolean",
        default: true,
        description: "Layer 1: skip SHL in isolated/cron sessions",
      },
      enablePathGate: {
        type: "boolean",
        default: true,
        description: "Layer 2: skip SHL for skill-content paths",
      },
      enableFixTypeGate: {
        type: "boolean",
        default: true,
        description: "Layer 3: restrict fix types in skill paths",
      },
      // ── Layer 2 knobs (Phase 2h, additive) ──
      enableLayer2: {
        type: "boolean",
        default: false,
        description: "Layer 2: propagate cross-file renames after a deterministic fix",
      },
      sessionL2Cap: {
        type: "number",
        minimum: 0,
        maximum: 10,
        default: 1,
        description: "Max Layer 2 rename propagations per session",
      },
    },
    additionalProperties: false,
  },

  register(api) {
    const cfg = {
      mode: "log",
      perFileBudget: 1,
      sessionFixerCap: 1,
      loopBudgetOverride: false,
      verifyScript: VERIFY_SCRIPT_DEFAULT,
      verifyTimeoutMs: VERIFY_TIMEOUT_DEFAULT_MS,
      // 3-Layer Defense toggles (default enabled)
      enableSessionGate: true,
      enablePathGate: true,
      enableFixTypeGate: true,
      // Layer 2 (Phase 2h) — off by default; opt-in when a fix rule
      // starts emitting __rename: signals.
      enableLayer2: false,
      sessionL2Cap: 1,
      ...(api.pluginConfig || {}),
    };

    // Per-plugin-instance state. Closed over by every hook below.
    const state = createState();

    // ── after_tool_call ──────────────────────────────────────────────────
    // Observe the tool result; if a write/edit/apply_patch call touched a
    // file, run the post-edit verifier.
    api.on(
      "after_tool_call",
      async (event, ctx) => {
        try {
          // Capture sessionKey from ctx (session_start may not fire mid-session)
          if (ctx?.sessionKey) state.sessionKey = ctx.sessionKey;

          const toolName = event?.toolName;
          if (!WRITE_TOOLS.has(toolName)) return; // skip read-only tools

          // ── Layer 1 (PRIMARY GATE): caller session check ──
          // Isolated/cron sessions (skill reviewer) must not trigger SHL.
          // Without this, the skill reviewer would race against SHL on its
          // own edits and could be undone before review completes.
          if (cfg.enableSessionGate && isIsolatedCronSession(state.sessionKey)) {
            void logTelemetry(state, TELEMETRY_SKIP_SKILL_SESSION, {
              sessionKey: state.sessionKey,
              tool: toolName,
            });
            return;
          }

          const filePath = extractFilePath(toolName, event?.params || {});
          if (!filePath) {
            void logTelemetry(state, "skip_no_path", { tool: toolName });
            return;
          }

          // ── Layer 2 (BACKUP GATE): path-based skip ──
          // Skill-content files (skills-learned/, skills/_learned_*/) are
          // authored by humans; SHL must not rewrite them. Belt-and-suspenders
          // layer that catches cases Layer 1 missed (e.g. unusual session-key
          // shape) and is the primary protection for main-session edits to
          // skill content. path.sep delimiter prevents substring collision.
          if (cfg.enablePathGate && isSkillPath(filePath)) {
            void logTelemetry(state, TELEMETRY_SKIP_SKILL_PATH, {
              file: filePath,
              tool: toolName,
              sessionKey: state.sessionKey,
            });
            return;
          }

          // Skip if the tool itself errored (no point verifying a half-written file).
          if (event?.error) {
            void logTelemetry(state, "tool_error_skip", { file: filePath, tool: toolName });
            return;
          }

          // Only verify JS/MJS files (verify_edit.js is JS-only).
          const ext = path.extname(filePath).toLowerCase();
          if (ext !== ".js" && ext !== ".mjs" && ext !== ".cjs") return;

          // Mode gate (log): skip verify, but still record telemetry.
          if (cfg.mode === "log") {
            void logTelemetry(state, "verify_log_skip", { file: filePath, tool: toolName });
            return;
          }

          const result = await runVerify(filePath, cfg.verifyScript, cfg.verifyTimeoutMs);

          if (result.ok) {
            void logTelemetry(state, "verify_ok", { file: filePath, tool: toolName });

            // Phase A (2026-06-20): run lightweight rule audit on the just-written file.
            // Fires immediately (not waiting for 04:30 cron). Non-blocking (sync
            // call to a fast CJS scanner, 0-2ms typical, well under 2s budget).
            // Catches the most common offenders: fsSync without try-catch, magic
            // numbers, simplified Chinese, TODO/FIXME. Critical issues emit a
            // Discord warning so the user is aware before the next cron cycle.
            try {
              const auditResult = auditJustWritten(filePath);
              if (!auditResult || !auditResult.ok) {
                void logTelemetry(state, TELEMETRY_AUDIT_SKIP, {
                  file: filePath,
                  tool: toolName,
                  reason: auditResult?.error || "unknown",
                });
              } else if (auditResult.severity === "critical") {
                void logTelemetry(state, TELEMETRY_AUDIT_CRITICAL, {
                  file: filePath,
                  tool: toolName,
                  issueCount: auditResult.issueCount,
                  durationMs: auditResult.durationMs,
                  sample: auditResult.issues[0]?.msg,
                });
                // Spawn detached child to push Discord warning (non-blocking,
                // can't break the host tool call if it hangs).
                notifyAuditCritical(filePath, auditResult);
              } else if (auditResult.severity === "high") {
                void logTelemetry(state, TELEMETRY_AUDIT_HIGH, {
                  file: filePath,
                  tool: toolName,
                  issueCount: auditResult.issueCount,
                  durationMs: auditResult.durationMs,
                });
              } else {
                void logTelemetry(state, TELEMETRY_AUDIT_OK, {
                  file: filePath,
                  tool: toolName,
                  severity: auditResult.severity,
                  issueCount: auditResult.issueCount,
                  durationMs: auditResult.durationMs,
                });
              }
            } catch (auditErr) {
              void logTelemetry(state, TELEMETRY_AUDIT_ERROR, {
                file: filePath,
                tool: toolName,
                error: auditErr?.message || String(auditErr),
              });
            }
            return;
          }

          void logTelemetry(state, "verify_fail", {
            file: filePath,
            tool: toolName,
            errors: result.errors.length,
            sample: result.errors[0]?.msg,
          });

          if (cfg.mode === "fix-syntax") {
            // Round 5 fix: added 4 most common missing sync APIs.
            // Out-of-scope (less common, kept readable): lstatSync|symlinkSync|
            //   linkSync|readlinkSync|realpathSync|utimesSync|chownSync|
            //   existsSync|fstatSync|fdatasyncSync|fsyncSync|truncateSync|
            //   openSync|closeSync
            const hasSyntaxOrP0 = result.errors.some(
              (e) => /SyntaxError|P0|execSync|readFileSync|writeFileSync|readdirSync|unlinkSync|renameSync|mkdirSync|appendFileSync|copyFileSync|chmodSync|statSync/.test(e.msg || "")
            );
            if (!hasSyntaxOrP0) return; // log-only for non-syntax issues
          }

          // ── Layer 3 (FIX-TYPE GATE): defensive re-check at enqueue ──
          // Even though Layer 2 already filtered skill paths, this is a
          // second line of defense in case isSkillPath() evolves or
          // path.resolve() behaves unexpectedly. If the path somehow still
          // looks skill-like, restrict to allowed fix types and block the
          // whole fix if any judgment-class error is present (conservative).
          if (cfg.enableFixTypeGate && isSkillPath(filePath)) {
            const gate = gateSkillPathFix(result.errors);
            if (!gate.allowed) {
              void logTelemetry(state, TELEMETRY_SKILL_FIX_BLOCKED, {
                file: filePath,
                tool: toolName,
                blockedCount: gate.blockedMsgs.length,
                allowedCount: gate.allowedMsgs.length,
                sample: gate.blockedMsgs[0] || gate.allowedMsgs[0] || null,
              });
              return;
            }
          }

          // fix-all or fix-syntax-with-qualifying-error: enqueue.
          enqueueFix(state, filePath, result.errors, cfg);
        } catch (err) {
          // FAIL-OPEN: never break the host tool call on a hook error.
          await logTelemetry(state, "hook_error", { hook: "after_tool_call", error: err?.message }).catch(() => {});
        }
      },
      { priority: 50, timeoutMs: 15_000 },
    );

    // ── agent_end ────────────────────────────────────────────────────────
    // Drain pending queue. Fire-and-forget per gateway contract.
    api.on(
      "agent_end",
      async (event, ctx) => {
        try {
          if (ctx?.sessionKey) state.sessionKey = ctx.sessionKey;
          await drainQueue(api, state, cfg);
        } catch (err) {
          await logTelemetry(state, "hook_error", { hook: "agent_end", error: err?.message }).catch(() => {});
        }
      },
      { priority: 50, timeoutMs: 30_000 },
    );

    // ── session_start ────────────────────────────────────────────────────
    api.on(
      "session_start",
      async (event, ctx) => {
        try {
          state.sessionKey = ctx?.sessionKey || event?.sessionKey || event?.sessionId || null;
          state.pendingQueue.clear();
          state.fixBudget.clear();
          state.sessionFixerCount = 0;
          state.sessionL2Count = 0;
          state._l2Graph = null;
          void logTelemetry(state, "session_init", { sessionKey: state.sessionKey });
        } catch (err) {
          await logTelemetry(state, "hook_error", { hook: "session_start", error: err?.message }).catch(() => {});
        }
      },
      { priority: 50, timeoutMs: 5_000 },
    );

    // ── session_end ──────────────────────────────────────────────────────
    api.on(
      "session_end",
      async (event, ctx) => {
        try {
          if (ctx?.sessionKey) state.sessionKey = ctx.sessionKey;
          void logTelemetry(state, "cleanup", {
            sessionKey: state.sessionKey,
            pendingAtEnd: state.pendingQueue.size,
            totalFixes: state.sessionFixerCount,
            totalL2Renames: state.sessionL2Count,
            reason: event?.reason,
          });
          state.pendingQueue.clear();
          state.fixBudget.clear();
          state.sessionFixerCount = 0;
          state.sessionL2Count = 0;
          state._l2Graph = null;
          state.sessionKey = null;
        } catch (err) {
          await logTelemetry(state, "hook_error", { hook: "session_end", error: err?.message }).catch(() => {});
        }
      },
      { priority: 50, timeoutMs: 5_000 },
    );
  },
});

// ── Named Exports (for unit testing) ─────────────────────────────────────
// These are pure functions used by the 3-layer defense. Exposed as named
// exports so test.mjs can import and verify them without spinning up the
// OpenClaw plugin host.
export {
  isIsolatedCronSession,
  isSkillPath,
  classifyErrorForSkillPath,
  gateSkillPathFix,
  ISOLATED_CRON_PATTERNS,
  SKILL_PATH_MARKERS,
  SKILL_ALLOWED_PATTERNS,
  SKILL_BLOCKED_PATTERNS,
  TELEMETRY_SKIP_SKILL_SESSION,
  TELEMETRY_SKIP_SKILL_PATH,
  TELEMETRY_SKILL_FIX_BLOCKED,
  // Layer 2 (Phase 2h) — event names for cross-file rename propagation.
  TELEMETRY_L2_RENAME_DETECTED,
  TELEMETRY_L2_RENAME_PLANNED,
  TELEMETRY_L2_RENAME_APPLIED,
  TELEMETRY_L2_RENAME_FAILED,
  TELEMETRY_L2_RENAME_SKIPPED,
};
