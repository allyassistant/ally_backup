#!/usr/bin/env node
/**
 * get_symbol_info.js - 符號導航查詢工具
 *
 * 輸入 symbol 名稱，返回該 symbol 的檔案位置、行號、描述，
 * 並提供推薦查看範圍。
 *
 * 使用方式:
 *   node scripts/get_symbol_info.js <symbol_name>
 *   node scripts/get_symbol_info.js heartbeat --context 5
 *   node scripts/get_symbol_info.js --peek <symbol_name>
 *   node scripts/get_symbol_info.js --help
 *
 * 輸出模式:
 *   --json   JSON 輸出
 *   --quiet  最小輸出
 *   --peek   代碼快照模式（顯示 symbol 周邊代碼）
 */

'use strict';

const fs = require('fs');
const path = require('path');

// === 解析參數 ===
const args = process.argv.slice(2);
const showHelp = args.includes('--help');
const jsonMode = args.includes('--json');
const quietMode = args.includes('--quiet');
const peekMode = args.includes('--peek');

// 解析 --peek=N 或 --peek N
const peekArgIdx = args.findIndex(a => a === '--peek');
let peekLines = 10;
if (peekArgIdx !== -1) {
  if (args[peekArgIdx + 1] && !args[peekArgIdx + 1].startsWith('--')) {
    peekLines = parseInt(args[peekArgIdx + 1], 10) || 10;
  }
}

