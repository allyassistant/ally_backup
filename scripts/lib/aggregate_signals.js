'use strict';

/**
 * aggregate_signals.js — Shared signal aggregation logic
 *
 * Used by both:
 *   - extensions/skill-learner/index.mjs (ESM via createRequire)
 *   - scripts/skill_reviewer.js (CJS via require)
 *
 * Aggregates queue entries into structured signal groups for
 * Hermes-style pattern detection in the review pipeline.
 *
 * Each signal includes firstSeen/lastSeen timestamps for temporal tracking.
 */

/**
 * Aggregate a batch of queue entries into structured signal groups.
 * @param {Array<Object>} entries — Queue entries (raw parsed JSON lines)
 * @returns {{ recurring: Array, errors: Array, workflows: Array }}
 *   Each array entry has `firstSeen` and `lastSeen` ISO timestamps.
 */
function aggregateSignals(entries) {
  const toolStats = {};         // { toolName: { count, failures, firstSeen, lastSeen, errors[] } }
  const errorClasses = {};      // { errorClass: { count, firstSeen, lastSeen, samples[] } }
  const workflowPatterns = {};  // { sorted-tool-set-key: { count, firstSeen, lastSeen, samples[] } }
  const toolErrorPatterns = {}; // { tool|errorKey: { tool, errorClass, count, firstSeen, lastSeen, sample } }

  for (const entry of entries) {
    // Skip entries that don't look like queue entries (backward compat)
    if (!entry || typeof entry !== 'object') continue;
    if (!entry.compressed && !entry.toolCallCount) continue;

    const entryTs = entry.ts || new Date().toISOString();
    const toolsInThisEntry = new Set();

    // Collect tool stats from compressed turns
    if (Array.isArray(entry.compressed)) {
      for (const turn of entry.compressed) {
        if (turn && Array.isArray(turn.toolNames)) {
          for (const tn of turn.toolNames) {
            toolsInThisEntry.add(tn);
            if (!toolStats[tn]) {
              toolStats[tn] = { count: 0, failures: 0, firstSeen: entryTs, lastSeen: entryTs, errors: [] };
            }
            toolStats[tn].count++;
            toolStats[tn].lastSeen = entryTs;
            if (entry.success === false && entry.error) {
              toolStats[tn].failures++;
              // Group tool failures by distinct error pattern
              const ec = entry.error.replace(/\d+/g, '#').slice(0, 100);
              const errorKey = tn + '|' + ec;
              if (!toolErrorPatterns[errorKey]) {
                toolErrorPatterns[errorKey] = {
                  tool: tn, errorClass: ec, count: 0, firstSeen: entryTs, lastSeen: entryTs, sample: ''
                };
              }
              toolErrorPatterns[errorKey].count++;
              toolErrorPatterns[errorKey].lastSeen = entryTs;
              if (!toolErrorPatterns[errorKey].sample) {
                toolErrorPatterns[errorKey].sample = entry.error.slice(0, 120);
              }
              // Also track in raw error list (up to 3 samples)
              if (!toolStats[tn].firstSeen) toolStats[tn].firstSeen = entryTs;
              if (!toolStats[tn].errors) toolStats[tn].errors = [];
              if (toolStats[tn].errors.length < 3) {
                toolStats[tn].errors.push(entry.error);
              }
            }
          }
        }
      }
    }

    // Collect error classes
    if (entry.error) {
      const ec = entry.error.replace(/\d+/g, '#').slice(0, 100);
      if (!errorClasses[ec]) {
        errorClasses[ec] = { count: 0, firstSeen: entryTs, lastSeen: entryTs, samples: [] };
      }
      errorClasses[ec].count++;
      errorClasses[ec].lastSeen = entryTs;
      if (errorClasses[ec].samples.length < 3) {
        errorClasses[ec].samples.push(entry.error.slice(0, 120));
      }
    }

    // Collect tool combination workflows
    if (toolsInThisEntry.size > 0) {
      const key = [...toolsInThisEntry].sort().join('+');
      if (!workflowPatterns[key]) {
        workflowPatterns[key] = { count: 0, firstSeen: entryTs, lastSeen: entryTs, samples: [] };
      }
      workflowPatterns[key].count++;
      workflowPatterns[key].lastSeen = entryTs;
      if (workflowPatterns[key].samples.length < 3) {
        workflowPatterns[key].samples.push(
          (entry.userPrompt || '').slice(0, 100)
        );
      }
    }
  }

  // --- Build structured result ---
  const recurring = [];
  const errors = [];
  const workflows = [];

  // Recurring tool failures grouped by distinct error pattern
  for (const [, info] of Object.entries(toolErrorPatterns)) {
    if (info.count >= 2) {
      recurring.push({
        type: 'tool_failure',
        tool: info.tool,
        errorClass: info.errorClass,
        count: info.count,
        firstSeen: info.firstSeen,
        lastSeen: info.lastSeen,
        sample: info.sample
      });
    }
  }

  // Recurring error classes: same error pattern 2+ times
  for (const [pattern, info] of Object.entries(errorClasses)) {
    if (info.count >= 2) {
      errors.push({
        type: 'error_class',
        pattern: pattern.slice(0, 80),
        count: info.count,
        firstSeen: info.firstSeen,
        lastSeen: info.lastSeen,
        samples: info.samples
      });
    }
  }

  // Workflow signals: same tool combination 3+ times
  for (const [combo, info] of Object.entries(workflowPatterns)) {
    if (info.count >= 3) {
      workflows.push({
        type: 'workflow',
        tools: combo.split('+'),
        count: info.count,
        firstSeen: info.firstSeen,
        lastSeen: info.lastSeen,
        samplePrompts: info.samples
      });
    }
  }

  return { recurring, errors, workflows };
}

module.exports = { aggregateSignals };
