#!/usr/bin/env node
/**
 * minimax_reasoning_scrubber.js — CLI Reasoning Scrubber
 * =====================================================
 *
 * Filters MiniMax M3 reasoning text from assistant content.
 * Can be used standalone (CLI) or as a processing step.
 *
 * Usage:
 *   # Pipe a JSON content array:
 *   echo '[{"type":"text","text":"thinking..."},{"type":"toolCall","name":"read"},{"type":"text","text":"answer"}]' \
 *     | node minimax_reasoning_scrubber.js
 *
 *   # Process a text file:
 *   cat output.json | node minimax_reasoning_scrubber.js --json
 *
 *   # Deep scrub (heuristic + pattern matching):
 *   cat output.json | node minimax_reasoning_scrubber.js --deep
 *
 *   # Just scan for potential leaks (no modify):
 *   node minimax_reasoning_scrubber.js --scan < content.txt
 *
 * VERSION: 1.0.0
 * AUTHOR: Ally (2026-06-07)
 */

'use strict';

const { scrubContent, deepScrubContent, hasReasoningPattern } = require('./lib/minimax_scrubber_core.js');

function showUsage() {
  console.log(`Usage: node minimax_reasoning_scrubber.js [--deep] [--json] [--scan]

Options:
  --deep    Use heuristic + pattern matching (extra safety)
  --json    Input is a JSON content array (stdin)
  --scan    Just scan for potential reasoning leaks, don't modify
  --help    Show this message

Examples:
  echo '[{"type":"text","text":"Let me check..."},{"type":"toolCall",...},{"type":"text","text":"Yes"}]' \\
    | node minimax_reasoning_scrubber.js

  cat session_output.json | node minimax_reasoning_scrubber.js --deep --json

  node minimax_reasoning_scrubber.js --scan < reply.txt`);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showUsage();
    process.exit(0);
  }

  const deepMode = args.includes('--deep');
  const jsonMode = args.includes('--json');
  const scanMode = args.includes('--scan');

  const input = await readStdin();
  if (!input || !input.trim()) {
    console.error('❌ No input provided (stdin empty)');
    process.exit(1);
  }

  if (scanMode) {
    // Scan mode: detect leaks without modifying
    const lines = input.split('\n');
    let reasoningLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (hasReasoningPattern(line) && line.length > 30) {
        reasoningLines.push({ line: i + 1, text: line.slice(0, 120) });
      }
    }

    if (reasoningLines.length === 0) {
      console.log('✅ No reasoning patterns detected');
    } else {
      console.log(`⚠️ ${reasoningLines.length} potential reasoning lines found:\n`);
      reasoningLines.forEach(r => {
        console.log(`  L${r.line}: ${r.text}...`);
      });
    }
    process.exit(0);
  }

  if (jsonMode) {
    // JSON array mode
    try {
      const content = JSON.parse(input);
      const scrubFn = deepMode ? deepScrubContent : scrubContent;
      const cleaned = scrubFn(content);

      if (JSON.stringify(cleaned) === JSON.stringify(content)) {
        console.log('✅ No reasoning text detected');
      } else {
        const removed = content.length - cleaned.length;
        console.log(`✅ Scrubbed ${removed} reasoning block(s)`);
      }

      console.log(JSON.stringify(cleaned, null, 2));
    } catch (err) {
      console.error('❌ Invalid JSON input:', err.message);
      process.exit(1);
    }
  } else {
    // Plain text mode: detect reasoning patterns and flag
    const scrubFn = deepMode ? deepScrubContent : scrubContent;
    const textBlocks = [{ type: 'text', text: input }];

    if (hasReasoningPattern(input)) {
      console.log('⚠️ Input appears to contain reasoning text!');
    }

    // Pass-through for plain text (main filter happens at content array level)
    console.log(input);
  }
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
