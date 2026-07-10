#!/usr/bin/env node
/**
 * daily_telemetry_digest.js — Daily OpenClaw pipeline health summary
 *
 * Reads last 24h of audit/repair/skill/self-healing telemetry, formats as
 * Discord markdown, and pushes to #⚙️系統 (channel 1473376125584670872).
 *
 * Schedule: cron 58 23 * * * (after junk rate @ 23:55, before Daily Summary @ 23:59)
 *
 * Usage:
 *   node scripts/daily_telemetry_digest.js                  # compute + push
 *   node scripts/daily_telemetry_digest.js --dry-run        # compute + print, no push
 *   node scripts/daily_telemetry_digest.js --hours 48       # custom window
 *   node scripts/daily_telemetry_digest.js --quiet          # no console output
 *   node scripts/daily_telemetry_digest.js --no-push        # compute + save, no Discord
 *
 * Pipeline inputs:
 *   - .state/audit_orchestrator_results.json   (today's audit)
 *   - .state/audit_repair_wire_results.json    (today's repair)
 *   - .state/repair_proposals.json             (pending proposals)
 *   - .skill_review_queue.jsonl                (v=2 / v=3 entries)
 *   - .skill_junk_rate.jsonl                   (junk rate history)
 *   - .self_healing_loop.jsonl                 (self-healing events)
 *   - .skill_usage_log.jsonl                   (skill usage events)
 *
 * Phase: Tier 1 A (2026-06-20)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { WS, STATE_DIR } = require('./lib/config');
const discord = require('./lib/discord_push');
const proposalStore = require('./lib/proposal_store');

// CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const QUIET = args.includes('--quiet');
const NO_PUSH = args.includes('--no-push');
const hoursIdx = args.indexOf('--hours');
const WINDOW_HOURS = hoursIdx >= 0 ? parseInt(args[hoursIdx + 1], 10) || 24 : 24;

// Data sources
const AUDIT_RESULTS = path.join(STATE_DIR, 'audit_orchestrator_results.json');
const REPAIR_RESULTS = path.join(STATE_DIR, 'audit_repair_wire_results.json');
const REPAIR_PROPOSALS = proposalStore.PROPOSALS_FILE; // for log output only
const SKILL_REVIEW_QUEUE = path.join(WS, '.skill_review_queue.jsonl');
const SKILL_JUNK_RATE = path.join(WS, '.skill_junk_rate.jsonl');
const SHL_LOG = path.join(WS, '.self_healing_loop.jsonl');
const SKILL_USAGE = path.join(WS, '.skill_usage_log.jsonl');
const DIGEST_HISTORY = path.join(STATE_DIR, 'daily_telemetry_digest_history.jsonl');

const TARGET = discord.getSystemChannel();

function log(msg) { if (!QUIET) console.log(msg); }
function err(msg) { console.error(msg); }

function safeReadJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { return null; }
}

function readJsonlLines(p, sinceMs) {
  if (!fs.existsSync(p)) return [];
  const cutoff = sinceMs || 0;
  const lines = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (cutoff && e.ts && new Date(e.ts).getTime() < cutoff) continue;
      lines.push(e);
    } catch (_) {}
  }
  return lines;
}

function fmtPct(x) { return x == null ? 'N/A' : x.toFixed(2) + '%'; }
function fmtNum(x) { return x == null ? '0' : String(x); }
function pad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
function icon(pass) { return pass ? '✅' : pass === false ? '❌' : '⚠️'; }

// ── Section 1: Audit & Repair ─────────────────────────────────────────────
function buildAuditRepair(windowMs) {
  const audit = safeReadJson(AUDIT_RESULTS);
  const repair = safeReadJson(REPAIR_RESULTS);
  const proposals = proposalStore.load();

  const issues = (audit?.results?.merged) || [];
  const byTier = { critical: 0, production: 0, utility: 0, debug: 0, other: 0 };
  for (const i of issues) {
    const f = (i.file || '').toLowerCase();
    if (f.includes('/archive/') || f.match(/^scripts\/(cron_|auto_|daily_|session_|.*_runner|.*_monitor|.*_triage)/)) {
      byTier.production++;
    } else if (f.includes('/lib/') || f.includes('_lib/')) {
      byTier.utility++;
    } else if (f.match(/\.(test|demo)\.js$/)) {
      byTier.debug++;
    } else {
      byTier.utility++;
    }
  }

  const autoFixesOk = repair?.summary?.autoFixOk || 0;
  const proposalsAdded = repair?.summary?.propose || 0;
  const crossScript = repair?.summary?.crossScriptProposals || 0;
  const pending = Array.isArray(proposals?.proposals) ? proposals.proposals.filter(p => p.status === 'pending').length : 0;

  return {
    issues: issues.length,
    byTier,
    autoFixesOk,
    proposalsAdded,
    crossScript,
    pending,
  };
}

// ── Section 2: Skill Pipeline Health ──────────────────────────────────────
function buildSkillHealth() {
  const entries = readJsonlLines(SKILL_JUNK_RATE, 0);
  // Last entry is the most recent
  const last = entries[entries.length - 1] || {};
  const junkInProduction = last.junkInProductionRate;
  const validatorCatch = last.validatorCatchRate;
  const passedAndQ = (last.passedAndQuarantined || []).length;
  const llmApprovedCount = last.llmApprovedCount || 0;
  const llmOverrideActive = last.llmOverrideActive || false;

  return {
    junkInProduction,
    junkInProductionPass: junkInProduction == null ? null : junkInProduction < 10,
    validatorCatch,
    validatorCatchPass: validatorCatch == null ? null : validatorCatch >= 25,
    passedAndQ,
    llmOverrideActive,
    llmApprovedCount,
  };
}

// ── Section 3: Skill Queue ────────────────────────────────────────────────
function buildQueue(windowMs) {
  const since = Date.now() - windowMs;
  const lines = readJsonlLines(SKILL_REVIEW_QUEUE, since);
  const total = lines.length;
  const v2 = lines.filter(e => e.v === 2).length;
  const v3 = lines.filter(e => e.v === 3).length;
  // Oldest
  const sorted = lines.filter(e => e.ts).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const oldest = sorted[0];
  const oldestAgeHours = oldest?.ts ? ((Date.now() - new Date(oldest.ts).getTime()) / 3600000).toFixed(1) : 'N/A';

  return { total, v2, v3, oldestAgeHours };
}

// ── Section 4: Self-Healing (24h) ──────────────────────────────────────────
function buildSelfHealing(windowMs) {
  const events = readJsonlLines(SHL_LOG, Date.now() - windowMs);
  const fixesApplied = events.filter(e => e.event === 'fixes_applied');
  const verifyFail = events.filter(e => e.event === 'verify_fail');
  const enqueue = events.filter(e => e.event === 'enqueue');
  // Round 5 fix: surface Alt A deterministic LOW_RISK_RULES events
  // (added 2026-06 — previously invisible to the digest).
  const ruleApplied = events.filter(e => e.event === 'rule_applied');
  const fixesNoProgress = events.filter(e => e.event === 'fixes_no_progress');
  const auditJustWritten = events.filter(e => /^audit_just_written_/.test(e.event));
  const skillFixBlocked = events.filter(e => e.event === 'skill_fix_blocked');
  const filesTouched = new Set(fixesApplied.map(e => e.file));
  // Avg duration if available
  const durations = fixesApplied.filter(e => e.durationMs).map(e => e.durationMs);
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  return {
    fixesApplied: fixesApplied.length,
    verifyFail: verifyFail.length,
    enqueue: enqueue.length,
    ruleApplied: ruleApplied.length,
    fixesNoProgress: fixesNoProgress.length,
    auditJustWritten: auditJustWritten.length,
    skillFixBlocked: skillFixBlocked.length,
    filesTouched: filesTouched.size,
    avgDurationMs: avgDuration,
  };
}

// ── Section 5: Skill Usage (24h) ──────────────────────────────────────────
function buildSkillUsage(windowMs) {
  const events = readJsonlLines(SKILL_USAGE, Date.now() - windowMs);
  const used = events.filter(e => e.event === 'used');
  const skipped = events.filter(e => e.event === 'skipped' || e.event === 'inferred_skipped');
  const rejected = events.filter(e => e.event === 'rejected');

  // Top by skill
  const usedBySkill = {};
  for (const e of used) usedBySkill[e.skill] = (usedBySkill[e.skill] || 0) + 1;
  const skippedBySkill = {};
  for (const e of skipped) skippedBySkill[e.skill] = (skippedBySkill[e.skill] || 0) + 1;
  const topUsed = Object.entries(usedBySkill).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const topSkipped = Object.entries(skippedBySkill).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return {
    usedCount: used.length,
    skippedCount: skipped.length,
    rejectedCount: rejected.length,
    topUsed,
    topSkipped,
  };
}

// ── Format digest ─────────────────────────────────────────────────────────
function formatDigest(d, windowHours) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`📊 **OpenClaw 每日 Telemetry** — ${date}（過去 ${windowHours} 小時）`);
  lines.push('');

  // Section 1: Audit & Repair
  lines.push('**🛡️ 審計與修復**');
  lines.push(`• 發現 Issues: ${d?.audit?.issues}（production: ${d?.audit?.byTier?.production}, utility: ${d?.audit?.byTier?.utility}）`);
  lines.push(`• 自動修復成功: ${d?.audit?.autoFixesOk}`);
  lines.push(`• 新提議: ${d?.audit?.proposalsAdded}（${d?.audit?.pending} 待處理）`);
  if (d?.audit?.crossScript > 0) lines.push(`• 🌐 跨 script 後續: ${d?.audit?.crossScript}`);
  lines.push('');

  // Section 2: Skill Pipeline
  lines.push('**🎯 Skill 流程健康**');
  const jip = d?.skill?.junkInProduction;
  lines.push(`• Junk-in-Production: ${fmtPct(jip)} ${icon(d?.skill?.junkInProductionPass)}（目標 <10%）`);
  const vc = d?.skill?.validatorCatch;
  lines.push(`• Validator Catch: ${fmtPct(vc)} ${icon(d?.skill?.validatorCatchPass)}（目標 ≥25%）`);
  lines.push(`• passedAndQuarantined: ${d?.skill?.passedAndQ}`);
  if (d?.skill?.llmOverrideActive) {
    lines.push(`• LLM 覆寫: ${icon(true)} ${d?.skill?.llmApprovedCount} 個 skill 已 approved`);
  }
  lines.push('');

  // Section 3: Skill Queue
  lines.push('**📨 Skill 審核 Queue**');
  lines.push(`• 待處理: ${d?.queue?.total}（v2: ${d?.queue?.v2}, v3: ${d?.queue?.v3}）`);
  lines.push(`• 最舊 entry: ${d?.queue?.oldestAgeHours} 小時前`);
  lines.push('');

  // Section 4: Self-Healing
  lines.push('**🔄 Self-Healing 循環**');
  lines.push(`• 修復次數: ${d?.shl?.fixesApplied}（${d?.shl?.filesTouched} 個檔案）`);
  lines.push(`• Verify 失敗: ${d?.shl?.verifyFail}`);
  lines.push(`• 平均修復時間: ${d?.shl?.avgDurationMs}ms`);
  lines.push(`• Rule 應用: ${d?.shl?.ruleApplied} · No-progress: ${d?.shl?.fixesNoProgress}`);
  lines.push(`• Audit Just-Written: ${d?.shl?.auditJustWritten} · Skill Fix Blocked: ${d?.shl?.skillFixBlocked}`);
  lines.push('');

  // Section 5: Skill Usage
  lines.push('**📚 Skill 使用情況**');
  lines.push(`• 用咗: ${d?.usage?.usedCount} · 跳過: ${d?.usage?.skippedCount} · 拒絕: ${d?.usage?.rejectedCount}`);
  if (d?.usage?.topUsed?.length > 0) {
    lines.push(`• 最常使用: ${d?.usage?.topUsed?.map(([s, n]) => `${s} (${n})`).join(', ')}`);
  }
  if (d?.usage?.topSkipped?.length > 0) {
    lines.push(`• 最常跳過: ${d?.usage?.topSkipped?.map(([s, n]) => `${s} (${n})`).join(', ')}`);
  }
  lines.push('');

  // Footer
  lines.push('—');
  lines.push(`由 \`scripts/daily_telemetry_digest.js\` 自動生成 · Cron \`58 23 * * *\``);

  return lines.join('\n');
}

// ── Push to Discord ──────────────────────────────────────────────────────
// Now uses shared lib/discord_push.js — pushToSystemChannel() is a thin wrapper
function pushToDiscord(message) {
  if (NO_PUSH) {
    log('(no-push mode: skipping Discord)');
    return { ok: true, skipped: true };
  }
  if (DRY_RUN) {
    log('(dry-run mode: would push to Discord)');
    log('---');
    log(message);
    log('---');
    return { ok: true, skipped: true };
  }
  const result = discord.pushSystemChannel(message);
  if (result.ok) log('✅ pushed to Discord');
  else err('❌ Discord push failed: ' + (result.error || 'unknown'));
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────
function main() {
  const windowMs = WINDOW_HOURS * 3600000;
  log(`📊 daily_telemetry_digest.js — 整理過去 ${WINDOW_HOURS} 小時嘅摘要`);

  const d = {
    audit: buildAuditRepair(windowMs),
    skill: buildSkillHealth(),
    queue: buildQueue(windowMs),
    shl: buildSelfHealing(windowMs),
    usage: buildSkillUsage(windowMs),
  };

  const message = formatDigest(d, WINDOW_HOURS);

  // Save digest to history
  try {
    const entry = {
      ts: new Date().toISOString(),
      windowHours: WINDOW_HOURS,
      digest: d,
      message,
      bytes: message.length,
    };
    fs.appendFileSync(DIGEST_HISTORY, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    err('⚠️  無法寫入 digest 歷史: ' + e.message);
  }

  log(`   訊息大小: ${message.length} chars`);

  const pushResult = pushToDiscord(message);

  if (pushResult.ok && !DRY_RUN && !NO_PUSH) {
    log(`✅ digest 完成 · ${d?.audit?.issues} issues, ${d?.shl?.fixesApplied} 修復, ${d?.queue?.total} queue, ${d?.usage?.usedCount} skill 使用`);
  }
  process.exit(pushResult.ok ? 0 : 1);
}

main();
