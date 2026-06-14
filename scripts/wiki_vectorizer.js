#!/usr/bin/env node
/**
 * Wiki 向量化工具 (Wiki Vectorizer)
 *
 * 用途：將 wiki/ 目錄嘅 markdown 文件向量化，存入 LanceDB
 *       支援 hybrid search (vector + keyword BM25)
 *
 * 用法：
 *   node wiki_vectorizer.js              # 全量索引
 *   node wiki_vectorizer.js --dry-run    # 預覽（唔寫入）
 *   node wiki_vectorizer.js --quiet      # 靜默模式（for cron）
 *   node wiki_vectorizer.js search "query"  # 向量搜尋
 *   node wiki_vectorizer.js hybrid "query"  # Hybrid 搜尋
 *   node wiki_vectorizer.js status          # DB 狀態
 *
 * Architecture:
 *   Ollama (nomic-embed-text) → normalize → LanceDB
 *   Wiki .md files ──→ chunk by heading ──→ embed ──→ store
 *   User query   ──→ embed ──→ vector search ──→ results
 */

const fs = require('fs');
const path = require('path');
const lancedb = require('@lancedb/lancedb');

// ============================================================
// 配置
// ============================================================

const CONFIG = {
  WORKSPACE_DIR: process.env.WORKSPACE_DIR || path.join(process.env.HOME || '/Users/ally', '.openclaw/workspace'),
  DB_DIR: '.vector-db',
  EMBEDDING_MODEL: 'nomic-embed-text',
  OLLAMA_HOST: 'http://localhost:11434',
  CHUNK_SIZE: 800,
  MAX_RESULTS: 10,
  MIN_SCORE: 0.3,
  TABLE_NAME: 'wiki_chunks',
  quiet: false,
};

// ============================================================
// Ollama Embedding API (normalized)
// ============================================================

function normalizeVector(vec) {
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (mag === 0) return vec;
  return vec.map(v => v / mag);
}

async function getEmbedding(text) {
  const url = `${CONFIG.OLLAMA_HOST}/api/embeddings`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CONFIG.EMBEDDING_MODEL,
      prompt: text.slice(0, 2048),
    }),
  });
  if (!response.ok) throw new Error(`Ollama embedding failed: ${response.status}`);
  const data = await response.json();
  return normalizeVector(data.embedding);
}

// ============================================================
// LanceDB
// ============================================================

async function getDB() {
  const dbPath = path.join(CONFIG.WORKSPACE_DIR, CONFIG.DB_DIR);
  if (!fs.existsSync(dbPath)) {
    try {
      fs.mkdirSync(dbPath, { recursive: true });
    } catch (e) {
      console.error(`Directory creation failed: ${e.message}`);
    }
  }
  return await lancedb.connect(dbPath);
}

async function getTable(db) {
  const tableNames = await db.tableNames();
  if (tableNames.includes(CONFIG.TABLE_NAME)) {
    return await db.openTable(CONFIG.TABLE_NAME);
  }
  // Create with a dummy row, then delete it
  const first = await getEmbedding('init');
  const sample = [{
    id: '_schema_init',
    text: '',
    heading: '',
    file: '',
    line: 0,
    vector: new Float32Array(first.length),
    updatedAt: new Date().toISOString(),
  }];
  const table = await db.createTable(CONFIG.TABLE_NAME, sample);
  await table.delete("id = '_schema_init'");
  return table;
}

// ============================================================
// Chunking: 按 heading 切分 wiki markdown
// ============================================================

function chunkWikiContent(content, filePath) {
  const chunks = [];
  const lines = content.split('\n');
  let currentHeading = '';
  let currentSection = [];
  let currentLength = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{2,3})\s+(.+)/);

    if (headingMatch) {
      if (currentSection.length > 0) {
        const text = currentSection.join('\n').trim();
        if (text.length > 20) {
          chunks.push({ text, heading: currentHeading, file: filePath, line: i - currentSection.length + 1 });
        }
      }
      currentHeading = headingMatch[2].trim();
      currentSection = [line];
      currentLength = line.length;
      continue;
    }

    currentSection.push(line);
    currentLength += line.length;

    if (currentLength > CONFIG.CHUNK_SIZE && line.trim() === '') {
      const text = currentSection.join('\n').trim();
      if (text.length > 20) {
        chunks.push({ text, heading: currentHeading, file: filePath, line: i - currentSection.length + 1 });
      }
      const overlap = currentSection.slice(-3);
      currentSection = overlap;
      currentLength = overlap.join('\n').length;
    }
  }

  if (currentSection.length > 0) {
    const text = currentSection.join('\n').trim();
    if (text.length > 20) {
      chunks.push({ text, heading: currentHeading, file: filePath, line: lines.length - currentSection.length });
    }
  }

  return chunks;
}

