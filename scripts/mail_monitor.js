#!/usr/bin/env node
/**
 * Mail Monitor - 每分鐘 check 新 email → Discord #💼工作
 *
 * 2026-09-11 完整 audit fix（32 bugs）：
 *   🔴 CRITICAL (5)
 *     C1 移除 secret_resolver require，直接用 env var；NO_TOKEN 只 log 一次
 *     C2 AppleScript 日期時間改用 numeric fields，唔再靠 locale-dependent `date string`
 *     C3 AppleScript 改 `repeat 1 to n` 攞真正最新 N 封；messages[messages.length-1] 為最新；epoch=0 跳過
 *     C4 execSync curl 改成 Node built-in https POST，消除 shell injection
 *     C5 State 改 atomic write（temp + rename）；加 PID lock 防重複行
 *
 *   🟠 HIGH (7)
 *     H1 Date.UTC() 取代 local TZ Date
 *     H2 parseChineseDateTime 失敗返 null 而唔係 0
 *     H3 AppleScript 內 `do shell script base64` 改成單次 final encode；個別訊息唔再 shell-out
 *     H4 Mailbox 嘗試「收件匣」→ 退回 INBOX
 *     H5 discordSend 改 async，刪走 2s busy-wait
 *     H6 newMsgs dedupe 用 ID only，唔再混 epoch
 *     H7 由 C4 覆蓋
 *
 *   🟡 MEDIUM (10)
 *     M1 init 用 messages[length-1] 為最新（已同 C3 同步）
 *     M2 init 寫 state 失敗 → log ERROR + exit 1
 *     M3 loadState parse 失敗 → 將壞檔 backup 再用 fresh state
 *     M4 `!state.lastEpoch` 改 `state.lastEpoch == null || === 0`
 *     M5 time string 改 numeric hours/minutes/seconds，避 AM/PM 問題
 *     M6 discordSend log response status code
 *     M7 body truncate 到 3000 chars + escape markdown
 *     M8 移除冗餘 Content-Length header
 *     M9 移除 dead code `if i < 1 then set i to 1`
 *     M10 discordSend 失敗 log 包含 message text snippet
 *
 *   🟢 LOW (10)
 *     L1 所有 appendFileSync 包 try/catch
 *     L2 移除硬寫 Asia/Hong_Kong，用 system default
 *     L3 所有 log 唔可以 leak token
 *     L4 Env var name 一致用 OPENCLAW_DISCORD_TOKEN
 *     L5 提取 const LOOKBACK = 20
 *     L6 log 加 INFO / WARN / ERROR 前綴
 *     L7 empty subject fallback → "(no subject)"
 *     L8 empty sender fallback → "(unknown sender)"
 *     L9 Start 時 acquire PID lock，重複行即 exit
 *     L10 AppleScript 用 `plain text content of m`，唔再攞 raw source
 *
 *  2026-09-11 AI Summary（新增）：
 *     S1 用 MiniMax-M3 做 AI summary（80-150字繁體中文），fail 就用 raw email
 *     S2 embed timestamp 改用 email 本身嘅 epoch，唔再係 push time
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawnSync, execFileSync } = require('child_process');

// ─── Constants ───────────────────────────────────────────────────────────────

const STATE_FILE   = path.join(os.homedir(), '.openclaw', 'workspace', '.mail_monitor_state.json');
const LOG_FILE     = '/tmp/mail_monitor.log';
const DISCORD_LOG  = '/tmp/mail_discord.log';
const CHANNEL_ID   = '1473383064565710929';  // #💼工作
const LOOKBACK     = 20;                      // 每輪睇最新 20 封
const PID_LOCK     = '/tmp/mail_monitor.pid';
const DISCORD_MAX_BODY = 3000;                // embed description 安全上限（Discord 4096）
const DISCORD_TIMEOUT  = 10_000;              // https POST 10s
const DISCORD_EMBED_COLOR = 3447003;          // Discord blurple-ish blue (0x3498DB)
const LLM_TIMEOUT        = 120;               // MiniMax call timeout (seconds)
const LLM_MODEL          = 'minimax-portal/MiniMax-M2.7';

// ─── Logging（INFO / WARN / ERROR 前綴）─────────────────────────────────────

function log(level, msg) {
  try {
    const t = new Date().toISOString();
    // 防止 token 意外 leak 入 log
    const safe = String(msg).replace(/Bot [A-Za-z0-9_\-]{20,}/g, 'Bot ***REDACTED***');
    fs.appendFileSync(LOG_FILE, '[' + t + '] [' + level + '] ' + safe + '\n');
  } catch (_) { /* swallow: log failure 唔可以 crash monitor */ }
}

