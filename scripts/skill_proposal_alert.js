#!/usr/bin/env node
'use strict';

/**
 * skill_proposal_alert.js — Escalation reader for stuck skill proposals.
 *
 * Reads `.state/audit_to_skill_emissions.jsonl`, groups `skipped_pre_emit`
 * events by proposed_skill_name + matched_skill, and emits an alert for any
 * pair whose most-recent skip is older than `--since` days (default 7).
 *
 * Motivation: the drift detector caught a 19-day stall of
 *   wrapper-fs-safe-write -> node-fs-enoent-debugging
 * with similarity 0.855 >= 0.85, but the two skills cover different domains
 * and the dedup was a false positive. There is no other escalation channel,
 * so a stuck pair can sit forever. This script surfaces them so a human
 * (or cron job wired to it) can bump the threshold / narrow the proposal /
 * add to allowlist.
 *
 * Output:
 *   - JSONL appended to `memory/alerts.jsonl` (one record per stuck pair)
 *   - JSON record printed to stdout (always)
 *   - Per-day dedup via `.state/skill_proposal_alerts.jsonl` so re-running
 *     the same day does not double-alert.
 *
 * Flags:
 *   --since N    Stuck threshold in days (default 7).
 *   --dry-run    Don't append to memory/alerts.jsonl or dedup history.
 *   --help, -h   Show usage.
 *
 * Exit: 0 success / no events, 1 write failure, 2 invalid args.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const WS = path.join(process.env.HOME || os.homedir(), '.openclaw', 'workspace');
const AUDIT_FILE = path.join(WS, '.state', 'audit_to_skill_emissions.jsonl');
const ALERTS_OUTPUT = path.join(WS, 'memory', 'alerts.jsonl');
const ALERTS_HISTORY = path.join(WS, '.state', 'skill_proposal_alerts.jsonl');
const SINCE_DAYS_DEFAULT = 7;
const SUGGESTED_ACTION =
  'Either (a) narrow the proposed skill to its own concept, ' +
  '(b) raise dedup threshold to 0.92+ to allow emission, ' +
  'or (c) confirm skills are equivalent and add to allowlist.';

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { since: SINCE_DAYS_DEFAULT, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since') {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0) {
        console.error(`--since expects a non-negative number, got: ${argv[i]}`);
        process.exit(2);
      }
      args.since = v;
    } else if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/skill_proposal_alert.js [--since N] [--dry-run]');
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

// ── IO helpers ──────────────────────────────────────────────────────────────

function readJSONL(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    console.error(`read error: ${filePath} (${err.code || 'unknown'}): ${err.message}`);
    return [];
  }
  const events = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj === 'object') events.push(obj);
    } catch {
      /* skip malformed line — audit log can have noise */
    }
  }
  return events;
}

function appendJSONL(filePath, record) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
    return true;
  } catch (err) {
    console.error(`write error: ${filePath} (${err.code || 'unknown'}): ${err.message}`);
    return false;
  }
}

function dateKey(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function loadAlertedKeys(historyPath) {
  const keys = new Set();
  if (!fs.existsSync(historyPath)) return keys;
  for (const e of readJSONL(historyPath)) {
    if (!e || !e.proposalName || !e.matchedAgainst || !e.timestamp) continue;
    keys.add(`${e.proposalName}|${e.matchedAgainst}|${dateKey(e.timestamp)}`);
  }
  return keys;
}

// ── Group + filter ─────────────────────────────────────────────────────────

function pairBuckets(events) {
  const buckets = new Map();
  for (const e of events) {
    if (e.status !== 'skipped_pre_emit') continue;
    if (!e.proposed_skill_name || !e.matched_skill) continue;
    const key = `${e.proposed_skill_name}->${e.matched_skill}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { firstTs: e.ts, lastTs: e.ts, occurrences: 0, sample: e };
      buckets.set(key, bucket);
    }
    bucket.occurrences += 1;
    if (e.ts && (!bucket.firstTs || e.ts < bucket.firstTs)) bucket.firstTs = e.ts;
    if (e.ts && (!bucket.lastTs || e.ts > bucket.lastTs)) {
      bucket.lastTs = e.ts;
      bucket.sample = e;
    }
  }
  return buckets;
}

function stuckPairs(buckets, cutoffMs) {
  const stuck = [];
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    const ts = new Date(bucket.lastTs).getTime();
    if (!Number.isFinite(ts)) continue;
    if (now - ts < cutoffMs) continue;
    stuck.push({
      pairKey: key,
      proposalName: bucket.sample.proposed_skill_name,
      matchedAgainst: bucket.sample.matched_skill,
      reason: bucket.sample.reason || null,
      similarity: typeof bucket.sample.similarity === 'number' ? bucket.sample.similarity : null,
      occurrences: bucket.occurrences,
      firstSeen: bucket.firstTs,
      lastSeen: bucket.lastTs,
      daysBlocked: Math.floor((now - ts) / 86400000),
    });
  }
  stuck.sort((a, b) => b.daysBlocked - a.daysBlocked);
  return stuck;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);
  const cutoffMs = args.since * 86400000;
  const events = readJSONL(AUDIT_FILE);

  if (events.length === 0) {
    console.log(JSON.stringify({
      level: 'info',
      msg: 'no audit events found',
      file: AUDIT_FILE,
      dryRun: args.dryRun,
    }));
    return;
  }

  const buckets = pairBuckets(events);
  const stuck = stuckPairs(buckets, cutoffMs);

  if (stuck.length === 0) {
    console.log(JSON.stringify({
      level: 'info',
      msg: 'no proposals blocked longer than --since days',
      since: args.since,
      candidates: 0,
      dryRun: args.dryRun,
    }));
    return;
  }

  // Dedup against same-day history (skipped on --dry-run so test runs stay clean).
  const alreadyAlerted = args.dryRun ? new Set() : loadAlertedKeys(ALERTS_HISTORY);
  const todayKey = dateKey(new Date().toISOString());
  let written = 0;
  let dedupSkipped = 0;
  let writeFailed = false;
  const now = new Date().toISOString();

  for (const s of stuck) {
    const dedupKey = `${s.proposalName}|${s.matchedAgainst}|${todayKey}`;
    if (alreadyAlerted.has(dedupKey)) {
      dedupSkipped += 1;
      continue;
    }
    const record = {
      timestamp: now,
      severity: 'warning',
      source: 'skill_proposal_alert',
      proposalName: s.proposalName,
      matchedAgainst: s.matchedAgainst,
      reason: s.reason,
      similarity: s.similarity,
      occurrences: s.occurrences,
      blockedSince: s.firstSeen,
      lastSeen: s.lastSeen,
      daysBlocked: s.daysBlocked,
      dryRun: args.dryRun,
      suggestedAction: SUGGESTED_ACTION,
    };
    console.log(JSON.stringify(record));
    if (!args.dryRun) {
      const okA = appendJSONL(ALERTS_OUTPUT, record);
      const okB = appendJSONL(ALERTS_HISTORY, record);
      if (okA && okB) written += 1;
      else writeFailed = true;
    } else {
      written += 1;
    }
  }

  console.log(JSON.stringify({
    level: 'summary',
    msg: 'skill_proposal_alert run complete',
    since: args.since,
    candidates: stuck.length,
    written,
    dedup_skipped: dedupSkipped,
    dryRun: args.dryRun,
  }));

  if (writeFailed) process.exit(1);
}

main();
