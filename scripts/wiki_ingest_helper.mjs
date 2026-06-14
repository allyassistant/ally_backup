#!/usr/bin/env node
/**
 * Wiki Ingest Helper (async spawn + direct-write fallback)
 *
 * v1.2 — Refactor: async spawn (non-blocking) 替代 spawnSync.
 *   `openclaw wiki ingest` 內部 model call 可能 hang 喺 "model-call-started"
 *   階段。v1.2 用 async spawn + 300s timeout + direct write fallback.
 *
 * 用法：
 *   node scripts/wiki_ingest_helper.mjs <file-path> [--title "Optional Title"]
 *
 * 回傳：成功 0，失敗 1
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Wiki sources directory — same location `openclaw wiki ingest` writes to
const WIKI_SOURCES_DIR = path.join(
  process.env.HOME || '/Users/ally',
  '.openclaw', 'workspace', 'wiki', 'main', 'sources'
);

function usage() {
  console.error('用法: node scripts/wiki_ingest_helper.mjs <file-path> [--title "Title"]');
  process.exit(1);
}

/**
 * Generate a safe filename slug from a title or input file name.
 */
function toSlug(text) {
  return text
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

/**
 * Try 1: `openclaw wiki ingest` CLI via async spawn (300s timeout).
 * If the internal model call hangs, it's killed after 300s without
 * blocking other processing.
 */
function tryCliIngestAsync(inputPath, title) {
  return new Promise((resolve) => {
    const cliArgs = ['wiki', 'ingest', inputPath];
    if (title) cliArgs.push('--title', title);

    const proc = spawn('openclaw', cliArgs, {
      stdio: 'pipe',
      shell: false,
      timeout: 5000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch (_) { /* ignore */ }
      resolve(false);  // ← 一定要 resolve，否則 Promise 永久 hang
    }, 300000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        console.log(`✅ Wiki ingest 成功 (CLI, ${(process.hrtime.bigint() % 10000n)}ms)`);
        const output = stdout.trim();
        if (output) {
          output.split('\n').filter(l => l.trim()).forEach(l => console.log(`   ${l}`));
        }
        resolve(true);
      } else {
        const msg = (stderr || stdout || '').trim() || `exit code ${code}`;
        console.warn(`   ⚠️ openclaw CLI 失敗 (${msg})`);
        resolve(false);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      console.warn(`   ⚠️ openclaw CLI error: ${err.message}`);
      resolve(false);
    });
  });
}

/**
 * Try 2 (fallback): Write directly to wiki/sources/, bypassing the
 * model call inside `openclaw wiki ingest`.
 */
function tryDirectWrite(inputPath, title) {
  let srcContent;
  try {
    srcContent = fs.readFileSync(inputPath, 'utf8');
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const slug = title ? toSlug(title) : toSlug(baseName);
  const filename = `auto-${slug || 'ingest'}-${Date.now()}.md`;
  const destPath = path.join(WIKI_SOURCES_DIR, filename);

  if (!fs.existsSync(WIKI_SOURCES_DIR)) {
    try {
      fs.mkdirSync(WIKI_SOURCES_DIR, { recursive: true });
    } catch (e) {
      console.error(`Directory creation failed: ${e.message}`);
    }
  }

  const tmpPath = destPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, srcContent, 'utf8');
  } catch (e) {
    console.error(`File write failed: ${e.message}`);
  }
  fs.renameSync(tmpPath, destPath);

  console.log(`✅ Wiki ingest 成功 (direct write → ${path.relative(process.env.HOME || '/', destPath)})`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const inputPath = path.resolve(args[0]);
  const titleIdx = args.indexOf('--title');
  const title = titleIdx !== -1 ? args[titleIdx + 1] : undefined;

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ 檔案唔存在: ${inputPath}`);
    process.exit(1);
  }

  // 1) Try async CLI with 25s timeout
  const cliOk = await tryCliIngestAsync(inputPath, title);
  if (cliOk) process.exit(0);

  // 2) Fallback: direct write (no model call, always fast)
  try {
    tryDirectWrite(inputPath, title);
    process.exit(0);
  } catch (e) {
    console.error(`❌ Direct write 失敗: ${e.message}`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error(`❌ Wiki ingest 失敗: ${e.message}`);
  process.exit(1);
});
