#!/usr/bin/env node
/**
 * scan_generic_links.js - One-shot audit: find notes using generic vocabulary-bucket links
 *
 * Reads existing Obsidian vault, scans all [[wikilinks]] across all .md files,
 * identifies which ones are "generic" (vocabulary bucket risk), and produces
 * an audit report with upgrade suggestions.
 *
 * Pure read-only: does NOT modify any note. Use the report to decide what to fix.
 *
 * Usage:
 *   node scripts/scan_generic_links.js [--limit 20] [--out path/to/report.md]
 */

const fs = require('fs');
const path = require('path');

const VAULT = path.join(process.env.HOME, 'Documents', 'Obsidian Vault');
// Wikilink patterns supported:
//   [[title]]                              → title
//   [[title#fragment]]                     → "title#fragment" (preserve fragment as part of title)
//   [[title|alias]]                        → title
//   [[title#fragment|alias]]               → "title#fragment"
//
// Note: we keep the #fragment as part of the title (e.g. "Issue #122") so that
// specific anchored links like [[Issue #122]] aren't classified as generic buckets.
const WIKILINK_RE = /\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g;

// ===== Reuse heuristic from write_to_obsidian.js =====
// (Duplicated intentionally to keep this script self-contained for one-shot use.)
const GENERIC_TITLE_WORDS = new Set([
  'work', 'meeting', 'team', 'idea', 'note', 'project', 'task', 'plan',
  'ai', 'tech', 'business', 'concept',
  'process', 'system', 'design', 'code', 'data', 'model',
  'review', 'analysis', 'report', 'goal', 'method', 'framework',
  'principle', 'issue', 'bug', 'feature', 'release',
  'thinking', 'learning', 'knowledge', 'information', 'content', 'style', 'design',
  '工作', '會議', '團隊', '想法', '筆記', '項目', '任務', '計劃',
  '人生', '生活', '反思', '總結',
  '思考', '學習', '成長', '目標', '方法', '經驗', '觀點',
  '系統', '流程', '策略', '設計', '開發', '測試',
  '原理', '框架', '模式', '知識', '溝通', '管理', '領導',
  '創新', '改變', '決定', '選擇',
]);
const CHINESE_PHRASE_MARKERS = /[\u7684\u6ca1\u662f\u6709\u4e86\u5728\u548c\u8207\u53ca\u6216\u4f46\u800c\u4ee5\u7232]/;
const GENERIC_TITLE_MIN_LEN = 4;

function isGenericLinkTitle(title) {
  const clean = title.replace(/[\[\]]/g, '').trim();
  if (!clean) return true;
  const lower = clean.toLowerCase();
  if (GENERIC_TITLE_WORDS.has(lower)) return true;
  if (/[?\uff1f]/.test(clean)) return false;
  if (/[.\-_:/\\]/.test(clean)) return false;
  if (clean.split(/\s+/).length >= 2) return false;
  if (clean.length > 2 && CHINESE_PHRASE_MARKERS.test(clean)) return false;
  if (/^[\u4e00-\u9fff]+$/.test(clean)) return clean.length <= 2;
  if (/[\u4e00-\u9fff]/.test(clean) && /[a-zA-Z]/.test(clean)) return false;
  if (/[A-Z]/.test(clean) && /[a-z]/.test(clean)) return false;
  if (/^\d+$/.test(clean)) return true;
  if (/^[A-Z][A-Z0-9]{0,4}$/.test(clean)) return false;
  if (clean.length < GENERIC_TITLE_MIN_LEN) return true;
  // Numbered item references (Issue #122, RFC 2616, page 42) — specific even if first word is generic
  if (/^(?:issue|rfc|pr|page|chapter|section|part|appendix|fig|figure|table|step|item|task|note|ticket)\s*#?\d+/i.test(clean)) return false;
  return false;
}

// ===== Parse args =====
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { limit: 0, out: null, json: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit': opts.limit = parseInt(args[++i], 10) || 0; break;
      case '--out': opts.out = args[++i]; break;
      case '--json': opts.json = true; break;
    }
  }
  return opts;
}

