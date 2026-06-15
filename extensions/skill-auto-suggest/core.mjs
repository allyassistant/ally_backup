/**
 * core.mjs — Pure logic for skill-auto-suggest.
 *
 * Kept separate from index.mjs so index.mjs can import the OpenClaw SDK
 * at the top level without breaking standalone node tests.
 */

import { readdir, readFile, stat, appendFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { scoreSkill, scoreSkillDetailed, scoreSkillVector } from "./matcher.mjs";

const require = createRequire(import.meta.url);
const { extractField } = require("../../scripts/lib/frontmatter.js");

// ── Configuration ──
const HOME = os.homedir();
const SKILLS_DIR = path.join(HOME, ".openclaw", "workspace", "skills");
const TOP_N = 3;
const MIN_SCORE = 0.25;       // discard weak matches (raised from 0.1 after calibration)
const CACHE_TTL_MS = 60_000;  // refresh skill metadata every 60s
const TELEMETRY_FILE = path.join(HOME, ".openclaw", "workspace", ".skill_auto_suggest_telemetry.jsonl");
const TELEMETRY_TASK_MAX_LEN = 200;
const USAGE_LOG_FILE = path.join(HOME, ".openclaw", "workspace", ".skill_usage_log.jsonl");
const EMBEDDINGS_CACHE_FILE = path.join(HOME, ".openclaw", "workspace", ".skill_auto_suggest_embeddings.json");
const DEFAULT_VECTOR_WEIGHT = 0.3; // reduced from 0.7; nomic-embed-text inflates unrelated tasks

// ── Helpers ──

/**
 * Stable short hash of a task string. Used to correlate recall_trigger
 * events with subsequent used/skipped/rejected feedback without logging
 * the full task content.
 */
function hashTask(task) {
  return crypto.createHash("sha256").update(task || "").digest("hex").slice(0, 16);
}

// ── Cache ──
let skillsCache = null;
let cacheTime = 0;
let cacheMtimes = new Map();
let embeddingsCache = null;

// ── Skill metadata loader ──

/**
 * Parse YAML frontmatter for description, status, and disable-model-invocation.
 * Delegates description/status parsing to the shared frontmatter parser so
 * skill-auto-suggest stays in sync with skill-learner and the skill reviewer
 * pipeline. Boolean field parsing mirrors scripts/lib/skill_discovery.js.
 */
function parseFrontmatter(content) {
  const disableRaw = extractField(content, "disable-model-invocation");
  const meta = {
    name: extractField(content, "name"),
    description: extractField(content, "description"),
    status: extractField(content, "status"),
    disableModelInvocation: /^(true|yes|1)$/i.test(disableRaw || ""),
  };
  return meta;
}

/**
 * Build an mtime fingerprint for all SKILL.md files under SKILLS_DIR.
 * Used to invalidate the cache as soon as any skill changes, without waiting
 * for the TTL to expire.
 */
async function buildMtimeFingerprint() {
  let entries;
  try {
    entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  } catch (err) {
    console.error("[skill-auto-suggest] failed to read skills dir:", err.message);
    return null;
  }

  const mtimes = new Map();
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "_archive") continue;

    const skillDir = path.join(SKILLS_DIR, entry.name);
    let isDir = false;
    try {
      const stats = await stat(skillDir);
      isDir = stats.isDirectory();
    } catch {
      continue; // broken symlink or missing dir — skip
    }
    if (!isDir) continue;

    const skillMdPath = path.join(skillDir, "SKILL.md");
    try {
      const stats = await stat(skillMdPath);
      mtimes.set(entry.name, stats.mtimeMs);
    } catch {
      // no SKILL.md or unreadable — record 0 so a later write invalidates
      mtimes.set(entry.name, 0);
    }
  }
  return mtimes;
}

/**
 * Check whether the current cache is still valid given the current mtimes.
 */
