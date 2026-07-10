/**
 * usage-detector.mjs — Skill use detection for auto-suggest feedback loop (Phase 2b)
 *
 * Pure logic, no I/O. Responsibilities:
 *   1. Extract file paths from tool call params (write / edit / apply_patch)
 *   2. Detect if a path is a SKILL.md
 *   3. Maintain per-session state for suggestion → use correlation
 *
 * Design notes:
 *   - Mirrors self-healing-loop's path-extraction (lib/skill-gate.mjs, lines 158-188)
 *     to keep skill-file detection logic consistent across the two extensions.
 *   - Per-session state is closed-over in register(api) — never persists to disk
 *     (lose-on-crash is acceptable; correlation is best-effort).
 *   - LRU cap (MAX_SESSIONS) protects against runaway memory on long-lived gateways.
 *
 * Phase 2b — added 2026-06-19
 */

import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const SKILLS_DIR = path.join(HOME, ".openclaw", "workspace", "skills");

// Match `skills/<name>/SKILL.md` (anchored)
const SKILL_FILE_RE = /(^|\/)skills\/([^/]+)\/SKILL\.md$/;

const MAX_SESSIONS = 500;

// ── Per-session state ──
// Map<sessionKey, { suggested: [{name, taskHash, ts}], seenPaths: Set<string> }>
const sessionState = new Map();

function getOrInitSession(sessionKey) {
  if (!sessionKey) return null;
  let s = sessionState.get(sessionKey);
  if (!s) {
    // FIFO eviction: insertion-order Map → first key is oldest.
    // Note: this is FIFO, not true LRU. `Map.get()` on an existing key does
    // not move it to the end. For our use case this is acceptable because
    // long-running sessions will simply re-init their state on next access.
    // (See Phase 2b review, 2026-06-19.)
    if (sessionState.size >= MAX_SESSIONS) {
      const oldest = sessionState.keys().next().value;
      sessionState.delete(oldest);
    }
    s = {
      suggested: [],     // current turn's suggestions only (overwritten per turn)
      seenPaths: new Set(), // reset per-turn
    };
    sessionState.set(sessionKey, s);
  }
  return s;
}

function purgeSession(sessionKey) {
  if (sessionKey) sessionState.delete(sessionKey);
}

function resetSeenPaths(sessionKey) {
  const s = sessionState.get(sessionKey);
  if (s) s.seenPaths.clear();
}

// ── Path extraction (mirrors self-healing-loop/index.mjs:158-188) ──
// Extract the file path being touched by a write/edit/apply_patch/read tool call.
// Returns string|null.
//
// 2026-06-23 fix: added `read` tool handling. Previously read events were
// silently dropped (`return null`), causing 99% of skill-use signals to be
// missed (LLM reads SKILL.md to use a skill, not write it). 800/2981
// (26.8%) feedback events in the past 24h were "inferred_skipped" only
// because extractFilePath returned null for read. OpenClaw's `read` tool
// accepts path in any of: path, file_path, filePath (TypeBox schema).

function extractFilePath(toolName, params) {
  if (!params || typeof params !== "object") return null;
  const pick = (...candidates) =>
    candidates.find((c) => typeof c === "string" && c.length > 0) || null;

  if (toolName === "read") {
    return pick(params.path, params.file_path, params.filePath);
  }
  if (toolName === "write") {
    return pick(params.path, params.file_path);
  }
  if (toolName === "edit") {
    return pick(params.path, params.file_path, params.target_file);
  }
  if (toolName === "apply_patch") {
    const direct = pick(params.path, params.file_path);
    if (direct) return direct;
    // applyPatchSchema: file path lives inside the `input` marker block
    //   *** Begin Patch
    //   *** Update File: /path/to/file.js
    //   @@ ... @@
    if (typeof params.input === "string") {
      const m = params.input.match(
        /\*\*\*\s+(?:Update|Add|Delete|Move)\s+File:\s+([^\r\n]+)/
      );
      if (m) return m[1].trim();
    }
    return null;
  }
  return null;
}

// ── Skill file detection ──
// Returns skill name (string) if path matches a SKILL.md, else null.

function detectSkillFile(rawPath) {
  if (!rawPath || typeof rawPath !== "string") return null;
  const normalized = path.normalize(rawPath);
  const m = normalized.match(SKILL_FILE_RE);
  return m ? m[2] : null;
}

// Public API
export {
  SKILLS_DIR,
  SKILL_FILE_RE,
  MAX_SESSIONS,
  sessionState,
  getOrInitSession,
  purgeSession,
  resetSeenPaths,
  extractFilePath,
  detectSkillFile,
};