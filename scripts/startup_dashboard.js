#!/usr/bin/env node
/**
 * startup_dashboard.js — Session Briefing v3.0
 *
 * Cleaned-up version: urgency briefing only.
 * No metadata cache, no multi-channel, no persona display.
 *
 * Core value: urgency grouping + auto-extract from session_end.js
 *
 * Usage:
 *   node startup_dashboard.js           # Full briefing
 *   node startup_dashboard.js --brief   # Only urgent + P1 tasks
 *   node startup_dashboard.js --version # Show version
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── ANSI Colors ────────────────────────────────────────────────────────────────
const C = {
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  cyan:    '\x1b[36m',
  magenta: '\x1b[35m',
  reset:   '\x1b[0m',
};

const SEP     = `${C.bold}${C.cyan}━━━`;
const SEP_END = `${C.dim}${C.cyan}━━━━━`;

const WORKSPACE = path.join(process.env.HOME, '.openclaw/workspace');

// ── Helpers ───────────────────────────────────────────────────────────────────
function readJSON(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function readTextFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8').trim(); }
  catch { return null; }
}

function section(title) {
  console.log(`\n${SEP} ${title} ${C.reset}`);
}

function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function stripBullet(line) {
  return line.replace(/^[\s*\-•⚠️✅🟢🟡🔴🔵▸▶]+/, '').trim();
}

// ── 1. → DO THIS directive ────────────────────────────────────────────────────
function showDirective() {
  const handoff = readTextFile(path.join(WORKSPACE, '.session_handoff.md'));
  if (!handoff) return;

  const nextStep = handoff.match(/## 建議下一步\s*\n([\s\S]*?)(?=\n## |$)/);
  const objective = handoff.match(/## 當前目標\s*\n([\s\S]*?)(?=\n## |$)/);

  if (nextStep) {
    const line = nextStep[1].trim().split('\n').filter(l => l.trim())[0];
    const clean = stripBullet(line);
    if (clean) {
      console.log(`  ${C.green}${C.bold}→ DO THIS:${C.reset} ${clean.slice(0, 130)}`);
      return;
    }
  }

  if (objective) {
    const line = objective[1].trim().split('\n').filter(l => l.trim())[0];
    const clean = stripBullet(line);
    if (clean) {
      console.log(`  ${C.yellow}▶ On:${C.reset} ${clean.slice(0, 130)}`);
    }
  }
}

// ── 2. Pending Decisions ─────────────────────────────────────────────────────
function showPendingDecisions() {
  const fp = path.join(WORKSPACE, '_pending_decisions.md');
  let content;
  try { content = fs.readFileSync(fp, 'utf8'); }
  catch { return; }

  const items = content.split('\n').filter(l => /^\s*-\s*\[/.test(l.trim()));
  if (items.length === 0) return;

  section('Decisions');
  items.forEach(line => {
    const clean = line.replace(/^-?\s*(\[\d{4}-\d{2}-\d{2}\])?\s*/, '').trim();
    const sepIdx = clean.indexOf('—');
    if (sepIdx > 0) {
      console.log(`  ${C.yellow}⏳${C.reset} ${C.bold}${clean.slice(0, sepIdx).trim()}${C.reset} — ${clean.slice(sepIdx + 1).trim()}`);
    } else {
      console.log(`  ${C.yellow}⏳${C.reset} ${clean}`);
    }
  });
}

