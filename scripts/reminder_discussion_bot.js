#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Reminder Discussion - Discord Bot API 版
 * 參考 Bliss daily_weather.js 既做法
 * 直接讀取 OpenClaw Discord token 發送
 */

const { execFileSync } = require('child_process');
const https = require('https');
const fs = require('fs');

// Discord channel ID (⚙️系統)
const CHANNEL_ID = process.env.DISCORD_SYSTEM_CHANNEL_ID || '1473376125584670872';

function getDiscordToken() {
    try {
        const configPath = process.env.HOME + '/.openclaw/openclaw.json';
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config.channels.discord.token;
    } catch (err) {
        console.error(`❌ Failed to read Discord token: ${err.message}`);
        return null;
    }
}

function sendDiscord(msg) {
    const token = getDiscordToken();

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
                    log('✅ 已發送到 Discord #⚙️系統');
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

function getTodayReminders() {
    try {
        try {
          const result = execFileSync('remindctl', ['today'], {
              encoding: 'utf8',
              timeout: 10000
          });

          if (result.includes('No reminders')) {
              return [];
          }

          return result.trim().split('\n').filter(l => l.trim());
        } catch (innerErr) {
          if (innerErr.status === 1 && innerErr.stdout?.includes('No reminders')) {
              return [];
          }
          console.error(`⚠️ remindctl error: ${innerErr.message}`);
          return [];
        }
    } catch (err) {
        console.error(`⚠️ getTodayReminders error: ${err.message}`);
        return [];
    }
}

async function main() {
    try {
        const reminders = getTodayReminders();

        if (reminders.length === 0) {
            log('✅ 今日冇 reminders');
            return;
        }

        // Build message
        let msg = "⏰ **今日 Reminders**\n━━━━━━━━━━━━━━━━━━━━\n\n";

        reminders.forEach((r, i) => {
            msg += `${i + 1}. ${r}\n`;
        });

        msg += "\n━━━━━━━━━━━━━━━━━━━━";

        // Send directly to Discord
        await sendDiscord(msg);

    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        process.exit(1);
    }
}

// 全局錯誤處理
process.on('uncaughtException', (err) => {
    console.error(`❌ Uncaught: ${err.message}`);
    process.exit(1);
});

main();
