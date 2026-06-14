#!/usr/bin/env node
/**
 * minimax_scrubber_core.js — Reasoning Text Scrubber Core Module
 * ===============================================================
 *
 * Filters out MiniMax M3 reasoning text that leaks into user-visible
 * Discord messages via the text channel.
 *
 * Root cause (from Task B analysis):
 *   MiniMax M3 emits reasoning as plain prose in `text` blocks rather
 *   than separated `thinking` blocks. OpenClaw's sanitization pipeline
 *   only strips XML tags (<thinking>) and line-prefix patterns, so
 *   plain-prose reasoning goes straight through to Discord.
 *
 * Detection heuristic (reliable):
 *   If an assistant message contains BOTH text blocks AND toolCall blocks,
 *   the text blocks that come before the LAST toolCall are reasoning.
 *   Only the LAST text block (after all toolCalls) is the actual answer.
 *
 * Edge case: No toolCall blocks → single text block is the answer.
 *
 * Usage:
 *   const { scrubContent, isReasoningBlock } = require('./lib/minimax_scrubber_core.js');
 *   const cleaned = scrubContent(contentArray);
 *
 * VERSION: 1.0.0
 * AUTHOR: Ally (2026-06-07)
 */

'use strict';

/**
 * Check if a content block is a reasoning text block.
 * A text block is considered reasoning if:
 * - It's a text block
 * - And there's at least one toolCall AFTER it in the same message
 *
 * @param {object} block - Content block { type, text }
 * @param {object[]} allBlocks - Full content array
 * @param {number} index - Index of this block in allBlocks
 * @returns {boolean}
 */
function isReasoningBlock(block, allBlocks, index) {
  // Only text blocks can be reasoning
  if (block.type !== 'text') return false;

  // If this is text, check if there's a toolCall AFTER it in the array
  const remaining = allBlocks.slice(index + 1);
  const hasToolCallAfter = remaining.some(b => b.type === 'toolCall');

  return hasToolCallAfter;
}

/**
 * Scrub a content array, removing reasoning text blocks.
 *
 * @param {object[]} content - Array of content blocks
 *   [{ type: 'text', text: '...' }, { type: 'toolCall', ... }, { type: 'text', text: 'answer' }]
 * @returns {object[]} Cleaned content array with reasoning text removed
 */
function scrubContent(content) {
  if (!Array.isArray(content) || content.length === 0) {
    return content;
  }

  // Fast path: no toolCall blocks → no reasoning leak possible
  const hasToolCall = content.some(b => b.type === 'toolCall');
  if (!hasToolCall) {
    return content;
  }

  // Filter out text blocks that are before/among toolCalls
  const cleaned = content.filter((block, index) => {
    return !isReasoningBlock(block, content, index);
  });

  return cleaned;
}

/**
 * Check if a text string has reasoning-like patterns.
 * This is a supplementary check for cases where the heuristic
 * might miss edge cases (e.g., multi-turn conversations).
 *
 * @param {string} text - Text to check
 * @returns {boolean}
 */
function hasReasoningPattern(text) {
  if (!text || typeof text !== 'string') return false;

  // Common reasoning patterns from MiniMax M3 output
  const reasoningPrefixes = [
    /^(Let me\s)/i,
    /^(Now I\s(need|have|can|will|am|want|should|shall|must|would|could))/i,
    /^(I\s(need|should|will|must|shall|want|can|could|would)\sto\s)/i,
    /^(OK[,]?\s*(so\s)?(let\sme|I\s))/i,
    /^(There\s(is|are|was|were)\s)/i,
    /^(First[,]?\s*(let|I))\s/i,
  ];

  for (const prefix of reasoningPrefixes) {
    if (prefix.test(text.trim())) {
      // Check length: reasoning text is typically longer than a short answer
      // and ends without being a complete answer
      return true;
    }
  }

  return false;
}

/**
 * Full scrub with both heuristic AND pattern matching.
 * Use this for extra safety when the content structure is unreliable.
 *
 * @param {object[]} content - Array of content blocks
 * @returns {object[]} Cleaned content
 */
function deepScrubContent(content) {
  if (!Array.isArray(content) || content.length === 0) {
    return content;
  }

  // First pass: heuristic-based (toolCall position)
  let cleaned = scrubContent(content);

  // Second pass: pattern-based for any remaining blocks
  // that look like reasoning but weren't caught by heuristic
  cleaned = cleaned.filter((block, index) => {
    if (block.type !== 'text') return true;

    // If this is the last text block and has reasoning pattern,
    // AND it's long, it might still be reasoning
    const isLast = index === cleaned.length - 1;
    if (isLast) return true; // Keep last text block always

    return !hasReasoningPattern(block.text || '');
  });

  return cleaned;
}

module.exports = {
  isReasoningBlock,
  scrubContent,
  hasReasoningPattern,
  deepScrubContent
};
