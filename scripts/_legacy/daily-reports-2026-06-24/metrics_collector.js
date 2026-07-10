#!/usr/bin/env node
'use strict';

/**
 * metrics_collector.js — Phase 1 routing staged-rollout metrics collector.
 * Reads scripts/router/decision_log.jsonl, filters to routeModel decision
 * entries (those carrying `actualProvider`), aggregates a daily rollup,
 * writes metrics/YYYY-MM-DD.json (atomic, idempotent), and optionally
 * pushes a Discord summary to #⚙️系統.
 *
 * CLI:
 *   node metrics_collector.js                          # today (UTC), + Discord
 *   node metrics_collector.js --date YYYY-MM-DD        # specific UTC date
 *   node metrics_collector.js --no-discord             # skip Discord send
 *   node metrics_collector.js --help                   # usage
 * @version 1.0
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Constants (P0: no magic numbers in function bodies)

const DECISION_LOG_PATH = path.join(__dirname, 'scripts', 'router', 'decision_log.jsonl');
const METRICS_DIR = path.join(__dirname, 'metrics');
const DISCORD_CHANNEL_ID = '1473376125584670872';   // #⚙️系統
const DISCORD_CHANNEL_NAME = 'discord';
const COLLECTOR_VERSION = '1.0';
const SCHEMA_VERSION = '1.0';

const TOP_N = 5;
const RATE_PRECISION = 100;        // fallbackRate: 2 decimals
const DEPTH_PRECISION = 100;       // fallbackDepthAvg: 2 decimals
const COST_PRECISION = 10000;      // totalCostUsd: 4 decimals
const DISCORD_SEND_TIMEOUT_MS = 30000;

// CLI parsing

function parseArgs(argv) {
  const opts = { date: null, noDiscord: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--no-discord') opts.noDiscord = true;
    else if (a === '--date') {
      const v = argv[++i];
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        process.stderr.write(`[ERROR] --date expects YYYY-MM-DD, got: ${v}\n`);
        process.exit(1);
      }
      opts.date = v;
    } else {
      process.stderr.write(`[ERROR] Unknown flag: ${a}\n`);
      process.exit(1);
    }
  }
  return opts;
}

function printHelp() {
  process.stdout.write([
    'metrics_collector.js — Phase 1 routing metrics collector',
    '',
    'Usage:',
    '  node metrics_collector.js                          # today (UTC), send to Discord',
    '  node metrics_collector.js --date YYYY-MM-DD        # specific UTC date',
    '  node metrics_collector.js --no-discord             # skip Discord send',
    '  node metrics_collector.js --help                   # this help',
    '',
    'Outputs:',
    '  metrics/YYYY-MM-DD.json   daily rollup (atomic, idempotent)',
    '',
    'Source:',
    '  scripts/router/decision_log.jsonl  (read-only)'
  ].join('\n') + '\n');
}

// 1. loadDecisionLog(date) — read JSONL, filter to model-decision entries

function loadDecisionLog(date) {
  const entries = [];
  if (!fs.existsSync(DECISION_LOG_PATH)) {
    process.stderr.write(`[WARN] Decision log not found: ${DECISION_LOG_PATH}\n`);
    return entries;
  }

  let content;
  try {
    content = fs.readFileSync(DECISION_LOG_PATH, 'utf8');
  } catch (err) {
    process.stderr.write(`[ERROR] Failed to read decision log: ${err.message}\n`);
    return entries;
  }

  const start = Date.parse(`${date}T00:00:00.000Z`);
  const end = Date.parse(`${date}T23:59:59.999Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    process.stderr.write(`[ERROR] Invalid date: ${date}\n`);
    return entries;
  }

  let skippedMalformed = 0, skippedBadTs = 0;
  let skippedNoProvider = 0, skippedOutOfWindow = 0;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed;
    try { parsed = JSON.parse(trimmed); }
    catch (_) { skippedMalformed++; continue; }
    if (!parsed || typeof parsed !== 'object') { skippedMalformed++; continue; }

    // Only model-decision entries (routing_decision + event entries skipped).
    if (parsed.actualProvider === undefined || parsed.actualProvider === null) {
      skippedNoProvider++; continue;
    }
    if (typeof parsed.ts !== 'string') { skippedBadTs++; continue; }

    const ts = Date.parse(parsed.ts);
    if (Number.isNaN(ts)) { skippedBadTs++; continue; }
    if (ts < start || ts > end) { skippedOutOfWindow++; continue; }

    entries.push(parsed);
  }

  if (skippedMalformed > 0 || skippedBadTs > 0) {
    process.stderr.write(`[WARN] Skipped ${skippedMalformed} malformed + ${skippedBadTs} bad-ts lines\n`);
  }
  if (skippedNoProvider > 0) {
    process.stderr.write(`[INFO] Filtered ${skippedNoProvider} non-model-decision entries (routing/event)\n`);
  }
  if (skippedOutOfWindow > 0) {
    process.stderr.write(`[INFO] Filtered ${skippedOutOfWindow} entries outside ${date} window\n`);
  }
  return entries;
}

// 2. aggregateMetrics(entries)

function aggregateMetrics(entries) {
  const totals = {
    decisionCount: entries.length,
    successCount: 0, failureCount: 0,
    totalCostUsd: 0, avgLatencyMs: 0
  };

  const routeDistribution = {};
  const providerDistribution = {};
  const hourlyDistribution = {};
  for (let h = 0; h < 24; h++) hourlyDistribution[String(h).padStart(2, '0')] = 0;

  const failureByRoute = {};
  const fallbackByProvider = {};

  let latencySum = 0, latencyCount = 0;
  let fallbackDepthSum = 0, fallbackCount = 0;

  for (const e of entries) {
    // success (default true), cost (default 0), latency (skip 0/negative noise)
    const success = e.success === undefined ? true : Boolean(e.success);
    if (success) totals.successCount++; else totals.failureCount++;
    const cost = (typeof e.costEstimate === 'number' && Number.isFinite(e.costEstimate))
      ? e.costEstimate : 0;
    totals.totalCostUsd += cost;
    if (typeof e.latencyMs === 'number' && Number.isFinite(e.latencyMs) && e.latencyMs > 0) {
      latencySum += e.latencyMs; latencyCount++;
    }

    // route (uppercase normalize, default UNKNOWN), provider (default "unknown")
    const route = (typeof e.route === 'string' ? e.route : 'UNKNOWN').toUpperCase();
    routeDistribution[route] = (routeDistribution[route] || 0) + 1;
    const provider = (typeof e.actualProvider === 'string' && e.actualProvider.length > 0)
      ? e.actualProvider : 'unknown';
    providerDistribution[provider] = (providerDistribution[provider] || 0) + 1;

    // fallback depth, failure by route, hourly bucket
    const fb = (typeof e.fallbackDepth === 'number' && Number.isFinite(e.fallbackDepth))
      ? e.fallbackDepth : 0;
    if (fb > 0) {
      fallbackDepthSum += fb; fallbackCount++;
      fallbackByProvider[provider] = (fallbackByProvider[provider] || 0) + 1;
    }
    if (!success) failureByRoute[route] = (failureByRoute[route] || 0) + 1;
    const tsMs = Date.parse(e.ts);
    if (!Number.isNaN(tsMs)) {
      const hour = String(new Date(tsMs).getUTCHours()).padStart(2, '0');
      hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1;
    }
  }

  totals.avgLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0;
  totals.totalCostUsd = Math.round(totals.totalCostUsd * COST_PRECISION) / COST_PRECISION;

  const primaryHitCount = entries.length - fallbackCount;
  const fallbackRate = entries.length > 0
    ? Math.round((fallbackCount / entries.length) * RATE_PRECISION) / RATE_PRECISION
    : 0;
  const fallbackDepthAvg = fallbackCount > 0
    ? Math.round((fallbackDepthSum / fallbackCount) * DEPTH_PRECISION) / DEPTH_PRECISION
    : 0;

  const fallbackStats = { primaryHitCount, fallbackCount, fallbackRate, fallbackDepthAvg };

  const topFailingRoutes = Object.entries(failureByRoute)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_N)
    .map(([route, count]) => ({ route, failureCount: count }));

  const topFallingBackProviders = Object.entries(fallbackByProvider)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_N)
    .map(([provider, count]) => ({ provider, fallbackCount: count }));

  return {
    totals, routeDistribution, providerDistribution, fallbackStats,
    topFailingRoutes, topFallingBackProviders, hourlyDistribution
  };
}

// 3. writeDailyRollup(rollup)

function writeDailyRollup(rollup) {
  let createdDir = false;
  try {
    if (!fs.existsSync(METRICS_DIR)) {
      fs.mkdirSync(METRICS_DIR, { recursive: true });
      createdDir = true;
    }
  } catch (err) {
    process.stderr.write(`[ERROR] Failed to create metrics dir: ${err.message}\n`);
    process.exit(1);
  }

  const outPath = path.join(METRICS_DIR, `${rollup.date}.json`);
  const tempPath = `${outPath}.tmp.${process.pid}`;

  try {
    fs.writeFileSync(tempPath, JSON.stringify(rollup, null, 2) + '\n', 'utf8');
    fs.renameSync(tempPath, outPath);
  } catch (err) {
    process.stderr.write(`[ERROR] Failed to write rollup ${outPath}: ${err.message}\n`);
    try { fs.unlinkSync(tempPath); } catch (_) { /* best-effort cleanup */ }
    process.exit(1);
  }

  if (createdDir) process.stderr.write(`[INFO] Created metrics dir: ${METRICS_DIR}\n`);
  return outPath;
}

