#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * RapNet Sender (Discord Bot API)
 * 自動生成 AI 摘要 + 發送到 Discord
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CHANNEL_ID = "1473383064565710929";
const { MEMORY_DIR, OPENCLAW_CONFIG } = require('./lib/config');
const { getHKTDateTime } = require('./lib/time');
const DATA_FILE = path.join(MEMORY_DIR, 'rapnet-latest.json');
const STATE_FILE = path.join(MEMORY_DIR, 'rapnet-weekly-state.json');
const RAPNET_URL = 'https://www.rapnet.com/resources/';
const _newOnly = process.argv.includes('--new-only');
const _autoSummary = process.argv.includes('--auto-summary');

function getDiscordToken() {
    try {
        const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
        return config?.channels?.discord?.token || null;
    } catch (err) {
        console.error(`❌ Failed to read Discord token: ${err.message}`);
        return null;
    }
}

function sendDiscord(msg) {
    const token = getDiscordToken();
    if (!token) return Promise.reject(new Error('No Discord token'));

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
                    resolve({ status: res.statusCode });
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify({ content: msg }));
        req.end();
    });
}

const MAX_DISCORD_LENGTH = 1900;

function truncateMessage(msg, maxLen = MAX_DISCORD_LENGTH) {
    if (msg.length <= maxLen) return msg;
    return msg.substring(0, maxLen - 20) + '\n...(內容已截斷)';
}

async function sendDiscordWithRetry(msg, maxRetries = 3) {
    const truncatedMsg = truncateMessage(msg);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await sendDiscord(truncatedMsg);
            return { success: true };
        } catch (err) {
            log(`⚠️ 發送失敗 (嘗試 ${attempt}/${maxRetries}): ${err.message}`);
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    }
    throw new Error('All retries failed');
}

function updateState(articleIds) {
    try {
        let state = { lastCheck: null, lastArticleIds: [] };
        try {
            state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        } catch (e) {}

        state.lastCheck = getHKTDateTime();
        state.lastArticleIds = articleIds;

        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        log('✅ 狀態已更新');
    } catch (e) {
        log('⚠️ 無法更新狀態: ' + e.message);
    }
}

// 自動生成 AI 摘要
async function autoGenerateSummaries(articles) {
    log('🤖 自動生成 AI 摘要...\n');

    // 構建 prompt
    const articleList = articles.map((a, i) => `${i + 1}. ${a.title}`).join('\n');
    const prompt = `用繁體中文生成以下 ${articles.length} 篇 RapNet 文章的摘要，每篇 2-3 句：

${articleList}

Output JSON（只要JSON，唔好其他野）：
[
  {"title": "標題", "summary": "2-3句摘要"},
  ...
]`;

    try {
        // 使用 openclaw sessions spawn
        const cmd = `openclaw sessions spawn --model "minimax-portal/MiniMax-M2.7" --task "${prompt.replace(/"/g, '\\"')}" --timeout 120`;

        log('🔄 調用 MiniMax 生成摘要...');
        const result = execSync(cmd, { encoding: 'utf8', timeout: 150, stdio: ['pipe', 'pipe', 'pipe'] });

        // 解析 JSON
        const jsonMatch = result.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            try {
                const summaries = JSON.parse(jsonMatch[0]);
                log(`📦 搵到 ${summaries.length} 個摘要`);

                // 更新 articles
                summaries.forEach((s, i) => {
                    if (articles[i] && s.summary) {
                        articles[i].summary = s.summary;
                    }
                });

                // 保存
                let data;
                try {
                  data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                } catch (e) {
                  log(`⚠️ 讀取數據失敗: ${e.message}`);
                  return false;
                }
                data.articles = articles;
                try {
                  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
                } catch (e) {
                  log(`⚠️ 保存數據失敗: ${e.message}`);
                  return false;
                }

                log('✅ 摘要已保存');
                return true;
            } catch (e) {
                log('⚠️ JSON 解析失敗: ' + e.message);
            }
        }
    } catch (err) {
        log(`❌ AI 摘要生成失敗: ${err.message}`);
    }

    return false;
}

async function main() {
    const today = new Date().toLocaleDateString('zh-HK');

    log('📤 RapNet Sender - 發送週報...\n');

    // 讀取數據
    let data;
    try {
        data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (err) {
        log('❌ 找不到數據文件，請先運行 rapnet_weekly.js');
        process.exit(1);
    }

    if (!data.articles || data.articles.length === 0) {
        log('⚠️ 沒有文章');
        return;
    }

    let articles = data.articles;

    // 自動生成摘要（如果需要）
    if (_autoSummary) {
        const needsSummary = articles.some(a => !a.summary || a.summary.length < 20);
        if (needsSummary) {
            await autoGenerateSummaries(articles);
        } else {
            log('✅ 文章已有摘要，跳過生成');
        }
    }

    // 新文章過濾
    let articlesToSend = articles;
    if (_newOnly) {
        try {
            const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            const lastIds = state.lastArticleIds || [];
            articlesToSend = articles.filter(a => !lastIds.includes(a.title));
            log(`🔍 新文章模式: ${articlesToSend.length} 篇新於上次`);
        } catch (e) {
            log(`⚠️ 無法讀取狀態，發送全部`);
        }
    }

    if (articlesToSend.length === 0) {
        log('✅ 沒有新文章，不發送');
        return;
    }

    // 構建消息
    let msg = `📊 **RapNet 每週更新 - ${today}**\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (_newOnly) {
        msg += `🆕 **${articlesToSend.length} 篇新文章**\n\n`;
    } else {
        msg += `📰 **${articles.length} 篇文章**\n\n`;
    }

    // 重要文章先
    const important = articlesToSend.filter(a => a.important);
    const others = articlesToSend.filter(a => !a.important);

    if (important.length > 0) {
        msg += `🔴 **重要文章**\n`;
        important.slice(0, 3).forEach((a, i) => {
            msg += `${i + 1}. **${a.title}**\n`;
            if (a.summary) msg += `   ${a.summary}\n`;
            msg += `   🔗 ${a.url}\n\n`;
        });
    }

    if (others.length > 0 && important.length < 3) {
        msg += `📰 **其他文章**\n`;
        const slots = 5 - Math.min(important.length, 3);
        others.slice(0, slots).forEach((a, i) => {
            msg += `${i + 1}. ${a.title}\n`;
            if (a.summary) msg += `   ${a.summary.substring(0, 60)}...\n`;
            msg += `   🔗 ${a.url}\n\n`;
        });
    }

    msg += `━━━━━━━━━━━━━━━━━━━━\n`;

    // 發送
    try {
        await sendDiscordWithRetry(msg);
        log('✅ 發送成功');

        // 更新狀態
        updateState(articles.map(a => a.title));

    } catch (err) {
        log(`❌ Discord 發送失敗: ${err.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error('❌ Error:', err.message);
        process.exit(1);
    });
}

module.exports = { sendDiscord, sendDiscordWithRetry };