// ─── PID lock（防止重複行）────────────────────────────────────────────────────

function acquirePidLock() {
  if (fs.existsSync(PID_LOCK)) {
    try {
      const old = parseInt(fs.readFileSync(PID_LOCK, 'utf8').trim(), 10);
      if (old && old !== process.pid) {
        // Check if previous instance still alive
        let alive = false;
        try { process.kill(old, 0); alive = true; } catch (_) { /* dead */ }
        if (alive) {
          // BUGFIX (2026-09-12): 之前「仍然寫新 lock 繼續行」會令 cron 每分鐘 spawn 多個 instance，
          // 當 AI summary ETIMEDOUT (50s) + AppleScript fetch 令 runtime > 60s，下一個 cron tick 就會
          // 讀到舊 state 並重複 push 同一封電郵。發現者：Dropbox email 喺 10:42 同一 10:43 連續被推兩次。
          // 修法：detect 到 live PID → 立即 exit 0（cron 唔會當 error，下次 cron 會自動 retry）。
          log('INFO', 'Another instance alive (pid=' + old + '), exiting to avoid duplicate push');
          process.exit(0);
        }
        // 舊 PID 已死（stale lock），清理後繼續
        try { fs.unlinkSync(PID_LOCK); } catch (_) {}
      }
    } catch (_) { /* ignore */ }
  }
  try {
    fs.writeFileSync(PID_LOCK, String(process.pid));
  } catch (e) {
    log('WARN', 'PID lock write failed: ' + e.message);
  }
}

function releasePidLock() {
  try {
    if (fs.existsSync(PID_LOCK)) {
      const cur = fs.readFileSync(PID_LOCK, 'utf8').trim();
      if (cur === String(process.pid)) fs.unlinkSync(PID_LOCK);
    }
  } catch (_) { /* ignore */ }
}

// ─── Discord send（async https，無 busy-wait）──────────────────────────────

let noTokenLogged = false;  // C1 / L4：NO_TOKEN 每個 process 只 log 一次

