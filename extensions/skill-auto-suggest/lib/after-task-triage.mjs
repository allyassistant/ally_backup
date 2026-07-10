/**
 * after-task-triage.mjs — Real-time failure detection → skill candidate
 *
 * Phase A hook (2026-06-20). Spawns scripts/after_task_skill_candidate.js
 * as a fire-and-forget subprocess on every agent_end, so a detected failure
 * pattern becomes a v=3 skill candidate in the review queue within seconds
 * (vs. waiting for the next cron run at 05:00 or 04:30).
 *
 * Design rationale:
 *   - Non-blocking subprocess: never delays the model or breaks the host
 *     tool call (matches self-healing-loop's fire-and-forget pattern).
 *   - Strict 5s timeout: if the subprocess hangs, we abort; the candidate
 *     is dropped (better than blocking the next turn).
 *   - stdout-only contract: parse { ok, candidates, signals } JSON; if the
 *     subprocess fails, log telemetry and continue (fail-open).
 *
 * Exports:
 *   analyzeTaskEnd(messages, sessionKey, ctx) — fire-and-forget
 *
 * Telemetry:
 *   Appends JSONL to ~/.openclaw/workspace/.after_task_triage.jsonl:
 *     { ts, sessionKey, ok, candidates: string[], signals: {...}, error? }
 */

import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { appendFile, mkdir } from "node:fs/promises";

// ── Configuration ────────────────────────────────────────────────────────
const HOME = os.homedir();
const WORKSPACE = process.env.OPENCLAW_WORKSPACE_DIR || path.join(HOME, ".openclaw", "workspace");
const SCRIPT_PATH = path.join(WORKSPACE, "scripts", "after_task_skill_candidate.js");
const TELEMETRY_FILE = path.join(WORKSPACE, ".after_task_triage.jsonl");
const SUBPROCESS_TIMEOUT_MS = 5000;

// ── Helpers ──────────────────────────────────────────────────────────────

/** Append one JSONL line to the telemetry file. Fail-silent. */
async function logTelemetry(entry) {
  try {
    await mkdir(path.dirname(TELEMETRY_FILE), { recursive: true });
    await appendFile(TELEMETRY_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch (_) {
    // Fail-silent: telemetry must never break the model.
  }
}

/** Spawn the subprocess and return parsed JSON result. */
function runTriageSubprocess(payloadJson) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    let proc;
    try {
      proc = spawn("node", [SCRIPT_PATH], {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: SUBPROCESS_TIMEOUT_MS,
      });
    } catch (e) {
      resolve({ ok: false, error: `spawn_failed: ${e.message}` });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill("SIGKILL"); } catch (_) {}
      resolve({ ok: false, error: `timeout_${SUBPROCESS_TIMEOUT_MS}ms` });
    }, SUBPROCESS_TIMEOUT_MS);

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (!timedOut) resolve({ ok: false, error: `subprocess_error: ${err.message}` });
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return; // already resolved

      // Parse stdout JSON
      try {
        const result = JSON.parse(stdout.trim());
        resolve({ ok: true, ...result });
      } catch (e) {
        resolve({
          ok: false,
          error: `parse_failed: ${e.message}`,
          exitCode: code,
          stderr: stderr.slice(0, 200),
        });
      }
    });

    // Write payload to stdin and close
    try {
      proc.stdin.write(payloadJson);
      proc.stdin.end();
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, error: `stdin_write_failed: ${e.message}` });
    }
  });
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Analyze the just-completed task and emit skill candidates if failure
 * signals are detected. Fire-and-forget: returns immediately, runs the
 * subprocess in the background.
 *
 * @param {Array} messages — The conversation messages from agent_end event
 * @param {string} sessionKey — Unique session identifier
 * @param {object} ctx — Hook context (for telemetry path)
 */
export function analyzeTaskEnd(messages, sessionKey, ctx = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return;
  if (!sessionKey) sessionKey = "unknown";

  const payload = JSON.stringify({ sessionKey, messages });

  // Fire-and-forget: don't await, but log result when it lands
  runTriageSubprocess(payload)
    .then((result) => {
      logTelemetry({
        sessionKey,
        ok: result.ok,
        candidates: result.candidates || [],
        signals: result.signals || {},
        error: result.error,
        skipped: result.skipped,
      });
    })
    .catch((err) => {
      logTelemetry({ sessionKey, ok: false, error: `unexpected: ${err.message}` });
    });
}

/**
 * Synchronous wrapper for testing: spawn subprocess and return result.
 * NOT used in production hooks (which use analyzeTaskEnd above).
 */
export async function analyzeTaskEndSync(messages, sessionKey) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: "no_messages" };
  }
  if (!sessionKey) sessionKey = "unknown";
  const payload = JSON.stringify({ sessionKey, messages });
  return await runTriageSubprocess(payload);
}