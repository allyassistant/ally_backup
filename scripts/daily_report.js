#!/usr/bin/env node
/**
 * scripts/daily_report.js — Unified OpenClaw daily report (3 sections, 1 message)
 *
 * Replaces 3 separate daily reports (Phase 1 metrics + skill reviewer + telemetry
 * digest) with ONE consolidated message to #⚙️系統 (channel 1473376125584670872).
 *
 * Sections:
 *   A. 🛣️ Phase 1 Routing   — reads scripts/router/decision_log.jsonl
 *                              writes metrics/YYYY-MM-DD.json
 *   B. 🎯 Skill Pipeline    — reads .skill_created.jsonl + .skill_junk_rate.jsonl
 *                              + .skill_reviewer_pause.json + .skill_reviewer_gates.jsonl
 *   C. 🛡️ Operational Health — audit/repair/queue/self-healing/usage/junk-rate/llm
 *
 * Toggle sections with REPORT_SECTIONS=routing,skill,operational (default all).
 * Even when a section is disabled, its DATA SOURCES (e.g. metrics/JSON file write)
 * still happen — disabling only suppresses that section's markdown output.
 *
 * Usage:
 *   node scripts/daily_report.js              # compute + push
 *   node scripts/daily_report.js --dry-run    # compute + print, no push
 *   node scripts/daily_report.js --no-push    # compute + history, no Discord
 *   node scripts/daily_report.js --quiet      # suppress console
 *   node scripts/daily_report.js --hours 48   # custom window
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ONE_HOUR_MS } = require('./lib/time_constants');

const { WS, STATE_DIR } = require('./lib/config');
const discord = require('./lib/discord_push');
const proposalStore = require('./lib/proposal_store');

// ── CLI parsing ──────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const NO_PUSH = argv.includes('--no-push');
const QUIET = argv.includes('--quiet');
const hoursIdx = argv.indexOf('--hours');
const WINDOW_HOURS = hoursIdx >= 0 ? Math.max(1, parseInt(argv[hoursIdx + 1], 10) || 24) : 24;

const VALID_SECTIONS = new Set(['routing', 'skill', 'operational']);
const _rawSections = process.env.REPORT_SECTIONS;
let REPORT_SECTIONS;
if (!_rawSections) {
  REPORT_SECTIONS = ['routing', 'skill', 'operational'];
} else {
  const tokens = _rawSections.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const valid = tokens.filter(t => VALID_SECTIONS.has(t));
  const invalid = tokens.filter(t => !VALID_SECTIONS.has(t));
  if (invalid.length > 0) {
    if (!QUIET) console.error(`⚠️ REPORT_SECTIONS contains invalid: ${invalid.join(', ')} — falling back to all sections`);
    REPORT_SECTIONS = ['routing', 'skill', 'operational'];
  } else {
    REPORT_SECTIONS = valid;
  }
  if (REPORT_SECTIONS.length === 0) {
    if (!QUIET) console.error('⚠️ REPORT_SECTIONS resolved to empty set — falling back to all sections');
    REPORT_SECTIONS = ['routing', 'skill', 'operational'];
  }
}
const SEC_ROUTING = REPORT_SECTIONS.includes('routing');
const SEC_SKILL = REPORT_SECTIONS.includes('skill');
const SEC_OPS = REPORT_SECTIONS.includes('operational');

// ── Constants ────────────────────────────────────────────────────────────

const DECISION_LOG = path.join(WS, 'scripts', 'router', 'decision_log.jsonl');
const METRICS_DIR = path.join(WS, 'metrics');

const SKILL_CREATED = path.join(WS, '.skill_created.jsonl');
const SKILL_JUNK_RATE = path.join(WS, '.skill_junk_rate.jsonl');
const SKILL_REVIEWER_PAUSE = path.join(WS, '.skill_reviewer_pause.json');
const SKILL_GATES = path.join(WS, '.skill_reviewer_gates.jsonl');
const SKILL_WARNINGS_LOG = path.join(WS, '.skill_reviewer_warnings.jsonl');

const AUDIT_RESULTS = path.join(STATE_DIR, 'audit_orchestrator_results.json');
const REPAIR_RESULTS = path.join(STATE_DIR, 'audit_repair_wire_results.json');
const SKILL_REVIEW_QUEUE = path.join(WS, '.skill_review_queue.jsonl');
const SHL_LOG = path.join(WS, '.self_healing_loop.jsonl');
const SKILL_USAGE = path.join(WS, '.skill_usage_log.jsonl');
const DIGEST_HISTORY = path.join(STATE_DIR, 'daily_telemetry_digest_history.jsonl');

const AUTO_PAUSE_THRESHOLD = 0.30;
const VALIDATOR_CATCH_TARGET = 0.25;

// ── Tiny helpers ─────────────────────────────────────────────────────────

function log(msg) { if (!QUIET) console.log(msg); }
function err(msg) { console.error(msg); }

function safeReadJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { return null; }
}

function readJsonlWindow(p, sinceMs) {
  const out = [];
  if (!fs.existsSync(p)) return out;
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch (_) { return out; }
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch (_) { continue; }
    if (sinceMs && e?.ts) {
      const t = Date.parse(e.ts);
      if (!isNaN(t) && t < sinceMs) continue;
    }
    out.push(e);
  }
  return out;
}

function topClusters(events, n) {
  const counts = {};
  for (const e of events) {
    const name = e.name || (e.file ? e?.file?.split('/').slice(-2, -1)[0] : 'unknown');
    const cluster = (name.split(/[-_]/)[0] || name).toLowerCase();
    counts[cluster] = (counts[cluster] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([k, v]) => ({ name: k, count: v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function todayUtcDate() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ── Section A: Phase 1 Routing ──────────────────────────────────────────
// Mirrors metrics_collector.js load/aggregate/write semantics so the metrics
// file written here stays byte-compatible with the existing format.

function loadRoutingEntries(date) {
  if (!fs.existsSync(DECISION_LOG)) return [];
  let content;
  try { content = fs.readFileSync(DECISION_LOG, 'utf8'); } catch (_) { return []; }
  const start = Date.parse(`${date}T00:00:00.000Z`);
  const end = Date.parse(`${date}T23:59:59.999Z`);
  if (isNaN(start) || isNaN(end)) return [];
  const out = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let e;
    try { e = JSON.parse(t); } catch (_) { continue; }
    if (!e || typeof e !== 'object') continue;
    if (e.actualProvider === undefined || e.actualProvider === null) continue;
    if (typeof e.ts !== 'string') continue;
    const ts = Date.parse(e.ts);
    if (isNaN(ts)) continue;
    if (ts < start || ts > end) continue;
    out.push(e);
  }
  return out;
}

function aggregateRouting(entries) {
  const totals = { decisionCount: entries.length, successCount: 0, failureCount: 0, totalCostUsd: 0, avgLatencyMs: 0 };
  const routeDistribution = {};
  const providerDistribution = {};
  const failureByRoute = {};
  const fallbackByProvider = {};
  let latencySum = 0, latencyCount = 0;
  let fallbackDepthSum = 0, fallbackCount = 0;

  for (const e of entries) {
    const success = e.success === undefined ? true : Boolean(e.success);
    if (success) totals.successCount++; else totals.failureCount++;
    const cost = (typeof e.costEstimate === 'number' && isFinite(e.costEstimate)) ? e.costEstimate : 0;
    totals.totalCostUsd += cost;
    if (typeof e.latencyMs === 'number' && isFinite(e.latencyMs) && e.latencyMs > 0) {
      latencySum += e.latencyMs; latencyCount++;
    }
    const route = (typeof e.route === 'string' ? e.route : 'UNKNOWN').toUpperCase();
    routeDistribution[route] = (routeDistribution[route] || 0) + 1;
    const provider = (typeof e.actualProvider === 'string' && e?.actualProvider?.length > 0) ? e.actualProvider : 'unknown';
    providerDistribution[provider] = (providerDistribution[provider] || 0) + 1;
    const fb = (typeof e.fallbackDepth === 'number' && isFinite(e.fallbackDepth)) ? e.fallbackDepth : 0;
    if (fb > 0) { fallbackDepthSum += fb; fallbackCount++; fallbackByProvider[provider] = (fallbackByProvider[provider] || 0) + 1; }
    if (!success) failureByRoute[route] = (failureByRoute[route] || 0) + 1;
  }
  totals.avgLatencyMs = latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0;
  totals.totalCostUsd = Math.round(totals.totalCostUsd * 10000) / 10000;
  const primaryHitCount = entries.length - fallbackCount;
  const fallbackRate = entries.length > 0 ? Math.round((fallbackCount / entries.length) * 100) / 100 : 0;
  const fallbackDepthAvg = fallbackCount > 0 ? Math.round((fallbackDepthSum / fallbackCount) * 100) / 100 : 0;
  return {
    totals,
    routeDistribution,
    providerDistribution,
    fallbackStats: { primaryHitCount, fallbackCount, fallbackRate, fallbackDepthAvg },
    topFailingRoutes: Object.entries(failureByRoute).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([route, count]) => ({ route, failureCount: count })),
    topFallingBackProviders: Object.entries(fallbackByProvider).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([provider, count]) => ({ provider, fallbackCount: count })),
    hourlyDistribution: (() => {
      const h = {};
      for (let i = 0; i < 24; i++) h[String(i).padStart(2, '0')] = 0;
      for (const e of entries) {
        const ms = Date.parse(e.ts);
        if (!isNaN(ms)) {
          const hh = String(new Date(ms).getUTCHours()).padStart(2, '0');
          h[hh] = (h[hh] || 0) + 1;
        }
      }
      return h;
    })(),
  };
}

function writeMetricsRollup(rollup) {
  try { if (!fs.existsSync(METRICS_DIR)) fs.mkdirSync(METRICS_DIR, { recursive: true }); }
  catch (e) { err(`[ERROR] mkdir metrics dir: ${e.message}`); return null; }
  const outPath = path.join(METRICS_DIR, `${rollup.date}.json`);
  const tmp = `${outPath}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(rollup, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, outPath);
    return outPath;
  } catch (e) {
    err(`[ERROR] write metrics rollup: ${e.message}`);
    try { fs.unlinkSync(tmp); } catch (_) {}
    return null;
  }
}

function buildRouting(date, writeFile) {
  const entries = loadRoutingEntries(date);
  const agg = aggregateRouting(entries);
  const rollup = {
    date,
    period: { start: `${date}T00:00:00.000Z`, end: `${date}T23:59:59.999Z` },
    ...agg,
    schemaVersion: '1.0',
    collectorVersion: '1.0',
  };
  let writtenPath = null;
  if (writeFile) writtenPath = writeMetricsRollup(rollup);
  return { rollup, writtenPath, entries };
}

function formatRoutingSection(r) {
  const t = r?.rollup?.totals, f = r?.rollup?.fallbackStats;
  const successRate = t.decisionCount > 0 ? (t.successCount / t.decisionCount) * 100 : 0;
  const fallbackRate = f.fallbackRate * 100;
  const sortedRoutes = Object.entries(r?.rollup?.routeDistribution).sort((a, b) => b[1] - a[1]);
  const topRoute = sortedRoutes[0];
  const topRouteStr = topRoute ? `${topRoute[0]} (${topRoute[1]})` : 'NONE';
  const sortedProviders = Object.entries(r?.rollup?.providerDistribution).sort((a, b) => b[1] - a[1]);
  const topProvider = sortedProviders[0];
  const topProviderStr = topProvider ? `${topProvider[0]} (${topProvider[1]})` : 'N/A';

  return [
    '**🛣️ 路由統計**',
    `ℹ️ • 總決策次數: ${t.decisionCount} 個`,
    `${successRate >= 100 ? '✅' : '⚠️'} • 成功率: ${successRate.toFixed(1)}%`,
    `${fallbackRate === 0 ? '✅' : '⚠️'} • 降級率: ${fallbackRate.toFixed(1)}%`,
    `ℹ️ • 總成本: $${t?.totalCostUsd?.toFixed(2)}`,
    `ℹ️ • 最常用路由: ${topRouteStr}`,
    `ℹ️ • 最常用模型: ${topProviderStr}`,
  ].join('\n');
}

// ── Section B: Skill Pipeline ────────────────────────────────────────────

function buildSkillSection(windowMs) {
  const events = readJsonlWindow(SKILL_CREATED, Date.now() - windowMs);
  let passed = 0, rejected = 0, symlinked = 0;
  for (const e of events) {
    if (e.validationPassed) passed++;
    else rejected++;
    if (e.symlinked) symlinked++;
  }
  const clusters = topClusters(events, 3);
  const clusterStr = clusters.length
    ? clusters.map(c => `${c.name}(${c.count})`).join(', ')
    : '—';

  // Gate skips (NB-5)
  const gateStats = { stable: 0, cooldown: 0, total: 0 };
  const gateEvents = readJsonlWindow(SKILL_GATES, Date.now() - windowMs);
  for (const e of gateEvents) {
    if (e.event !== 'skill_skipped') continue;
    gateStats.total++;
    if (e.reason === 'stable') gateStats.stable++;
    else if (e.reason === 'cooldown') gateStats.cooldown++;
  }

  // Pause state
  let pauseStr = '關閉';
  const pauseState = safeReadJson(SKILL_REVIEWER_PAUSE);
  if (pauseState) {
    if (Date.now() < pauseState.until) {
      const untilHkt = new Date(pauseState.until).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
      const pct = pauseState.junkRateAtPause != null ? (pauseState.junkRateAtPause * 100).toFixed(2) : '?';
      pauseStr = `啟動中 至 ${untilHkt} (junk rate ${pct}%)`;
    } else {
      pauseStr = '已過期 (rate now below threshold)';
    }
  }

  // Description quality warnings (Sub-3 fix 2026-06-28)
  const warningEvents = readJsonlWindow(SKILL_WARNINGS_LOG, Date.now() - windowMs);
  const warnCount = warningEvents.filter(e => e.verdict === 'warn').length;
  const blockCount = warningEvents.filter(e => e.verdict === 'block').length;
  const descWarnStr = warnCount + blockCount > 0
    ? `⚠️ ${warnCount} warn / ${blockCount} block`
    : '✅ 0';

  return [
    '**🎯 Skill 自動生成**',
    `ℹ️ • 總事件: ${events.length} 個`,
    `ℹ️ • 通過: ${passed} 個`,
    `${rejected === 0 ? '✅' : '⚠️'} • 拒絕: ${rejected} 個`,
    `ℹ️ • 對稱連結: ${symlinked} 個`,
    `ℹ️ • 熱門分類: ${clusterStr}`,
    `ℹ️ • 關卡跳過 (${WINDOW_HOURS}h): ${gateStats.total} 次 (stable ${gateStats.stable} / cooldown ${gateStats.cooldown})`,
    `${pauseStr === '關閉' ? '✅' : '⚠️'} • 暫停狀態: ${pauseStr}`,
    `• 描述品質 (${WINDOW_HOURS}h): ${descWarnStr}`,
  ].join('\n');
}

// ── Section C: Operational Health ────────────────────────────────────────

// NB-6 (Round 4 audit): stale-grace + retry + fallback for junk rate.
// skill_junk_tracker.js cron also fires at 23:55 (same minute as this report).
// If this report runs first, the JSONL tail may be missing/empty/partial.
// Wrapper: (1) waits 5s for tracker to finish, (2) retries 3 times with
// 2s/4s/8s backoff (14s total), (3) falls back to most recent parseable entry.
const JUNK_RATE_STARTUP_GRACE_MS = 5000;
const JUNK_RATE_RETRY_DELAYS_MS = [2000, 4000, 8000];

function readLatestJunkRate() {
  if (!fs.existsSync(SKILL_JUNK_RATE)) return null;
  let raw;
  try { raw = fs.readFileSync(SKILL_JUNK_RATE, 'utf8'); } catch (_) { return null; }
  const lines = raw.split('\n').filter(l => l.trim());
  if (!lines.length) return null;
  try { return JSON.parse(lines[lines.length - 1]); } catch (_) { return null; }
}

function readLatestJunkRateWithRetry(startupGraceMs) {
  const grace = (typeof startupGraceMs === 'number' && startupGraceMs >= 0)
    ? startupGraceMs
    : JUNK_RATE_STARTUP_GRACE_MS;
  if (grace > 0) {
    const end = Date.now() + grace;
    while (Date.now() < end) { /* busy-wait — daily report runs once a day */ }
  }
  let attempt = 0;
  for (attempt = 0; attempt < JUNK_RATE_RETRY_DELAYS_MS.length + 1; attempt++) {
    const entry = readLatestJunkRate();
    if (entry) return { entry, retryCount: attempt, stale: false };
    if (attempt < JUNK_RATE_RETRY_DELAYS_MS.length) {
      const waitMs = JUNK_RATE_RETRY_DELAYS_MS[attempt];
      const end = Date.now() + waitMs;
      while (Date.now() < end) { /* busy-wait */ }
    }
  }
  // All retries exhausted — fall back to most recent parseable entry.
  if (fs.existsSync(SKILL_JUNK_RATE)) {
    try {
      const lines = fs.readFileSync(SKILL_JUNK_RATE, 'utf8')
        .split('\n').filter(l => l.trim());
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
        try {
          return { entry: JSON.parse(lines[i]), retryCount: attempt, stale: true };
        } catch (_) { /* skip corrupted line */ }
      }
    } catch (_) { /* fall through to null */ }
  }
  return { entry: null, retryCount: attempt, stale: true };
}

