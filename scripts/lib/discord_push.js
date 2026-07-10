#!/usr/bin/env node
/**
 * lib/discord_push.js — Centralized Discord push to OpenClaw
 *
 * Replaces per-script execFileSync boilerplate for sending messages to
 * Discord channels (default: #⚙️系統 = 1473376125584670872).
 *
 * Fail-soft: any error is logged and returned as { ok: false, error }.
 * Does NOT throw.
 *
 * Usage:
 *   const discord = require('./lib/discord_push');
 *   const result = await discord.push({ message: 'hello' });
 *   const result = await discord.push({ message: 'long msg', target: 'channel:1473384999003619500' });
 *   const result = await discord.push({ message, dryRun: true });
 */
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const { WS, STATE_DIR } = require('./config');

const OPENCLAW_BIN = '/opt/homebrew/bin/openclaw';
const SYSTEM_CHANNEL = 'channel:1473376125584670872'; // #⚙️系統
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_MESSAGE_BYTES = 1900; // Discord limit ~2000, leave 100 chars headroom

// Optional: in-memory cache of last successful push (for testing)
/** @type {{ts: string, target: string, message: string, ok: boolean} | null} */
let _lastPush = null;

/**
 * Push a message to Discord.
 *
 * @param {object} args
 * @param {string} args.message     — Message text (required)
 * @param {string} [args.target]    — Target like 'channel:1473376125584670872' (default: system channel)
 * @param {boolean} [args.dryRun]   — If true, log only, don't push
 * @param {number} [args.timeoutMs] — Per-call timeout (default 30s)
 * @param {boolean} [args.silent]   — Discord silent flag (no notification)
 * @returns {{ok: boolean, skipped?: boolean, error?: string, output?: string, latencyMs?: number}}
 */
function push(args) {
  if (!args || !args.message) {
    return { ok: false, error: 'message is required' };
  }

  const target = args.target || SYSTEM_CHANNEL;
  const message = args.message;
  const dryRun = !!args.dryRun;
  const silent = !!args.silent;
  const timeoutMs = args.timeoutMs || DEFAULT_TIMEOUT_MS;

  // Discord's 2000-char limit is based on UTF-8 bytes, not JS string length.
  // Chinese/CJK chars are 3 bytes each in UTF-8, so a 700-char Chinese message
  // is ~2100 bytes and would be rejected. Use Buffer.byteLength for accuracy.
  const byteLength = Buffer.byteLength(message, 'utf8');
  if (byteLength > MAX_MESSAGE_BYTES) {
    return { ok: false, error: `message too long: ${byteLength} > ${MAX_MESSAGE_BYTES} bytes` };
  }

  const start = Date.now();
  if (dryRun) {
    const result = { ok: true, skipped: true, dryRun: true, message, target };
    _lastPush = { ts: new Date().toISOString(), target, message, ok: true };
    return result;
  }

  try {
    const cmdArgs = [
      'message', 'send',
      '--channel', 'discord',
      '--target', target,
      '--message', message,
    ];
    if (silent) cmdArgs.push('--silent');

    const output = execFileSync(OPENCLAW_BIN, cmdArgs, {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = {
      ok: true,
      output: (output || '').trim(),
      latencyMs: Date.now() - start,
    };
    _lastPush = { ts: new Date().toISOString(), target, message, ok: true };
    return result;
  } catch (e) {
    const error = (e.stderr || e.message || String(e)).toString().slice(0, 300);
    _lastPush = { ts: new Date().toISOString(), target, message, ok: false };
    return { ok: false, error, latencyMs: Date.now() - start };
  }
}

/**
 * Push a Chinese-style status line. Convenience for the most common pattern.
 */
function pushSystemChannel(message, opts = {}) {
  return push({ ...opts, message });
}

/**
 * Get the last push (for testing/debugging).
 */
function getLastPush() {
  return _lastPush;
}

/**
 * Get the system channel target string. Useful for tests.
 */
function getSystemChannel() {
  return SYSTEM_CHANNEL;
}

module.exports = {
  OPENCLAW_BIN,
  SYSTEM_CHANNEL,
  MAX_MESSAGE_BYTES,
  push,
  pushSystemChannel,
  getLastPush,
  getSystemChannel,
};