// ===== Walk vault and find all notes =====
function walkVault(vault) {
  const notes = [];
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent?.name?.startsWith('.') || ent.name === '_archive' || ent.name === 'node_modules') continue;
        walk(full);
      } else if (ent?.name?.endsWith('.md')) {
        // Exclude this script's own audit reports — they intentionally contain
        // generic-link examples which would pollute the count.
        if (/vault-generic-link-audit\.md$/i.test(ent.name)) continue;
        notes.push(full);
      }
    }
  }
  walk(vault);
  return notes;
}

// ===== Find a target note by title (filename or H1) =====
function findTargetNote(targetTitle, vault, excludePath = null) {
  const slug = targetTitle
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  let found = null;
  function walk(dir) {
    if (found) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (full === excludePath) continue;
      if (ent.isDirectory()) {
        if (ent?.name?.startsWith('.') || ent.name === '_archive') continue;
        walk(full);
      } else if (ent?.name?.endsWith('.md')) {
        const baseLower = ent?.name?.replace(/\.md$/, '').toLowerCase();
        if (baseLower === slug) { found = full; return; }
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const h1Match = content.match(/^#\s+(.+)$/m);
          if (h1Match && h1Match[1].trim().toLowerCase() === targetTitle.trim().toLowerCase()) {
            found = full; return;
          }
        } catch (e) {}
      }
    }
  }
  walk(vault);
  return found;
}

// ===== Extract wikilinks from content =====
function extractWikilinks(content) {
  const links = [];
  let m;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(content)) !== null) {
    links.push(m[1].trim());
  }
  return links;
}