function cacheMtimesMatch(current) {
  if (!current) return false;
  if (cacheMtimes.size !== current.size) return false;
  for (const [name, mtime] of current) {
    if (cacheMtimes.get(name) !== mtime) return false;
  }
  return true;
}

/**
 * Load all skill metadata from SKILLS_DIR.
 * Returns array of { name, description, disableModelInvocation }.
 * Silently skips broken symlinks, unparseable files, non-active skills,
 * and skills with disable-model-invocation: true.
 */
async function loadSkills() {
  const now = Date.now();
  const currentMtimes = await buildMtimeFingerprint();

  if (
    skillsCache &&
    currentMtimes &&
    (now - cacheTime) < CACHE_TTL_MS &&
    cacheMtimesMatch(currentMtimes)
  ) {
    return skillsCache;
  }

  if (!currentMtimes) {
    return [];
  }

  const skills = [];
  for (const entryName of currentMtimes.keys()) {
    const skillDir = path.join(SKILLS_DIR, entryName);
    const skillMdPath = path.join(skillDir, "SKILL.md");

    let content;
    try {
      content = await readFile(skillMdPath, "utf-8");
    } catch {
      continue; // no SKILL.md — skip
    }

    const meta = parseFrontmatter(content);
    if (!meta.description) continue;

    // AGENTS.md rule: never recall draft or archived skills.
    const statusLower = (meta.status || "").toLowerCase();
    if (statusLower === "draft" || statusLower === "archived") continue;

    // AGENTS.md rule: never recall skills marked disable-model-invocation.
    if (meta.disableModelInvocation) continue;

    // Use frontmatter name as the authoritative skill name; fall back to dir name.
    const name = meta.name || entryName.replace(/^_learned_/, "");

    skills.push({
      name,
      description: meta.description,
      disableModelInvocation: meta.disableModelInvocation,
    });
  }

  skillsCache = skills;
  cacheTime = now;
  cacheMtimes = currentMtimes;
  return skills;
}

/**
 * Manually invalidate the skill metadata cache. Exported for tests/repl use.
 */
function invalidateSkillsCache() {
  skillsCache = null;
  cacheTime = 0;
  cacheMtimes = new Map();
  embeddingsCache = null;
}

// ── Embeddings ──

/**
 * Load the embeddings cache from disk. Returns null if missing/unreadable.
 */
async function loadEmbeddingsCache() {
  if (embeddingsCache) return embeddingsCache;
  try {
    const raw = await readFile(EMBEDDINGS_CACHE_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || !data.embeddings) return null;
    embeddingsCache = data;
    return data;
  } catch {
    return null;
  }
}

/**
 * Save the embeddings cache to disk atomically.
 */
async function saveEmbeddingsCache(data) {
  embeddingsCache = data;
  const tmpFile = EMBEDDINGS_CACHE_FILE + ".tmp" + Date.now();
  try {
    await writeFile(tmpFile, JSON.stringify(data), "utf8");
    await rename(tmpFile, EMBEDDINGS_CACHE_FILE);
  } catch (err) {
    console.error("[skill-auto-suggest] failed to save embeddings cache:", err.message);
    try { await unlink(tmpFile); } catch {}
  }
}

/**
 * Ensure every skill in `skills` has an embedding. Missing embeddings are
 * generated via `provider.embed()` and persisted to disk.
 *
 * Returns a Map<skillName, embeddingVector>.
 * Fail-open: if provider fails, returns an empty Map so caller falls back to
 * keyword matching.
 */
