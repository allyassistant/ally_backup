/**
 * auxiliary_classifier.js — lightweight keyword triage for per-turn model routing
 *
 * Classifies a prompt into an auxiliary task category based on keyword matching.
 * Returns the model/provider override for that task, or null if no match
 * (letting the route-level fallback handle it).
 *
 * Usage:
 *   const { classifyAuxiliaryTask } = require('./auxiliary_classifier');
 *   const result = classifyAuxiliaryTask("review this code for bugs");
 *   // → { task: "code_review", model: "minimax-portal/MiniMax-M2.7", provider: "minimax-portal" }
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'auxiliary_routing.json');

/** @type {{ version: string, categories: Array<{task: string, desc: string, match: string[], model: string, provider: string}> }|null} */
let configCache = null;
let configMtime = 0;

/**
 * Load auxiliary routing config with mtime-aware cache.
 * Reloads if the file has been modified since last load.
 */
function loadConfig() {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    if (configCache && stat.mtimeMs === configMtime) {
      return configCache;
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    configCache = JSON.parse(raw);
    configMtime = stat.mtimeMs;
    return configCache;
  } catch (err) {
    console.warn(`[auxiliary_classifier] Failed to load config: ${err.message}`);
    return null;
  }
}

/**
 * Classify a prompt into an auxiliary task category.
 * @param {string} prompt - The user's prompt / current turn instruction
 * @returns {{ task: string, model: string, provider: string }|null}
 */
function classifyAuxiliaryTask(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;

  const config = loadConfig();
  if (!config || !Array.isArray(config.categories)) return null;

  const lowerPrompt = prompt.toLowerCase().trim();
  if (!lowerPrompt) return null;

  for (const cat of config.categories) {
    if (!Array.isArray(cat.match) || cat.match.length === 0) continue;

    for (const keyword of cat.match) {
      const kw = keyword.toLowerCase();
      if (!kw) continue;

      // Direct substring match (fast path — covers most cases)
      if (lowerPrompt.includes(kw)) {
        return {
          task: cat.task,
          model: cat.model,
          provider: cat.provider
        };
      }
    }
  }

  return null;
}

module.exports = { classifyAuxiliaryTask, loadConfig };
