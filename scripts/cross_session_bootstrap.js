#!/usr/bin/env node
/**
 * cross_session_bootstrap.js
 * Session Reset 恢復腳本
 *
 * 功能：
 * - 讀取 memory/patterns/*.json
 * - 生成可載入的 context 寫入 .cross_session_context.md
 *
 * 用法：node scripts/cross_session_bootstrap.js [--quiet]
 *
 * 作者：Ally (2026-04-03)
 * v3.0 — 加 handoff placeholders（compaction contract alignment）
 */

const fs = require('fs');
const path = require('path');
const MAX_HANDOFF_SIZE = 20480; // bytes — max .session_handoff.md before truncation

// Configuration
const CONFIG = {
  PATTERNS_DIR: path.join(process.env.HOME, '.openclaw/workspace/memory/patterns'),
  KNOWLEDGE_DIR: path.join(process.env.HOME, '.openclaw/workspace/memory/knowledge'),
  MEMORY_FILE: path.join(process.env.HOME, '.openclaw/workspace/MEMORY.md'),
  OUTPUT_FILE: path.join(process.env.HOME, '.openclaw/workspace/.cross_session_context.md'),
  HANDOFF_FILE: path.join(process.env.HOME, '.openclaw/workspace/.session_handoff.md'),
  DASHBOARD_META: path.join(process.env.HOME, '.openclaw/workspace/_dashboard_metadata.json'),
  DASHBOARD_SCRIPT: path.join(process.env.HOME, '.openclaw/workspace/scripts/startup_dashboard.js'),
  FILES: {
    errors: 'errors.json',
    projects: 'projects.json',
    periodic: 'periodic.json',
    'topic-graph': 'topic-graph.json'
  },
  CORRECTION_SUGGESTIONS: path.join(process.env.HOME, '.openclaw/workspace/memory', 'correction_suggestions.json'),
  HKT_OFFSET_MS: 8 * 60 * 60 * 1000
};

// Quiet mode
const _quiet = process.argv.includes('--quiet');

// Helper: log only if not quiet
function log() {
  if (!_quiet) console.log.apply(console, arguments);
}

// Helper: warning log
function warn() {
  console.warn.apply(console, arguments);
}

/**
 * 讀取 JSON 檔案，失敗時返回 null
 */
function readJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    warn('Warning: 讀取失敗: ' + filePath + ' - ' + e.message);
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
      log('Info: 已創建目錄: ' + dir);
    }
  } catch (e) {
    if (e.code === 'EEXIST') {
      // Directory already exists, ignore
      return;
    }
    console.error('Error creating directory: ' + e.message);
    return;
  }
}

/**
 * 格式化日期
 */
function formatDate(dateStr) {
  if (!dateStr) return '未知';
  const date = new Date(dateStr);
  return date.toISOString().slice(0, 10);
}

/**
 * 生成系統健康 section
 * 顯示 cron job 狀態 + 基本系統指標
 */
/**
 * 生成系統健康 section
 * 顯示 cron job 狀態 + 基本系統指標 + 異常提醒
 */
