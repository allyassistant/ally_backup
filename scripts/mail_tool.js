#!/usr/bin/env node
/**
 * Apple Mail Tool - Read, search, compose, reply, forward, attachments
 * via AppleScript. Uses temp files to avoid template literal escaping issues.
 */

const { execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const args = process.argv.slice(2);
const COMMAND = args[0] || 'list';
const COUNT = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] ||
                     args[args.indexOf('--count') + 1] || '10', 10);
const folderIdx = args.indexOf('--folder');
const FOLDER = args.find(a => a.startsWith('--folder='))?.split('=')[1] ||
               (folderIdx >= 0 ? args[folderIdx + 1] : null) || '收件匣';

const AS_RS = '\r';

// Email signature
const SIGNATURE = process.env.MAIL_SIGNATURE || `

Best Regards,

Joshua Chan

D.N. Group (HK) Ltd.`;

function flag(n) {
  const v = args.find(a => a.startsWith(n + '='))?.split('=').slice(1).join('=');
  const i = args.indexOf(n);
  return v || (i >= 0 ? args[i + 1] : null);
}

function fmtSender(r) { return r?.replace(/<|>/g,'').trim() || '(unknown)'; }

function runAS(script, timeoutSec) {
  const tmp = path.join(os.tmpdir(), `mail_${Date.now()}.applescript`);
  try {
    fs.writeFileSync(tmp, script, 'utf8');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  try {
    return execSync(`osascript "${tmp}"`, { encoding: 'utf8', timeout: (timeoutSec || 60) * 1000 }).trim();
  } finally {
    try { fs.rmSync(tmp); } catch {}
  }
}

// -- ACCOUNTS / FOLDERS --
function getAccounts() {
  return runAS(`with timeout of 10 seconds
tell application "Mail"
  set out to ""
  repeat with a in every account
    set out to out & name of a & "|" & email addresses of a & return
  end
  return out
end tell
end timeout`).split(AS_RS).filter(Boolean);
}

function getFolders() {
  return runAS(`with timeout of 10 seconds
tell application "Mail"
  set out to ""
  repeat with m in mailboxes of first account
    set out to out & name of m & return
  end
  return out
end tell
end timeout`).split(AS_RS).filter(Boolean);
}

// -- LIST --
function listMsgs(folder, count) {
  const cap = Math.min(count, 200);
  const qFolder = folder.replace(/"/g, '\\"');
  return runAS(`with timeout of 60 seconds
tell application "Mail"
  set msgs to messages of mailbox "${qFolder}" of first account
  set out to "TOTAL:" & (count of msgs) & return
  set n to count of msgs
  set lm to ${cap}
  if n < lm then set lm to n
  repeat with i from 1 to lm
    set m to item i of msgs
    set s to subject of m
    if s is missing value then set s to "(no subject)"
    set r to sender of m
    if r is missing value then set r to "(unknown)"
    set d to date received of m
    if d is missing value then set d to current date
    set out to out & i & "|" & s & "|" & r & "|" & d & return
  end
  return out
end tell
end timeout`, 120).split(AS_RS).filter(Boolean);
}

// -- SEARCH --
function searchMsgs(q, folder, count) {
  const cap = Math.min(count, 200);
  const qFolder = folder.replace(/"/g, '\\"');
  const qQuery = q.replace(/"/g, '\\"');
  return runAS(`with timeout of 120 seconds
tell application "Mail"
  set msgs to (messages of mailbox "${qFolder}" of first account whose subject contains "${qQuery}")
  set out to "TOTAL:" & (count of msgs) & return
  set n to count of msgs
  set lm to ${cap}
  if n < lm then set lm to n
  repeat with i from 1 to lm
    set m to item i of msgs
    set s to subject of m
    if s is missing value then set s to "(no subject)"
    set r to sender of m
    if r is missing value then set r to "(unknown)"
    set d to date received of m
    if d is missing value then set d to current date
    set out to out & i & "|" & s & "|" & r & "|" & d & return
  end
  return out
end tell
end timeout`, 180).split(AS_RS).filter(Boolean);
}

// -- READ --
function readMsg(idx, folder) {
  const qFolder = folder.replace(/"/g, '\\"');
  return runAS(`with timeout of 60 seconds
tell application "Mail"
  set msgs to messages of mailbox "${qFolder}" of first account
  set n to count of msgs
  if ${idx} > n then return "ERROR:Index " & ${idx} & " > " & n
  set m to item ${idx} of msgs
  set s to subject of m
  if s is missing value then set s to "(no subject)"
  set r to sender of m
  if r is missing value then set r to "(unknown)"
  set d to date received of m
  if d is missing value then set d to current date
  set c to content of m
  if c is missing value then set c to "(no content)"
  if length of c > 5000 then set c to text 1 thru 5000 of c
  return "SUBJECT:" & s & return & "FROM:" & r & return & "DATE:" & d & return & "---" & return & c
end tell
end timeout`, 120);
}

// -- ATTACHMENTS --
function listAtts(idx, folder) {
  const qFolder = folder.replace(/"/g, '\\"');
  return runAS(`with timeout of 30 seconds
tell application "Mail"
  set msgs to messages of mailbox "${qFolder}" of first account
  if ${idx} > count of msgs then return "ERROR:Out of range"
  set m to item ${idx} of msgs
  set atts to mail attachments of m
  set out to "TOTAL:" & (count of atts) & return
  repeat with a in atts
    set out to out & (name of a) & "|" & (size of a) & "|" & (MIME type of a) & return
  end
  return out
end tell
end timeout`).split(AS_RS).filter(Boolean);
}

function downloadAtts(idx, folder, dir) {
  const qFolder = folder.replace(/"/g, '\\"');
  const qDir = dir.replace(/"/g, '\\"');
  return runAS(`with timeout of 60 seconds
tell application "Mail"
  set msgs to messages of mailbox "${qFolder}" of first account
  if ${idx} > count of msgs then return "ERROR:Out of range"
  set m to item ${idx} of msgs
  set atts to mail attachments of m
  if (count of atts) = 0 then return "No attachments"
  set out to ""
  repeat with a in atts
    set fn to name of a
    save a in ("${qDir}/" & fn)
    set out to out & fn & return
  end
  return out
end tell
end timeout`, 90);
}

// -- COMPOSE, REPLY, FORWARD (via heredoc, no template literal issues) --
function compose(to, subject, body, cc, bcc, attachPaths, doSend) {
  const toQ = to.replace(/"/g, '\\"');
  const subjQ = (subject || '').replace(/"/g, '\\"');
  const bodyQ = ((body || '') + SIGNATURE).replace(/"/g, '\\"');
  const ccQ = (cc || '').replace(/"/g, '\\"');
  const bccQ = (bcc || '').replace(/"/g, '\\"');
  const attachQ = (attachPaths || '').replace(/"/g, '\\"');

  let asScript = `tell application "Mail"
  set outMsg to make new outgoing message with properties {subject:"${subjQ}", content:"${bodyQ}"}
  tell outMsg
    make new to recipient with properties {address:"${toQ}"}`;
  if (cc) asScript += `\n    make new cc recipient with properties {address:"${ccQ}"}`;
  if (bcc) asScript += `\n    make new bcc recipient with properties {address:"${bccQ}"}`;
  asScript += `\n  end tell`;
  if (attachPaths) {
    const files = attachPaths.split(',').map(f => `POSIX file "${f.trim().replace(/"/g, '\\"')}"`);
    files.forEach(f => {
      asScript += `\n  tell content of outMsg
    make new attachment with properties {file name:${f} as alias}
  end tell`;
    });
  }
  if (doSend) asScript += `\n  send outMsg`;
  asScript += `\n  return id of outMsg
end tell`;

  return runAS(`with timeout of 30 seconds\n${asScript}\nend timeout`, 60).split(AS_RS).filter(Boolean);
}

function replyMsg(idx, body, folder, cc, doSend) {
  const qFolder = folder.replace(/"/g, '\\"');
  const bodyQ = ((body || '') + SIGNATURE).replace(/"/g, '\\"');
  const ccQ = (cc || '').replace(/"/g, '\\"');

  let asScript = `tell application "Mail"
  set msgs to messages of mailbox "${qFolder}" of first account
  if ${idx} > count of msgs then return "ERROR:Out of range"
  set m to item ${idx} of msgs
  set outMsg to reply m
  set content of outMsg to "${bodyQ}"`;
  if (cc) asScript += `\n  tell outMsg
    make new cc recipient with properties {address:"${ccQ}"}
  end tell`;
  if (doSend) asScript += `\n  send outMsg`;
  asScript += `\n  return id of outMsg
end tell`;

  return runAS(`with timeout of 30 seconds\n${asScript}\nend timeout`, 60).split(AS_RS).filter(Boolean);
}

function fwdMsg(idx, to, body, folder, doSend) {
  const qFolder = folder.replace(/"/g, '\\"');
  const toQ = to.replace(/"/g, '\\"');
  const bodyQ = ((body || '') + SIGNATURE).replace(/"/g, '\\"');

  let asScript = `tell application "Mail"
  set msgs to messages of mailbox "${qFolder}" of first account
  if ${idx} > count of msgs then return "ERROR:Out of range"
  set m to item ${idx} of msgs
  set outMsg to forward m
  set content of outMsg to "${bodyQ}"
  tell outMsg
    make new to recipient with properties {address:"${toQ}"}
  end tell`;
  if (doSend) asScript += `\n  send outMsg`;
  asScript += `\n  return id of outMsg
end tell`;

  return runAS(`with timeout of 30 seconds\n${asScript}\nend timeout`, 60).split(AS_RS).filter(Boolean);
}

// =============== MAIN ===============
try {
  switch(COMMAND) {
    case 'folders':
      console.log('📂 Mailboxes:'); getFolders().forEach(f => console.log('  📁 '+f));
      break;
    case 'accounts':
      console.log('👤 Accounts:'); getAccounts().forEach(a => { const [n,...e] = a.split('|'); console.log('  📧 '+n+' ('+e.join(', ')+')'); });
      break;
    case 'list': {
      const r = listMsgs(FOLDER, COUNT);
      const total = parseInt((r[0]||'').replace('TOTAL:','')||'0', 10);
      console.log(`📋 Latest ${COUNT} in [${FOLDER}] (total:${total}):\n`);
      r.slice(1).forEach(l => {
        const p = l.split('|');
        if (!p[0].startsWith('TOTAL')) console.log(`  ${p[0]}. ${p.slice(1,-2).join('|')}\n     ${fmtSender(p[p.length-2])} — ${p[p.length-1]}\n`);
      });
      break;
    }
    case 'search': {
      if (!flag('--q') && !args[1]?.startsWith('--')) { console.error('❌ usage: search <query>'); process.exit(1); }
      const q = flag('--q') || args.slice(1).filter(a => !a.startsWith('--'))[0];
      if (!q) { console.error('❌ search query required'); process.exit(1); }
      console.log(`🔍 "${q}" in [${FOLDER}]:`);
      const r = searchMsgs(q, FOLDER, COUNT);
      const total = parseInt((r[0]||'').replace('TOTAL:','')||'0', 10);
      console.log(`Found ${total}\n`);
      r.slice(1).forEach(l => {
        const p = l.split('|');
        if (!p[0].startsWith('TOTAL')) console.log(`  ${p[0]}. ${p.slice(1,-2).join('|')}\n     ${fmtSender(p[p.length-2])} — ${p[p.length-1]}\n`);
      });
      break;
    }
    case 'read': {
      const idx = parseInt(args[1]||'1', 10);
      const result = readMsg(idx, FOLDER);
      if (result.startsWith('ERROR:')) { console.error('❌ '+result); process.exit(1); }
      const lines = result.split(AS_RS);
      const s = lines.find(l=>l.startsWith('SUBJECT:'))?.replace('SUBJECT:','')||'';
      const f = lines.find(l=>l.startsWith('FROM:'))?.replace('FROM:','')||'';
      const d = lines.find(l=>l.startsWith('DATE:'))?.replace('DATE:','')||'';
      const cStart = result.indexOf('---'+AS_RS)+4;
      const c = result.slice(cStart).trim();
      console.log(`📧 #${idx} [${FOLDER}]\n  Subject: ${s}\n  From:    ${fmtSender(f)}\n  Date:    ${d}\n`);
      console.log(c);
      break;
    }
    case 'attachments': {
      const idx = parseInt(args[1]||'1', 10);
      const r = listAtts(idx, FOLDER);
      if (r[0]?.startsWith('ERROR:')) { console.error('❌ '+r[0]); process.exit(1); }
      const total = parseInt((r[0]||'').replace('TOTAL:','')||'0', 10);
      console.log(`📎 #${idx} attachments: ${total}\n`);
      r.slice(1).forEach(l => {
        const [n,sz,m] = l.split('|');
        if (n) console.log(`  📄 ${n} (${(parseInt(sz)/1024).toFixed(1)}KB, ${m})`);
      });
      break;
    }
    case 'download': {
      const idx = parseInt(args[1]||'1', 10);
      const dir = flag('--dir')||flag('--download-dir')||path.join(os.homedir(),'Downloads');
      const result = downloadAtts(idx, FOLDER, dir);
      if (result.startsWith('ERROR:')||result==='No attachments') { console.error('❌ '+result); process.exit(1); }
      console.log(`✅ Downloaded to ${dir}:`);
      result.split('\n').forEach(f => console.log('  📄 '+f));
      break;
    }
    case 'compose': {
      const to = flag('--to');
      const subj = flag('--subject')||'(no subject)';
      const body = flag('--body')||'';
      const cc = flag('--cc');
      const bcc = flag('--bcc');
      const attach = flag('--attach')||flag('--file');
      const send = args.includes('--send');
      if (!to) { console.error('❌ --to required'); process.exit(1); }
      const r = compose(to, subj, body, cc, bcc, attach, send);
      if (!r[0]?.startsWith('ERROR:')) {
        console.log(`${send ? '📤 Sent' : '📝 Draft'} (ID: ${r[0]})`);
        if (!send) console.log('   Use --send to actually send');
      } else console.error('❌ '+r.join('\n'));
      break;
    }
    case 'reply': {
      const idx = parseInt(args[1]||'1', 10);
      const body = flag('--body')||'';
      const cc = flag('--cc');
      const send = args.includes('--send');
      if (!body) { console.error('❌ --body required'); process.exit(1); }
      const r = replyMsg(idx, body, FOLDER, cc, send);
      if (!r[0]?.startsWith('ERROR:')) {
        console.log(`${send ? '📤 Replied' : '📝 Reply draft'} (ID: ${r[0]})`);
        if (!send) console.log('   Use --send to actually send');
      } else console.error('❌ '+r.join('\n'));
      break;
    }
    case 'forward': {
      const idx = parseInt(args[1]||'1', 10);
      const to = flag('--to');
      const body = flag('--body')||'';
      const send = args.includes('--send');
      if (!to) { console.error('❌ --to required'); process.exit(1); }
      const r = fwdMsg(idx, to, body, FOLDER, send);
      if (!r[0]?.startsWith('ERROR:')) {
        console.log(`${send ? '📤 Forwarded' : '📝 Forward draft'} (ID: ${r[0]})`);
        if (!send) console.log('   Use --send to actually send');
      } else console.error('❌ '+r.join('\n'));
      break;
    }
    default:
      console.error('❌ Unknown: '+COMMAND);
      console.error('   Commands: list, search, read, folders, accounts');
      console.error('   Actions:  compose, reply, forward');
      console.error('   Files:    attachments, download');
      process.exit(1);
  }
} catch(e) { console.error('❌ '+e.message); process.exit(1); }