async function ensureSkillEmbeddings(skills, provider) {
  if (!provider || provider.model === "disabled") return new Map();

  const cache = await loadEmbeddingsCache();
  const modelName = provider.model || "unknown";

  // If the cache was generated by a different model, discard it.
  const validCache = cache && cache.model === modelName ? cache : null;
  const embeddings = new Map(Object.entries(validCache?.embeddings || {}));

  const skillNames = new Set(skills.map(s => s.name));

  // Remove embeddings for skills that no longer exist.
  for (const name of embeddings.keys()) {
    if (!skillNames.has(name)) embeddings.delete(name);
  }

  // Batch missing embeddings.
  const missing = skills.filter(s => !embeddings.has(s.name));
  if (missing.length > 0) {
    console.log(`[skill-auto-suggest] generating ${missing.length} skill embeddings with ${modelName}...`);
    for (const skill of missing) {
      try {
        const vector = await provider.embed(skill.description);
        embeddings.set(skill.name, vector);
      } catch (err) {
        console.error(`[skill-auto-suggest] embedding failed for ${skill.name}:`, err.message);
        // Fail-open: stop trying to embed and let caller fall back to keyword matching.
        return new Map();
      }
    }

    // Persist updated cache.
    const newCache = {
      model: modelName,
      generatedAt: new Date().toISOString(),
      embeddings: Object.fromEntries(embeddings),
    };
    await saveEmbeddingsCache(newCache);
  }

  return embeddings;
}

/**
 * Convenience helper: load skills + embeddings in one call.
 */
async function loadSkillsWithEmbeddings(provider) {
  const skills = await loadSkills();
  const skillEmbeddings = await ensureSkillEmbeddings(skills, provider);
  return { skills, skillEmbeddings };
}

// ── Matching logic ──

/**
 * Extract the user task from hook context. Tries common field names.
 * Avoids falling back to the full prompt unless it looks like a user message.
 */
function extractTask(hookContext) {
  if (!hookContext) return "";
  if (typeof hookContext.userMessage === "string") return hookContext.userMessage;
  if (typeof hookContext.task === "string") return hookContext.task;
  if (typeof hookContext.message === "string") return hookContext.message;
  // prompt may be the full system prompt in some contexts; only use if short.
  if (typeof hookContext.prompt === "string" && hookContext.prompt.length < 500) {
    return hookContext.prompt;
  }
  return "";
}

/**
 * Compute top-N matches for a task against the skill list.
 *
 * Options:
 *   - topN              number (default 3)
 *   - provider          embedding provider; if present, task embedding is generated
 *   - skillEmbeddings   Map<skillName, embeddingVector>
 *   - vectorWeight      number in [0, 1] (default 0.7)
 *
 * If embeddings are available, the final score is a weighted blend of keyword
 * score and vector cosine similarity. If embedding generation fails, falls back
 * to keyword-only scoring.
 */
async function computeTopMatches(task, skills, options = {}) {
  const topN = options.topN ?? TOP_N;
  const vectorWeight = options.vectorWeight ?? DEFAULT_VECTOR_WEIGHT;

  if (!task || task.length < 3) return [];

  // nomic-embed-text (the default local model) is English-centric. For
  // Chinese/CJK-heavy tasks, disable vector similarity and rely on keyword
  // matching to avoid misleading cosine scores.
  const cjkCount = [...task].filter(c => /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(c)).length;
  const cjkRatio = cjkCount / task.length;
  const effectiveVectorWeight = cjkRatio > 0.5 ? 0 : vectorWeight;

  let taskEmbedding = null;
  let skillEmbeddings = options.skillEmbeddings;

  if (
    effectiveVectorWeight > 0 &&
    options.provider &&
    options.provider.model !== "disabled" &&
    skillEmbeddings?.size > 0
  ) {
    try {
      taskEmbedding = await options.provider.embed(task);
    } catch (err) {
      console.error("[skill-auto-suggest] task embedding failed:", err.message);
      taskEmbedding = null;
      skillEmbeddings = null;
    }
  }

  const candidates = skills
    .filter(s => !s.disableModelInvocation)
    .map(s => {
      const { score: keywordScore, keywordMatches, taskWordCount } = scoreSkillDetailed(task, s);
      let vectorScore = 0;
      if (taskEmbedding && skillEmbeddings?.has(s.name)) {
        vectorScore = scoreSkillVector(taskEmbedding, skillEmbeddings.get(s.name));
      }

      // If we have both scores, blend. If only keyword, use keyword.
      // If somehow only vector (shouldn't happen), use vector.
      let finalScore;
      if (taskEmbedding && skillEmbeddings?.has(s.name)) {
        finalScore = (1 - vectorWeight) * keywordScore + vectorWeight * vectorScore;
      } else {
        finalScore = keywordScore;
      }

      return {
        ...s,
        score: finalScore,
        keywordScore,
        vectorScore,
        keywordMatches,
        taskWordCount,
      };
    })
    .filter(s => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return candidates;
}

/**
 * Format matches as the <suggested_skills> block for system prompt injection.
 * Returns empty string if no matches.
 */
function formatSuggestions(matches) {
  if (!matches || matches.length === 0) return "";

  const lines = [
    "<suggested_skills>",
    "The user's task may benefit from one of these skills. Read the SKILL.md if a match is strong enough:",
  ];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    lines.push(`${i + 1}. ${m.name} (score: ${m.score.toFixed(2)})`);
  }
  lines.push("</suggested_skills>");
  return lines.join("\n");
}

