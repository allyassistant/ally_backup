#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * 記憶提煉器
 * Memory Distiller
 *
 * 功能：自動從每日日誌提煉重要內容到 MEMORY.md
 * 執行頻率：每週一次（禮拜日）
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { MEMORY_DIR, atomicWriteSync } = require('./lib/config');
const { getHKTDate } = require('./lib/time');
const DAILY_DIR = path.join(MEMORY_DIR, '_daily');
const KNOWLEDGE_DIR = path.join(MEMORY_DIR, '_knowledge');
const ARCHIVE_DIR = path.join(MEMORY_DIR, '_archive');

// 關鍵詞定義（根據 MiniMax 設計）
const KEYWORDS = {
  high: {
    decision: ['決定', '今後', '以后', '不再', '改為', '改用', '採用', '放棄', '停止', '開始', '啟用', '停用'],
    error: ['不要再', '唔好再', '記住', '注意', '小心', '錯誤', '搞錯', '混淆', '修正', '更正', '不要用'],
    learning: ['學識', '學到', '學會', '發現', '掌握', '理解', '認識', '第一次', '新增'],
    client: ['偏好', '想要', '需要', '要求', '唔要']
  },
  medium: {
    commitment: ['答應', '承諾', '覆', '交貨'],
    todo: ['跟進', '聯繫', '處理', '安排'],
    price: ['成本', '報價', '價格', '價錢'],
    market: ['好賣', '趨勢', '市場', '行清']
  }
};

/**
 * 讀取 daily notes
 */
function getDailyNotes(days = 7) {
  const notes = [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  try {
    if (!fs.existsSync(DAILY_DIR)) return notes;
  } catch (e) {
    console.error('Error: ' + e.message);
    return notes;
  }

  let files;
  try {
    files = fs.readdirSync(DAILY_DIR)
      .filter(f => f.endsWith('.md'))
      .sort();
  } catch (e) {
    console.error('Error: ' + e.message);
    return notes;
  }

  for (const file of files) {
    const fileDate = file.replace('.md', '');
    // Validate filename format before parsing (YYYYMMDD)
    if (!/^\d{8}$/.test(fileDate)) continue;
    const year = parseInt(fileDate.substring(0, 4), 10);
    const month = parseInt(fileDate.substring(4, 6), 10) - 1;
    const day = parseInt(fileDate.substring(6, 8), 10);
    const date = new Date(year, month, day);
    // Validate the date is valid
    if (isNaN(date.getTime())) continue;

    if (date >= cutoff) {
      let content;
      try {
        content = fs.readFileSync(path.join(DAILY_DIR, file), 'utf8');
      } catch (e) {
        console.error('Error: ' + e.message);
        continue;
      }
      notes.push({
        file: file,
        date: fileDate,
        content: content
      });
    }
  }

  return notes;
}

// 預建關鍵詞查找表以優化性能 (O(n³) → O(n))
const KEYWORD_LOOKUP = (() => {
  const lookup = new Map();

  // 處理高優先級關鍵詞
  for (const [category, words] of Object.entries(KEYWORDS.high)) {
    for (const word of words) {
      lookup.set(word, { priority: 'high', category });
    }
  }

  // 處理中優先級關鍵詞
  for (const [category, words] of Object.entries(KEYWORDS.medium)) {
    for (const word of words) {
      // 高優先級覆蓋中優先級
      if (!lookup.has(word)) {
        lookup.set(word, { priority: 'medium', category });
      }
    }
  }

  return lookup;
})();

/**
 * 分析內容重要度
 * 優化版本：使用預建查找表，時間複雜度從 O(n³) 降至 O(n)
 */
function analyzeContent(content) {
  const findings = [];
  const lines = content.split('\n');
  const processedLines = new Set(); // 避免同一行重複匹配

  // 使用單遍掃描而非嵌套循環
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || processedLines.has(trimmedLine)) continue;

    // 單次遍歷所有關鍵詞
    for (const [word, meta] of KEYWORD_LOOKUP) {
      if (line.includes(word)) {
        findings.push({
          priority: meta.priority,
          category: meta.category,
          content: trimmedLine,
          keyword: word
        });
        processedLines.add(trimmedLine);
        break; // 每行只記錄第一個匹配的關鍵詞
      }
    }
  }

  return findings;
}

/**
 * 去重
 */
