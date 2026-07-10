#!/usr/bin/env node
/**
 * vault_index_refresh.js
 * Auto-updates the "Recently Updated" section in 00-Index.md.
 * Scheduled via OpenClaw cron: 0 3 * * * (03:00 HKT daily)
 *
 * Usage:
 *   node vault_index_refresh.js                   # live run, 7 days
 *   node vault_index_refresh.js --dry-run        # print to stdout only
 *   node vault_index_refresh.js --days 3         # custom window
 *   node vault_index_refresh.js --vault /path    # alternate vault
 *   node vault_index_refresh.js --help
 */

const fs = require('fs');
const path = require('path');

const VAULT = process.argv.includes('--vault')
  ? process.argv[process.argv.indexOf('--vault') + 1]
  : path.join(process.env.HOME, 'Documents/Obsidian Vault');

const DAYS = (() => {
  const idx = process.argv.indexOf('--days');
  if (idx === -1) return 7;
  const n = parseInt(process.argv[idx + 1], 10);
  return isNaN(n) || n < 1 || n > 365 ? 7 : n;
})();

const DRY_RUN = process.argv.includes('--dry-run');
const HELP = process.argv.includes('--help') || process.argv.includes('-h');

const INDEX_FILE = path.join(VAULT, '00-Index.md');
const BEGIN_MARKER = '<!-- BEGIN auto-refresh:recent -->';
const END_MARKER = '<!-- END auto-refresh:recent -->';

const SCAN_FOLDERS = ['Knowledge', 'MOCs', 'Daily'];

function scanVault() {
  const cutoff = Date.now() - DAYS * 86400000;
  const recent = [];

  for (const folder of SCAN_FOLDERS) {
    const folderPath = path.join(VAULT, folder);
    if (!fs.existsSync(folderPath)) continue;

    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const fullPath = path.join(folderPath, entry.name);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs >= cutoff) {
        const title = entry.name.replace(/\.md$/, '').replace(/-/g, ' ');
        recent.push({ title, folder, mtime: stat.mtimeMs, path: fullPath });
      }
    }
  }

  recent.sort((a, b) => b.mtime - a.mtime);
  return recent;
}

function formatSection(recent) {
  if (recent.length === 0) {
    return `${BEGIN_MARKER}\n*（過去 ${DAYS} 日沒有更新）*\n${END_MARKER}`;
  }

  const rows = recent.slice(0, 20).map(({ title, folder }) => {
    const date = new Date().toLocaleDateString('zh-Hant', {
      month: 'numeric', day: 'numeric'
    });
    return `| ${date} | [[${title}]] | ${folder} |`;
  });

  return `${BEGIN_MARKER}
${rows.join('\n')}
${END_MARKER}`;
}

function updateIndex(section) {
  let content = fs.readFileSync(INDEX_FILE, 'utf8');

  const begin = content.indexOf(BEGIN_MARKER);
  const end = content.indexOf(END_MARKER);

  if (begin === -1 || end === -1) {
    console.error('Markers not found in index. Exiting.');
    process.exit(1);
  }

  const newContent =
    content.slice(0, begin) + section + '\n' + content.slice(end + END_MARKER.length);

  if (DRY_RUN) {
    console.log(newContent);
  } else {
    const tmp = INDEX_FILE + '.tmp';
    fs.writeFileSync(tmp, newContent);
    fs.renameSync(tmp, INDEX_FILE);
    console.log(`Updated ${INDEX_FILE} with ${recent.length} recent files.`);
  }
}

function main() {
  if (HELP) {
    console.log(`Usage: node vault_index_refresh.js [options]
Options:
  --dry-run       Print to stdout, no file write
  --days N        Window in days (default: 7, max: 365)
  --vault PATH    Alternate vault path
  --help, -h      Show this message`);
    return;
  }

  if (!fs.existsSync(INDEX_FILE)) {
    console.error(`Index file not found: ${INDEX_FILE}`);
    process.exit(1);
  }

  const recent = scanVault();
  const section = formatSection(recent);
  updateIndex(section);
}

main();
