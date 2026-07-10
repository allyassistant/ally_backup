#!/usr/bin/env node
/**
 * proposal_action.js — Manual approve/reject for repair proposals
 *
 * Tier 2 / E v0 (2026-06-20): manual CLI to approve or reject pending
 * production-tier repair proposals. Tier 1 v1 will add Discord reaction
 * handler for 1-click.
 *
 * Usage:
 *   node scripts/proposal_action.js approve <id>     # mark approved
 *   node scripts/proposal_action.js reject <id>      # mark rejected
 *   node scripts/proposal_action.js list              # show all pending
 *   node scripts/proposal_action.js list --tier production --severity high
 *   node scripts/proposal_action.js show <id>         # show one
 *   node scripts/proposal_action.js apply <id>        # mark approved + apply fix
 *
 * Status transitions:
 *   pending → approved (or rejected)
 *   approved → applied (apply invokes audit_repair_proposer.applyFix; v1 ships)
 *
 * Output: .state/repair_proposals.json updated in place.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { WS, STATE_DIR } = require('./lib/config');
const cumulativeApprovals = require('./lib/cumulative_approvals');
const proposalStore = require('./lib/proposal_store');
const auditRepair = require('./audit_repair_proposer');

const PROPOSALS_FILE = proposalStore.PROPOSALS_FILE;
const ACTIONS_LOG = path.join(STATE_DIR, 'proposal_actions.jsonl');

const args = process.argv.slice(2);
const QUIET = args.includes('--quiet');

function log(msg) { if (!QUIET) console.log(msg); }
function err(msg) { console.error(msg); }

function loadProposals() { return proposalStore.load(); }
function saveProposals(data) { proposalStore.save(data); }
function findProposal(data, id) { return proposalStore.findById(data, id); }

function recordAction(proposalId, action, status) {
  const entry = {
    ts: new Date().toISOString(),
    proposalId,
    action,
    newStatus: status,
  };
  try {
    fs.appendFileSync(ACTIONS_LOG, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {}
}

function cmdApprove(id) {
  const data = loadProposals();
  if (!data) { err('❌ cannot load repair_proposals.json'); process.exit(1); }
  const proposal = findProposal(data, id);
  if (!proposal) { err(`❌ proposal not found: ${id}`); process.exit(2); }
  if (proposal.status === 'approved') { log(`⚠️  already approved: ${id}`); return; }
  if (proposal.status === 'rejected') { err(`❌ already rejected: ${id}`); process.exit(3); }
  if (proposal.status === 'applied') { err(`❌ already applied: ${id}`); process.exit(3); }
  proposal.status = 'approved';
  proposal.approvedAt = new Date().toISOString();
  saveProposals(data);
  recordAction(id, 'approve', 'approved');

  // Cumulative approval: track this manual approval, may unlock auto-apply
  let cumulativeInfo = null;
  if (proposal.rule) {
    try {
      cumulativeInfo = cumulativeApprovals.recordApproval({
        ruleId: proposal.rule,
        file: proposal.file || '?',
        proposalId: id,
      });
    } catch (e) {
      err(`⚠️  could not record cumulative approval: ${e.message}`);
    }
  }

  log(`✅ approved: ${id}`);
  log(`   file: ${proposal.file}:${proposal.line}`);
  log(`   rule: ${proposal.rule}`);
  if (cumulativeInfo) {
    log('');
    log(`   📊 cumulative approval: ${cumulativeInfo.count} ${cumulativeInfo.count === 1 ? 'approval' : 'approvals'} for rule "${proposal.rule}"`);
    if (cumulativeInfo.trusted) {
      log(`   🚀 TRUSTED — future proposals of this rule will be AUTO-APPLIED`);
    } else {
      const summary = cumulativeApprovals.getSummary();
      const need = summary.threshold - cumulativeInfo.count;
      log(`   ⏳ ${need} more approval(s) needed to unlock auto-apply (current threshold: ${summary.threshold})`);
    }
  }
}

function cmdReject(id, reason) {
  const data = loadProposals();
  if (!data) { err('❌ cannot load repair_proposals.json'); process.exit(1); }
  const proposal = findProposal(data, id);
  if (!proposal) { err(`❌ proposal not found: ${id}`); process.exit(2); }
  if (proposal.status === 'rejected') { log(`⚠️  already rejected: ${id}`); return; }
  if (proposal.status === 'applied') { err(`❌ already applied: ${id}`); process.exit(3); }
  proposal.status = 'rejected';
  proposal.rejectedAt = new Date().toISOString();
  if (reason) proposal.rejectionReason = reason.slice(0, 200);
  saveProposals(data);
  recordAction(id, 'reject', 'rejected');
  log(`❌ rejected: ${id}`);
  if (reason) log(`   reason: ${reason}`);
}

function cmdShow(id) {
  const data = loadProposals();
  if (!data) { err('❌ cannot load repair_proposals.json'); process.exit(1); }
  const proposal = findProposal(data, id);
  if (!proposal) { err(`❌ proposal not found: ${id}`); process.exit(2); }
  console.log(JSON.stringify(proposal, null, 2));
}

function cmdList(args) {
  const data = loadProposals();
  if (!data) { err('❌ cannot load repair_proposals.json'); process.exit(1); }
  const all = (data.proposals || []);
  let filtered = all.filter(p => p.status === 'pending');

  const tierIdx = args.indexOf('--tier');
  if (tierIdx >= 0) filtered = filtered.filter(p => p.tier === args[tierIdx + 1]);
  const sevIdx = args.indexOf('--severity');
  if (sevIdx >= 0) filtered = filtered.filter(p => p.severity === args[sevIdx + 1]);
  const allFlag = args.includes('--all');
  if (allFlag) filtered = all;

  if (filtered.length === 0) {
    log('(no proposals match filter)');
    return;
  }

  log(`📋 ${filtered.length} proposal(s):\n`);
  log('ID                                    | Status    | Severity | Tier       | File:Line');
  log('──────────────────────────────────────┼───────────┼──────────┼────────────┼────────────');
  for (const p of filtered.slice(0, 50)) {
    const id = (p.id || '').padEnd(36);
    const st = (p.status || '?').padEnd(9);
    const sv = (p.severity || '?').padEnd(8);
    const tr = (p.tier || '?').padEnd(10);
    const fl = `${p.file || '?'}:${p.line || '?'}`;
    log(`${id} | ${st} | ${sv} | ${tr} | ${fl}`);
  }
  if (filtered.length > 50) {
    log(`\n(showing 50 of ${filtered.length})`);
  }
}

async function cmdApply(id) {
  const data = loadProposals();
  if (!data) { err('❌ cannot load repair_proposals.json'); process.exit(1); }
  const proposal = findProposal(data, id);
  if (!proposal) { err(`❌ proposal not found: ${id}`); process.exit(2); }
  if (proposal.status === 'pending') { err(`❌ must approve first: ${id}`); process.exit(3); }
  if (proposal.status === 'rejected') { err(`❌ already rejected: ${id}`); process.exit(3); }
  if (proposal.status === 'applied') { log(`⚠️  already applied: ${id}`); return; }

  // Resolve absPath — proposals may have relative paths from the script's cwd
  const rawPath = proposal.absPath || proposal.file;
  const absPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(WS, rawPath);

  if (!fs.existsSync(absPath)) {
    err(`❌ source file not found: ${absPath}`);
    process.exit(4);
  }

  // Build issue object that applyFix expects
  const issue = {
    file: proposal.file,
    absPath: absPath,
    line: proposal.line,
    rule: proposal.rule,
    severity: proposal.severity,
    tier: proposal.tier,
    message: proposal.message,
    reason: proposal.reason,
  };

  log(`🔧 applying fix: ${id}`);
  log(`   file: ${absPath}:${proposal.line}`);
  log(`   rule: ${proposal.rule}`);

  // Snapshot the original content for defense-in-depth comparison
  let originalContent;
  try {
    originalContent = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    err(`❌ cannot read source: ${e.message}`);
    process.exit(5);
  }

  // Call the real applyFix (dryRun=false, no graph for now — Layer 2 still
  // runs inside applyFix if a graph is provided; null disables it).
  let result;
  try {
    result = await auditRepair.applyFix(absPath, issue, false, null);
  } catch (e) {
    err(`❌ apply threw: ${e.message}`);
    process.exit(6);
  }

  if (!result || !result.ok) {
    const reason = (result && result.error) || 'unknown failure';
    err(`❌ apply failed: ${reason}`);
    if (result && result.snapPath) log(`   snapshot saved: ${result.snapPath}`);
    // Roll back (if any) already happened inside applyFix; leave status as
    // "approved" so user can retry once they fix the underlying rule/path.
    process.exit(7);
  }

  // Verify file actually changed (defense in depth — catches silent-no-op)
  let newContent;
  try {
    newContent = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    err(`❌ post-apply read failed: ${e.message}`);
    process.exit(8);
  }
  if (newContent === originalContent) {
    err(`❌ file unchanged after apply — fix was a no-op! BUG.`);
    process.exit(9);
  }

  // Mark as applied
  proposal.status = 'applied';
  proposal.appliedAt = new Date().toISOString();
  proposal.applyResult = {
    snapPath: result.snapPath,
    crossScriptFixes: result.crossScriptFixes || [],
  };
  saveProposals(data);
  recordAction(id, 'apply', 'applied');
  log(`✅ applied: ${id}`);
  log(`   snap: ${result.snapPath}`);
  if (result.crossScriptFixes && result?.crossScriptFixes?.length > 0) {
    log(`   🌐 ${result?.crossScriptFixes?.length} Layer 2 follow-up(s) detected`);
  }
}

function printHelp() {
  console.log(`proposal_action.js — manual approve/reject for repair proposals

Usage:
  node scripts/proposal_action.js approve <id>     # mark approved
  node scripts/proposal_action.js reject <id>      # mark rejected
  node scripts/proposal_action.js reject <id> --reason "why"
  node scripts/proposal_action.js list              # show all pending
  node scripts/proposal_action.js list --all        # show all statuses
  node scripts/proposal_action.js list --tier production --severity high
  node scripts/proposal_action.js show <id>         # show one
  node scripts/proposal_action.js apply <id>        # mark approved + applied (v0: status only)

Examples:
  node scripts/proposal_action.js approve PROP-1781870310697-5e0srh
  node scripts/proposal_action.js list --severity critical
  node scripts/proposal_action.js reject PROP-1781870310697-5e0srh --reason "out of scope"
`);
}

function main() {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }
  const cmd = args[0];
  const id = args[1];
  if (cmd === 'list') {
    cmdList(args);
  } else if ((cmd === 'approve' || cmd === 'reject' || cmd === 'show' || cmd === 'apply') && !id) {
    err(`❌ ${cmd} requires an id`);
    process.exit(2);
  } else if (cmd === 'approve') {
    cmdApprove(id);
  } else if (cmd === 'reject') {
    const reasonIdx = args.indexOf('--reason');
    const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : null;
    cmdReject(id, reason);
  } else if (cmd === 'show') {
    cmdShow(id);
  } else if (cmd === 'apply') {
    return cmdApply(id);  // returns a Promise; main()'s caller awaits it
  } else {
    err(`❌ unknown command: ${cmd}`);
    printHelp();
    process.exit(1);
  }
}

const m = main();
if (m && typeof m.catch === 'function') {
  m.catch(e => {
    err(`❌ apply error: ${e.message}`);
    if (e.stack) err(e.stack);
    process.exit(99);
  });
}