// 4. formatDiscordSummary(rollup)

function formatDiscordSummary(rollup) {
  const t = rollup.totals, f = rollup.fallbackStats;
  const successRate = t.decisionCount > 0 ? (t.successCount / t.decisionCount) * 100 : 0;
  const fallbackRate = f.fallbackRate * 100;

  const sortedRoutes = Object.entries(rollup.routeDistribution)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topRoute = sortedRoutes[0];
  const topRouteStr = topRoute ? `${topRoute[0]} (${topRoute[1]})` : 'N/A';

  const sortedProviders = Object.entries(rollup.providerDistribution)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topProvider = sortedProviders[0];
  const topProviderStr = topProvider ? `${topProvider[0]} (${topProvider[1]})` : 'N/A';

  return [
    `📊 **Phase 1 Daily Metrics** — ${rollup.date}`,
    `- Total decisions: ${t.decisionCount}`,
    `- Success rate: ${successRate.toFixed(1)}%`,
    `- Fallback rate: ${fallbackRate.toFixed(1)}%`,
    `- Total cost: $${t.totalCostUsd.toFixed(2)}`,
    `- Top route: ${topRouteStr}`,
    `- Top provider: ${topProviderStr}`
  ].join('\n');
}

// 5. sendToDiscord(summary)

function sendToDiscord(summary) {
  const escaped = JSON.stringify(summary);   // safe embed of \n / quotes
  // Bug fix 2026-06-21: raw channel ID was being rejected with
  //   "Ambiguous Discord recipient 1473376125584670872. ... use channel:1473376125584670872"
  // Daily metrics push silently failed for 4 days. Prefix with `channel:` so
  // openclaw CLI routes to the guild channel rather than treating it as a DM.
  const cmd = [
    '/opt/homebrew/bin/openclaw', 'message', 'send',
    '--channel', DISCORD_CHANNEL_NAME,
    '--target', `channel:${DISCORD_CHANNEL_ID}`,
    '-m', escaped
  ].join(' ');

  try {
    execSync(cmd, { stdio: 'pipe', timeout: DISCORD_SEND_TIMEOUT_MS });
    return true;
  } catch (err) {
    process.stderr.write(`[WARN] Discord send failed: ${err.message}\n`);
    return false;
  }
}

