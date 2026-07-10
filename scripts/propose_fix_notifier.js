#!/usr/bin/env node
/**
 * propose_fix_notifier.js — Production fix approval flow (Tier 2 / E v0)
 *
 * Scans .state/repair_proposals.json for high-severity pending proposals,
 * pushes them to Discord #⚙️系統 for review. Each notification includes
 * proposal ID, file, line, rule, severity — copyable for use with the
 * `proposal_action.js` CLI.
 *
 * Tier 2 / E v0 (2026-06-20): notification only, no auto-apply.
 * Tier 2 / E v1 (future): Discord reaction handler, 1-click approve.
 *
 * Schedule: cron 15 5 * * * (after audit_repair_proposer @ 04:45, after
 *                            audit_to_skill_emitter @ 05:00)
 *
 * Usage:
 *   node scripts/propose_fix_notifier.js                  # default: notify high-sev
 *   node scripts/propose_fix_notifier.js --severity critical  # only critical
 *   node scripts/propose_fix_notifier.js --limit 10           # max 10 per run
 *   node scripts/propose_fix_notifier.js --dry-run           # preview, no push
 *   node scripts/propose_fix_notifier.js --quiet             # no console output
 *   node scripts/propose_fix_notifier.js --include-archive   # also include archive/ files
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { WS, STATE_DIR } = require('./lib/config');
const cumulativeApprovals = require('./lib/cumulative_approvals');
const proposalStore = require('./lib/proposal_store');
const discord = require('./lib/discord_push');

const PROPOSALS_FILE = proposalStore.PROPOSALS_FILE; // for log output only
const NOTIFIED_LOG = path.join(STATE_DIR, 'proposal_notifications.jsonl');
// (SYSTEM_CHANNEL now in lib/discord_push.js)

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const QUIET = args.includes('--quiet');
const sevIdx = args.indexOf('--severity');
const SEVERITY_FILTER = sevIdx >= 0 ? args[sevIdx + 1] : 'high'; // high|critical|medium|all
const limIdx = args.indexOf('--limit');
const LIMIT = limIdx >= 0 ? parseInt(args[limIdx + 1], 10) || 10 : 10;
const INCLUDE_ARCHIVE = args.includes('--include-archive');

function log(msg) { if (!QUIET) console.log(msg); }
function err(msg) { console.error(msg); }

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

// Delegates to lib/proposal_store.js
function loadProposals() { return proposalStore.load(); }

function loadNotifiedIds() {
  if (!fs.existsSync(NOTIFIED_LOG)) return new Set();
  const ids = new Set();
  try {
    for (const line of fs.readFileSync(NOTIFIED_LOG, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        if (e.proposalId) ids.add(e.proposalId);
      } catch (_) {}
    }
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }
  return ids;
}

function recordNotified(proposalId, pushOk) {
  const entry = {
    ts: new Date().toISOString(),
    proposalId,
    pushOk,
  };
  try {
    fs.appendFileSync(NOTIFIED_LOG, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {}
}

function isArchiveFile(p) {
  return p && (p.includes('/archive/') || p.includes('archive/'));
}

function formatProposalMessage(proposal) {
  const lines = [];
  lines.push(`🔧 **待修復（生產環境）** — \`${proposal.id}\``);
  lines.push('');
  lines.push(`• **檔案:** \`${proposal.file}\`${proposal.line ? ':' + proposal.line : ''}`);
  lines.push(`• **規則:** \`${proposal.rule}\``);
  lines.push(`• **嚴重程度:** ${proposal.severity || 'unknown'}`);
  lines.push(`• **層級:** ${proposal.tier || 'unknown'}`);
  if (proposal.message) lines.push(`• **問題:** ${proposal?.message?.slice(0, 200)}`);
  if (proposal.reason) lines.push(`• **原因:** ${proposal.reason}`);
  lines.push('');
  lines.push('**要 approve:**');
  lines.push('```');
  lines.push(`node scripts/proposal_action.js approve ${proposal.id}`);
  lines.push('```');
  lines.push('**要 reject:**');
  lines.push('```');
  lines.push(`node scripts/proposal_action.js reject ${proposal.id}`);
  lines.push('```');
  return lines.join('\n');
}

function pushToDiscord(message) {
  if (DRY_RUN) {
    log('[DRY-RUN] would push to Discord:');
    log('---');
    log(message);
    log('---');
    return true;
  }
  const result = discord.pushSystemChannel(message);
  if (!result.ok) err('Discord push failed: ' + (result.error || 'unknown'));
  return result.ok;
}

function main() {
  log(`📣 propose_fix_notifier.js — Tier 2 E v0`);
  log(`   嚴重程度過濾: ${SEVERITY_FILTER} · 上限: ${LIMIT} · archive: ${INCLUDE_ARCHIVE}`);

  const data = loadProposals();
  if (!data) {
    err('❌ 讀唔到 repair_proposals.json');
    process.exit(1);
  }
  const all = (data.proposals || []).filter(p => p.status === 'pending');
  log(`   待處理提議: ${all.length}`);

  // Filter by severity
  let filtered = all;
  if (SEVERITY_FILTER !== 'all') {
    const minRank = SEVERITY_RANK[SEVERITY_FILTER] || 3;
    const beforeSev = filtered.length;
    filtered = filtered.filter(p => (SEVERITY_RANK[p.severity] || 0) >= minRank);
    log(`   過濾 severity >= ${SEVERITY_FILTER}: ${filtered.length} (攔咗 ${beforeSev - filtered.length})`);
  }
  if (!INCLUDE_ARCHIVE) {
    const beforeArch = filtered.length;
    filtered = filtered.filter(p => !isArchiveFile(p.file));
    if (beforeArch !== filtered.length) {
      log(`   過濾 archive/: ${filtered.length} (攔咗 ${beforeArch - filtered.length})`);
    }
  }
  // Filter out rules that are trusted via cumulative approval (auto-applied already)
  {
    const beforeTrust = filtered.length;
    filtered = filtered.filter(p => {
      if (!p.rule) return true;
      return !cumulativeApprovals.isTrusted(p.rule);
    });
    if (beforeTrust !== filtered.length) {
      log(`   過濾已 trust (cumulative approval): ${filtered.length} (攔咗 ${beforeTrust - filtered.length})`);
    }
  }

  // Filter already-notified
  const alreadyNotified = loadNotifiedIds();
  const candidates = filtered.filter(p => !alreadyNotified.has(p.id));
  log(`   未通知過嘅: ${candidates.length}`);

  if (candidates.length === 0) {
    if (filtered.length === 0 && all.length > 0) {
      log(`   (冇新提議要通知 — 全部 ${all.length} 個 pending 都喺過濾器排除咗，severity filter 係最常見原因)`);
    } else {
      log('   (冇新提議要通知)');
    }
    process.exit(0);
  }

  // Sort by severity (highest first) then by date
  candidates.sort((a, b) => {
    const sd = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
    if (sd !== 0) return sd;
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  });

  // Limit
  const toNotify = candidates.slice(0, LIMIT);
  log(`   準備推送: ${toNotify.length}`);

  let pushed = 0, failed = 0;
  for (const proposal of toNotify) {
    const message = formatProposalMessage(proposal);
    const ok = pushToDiscord(message);
    recordNotified(proposal.id, ok);
    if (ok) pushed++;
    else failed++;
  }

  log(`\n✅ 成功 ${pushed}, 失敗 ${failed}, 跳過 ${candidates.length - toNotify.length}`);
  if (candidates.length - toNotify.length > 0) {
    log(`   (仲有 pending — 加 --limit)`);
  }
  process.exit(0);
}

main();
