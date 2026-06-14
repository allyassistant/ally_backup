#!/usr/bin/env node
/**
 * cross_session_context.js
 * 跨 Session 分析摘要生成器
 *
 * 功能：讀取 memory/patterns/*.json，生成人類可讀的 context 摘要
 * 用法：node scripts/cross_session_context.js [--quiet]
 *
 * 作者：Ally (2026-04-03)
 */

const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  PATTERNS_DIR: path.join(process.env.HOME, '.openclaw/workspace/memory/patterns'),
  FILES: {
    errors: 'errors.json',
    projects: 'projects.json',
    periodic: 'periodic.json',
    'topic-graph': 'topic-graph.json'
  }
};

// Quiet mode
const _quiet = process.argv.includes('--quiet');

// Helper: log only if not quiet
function log(...args) {
  if (!_quiet) console.log(...args);
}

// Helper: warning log
function warn(...args) {
  console.warn(...args);
}

/**
 * 讀取 JSON 檔案，失敗時返回 null
 */
function readJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    warn(`⚠️  讀取失敗: ${filePath} - ${e.message}`);
    return null;
  }
}

/**
 * 確保目錄存在
 */
function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      log(`📁 已創建目錄: ${dir}`);
    }
  } catch (e) {
    console.error('Error creating directory: ' + e.message);
    return;
  }
}

/**
 * 格式化日期為 HKT
 */
function formatDate(dateStr) {
  if (!dateStr) return '未知';
  const date = new Date(dateStr);
  const hkt = new Date(date.getTime() + 8 * 60 * 60 * 1000); // Convert to HKT
  return hkt.toISOString().slice(0, 10).replace('T', ' ');
}

/**
 * 生成錯誤摘要
 */
function formatErrors(data) {
  if (!data || !data.errors || data.errors.length === 0) {
    return '  （暫無錯誤記錄）';
  }

  const lines = [];
  // 排序：按 count 降序
  const sorted = [...data.errors].sort((a, b) => b.count - a.count);

  // 只顯示前 10 個
  sorted.slice(0, 10).forEach(err => {
    const name = err.error_type.length > 30
      ? err.error_type.slice(0, 27) + '...'
      : err.error_type;
    const countStr = `出現 ${err.count} 次`;
    const lastSeen = `上次：${formatDate(err.last_seen)}`;
    lines.push(`  - ${name}：${countStr} | ${lastSeen}`);
  });

  return lines.join('\n');
}

/**
 * 生成項目摘要
 */
function formatProjects(data) {
  if (!data || !data.projects || data.projects.length === 0) {
    return '  （暫無項目記錄）';
  }

  const lines = [];

  // 分類：active vs completed
  const active = data.projects.filter(p => p.status === 'active');
  const completed = data.projects.filter(p => p.status === 'completed');

  // 顯示 active 項目（最多 5 個）
  active.slice(0, 5).forEach(proj => {
    let info = proj.name.length > 35
      ? proj.name.slice(0, 32) + '...'
      : proj.name;

    // 添加 issue ID
    if (proj.issue_id) {
      info += ` (#${proj.issue_id})`;
    }

    // 添加優先級
    if (proj.priority) {
      info += ` | ${proj.priority}`;
    }

    // 添加進度
    if (proj.progress) {
      info += ` | 進度: ${proj.progress}`;
    }

    info += ` | ${formatDate(proj.last_seen)}`;

    lines.push(`  📌 ${info}`);
  });

  // 顯示已完成項目數量
  if (completed.length > 0) {
    lines.push(`  ✅ 已完成項目: ${completed.length} 個`);
  }

  return lines.length > 0 ? lines.join('\n') : '  （暫無進行中項目）';
}

/**
 * 生成週期性 Pattern 摘要
 */
function formatPeriodic(data) {
  if (!data || !data.patterns || data.patterns.length === 0) {
    return '  （暫無週期性模式）';
  }

  const lines = [];

  // 找出 day_of_week patterns
  const weekly = data.patterns.filter(p => p.day_of_week);
  const weeklyByDay = {};

  weekly.forEach(p => {
    if (!weeklyByDay[p.day_of_week]) {
      weeklyByDay[p.day_of_week] = [];
    }
    weeklyByDay[p.day_of_week].push(p);
  });

  // 翻譯星期
  const dayNames = {
    'Monday': '週一',
    'Tuesday': '週二',
    'Wednesday': '週三',
    'Thursday': '週四',
    'Friday': '週五',
    'Saturday': '週六',
    'Sunday': '週日'
  };

  Object.entries(weeklyByDay).forEach(([day, patterns]) => {
    const dayName = dayNames[day] || day;
    patterns.forEach(p => {
      if (p.topic) {
        lines.push(`  每週${dayName}：討論 ${p.topic} 相關`);
      }
    });
  });

  return lines.length > 0 ? lines.join('\n') : '  （暫無週期性模式）';
}

/**
 * 生成 Topic 關聯圖摘要
 */
function formatTopicGraph(data) {
  if (!data || !data.edges || data.edges.length === 0) {
    return '  （暫無 Topic 關聯）';
  }

  const lines = [];

  // 排序：按 weight 降序，取前 5 個最強關聯
  const topEdges = [...data.edges]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  topEdges.forEach(edge => {
    lines.push(`  「${edge.from}」↔ 「${edge.to}」 (${edge.weight} 次共現)`);
  });

  // 添加 summary
  if (data.summary) {
    lines.push('');
    lines.push(`  📊 共 ${data.summary.total_nodes} 個 Topic，${data.summary.total_edges} 條關聯`);
  }

  return lines.join('\n');
}

/**
 * 主函數
 */
function main() {
  // 確保目錄存在
  ensureDir(CONFIG.PATTERNS_DIR);

  // 生成時間戳
  const now = new Date();
  const hkt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const timestamp = hkt.toISOString().replace('T', ' ').slice(0, 19) + ' HKT';

  // 讀取所有 JSON
  log('');
  log('╔════════════════════════════════════════════════════════╗');
  log('║           跨 Session 分析摘要                          ║');
  log(`║           Generated: ${timestamp}          ║`);
  log('╚════════════════════════════════════════════════════════╝');
  log('');

  // Errors
  log('📊 問題規律追蹤 (errors.json)');
  log('────────────────────────────────────────────────────────');
  const errorsData = readJson(path.join(CONFIG.PATTERNS_DIR, CONFIG.FILES.errors));
  log(formatErrors(errorsData));
  log('');

  // Projects
  log('📁 項目追蹤 (projects.json)');
  log('────────────────────────────────────────────────────────');
  const projectsData = readJson(path.join(CONFIG.PATTERNS_DIR, CONFIG.FILES.projects));
  log(formatProjects(projectsData));
  log('');

  // Periodic
  log('📅 週期性模式 (periodic.json)');
  log('────────────────────────────────────────────────────────');
  const periodicData = readJson(path.join(CONFIG.PATTERNS_DIR, CONFIG.FILES.periodic));
  log(formatPeriodic(periodicData));
  log('');

  // Topic Graph
  log('🔗 Topic 關聯圖 (topic-graph.json)');
  log('────────────────────────────────────────────────────────');
  const topicGraphData = readJson(path.join(CONFIG.PATTERNS_DIR, CONFIG.FILES['topic-graph']));
  log(formatTopicGraph(topicGraphData));
  log('');

  // Footer
  log('─'.repeat(62));
  log('💡 提示：運行 `node scripts/cross_session_bootstrap.js` 可生成');
  log('   可載入的 context（寫入 .cross_session_context.md）');
  log('');
}

// Run
main();
