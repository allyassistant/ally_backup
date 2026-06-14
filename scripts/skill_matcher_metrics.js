#!/usr/bin/env node
/**
 * skill_matcher_metrics.js — Thin executor for daily skill-matcher metrics
 *
 * Reads .skill_matcher_metrics.jsonl, computes stats, outputs a Markdown
 * report to stdout. No LLM dependency — pure data processing.
 *
 * Usage:
 *   node scripts/skill_matcher_metrics.js              # Report to stdout
 *   node scripts/skill_matcher_metrics.js --setup-cron # Print cron create cmd
 */

const fs = require("node:fs");
const path = require("node:path");

// ── Config ──────────────────────────────────────────────────────────────────
const WORKSPACE = path.resolve(__dirname, "..");
const METRICS_FILE = path.join(WORKSPACE, ".skill_matcher_metrics.jsonl");
const CHANNEL_SYSTEM = "1473376125584670872"; // #⚙️系統
const TZ = "Asia/Hong_Kong";

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes("--setup-cron") || args.includes("--cron")) {
  console.log(`# Add this cron job (copy-paste into session):
openclaw cron add --schedule "0 9 * * *" --tz "${TZ}" \\
  --session-target isolated \\
  --payload '{"kind":"agentTurn","message":"node ${path.join(WORKSPACE, "scripts/skill_matcher_metrics.js")}","timeoutSeconds":30}' \\
  --delivery '{"mode":"announce","channel":"${CHANNEL_SYSTEM}"}' \\
  --name "Skill Matcher Daily Metrics"`);
  process.exit(0);
}

// ── Read metrics ────────────────────────────────────────────────────────────
if (!fs.existsSync(METRICS_FILE)) {
  console.log("## 📊 Skill Matcher Metrics\n\n**No metrics data yet** — the plugin hasn't recorded any matches. This is normal for a fresh deploy.\n");
  process.exit(0);
}

let entries = [];
try {
  const raw = fs.readFileSync(METRICS_FILE, "utf8");
  entries = raw.trim().split("\n").filter(Boolean).map(line => {
    try { return JSON.parse(line); }
    catch { return null; }
  }).filter(Boolean);
} catch (err) {
  console.log(`## 📊 Skill Matcher Metrics\n\n⚠️ Error reading metrics file: ${err.message}\n`);
  process.exit(1);
}

if (entries.length === 0) {
  console.log("## 📊 Skill Matcher Metrics\n\n**Metrics file exists but is empty.**\n");
  process.exit(0);
}

// ── Compute stats ───────────────────────────────────────────────────────────
const now = new Date();
const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);

// Filter to last 24h (overlap with potential rotation)
const recent = entries.filter(e => {
  if (!e.ts) return false;
  return new Date(e.ts) >= new Date(now - 86400000);
});

// Use all entries if recent has < 10
const sample = recent.length >= 10 ? recent : entries;

// Counts
const total = sample.length;
const matches = sample.filter(e => e.event === "match");
const noMatches = sample.filter(e => e.event === "no-match");
const skipped = sample.filter(e => e.event === "skipped_pinned");

const matchRate = total > 0 ? (matches.length / total * 100).toFixed(1) : "0.0";

// Top skills
const skillCounts = new Map();
for (const m of matches) {
  const name = m.skill || "(unknown)";
  skillCounts.set(name, (skillCounts.get(name) || 0) + 1);
}
const topSkills = [...skillCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

// Threshold analysis
const rejectedScores = noMatches
  .map(e => e.bestRejected)
  .filter(s => s != null && !isNaN(s));
const avgRejected = rejectedScores.length > 0
  ? rejectedScores.reduce((a, b) => a + b, 0) / rejectedScores.length
  : 0;

// Determine phase from first entry
const phase = entries[0]?.phase || "unknown";
const threshold = 0.15; // default, could read from config

// Tuning suggestion
let suggestion;
const matchPct = parseFloat(matchRate);
if (matchPct < 3) {
  suggestion = `💡 **Consider lowering threshold** (match rate is only ${matchRate}%)`;
} else if (avgRejected > threshold * 0.85) {
  suggestion = `💡 **Consider raising threshold** (avg rejected ${avgRejected.toFixed(3)} is close to threshold ${threshold})`;
} else if (matchPct > 30) {
  suggestion = `💡 **Consider raising threshold** (match rate ${matchRate}% is high — may be too noisy)`;
} else {
  suggestion = "✅ **Threshold looks reasonable** — no changes recommended";
}

// Time range
const sorted = [...sample].sort((a, b) => new Date(a.ts) - new Date(b.ts));
const firstTs = sorted[0]?.ts ? new Date(sorted[0].ts).toLocaleString("zh-HK", { timeZone: TZ }) : "unknown";
const lastTs = sorted[sorted.length - 1]?.ts ? new Date(sorted[sorted.length - 1].ts).toLocaleString("zh-HK", { timeZone: TZ }) : "unknown";

// ── Output ──────────────────────────────────────────────────────────────────
console.log(`## 📊 Skill Matcher Daily Report — ${yesterday}`);
console.log();
console.log(`**Period:** ${firstTs} → ${lastTs}`);
console.log(`**Phase:** \`${phase}\` | **Threshold:** \`${threshold}\` | **Events analyzed:** ${total}`);
console.log();

console.log("### Overview");
console.log();
console.log("| Metric | Value |");
console.log("|--------|-------|");
console.log(`| Total events | ${total} |`);
console.log(`| Matches | ${matches.length} (${matchRate}%) |`);
console.log(`| No-matches | ${noMatches.length} (${total > 0 ? (noMatches.length/total*100).toFixed(1) : "0.0"}%) |`);
console.log(`| Skipped pinned | ${skipped.length} (${total > 0 ? (skipped.length/total*100).toFixed(1) : "0.0"}%) |`);

if (topSkills.length > 0) {
  console.log();
  console.log("### Top Skills");
  console.log();
  for (const [name, count] of topSkills) {
    const bar = "█".repeat(Math.min(count, 30));
    console.log(`${count.toString().padStart(3)} ${bar} \`${name}\``);
  }
}

console.log();
console.log("### Threshold Tuning");
console.log();
console.log(`- Avg rejected score: \`${avgRejected.toFixed(3)}\``);
if (rejectedScores.length > 0) {
  const ratio = (avgRejected / threshold * 100).toFixed(0);
  console.log(`- Rejected avg is ${ratio}% of threshold (${threshold})`);
}
console.log(`- ${suggestion}`);

// Show 3 most recent events for debugging
if (sample.length > 0) {
  const recent3 = [...sample].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 3);
  console.log();
  console.log("### Recent Activity");
  console.log("```");
  for (const e of recent3) {
    const ts = new Date(e.ts).toLocaleString("zh-HK", { timeZone: TZ });
    const skill = e.skill || "(none)";
    const score = e.score != null ? `score=${e.score.toFixed(3)}` : "";
    const evt = e.event || "?";
    console.log(`${ts}  ${evt.padEnd(17)} ${skill.padEnd(25)} ${score}`);
  }
  console.log("```");
}

console.log();
console.log(`_Report generated ${now.toLocaleString("zh-HK", { timeZone: TZ })}_`);
