#!/usr/bin/env node
/**
 * config.js - 共用路徑常量 Module
 * 集中管理所有路徑，消除 hardcoded fallback
 *
 * 用法：
 *   const { HOME, WS, MEMORY_DIR, STATE_DIR } = require('./lib/config');
 *   // 或者用 rename
 *   const { WS: WORKSPACE_DIR } = require('./lib/config');
 *
 * Created: 2026-03-30
 */

const path = require('path');
const os = require('os');

// ==================== 基礎路徑 ====================
const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
if (!HOME) throw new Error('HOME environment variable required');
const WS = path.join(HOME, '.openclaw', 'workspace');

// ==================== Scripts / Memory / State ====================
const SCRIPTS_DIR = path.join(WS, 'scripts');
const MEMORY_DIR = path.join(WS, 'memory');
const STATE_DIR = path.join(WS, '.state');
const HA_STATE_DIR = path.join(WS, 'ha-state');
const ISSUES_DIR = path.join(WS, '.issues');

// ==================== 常用檔案路徑 ====================
const ERRORS_JSON = path.join(MEMORY_DIR, 'errors.json');
const OPENCLAW_CONFIG = path.join(HOME, '.openclaw', 'openclaw.json');

// ==================== 機器偵測 ====================
// Use explicit environment variable or fallback to path-based detection
const isBliss = process.env.NODE_NAME === 'bliss' ||
                (process.env.NODE_NAME === undefined && HOME.includes('bliss'));
const NODE_NAME = isBliss ? 'bliss' : 'ally';

// ==================== Skill Self-Learning Paths (Issue #133) ====================
// Centralized paths for skill-reviewer, skill-learner plugin, weekly_correction_loop
const SKILLS_ACTIVE = path.join(WS, 'skills');
const SKILLS_LEARNED = path.join(WS, 'skills-learned');
const SKILL_REVIEW_QUEUE = path.join(WS, '.skill_review_queue.jsonl');
const SKILL_REVIEW_ARCHIVE = path.join(WS, '.skill_review_archive.jsonl');
const SKILL_PROMPT_CACHE = path.join(WS, '.skill_prompt_cache.json');
const SKILL_METRICS = path.join(WS, '.skill_metrics.json');
const SKILLS_LEARNED_ARCHIVE = path.join(SKILLS_LEARNED, '_archive');

// ==================== Export ====================
module.exports = {
  HOME,
  WS,
  SCRIPTS_DIR,
  MEMORY_DIR,
  STATE_DIR,
  HA_STATE_DIR,
  ISSUES_DIR,
  ERRORS_JSON,
  OPENCLAW_CONFIG,
  isBliss,
  // Skill self-learning (Issue #133)
  SKILLS_ACTIVE,
  SKILLS_LEARNED,
  SKILL_REVIEW_QUEUE,
  SKILL_REVIEW_ARCHIVE,
  SKILL_PROMPT_CACHE,
  SKILL_METRICS,
  SKILLS_LEARNED_ARCHIVE,
  NODE_NAME,
  // CQM-006: 改進 atomic write 清理機制
  atomicWriteSync: (filePath, data) => {
    const fs = require('fs');
    const path = require('path');
    const tmpFile = filePath + '.tmp.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8);
    let writeSuccessful = false;

    try {
      // CQM-012: 明確指定編碼
      fs.writeFileSync(tmpFile, typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8');
      writeSuccessful = true;
      fs.renameSync(tmpFile, filePath);
    } catch (err) {
      throw err;
    } finally {
      // CQM-006: 確保清理 tmp 檔案 (即使 rename 成功後也可能有殘留)
      if (!writeSuccessful || fs.existsSync(tmpFile)) {
        try {
          if (fs.existsSync(tmpFile)) {
            fs.unlinkSync(tmpFile);
          }
        } catch (_) {
          // ignore cleanup errors - 嘗試異步清理
          try {
            fs.promises.unlink(tmpFile).catch(() => {});
          } catch (__) {}
        }
      }
    }
  }
};
