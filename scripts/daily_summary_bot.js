#!/usr/bin/env node
/**
 * Daily Summary Generator (Discord Bot API 版)
 * - 改用 MiniMax M2.5 生成內容 (2026-05-08)
 * - 保留 Apple Notes 創建
 * - 改用 Discord Bot API 直接發送
 * - 整合 ReportGenerator (2026-03-23)
 *
 * 改動 (2026-03-19):
 * - 參考 Bliss daily_weather.js
 *
 * 改動 (2026-03-23):
 * - 整合 ReportGenerator (Discord Embed)
 *
 * 改動 (2026-05-08):
 * - 由 DeepSeek V4 Flash 轉為 MiniMax M2.5 via OpenClaw CLI
 * - 新 system prompt：專注工作記錄，唔好編造感受
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { createDailySummary, checkNoteExists } = require('./apple_notes.js');
const { formatDate } = require('./report_templates.js');
const ReportGenerator = require('./report_generator.js');

const { MEMORY_DIR, OPENCLAW_CONFIG } = require('./lib/config');
const LOCK_FILE = path.join(MEMORY_DIR, 'daily_summary.lock');

// Discord channel ID (#📕日記)
const CHANNEL_ID = "1473386222998130860";

// Module-level quiet mode
let _quietMode = false;

// Config for MiniMax via OpenClaw CLI
const MINIMAX_TIMEOUT_MS = 180000;
const MINIMAX_CONFIG = {
  model: 'minimax-portal/MiniMax-M2.7',
  timeoutMs: MINIMAX_TIMEOUT_MS,
  cmd: 'openclaw'
};

async function getDiscordToken() {
    const configPath = OPENCLAW_CONFIG;
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config.channels.discord.token;
    } catch (err) {
        console.error('Failed to read Discord token: ' + err.message);
        throw err;
    }
}

async function sendDiscord(msg) {
    const token = await getDiscordToken();

    const options = {
        hostname: 'discord.com',
        path: '/api/v10/channels/' + CHANNEL_ID + '/messages',
        method: 'POST',
        headers: {
            'Authorization': 'Bot ' + token,
            'Content-Type': 'application/json'
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode === 200 || res.statusCode === 204) {
                    if (!_quietMode) console.log('已發送到 Discord #📕日記');
                    resolve({ status: res.statusCode });
                } else {
                    reject(new Error('HTTP ' + res.statusCode + ': ' + data));
                }
            });
        });
        req.on('error', reject);

        const payload = typeof msg === 'string'
            ? { content: msg }
            : { embeds: [msg] };

        req.write(JSON.stringify(payload));
        req.end();
    });
}

function getTodayDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' });
}

function getDisplayDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return year + '年' + parseInt(month) + '月' + parseInt(day) + '日';
}

async function readTodayMemory(date) {
  try {
    const allFiles = await fs.promises.readdir(MEMORY_DIR);
    const filteredFiles = allFiles
      .filter(f => f.startsWith(date) && f.endsWith('.md') && !f.startsWith('discord-channels'));

    const filesWithStats = await Promise.all(
      filteredFiles.map(async f => ({
        name: f,
        path: path.join(MEMORY_DIR, f),
        mtime: (await fs.promises.stat(path.join(MEMORY_DIR, f))).mtime.getTime()
      }))
    );

    filesWithStats.sort((a, b) => b.mtime - a.mtime);

    if (filesWithStats.length > 0) {
      const content = await fs.promises.readFile(filesWithStats[0].path, 'utf8');
      if (!_quietMode) console.log('Using memory file: ' + filesWithStats[0].name);
      return content;
    }
    return null;
  } catch (err) {
    console.error('readTodayMemory error: ' + err.message);
    return null;
  }
}

// 用 MiniMax M2.5 生成日記 (v5 OpenClaw CLI 版)
async function generateJournalWithMiniMax(date) {
  const { execFileSync } = require('child_process');

  const systemPrompt = '你係專業嘅每日工作記錄員，記錄 Josh 既日常工作。\n\n'
    + '要求：\n'
    + '- 專注完成既任務、結果、同跟進事項\n'
    + '- 每項要注明：做咗咩、結果如何、有冇下一步\n'
    + '- 如果冇具體任務，就保持簡潔\n'
    + '- 唔好編造感受、夢境、或者詩意描述\n'
    + '- 用繁體中文（香港用語）\n'
    + '- 總長度 300-500 字';

  let files;
  try {
    const allFiles = await fs.promises.readdir(MEMORY_DIR);
    const filteredFiles = allFiles
      .filter(f => f.startsWith(date) && f.endsWith('.md') && !f.startsWith('discord-channels'));

    files = await Promise.all(
      filteredFiles.map(async f => ({
        path: path.join(MEMORY_DIR, f),
        mtime: (await fs.promises.stat(path.join(MEMORY_DIR, f))).mtime.getTime()
      }))
    );
    files.sort((a, b) => b.mtime - a.mtime);
  } catch (err) {
    console.error('Failed to list memory files: ' + err.message);
    return { entry1: '', entry2: '', entry3: '' };
  }

  if (files.length === 0) {
    return { entry1: '', entry2: '', entry3: '' };
  }

  let content;
  try {
    content = await fs.promises.readFile(files[0].path, 'utf8');
  } catch (err) {
    console.error('Failed to read memory file: ' + err.message);
    return { entry1: '', entry2: '', entry3: '' };
  }
  const MAX_CONTENT_CHARS = 8000;
  const truncatedContent = content.slice(-MAX_CONTENT_CHARS);

  // Build prompt
  const userPrompt = '根據以下工作記錄，寫每日工作總結（300-500字）：\n\n'
    + truncatedContent + '\n\n'
    + '格式：\n'
    + '1) 今日完成咗咩工作（一至三項Bullet Points）\n'
    + '2) 有咩結果/發現（一至兩項）\n'
    + '3) 有咩跟進事項（如果冇就寫「暫時冇特別跟進」）\n\n'
    + '用繁體中文（廣東話），直接講結果，唔好編造。';

  return new Promise((resolve) => {
    const fullPrompt = systemPrompt + '\n\n' + userPrompt;
    const startTime = Date.now();

    try {
      const stdout = execFileSync(MINIMAX_CONFIG.cmd, [
        'infer', 'model', 'run',
        '--model', MINIMAX_CONFIG.model,
        '--prompt', fullPrompt,
        '--json'
      ], {
        timeout: MINIMAX_CONFIG.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, OPENCLAW_NO_COLOR: '1' },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('MiniMax responded in ' + elapsed + 's');

      const output = stdout.toString();
      const jsonStart = output.indexOf('{');
      if (jsonStart === -1) {
        console.error('No JSON in CLI output');
        resolve({ entry1: '', entry2: '', entry3: '' });
        return;
      }

      const parsed = JSON.parse(output.substring(jsonStart));
      const outputs = parsed.outputs || [];

      if (outputs.length > 0 && outputs[0].text) {
        const response = outputs[0].text.trim();
        console.log('Journal generated (' + response.length + ' chars)');
        resolve({ entry1: response, entry2: '', entry3: '' });
      } else {
        console.error('No text from MiniMax');
        resolve({ entry1: '', entry2: '', entry3: '' });
      }
    } catch (err) {
      console.error('MiniMax failed: ' + err.message);
      resolve({ entry1: '', entry2: '', entry3: '' });
    }
  });
}

function generateDefaultJournal() {
  return {
    entry1: "今日係相對平靜既一日。",
    entry2: "持續學習同成長。",
    entry3: "聽日繼續努力！"
  };
}

function parseSummary(content) {
  if (!content || content.trim().length === 0) {
    return {
      workSummary: "- 今日無活動記錄",
      learnings: "- 無學習記錄",
      problems: "- 無問題記錄",
      improvements: "- 無改進記錄",
      plans: "- 無計劃記錄"
    };
  }

  const lines = content.split('\n').filter(l => l.trim());
  const workLines = [];
  const learningLines = [];
  const problemLines = [];
  const planLines = [];
  const otherLines = [];

  const workKeywords = ['工作', '完成', '處理', 'project', 'task', 'fix', 'update', 'merge', 'deploy', 'pr', 'issue', '寫', '做', '整', '搞', '改', '修'];
  const learningKeywords = ['學', 'learn', '研究', '睇', '試', 'experiment'];
  const problemKeywords = ['問題', 'error', 'bug', '錯', 'fail'];
  const planKeywords = ['計劃', 'plan', '聽日', '明天', '下次', 'todo', '跟進', 'follow'];

  let charCount = 0;
  for (const line of lines) {
    charCount += line.length;
    const MAX_CHARS_PER_SUMMARY = 4000;
    if (charCount > MAX_CHARS_PER_SUMMARY) break;

    const lower = line.toLowerCase();
    const workScore = workKeywords.filter(k => lower.includes(k)).length;
    const learningScore = learningKeywords.filter(k => lower.includes(k)).length;
    const problemScore = problemKeywords.filter(k => lower.includes(k)).length;
    const planScore = planKeywords.filter(k => lower.includes(k)).length;

    const maxScore = Math.max(workScore, learningScore, problemScore, planScore);
    const stripped = line.replace(/^\s*-\s*\[\d{2}:\d{2}]\s*\[?/, '').replace(/\]?\s*$/, '').slice(0, 200);

    if (maxScore >= 1) {
      if (workScore === maxScore) workLines.push(stripped);
      else if (learningScore === maxScore) learningLines.push(stripped);
      else if (problemScore === maxScore) problemLines.push(stripped);
      else if (planScore === maxScore) planLines.push(stripped);
      else otherLines.push(stripped);
    } else {
      otherLines.push(stripped);
    }
  }

  const formatLines = (arr, max = 3) => arr.slice(0, max).map(l => '- ' + l).join('\n') || '- 無相關記錄';

  return {
    workSummary: formatLines(workLines.length > 0 ? workLines : otherLines),
    learnings: formatLines(learningLines),
    problems: formatLines(problemLines),
    improvements: formatLines(otherLines.filter(l => l.includes('改進') || l.includes('優化'))),
    plans: formatLines(planLines)
  };
}

async function generateDailySummary(quiet = false) {
  _quietMode = quiet;
  const log = (...args) => { if (!quiet) console.log(...args); };

  const lockDir = LOCK_FILE + '.lockdir';
  try {
    await fs.promises.mkdir(lockDir, { recursive: false });
  } catch (err) {
    log('Already running (lock: ' + lockDir + '). Skipping.');
    return;
  }

  try {
    await fs.promises.writeFile(path.join(lockDir, 'lock.txt'), new Date().toISOString());
  } catch (_) {}

  try {
    const date = getTodayDate();
    const displayDate = getDisplayDate(date);

    log('Generating daily summary for ' + displayDate + '...');

    const logContent = await readTodayMemory(date);
    const summary = parseSummary(logContent);

    // 生成個人日記 (AI)
    let journal = await generateJournalWithMiniMax(date);

    if (!journal.entry1) {
      log('Using default journal');
      journal = generateDefaultJournal();
    }

    // 檢查 Apple Note 是否已存在
    const noteTitle = 'AI 每日總結 - ' + displayDate;
    const alreadyExists = checkNoteExists(noteTitle, "Ally's Daily");

    if (alreadyExists) {
      log('Daily summary for ' + displayDate + ' already exists');
    } else {
      const success = createDailySummary(displayDate, summary, journal);
      if (success) {
        log('Apple Note created: ' + noteTitle);
      }
    }

    // 發送到 Discord
    try {
      const generator = new ReportGenerator();
      const report = generator.generate('daily-summary', {
        date: date,
        work: journal.entry1 ? journal.entry1.split('\n') : [],
        reflections: journal.entry2 ? journal.entry2.split('\n') : [],
        plans: journal.entry3 ? journal.entry3.split('\n') : []
      });

      const embed = generator.toDiscordEmbed(report);
      embed.footer = {
        text: '已同步到 Apple Notes「Ally\'s Daily」'
      };

      await sendDiscord(embed);

      // 記錄到日誌
      try {
        const logEntry = {
          timestamp: new Date().toISOString(),
          date: date,
          displayDate: displayDate,
          success: true,
          hasContent: !!logContent
        };

        const logPath = path.join(MEMORY_DIR, 'summary-log.json');
        let logs = [];
        try {
          logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
        } catch (e) {
          logs = [];
        }
        logs.push(logEntry);
        logs = logs.slice(-30);
        fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
      } catch (logErr) {
        console.error('Failed to write summary log: ' + logErr.message);
      }

    } catch (err) {
      console.error('Discord send failed: ' + err.message);
    }
  } finally {
    try {
      await fs.promises.rm(lockDir, { recursive: true, force: true });
    } catch (err) {
      console.error('Failed to remove lock: ' + err.message);
    }
  }
}

// Main
if (require.main === module) {
  const _quiet = process.argv.includes('--quiet');
  generateDailySummary(_quiet).then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('Daily summary failed:', err.message);
    process.exit(1);
  });
}

module.exports = { generateDailySummary };
