#!/usr/bin/env node
/**
 * webbridge_recover.js — Kimi WebBridge Extension Recovery SOP
 *
 * Trigger: `~/.kimi-webbridge/bin/kimi-webbridge status` shows
 *          `extension_connected: false` AND `lsof -i :9222` shows no LISTEN.
 *
 * Steps (5):
 *   1. Verify extension source exists
 *   2. Verify Chrome profile exists
 *   3. Launch Debug Chrome (port 9222, user's regular profile)
 *   4. Load extension via CDP Extensions.loadUnpacked
 *   5. Verify daemon detects connection
 *
 * Reference: ~/.openclaw/workspace/.issues/active/160-kimi-webbridge-poc-x-link-logi.md
 * Created: 2026-06-19 (after WebBridge dropped @ 10:31 same day)
 */

const { execSync, spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

const EXT_DIR = (process.env.HOME || '/Users/ally') + '/Library/Application Support/Google/Chrome/Default/Extensions/fldmhceldgbpfpkbgopacenieobmligc';
// Auto-detect latest version
const fs = require('fs');
let EXT_VER;
try {
  EXT_VER = fs.readdirSync(EXT_DIR).filter(f => fs.statSync(EXT_DIR+'/'+f).isDirectory()).sort().pop();
} catch (e) {
  console.error(`Operation failed: ${e.message}`);
}
const EXT_PATH = EXT_DIR + '/' + EXT_VER;
const EXT_ID = 'fldmhceldgbpfpkbgopacenieobmligc';
const PROFILE = `${process.env.HOME}/Library/Application Support/Google/Chrome/Default`;
const PORT = 9222;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG_FILE = '/tmp/webbridge-chrome.log';

function step(n, msg) { console.log(`\n[Step ${n}] ${msg}`); }
function ok(msg) { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }
function fail(msg) { console.error(`  ❌ ${msg}`); process.exit(1); }

function shell(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim(); }
  catch { return ''; }
}

async function loadExtension() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/json/version`, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const { webSocketDebuggerUrl } = JSON.parse(data);
          const ws = new WebSocket(webSocketDebuggerUrl);
          ws.on('open', () => {
            ws.send(JSON.stringify({
              id: 1,
              method: 'Extensions.loadUnpacked',
              params: { path: EXT_PATH },
            }));
          });
          ws.on('message', (d) => {
            const msg = JSON.parse(d.toString());
            ws.close();
            if (msg.result?.id) resolve(msg.result.id);
            else reject(new Error(`LoadUnpacked failed: ${JSON.stringify(msg)}`));
          });
          ws.on('error', reject);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

(async function main() {
  console.log('🛠️  Kimi WebBridge Recovery SOP');
  console.log('================================\n');

  step(1, 'Verify extension source exists');
  if (shell(`[ -d "${EXT_PATH}" ] && echo OK`)) ok(`Extension found: ${EXT_PATH}`);
  else fail(`Extension source missing: ${EXT_PATH}\n   Open Chrome → extensions → Kimi WebBridge → install/extract to this path`);

  step(2, 'Verify Chrome profile exists');
  if (shell(`[ -d "${PROFILE}" ] && echo OK`)) ok(`Profile found: ${PROFILE}`);
  else fail(`Profile missing: ${PROFILE}\n   This is the user's regular Chrome profile`);

  step(3, 'Launch Debug Chrome (port 9222)');
  const listening = shell(`lsof -nP -iTCP:${PORT} -sTCP:LISTEN 2>/dev/null | grep -iE 'chrom|google'`);
  if (listening) {
    warn(`Chrome already listening on :${PORT} — skipping launch`);
  } else {
    const args = [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-features=Translate,MediaRouter',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--password-store=basic', '--no-proxy-server',
    ];
    const fs = require('fs');
    const out = fs.openSync(LOG_FILE, 'a');
    const child = spawn(CHROME, args, { detached: true, stdio: ['ignore', out, out] });
    child.unref();
    ok(`Launched Chrome (pid ${child.pid}) — log: ${LOG_FILE}`);
    // Wait for port to be ready
    let ready = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (shell(`lsof -nP -iTCP:${PORT} -sTCP:LISTEN 2>/dev/null | grep -qiE 'chrom|google' && echo OK`)) {
        ready = true; break;
      }
    }
    if (ready) ok(`Port ${PORT} listening`);
    else fail(`Chrome did not open :${PORT} within 15s — check ${LOG_FILE}`);
  }

  step(4, 'Load extension via CDP Extensions.loadUnpacked');
  try {
    const id = await loadExtension();
    if (id === EXT_ID) ok(`Extension loaded (id: ${id})`);
    else warn(`Loaded different extension id: ${id} (expected ${EXT_ID})`);
  } catch (e) {
    fail(`CDP load failed: ${e.message}`);
  }

  step(5, 'Verify daemon detects connection');
  // Give the daemon a moment to register the WS
  await new Promise((r) => setTimeout(r, 2000));
  const status = shell(`~/.kimi-webbridge/bin/kimi-webbridge status`);
  console.log(`  ${status}`);
  const connected = /"extension_connected":true/.test(status);
  if (connected) ok('Daemon: extension_connected: true');
  else fail('Daemon still shows extension_connected: false — check ~/.kimi-webbridge/logs/daemon.log');

  console.log('\n✅ Recovery complete. WebBridge ready for use.\n');
})();
