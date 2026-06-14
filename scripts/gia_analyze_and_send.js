#!/usr/bin/env node
/**
 * gia_analyze_and_send.js — Analyze GIA cert PDF and send rich embed to Discord
 * Usage: node gia_analyze_and_send.js <pdf_path> [channel_id]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const ANALYZER = '$HOME/.openclaw/workspace/scripts/gia_cert_analyzer_refactored_v17.1.0.js';
const OPENCLAW = '/opt/homebrew/bin/openclaw';

const ANALYZER_TIMEOUT_MS = 120000;
const MAX_BUFFER_SIZE = 10 * 1024 * 1024;

// Discord embed color hex values
const COLOR_WARNING = 0xFFA500;   // CAUTION orange
const COLOR_DANGER  = 0xEB0000;   // REJECT red
const COLOR_SUCCESS = 0x57F000;   // BUY green
const COLOR_INFO    = 0xDFFF;     // default blue

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node gia_analyze_and_send.js <pdf_path> [channel_id]');
  process.exit(1);
}

const pdfPath = args[0];
const channelId = args[1] || '1473384999003619500'; // default #編程

if (!fs.existsSync(pdfPath)) {
  console.error('File not found:', pdfPath);
  process.exit(1);
}

// 1. Run analyzer with --json
console.log(`🔍 Analyzing ${path.basename(pdfPath)}...`);
let stdout;
try {
  stdout = execFileSync('node', [ANALYZER, pdfPath, '--json'], {
    encoding: 'utf8',
    timeout: ANALYZER_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_SIZE
  });
} catch (e) {
  console.error(`Analyzer failed: ${e.message}`);
  process.exit(1);
}

const result = JSON.parse(stdout);
const analyzer = require(ANALYZER);

// 2. Generate Discord embed
const embed = analyzer.generateDiscordEmbed({
  data: result.data,
  scoring: result.scoring
});

// 3. Build presentation payload (Discord embed color hex values)
const colorMap = {
  [COLOR_WARNING]: 'warning',
  [COLOR_DANGER]:  'danger',
  [COLOR_SUCCESS]: 'success',
  [COLOR_INFO]:    'info'
};
const tone = colorMap[embed.color] || 'info';

const blocks = [
  { type: 'text', text: `**${embed.title}**` }
];

// Use key fields only for compact display
const specField = embed.fields.find(f => f.name === '💎 Gem Specifications');
const scoreField = embed.fields.find(f => f.name === '📊 Score & Verdict');
const criticalField = embed.fields.find(f => f.name === '🔴 CRITICAL');
const posField = embed.fields.find(f => f.name === '✨ Positive Highlights');
const recField = embed.fields.find(f => f.name === '💰 Purchase Recommendation');

if (specField) {
  const lines = specField.value.split('\n').slice(0, 6);
  blocks.push({ type: 'text', text: '```' + lines.join('\n').replace(/\*\*/g, '') + '```' });
}

if (scoreField) {
  blocks.push({ type: 'text', text: scoreField.value.replace(/\*\*/g, '') });
}

if (criticalField) {
  blocks.push({ type: 'text', text: criticalField.value });
}

if (posField) {
  const posLines = posField.value.split('\n').slice(0, 4);
  blocks.push({ type: 'text', text: posLines.join('\n') });
}

if (recField) {
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'text', text: recField.value.replace(/\*\*/g, '') });
}

// Build presentation JSON
const presentation = {
  title: embed.title,
  tone: tone,
  blocks: blocks
};

const presJson = JSON.stringify(presentation).replace(/"/g, '\\"');

// 4. Send via OpenClaw
try {
  execSync(`${OPENCLAW} message send --channel discord --target channel:${channelId} --presentation '${JSON.stringify(presentation)}'`, {
    timeout: 15000,
    encoding: 'utf8'
  });
  console.log('✅ Sent to Discord');
} catch (e) {
  // Fallback: send as plain text
  const text = embed.fields.map(f => `**${f.name}**\n${f.value.replace(/\*\*/g, '')}`).join('\n\n');
  execSync(`${OPENCLAW} message send --channel discord --target channel:${channelId} --message "${text.slice(0, 1900).replace(/"/g, '\\"')}"`, {
    timeout: 15000,
    encoding: 'utf8'
  });
  console.log('✅ Sent as text (presentation fallback)');
}

console.log('Done');