function buildOpsSection(windowMs) {
  const audit = safeReadJson(AUDIT_RESULTS);
  const repair = safeReadJson(REPAIR_RESULTS);
  const proposals = proposalStore.load();

  // Audit tier breakdown (same logic as daily_telemetry_digest.js)
  const issues = audit?.results?.merged || [];
  const byTier = { critical: 0, production: 0, utility: 0, debug: 0, other: 0 };
  for (const i of issues) {
    const f = (i.file || '').toLowerCase();
    if (f.includes('/archive/') || f.match(/^scripts\/(cron_|auto_|daily_|session_|.*_runner|.*_monitor|.*_triage)/)) byTier.production++;
    else if (f.includes('/lib/') || f.includes('_lib/')) byTier.utility++;
    else if (f.match(/\.(test|demo)\.js$/)) byTier.debug++;
    else byTier.utility++;
  }
  const auditTierParts = Object.entries(byTier).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ') || '0';

  const autoFixesOk = repair?.summary?.autoFixOk || 0;
  const pending = Array.isArray(proposals?.proposals) ? proposals.proposals.filter(p => p.status === 'pending').length : 0;

  // Queue
  const queueEntries = readJsonlWindow(SKILL_REVIEW_QUEUE, Date.now() - windowMs);
  const sorted = queueEntries.filter(e => e.ts).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const oldest = sorted[0];
  const oldestAgeHours = oldest?.ts ? ((Date.now() - new Date(oldest.ts).getTime()) / ONE_HOUR_MS).toFixed(1) : 'N/A';

  // Self-Healing
  const shlEvents = readJsonlWindow(SHL_LOG, Date.now() - windowMs);
  const fixesApplied = shlEvents.filter(e => e.event === 'fixes_applied').length;
  const verifyFail = shlEvents.filter(e => e.event === 'verify_fail').length;
  const ruleApplied = shlEvents.filter(e => e.event === 'rule_applied').length;
  const advisorySkips = shlEvents.filter(e => e.event === 'advisory_skip').length;
  const fixesNoProgress = shlEvents.filter(e => e.event === 'fixes_no_progress').length;
  const auditJustWritten = shlEvents.filter(e => /^audit_just_written_/.test(e.event || '')).length;

  // Skill usage
  const usageEvents = readJsonlWindow(SKILL_USAGE, Date.now() - windowMs);
  const used = usageEvents.filter(e => e.event === 'used').length;
  const skipped = usageEvents.filter(e => e.event === 'skipped' || e.event === 'inferred_skipped').length;

  // Junk rate / validator catch (latest entry) — NB-6: retry + fallback
  const junkResult = readLatestJunkRateWithRetry();
  const lastJunk = junkResult.entry || {};
  const junkRate = typeof lastJunk.junkInProductionRate === 'number' ? lastJunk.junkInProductionRate / 100 : null;
  const catchRate = typeof lastJunk.validatorCatchRate === 'number' ? lastJunk.validatorCatchRate / 100 : null;
  const junkFlag = junkRate == null ? '⚠️' : (junkRate < AUTO_PAUSE_THRESHOLD ? '✅' : '⚠️');
  const catchFlag = catchRate == null ? '⚠️' : (catchRate >= VALIDATOR_CATCH_TARGET ? '✅' : '⚠️');

  const llmOverrideActive = lastJunk.llmOverrideActive || false;
  const llmApprovedCount = lastJunk.llmApprovedCount || 0;

  return [
    '**🛡️ 系統健康**',
    `${issues.length === 0 ? '✅' : '⚠️'} • 審計問題: ${issues.length} 個 (${auditTierParts})`,
    `${autoFixesOk > 0 ? 'ℹ️' : '⚠️'} • 自動修復成功: ${autoFixesOk} 個`,
    `${pending === 0 ? '✅' : 'ℹ️'} • 待處理提議: ${pending} 個`,
    `${queueEntries.length === 0 ? '✅' : '⚠️'} • 審核隊列: ${queueEntries.length} 個項目 (最舊 ${oldestAgeHours} 小時)`,
    `ℹ️ • 自我修復: ${fixesApplied} 修復 / ${advisorySkips} 檢測(advisory) / ${verifyFail} 驗證失敗 / ${ruleApplied} 規則應用`,
    `ℹ️ • 技能使用: ${used} 用咗 / ${skipped} 跳過`,
    `• 生產垃圾率: ${junkRate == null ? 'N/A' : (junkRate * 100).toFixed(2) + '%'} ${junkFlag} (目標 <10%)`,
    `• 校驗捕獲率: ${catchRate == null ? 'N/A' : (catchRate * 100).toFixed(2) + '%'} ${catchFlag} (目標 ≥25%)`,
    llmOverrideActive ? `ℹ️ • LLM 覆寫: ${llmApprovedCount} 個 skill 已 approved` : null,
    junkResult.stale ? `⚠️ • 垃圾率過期 (tracker missing, retries=${junkResult.retryCount})` : null,
  ].filter(Boolean).join('\n');
}