function generateSystemHealth() {
  const { execSync } = require('child_process');
  let section = '## 系統健康\n\n';
  let alerts = [];

  // === Cron Jobs Status ===
  try {
    const stdout = execSync('openclaw cron list --json 2>/dev/null', {
      timeout: 10000, encoding: 'utf8', maxBuffer: 1024 * 50
    });
    const parsed = JSON.parse(stdout);
    const jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || []);

    const total = jobs.length;
    const failed = jobs.filter(j => (j.state || {}).lastRunStatus === 'error' || ((j.state || {}).consecutiveErrors || 0) > 0);
    const ok = total - failed.length;

    const failedIcon = failed.length === 0 ? '✅' : '⚠️';
    section += `**🕐 Cron Jobs** ${failedIcon} ${ok}/${total} 正常\n\n`;

    if (failed.length > 0) {
      section += '**異常 jobs：**\n';
      failed.forEach(function(j) {
        const state = j.state || {};
        const errMsg = (state.lastError || 'Unknown error').slice(0, 100);
        section += '- 🔴 **' + (j.name || 'unknown') + '**：' + errMsg + '\n';
        alerts.push('⚠️ Cron job "' + j.name + '\' 有異常');
      });
      section += '\n';
    }
  } catch (e) {
    section += '**🕐 Cron Jobs** ⚠️ 無法查詢狀態\n\n';
  }

  // === System Metrics ===
  try {
    const disk = execSync('df -h / 2>/dev/null | tail -1', { timeout: 5000, encoding: 'utf8' });
    const diskParts = disk.trim().split(/\s+/);
    if (diskParts.length >= 5) {
      const diskUsed = diskParts[4];
      const diskFree = diskParts[3];
      const diskPct = parseInt(diskUsed);
      const diskIcon = diskPct > 85 ? '⚠️' : '✅';
      section += `**💾 磁碟** ${diskIcon} ${diskUsed} 已用（${diskFree} 可用）\n\n`;
      if (diskPct > 85) alerts.push('⚠️ 磁碟使用率 ' + diskUsed + '，需要清理');
    }
  } catch (e) {}

  // === Issues Due Soon ===
  try {
    const issuesDir = path.join(process.env.HOME, '.openclaw/workspace/.issues/active');
    if (fs.existsSync(issuesDir)) {
      const files = fs.readdirSync(issuesDir);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      files.forEach(function(f) {
        if (!f.endsWith('.md')) return;
        const raw = fs.readFileSync(path.join(issuesDir, f), 'utf8');
        const dueMatch = raw.match(/^due:\s*(\d{4}-\d{2}-\d{2})/m);
        if (!dueMatch) return;
        const dueDate = new Date(dueMatch[1] + 'T00:00:00');
        const diffDays = Math.floor((dueDate - today) / (24 * 60 * 60 * 1000));
        const idMatch = raw.match(/^id:\s*(\d+)/m);
        const titleMatch = raw.match(/^title:\s*(.+)/m);
        const id = idMatch ? '#' + idMatch[1] : '';
        const title = titleMatch ? titleMatch[1].trim() : f.replace(/-/g, ' ').replace('.md', '');

        // Skip issues overdue by more than 14 days (likely abandoned)
        if (diffDays < -14) return;

        if (diffDays < 0) {
          alerts.push('🔴 Issue ' + id + ' "' + title + '" 已過期 ' + Math.abs(diffDays) + ' 日');
        } else if (diffDays === 0) {
          alerts.push('🟡 Issue ' + id + ' "' + title + '" 今日到期');
        } else if (diffDays <= 3) {
          alerts.push('🟢 Issue ' + id + ' "' + title + '" ' + diffDays + ' 日後到期');
        }
      });
    }
  } catch (e) {
    // Ignore issues dir errors
  }

  // === Proactive Alert Banner ===
  if (alerts.length > 0) {
    section += '**🔔 需要關注：**\n';
    alerts.forEach(function(a) {
      section += '- ' + a + '\n';
    });
    section += '\n';
  }

  return section;
}

/**
 * 生成項目 section
 */
function generateProjectsSection(data) {
  if (!data || !data.projects || data.projects.length === 0) {
    return '## 項目追蹤\n\n（暫無項目記錄）\n';
  }

  let section = '## 項目追蹤\n\n';

  const active = data.projects.filter(function(p) { return p.status === 'active'; });
  const completed = data.projects.filter(function(p) { return p.status === 'completed'; });

  // Active 項目
  if (active.length > 0) {
    section += '### 進行中\n\n';
    active.slice(0, 10).forEach(function(proj) {
      let line = '- **' + proj.name + '**';
      if (proj.issue_id) line += ' (#' + proj.issue_id + ')';
      if (proj.priority) line += ' | ' + proj.priority;
      if (proj.progress) line += ' | 進度: ' + proj.progress;
      line += ' | ' + formatDate(proj.last_seen);
      section += line + '\n';
    });
    section += '\n';
  }

  // Completed 項目
  if (completed.length > 0) {
    section += '### 已完成（' + completed.length + ' 個）\n\n';
    completed.slice(0, 5).forEach(function(proj) {
      section += '- ' + proj.name + ' | ' + formatDate(proj.last_seen) + '\n';
    });
    section += '\n';
  }

  return section;
}

