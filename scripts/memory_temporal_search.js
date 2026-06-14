#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Temporal Memory Search
 * Support time decay + dual-temporal search
 *
 * Run: node scripts/memory_temporal_search.js "search query"
 * Options:
 *   --days N       Search within last N days (default: 30)
 *   --decay        Apply time decay weighting
 *   --event-date   Prioritize by event date (dual-temporal)
 *   --limit N      Return top N results (default: 10)
 */

const fs = require('fs');
const path = require('path');
const { MEMORY_DIR } = require('./lib/config');

// ==================== CONFIG (Magic Numbers) ====================
// Time decay weights: maps days-ago threshold to relevance multiplier
const CONFIG = {
  TIME_DECAY_WEIGHTS: {
    1: 1.0,       // Within 1 day: full weight (100%)
    7: 0.8,       // Within 1 week: 80%
    30: 0.5,      // Within 1 month: 50%
    90: 0.3,      // Within 3 months: 30%
    180: 0.2,     // Within 6 months: 20%
    365: 0.1,     // Within 1 year: 10%
    Infinity: 0.05 // Older: 5%
  }
};

// Alias for backward compat
const DECAY_WEIGHTS = CONFIG.TIME_DECAY_WEIGHTS;

// Calculate time decay weight based on days ago
function calculateDecayWeight(daysAgo) {
  if (daysAgo <= 1) return DECAY_WEIGHTS[1];
  if (daysAgo <= 7) return DECAY_WEIGHTS[7];
  if (daysAgo <= 30) return DECAY_WEIGHTS[30];
  if (daysAgo <= 90) return DECAY_WEIGHTS[90];
  if (daysAgo <= 180) return DECAY_WEIGHTS[180];
  if (daysAgo <= 365) return DECAY_WEIGHTS[365];
  return DECAY_WEIGHTS[Infinity];
}

// Parse dual-temporal info from entry line
function parseTemporalInfo(line, fileDate) {
  const result = {
    recordDate: fileDate,  // Default to file date
    eventDate: null,       // Will be extracted if present
    hasEventDate: false
  };

  // Pattern: [事件: YYYY-MM-DD | 記錄: YYYY-MM-DD]
  const dualMatch = line.match(/\[事件:\s*(\d{4}-\d{2}-\d{2})\s*\|\s*記錄:\s*(\d{4}-\d{2}-\d{2})\]/);
  if (dualMatch) {
    result.eventDate = dualMatch[1];
    result.recordDate = dualMatch[2];
    result.hasEventDate = true;
    return result;
  }

  // Pattern: [記錄: YYYY-MM-DD]
  const recordMatch = line.match(/\[記錄:\s*(\d{4}-\d{2}-\d{2})\]/);
  if (recordMatch) {
    result.recordDate = recordMatch[1];
    return result;
  }

  return result;
}

// Calculate score for a memory entry
function calculateScore(line, query, fileDate, options = {}) {
  const { applyDecay = false, prioritizeEventDate = false } = options;

  // Basic relevance: count keyword matches
  const queryWords = query.toLowerCase().split(/\s+/);
  const lineLower = line.toLowerCase();
  let relevance = 0;

  for (const word of queryWords) {
    if (lineLower.includes(word)) {
      relevance += 1;
      // Bonus for exact phrase match
      if (lineLower.includes(query.toLowerCase())) {
        relevance += 2;
      }
    }
  }

  if (relevance === 0) return 0;

  // Parse temporal info
  const temporal = parseTemporalInfo(line, fileDate);
  const now = new Date();

  // Calculate days ago (for decay)
  const recordDate = new Date(temporal.recordDate);
  const daysSinceRecord = Math.floor((now - recordDate) / (1000 * 60 * 60 * 24));

  // Calculate event urgency (for dual-temporal)
  let eventUrgency = 1.0;
  if (temporal.hasEventDate && prioritizeEventDate) {
    const eventDate = new Date(temporal.eventDate);
    const daysUntilEvent = Math.floor((eventDate - now) / (1000 * 60 * 60 * 24));

    if (daysUntilEvent > 0) {
      // Future event: more urgent if sooner
      eventUrgency = 1 + (30 / (daysUntilEvent + 1)); // Boost upcoming events
    } else if (daysUntilEvent > -7) {
      // Recent past event (within 1 week): still somewhat relevant
      eventUrgency = 0.8;
    } else {
      // Old past event: less relevant
      eventUrgency = 0.5;
    }
  }

  // Apply time decay to record date
  const decayWeight = applyDecay ? calculateDecayWeight(daysSinceRecord) : 1.0;

  // Final score
  const finalScore = relevance * decayWeight * eventUrgency;

  return {
    score: finalScore,
    relevance,
    decayWeight,
    eventUrgency,
    daysSinceRecord,
    temporal,
    line
  };
}

