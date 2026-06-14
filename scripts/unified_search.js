#!/usr/bin/env node
/**
 * Unified Search API (Phase 2)
 *
 * 一條 command 搜尋所有知識來源：
 *   - Wiki (LanceDB vector search + BM25 keyword)
 *   - L0 Abstract (semantic match over latest)
 *   - L1 Overview (semantic match over latest)
 *   - L2 Memory files (keyword + recent)
 *   - Issues (keyword)
 *
 * 用法：
 *   node unified_search.js "query"           # 預設顯示 Top-10
 *   node unified_search.js "query" --top 5   # 指定數量
 *   node unified_search.js "query" --sources wiki,memory  # 限定來源
 *   node unified_search.js "query" --raw     # JSON 輸出
 *   node unified_search.js "query" --trace   # 詳細每個來源結果數
 *
 * 整合：喺 SOUL.md / TOOLS.md 加入指令參考
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// 配置
// ============================================================

const CONFIG = {
  WORKSPACE_DIR: process.env.WORKSPACE_DIR || path.join(process.env.HOME || '/Users/ally', '.openclaw/workspace'),
  OLLAMA_HOST: 'http://localhost:11434',
  EMBEDDING_MODEL: 'nomic-embed-text',
  VECTORIZER_PATH: path.join(__dirname, 'wiki_vectorizer.js'),
  MEMORY_DIR: 'memory',
  L0_DIR: 'memory/l0-abstract',
  L1_DIR: 'memory/l1-overview',
  ISSUES_DIR: '.issues/active',
  WIKI_DIR: 'wiki',
  MAX_RESULTS: 10,
  MAX_RECENT_MEMORY_DAYS: 30,   // 搜尋最近幾日嘅 L2 memory
};

// ============================================================
// Ollama Embedding
// ============================================================

function normalizeVector(vec) {
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (mag === 0) return vec;
  return vec.map(v => v / mag);
}

async function getEmbedding(text) {
  const res = await fetch(`${CONFIG.OLLAMA_HOST}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CONFIG.EMBEDDING_MODEL, prompt: text.slice(0, 2048) }),
  });
  if (!res.ok) throw new Error(`Ollama embedding failed: ${res.status}`);
  const data = await res.json();
  return normalizeVector(data.embedding);
}

// ============================================================
// Source 1: Wiki Vector Search (via LanceDB)
// ============================================================

async function searchWiki(query, topK) {
  try {
    const mod = require(CONFIG.VECTORIZER_PATH);
    const results = await mod.hybridSearch(query, topK);
    return results.map(r => ({
      source: 'wiki',
      sourceLabel: r.source === 'vector' ? '🧬 Wiki' : r.source === 'keyword' ? '🔤 Wiki' : '🔀 Wiki',
      file: r.file,
      heading: r.heading || '(topic)',
      text: r.text,
      score: r.score,
    }));
  } catch (e) {
    return [{ source: 'wiki_error', text: `Wiki search failed: ${e.message}`, score: 0 }];
  }
}

// ============================================================
// Source 2: L0/L1 Overview (vector similarity over file content)
// ============================================================

function getRecentFiles(dir, maxDays = 30) {
  const dirPath = path.join(CONFIG.WORKSPACE_DIR, dir);
  if (!fs.existsSync(dirPath)) return [];

  const MS_PER_DAY = 86400000;
  const cutoff = Date.now() - maxDays * MS_PER_DAY;
  const files = [];

  try {
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      const full = path.join(dirPath, entry);
      if (!entry.endsWith('.md') && !entry.endsWith('.md')) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs > cutoff) {
          files.push({ path: full, relative: path.join(dir, entry), mtime: stat.mtimeMs });
        }
      } catch { /* skip unreadable */ }
    }
  } catch { /* dir not found */ }

  return files.sort((a, b) => b.mtime - a.mtime);
}