/**
 * 生成週期性 Pattern section
 */
function generatePeriodicSection(data) {
  if (!data || !data.patterns || data.patterns.length === 0) {
    return '## 週期性模式\n\n（暫無週期性模式）\n';
  }

  let section = '## 週期性模式\n\n';

  const weekly = data.patterns.filter(function(p) { return p.day_of_week; });
  const weeklyByDay = {};

  weekly.forEach(function(p) {
    if (!weeklyByDay[p.day_of_week]) {
      weeklyByDay[p.day_of_week] = [];
    }
    weeklyByDay[p.day_of_week].push(p);
  });

  const dayNames = {
    'Monday': '每週一',
    'Tuesday': '每週二',
    'Wednesday': '每週三',
    'Thursday': '每週四',
    'Friday': '每週五',
    'Saturday': '每週六',
    'Sunday': '每週日'
  };

  Object.entries(weeklyByDay).forEach(function(entry) {
    const day = entry[0];
    const patterns = entry[1];
    const dayName = dayNames[day] || day;
    const topics = [...new Set(patterns.map(function(p) { return p.topic; }).filter(Boolean))];
    if (topics.length > 0) {
      section += '- ' + dayName + '：討論 ' + topics.join('、') + ' 相關\n';
    }
  });

  section += '\n';
  return section;
}

/**
 * 生成 Topic 關聯 section
 */
function generateTopicGraphSection(data) {
  if (!data || !data.nodes) {
    return '## Topic 關聯圖\n\n（暫無 Topic 關聯）\n';
  }

  let section = '## Topic 關聯圖\n\n';

  // Top nodes by count
  const topNodes = Object.entries(data.nodes)
    .sort(function(a, b) { return b[1].count - a[1].count; })
    .slice(0, 8);

  section += '### 熱門 Topic\n\n';
  topNodes.forEach(function(entry) {
    const name = entry[0];
    const info = entry[1];
    section += '- **' + name + '**：`' + info.count + '` 次討論\n';
  });

  // Top edges by weight
  if (data.edges && data.edges.length > 0) {
    section += '\n### 強關聯 Topic Pair\n\n';
    const topEdges = [...data.edges]
      .sort(function(a, b) { return b.weight - a.weight; })
      .slice(0, 5);

    topEdges.forEach(function(edge) {
      section += '- `' + edge.from + '` <-> `' + edge.to + '`：`' + edge.weight + '` 次共現\n';
    });
  }

  section += '\n';
  return section;
}

/**
 * 掃描 knowledge 目錄，生成知識摘要 Markdown
 */


/**
 * 掃描 knowledge 目錄，生成知識摘要
 */
function generateKnowledgeSection() {
  let section = '## 🧠 知識庫摘要\n\n';

  const categories = ['preferences', 'decisions', 'people'];
  let hasContent = false;

  categories.forEach(function(cat) {
    const catDir = path.join(CONFIG.KNOWLEDGE_DIR, cat);
    if (!fs.existsSync(catDir)) return;

    let files;
    try {
      files = fs.readdirSync(catDir).filter(function(f) { return f.endsWith('.md'); });
    } catch (e) {
      console.error(`Operation failed: ${e.message}`);
      return;
    }
    if (!files || files.length === 0) return;
    hasContent = true;

    const catNames = {
      preferences: '偏好設定',
      decisions: '重要決定',
      people: '人物關係'
    };
    section += '### ' + (catNames[cat] || cat) + '\n\n';

    files.forEach(function(file) {
      const filePath = path.join(catDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(function(l) { return l.trim() && !l.startsWith('#'); });
        const name = file.replace(/\.md$/, '').replace(/-/g, ' ');
        section += '- **' + name + '**: ' + (lines[0] || '').replace(/^[*\-\s]+/, '') + '\n';
      } catch (e) {
        // skip unreadable
      }
    });

    section += '\n';
  });

  if (!hasContent) {
    section += '（暫無知識庫內容）\n\n';
  }

  return section;
}

