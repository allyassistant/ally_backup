#!/usr/bin/env node
/**
 * Mail Monitor - 每分鐘 check 新 email → 廣東話詳細總結
 * Discord embed 格式送到 #💼工作
 *
 * 策略:
 *   - Malca-Amit 運單: static (extract MAWB/航班/克拉/金額)
 *   其他全部: LLM 做詳細廣東話總結
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const STATE_FILE = path.join(__dirname, '..', '.mail_monitor_state.json');
const LOG_FILE = path.join('/tmp', 'mail_monitor.log');
const FOLDER_NAME = '收件匣';
const DISCORD_CHANNEL = 'channel:1473383064565710929';

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { lastMaxRowId: 0 }; }
}
function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8'); }
  catch (e) { console.error(`File write failed: ${e.message}`); }
}

function log(m) {
  const t = new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
  fs.appendFileSync(LOG_FILE, `[${t}] ${m}\n`);
}

function cleanContent(text) {
  return text
    .replace(/￼/g, '')
    .replace(/\s+/g, ' ')
    .replace(/view email in browser/gi, '')
    .replace(/update your preferences or unsubscribe/gi, '')
    .replace(/confidentiality notice[\s\S]*$/i, '')
    .trim();
}

// === CHECK + READ VIA PURE APPLESCRIPT (macOS TCC protected SQLite) ===
function checkNewMails() {
  const state = loadState();
  const lastId = state.lastMaxRowId || 0;

  const scpt = `/tmp/mail_check_${Date.now()}.applescript`;
  const escapedLastId = String(lastId).replace(/[^a-zA-Z0-9@._-]/g, '');
  const script = `with timeout of 30 seconds
tell application "Mail"
  set msgs to messages of mailbox "${FOLDER_NAME}" of first account
  set msgCount to count of msgs
  set outputStr to ""
  set fetchCount to msgCount
  if fetchCount > 10 then set fetchCount to 10
  repeat with i from 1 to fetchCount
    set m to item i of msgs
    set msgId to message id of m
    set msgSub to subject of m
    if msgSub is missing value then set msgSub to "(no subject)"
    set outputStr to outputStr & msgId & "\t" & msgSub & linefeed
  end repeat
  return (msgCount as text) & "\n---SEP---\n" & outputStr
end tell
end timeout`;
  try {
    fs.writeFileSync(scpt, script, 'utf8');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  let r;
  try {
    r = execSync(`osascript "${scpt}"`, { encoding: 'utf8', timeout: 30000 });
  } catch (e) {
    log(`AppleScript err: ${e.message}`);
    try { fs.unlinkSync(scpt); } catch (_) {}
    return [];
  }
  try { fs.unlinkSync(scpt); } catch (_) {}

  const [countStr, ...msgParts] = r.trim().split('\n---SEP---\n');
  const totalCount = parseInt(countStr, 10);
  const msgLines = msgParts.join('\n---SEP---\n').split('\n').filter(Boolean);

  if (lastId === 0 || lastId === '0') {
    // First run: just record the latest ID
    if (msgLines.length > 0) {
      const first = msgLines[0].split('\t');
      state.lastMaxRowId = first[0] || 'init';
      saveState(state);
      log(`Init: inbox has ${totalCount} messages, tracked ID = ${state.lastMaxRowId}`);
    }
    return [];
  }

  // Find messages newer than last known ID
  const newMsgs = [];
  for (const line of msgLines) {
    const parts = line.split('\t');
    const msgId = parts[0];
    const subject = parts.slice(1).join('\t').trim() || '(no subject)';
    if (!msgId || msgId === lastId) break;
    newMsgs.push({ rowid: msgId, subject });
  }

  if (newMsgs.length > 0) {
    state.lastMaxRowId = newMsgs[0].rowid;
    saveState(state);
    log(`New: ${newMsgs.length} msgs, latest ID = ${state.lastMaxRowId}`);
  }

  return newMsgs;
}

function readContent(msgId) {
  const scpt = `/tmp/mail_read_${Date.now()}.applescript`;
  const escapedId = msgId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `with timeout of 60 seconds
tell application "Mail"
  set msgs to messages of mailbox "${FOLDER_NAME}" of first account
  repeat with m in msgs
    if (message id of m) is "${escapedId}" then
      set s to sender of m
      if s is missing value then set s to "(unknown)"
      set c to content of m
      if c is missing value then set c to ""
      if length of c > 3000 then set c to text 1 thru 3000 of c
      return s & "|||" & c
    end if
  end repeat
  return "(unknown)|||"
end tell
end timeout`;
  try {
    fs.writeFileSync(scpt, script, 'utf8');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  let r;
  try {
    r = execSync(`osascript "${scpt}"`, { encoding: 'utf8', timeout: 120000 });
  } catch (e) {
    log(`AppleScript read err: ${e.message}`);
    try { fs.unlinkSync(scpt); } catch (_) {}
    return { sender: '(error)', content: '' };
  }
  try { fs.unlinkSync(scpt); } catch (_) {}

  const p = r.trim().split('|||');
  return {
    sender: (p[0] || '(unknown)').replace(/<|>/g, '').trim(),
    content: cleanContent(p.slice(1).join('|||'))
  };
}

// === MALCA-AMIT STATIC HANDLER ===
function staticShipmentSummary(subject, sender, content) {
  const sClean = sender.replace(/<.*>/, '').trim().toLowerCase();
  const plain = content.replace(/\s+/g, ' ').trim();
  if (!sClean.includes('malca-amit')) return null;

  if (subject.toLowerCase().includes('shipment')) {
    const ref = subject.match(/#?\s*(\d+)/);
    const mawb = plain.match(/MAWB\s*(?:No\.?\s*[:：]?)?\s*[:：]?\s*(\S+)/i);
    const ct = plain.match(/(\d+\.?\d*)\s*CTS/i);
    // 金額：USD before (USD XXX) 或 after (XXX USD)
    const valB4 = plain.match(/USD[\s,]*([0-9][0-9,.]*)/i);
    const valAf = plain.match(/([0-9,.]+)\s*USD/i);
    const val = valB4 || valAf;
    // 出發地 From:
    const from = plain.match(/\bFrom\s*:\s*(\S+)\s+Carats/i);
    // 航班 (CX714/30.04.26 / LX138/05.06.26)
    const flight = plain.match(/(?:Flight\s*#?\s*[:：]?\s*)?(\S+\/\d{2}\.\d{2}\.\d{2,4})/i);
    // 發貨日期 (30.04.26) — off flight number
    const shipDate = flight ? flight[1].match(/\/(\d{2}\.\d{2}\.\d{2,4})/) : null;
    // 送達日期及時間 — 匹配具體日期時間格式，避免吞後面文字
    const deliveryDate = plain.match(/DELIVERED ON\s*(\d{2}\/\d{2}\s+\d{2}:\d{2}(?:\s*-\s*\d{2}:\d{2})?)/i);
    // 寄件人/收件人/貨物
    // Shipper: explicit field; fallback: text before Shipment No.
    let shipper = plain.match(/Shipper\s*[:：]?\s*(.+?)(?:\s{2,}|$|\s+(?:Shipment|MAWB|Carent|Flight)\b)/i);
    if (!shipper) shipper = plain.match(/^([A-Z][A-Z\s.]+?)\s*Shipment No\./);
    const receiver = plain.match(/\bTO\s*[:：]?\s*(.+?)(?:\s{2,}|\s+(?:INFORM|Shipper|FROM|SHIPMENT)\b)/i);
    const commodity = plain.match(/Commodity\s*[:：]?\s*(.+?)(?:\s{2,}|$|\s+(?:Sales|Sincerely|From|Flight|Carats|Value|Weight|Shipper|Receiver|To|TO|Customs|MAWB|Shipment|Carent|Liability|Commodity|THE)\b)/i);

    const ori = from ? from[1] : '';
    let s = `📦 **Malca-Amit 運單${ref ? ' #' + ref[1] : ''}**`;
    if (shipper) s += `\n📤 ${shipper[1].trim()}  →  📥 ${receiver ? receiver[1].trim() : '?'}`;
    if (commodity) s += `\n📄 ${commodity[1].trim()}`;
    s += `\n📍 由 ${ori ? '**' + ori + '**' : '?'} 寄出`;
    if (shipDate || deliveryDate) {
      if (shipDate) s += `　|　📅 ${shipDate[1]}`;
      if (shipDate && deliveryDate) s += ` → 送達 ${deliveryDate[1].trim().replace(/\s+/g,' ')}`;
    }
    if (mawb || flight) {
      s += `\n📎 `;
      if (mawb) s += `MAWB: ${mawb[1]}`;
      if (mawb && flight) s += `　|　`;
      if (flight) s += `✈️ ${flight[1]}`;
    }
    s += `\n💎 **${ct ? ct[0] : '?'}**`;
    if (val) s += `　💰 **USD ${val[1]}**`;
    return s;
  }
  if (subject.toLowerCase().includes('hawb')) {
    return '📄 **Export HAWB** — Malca-Amit 出口文件，請查看附件';
  }
  return null;
}

// === LLM SUMMARY ===
function llmSummary(subject, sender, content) {
  try {
    const input = `標題: ${subject}\n寄件人: ${sender}\n內容: ${content.slice(0, 800)}`;
    const prompt = `用廣東話詳細總結以下email嘅重點（2-3句，唔超過100字）：\n\n${input}`;
    const result = execSync(
      `openclaw agent -m ${JSON.stringify(prompt)} --agent main --json 2>/dev/null`,
      { encoding: 'utf8', timeout: 15000 }
    );
    const parsed = JSON.parse(result);
    const reply = parsed?.result?.payloads?.[0]?.text;
    return reply?.trim() || null;
  } catch(e) {
    log(`LLM summary error: ${e.message}`);
    return null;
  }
}

/** Escape text for JSON embed (backtick-safe) */
function esc(t) {
  return t.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function sendEmbedDiscord(title, blocks) {
  try {
    const payload = JSON.stringify({
      title: title,
      tone: 'info',
      blocks: blocks
    });
    const payloadFile = `/tmp/mail_discord_${Date.now()}.json`;
    fs.writeFileSync(payloadFile, payload, 'utf8');
    const { spawnSync } = require('child_process');
    const result = spawnSync('openclaw', [
      'message', 'send',
      '--channel', 'discord',
      '--target', DISCORD_CHANNEL,
      '--presentation', payload
    ], { encoding: 'utf8', timeout: 15000 });
    try { fs.unlinkSync(payloadFile); } catch (_) {}
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `exit code ${result.status}`);
    log('Sent embed to Discord OK');
  } catch(e) {
    log(`Discord send err: ${e.message}`);
  }
}