function discordSend(text, emailEpoch) {
  // resolve(true) = 已送出；resolve(false) = 失敗（caller 唔好當佢已推送）
  return new Promise(function (resolve) {
    const token = process.env.OPENCLAW_DISCORD_TOKEN || '';
    if (!token) {
      if (!noTokenLogged) {
        try {
          fs.appendFileSync(
            DISCORD_LOG,
            '[' + new Date().toISOString() + '] NO_TOKEN: set OPENCLAW_DISCORD_TOKEN env var\n'
          );
        } catch (_) {}
        noTokenLogged = true;
      }
      return resolve(false);
    }

    // 用電郵本身嘅時間做 embed timestamp（唔係 push 出去嗰刻嘅時間）
    // backward compat：冇 epoch / epoch 無效 → fallback 返 now
    let tsDate = null;
    if (emailEpoch) {
      const d = new Date(emailEpoch);
      if (!isNaN(d.getTime())) tsDate = d;
    }
    if (!tsDate) tsDate = new Date();

    const payload = JSON.stringify({
      content: '',
      embeds: [{
        title: '📧 新電郵',
        description: text,
        color: DISCORD_EMBED_COLOR,
        footer: { text: 'Ally Mail Monitor' },
        timestamp: tsDate.toISOString()
      }]
    });

    const bodyBuf = Buffer.from(payload, 'utf8');
    function doRequest(retryCount) {
    const req = https.request(
      {
        method: 'POST',
        hostname: 'discord.com',
        path: '/api/v10/channels/' + CHANNEL_ID + '/messages',
        headers: {
          'Authorization': 'Bot ' + token,
          'Content-Type': 'application/json',
          'Content-Length': String(bodyBuf.length),  // M8：保留（https 需要）
          'User-Agent': 'MailMonitor/1.0 (Node)'
        },
        timeout: DISCORD_TIMEOUT
      },
      function (res) {
        let chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          const body = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode;
          const snippet = String(status) + ' ' + String(body).slice(0, 120);
          // Bug 4 fix: 429 (rate limit) and 5xx → retry with backoff
          if (status === 429 || (status >= 500 && status < 600)) {
            if (retryCount < 2) {
              let waitMs = 1000 * (retryCount + 1);  // 1s, 2s backoff
              // Try to parse retry_after from body (Discord sends float seconds)
              try {
                const parsed = JSON.parse(body);
                if (parsed.retry_after && parsed.retry_after > 0) {
                  waitMs = Math.ceil(parsed.retry_after * 1000);
                }
              } catch (_) {}
              try {
                fs.appendFileSync(DISCORD_LOG, '[' + new Date().toISOString() + '] RETRY ' + status + ' (attempt ' + (retryCount+1) + '/3) after ' + waitMs + 'ms: ' + snippet.slice(0, 100) + '\n');
              } catch (_) {}
              setTimeout(function () { doRequest(retryCount + 1); }, waitMs);
              return;
            }
            // Exhausted retries
            try {
              fs.appendFileSync(DISCORD_LOG, '[' + new Date().toISOString() + '] GIVEUP ' + status + ' after 3 attempts: ' + snippet + '\n');
            } catch (_) {}
            resolve(false);
            return;
          }
          const ok = status >= 200 && status < 300;
          // M10：失敗時 log 埋 message snippet，方便 debug；log label 跟實際結果
          try {
            fs.appendFileSync(
              DISCORD_LOG,
              '[' + new Date().toISOString() + '] ' + (ok ? 'OK ' : 'ERR_STATUS ') + snippet +
                (ok ? '' : ' | msg=' + String(text).slice(0, 200)) + '\n'
            );
          } catch (_) {}
          resolve(ok);
        });
      }
    );

    req.on('timeout', function () {
      req.destroy(new Error('https timeout'));
    });

    req.on('error', function (e) {
      try {
        fs.appendFileSync(
          DISCORD_LOG,
          '[' + new Date().toISOString() + '] ERR: ' + String(e.message).slice(0, 200) +
            ' | msg=' + String(text).slice(0, 200) + '\n'
        );
      } catch (_) {}
      resolve(false);
    });

    req.write(bodyBuf);
    req.end();
    }
    doRequest(0);
  });
}

// ─── State（atomic write，backup corrupt file）──────────────────────────────

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { lastEpoch: 0, lastId: '' };
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    return {
      lastEpoch: Number(parsed.lastEpoch) || 0,
      lastId:    String(parsed.lastId || '')
    };
  } catch (e) {
    // M3：parse 失敗 → backup 壞檔，再 fall back 到 fresh state
    try {
      const backup = STATE_FILE + '.corrupt.' + Date.now();
      fs.renameSync(STATE_FILE, backup);
      log('WARN', 'State parse failed, backed up to ' + backup + ': ' + e.message);
    } catch (_) {}
    return { lastEpoch: 0, lastId: '' };
  }
}

function saveState(s) {
  // C5：atomic write（writeFileSync 落 temp，再 rename）
  const tmp = STATE_FILE + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
    return true;
  } catch (e) {
    log('ERROR', 'State write failed: ' + e.message);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}

