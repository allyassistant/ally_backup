#!/usr/bin/env node
/**
 * session_end.js — Session End Auto-Fill
 *
 * Standardizes .session_handoff.md + auto-fills _pending_decisions.md
 * Called manually at session end before compaction.
 *
 * Usage:
 *   node scripts/session_end.js \ (backslash for readability)
 *     --objective "Observe cron fix 7 days" \
 *     --next-step "Check 06:00 cron results" \
 *     --blockers "Waiting for Josh approval on X" \
 *     --facts "Deploy passed; Audit passed" \
 *     --tasks "#111: 1/7 done; #124: 1/7 done" \
 *     --dont-redo "SOUL.md L4 — architecture enough; Wiki fix — deployed" \
 *     --pending "CodeGuard deprioritized — Josh considering, waiting for decision"
 *
 *   node scripts/session_end.js --brief   # Quick check: show last handoff
 *   node scripts/session_end.js --help    # Show all flags
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = path.join(process.env.HOME, '.openclaw/workspace');
const HANDOFF_FILE = path.join(WORKSPACE, '.session_handoff.md');
const PENDING_FILE = path.join(WORKSPACE, '_pending_decisions.md');
const BOOTSTRAP_SCRIPT = path.join(WORKSPACE, 'scripts/cross_session_bootstrap.js');
const HEARTBEAT_SCRIPT = path.join(WORKSPACE, 'scripts/heartbeat.sh');
const DASHBOARD_SCRIPT = path.join(WORKSPACE, 'scripts/startup_dashboard.js');

const colors = {
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',
  dim:     '\x1b[2m',
  bold:    '\x1b[1m',
  reset:   '\x1b[0m',
};

function log(label, msg) {
  const color = colors[Object.keys(colors).find(c => colors[c] === label) || 'reset'];
  console.log(`${colors.dim}[session_end]${colors.reset} ${label || ''}${msg}`);
}

function getHKTTimestamp() {
  const d = new Date();
  const offset = 8 * 60;
  const hkt = new Date(d.getTime() + offset * 60 * 1000);
  return hkt.toISOString().replace('T', ' ').slice(0, 19) + '+08:00';
}

function readTextFile(fp) {
  try { return fs.readFileSync(fp, 'utf8').trim(); }
  catch { return null; }
}

// ── Parse args ────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
session_end.js — Session End Auto-Fill

USAGE:
  node scripts/session_end.js [flags]

FLAGS:
  --objective "..."    Current objective (required)
  --next-step "..."    Recommended next action
  --blockers "..."     Blockers (semicolon separated)
  --facts "..."        Key facts (semicolon separated)
  --tasks "..."        In-progress tasks (semicolon separated)
  --dont-redo "..."    Do-not-redo items (semicolon separated)
  --pending "..."      Pending decisions (semicolon separated)
  --brief              Show last handoff content (read-only)
  --help               This message

EXAMPLE:
  node scripts/session_end.js \\
    --objective "Main project tracking" \\
    --next-step "Check cron results tomorrow" \\
    --pending "Feature X — waiting for approval"

MULTI-LINE VALUES:
  Use semicolons to separate multiple items:
  --facts "Item 1; Item 2; Item 3"
`);
    process.exit(0);
  }

  if (args.includes('--brief')) {
    const content = readTextFile(HANDOFF_FILE);
    if (content) {
      console.log(`\n${colors.cyan}╔══════════════════════════════════════╗${colors.reset}`);
      console.log(`${colors.cyan}║     LAST SESSION HANDOFF (read-only)  ║${colors.reset}`);
      console.log(`${colors.cyan}╚══════════════════════════════════════╝${colors.reset}\n`);
      console.log(content);
    } else {
      console.log(`${colors.yellow}No handoff file found.${colors.reset}`);
    }
    process.exit(0);
  }

  const get = (flag) => {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    return args[idx + 1] || null;
  };

  return {
    objective: get('--objective'),
    nextStep:  get('--next-step'),
    blockers:  get('--blockers'),
    facts:     get('--facts'),
    tasks:     get('--tasks'),
    dontRedo:  get('--dont-redo'),
    pending:   get('--pending'),
  };
}

// ── Pending Decisions ─────────────────────────────────────────────────────────
function appendPendingDecisions(pendingStr) {
  if (!pendingStr) return false;

  const items = pendingStr.split(';').map(s => s.trim()).filter(s => s.length > 10);
  if (items.length === 0) return false;

  const today = getHKTTimestamp().slice(0, 10);

  // Read raw (don't trim — newlines matter for append position)
  let content;
  try {
    content = fs.readFileSync(PENDING_FILE, 'utf8');
  } catch {
    content = '# Pending Decisions\n\n';
  }

  // Normalize: ensure ends with exactly \n\n
  const trimmed = content.replace(/\n*$/, '');
  const output = trimmed + '\n\n';

  let appended = 0;
  let result = output;
  items.forEach(item => {
    const line = `- [${today}] ${item}`;
    // Dedup: skip if same topic already exists
    const itemTopic = item.split('—')[0].trim();
    if (!result.includes(itemTopic)) {
      result += line + '\n';
      appended++;
    }
  });

  if (appended === 0) return false;

  result += '\n';
  const tmpFile = PENDING_FILE + '.tmp';
  try {
    fs.writeFileSync(tmpFile, result, 'utf8');
    fs.renameSync(tmpFile, PENDING_FILE);
    console.log(`${colors.green}✅ Appended ${appended} pending decision(s)${colors.reset}`);
    return true;
  } catch (e) {
    console.error(`${colors.red}❌ Pending write failed: ${e.message}${colors.reset}`);
    try { fs.unlinkSync(tmpFile); } catch {}
    return false;
  }

  return false;
}

// ── Standardized Handoff ──────────────────────────────────────────────────────
function writeHandoff(data) {
  const timestamp = getHKTTimestamp();

  let md = `---
generated: ${timestamp}
---

## 💡 手動 Handoff

## 當前目標
${data.objective || '（由 Ally 喺 session end 時填寫）'}
`;

  if (data.nextStep) {
    md += `
## 建議下一步
${data.nextStep}
`;
  }

  if (data.blockers) {
    const items = data.blockers.split(';').map(s => s.trim()).filter(s => s);
    md += `
## 阻塞狀態
`;
    items.forEach(i => { md += `- ${i}\n`; });
  }

  if (data.facts) {
    const items = data.facts.split(';').map(s => s.trim()).filter(s => s);
    md += `
## 關鍵事實
`;
    items.forEach(i => { md += `- ${i}\n`; });
  }

  if (data.tasks) {
    const items = data.tasks.split(';').map(s => s.trim()).filter(s => s);
    md += `
## 進行中任務
`;
    items.forEach(i => { md += `- ${i}\n`; });
  }

  md += `
## 審批狀態
無 pending approvals
`;

  if (data.dontRedo) {
    const items = data.dontRedo.split(';').map(s => s.trim()).filter(s => s);
    md += `
## 唔使再做
`;
    items.forEach(i => { md += `- ${i}\n`; });
  }

  // Atomic write
  const tmpFile = HANDOFF_FILE + '.tmp';
  try {
    fs.writeFileSync(tmpFile, md, 'utf8');
    fs.renameSync(tmpFile, HANDOFF_FILE);
    console.log(`${colors.green}✅ Handoff written: ${HANDOFF_FILE}${colors.reset}`);
  } catch (e) {
    console.error(`${colors.red}❌ Handoff write failed: ${e.message}${colors.reset}`);
    try { fs.unlinkSync(tmpFile); } catch {}
    process.exit(1);
  }
}

// ── Auto-Extraction (data-driven, no manual flags needed) ────────────────────
function autoExtractTasks() {
  const issuesDir = path.join(WORKSPACE, '.issues/active');
  try {
    const files = fs.readdirSync(issuesDir).filter(f => f.endsWith('.md'));
    if (files.length === 0) return null;

    const items = [];
    files.forEach(file => {
      const raw = (() => { try { return fs.readFileSync(path.join(issuesDir, file), 'utf8'); } catch { return ''; } })();
      if (!raw) return;
      const title = (raw.match(/^title:\s*(.+)/m) || [])[1] || file.replace(/\.md$/, '');
      const status = (raw.match(/^status:\s*(\w+)/im) || [])[1] || '';
      const progress = (raw.match(/^progress:\s*(.+)/im) || [])[1] || '';
      if (status !== 'completed' && title) {
        const suffix = progress ? ` (${progress})` : '';
        items.push(`${title}${suffix}`);
      }
    });
    return items.length > 0 ? items.join('; ') : null;
  } catch { return null; }
}

function autoExtractNextStep() {
  const issuesDir = path.join(WORKSPACE, '.issues/active');
  try {
    const files = fs.readdirSync(issuesDir).filter(f => f.endsWith('.md'));
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    const urgent = [];
    files.forEach(file => {
      const raw = (() => { try { return fs.readFileSync(path.join(issuesDir, file), 'utf8'); } catch { return ''; } })();
      if (!raw) return;
      const title = (raw.match(/^title:\s*(.+)/m) || [])[1] || '';
      const due = (raw.match(/^due:\s*(\d{4}-\d{2}-\d{2})/im) || [])[1] || '';
      if (due && title) {
        if (due < todayStr) urgent.push(`${title} (overdue ${due})`);
        else if (due === todayStr) urgent.push(`${title} (due today)`);
      }
    });

    if (urgent.length > 0) {
      return 'Check: ' + urgent.join('; ');
    }
    return null;
  } catch { return null; }
}

function autoExtractFacts(previousHandoff) {
  const items = [];

  // From previous handoff (carry forward)
  if (previousHandoff) {
    const factsMatch = previousHandoff.match(/## 關鍵事實\s*\n([\s\S]*?)(?=\n## |$)/);
    if (factsMatch) {
      const lines = factsMatch[1].trim().split('\n').filter(l => l.trim());
      lines.forEach(l => {
        const clean = l.replace(/^[\s*\-•]+/, '').trim();
        if (clean) items.push(clean);
      });
    }
  }

  // From latest L0 if available
  const l0Dir = path.join(WORKSPACE, 'memory/l0-abstract');
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
  [yesterday, todayStr].forEach(dateStr => {
    try {
      const content = fs.readFileSync(path.join(l0Dir, dateStr + '.md'), 'utf8');
      const lines = content.split('\n').filter(l => /^\s*[\*\-]/.test(l) && !l.includes('Generated:') && !l.includes('Source:'));
      lines.forEach(l => {
        const clean = l.replace(/^[\s*\-•⚠️✅🟢🟡🔴🔵▸▶]+/, '').trim().slice(0, 100);
        if (clean && !items.some(i => i.includes(clean.slice(0, 30)))) {
          items.push(clean);
        }
      });
    } catch {}
  });

  return items.length > 0 ? items.slice(0, 8).join('; ') : null;
}

function autoExtractBlockers() {
  // Look for blocked issues
  const issuesDir = path.join(WORKSPACE, '.issues/active');
  try {
    const files = fs.readdirSync(issuesDir).filter(f => f.endsWith('.md'));
    const blocked = [];
    files.forEach(file => {
      const raw = (() => { try { return fs.readFileSync(path.join(issuesDir, file), 'utf8'); } catch { return ''; } })();
      if (!raw) return;
      const title = (raw.match(/^title:\s*(.+)/m) || [])[1] || '';
      if (/\[blocked\]|🔴\s*blocked|\bblocked\b|等待|停/i.test(raw) && title) {
        blocked.push(title);
      }
    });
    return blocked.length > 0 ? ('Waiting on: ' + blocked.join('; ')) : null;
  } catch { return null; }
}

function autoExtractObjective(previousHandoff) {
  if (previousHandoff) {
    const objMatch = previousHandoff.match(/## 當前目標\s*\n([\s\S]*?)(?=\n## |$)/);
    if (objMatch) {
      const line = objMatch[1].trim().split('\n').filter(l => l.trim())[0];
      return line.replace(/^[\s*\-•]+/, '').trim();
    }
  }
  return null;
}

// ── Post-Write Steps ──────────────────────────────────────────────────────────
function runBootstrap() {
  try {
    execSync(`node "${BOOTSTRAP_SCRIPT}" --quiet`, { timeout: 30000, cwd: WORKSPACE });
    console.log(`${colors.green}✅ Bootstrap updated${colors.reset}`);
  } catch (e) {
    console.log(`${colors.yellow}⚠ Bootstrap: ${e.stderr || e.message}${colors.reset}`);
  }
}

function updateHeartbeat() {
  try {
    // Auto-detect NODE_ID: env > hostname > username fallback
    const env = { ...process.env };
    if (!env.NODE_ID) {
      const os = require('os');
      const hostname = os.hostname();
      const username = os.userInfo().username;
      const candidates = [hostname.split('.')[0].toLowerCase(), username.toLowerCase()];
      // Check if ha-state/<name> exists for any candidate
      const haStateDir = path.join(WORKSPACE, 'ha-state');
      for (const c of candidates) {
        if (fs.existsSync(path.join(haStateDir, c))) {
          env.NODE_ID = c;
          break;
        }
      }
      if (!env.NODE_ID) env.NODE_ID = username.toLowerCase(); // final fallback
    }
    try {
      execSync(`bash "${HEARTBEAT_SCRIPT}"`, { timeout: 10000, cwd: WORKSPACE, env });
    } catch (e) {
      console.error(`Command execution failed: ${e.message}`);
    }
    console.log(`${colors.green}✅ Heartbeat updated (${env.NODE_ID})${colors.reset}`);
  } catch (e) {
    console.log(`${colors.dim}⚠ Heartbeat: noop (${e.message?.slice(0, 80) || 'unknown'})${colors.reset}`);
  }
}

function runDashboard() {
  try {
    const output = execSync(`node "${DASHBOARD_SCRIPT}" --brief`, { timeout: 10000, encoding: 'utf8', cwd: WORKSPACE });
    console.log(`\n${colors.cyan}📋 Quick check (--brief):${colors.reset}\n${output.slice(0, 500)}`);
  } catch {
    console.log(`${colors.dim}⚠ Dashboard: skip${colors.reset}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
function main() {
  const flags = parseArgs();
  const previousHandoff = readTextFile(HANDOFF_FILE);

  // Auto-extract data from system, merge with user flags
  const auto = {
    tasks:    autoExtractTasks(),
    nextStep: autoExtractNextStep(),
    facts:    autoExtractFacts(previousHandoff),
    blockers: autoExtractBlockers(),
    objective: autoExtractObjective(previousHandoff),
  };

  const data = {
    objective: flags.objective || auto.objective || '(ongoing)',
    nextStep:  flags.nextStep  || auto.nextStep || null,
    blockers:  flags.blockers  || auto.blockers || null,
    facts:     flags.facts     || auto.facts    || null,
    tasks:     flags.tasks     || auto.tasks    || null,
    dontRedo:  flags.dontRedo  || null,
    pending:   flags.pending   || null,
  };

  console.log(`\n${colors.cyan}╔══════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║        SESSION END AUTO-FILL         ║${colors.reset}`);
  console.log(`${colors.cyan}╚══════════════════════════════════════╝${colors.reset}`);
  console.log(`${colors.dim}  ${getHKTTimestamp()}${colors.reset}\n`);

  // Show what was auto-extracted vs manual
  const autoFlags = ['tasks', 'nextStep', 'facts', 'blockers', 'objective'];
  autoFlags.forEach(key => {
    const isAuto = !flags[key] && auto[key];
    const label = key.replace(/([A-Z])/g, ' $1').trim();
    if (isAuto) {
      const val = String(data[key]).slice(0, 80);
      console.log(`${colors.dim}  ↻ ${label}: auto-extracted ${val}...${colors.reset}`);
    } else if (flags[key]) {
      console.log(`${colors.green}  ✓ ${label}: manual${colors.reset}`);
    }
  });
  console.log('');

  // Step 1: Append pending decisions
  if (appendPendingDecisions(data.pending)) {
    console.log(`${colors.dim}  → Pending: ${PENDING_FILE}${colors.reset}`);
  }

  // Step 2: Write standardized handoff
  writeHandoff(data);

  // Step 3: Run bootstrap
  console.log('');
  runBootstrap();

  // Step 4: Update heartbeat
  updateHeartbeat();

  // Step 5: Quick dashboard check
  console.log('');
  runDashboard();

  console.log(`\n${colors.green}${colors.bold}✅ Session end complete${colors.reset}`);
  console.log(`${colors.dim}  Handoff: ${HANDOFF_FILE}${colors.reset}`);
  console.log(`${colors.dim}  Pending: ${PENDING_FILE}${colors.reset}`);
  console.log('');
}

main();