/**
 * 生成完整的 Markdown
 */
function generateCorrectionSection() {
  const CORRECTION_SUGGESTIONS = path.join(process.env.HOME, '.openclaw/workspace/memory', 'correction_suggestions.json');
  try {
    if (!fs.existsSync(CORRECTION_SUGGESTIONS)) return '';
    const raw = fs.readFileSync(CORRECTION_SUGGESTIONS, 'utf8').trim();
    if (!raw) return '';
    const data = JSON.parse(raw);
    if (!data.suggestions || data.suggestions.length === 0) return '';

    let section = '## 💡 行為改善建議\n\n';
    section += '> 由 Weekly Correction Loop 自動生成 (' + (data.generatedAt || '') + ')\n\n';
    for (const s of data.suggestions) {
      const icon = s.severity === 'HIGH' ? '🔴' : s.severity === 'MEDIUM' ? '🟡' : '🟢';
      section += icon + ' **' + s.title + '**\n';
      if (s.detail) section += '   ' + s.detail + '\n';
      section += '\n';
    }
    section += '> 如需修改 AGENTS.md，請手動編輯。\n\n';
    return section;
  } catch (e) {
    return '';
  }
}

/**
 * 讀取最新嘅 L0 Abstract（200字精華摘要）
 * 為 session start 提供快速 context，避免直接讀 L2 raw data
 */
/**
 * 漸進讀取記憶層：L0 → L1 → L2
 * L0 最好（~200字摘要），冇就試 L1（~600字概述），再冇就讀 L2 raw data
 */
function readMemoryLayerByLayer() {
  const memoryDir = path.join(process.env.HOME, '.openclaw/workspace', 'memory');
  const datePattern = /^\d{4}-\d{2}-\d{2}\.md$/;

  // Helper: read file body (skip header, take bullet lines)
  function readBody(filePath, maxLines) {
    let raw = '';
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
      return '';
    }
    if (!raw) return '';
    const lines = raw.split('\n');
    return lines.filter(function(l) { return l.startsWith('* ') || l.startsWith('\u2694') || l.startsWith('---') || l.startsWith('\u26a0'); })
      .slice(0, maxLines).join('\n');
  }

  // Get latest date files from a directory
  function latestFiles(dir, count) {
    if (!fs.existsSync(dir)) return [];
    try {
      const files = fs.readdirSync(dir);
      return files
        .filter(function(f) { return datePattern.test(f); })
        .sort().reverse()
        .slice(0, count)
        .map(function(f) { return { name: f.replace('.md', ''), path: path.join(dir, f) }; });
    } catch (e) {
      console.error(`Operation failed: ${e.message}`);
      return [];
    }
  }

  // === Layer 1: L0 Abstract (~200 chars) ===
  function countBullets(str) {
    return (str.match(/^\s*\*/gm) || []).length;
  }

  const l0Dir = path.join(memoryDir, 'l0-abstract');
  let files = latestFiles(l0Dir, 2);
  let content = '';
  if (files.length > 0) {
    for (let i = 0; i < files.length; i++) {
      const body = readBody(files[i].path, 10);
      if (body) content += '### ' + files[i].name + '\n' + body + '\n\n';
    }
  }

  // Dynamic days: if 2 days has < 5 bullet points, try 3rd day
  if (countBullets(content) < 5) {
    const thirdFile = latestFiles(l0Dir, 3);
    if (thirdFile.length > files.length) {
      const extra = thirdFile[files.length]; // The 3rd file
      const body = readBody(extra.path, 10);
      if (body) {
        log(`[BOOTSTRAP] L0 content thin (${countBullets(content)} bullets), extending to include ${extra.name}`);
        content += '### ' + extra.name + '\n' + body + '\n\n';
      }
    }
  }

  if (content) {
    log(`[BOOTSTRAP] Using L0 Abstract (${countBullets(content)} bullets)`);
    content += '> 💡 需要更多 context？可用 `read memory/l1-overview/` 睇 L1 詳細版，或 `read memory/YYYY-MM-DD-HHMM.md` 睇 L2 原始記錄\n';
    return '## 近期摘要 (L0)\n' + content;
  }

  // === Layer 2: L1 Overview (~600 chars) ===
  const l1Dir = path.join(memoryDir, 'l1-overview');
  files = latestFiles(l1Dir, 2);
  if (files.length > 0) {
    let content = '';
    for (let i = 0; i < files.length; i++) {
      const body = readBody(files[i].path, 15);
      if (body) content += '### ' + files[i].name + '\n' + body + '\n\n';
    }
    if (content) {
      log('[BOOTSTRAP] L0 unavailable, falling back to L1 Overview');
      return '## 近期摘要 (L1 - L0 fallback)\n' + content;
    }
  }

  // === Layer 3: L2 Raw data (last resort) ===
  log('[BOOTSTRAP] L0 + L1 unavailable, falling back to L2 raw data');
  try {
    const l2Files = fs.readdirSync(memoryDir)
      .filter(function(f) { return /^\d{4}-\d{2}-\d{2}-\d{4}\.md$/.test(f); })
      .sort().reverse()
      .slice(0, 3);
    if (l2Files.length === 0) return '';
    let content = '';
    for (let i = 0; i < l2Files.length; i++) {
      const raw = fs.readFileSync(path.join(memoryDir, l2Files[i]), 'utf8');
      const lines = raw.split('\n').filter(function(l) { return l.includes('[MAIN]'); }).slice(0, 8).join('\n');
      if (lines) content += '### ' + l2Files[i].replace('.md', '') + '\n' + lines + '\n\n';
    }
    return content ? '## 近期摘要 (L2 - raw data fallback)\n' + content : '';
  } catch (e) {
    log('[WARN] Failed to read L2: ' + e.message);
    return '';
  }
}

