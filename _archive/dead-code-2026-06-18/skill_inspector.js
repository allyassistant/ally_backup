#!/usr/bin/env node
/**
 * skill_inspector.js — QW Skill Inspector CLI
 *
 * Step 1 of 4 in Skill Viewer roadmap.
 * Lists all `skills/_learned_*` symlinks with quality / usage / metadata.
 *
 * Data sources (auto-detected, graceful degradation):
 *   1. Symlinks in ~/.openclaw/workspace/skills/_learned_*
 *   2. Quality scores from .spawn/reports/description_audit_*.jsonl
 *   3. Description + disable flag from SKILL.md frontmatter
 *   4. Usage count from .skill_usage_log.jsonl (if exists)
 *
 * Usage:
 *   node scripts/skill_inspector.js [options]
 *
 * Options:
 *   --filter <keyword>     grep description / name
 *   --sort <field>         quality | usage | name | date  (default: quality)
 *   --format <fmt>         table | json | markdown         (default: table)
 *   --limit <N>            top N results
 *   --show-disabled        include disable-model-invocation:true skills
 *   --low-quality          only show quality < 70
 *   --dry-run              no-op safety flag (still reads everything)
 *   --help, -h             show this help
 *
 * Exit codes:
 *   0 = success
 *   1 = fatal error
 *   2 = no skills found (friendly, not an error)
 *
 * Created: 2026-06-15  |  M3 sub-agent build
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { WS } = require('./lib/config');
const { extractField, parseFrontmatter } = require('./lib/frontmatter');

// ──────────────────────────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────────────────────────
const CONFIG = {
  SKILLS_DIR: path.join(WS, 'skills'),
  SKILLS_LEARNED_DIR: path.join(WS, 'skills-learned'),
  AUDIT_DIR: path.join(WS, '.spawn', 'reports'),
  USAGE_LOG: path.join(WS, '.skill_usage_log.jsonl'),
  DESC_TRUNC: 60,
  QUALITY_THRESHOLDS: { excellent: 90, good: 80, ok: 70 },
  DEFAULT_SORT: 'quality',
  DEFAULT_FORMAT: 'table',
  MD_DESC_TRUNC: 120,
};

// ──────────────────────────────────────────────────────────────────
// CLI ARG PARSING (surgical — no external deps)
// ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--filter': args.filter = argv[++i]; break;
      case '--sort': args.sort = argv[++i]; break;
      case '--format': args.format = argv[++i]; break;
      case '--limit': args.limit = parseInt(argv[++i], 10); break;
      case '--show-disabled': args.showDisabled = true; break;
      case '--low-quality': args.lowQuality = true; break;
      case '--dry-run': args.dryRun = true; break;
      case '-h':
      case '--help': args.help = true; break;
      default: args._.push(a);
    }
  }
  return args;
}

function printHelp() {
  console.log(`QW Skill Inspector CLI

Usage: node scripts/skill_inspector.js [options]

Options:
  --filter <keyword>     grep description / name
  --sort <field>         quality | usage | name | date  (default: quality)
  --format <fmt>         table | json | markdown         (default: table)
  --limit <N>            top N results
  --show-disabled        include disable-model-invocation:true skills
  --low-quality          only show quality < 70
  --dry-run              safety flag (no writes; this CLI is read-only anyway)
  -h, --help             show this help

Data sources (auto-detected):
  • Symlinks:  skills/_learned_*
  • Quality:   .spawn/reports/description_audit_*.jsonl  (latest mtime wins)
  • Usage:     .skill_usage_log.jsonl  (if present)
  • Metadata:  SKILL.md frontmatter

Examples:
  node scripts/skill_inspector.js
  node scripts/skill_inspector.js --filter cron
  node scripts/skill_inspector.js --format json --limit 3
  node scripts/skill_inspector.js --sort usage
  node scripts/skill_inspector.js --low-quality --show-disabled
`);
}

// ──────────────────────────────────────────────────────────────────
// DATA LOADERS (each isolated, try-catch per AGENTS.md P0)
// ──────────────────────────────────────────────────────────────────

/**
 * Load latest description_audit_*.jsonl into Map<skillName, score>.
 * Prefers the most-recent mtime file. Graceful if missing.
 */