const contextArg = args.find(a => a.startsWith('--context='));
const CONTEXT_LINES = contextArg
  ? parseInt(contextArg.split('=')[1], 10) || 5
  : (() => {
      const idx = args.indexOf('--context');
      return (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--'))
        ? parseInt(args[idx + 1], 10) || 5
        : 5;
    })();

let QUERY = args
  .filter((a, i) => {
    if (a.startsWith('--')) return false;
    // Skip the value that follows --context (standalone flag, not --context=value)
    if (i > 0 && args[i - 1] === '--context') return false;
    // Skip --peek value
    if (i > 0 && args[i - 1] === '--peek') return false;
    return true;
  })
  .join(' ').trim();

// === 幫助訊息 ===
if (showHelp) {
  console.log(`
📖 get_symbol_info.js - 符號導航查詢工具

使用方式:
  node scripts/get_symbol_info.js <symbol_name> [options]

參數:
  symbol_name     要查詢的符號名稱（大小寫不敏感，部分匹配）

選項:
  --context=N     顯示 symbol 前後 N 行（預設 5）
  --peek [N]      代碼快照模式，顯示 symbol 周邊 N 行代碼（預設 10）
  --json          JSON 輸出模式
  --quiet         安靜模式（最小輸出）
  --help          顯示此幫助訊息

範例:
  node scripts/get_symbol_info.js atomicAppend
  node scripts/get_symbol_info.js heartbeat --context 5
  node scripts/get_symbol_info.js atomicWrite --peek
  node scripts/get_symbol_info.js atomicWrite --peek 15
  node scripts/get_symbol_info.js atomicWrite --json

輸出說明:
  ✅ 找到 symbol
  📁 檔案:行號
  💡 描述
  🔍 Peek: 代碼快照（當使用 --peek 時）
  📍 建議範圍 (sed 命令)
`);
  process.exit(0);
}

// === 驗證 ===
if (!QUERY) {
  if (jsonMode) {
    console.log(JSON.stringify({ error: '請提供要查詢的 symbol 名稱' }, null, 2));
  } else {
    console.error('❌ 請提供要查詢的 symbol 名稱');
    console.error('   範例: node scripts/get_symbol_info.js atomicAppend');
  }
  process.exit(1);
}

// === 路徑設定 ===
const SCRIPTS_DIR = path.join(process.env.HOME, '.openclaw/workspace/scripts');
const SYMBOLS_FILE = path.join(SCRIPTS_DIR, 'SYMBOLS.md');
const STATE_DIR = path.join(SCRIPTS_DIR, '..', '.state');

// === Load Call Graph ===
let callGraph = { callGraph: {}, reverseCallGraph: {}, generatedAt: null };
try {
  const cgPath = path.join(STATE_DIR, 'SYMBOLS_CALLGRAPH.json');
  if (fs.existsSync(cgPath)) {
    callGraph = JSON.parse(fs.readFileSync(cgPath, 'utf8'));
  }
} catch (e) {}

// === Load Changes ===
let changes = null;
try {
  const chPath = path.join(STATE_DIR, 'SYMBOLS_CHANGES.json');
  if (fs.existsSync(chPath)) {
    changes = JSON.parse(fs.readFileSync(chPath, 'utf8'));
  }
} catch (e) {}

// === 讀取 SYMBOLS.md ===
let symbolsContent;
try {
  symbolsContent = fs.readFileSync(SYMBOLS_FILE, 'utf8');
} catch (e) {
  if (jsonMode) {
    console.log(JSON.stringify({
      error: '找不到 SYMBOLS.md',
      hint: `執行 'node ${path.join(SCRIPTS_DIR, 'generate_symbols.js')}' 生成`
    }, null, 2));
  } else {
    console.error(`❌ 找不到 SYMBOLS.md: ${SYMBOLS_FILE}`);
    console.error(`💡 提示: 運行 'node scripts/generate_symbols.js' 更新 SYMBOLS.md`);
  }
  process.exit(1);
}

// === 跳過 YAML frontmatter ===
let content = symbolsContent;
const frontmatterEnd = symbolsContent.indexOf('---', 3);
if (frontmatterEnd !== -1 && symbolsContent.startsWith('---')) {
  content = symbolsContent.slice(frontmatterEnd + 4);
}

// === 解析 Symbol 記錄 ===
// 新格式:
//   - Line LINE: `SYMBOL_NAME` TYPE
//   - 💡 DESCRIPTION

const symbolEntryRegex = /^- Line (\d+): `\/?([^`]+)\` ([^\s]+)\s*\n\s*- 💡 (.+)$/gm;
const symbols = [];
let match;

while ((match = symbolEntryRegex.exec(content)) !== null) {
  const [, lineNum, name, type, desc] = match;
  symbols.push({
    line: parseInt(lineNum, 10),
    name: name.replace(/\/$/, ''), // 移除結尾 /
    type: type,
    description: desc
  });
}

// === 為每個 matched symbol 找到對應的檔案 ===
const allSymbolMatches = [];
let currentFile = 'unknown';

content.split('\n').forEach((line, idx) => {
  // 檢查是否為 section header: ### `filename.js`
  const secMatch = line.match(/^### `([^`]+)`$/);
  if (secMatch) {
    currentFile = secMatch[1];
  }

  // 新格式: - Line LINE: `SYMBOL_NAME` TYPE (然後下一行是 - 💡 DESCRIPTION)
  const entryMatch = line.match(/^- Line (\d+): `\/?([^`]+)\` ([^\s]+)$/);
  if (entryMatch) {
    const nextLine = content.split('\n')[idx + 1] || '';
    const descMatch = nextLine.match(/^\s*- 💡 (.+)$/);
    const desc = descMatch ? descMatch[1] : '[無描述]';
    allSymbolMatches.push({
      line: parseInt(entryMatch[1], 10),
      name: entryMatch[2].replace(/\/$/, ''),
      type: entryMatch[3],
      description: desc,
      contentLine: idx + 1,
      file: currentFile
    });
  }
});

// === 搜尋匹配的 Symbol ===
const queryLower = QUERY.toLowerCase();
const matched = symbols.filter(s => s.name.toLowerCase().includes(queryLower));

// === 按相關性排序 ===
matched.sort((a, b) => {
  const aExact = a.name.toLowerCase() === queryLower;
  const bExact = b.name.toLowerCase() === queryLower;
  if (aExact && !bExact) return -1;
  if (!aExact && bExact) return 1;

  const aStarts = a.name.toLowerCase().startsWith(queryLower);
  const bStarts = b.name.toLowerCase().startsWith(queryLower);
  if (aStarts && !bStarts) return -1;
  if (!aStarts && bStarts) return 1;

  return a.name.length - b.name.length;
});

// 把 matched symbols 配上檔案
const results = matched.map(sym => {
  const found = allSymbolMatches.find(asm => asm.name === sym.name && asm.line === sym.line);
  if (found) {
    sym.file = found.file || 'unknown';
  } else {
    sym.file = 'unknown';
  }
  return sym;
});

// === 輸出結果 ===
function buildSedCommand(file, start, end) {
  return `sed -n '${start},${end}p' ${file}`;
}

function buildCatCommand(file, start, end) {
  return `cat -n ${file} | head -${end} | tail -${end - start + 1}`;
}

/**
 * 讀取代碼快照
 */
function readPeekSnapshot(filePath, lineNum, numLines) {
  try {
    const fullPath = path.join(SCRIPTS_DIR, filePath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const fileLines = content.split('\n');

    const start = Math.max(1, lineNum);
    const end = Math.min(fileLines.length, lineNum + numLines - 1);

    const snapshot = [];
    for (let i = start - 1; i < end; i++) {
      snapshot.push(`${i + 1}: ${fileLines[i]}`);
    }

    return snapshot.join('\n');
  } catch (e) {
    return `[無法讀取檔案: ${e.message}]`;
  }
}

if (jsonMode) {
  const result = results.map(s => ({
    name: s.name,
    file: s.file,
    line: s.line,
    type: s.type,
    description: s.description,
    range: { start: Math.max(1, s.line - CONTEXT_LINES), end: s.line + CONTEXT_LINES },
    sed: buildSedCommand(s.file, Math.max(1, s.line - CONTEXT_LINES), s.line + CONTEXT_LINES)
  }));
  console.log(JSON.stringify({ query: QUERY, count: matched.length, results: result }, null, 2));
  process.exit(0);
}

if (matched.length === 0) {
  if (!quietMode) {
    console.error(`❌ 未找到 symbol: ${QUERY}`);
    console.error(`💡 提示: 運行 'node scripts/generate_symbols.js' 更新 SYMBOLS.md`);
  } else {
    console.log(`NOT FOUND: ${QUERY}`);
  }
  process.exit(1);
}

if (results.length === 1) {
  const s = results[0];
  const start = Math.max(1, s.line - CONTEXT_LINES);
  const end = s.line + CONTEXT_LINES;

  // Clean name for call graph lookup (SYMBOLS.md stores "function name" format)
  const cleanSymName = s.name.replace(/^(?:function|arrow function|variable|class|const|let|var)\s+/i, '').trim();
  // Call graph info
  const callees = callGraph.callGraph[cleanSymName];
  const callers = callGraph.reverseCallGraph[cleanSymName];

  if (peekMode) {
    console.log(`✅ Symbol: ${s.name}`);
    console.log(`📍 Location: ${s.file}:${s.line}`);
    console.log(`💡 ${s.description}`);
    if (callers && callers.length > 0) console.log(`🔺 Called by: ${callers.join(', ')}`);
    if (callees && callees.length > 0) console.log(`🔻 Calls: ${callees.join(', ')}`);
    console.log(`🔍 Peek (${peekLines} lines):`);
    console.log(readPeekSnapshot(s.file, s.line, peekLines));
  } else if (quietMode) {
    console.log(`${s.name} ${s.file}:${s.line}`);
  } else {
    console.log(`✅ ${s.name}`);
    console.log(`📁 ${s.file}:${s.line}`);
    console.log(`💡 ${s.description}`);
    if (callers && callers.length > 0) {
      const short = callers.slice(0, 10);
      console.log(`🔺 Called by (${callers.length}): ${short.join(', ')}${callers.length > 10 ? '...' : ''}`);
    }
    if (callees && callees.length > 0) {
      const short = callees.slice(0, 10);
      console.log(`🔻 Calls (${callees.length}): ${short.join(', ')}${callees.length > 10 ? '...' : ''}`);
    }
    console.log(`📍 建議範圍: ${buildSedCommand(s.file, start, end)}`);
    console.log(`🔗 命令: ${buildCatCommand(s.file, start, end)}`);
  }
} else {
  if (!quietMode) {
    console.log(`🔍 找到 ${results.length} 個匹配的 symbols:`);
  }
  results.forEach((s, i) => {
    if (quietMode) {
      console.log(`${i + 1}. ${s.name} ${s.file}:${s.line}`);
    } else {
      console.log(`${i + 1}. ✅ ${s.name} (${s.file}:${s.line})`);
    }
  });
}