// ── Assemble + push ─────────────────────────────────────────────────────

function buildMessage() {
  const date = todayUtcDate();
  // Always compute routing data + write file (independent of section toggle).
  const routing = buildRouting(date, true);
  const windowMs = WINDOW_HOURS * ONE_HOUR_MS;

  const sections = [];
  if (SEC_ROUTING) sections.push(formatRoutingSection(routing));
  if (SEC_SKILL) sections.push(buildSkillSection(windowMs));
  if (SEC_OPS) sections.push(buildOpsSection(windowMs));

  const header = `📊 **OpenClaw 每日報告** — ${date}（過去 ${WINDOW_HOURS} 小時）`;
  const footer = `—\n由 \`scripts/daily_report.js\` 自動生成 · Cron \`55 23 * * *\``;

  const message = [header, '', sections.join('\n\n'), '', footer].join('\n');

  return {
    message,
    routing,
    sectionFlags: { routing: SEC_ROUTING, skill: SEC_SKILL, operational: SEC_OPS },
  };
}

function appendHistory(entry) {
  try {
    fs.appendFileSync(DIGEST_HISTORY, JSON.stringify(entry) + '\n', 'utf8');
    return true;
  } catch (e) {
    err(`⚠️  無法寫入 digest 歷史: ${e.message}`);
    return false;
  }
}