function loadQualityScores() {
  const map = new Map();
  let auditFile = null;
  try {
    const files = fs.readdirSync(CONFIG.AUDIT_DIR)
      .filter(f => /^description_audit_.*\.jsonl$/.test(f))
      .map(f => ({ f, mtime: fs.statSync(path.join(CONFIG.AUDIT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) return map;
    auditFile = path.join(CONFIG.AUDIT_DIR, files[0].f);
  } catch (_) {
    return map; // dir missing → graceful
  }

  try {
    const lines = fs.readFileSync(auditFile, 'utf8').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const d = JSON.parse(t);
        if (d && d.skill && typeof d.score === 'number') {
          // keep the highest score if a skill appears in multiple files
          const prev = map.get(d.skill);
          if (prev === undefined || d.score > prev) map.set(d.skill, d.score);
        }
      } catch (_) { /* skip malformed line */ }
    }
  } catch (_) { /* file unreadable */ }
  return map;
}

/**
 * Load usage log (Map<skillName, count> + Map<skillName, lastReadTs>).
 * Returns null if log missing.
 */
function loadUsageLog() {
  if (!fs.existsSync(CONFIG.USAGE_LOG)) return null;
  const counts = new Map();
  const lastRead = new Map();
  try {
    const lines = fs.readFileSync(CONFIG.USAGE_LOG, 'utf8').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const d = JSON.parse(t);
        const name = d.skill || d.name;
        if (!name) continue;
        counts.set(name, (counts.get(name) || 0) + 1);
        const ts = d.ts || d.timestamp || d.time;
        if (ts) {
          const existing = lastRead.get(name);
          if (!existing || ts > existing) lastRead.set(name, ts);
        }
      } catch (_) { /* skip */ }
    }
  } catch (_) { /* unreadable */ }
  return { counts, lastRead };
}

/**
 * List all _learned_* symlinks in skills/ with metadata.
 * Returns array of raw entries.
 */