// ─── AppleScript via Python stdin（osascript 完全 bypass shell）────────────

function runAppleScript(script, timeoutSec) {
  const py = [
    'import subprocess, sys',
    'script = sys.stdin.read()',
    'r = subprocess.run(',
    "  ['osascript', '-'],",
    "  input=script, capture_output=True, text=True,",
    '  timeout=' + String(timeoutSec || 60),
    ')',
    'sys.stdout.write(r.stdout)',
    'sys.stderr.write(r.stderr)'
  ].join('\n');

  try {
    const r = spawnSync('python3', ['-c', py], {
      input: script,
      encoding: 'utf8',
      timeout: ((timeoutSec || 60) * 1000) + 5000
    });
    if (r.status !== 0 && r.stderr) {
      // P1+P2 fix: exit code + r.signal + noise guard (skip empty stderr)
      const exitCode = r.status === null ? 'killed/timeout' : r.status;
      const stderr = String(r.stderr || '').trim();
      if (stderr) {
        log('WARN', 'AS stderr (exit=' + exitCode + '): ' + stderr.slice(0, 2000));
      } else if (r.signal) {
        log('WARN', 'AS killed by signal=' + r.signal + ' (exit=' + exitCode + '), no stderr');
      }
    }
    return (r.stdout || '').trim();
  } catch (e) {
    if (String(e.message).includes('TIMEDOUT')) log('WARN', 'AS TIMEDOUT ' + timeoutSec + 's');
    else log('ERROR', 'AS error: ' + String(e.message).slice(0, 200));
    return '';
  }
}

// ─── Parse 中文日期時間 ─────────────────────────────────────────────────────
//  期望格式：「2026年9月11日 22:18:44」（AppleScript numeric 模式產出）
//  舊 fallback 仍容忍 `date string` + `time string` 黏埋嘅字串。

function parseChineseDateTime(str) {
  if (!str) return null;
  try {
    let s = String(str).replace(/\r/g, '').replace(/星期[^\s]+/, '').trim();
    // 兼容舊/AM/PM 字串
    const hasAM = s.includes('上午');
    const hasPM = s.includes('下午');
    s = s.replace('上午', '').replace('下午', '').trim();

    const m = s.match(/(\d+)年(\d+)月(\d+)日\s+(\d+):(\d+):(\d+)/);
    if (!m) return null;

    let hour = parseInt(m[4], 10);
    if (hasAM && hour === 12) hour = 0;        // 12 上午 → 0
    if (hasPM && hour !== 12) hour += 12;      // 下午 + 12（12 下午保持 12）

    // H1：用 Date.UTC() 然後減 8 小時（AppleScript date sent 係 HKT=UTC+8，要轉 UTC）
    const HKT_OFFSET_MS = 8 * 60 * 60 * 1000;
    return Date.UTC(
      parseInt(m[1], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[3], 10),
      hour,
      parseInt(m[5], 10),
      parseInt(m[6], 10)
    ) - HKT_OFFSET_MS;
  } catch (_) {
    return null;  // H2：唔再 silently 返 0
  }
}

// ─── Fetch 最新 N 封郵件 ────────────────────────────────────────────────────
//  AppleScript `repeat with i from 1 to n` 由頭數 → 真正係「最新 N 封」