// ============================================================
// 讀取 wiki 文件
// ============================================================

function readWikiFiles() {
  const files = [];
  const wikiDir = path.join(CONFIG.WORKSPACE_DIR, 'wiki');
  if (!fs.existsSync(wikiDir)) return files;
  let entries;
  try {
    entries = fs.readdirSync(wikiDir, { recursive: true });
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
  }
  for (const entry of entries) {
    const fullPath = path.join(wikiDir, entry);
    try {
      if (fs.statSync(fullPath).isFile() && entry.endsWith('.md')) {
        files.push(fullPath);
      }
    } catch (e) {
      console.error(`Operation failed: ${e.message}`);
    }
  }
  return files.sort();
}

// ============================================================
// Change detection
// ============================================================

function fileFingerprint(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    console.error(`Operation failed: ${e.message}`);
  }
  return `${filePath}:${stat.mtimeMs}:${stat.size}`;
}

function loadState() {
  const f = path.join(CONFIG.WORKSPACE_DIR, '.wiki_vectorizer_state.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { fingerprints: {}, lastRun: null }; }
}

function saveState(state) {
  const f = path.join(CONFIG.WORKSPACE_DIR, '.wiki_vectorizer_state.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(f + '.tmp', f);
}

// ============================================================
// 索引 wiki
// ============================================================

async function indexWiki(dryRun = false) {
  if (!CONFIG.quiet) console.log('🔍 Scanning wiki files...');
  const files = readWikiFiles();
  if (!CONFIG.quiet) console.log(`   Found ${files.length} wiki files`);

  const state = loadState();
  const newFingerprints = { ...state.fingerprints };
  let changedFiles = 0;
  let newChunks = [];

  for (const filePath of files) {
    const fp = fileFingerprint(filePath);
    const relativePath = path.relative(CONFIG.WORKSPACE_DIR, filePath);

    if (state.fingerprints[relativePath] === fp) continue;

    changedFiles++;
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
    const chunks = chunkWikiContent(content, relativePath);
    if (!CONFIG.quiet) console.log(`   ${relativePath}: ${chunks.length} chunks`);

    for (const chunk of chunks) {
      if (!dryRun) {
        try {
          const embedding = await getEmbedding(chunk.text);
          newChunks.push({
            id: `${relativePath}:${chunk.line}`,
            text: chunk.text,
            heading: chunk.heading,
            file: relativePath,
            line: chunk.line,
            vector: new Float32Array(embedding),
            updatedAt: new Date().toISOString(),
          });
        } catch (e) {
          console.error(`   ❌ Embedding failed: ${relativePath}:${chunk.line} — ${e.message}`);
        }
      }
    }
    newFingerprints[relativePath] = fp;
  }

  if (changedFiles === 0) {
    if (!CONFIG.quiet) console.log('   ✅ All files unchanged');
    return { indexed: 0, unchanged: files.length };
  }

  if (dryRun) {
    if (!CONFIG.quiet) console.log(`\n📊 Dry Run: ${changedFiles} files changed, ${newChunks.length} chunks`);
    return { indexed: 0, changed: changedFiles };
  }

  if (!CONFIG.quiet) console.log(`\n💾 Writing ${newChunks.length} vectors to LanceDB...`);

  const db = await getDB();
  const table = await getTable(db);

  // Delete old entries for changed files
  for (const f of files) {
    const rp = path.relative(CONFIG.WORKSPACE_DIR, f);
    if (newFingerprints[rp] !== state.fingerprints[rp]) {
      try { await table.delete(`file = '${rp.replace(/'/g, "\\'")}'`); } catch { /* table might not have old data */ }
    }
  }

  if (newChunks.length > 0) {
    await table.add(newChunks);
  }

  saveState({ fingerprints: newFingerprints, lastRun: new Date().toISOString() });

  const total = await table.countRows();
  if (!CONFIG.quiet) console.log(`   ✅ Indexed ${newChunks.length} chunks | Total: ${total}`);

  return { indexed: newChunks.length, changed: changedFiles, unchanged: files.length - changedFiles };
}

// ============================================================
// 向量搜尋
// ============================================================

async function search(query, topK = CONFIG.MAX_RESULTS) {
  const db = await getDB();
  const table = await getTable(db);
  const count = await table.countRows();

  if (count === 0) {
    if (!CONFIG.quiet) console.log('⚠️  Vector DB empty — run index first');
    return [];
  }

  const queryEmbedding = await getEmbedding(query);
  const results = await table.search(new Float32Array(queryEmbedding))
    .limit(topK)
    .toArray();

  // Normalized vectors => L2^2 = 2*(1-cosine)
  return results
    .filter(r => {
      if (r._distance === undefined) return false;
      return (1 - (r._distance * r._distance) / 2) > CONFIG.MIN_SCORE;
    })
    .map(r => ({
      file: r.file,
      heading: r.heading || '(no heading)',
      text: r.text.slice(0, 300),
      score: Math.max(0, 1 - (r._distance * r._distance) / 2),
    }));
}

// ============================================================
// BM25 keyword fallback
// ============================================================

function bm25Search(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const wikiFiles = readWikiFiles();
  const results = [];

  for (const filePath of wikiFiles) {
    const rp = path.relative(CONFIG.WORKSPACE_DIR, filePath);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8').toLowerCase();
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
    let score = 0;
    for (const term of terms) {
      const count = content.split(term).length - 1;
      if (count > 0) score += count;
    }
    if (score > 0) {
      let lines;
      try {
        lines = fs.readFileSync(filePath, 'utf8').split('\n');
      } catch (e) {
        console.error(`File read failed: ${e.message}`);
      }
      let snippet = '', heading = '';
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^#{2,3}\s+(.+)/);
        if (m) heading = m[1].trim();
        if (lines[i].toLowerCase().includes(terms[0])) {
          snippet = lines.slice(Math.max(0, i - 1), i + 4).join('\n').slice(0, 300);
          break;
        }
      }
      results.push({ file: rp, heading, text: snippet, score: Math.min(score / 5, 0.8) });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, CONFIG.MAX_RESULTS);
}

// ============================================================
// Hybrid Search
// ============================================================

async function hybridSearch(query, topK = CONFIG.MAX_RESULTS) {
  let vectorResults = [];
  try { vectorResults = await search(query, topK); } catch { /* fallback to keyword */ }

  const keywordResults = bm25Search(query);
  const merged = new Map();

  for (const r of vectorResults) {
    merged.set(`${r.file}:${r.heading}`, { ...r, source: 'vector' });
  }
  for (const r of keywordResults) {
    const key = `${r.file}:${r.heading}`;
    if (merged.has(key)) {
      merged.get(key).score = Math.min(merged.get(key).score + r.score * 0.3, 1);
      merged.get(key).source = 'hybrid';
    } else {
      merged.set(key, { ...r, source: 'keyword' });
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.score - a.score).slice(0, topK);
}

// ============================================================
// CLI
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const quiet = args.includes('--quiet');
  CONFIG.quiet = quiet;

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Wiki Vectorizer v1.0
Usage:
  node wiki_vectorizer.js                     # Index all wiki files
  node wiki_vectorizer.js --dry-run           # Preview only
  node wiki_vectorizer.js --quiet             # Silent mode (for cron)
  node wiki_vectorizer.js search "query"      # Vector search
  node wiki_vectorizer.js hybrid "query"      # Hybrid search
  node wiki_vectorizer.js status              # DB stats
`);
    return;
  }

  const si = args.indexOf('search');
  const hi = args.indexOf('hybrid');

  if (si >= 0 && args[si + 1]) {
    const results = await search(args[si + 1]);
    for (const r of results) {
      console.log(`  🧬 [${(r.score * 100).toFixed(0)}%] ${r.file} → ${r.heading}`);
      console.log(`      ${r.text.slice(0, 150)}...`);
      console.log('');
    }
    if (results.length === 0) console.log('   No results.');
    return;
  }

  if (hi >= 0 && args[hi + 1]) {
    const results = await hybridSearch(args[hi + 1]);
    for (const r of results) {
      const icon = r.source === 'vector' ? '🧬' : r.source === 'keyword' ? '🔤' : '🔀';
      console.log(`  ${icon} [${(r.score * 100).toFixed(0)}%] ${r.file} → ${r.heading}`);
      console.log(`      ${r.text.slice(0, 150)}...`);
      console.log('');
    }
    if (results.length === 0) console.log('   No results.');
    return;
  }

  if (args.includes('status')) {
    const db = await getDB();
    const names = await db.tableNames();
    if (names.includes(CONFIG.TABLE_NAME)) {
      const table = await db.openTable(CONFIG.TABLE_NAME);
      const count = await table.countRows();
      const state = loadState();
      console.log(`📊 Vector DB: ${CONFIG.DB_DIR}/`);
      console.log(`   Chunks: ${count}`);
      console.log(`   Files tracked: ${Object.keys(state.fingerprints).length}`);
      console.log(`   Last index: ${state.lastRun || 'never'}`);
    } else {
      console.log('📊 Vector DB empty');
    }
    return;
  }

  const result = await indexWiki(dryRun);
  if (!quiet) console.log('\n✅ Done.');
}

if (require.main === module) {
  main().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}

module.exports = { indexWiki, search, hybridSearch, chunkWikiContent, getEmbedding, normalizeVector, bm25Search, readWikiFiles };