// ── Telemetry ──

/**
 * Record a suggestion event to the telemetry log.
 * Fail-open: any error is logged to stderr but never thrown.
 */
async function recordSuggestion(task, matches) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      task: (task || "").slice(0, TELEMETRY_TASK_MAX_LEN),
      matchCount: matches?.length || 0,
      suggestedSkills: (matches || []).map(m => ({ name: m.name, score: Number(m.score.toFixed(4)) })),
      usedVector: matches?.some(m => m.vectorScore > 0) || false,
    };
    await appendFile(TELEMETRY_FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    console.error("[skill-auto-suggest] telemetry write failed:", err.message);
  }
}

/**
 * Record per-skill usage/recall events to the usage log.
 * One line per suggested skill so downstream analytics can compute
 * usage rate, most/least used skills, and recall coverage.
 * Fail-open: any error is logged to stderr but never thrown.
 *
 * Privacy: does NOT log task content, only skill name + score + event type.
 */
async function recordSkillUsage(task, matches) {
  try {
    const ts = new Date().toISOString();
    const taskHash = hashTask(task);
    const lines = (matches || [])
      .filter(m => m && m.name)
      .map(m => JSON.stringify({
        ts,
        event: "recall_trigger",
        skill: m.name,
        score: Number(m.score.toFixed(4)),
        keywordMatches: typeof m.keywordMatches === "number" ? m.keywordMatches : undefined,
        taskWordCount: typeof m.taskWordCount === "number" ? m.taskWordCount : undefined,
        taskHash,
      }));
    if (lines.length === 0) return;
    await appendFile(USAGE_LOG_FILE, lines.join("\n") + "\n", "utf8");
  } catch (err) {
    console.error("[skill-auto-suggest] usage log write failed:", err.message);
  }
}

/**
 * Record explicit feedback for a suggested skill.
 * Events: 'used' (read & followed), 'skipped' (ignored), 'rejected' (wrong).
 * Correlates to the matching recall_trigger via taskHash.
 * Fail-open: any error is logged to stderr but never thrown.
 */
async function recordSkillFeedback({ event, skill, task, reason }) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      event,
      skill,
      taskHash: hashTask(task),
    };
    if (reason) entry.reason = (reason || "").slice(0, 200);
    await appendFile(USAGE_LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    console.error("[skill-auto-suggest] feedback write failed:", err.message);
  }
}

export {
  SKILLS_DIR,
  TOP_N,
  MIN_SCORE,
  CACHE_TTL_MS,
  TELEMETRY_FILE,
  USAGE_LOG_FILE,
  EMBEDDINGS_CACHE_FILE,
  loadSkills,
  loadSkillsWithEmbeddings,
  ensureSkillEmbeddings,
  computeTopMatches,
  formatSuggestions,
  parseFrontmatter,
  extractTask,
  invalidateSkillsCache,
  recordSuggestion,
  recordSkillUsage,
  recordSkillFeedback,
  hashTask,
};