// Main

function todayUtcDate() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) { printHelp(); return; }

  const date = opts.date || todayUtcDate();
  const period = {
    start: `${date}T00:00:00.000Z`,
    end: `${date}T23:59:59.999Z`
  };

  process.stdout.write(`[INFO] Collecting metrics for ${date}\n`);
  process.stdout.write(`[INFO] Source: ${DECISION_LOG_PATH}\n`);

  const entries = loadDecisionLog(date);
  if (entries.length === 0) {
    process.stderr.write(`[WARN] No model-decision entries for ${date}; writing zero rollup\n`);
  } else {
    process.stdout.write(`[INFO] Loaded ${entries.length} model-decision entries\n`);
  }

  const agg = aggregateMetrics(entries);
  const rollup = {
    date, period, ...agg,
    schemaVersion: SCHEMA_VERSION,
    collectorVersion: COLLECTOR_VERSION
  };

  const outPath = writeDailyRollup(rollup);
  process.stdout.write(`[INFO] Wrote rollup: ${outPath}\n`);

  // Cron log one-liner (greppable)
  const t = rollup.totals, f = rollup.fallbackStats;
  const successRate = t.decisionCount > 0 ? (t.successCount / t.decisionCount * 100).toFixed(1) : '0.0';
  const fallbackRate = (f.fallbackRate * 100).toFixed(1);
  process.stdout.write(
    `[SUMMARY] date=${date} count=${t.decisionCount} ` +
    `success=${successRate}% fallback=${fallbackRate}% ` +
    `cost=$${t.totalCostUsd.toFixed(2)}\n`
  );

  if (opts.noDiscord) {
    process.stdout.write(`[INFO] --no-discord flag set, skipping Discord send\n`);
  } else {
    const ok = sendToDiscord(formatDiscordSummary(rollup));
    process.stdout.write(`[INFO] Discord send: ${ok ? 'OK' : 'FAILED (see stderr)'}\n`);
  }
}

main();