function main() {
  log(`📊 daily_report.js — 整理過去 ${WINDOW_HOURS} 小時嘅摘要 (sections: ${REPORT_SECTIONS.join(',')})`);

  const { message, routing, sectionFlags } = buildMessage();

  log(`   訊息大小: ${message.length} chars · sections: routing=${sectionFlags.routing} skill=${sectionFlags.skill} operational=${sectionFlags.operational}`);
  if (routing.writtenPath) log(`   metrics rollup: ${routing.writtenPath}`);
  else log(`   metrics rollup: NOT WRITTEN (routing disabled or no data — should not happen since data is always computed)`);

  // Always compute routing metrics file — independent of section toggle.
  // buildRouting(true) was called above; writtenPath is set.

  // Append history (matches daily_telemetry_digest_history.jsonl shape)
  const historyEntry = {
    ts: new Date().toISOString(),
    windowHours: WINDOW_HOURS,
    digest: {
      routing: routing.rollup,
      sectionFlags,
    },
    message,
    bytes: message.length,
  };
  appendHistory(historyEntry);

  if (DRY_RUN) {
    log('(dry-run mode: would push to Discord)');
    log('---');
    log(message);
    log('---');
    return { ok: true, skipped: true, dryRun: true };
  }
  if (NO_PUSH) {
    log('(no-push mode: skipping Discord)');
    return { ok: true, skipped: true };
  }
  const result = discord.pushSystemChannel(message);
  if (result.ok) log('✅ pushed to Discord');
  else err('❌ Discord push failed: ' + (result.error || 'unknown'));
  return result;
}

if (require.main === module) {
  const result = main();
  // Exit 0 on success or skip (dry-run/no-push), 1 on push failure.
  process.exit(result?.ok ? 0 : 1);
}

module.exports = { buildMessage, buildRouting, buildSkillSection, buildOpsSection };