function listLearnedSymlinks() {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(CONFIG.SKILLS_DIR, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isSymbolicLink()) continue;
    if (!ent.name.startsWith('_learned_')) continue;
    const linkPath = path.join(CONFIG.SKILLS_DIR, ent.name);
    let target = null, mtime = null, sizeBytes = 0;
    let broken = false, hasSkillMd = true;
    try {
      target = fs.readlinkSync(linkPath);
    } catch (_) {
      broken = true;
    }
    try {
      const st = fs.lstatSync(linkPath);
      mtime = st.mtime;
    } catch (_) { /* ignore */ }
    let resolvedPath = null;
    try {
      resolvedPath = fs.realpathSync(linkPath);
    } catch (_) {
      broken = true;
    }
    let description = null, disableFlag = false, status = null, skillMdContent = null;
    if (resolvedPath) {
      const skillMd = path.join(resolvedPath, 'SKILL.md');
      try {
        const stat = fs.statSync(skillMd);
        sizeBytes = stat.size;
        skillMdContent = fs.readFileSync(skillMd, 'utf8');
        description = extractField(skillMdContent, 'description');
        const flagVal = extractField(skillMdContent, 'disable-model-invocation');
        disableFlag = flagVal === 'true' || flagVal === 'yes';
        status = extractField(skillMdContent, 'status');
      } catch (_) {
        hasSkillMd = false;
      }
    }
    out.push({
      name: ent.name,
      bareName: ent.name.replace(/^_learned_/, ''),
      symlinkPath: linkPath,
      target,
      resolvedPath,
      mtime: mtime ? mtime.toISOString() : null,
      broken,
      hasSkillMd,
      description,
      disableFlag,
      status,
      sizeBytes,
    });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// ENRICH + FILTER + SORT
// ──────────────────────────────────────────────────────────────────
function enrich(entries, qualityMap, usageData) {
  return entries.map(e => {
    const quality = qualityMap.has(e.bareName) ? qualityMap.get(e.bareName) : null;
    let usageCount = 0, lastRead = null;
    if (usageData) {
      usageCount = usageData.counts.get(e.bareName) || 0;
      const ts = usageData.lastRead.get(e.bareName);
      if (ts) lastRead = typeof ts === 'number' ? new Date(ts).toISOString() : ts;
    }
    let displayDesc;
    if (e.broken) displayDesc = '❌ BROKEN';
    else if (!e.hasSkillMd) displayDesc = '❌ NO_SKILL_MD';
    else if (e.description) {
      const d = e.description;
      displayDesc = d.length > CONFIG.DESC_TRUNC
        ? d.slice(0, CONFIG.DESC_TRUNC - 1) + '…'
        : d;
    } else {
      displayDesc = '—';
    }
    return {
      name: e.name,
      description: e.description,
      displayDescription: displayDesc,
      quality,
      usage_count: usageCount,
      last_read: lastRead,
      skill_path: e.symlinkPath,
      target_path: e.target,
      resolved_path: e.resolvedPath,
      disable_model_invocation: e.disableFlag,
      status: e.status,
      created: e.mtime,
      size_bytes: e.sizeBytes,
      broken: e.broken,
    };
  });
}

function applyFilters(entries, args) {
  let out = entries;
  if (!args.showDisabled) {
    out = out.filter(e => !e.disable_model_invocation);
  }
  if (args.filter) {
    const k = args.filter.toLowerCase();
    out = out.filter(e =>
      e.name.toLowerCase().includes(k) ||
      (e.description && e.description.toLowerCase().includes(k))
    );
  }
  if (args.lowQuality) {
    out = out.filter(e => e.quality !== null && e.quality < CONFIG.QUALITY_THRESHOLDS.ok);
  }
  return out;
}

function applySort(entries, sortField) {
  const arr = entries.slice();
  switch (sortField) {
    case 'usage':
      arr.sort((a, b) => b.usage_count - a.usage_count
        || (b.quality ?? 0) - (a.quality ?? 0)
        || a.name.localeCompare(b.name));
      break;
    case 'name':
      arr.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'date':
      arr.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
      break;
    case 'quality':
    default:
      arr.sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0)
        || a.name.localeCompare(b.name));
  }
  return arr;
}

// ──────────────────────────────────────────────────────────────────
// RENDERERS
// ──────────────────────────────────────────────────────────────────
function qualityGrade(q) {
  if (q === null || q === undefined) return '—';
  if (q >= CONFIG.QUALITY_THRESHOLDS.excellent) return '🟢';
  if (q >= CONFIG.QUALITY_THRESHOLDS.good) return '✅';
  if (q >= CONFIG.QUALITY_THRESHOLDS.ok) return '🟡';
  return '🔴';
}

function formatLastRead(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toISOString().slice(0, 10);
  } catch (_) { return '—'; }
}

function renderTable(entries, allEntries) {
  if (entries.length === 0) {
    console.log('No skills matched.');
    return;
  }

  // Column widths
  const nameW = Math.max(4, ...entries.map(e => e.name.length));
  const qualW = 7;
  const useW = 5;
  const lastW = 10;
  const descW = CONFIG.DESC_TRUNC;

  const header = [
    'NAME'.padEnd(nameW),
    'QUALITY'.padStart(qualW),
    'USAGE'.padStart(useW),
    'LAST READ'.padEnd(lastW),
    'DESCRIPTION',
  ].join(' | ');
  const sep = '─'.repeat(nameW) + '─┼─' + '─'.repeat(qualW) + '─┼─' +
    '─'.repeat(useW) + '─┼─' + '─'.repeat(lastW) + '─┼─' + '─'.repeat(descW);

  console.log(header);
  console.log(sep);
  for (const e of entries) {
    const qStr = e.quality !== null ? String(e.quality) : '—';
    const uStr = String(e.usage_count);
    const lStr = formatLastRead(e.last_read);
    const dStr = e.displayDescription;
    const line = [
      e.name.padEnd(nameW),
      qStr.padStart(qualW),
      uStr.padStart(useW),
      lStr.padEnd(lastW),
      dStr,
    ].join(' | ');
    console.log(line);
  }

  // Summary
  const total = allEntries.length;
  const matched = entries.length;
  const ge80 = allEntries.filter(e => e.quality !== null && e.quality >= 80).length;
  const ge70lt80 = allEntries.filter(e => e.quality !== null && e.quality >= 70 && e.quality < 80).length;
  const lt70 = allEntries.filter(e => e.quality !== null && e.quality < 70).length;
  const noScore = allEntries.filter(e => e.quality === null).length;
  const used = allEntries.filter(e => e.usage_count > 0).length;
  const broken = allEntries.filter(e => e.broken).length;
  const disabled = allEntries.filter(e => e.disable_model_invocation).length;

  console.log('');
  console.log(`Summary: ${total} total | ${ge80} 🟢≥80 | ${ge70lt80} 🟡70-79 | ${lt70} 🔴<70 | ${noScore} unscored | ${used} used | ${broken} broken | ${disabled} disabled`);
  if (matched !== total) {
    console.log(`Showing: ${matched} of ${total} (filtered)`);
  }
}

