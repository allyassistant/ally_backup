#!/usr/bin/env node
/**
 * gia_send_embed.js — Analyze GIA cert and send embed via OpenClaw
 * Usage: node gia_send_embed.js <pdf_path> [channel_id]
 *
 * Uses the analyzer's generateDiscordEmbed() for rich formatting,
 * then sends via OpenClaw's message tool (no Discord bot token needed).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const ANALYZER = '$HOME/.openclaw/workspace/scripts/gia_cert_analyzer_refactored_v17.1.0.js';
const args = process.argv.slice(2);
if (args.length < 1) { console.error('Usage: node gia_send_embed.js <pdf_path> [channel_id]'); process.exit(1); }

const pdfPath = args[0];
const channelId = args[1] || '1473384999003619500';

// 1. Run analyzer
let stdout;
try {
  stdout = execFileSync('node', [ANALYZER, pdfPath, '--json'], { encoding: 'utf8', timeout: 120000, maxBuffer: 10*1024*1024 });
} catch (e) {
  console.error(`Analyzer failed: ${e.message}`);
  process.exit(1);
}
const result = JSON.parse(stdout);
const analyzer = require(ANALYZER);

// 2. Generate embed
const embed = analyzer.generateDiscordEmbed({ data: result.data, scoring: result.scoring });

// 3. Format as rich text (Discord-compatible markdown)
const lines = [];
lines.push(`**${embed.title}**`);
lines.push('');

for (const field of embed.fields) {
  const val = field.value
    .replace(/\*\*/g, '')     // strip bold markers
    .replace(/•/g, '▸')       // nicer bullets
    .replace(/\[(-?\d+)\]/g, '($1)');  // brackets → parens
  lines.push(`**${field.name}**`);
  lines.push(val);
  lines.push('');
}

const message = lines.join('\n').slice(0, 1950); // Discord 2000 char limit

// 4. Send via OpenClaw
try {
  execFileSync('/opt/homebrew/bin/openclaw', [
    'message', 'send',
    '--channel', 'discord',
    '--target', `channel:${channelId}`,
    '--message', message
  ], { timeout: 15000 });
} catch (e) {
  console.error(`Failed to send Discord message: ${e.message}`);
}

console.log('✅ Sent');