// ===== Main =====
function main() {
  const opts = parseArgs();
  if (!fs.existsSync(VAULT)) {
    console.error(`❌ Vault not found: ${VAULT}`);
    process.exit(1);
  }

  console.log(`🔍 Scanning vault: ${VAULT}`);
  const allNotes = walkVault(VAULT);
  console.log(`   Found ${allNotes.length} .md files`);

  // Per-source findings
  const sourceFindings = []; // { source, genericLinks: [{ title, targetExists, targetPath }] }

  // Aggregate generic-link usage counts (for "most popular generic buckets" report)
  const genericUsageCount = new Map(); // title -> { count, hasTargetPage, hasAnySpecificReplacement }

  for (const notePath of allNotes) {
    let content;
    try { content = fs.readFileSync(notePath, 'utf-8'); } catch (e) { continue; }
    const links = extractWikilinks(content);
    const uniqueLinks = [...new Set(links)];
    const genericLinks = [];

    for (const title of uniqueLinks) {
      if (isGenericLinkTitle(title)) {
        const targetPath = findTargetNote(title, VAULT, notePath);
        genericLinks.push({
          title,
          targetExists: !!targetPath,
          targetPath: targetPath ? path.relative(VAULT, targetPath) : null,
        });

        if (!genericUsageCount.has(title)) {
          genericUsageCount.set(title, { count: 0, sourceNotes: [], hasTargetPage: false, examples: [] });
        }
        const agg = genericUsageCount.get(title);
        agg.count += links.filter(l => l === title).length;
        agg?.sourceNotes?.push(path.relative(VAULT, notePath));
        if (targetPath) agg.hasTargetPage = true;
        if (agg?.examples?.length < 3) agg?.examples?.push(path.relative(VAULT, notePath));
      }
    }

    if (genericLinks.length > 0) {
      sourceFindings.push({
        source: path.relative(VAULT, notePath),
        genericLinks,
      });
    }
  }

  // Sort sources by number of generic links (descending)
  sourceFindings.sort((a, b) => b?.genericLinks?.length - a?.genericLinks?.length);

  // Sort generic buckets by usage count
  const sortedBuckets = [...genericUsageCount.entries()]
    .map(([title, info]) => ({ title, ...info }))
    .sort((a, b) => b.count - a.count);

  // ===== Build report =====
  const totalGenericLinks = sourceFindings.reduce((s, f) => s + f?.genericLinks?.length, 0);
  const totalUsages = [...genericUsageCount.values()].reduce((s, v) => s + v.count, 0);

  let report = '';
  report += `# Obsidian Generic-Link Audit\n\n`;
  report += `*Generated: ${new Date().toISOString().split('T')[0]}*\n\n`;
  report += `> **Read-only scan** — no notes were modified. Use this report to decide what to fix.\n\n`;
  report += `## Summary\n\n`;
  report += `| Metric | Count |\n|---|---|\n`;
  report += `| Notes scanned | ${allNotes.length} |\n`;
  report += `| Notes with at least 1 generic link | ${sourceFindings.length} |\n`;
  report += `| Unique generic link titles | ${genericUsageCount.size} |\n`;
  report += `| Total generic link usages | ${totalUsages} |\n\n`;

  report += `## Top Generic Link Buckets (by usage)\n\n`;
  report += `| Generic Title | Usages | Has Target Page? | Example Sources |\n`;
  report += `|---|---:|---|---|\n`;
  for (const b of sortedBuckets.slice(0, 30)) {
    const targetMark = b.hasTargetPage ? '⚠️ yes' : '✅ no (orphan)';
    const ex = b?.examples?.map(e => `\`${e}\``).join(', ');
    report += `| \`[[${b.title}]]\` | ${b.count} | ${targetMark} | ${ex} |\n`;
  }
  report += `\n> **Interpretation:**\n`;
  report += `> - **Has target page ⚠️** → the page exists, but it's likely a "vocabulary bucket" (catches all mentions). Consider splitting into specific sub-concepts.\n`;
  report += `> - **No target page ✅** → the link goes nowhere (orphan). Lower priority — at least it's not actively misleading.\n\n`;

  // Limit
  const limited = opts.limit > 0 ? sourceFindings.slice(0, opts.limit) : sourceFindings;
  report += `## Per-Source Findings\n\n`;
  if (opts.limit > 0) report += `*Showing top ${opts.limit} of ${sourceFindings.length} source notes (sorted by # of generic links)*\n\n`;

  for (const f of limited) {
    report += `### \`${f.source}\` — ${f?.genericLinks?.length} generic link(s)\n\n`;
    for (const g of f.genericLinks) {
      const status = g.targetExists ? `→ \`${g.targetPath}\` (vocabulary bucket risk)` : `→ (orphan, no target page)`;
      report += `- \`[[${g.title}]]\` ${status}\n`;
    }
    report += `\n`;
  }

  // Suggestion heuristics
  report += `## Upgrade Suggestions\n\n`;
  report += `For each generic bucket with high usage, consider one of:\n\n`;
  report += `1. **Split into specific concepts** (观自's principle): e.g. \`[[會議]]\` → \`[[會議前沒有明確決策點]]\`, \`[[會議超時]]\`, etc.\n`;
  report += `2. **Convert to non-link** if the mention is incidental (just remove the \`[[]]\`).\n`;
  report += `3. **Keep as link but rename the target page** to be specific (give the bucket a focused name).\n`;
  report += `4. **Add a structured note** at the target explaining what aspect this bucket captures (if you intentionally want a "summary index").\n\n`;

  // Output
  if (opts.json) {
    const json = { summary: { totalNotes: allNotes.length, notesWithGeneric: sourceFindings.length, uniqueGenericTitles: genericUsageCount.size, totalUsages }, buckets: sortedBuckets, sources: sourceFindings };
    console.log(JSON.stringify(json, null, 2));
  } else {
    if (opts.out) {
      try {
        fs.mkdirSync(path.dirname(opts.out), { recursive: true });
        fs.writeFileSync(opts.out, report);
        console.log(`\n✅ Report written: ${opts.out}`);
        console.log(`   ${sourceFindings.length} notes flagged with ${totalGenericLinks} generic link instances`);
        console.log(`   ${genericUsageCount.size} unique generic titles (${totalUsages} total usages)`);
      } catch (e) {
        console.error(`❌ Write failed: ${e.message}`);
        process.exit(1);
      }
    } else {
      console.log('\n' + report);
    }
  }
}

main();