function renderJson(entries) {
  console.log(JSON.stringify(entries, null, 2));
}

function renderMarkdown(entries) {
  if (entries.length === 0) {
    console.log('No skills matched.');
    return;
  }
  console.log('| Name | Quality | Usage | Last Read | Description |');
  console.log('|------|---------|-------|-----------|-------------|');
  for (const e of entries) {
    const desc = (e.description || '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const dTrunc = desc.length > CONFIG.MD_DESC_TRUNC ? desc.slice(0, CONFIG.MD_DESC_TRUNC - 3) + '…' : desc;
    console.log(`| \`${e.name}\` | ${e.quality ?? '—'} (${qualityGrade(e.quality)}) | ${e.usage_count} | ${formatLastRead(e.last_read)} | ${dTrunc} |`);
  }
}

function render(entries, allEntries, fmt) {
  switch (fmt) {
    case 'json': return renderJson(entries);
    case 'markdown': return renderMarkdown(entries);
    case 'table':
    default: return renderTable(entries, allEntries);
  }
}

// ──────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return; }

  // Banner
  if ((args.format || CONFIG.DEFAULT_FORMAT) === 'table') {
    const title = args.filter
      ? `QW Skill Inspector — matching "${args.filter}"`
      : 'QW Skill Inspector';
    console.log(`${title}\n`);
  }

  // Load data
  const qualityMap = loadQualityScores();
  const usageData = loadUsageLog();
  const rawEntries = listLearnedSymlinks();

  if (rawEntries.length === 0) {
    console.log('No _learned_* skills found in', CONFIG.SKILLS_DIR);
    process.exit(2);
  }

  // Enrich
  const enriched = enrich(rawEntries, qualityMap, usageData);

  // Filter
  const filtered = applyFilters(enriched, args);

  // Sort
  const sortField = args.sort || CONFIG.DEFAULT_SORT;
  const sorted = applySort(filtered, sortField);

  // Limit
  const limited = args.limit && args.limit > 0 ? sorted.slice(0, args.limit) : sorted;

  // Format
  const fmt = args.format || CONFIG.DEFAULT_FORMAT;
  if (fmt === 'table') {
    if (args.filter) {
      console.log(`${limited.length} skills matching "${args.filter}"\n`);
    } else if (args.lowQuality) {
      console.log(`${limited.length} skills with quality < ${CONFIG.QUALITY_THRESHOLDS.ok}\n`);
    } else if (args.limit && args.limit > 0) {
      console.log(`Top ${limited.length} of ${enriched.length} skills (sort: ${sortField})\n`);
    } else {
      console.log(`${limited.length} skills found\n`);
    }
  }
  render(limited, enriched, fmt);

  if (args.dryRun) console.log('\n[--dry-run: no side effects possible — this CLI is read-only]');
}

// Allow require() for testing without auto-running
if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('FATAL:', err && err.stack || err);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  loadQualityScores,
  loadUsageLog,
  listLearnedSymlinks,
  enrich,
  applyFilters,
  applySort,
  qualityGrade,
  CONFIG,
};