// ── 3. Grouped Tasks ──────────────────────────────────────────────────────────
function showGroupedTasks(briefMode) {
  const issuesDir = path.join(WORKSPACE, '.issues/active');
  let files;
  try {
    files = fs.readdirSync(issuesDir).filter(f => f.endsWith('.md'));
  } catch (e) { return; }
  if (files.length === 0) return;

  const parsed = [];
  files.forEach(file => {
    const fp  = path.join(issuesDir, file);
    const raw = (() => { try { return fs.readFileSync(fp, 'utf8'); } catch (e) { return ''; } })();
    if (!raw) return;

    const title    = (raw.match(/^title:\s*(.+)/m)    || [])[1] || file.replace(/\.md$/, '').replace(/-/g, ' ');
    const priority = (raw.match(/^priority:\s*(.+)/im) || [])[1] || 'P?';
    const due      = (raw.match(/^due:\s*(.+)/im)      || [])[1] || null;
    const progress = (raw.match(/^progress:\s*(.+)/im) || [])[1] || null;

    let urgency = 0, daysOverdue = '';
    if (due) {
      const today = getDateNDaysAgo(0);
      if (due < today) {
        urgency = 2;
        const dueTime = new Date(due).getTime();
        const dl = !isNaN(dueTime) ? Math.round((Date.now() - dueTime) / 86400000) : 0;
        if (dl > 0) daysOverdue = `[${dl}d]`;
      } else if (due === today) {
        urgency = 1;
      }
    }

    const isMonitor = /觀察|monitor|watch|follow/i.test(raw);
    const isP1      = /P1/i.test(priority);
    const hasProgress = !!progress;

    parsed.push({ title, due, progress, urgency, daysOverdue, isMonitor, isP1, hasProgress });
  });

  // Group
  const overdue    = parsed.filter(t => t.urgency === 2).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const dueToday   = parsed.filter(t => t.urgency === 1).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const p1Tasks    = parsed.filter(t => t.isP1 && t.urgency === 0).sort((a, b) => (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99'));
  const p1Ids      = p1Tasks.map(t => t.title);
  const inProgress = parsed.filter(t => t.hasProgress && t.urgency === 0 && !t.isP1 && !t.isMonitor);
  const monitoring = parsed.filter(t => t.isMonitor && t.urgency === 0 && !t.isP1);
  const backlog    = parsed.filter(t => t.urgency === 0 && !t.isP1 && !t.hasProgress && !t.isMonitor);

  const totalUrgent = overdue.length + dueToday.length + p1Tasks.length;
  if (totalUrgent === 0 && !briefMode && parsed.length === 0) return;

  section('Tasks');

  const render = (label, items, color) => {
    if (items.length === 0) return;
    console.log(`  ${color}${C.bold}${label} (${items.length})${C.reset}`);
    items.forEach(t => {
      const prefix = t.daysOverdue ? `${C.red}${t.daysOverdue}${C.reset} ` : '';
      const titleDisp = t.title.length > 55 ? t.title.slice(0, 52) + '...' : t.title;
      console.log(`    ${prefix}${titleDisp}`);
      if (t.progress && t.progress.length < 60) {
        console.log(`      ${C.dim}${t.progress}${C.reset}`);
      }
    });
  };

  if (briefMode) {
    render('OVERDUE', overdue, C.red);
    render('DUE TODAY', dueToday, C.yellow);
    render('P1', p1Tasks, C.magenta);
    const remaining = parsed.length - overdue.length - dueToday.length - p1Tasks.length;
    if (remaining > 0) console.log(`  ${C.dim}· ${remaining} more${C.reset}`);
  } else {
    render('OVERDUE', overdue, C.red);
    render('DUE TODAY', dueToday, C.yellow);
    render('P1', p1Tasks, C.magenta);
    render('IN PROGRESS', inProgress, C.green);
    render('MONITORING', monitoring, C.blue);
    if (backlog.length > 0) console.log(`  ${C.dim}· backlog (${backlog.length})${C.reset}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
const VERSION = '3.0.0';

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--version')) {
    console.log(`startup_dashboard.js v${VERSION}`);
    return;
  }

  const brief = args.includes('--brief');

  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║      SESSION BRIEFING  v${VERSION}${C.bold}${C.cyan}        ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════╝${C.reset}`);

  // Freshness indicator
  const handoffContent = readTextFile(path.join(WORKSPACE, '.session_handoff.md'));
  if (handoffContent) {
    const genMatch = handoffContent.match(/^generated:\s*(.+)/m);
    if (genMatch) {
      const genTime = new Date(genMatch[1].replace('+08:00', '+0800'));
      const diff = Math.floor((Date.now() - genTime.getTime()) / 1000);
      let freshness;
      if (diff < 60) freshness = `${diff}s ago`;
      else if (diff < 3600) freshness = `${Math.floor(diff / 60)}m ago`;
      else if (diff < 86400) freshness = `${Math.floor(diff / 3600)}h ago`;
      else freshness = `${Math.floor(diff / 86400)}d ago`;
      console.log(`  ${C.dim}Last handoff: ${freshness}${C.reset}`);
    }
  }

  showDirective();
  showPendingDecisions();
  showGroupedTasks(brief);

  console.log(`\n${SEP_END} End ━━━━━${C.reset}\n`);
}

main();