function generateMarkdown() {
  const now = new Date();
  const hkt = new Date(now.getTime() + CONFIG.HKT_OFFSET_MS);
  const timestamp = hkt.toISOString().slice(0, 10);

  let md = '';
  md += '# 跨 Session 與下文恢復\n\n';
  md += '> **自動生成**：' + timestamp + ' | 由 cross_session_bootstrap.js 生成\n\n';
  md += '---\n\n';

  // === ESSENTIAL: L0 Abstract (with L1/L2 fallback hint) ===
  const l0Section = readMemoryLayerByLayer();
  if (l0Section) {
    md += l0Section + '\n';
  }
  md += '---\n\n';

  // === ESSENTIAL: Correction Suggestions (from session analysis) ===
  const corrSection = generateCorrectionSection();
  if (corrSection) {
    md += corrSection + '\n';
    md += '---\n\n';
  }

  // === ESSENTIAL: Knowledge section (context from workspace knowledge) ===
  const knSection = generateKnowledgeSection();
  if (knSection) {
    md += knSection + '\n';
    md += '---\n\n';
  }

  // === ESSENTIAL: System Health + Alerts ===
  md += generateSystemHealth();
  md += '---\n\n';

  // === ESSENTIAL: Active Issues (clean, only active/unexpired) ===
  // NOTE: no trailing --- here — generateHandoffPlaceholders() provides its own
  // === DASHBOARD: Session context status ===
  md += generateDashboardStatus();
  md += '---\n\n';

  // === ESSENTIAL: Active Issues (clean, only active/unexpired) ===
  // NOTE: no trailing --- here - generateHandoffPlaceholders() provides its own
  md += generateActiveIssuesSection();
  md += '\n\n';

  return md;
}

/**
 * Dashboard status: check if session context metadata is persisted.
 * Guides the model on whether --auto-persist is needed.
 */