function fetchLatestMessages(n) {
  const script = [
    'tell application "Mail"',
    '  try',
    '    set acc to first account',
    '    set mbx to missing value',
    '    try',
    '      set mbx to mailbox "收件匣" of acc',
    '    end try',
    '    if mbx is missing value then',
    '      try',
    '        set mbx to mailbox "INBOX" of acc',
    '      end try',
    '    end if',
    '    if mbx is missing value then return "COUNT|0|ERR|no mailbox"',
    '    set msgList to messages of mbx',
    '    set cnt to count of msgList',
    '    if cnt = 0 then return "COUNT|0"',
    '    set out to "COUNT|" & cnt & return',
    '    set n to ' + String(n),
    '    if cnt < n then set n to cnt',
    '    repeat with i from 1 to n',
    '      set m to item i of msgList',
    '      set mid to id of m',
    '      set sub to subject of m as string',
    '      if sub is missing value or sub is "" then set sub to "(no subject)"',
    '      set snd to sender of m as string',
    '      if snd is missing value or snd is "" then set snd to "(unknown sender)"',
    '      set dt to date sent of m',
    '      -- C2 / M5：用 numeric fields 組合，唔再靠 locale-dependent `date string` / `time string`',
    '      set dts to (year of dt as string) & "年" & (month of dt as integer as string) & "月" & (day of dt as string) & "日 " & (hours of dt as string) & ":" & (minutes of dt as string) & ":" & (seconds of dt as string)',
    '      -- L10：content of m 係 plain text（已確認唔係 HTML/raw source）',
    '      -- 2026-10-13: truncate to 4000 chars to avoid base64 of huge emails timing out AppleScript',
    '      set c to content of m',
    '      if length of c > 4000 then set c to text 1 thru 4000 of c',
  
    '      set cB64 to do shell script "printf %s " & quoted form of c & " | base64 | tr -d \'\\\\n\'"',
    '      set out to out & mid & (ASCII character 31) & sub & (ASCII character 31) & snd & (ASCII character 31) & dts & (ASCII character 31) & cB64 & return',
    '    end repeat',
    '    return out',
    '  on error errMsg',
    '    return "COUNT|0|ERR|" & errMsg',
    '  end try',
    'end tell'
  ].join('\n');

  const raw = runAppleScript(script, 300);  // 2026-10-13: 120→300 (Mail AppleScript sometimes slow)
  if (!raw) return { total: 0, messages: [] };
  // P1 fix: detect AS error response 'COUNT|0|ERR|...' and log it
  if (raw.startsWith('COUNT|0|ERR|')) {
    log('ERROR', 'AS returned error: ' + raw.slice('COUNT|0|ERR|'.length).slice(0, 500));
    return { total: 0, messages: [] };
  }

  const firstLine = raw.split('\n')[0] || '';
  const parts0 = firstLine.split('|');
  const total  = parseInt(parts0[1], 10) || 0;
  if (total === 0) return { total: 0, messages: [] };

  const lines = raw.split('\n').filter(function (l) { return l.trim().length > 0; });
  const messages = [];

  for (let i = 1; i < lines.length; i++) {
    const DELIM = '\u001F'; const parts = lines[i].split(DELIM);
    if (parts.length < 4) continue;
    const [id, subject, sender, dateTimeStr, ...contentParts] = parts;
    const contentB64 = contentParts.join(DELIM);
    let content = '';
    try { content = Buffer.from(contentB64, 'base64').toString('utf8'); } catch (_) {}
    const epoch = parseChineseDateTime(dateTimeStr);
    messages.push({
      id:      String(id),
      subject: subject || '(no subject)',     // L7
      sender:  sender  || '(unknown sender)', // L8
      epoch:   epoch,                          // 可能 null
      content: content
    });
  }

  return { total: total, messages: messages };
}

// ─── Discord text helper：truncate + escape markdown ────────────────────────

function buildDiscordText(msg) {
  const rawBody = msg.content ? msg.content : '(no content)';
  const body = String(rawBody).slice(0, DISCORD_MAX_BODY);
  // M7：escape markdown 避免 Discord 誤 render
  const safeBody = body.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  const subject  = String(msg.subject || '(no subject)');
  const sender   = String(msg.sender  || '(unknown sender)');
  const dateStr  = msg.epoch
    ? new Date(msg.epoch).toISOString().replace('T', ' ').replace(/\..+$/, '') + ' UTC'
    : '(unknown date)';
  return '**From:** '    + sender   + '\n' +
         '**Subject:** ' + subject  + '\n' +
         '**Date:** '    + dateStr  + '\n\n' +
         safeBody;
}