function deduplicate(findings) {
  const seen = new Set();
  return findings.filter(f => {
    const key = f.content.substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 分類內容
 */
function categorize(findings) {
  const categories = {
    errors: [],    // 錯誤教訓 → 強制規則
    decisions: [], // 業務決策 → 語義記憶
    learnings: [], // 新知識 → 語義記憶
    todos: [],     // 待辦 → 任務清單
    others: []     // 其他
  };

  for (const f of findings) {
    if (f.priority === 'high') {
      if (f.category === 'error') categories.errors.push(f);
      else if (f.category === 'decision') categories.decisions.push(f);
      else if (f.category === 'learning') categories.learnings.push(f);
      else categories.others.push(f);
    } else {
      if (f.category === 'commitment' || f.category === 'todo') categories.todos.push(f);
      else categories.others.push(f);
    }
  }

  return categories;
}

/**
 * 更新 MEMORY.md
 */
function updateMemory(categories) {
  const memoryPath = path.join(MEMORY_DIR, 'MEMORY.md');
  let memory;
  try {
    memory = fs.readFileSync(memoryPath, 'utf8');
  } catch (e) {
    console.error('Error: ' + e.message);
    return;
  }

  // 更新錯誤教訓（強制規則）
  if (categories.errors.length > 0) {
    const errorsSection = categories.errors.map(e => `- ${e.content}`).join('\n');
    // 喺適當位置插入
    memory = memory.replace(
      /## 強制規則/,
      `## 強制規則\n\n### 最新更新 (${getHKTDate()})\n${errorsSection}\n`
    );
  }

  // 更新業務決策（語義記憶）
  if (categories.decisions.length > 0) {
    const decisionsSection = categories.decisions.map(d => `- ${d.content}`).join('\n');
    memory = memory.replace(
      /## 業務決策/,
      `## 業務決策\n\n### ${getHKTDate()}\n${decisionsSection}\n`
    );
  }

  try {
    atomicWriteSync(memoryPath, memory);
  } catch (e) {
    console.error('Error: ' + e.message);
  }
}

/**
 * 歸檔文件
 */
function archiveNotes(notes) {
  const archiveMonth = path.join(ARCHIVE_DIR, getHKTDate().slice(0, 7));
  try {
    if (!fs.existsSync(archiveMonth)) {
      try {
        fs.mkdirSync(archiveMonth, { recursive: true });
      } catch (e) {
        console.error('Error: ' + e.message);
        return;
      }
    }
  } catch (e) {
    console.error('Error: ' + e.message);
    return;
  }

  for (const note of notes) {
    const src = path.join(DAILY_DIR, note.file);
    const dest = path.join(archiveMonth, note.file);

    try {
      if (fs.existsSync(src)) {
        // Validate note.file to prevent path traversal
        if (note.file.includes('..') || path.isAbsolute(note.file)) {
          console.error(`⚠️ Skipping invalid file name: ${note.file}`);
          continue;
        }
        try {
          fs.copyFileSync(src, dest);
        } catch (e) {
          console.error('Error: ' + e.message);
          continue;
        }
        // Use trash instead of unlink for safety
        try {
          execFileSync('trash', [src], { stdio: 'ignore' });
        } catch (e) {
          console.error('Error: ' + e.message);
          continue;
        }
      }
    } catch (e) {
      console.error('Error: ' + e.message);
      continue;
    }
  }
}

/**
 * 生成提煉報告
 */
function generateReport(notes, findings, categories) {
  const report = {
    date: getHKTDate(),
    period: `${notes[0]?.date || 'N/A'} ~ ${notes[notes.length - 1]?.date || 'N/A'}`,
    // Guard against empty notes array
    firstNoteDate: notes.length > 0 ? notes[0].date : 'N/A',
    lastNoteDate: notes.length > 0 ? notes[notes.length - 1].date : 'N/A',
    totalNotes: notes.length,
    extracted: {
      high: findings.filter(f => f.priority === 'high').length,
      medium: findings.filter(f => f.priority === 'medium').length
    },
    categories: {
      errors: categories.errors.length,
      decisions: categories.decisions.length,
      learnings: categories.learnings.length,
      todos: categories.todos.length
    },
    archived: notes.length
  };

  // 保存報告
  const reportPath = path.join(ARCHIVE_DIR, `distill-report-${report.date}.json`);
  try {
    atomicWriteSync(reportPath, JSON.stringify(report, null, 2));
  } catch (e) {
    console.error('Error: ' + e.message);
  }

  return report;
}

/**
 * 主函據
 */
function distill() {
  log('🔍 開始記憶提煉...\n');

  // 1. 收集
  const notes = getDailyNotes(7);
  log(`📄 收集到 ${notes.length} 篇日記`);

  if (notes.length === 0) {
    log('⚠️ 沒有日記需要提煉');
    return;
  }

  // 2. 分析
  let allFindings = [];
  for (const note of notes) {
    const findings = analyzeContent(note.content);
    allFindings = allFindings.concat(findings);
  }
  log(`💡 識別到 ${allFindings.length} 條重要內容`);

  // 3. 去重
  allFindings = deduplicate(allFindings);
  log(`🧹 去重後剩 ${allFindings.length} 條`);

  // 4. 分類
  const categories = categorize(allFindings);
  log(`\n📊 分類結果：`);
  log(`  - 錯誤教訓：${categories.errors.length}`);
  log(`  - 業務決策：${categories.decisions.length}`);
  log(`  - 新知識：${categories.learnings.length}`);
  log(`  - 待辦：${categories.todos.length}`);

  // 5. 更新 MEMORY.md
  updateMemory(categories);
  log('\n✅ 已更新 MEMORY.md');

  // 6. 歸檔
  archiveNotes(notes);
  log(`📦 已歸檔 ${notes.length} 篇日記`);

  // 7. 生成報告
  const report = generateReport(notes, allFindings, categories);
  log('\n📝 提煉報告：');
  log(JSON.stringify(report, null, 2));

  return report;
}

// CLI
if (require.main === module) {
  distill();
}

module.exports = { distill, getDailyNotes, analyzeContent };