async function searchL0L1(query, topK) {
  const results = [];

  // Get recent L0 and L1 files (use file name timestamps too)
  const l0Files = getRecentFiles(CONFIG.L0_DIR).filter(f => f.relative.match(/kb-/));
  const l1Files = getRecentFiles(CONFIG.L1_DIR).filter(f => f.relative.match(/kb-/));

  // Also include date-based files (not just kb-)
  const l0DateFiles = getRecentFiles(CONFIG.L0_DIR).filter(f => !f.relative.match(/kb-/));
  const l1DateFiles = getRecentFiles(CONFIG.L1_DIR).filter(f => !f.relative.match(/kb-/));

  const allFiles = [...l0Files, ...l1Files, ...l0DateFiles, ...l1DateFiles].slice(0, 50);

  if (allFiles.length === 0) return results;

  // Get query embedding once
  let queryEmb;
  try { queryEmb = await getEmbedding(query); } catch { return results; }

  // Batch process files — read content, compute similarity
  const candidates = [];
  for (const file of allFiles) {
    try {
      const content = fs.readFileSync(file.path, 'utf8').slice(0, 1500); // limit reading
      if (content.trim().length < 50) continue;

      // Keyword pre-filter: skip if no word overlap (optimization)
      const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
      const contentLower = content.toLowerCase();
      const wordHits = queryWords.filter(w => contentLower.includes(w)).length;

      // For date-based files (L0/L1 overviews), always include. For kb- files, need keyword signal
      const isDateFile = !file.relative.match(/kb-/);
      if (!isDateFile && wordHits === 0 && queryWords.length > 0) continue;

      const fileEmb = await getEmbedding(content.slice(0, 800));
      const sim = cosineSimilarity(queryEmb, fileEmb);

      if (sim > 0.3 || isDateFile) {
        // Extract heading
        const headingMatch = content.match(/^#\s+(.+)/m);
        candidates.push({
          source: 'memory',
          sourceLabel: file.relative.includes('l1-overview') ? '📋 L1' : '📄 L0',
          file: file.relative,
          heading: headingMatch ? headingMatch[1].trim() : path.basename(file.relative, '.md'),
          text: content.replace(/^#\s+.+\n/, '').trim().slice(0, 300),
          score: sim,
        });
      }
    } catch { /* skip */ }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, topK);
}

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ============================================================
// Source 3: L2 Memory (keyword search + recent)
// ============================================================

function searchMemory(query, topK) {
  const memDir = path.join(CONFIG.WORKSPACE_DIR, CONFIG.MEMORY_DIR);
  if (!fs.existsSync(memDir)) return [];

  const resultMap = new Map(); // dedup by content fingerprint
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  // Search recent L2 files (date pattern YYYY-MM-DD*.md)
  let allFiles = [];
  try {
    allFiles = fs.readdirSync(memDir)
      .filter(f => f.match(/^\d{4}-\d{2}-\d{2}/) && f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, 30); // 最近 30 日
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
  }

  for (const file of allFiles) {
    try {
      const content = fs.readFileSync(path.join(memDir, file), 'utf8').toLowerCase();
      const hits = terms.filter(t => content.includes(t)).length;
      if (hits === 0) continue;

      // Score: percentage of query terms matched
      const score = hits / terms.length;

      // Extract relevant line(s) for snippet
      const lines = fs.readFileSync(path.join(memDir, file), 'utf8').split('\n');
      let snippet = '';
      let heading = '';

      for (let i = 0; i < lines.length; i++) {
        const hm = lines[i].match(/^#\s+(.+)/);
        if (hm) heading = hm[1].trim();

        const lower = lines[i].toLowerCase();
        if (terms.some(t => lower.includes(t))) {
          snippet = lines.slice(Math.max(0, i - 1), i + 4).join('\n').slice(0, 300);
          break;
        }
      }

      if (!snippet) snippet = lines.slice(0, 5).join('\n').slice(0, 200);

      const fp = snippet.slice(0, 80);
      if (!resultMap.has(fp)) {
        resultMap.set(fp, {
          source: 'memory',
          sourceLabel: '📓 Memory',
          file: `memory/${file}`,
          heading: heading || file.replace('.md', ''),
          text: snippet,
          score: score * 0.7, // weight L2 lower than wiki/L0
        });
      }
    } catch { /* skip */ }
  }

  return Array.from(resultMap.values()).sort((a, b) => b.score - a.score).slice(0, topK);
}

// ============================================================
// Source 4: Config Files (MEMORY.md, AGENTS.md, SOUL.md, HEARTBEAT.md, TOOLS.md)
// ============================================================

function searchConfigFiles(query, topK) {
  const configFiles = [
    'MEMORY.md', 'AGENTS.md', 'SOUL.md', 'HEARTBEAT.md', 'TOOLS.md', 'IDENTITY.md'
  ];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const results = [];
  for (const file of configFiles) {
    const fullPath = path.join(CONFIG.WORKSPACE_DIR, file);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const contentLower = content.toLowerCase();
      const hits = terms.filter(t => contentLower.includes(t)).length;
      if (hits === 0) continue;

      const score = hits / terms.length;
      const lines = content.split('\n');
      let snippet = '';
      for (let i = 0; i < lines.length; i++) {
        if (terms.some(t => lines[i].toLowerCase().includes(t))) {
          snippet = lines.slice(Math.max(0, i - 1), i + 4).join('\n').slice(0, 300);
          break;
        }
      }
      if (!snippet) snippet = lines.slice(0, 5).join('\n').slice(0, 200);

      // Extract heading
      let heading = file.replace('.md', '');
      for (let i = 0; i < Math.min(lines.length, 10); i++) {
        const m = lines[i].match(/^#\s+(.+)/);
        if (m) { heading = m[1].trim(); break; }
      }

      results.push({
        source: 'config',
        sourceLabel: '⚙️ Config',
        file: file,
        heading,
        text: snippet,
        score: score * 0.65,
      });
    } catch { /* skip */ }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ============================================================
// Source 5: Issues (keyword search)
// ============================================================

function searchIssues(query, topK) {
  const issuesDir = path.join(CONFIG.WORKSPACE_DIR, CONFIG.ISSUES_DIR);
  if (!fs.existsSync(issuesDir)) return [];

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];

  try {
    const files = fs.readdirSync(issuesDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(issuesDir, file), 'utf8');
        const contentLower = content.toLowerCase();
        const hits = terms.filter(t => contentLower.includes(t)).length;
        if (hits === 0) continue;

        const score = hits / terms.length;
        const headingMatch = content.match(/^#\s+(.+)/m);
        const heading = headingMatch ? headingMatch[1].trim() : file.replace('.md', '');

        results.push({
          source: 'issue',
          sourceLabel: '📌 Issue',
          file: `.issues/active/${file}`,
          heading: heading,
          text: content.replace(/^#\s+.+\n/, '').trim().slice(0, 300),
          score: score * 0.5, // weight issues lower
        });
      } catch { /* skip */ }
    }
  } catch { /* dir not found */ }

  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ============================================================
// Unified Search
// ============================================================

async function unifiedSearch(query, opts = {}) {
  const topK = opts.topK || CONFIG.MAX_RESULTS;
  const sources = opts.sources ? opts.sources.split(',') : ['wiki', 'memory', 'l0l1', 'issue', 'config'];
  const trace = opts.trace;

  // Build description for Ollama to understand intent
  let results = [];
  let traces = {};

  // Source 1: Wiki
  if (sources.includes('wiki')) {
    const wikiResults = await searchWiki(query, topK * 2);
    if (trace) traces.wiki = wikiResults.length;
    results.push(...wikiResults);
  }

  // Source 2: L0/L1
  if (sources.includes('l0l1')) {
    const l0l1Results = await searchL0L1(query, topK);
    if (trace) traces.l0l1 = l0l1Results.length;
    results.push(...l0l1Results);
  }

  // Source 3: Memory L2
  if (sources.includes('memory')) {
    const memResults = searchMemory(query, topK);
    if (trace) traces.memory = memResults.length;
    results.push(...memResults);
  }

  // Source 4: Config files (MEMORY.md, AGENTS.md, etc.)
  if (sources.includes('config') || sources.includes('memory')) {
    const configResults = searchConfigFiles(query, topK);
    if (trace) traces.config = configResults.length;
    results.push(...configResults);
  }

  // Source 5: Issues
  if (sources.includes('issue')) {
    const issueResults = searchIssues(query, topK);
    if (trace) traces.issues = issueResults.length;
    results.push(...issueResults);
  }

  // Dedup by text fingerprint
  const deduped = new Map();
  for (const r of results) {
    const fp = r.text.slice(0, 80);
    if (!deduped.has(fp) || deduped.get(fp).score < r.score) {
      deduped.set(fp, r);
    }
  }

  // Sort by score descending
  const final = Array.from(deduped.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (trace) traces.total = final.length;

  return { results: final, traces, total: final.length };
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
Unified Search v1.0 — 搜尋所有知識來源
=======================================
Usage:
  node unified_search.js "query"
  node unified_search.js "query" --top 5
  node unified_search.js "query" --sources wiki,memory,l0l1,issue
  node unified_search.js "query" --raw        # JSON output
  node unified_search.js "query" --trace      # Show source breakdown
  node unified_search.js "query" --stats      # DB stats (quick)

Examples:
  node unified_search.js "RAG 企業知識庫點樣做"
  node unified_search.js "diamond stock update" --trace
  node unified_search.js "上次講過嘅 embedding model" --top 3
`);
    return;
  }

  let query = args[0];
  const topK = args.includes('--top') ? parseInt(args[args.indexOf('--top') + 1]) || 10 : 10;
  const sources = args.includes('--sources') ? args[args.indexOf('--sources') + 1] : undefined;
  const raw = args.includes('--raw');
  const trace = args.includes('--trace');

  // If first arg is search/wiki/hybrid, remove prefix
  query = query.replace(/^(search |wiki |hybrid )/i, '');

  const start = Date.now();
  const { results } = await unifiedSearch(query, { topK, sources, trace });

  if (raw) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log('❌ No results found.');
    return;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`🔎 Search: "${query}"`);
  console.log(`   ${results.length} results (${elapsed}s)`);
  if (trace) {
    console.log(`   Sources: ${JSON.stringify(results.reduce((acc, r) => { acc[r.source] = (acc[r.source]||0)+1; return acc; }, {}))}`);
  }
  console.log('');

  results.forEach((r, i) => {
    const pct = (r.score * 100).toFixed(0);
    console.log(`  ${r.sourceLabel} [${pct}%] ${r.heading}`);
    console.log(`      ${r.text.slice(0, 150).replace(/\n/g, ' ')}`);
    console.log(`      📁 ${r.file}`);
    console.log('');
  });
}

if (require.main === module) {
  main().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}

module.exports = { unifiedSearch, searchWiki, searchL0L1, searchMemory, searchIssues, searchConfigFiles };