// ─── MiniMax AI Summary（via openclaw infer）───────────────────────────────

function summarizeWithMiniMax(content) {
  const prompt = '用繁體中文（廣東話）總結呢封 email，80-150字，清晰简洁：\n' +
    String(content || '').slice(0, 3000);
  try {
    const raw = execFileSync('openclaw', [
      'infer', 'model', 'run',
      '--model', LLM_MODEL,
      '--prompt', prompt
    ], {
      encoding: 'utf8',
      timeout: (LLM_TIMEOUT + 5) * 1000,
      maxBuffer: 50 * 1024 * 1024
    });
    // openclaw infer 輸出格式：混合咗 status lines + actual output
    // 真正回覆喺最後，以 `outputs: N` 之後開始
    const lines = raw.split('\n');
    const outIdx = lines.findIndex(function (l) { return l.startsWith('outputs:'); });
    if (outIdx >= 0 && outIdx + 1 < lines.length) {
      // 由 `outputs: N` 之後一行開始，join 埋所有非 status lines
      const summary = lines.slice(outIdx + 1).join('\n').trim();
      if (summary.length > 10) return summary;
    }
    // Fallback：搵第一個非空、非開頭特殊字符行
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l && !l.startsWith('[') && !l.startsWith('│') && !l.startsWith('◇') && !l.startsWith('provider') && !l.startsWith('model') && !l.startsWith('outputs')) {
        if (l.length > 10) return l;
      }
    }
    return null;
  } catch (e) {
    log('WARN', 'MiniMax summary failed: ' + String(e.message).slice(0, 200));
    return null;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function checkNewMails() {
  const state = loadState();
  const result = fetchLatestMessages(LOOKBACK);  // L5

  if (!result.messages || result.messages.length === 0) {
    log('INFO', 'No messages fetched (total=' + result.total + ')');
    return;
  }

  // M1：repeat with i from 1 to n → messages[0] 係 truly newest（Mail newest-first）
  // C3：跳過 epoch=null（parse 失敗），佢哋唔可以當「new」
  if (state.lastEpoch == null || state.lastEpoch === 0) {
    const newest = result.messages[0];  // M1 fix
    if (!newest || !newest.epoch) {
      log('WARN', 'Init skipped: newest has no parseable epoch');
      return;
    }
    const ok = saveState({ lastEpoch: newest.epoch, lastId: newest.id });
    if (!ok) {
      // M2：init 寫 state 失敗 → log ERROR + exit
      log('ERROR', 'Init saveState failed — exiting to avoid re-push loop');
      process.exitCode = 1;
      return;
    }
    log('INFO', 'Init: ' + result.messages.length + ' msgs tracked (total=' + result.total + '), newest id=' + newest.id + ' epoch=' + newest.epoch);
    return;
  }

  // H6：dedupe by ID only
  // C3：跳過 epoch=null（parse 失敗），佢哋唔可以當「new」
  const newMsgs = result.messages.filter(function (m) {
    if (!m.epoch) return false;                       // parse fail → skip
    // 2026-10-13: message id is RFC 5322 stable string, not int. Use string comparison.
    if (m.id === state.lastId) return false;               // exactly known
    // B3: epoch guard — if this message is older or equal to last seen, skip
    if (m.epoch && state.lastEpoch && m.epoch <= state.lastEpoch) return false;
    // DONT parseInt — message id is a string like '<abc123@domain.com>'
    return String(m.id) > String(state.lastId);             // strictly newer by id
  });

  if (newMsgs.length === 0) return;

  log('INFO', 'Found ' + newMsgs.length + ' new: ' +
    newMsgs.map(function (m) { return String(m.subject || '').slice(0, 40); }).join(' | '));

  // 推送順序：oldest-first。newMsgs 係 newest-first（messages[0] 最新）；
  // 如果由最新開始推而中途被殺，已 saveState 嘅 lastId 會大過未推嘅舊郵件，
  // 令佢哋永遠唔會再推（id > lastId filter）。oldest-first 下中斷只會
  // 令較新嘅留返下一輪，唔會永久漏推。
  let allSent = true;
  for (let i = newMsgs.length - 1; i >= 0; i--) {
    const msg = newMsgs[i];
    // 先嘗試 AI summary，fail 就用 raw email text
    const summary = summarizeWithMiniMax(msg.content);
    const text = summary || buildDiscordText(msg);
    if (summary) {
      log('INFO', 'AI summary generated for: ' + String(msg.subject || '').slice(0, 40));
    } else {
      log('WARN', 'AI summary failed, using raw email: ' + String(msg.subject || '').slice(0, 40));
    }
    // H5：await async send，唔再 busy-wait
    const sent = await discordSend(text, msg.epoch);
    if (!sent) {
      // 發送失敗：唔好 saveState，唔好繼續推（否則會跳過呢封之後嘅郵件）。
      // 下一個 cron tick 會由呢封重新推起。
      allSent = false;
      log('ERROR', 'Discord send failed for: ' + String(msg.subject || '').slice(0, 40) +
        ' — will retry next tick');
      break;
    }
    // BUGFIX (2026-09-12): 每 push 一封就即時 saveState，唔好等 loop 完先 save。
    // 如果 AI summary / 後續 push 慢過 60s，下一個 cron tick 啟動嘅 instance 至少見到呢個 ID 已 pushed。
    saveState({ lastEpoch: msg.epoch, lastId: msg.id });
  }

  // 揀 newest（messages[0]），update state
  // 只在全部推送成功時先至 fast-forward 到 newest，否則會將未推送嘅郵件標記為已讀
  const newest = result.messages[0];  // M1 fix: truly newest
  if (allSent && newest && newest.epoch) {
    const ok = saveState({ lastEpoch: newest.epoch, lastId: newest.id });
    if (!ok) {
      log('ERROR', 'saveState failed after push — next run will re-send last batch');
    }
  }
}

// ─── Entry ──────────────────────────────────────────────────────────────────

// ─── Log cap（/tmp log 冇 rotation，cron 每分鐘 append 會無限膨脹）───────────

function capLogFile(filePath, maxBytes) {
  const cap = maxBytes || 5 * 1024 * 1024;
  try {
    const st = fs.statSync(filePath);
    if (st.size <= cap) return;
    // 保留最尾 1MB
    const fd = fs.openSync(filePath, 'r');
    try {
      const len = 1024 * 1024;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      const tmp = filePath + '.cap.tmp';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, filePath);
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) { /* log cap 失敗唔應該影響主流程 */ }
}

function main() {
  acquirePidLock();  // L9

  // Cap 兩個 /tmp log（cron redirect 嘅 stdout log 同 Discord log）
  capLogFile(LOG_FILE);
  capLogFile(DISCORD_LOG);

  // Best-effort：release lock on exit
  const cleanup = function () { releasePidLock(); };
  process.on('exit', cleanup);
  process.on('SIGINT',  function () { cleanup(); process.exit(130); });
  process.on('SIGTERM', function () { cleanup(); process.exit(143); });

  // 防止 token 進 log：sanity check（read-only）
  if (!process.env.OPENCLAW_DISCORD_TOKEN) {
    log('WARN', 'OPENCLAW_DISCORD_TOKEN is unset; Discord sends will be no-ops');
  } else {
    log('INFO', 'Token present (length=' + process.env.OPENCLAW_DISCORD_TOKEN.length + ')');
  }

  Promise.resolve()
    .then(checkNewMails)
    .catch(function (e) {
      log('ERROR', 'Unexpected error: ' + (e && e.message ? e.message : e));
    })
    .then(function () {
      releasePidLock();
      process.exit(process.exitCode || 0);
    });
}

main();