function main() {
  try {
    const newMsgs = checkNewMails();
    if (newMsgs.length === 0) return;

    log(`Reading ${newMsgs.length} emails...`);

    const blocks = [];
    const timestamp = new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false });

    for (let i = 0; i < newMsgs.length; i++) {
      const msg = newMsgs[i];
      const { sender, content } = readContent(msg.rowid);

      let summary = staticShipmentSummary(msg.subject, sender, content);

      if (!summary) {
        log(`LLM: ${msg.subject}`);
        summary = llmSummary(msg.subject, sender, content);
      }

      if (!summary) {
        const snippet = content.replace(/\s+/g,' ').trim().slice(0, 200);
        summary = `📧 **${msg.subject}** — ${sender.replace(/<.*>/,'').trim()}\n${snippet}`;
      }

      // Add divider between emails (except first)
      if (i > 0) {
        blocks.push({ type: 'divider' });
      }

      blocks.push({ type: 'text', text: summary });
    }

    // Footer
    blocks.push({ type: 'context', text: `🕐 ${timestamp}` });

    const title = newMsgs.length > 1
      ? `📬 ${newMsgs.length} 封新郵件`
      : `📬 新郵件通知`;

    sendEmbedDiscord(title, blocks);
    log('Done');
  } catch(e) {
    log(`Fatal: ${e.message}`);
  }
}

main();