// Search memory files
function searchMemory(query, options = {}) {
  const {
    daysBack = 30,
    applyDecay = false,
    prioritizeEventDate = false,
    limit = 10
  } = options;

  try {
    const results = [];
    const now = new Date();
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    // Get all memory files (support both YYYY-MM-DD.md and YYYY-MM-DD-HHMM.md formats)
    let files;
    try {
      files = fs.readdirSync(MEMORY_DIR)
        .filter(f => f.match(/^\d{4}-\d{2}-\d{2}.*\.md$/) && !f.includes('l0-') && !f.includes('l1-'))
        .sort((a, b) => {
          // Extract date from both filenames for comparison
          const dateA = a.slice(0, 10);
          const dateB = b.slice(0, 10);
          if (dateA !== dateB) return dateB.localeCompare(dateA); // Date descending
          return b.localeCompare(a); // If same date, sort by full name descending
        }); // Newest first
    } catch (e) {
      console.error('Error: ' + e.message);
      return [];
    }

    // Track processed dates to avoid duplicates (prefer timestamped files)
    const processedDates = new Set();

    for (const file of files) {
      const fileDate = file.slice(0, 10); // Extract YYYY-MM-DD

      // Skip if we already processed this date (prefer files with timestamps)
      if (processedDates.has(fileDate)) continue;
      processedDates.add(fileDate);

      const fileDateObj = new Date(fileDate);

    // Skip files older than cutoff
    if (fileDateObj < cutoffDate) continue;

    const filePath = path.join(MEMORY_DIR, file);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      console.error('Error: ' + e.message);
      continue;
    }
    const lines = content.split('\n');

    for (const line of lines) {
      if (!line.trim() || line.startsWith('#')) continue;

      const scoreResult = calculateScore(line, query, fileDate, {
        applyDecay,
        prioritizeEventDate
      });

      if (scoreResult.score > 0) {
        results.push({
          ...scoreResult,
          file: fileDate
        });
      }
    }
  }

  // Sort by score (descending)
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
  } catch (e) {
    console.error('⚠️ searchMemory failed:', e.message);
    return [];
  }
}

// Format output
function formatResults(results, options = {}) {
  if (results.length === 0) {
    return 'No matching memories found.';
  }

  const { verbose = false } = options;

  let output = `\n📚 Temporal Memory Search Results\n`;
  output += `================================\n\n`;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const rank = i + 1;

    output += `[${rank}] ${r.line.slice(0, 120)}\n`;

    if (verbose) {
      output += `    📁 File: ${r.file}\n`;
      output += `    📅 Record: ${r.temporal.recordDate}`;
      if (r.temporal.hasEventDate) {
        output += ` | Event: ${r.temporal.eventDate}`;
      }
      output += `\n`;
      output += `    📊 Score: ${r.score.toFixed(2)} (rel:${r.relevance} × decay:${r.decayWeight.toFixed(2)}`;
      if (r.eventUrgency !== 1) {
        output += ` × urgency:${r.eventUrgency.toFixed(2)}`;
      }
      output += `)\n`;
    }

    output += `\n`;
  }

  return output;
}

// Main
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  log(`
Temporal Memory Search
======================

Usage:
  node scripts/memory_temporal_search.js "search query"
  node scripts/memory_temporal_search.js "meeting" --days 7 --decay
  node scripts/memory_temporal_search.js "travel" --event-date --limit 5

Options:
  --days N       Search within last N days (default: 30)
  --decay        Apply time decay weighting (older = lower score)
  --event-date   Prioritize by event date (dual-temporal mode)
  --limit N      Return top N results (default: 10)
  --verbose      Show detailed scoring info
  --help, -h     Show this help

Time Decay Weights:
  ≤1 day:   100%
  ≤1 week:  80%
  ≤1 month: 50%
  ≤3 months: 30%
  ≤6 months: 20%
  ≤1 year:  10%
  >1 year:   5%

Examples:
  # Search for "Japan" with decay
  node scripts/memory_temporal_search.js "Japan" --decay

  # Search for upcoming events
  node scripts/memory_temporal_search.js "meeting" --event-date --days 90

  # Search with verbose output
  node scripts/memory_temporal_search.js "project" --decay --verbose
  `);
  process.exit(0);
}

// Parse query (first non-flag argument)
const query = args.find(arg => !arg.startsWith('--') && !arg.startsWith('-'));

if (!query) {
  log('❌ Please provide a search query');
  log('Usage: node scripts/memory_temporal_search.js "query" [--options]');
  process.exit(1);
}

// Parse options
const daysIndex = args.indexOf('--days');
let daysBack = daysIndex !== -1 ? parseInt(args[daysIndex + 1]) : 30;
if (isNaN(daysBack) || daysBack < 1) daysBack = 30;

const limitIndex = args.indexOf('--limit');
let limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1]) : 10;
if (isNaN(limit) || limit < 1) limit = 10;

const applyDecay = args.includes('--decay');
const prioritizeEventDate = args.includes('--event-date');
const verbose = args.includes('--verbose');

// Search
log(`\n🔍 Searching: "${query}"`);
log(`📅 Time range: last ${daysBack} days`);
if (applyDecay) log(`⏳ Time decay: ENABLED`);
if (prioritizeEventDate) log(`📅 Dual-temporal: ENABLED`);
log('');

const results = searchMemory(query, {
  daysBack,
  applyDecay,
  prioritizeEventDate,
  limit
});

log(formatResults(results, { verbose }));
log(`Found ${results.length} result(s)`);