function generateDashboardStatus() {
  let section = "## Session Dashboard\n\n";

  try {
    const { execSync } = require("child_process");
    const result = execSync("node " + CONFIG.DASHBOARD_SCRIPT, {
      timeout: 10000,
      encoding: "utf8",
      cwd: path.dirname(CONFIG.DASHBOARD_SCRIPT)
    });
    const clean = result
      .replace(/\x1b\[[0-9;]*m/g, "")
      .split("\n")
      .filter(function(l) { return l.trim(); })
      .slice(0, 25)
      .join("\n  ");
    section += "  " + clean + "\n\n";
  } catch (e) {
    section += "> Run \`node scripts/startup_dashboard.js\` for briefing\n\n";
  }

  return section;
}
/**
 * Compact active issues section
 */
function generateActiveIssuesSection() {
  const issuesDir = path.join(process.env.HOME, '.openclaw/workspace/.issues/active');
  let section = '## 進行中 Tasks\n\n';
  let count = 0;
  try {
    if (!fs.existsSync(issuesDir)) {
      section += '（暫無進行中任務）\n';
      return section;
    }
    const files = fs.readdirSync(issuesDir).filter(function(f) { return f.endsWith('.md'); });
    files.sort().forEach(function(f) {
      const raw = fs.readFileSync(path.join(issuesDir, f), 'utf8');
      const idMatch = raw.match(/^id:\s*(\d+)/m);
      const titleMatch = raw.match(/^title:\s*(.+)/m);
      const prioMatch = raw.match(/^priority:\s*(P[0-3])/im);
      const dueMatch = raw.match(/^due:\s*(\d{4}-\d{2}-\d{2})/m);
      const statusMatch = raw.match(/^status:\s*(\w+)/im);

      if (statusMatch && statusMatch[1].toLowerCase() === 'completed') return;

      const id = idMatch ? '#' + idMatch[1] : '';
      const title = titleMatch ? titleMatch[1].trim() : f.replace(/-/g, ' ').replace('.md', '');
      const prio = prioMatch ? prioMatch[1] : '';
      const due = dueMatch ? dueMatch[1] : '';

      const prioIcon = prio === 'P1' ? '🔴' : prio === 'P2' ? '🟡' : prio === 'P3' ? '🟢' : '';
      const dueText = due ? ' (due ' + due + ')' : '';

      section += '- ' + prioIcon + ' ' + id + ' ' + title + dueText + '\n';
      count++;
    });
    if (count === 0) section += '（暫無進行中任務）\n';
  } catch (e) {
    section += '（讀取失敗）\n';
  }
  return section;
}

/**
 * Compact periodic section — show only if patterns exist
 */
function generateCompactPeriodic(data) {
  if (!data || !data.patterns || data.patterns.length === 0) return '';
  const patterns = data.patterns.slice(0, 3);
  let sec = '**📊 模式**：';
  patterns.forEach(function(p, i) {
    sec += p.description || p.pattern || '';
    if (i < patterns.length - 1) sec += ' | ';
  });
  return sec + '\n\n';
}

/**
 * Compact topic graph — single line with top 5 topics + top 3 edges
 */
function generateCompactTopicGraph(data) {
  if (!data || !data.nodes || Object.keys(data.nodes).length === 0) return '';

  // Top 5 topics by count
  const entries = Object.entries(data.nodes);
  entries.sort(function(a, b) { return (b[1].count || 0) - (a[1].count || 0); });
  const top = entries.slice(0, 5).map(function(e) { return e[0] + ' (' + (e[1].count || 0) + ')'; });

  // Top 3 edges
  let edgesText = '';
  if (data.edges && data.edges.length > 0) {
    const edgeList = data.edges.slice(0, 3).map(function(e) {
      return (e.from || e.source || '?') + ' ↔ ' + (e.to || e.target || '?');
    });
    edgesText = ' | ' + edgeList.join(', ');
  }

  return '**🔗 熱門話題**：' + top.join(', ') + edgesText + '\n\n';
}

/**
 * 主函數
 */
function main() {
  // 確保目錄存在
  ensureDir(CONFIG.PATTERNS_DIR);

  log('');
  log('跨 Session 與下文恢復生成器');
  log('----------------------------------------');

  // 讀取所有 JSON
  const errorsData = readJson(path.join(CONFIG.PATTERNS_DIR, CONFIG.FILES.errors));
  const projectsData = readJson(path.join(CONFIG.PATTERNS_DIR, CONFIG.FILES.projects));
  const periodicData = readJson(path.join(CONFIG.PATTERNS_DIR, CONFIG.FILES.periodic));
  const topicGraphData = readJson(path.join(CONFIG.PATTERNS_DIR, CONFIG.FILES['topic-graph']));

  // 統計讀取狀態
  let loadedCount = 0;
  if (errorsData) loadedCount++;
  if (projectsData) loadedCount++;
  if (periodicData) loadedCount++;
  if (topicGraphData) loadedCount++;

  log('Info: 已載入 ' + loadedCount + '/4 個 Pattern 檔案');
  log('');

  // 生成 Markdown (auto sections + handoff placeholder)
  const markdown = generateMarkdown() + generateHandoffPlaceholders();

  // 寫入檔案 (atomic write pattern with cleanup)
  const tmpPath = CONFIG.OUTPUT_FILE + '.tmp';
  try {
    fs.writeFileSync(tmpPath, markdown, 'utf8');
    fs.renameSync(tmpPath, CONFIG.OUTPUT_FILE);
    log('OK: 已寫入: ' + CONFIG.OUTPUT_FILE);
  } catch (e) {
    // Cleanup tmp file on failure
    try {
      fs.unlinkSync(tmpPath);
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }
    console.error('Error: ' + e.message);
    return;
  }

  log('');
  log('Hint:');
  log('   - 呢個檔案可以用喺 Session Reset 後恢復與下文');
  log('   - 可以 append 到 SOUL.md 或喺回復前讀取');
  log('');
}

// ============================================================
// v3.0: Handoff Placeholders — compaction contract headings
// ============================================================

/**
 * Generate compaction contract handoff section.
 * - If `.session_handoff.md` exists → inject it (preserve task continuity)
 * - If not → return empty placeholder (first run / no previous session)
 * Reference: AGENTS.md — 🧠 Compaction Contract
 */
function generateHandoffPlaceholders() {
  // Try reading existing handoff first
  try {
    if (fs.existsSync(CONFIG.HANDOFF_FILE)) {
      const stats = fs.statSync(CONFIG.HANDOFF_FILE);
      if (stats.size > MAX_HANDOFF_SIZE) {
        warn('   ⚠️ .session_handoff.md exceeds 20KB — truncating via fallback placeholder');
        return fallbackHandoff();
      }
      const content = fs.readFileSync(CONFIG.HANDOFF_FILE, 'utf8').trim();
      if (content && (content.includes('## 當前目標') || content.includes('### 當前目標'))) {
        // Strip frontmatter boundaries (---) to avoid double separators
        const clean = content.replace(/^---[\s\S]*?---\n*/g, '').trim();
        return `\n---\n${clean}\n`;
      }
      // Invalid structure — warn but inject anyway as degraded fallback
      warn('   ⚠️ .session_handoff.md has unexpected structure (missing ## 當前目標). Injecting as-is.');
      const clean = content.replace(/^---[\s\S]*?---\n*/g, '').trim();
      return `\n---\n${clean}\n`;
    }
  } catch (e) { /* ignore read error, fallback to placeholder */ }

  return fallbackHandoff();
}

/**
 * Fallback: return empty placeholder headings so the structure is visible.
 * Used on first run or when handoff file is missing/invalid.
 */
function fallbackHandoff() {
  return `
---

## 💡 手動 Handoff（由 Ally 喺 session end 填寫）
> 參考 AGENTS.md Compaction Contract 格式，保留任務連續性。

## 當前目標
（上個 session 未完成 — 由 Ally 喺 session end 時填）

## 關鍵事實
（重要 exact facts — 由 Ally 喺 session end 時填）

## 進行中任務
（pending tasks — 由 Ally 喺 session end 時填）

## 審批狀態
（如有 — 由 Ally 喺 session end 時填）

## 建議下一步
（next recommended step — 由 Ally 喺 session end 時填）
`;
}

// Run
main();
