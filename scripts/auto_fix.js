#!/usr/bin/env node
const ONE_DAY_MS = 86400000; // 24h in ms
const MAX_FILE_SIZE_BYTES = 100000; // 100KB cap for audit scanner (skip huge files)

/**
 * ==================== Auto-Audit System ====================
 * 自動審計系統 - 掃描、修復低風險問題、報告高風險問題
 *
 * 使用方法:
 *   node scripts/auto_fix.js              # 審計 + 生成報告（預設）
 *   node scripts/auto_fix.js fix           # 審計 + 自動修復 Low-risk
 *   node scripts/auto_fix.js scan         # 只掃描，不修復 (read-only)
 *   node scripts/auto_fix.js report       # 查看上次報告
 *   node scripts/auto_fix.js confirm <id> # 人工確認 high-risk 修改
 *   node scripts/auto_fix.js --dry-run    # 預覽模式（唔會改任何嘢）
 *   node scripts/auto_fix.js fix --min-confidence=0.90  # 高置信度先 auto-fix
 *   node scripts/auto_fix.js fix --quarantine  # 所有 fix 都寫入 quarantine
 *   node scripts/auto_fix.js --since 7    # 掃描最近 N 日改過嘅檔案
 *
 * ==================== Phase 4: Confidence Gating (#189) ====================
 * --min-confidence=N  : Minimum confidence to auto-fix (default: 0.90)
 * --quarantine        : Force all fixes to quarantine (bypass confidence)
 *
 * ==================== 邏輯流程 ====================
 *   1. 掃描 errors.json (未解決錯誤)
 *   2. 掃描 scripts/ (自上次 audit 後修改的檔案)
 *   3. 本地 Scanner 靜態分析每個檔案
 *   4. MiniMax (M3) 生成問題 brief (寫入 auto_fix_spawn.json)
 *   5. 自動修復 low-risk 問題 (doc/formatting/simple bugs)
 *   6. 生成報告 (auto_fix_report.json)，列出 high-risk 問題
 *
 * ==================== 模型說明 ====================
 *   - Scanner: 本地 Node.js (regex 靜態分析)
 *   - Brief 生成: MiniMax M3 (寫入 SPAWN_PAYLOAD)
 *   - 修復: 需人手 spawn Kimi Code CLI (scripts_spawn)
 *
 * ==================== 分類準則 ====================
 *   Low-risk (即時修): trailing whitespace, missing EOF newline,
 *       hardcoded paths, 簡體→繁體, 重複空行, missing shebang
 *   High-risk (待確認): eval(), hardcoded secrets, missing error handling,
 *       架構問題, deprecated API, 超長檔案
 *   Other Issues (智能發現): 除以上固定 pattern 外，
 *       Auto 應主動發現其他問題如：邏輯錯誤、效能問題、
 *       安全漏洞、不一致既代碼風格、未處理既邊界情況等
 *
 * ==================== 輸出檔案 ====================
 *   .state/auto_fix_brief.md      - AI 分析 brief (俾 sub-agent 用)
 *   .state/auto_fix_report.json   - 完整問題報告
 *   .state/auto_fix_spawn.json    - Spawn payload (可俾 Kimi Code CLI 用)
 *   .state/auto_fix_history.json  - 歷史記錄
 */

const fs = require('fs');
const helpers = require('./lib/helpers');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { addFixRecord } = require('./auto_fix_history');
const { getConfidenceTier } = require('./cqm_confidence');
const { safeFix, quarantineFix } = require('./cqm_safe_writer');

// ==================== CONFIG ====================
const { HOME, WS, SCRIPTS_DIR, ERRORS_JSON, STATE_DIR } = require('./lib/config');

// ====================================================================
// Phase 2 (2026-06-26): USE_AST_RULES feature flag
//
// When true (default post-Phase 1), the 4 buggy low-risk rules
// (optional-chaining, fs-sync-trycatch, hardcoded-home-path,
// simplified-chinese) prefer their AST-aware `experimentalAst` detect/fix
// implementations over the legacy regex-based ones.
//
// Rollback: set USE_AST_RULES=false to revert all 4 rules to legacy.
// Per-rule disable: set USE_AST_RULES=rule_id,false (comma-separated).
//
// Legacy detect/fix are preserved as fallback for the 2-week comparison
// period per the Phase 2 design doc.
// ====================================================================
const USE_AST_RULES = (() => {
  const raw = process.env.USE_AST_RULES;
  if (raw === undefined || raw === '') return true;  // default ON post-Phase 1
  if (raw === 'false' || raw === '0') return false;
  // Allow per-rule override: 'optional-chaining=false,fs-sync-trycatch=true'
  // Returns true/false for the global default, but per-rule checks use _astEnabledFor().
  return raw !== 'false';
})();

function _astEnabledFor(ruleId) {
  const raw = process.env.USE_AST_RULES;
  if (raw === undefined || raw === '') return true;
  if (raw === 'false' || raw === '0') return false;
  if (raw === 'true' || raw === '1') return true;
  // Parse comma-separated list: rule_id=true|false
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    const [id, val] = p.split('=').map(s => s && s.trim());
    if (id === ruleId) return val === 'true' || val === '1';
  }
  // No per-rule match — use global default
  return USE_AST_RULES;
}

/**
 * Resolve which `detect` function to use for a rule.
 * AST path is preferred when enabled AND the rule has an experimentalAst.detect.
 * Falls back to legacy `detect` (or `legacyDetect` if set).
 */
function _resolveDetect(rule) {
  if (!rule) return null;
  if (_astEnabledFor(rule.id) && rule.experimentalAst && typeof rule.experimentalAst.detect === 'function') {
    return rule.experimentalAst.detect;
  }
  return rule.legacyDetect || rule.detect;
}

/**
 * Resolve which `fix` function to use for a rule.
 */
function _resolveFix(rule) {
  if (!rule) return null;
  if (_astEnabledFor(rule.id) && rule.experimentalAst && typeof rule.experimentalAst.fix === 'function') {
    return rule.experimentalAst.fix;
  }
  return rule.legacyFix || rule.fix;
}
const AUDIT_STATE = path.join(STATE_DIR, 'last_audit.json');
const AUDIT_REPORT = path.join(STATE_DIR, 'auto_fix_report.json');
const AUDIT_LOG = path.join(STATE_DIR, 'auto_fix_history.json');
const SPAWN_PAYLOAD = path.join(STATE_DIR, 'auto_fix_spawn.json');
const AUDIT_BRIEF = path.join(STATE_DIR, 'auto_fix_brief.md');
const SKIP_LIST_FILE = path.join(STATE_DIR, 'auto_fix_skip_list.json');
const PURE_AI_AUDIT_RESULTS = path.join(STATE_DIR, 'pure_ai_audit_results.json');

// ==================== MODEL CONFIG ====================
// MiniMax M3 - 用於生成問題分析 brief
// 注意：呢個唔係用於修復，修復需要另外 spawn Kimi Code CLI
const DEFAULT_MODEL = 'minimax-portal/MiniMax-M2.7';
// 可選備選: 'minimax-portal/MiniMax-M2.5', 'ollama/qwen3:14b'

const DEFAULT_SINCE_DAYS = 7;     // 預設掃描最近 7 日
const MAX_FILE_LINES_WARN = 1000;  // 超過此行數提示拆分 (從500改為1000，避免過度警報)
const MAX_SCAN_FILES = 50;        // 單次最多掃描檔案數

// 自我排除：避免審計自己（規則定義中包含大量 pattern，會造成誤報）
// 自我排除：避免審計自己（規則定義中包含大量 pattern，會造成誤報）
const SKIP_DIRS = ['archive', '__tests__', 'lib/rules', 'lib/analyzers', 'lib/helpers'];
const SELF_EXCLUDE = ['auto_fix.js'];
// Test files are excluded from auto-fix because low-risk rules may
// corrupt string literals used as test data (e.g. /Users/ paths or
// fs calls inside test fixture strings). Test-scoped exclusions also
// cover /tmp/ paths (ephemeral fixtures).
// `debug_` prefix excludes scratch / debug scripts created during
// troubleshooting — they often contain test fixture strings too.
// `.bak`, `.broken`, `.tmp` are intermediate artifacts.
const FILE_EXCLUDE_PATTERNS = [
  /[\/_]test_/i,
  /^test_/i,
  /[\/_]debug_/i,
  /^debug_/i,
  /\.bak$/i,
  /\.broken$/i,
  /\.tmp$/i,
  /\/tmp\//,
];

// Spawn sub-agent 預設 Discord channel (從環境變數讀取，預設為編程頻道)
const DEFAULT_SPAWN_CHANNEL = process.env.DISCORD_PROGRAMMING_CHANNEL || '1473384999003619500';

// ==================== CLI ARGS ====================
const args = process.argv.slice(2);
const command = args.find(a => !a.startsWith('-')) || 'spawn';
const isDryRun = args.includes('--dry-run');
const isQuiet = args.includes('--quiet');

// Phase 4: Confidence-based fix gating
const minConfidenceArg = args.find(a => a.startsWith('--min-confidence'));
const MIN_CONFIDENCE = minConfidenceArg
  ? parseFloat(minConfidenceArg.split('=')[1] || args[args.indexOf(minConfidenceArg) + 1] || '0.90')
  : parseFloat(process.env.CQM_MIN_CONFIDENCE || '0.90');
const isQuarantineOnly = args.includes('--quarantine-only') || args.includes('--quarantine');

// Phase 4: Quarantine stats (for report)
let quarantineCount = 0;

// Format output: text (default), json, markdown
let outputFormat = 'text';
const formatArg = args.find(a => a.startsWith('--format'));
if (formatArg) {
  const val = formatArg.split('=')[1] || args[args.indexOf(formatArg) + 1];
  if (val === 'json' || val === 'markdown' || val === 'text') {
    outputFormat = val;
  }
}

// HKT time helper
function toHKT(isoString) {
  return new Date(isoString).toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong', hour12: false });
}
const sinceArg = args.find(a => a.startsWith('--since'));
let sinceDays = null;
if (sinceArg) {
  if (sinceArg.includes('=')) {
    sinceDays = parseInt(sinceArg.split('=')[1]) || DEFAULT_SINCE_DAYS;
  } else {
    sinceDays = parseInt(args[args.indexOf(sinceArg) + 1]) || DEFAULT_SINCE_DAYS;
  }
}

// ==================== COLOURS ====================
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(color, msg) {
  if (!isQuiet) console.log(`${C[color] || ''}${msg}${C.reset}`);
}

// ==================== LOW-RISK RULES ====================
// 每個 rule 有 id, name, detect(content, filePath), fix(content, filePath)
// detect 返回 { found: boolean, details: string, lines: number[] }
// fix 返回修改後的 content (或 null 代表不修改)
const { LOW_RISK_RULES } = require('./lib/rules/low-risk');
const { HIGH_RISK_RULES } = require('./lib/rules/high-risk');
const { runSystemAudit } = require('./lib/rules/system-audit');
const { validateFix, logValidation } = require('./lib/rules/validation');

// ==================== AUDIT → FIX RULE ID MAP ====================
// Bug 4 (2026-06-22): audit_just_written.js emits camelCase/snake_case rule
// IDs (`fsSync_missing_trycatch`, `magic_numbers`, `simplified_chinese`),
// but LOW_RISK_RULES uses kebab-case (`fs-sync-trycatch`, `magic-numbers-safe`,
// `simplified-chinese`). Without this map, `autoFixFile()` finds nothing
// and silently fixes 0 issues — direct cause of the "🛠️ 自動修復: ... —
// 修復咗 0 個問題" warning.
//
// `todo_fixme` is intentionally NOT in the map — low-risk.js has no
// equivalent auto-fix rule, so it's silently skipped (the || fallback
// returns the original id, find() returns undefined, loop continues).
//
// Do NOT change audit_just_written.js rule IDs (would break audit_realtime_dedup
// overrides) or low-risk.js rule IDs (other callers depend on them). This map
// is the SOLE translation layer.
const AUDIT_TO_FIX_RULE_MAP = {
  'fsSync_missing_trycatch': 'fs-sync-trycatch',
  'magic_numbers': 'magic-numbers-safe',
  'simplified_chinese': 'simplified-chinese',
  // 'todo_fixme' has no auto-fix equivalent — leave unmapped
  // 'no_empty_catch' is intentionally NOT mapped — `no-empty-catch` in
  // low-risk.js has no `fix()` because empty catches might be intentional
  // (cleanup code, best-effort operations). Detection-only; human review
  // required. The `|| issue.rule` fallback in autoFixFile() resolves the
  // audit snake_case id directly, then `find()` returns undefined and the
  // `if (!rule || !rule.fix) continue;` guard silently skips it.
};

// ==================== SYSTEM AUDIT ====================

/**
 * 系統審計 — 語法檢查、Hardcoded Paths、Cron 檢查、Dangling References
 * 獨立於檔案掃描流程，對整個 scripts/ 目錄執行全面檢查
 */

// ==================== CORE FUNCTIONS ====================

/**
 * 讀取上次 audit 狀態
 */
function loadAuditState() {
  try {
    if (fs.existsSync(AUDIT_STATE)) {
      try {
        return JSON.parse(fs.readFileSync(AUDIT_STATE, 'utf-8'));
      } catch (e) { /* ignore */ }
    }
  } catch { /* ignore */ }
  return { lastAudit: null, lastAuditFiles: [], version: 1 };
}

/**
 * 讀取 pure_ai_audit 結果
 */
function loadPureAIResults() {
  try {
    if (fs.existsSync(PURE_AI_AUDIT_RESULTS)) {
      try {
        const data = JSON.parse(fs.readFileSync(PURE_AI_AUDIT_RESULTS, 'utf-8'));
        // Support both 'issues' and 'findings' field names for compatibility
        return data.findings || data.issues || [];
      } catch (e) {
        console.warn('[loadPureAIResults] Parse error:', e.message);
        return [];
      }
    }
  } catch (e) {
    console.warn('[loadPureAIResults] File read error:', e.message);
  }
  return [];
}

/**
 * 保存 audit 狀態
 */
function saveAuditState(state) {
  if (isDryRun) return;
  ensureDir(STATE_DIR);
  const tmpFile = `${AUDIT_STATE}.tmp.${Date.now()}`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
    fs.renameSync(tmpFile, AUDIT_STATE);
  } catch (e) {
    console.error('Error saving audit state: ' + e.message);
    try {
      fs.unlinkSync(tmpFile);
    } catch { /* ignore */ }
  }
}

/**
 * 確保目錄存在
 */
function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (e) {
        if (e.code !== 'EEXIST') {
          console.error('Error creating directory: ' + e.message);
        }
      }
    }
  } catch (e) {
    console.error('Error checking directory: ' + e.message);
    return;
  }
}

/**
 * 找到自上次 audit 後（或最近 N 日內）修改的 scripts
 */
function findRecentFiles() {
  const state = loadAuditState();
  let sinceDate;

  if (sinceDays) {
    sinceDate = new Date(Date.now() - sinceDays * ONE_DAY_MS);
  } else {
    // 首次運行，掃描最近 7 日
    sinceDate = new Date(Date.now() - DEFAULT_SINCE_DAYS * ONE_DAY_MS);
  }

  const extensions = ['.js', '.sh', '.bash', '.py', '.mjs', '.cjs'];
  const excludeDirs = ['node_modules', '.git', 'archive', '__pycache__', 'auto-router', '__tests__', 'lib/rules', 'lib/analyzers', 'lib/helpers'];
  const files = [];

  function walk(dir, depth = 0) {
    if (depth > 2) return; // 最多 2 層深
    try {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) { return; }
      for (const entry of entries) {
        if (entry?.name?.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (excludeDirs.includes(entry.name)) continue;
          walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (!extensions.includes(ext)) continue;
          if (SELF_EXCLUDE.includes(entry.name)) continue;
          if (FILE_EXCLUDE_PATTERNS.some(p => p.test(fullPath))) continue;
          try {
            const stat = fs.statSync(fullPath);
            if (stat.mtime > sinceDate) {
              files.push({
                path: fullPath,
                name: entry.name,
                mtime: stat.mtime,
                size: stat.size,
              });
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  walk(SCRIPTS_DIR);

  // 按修改時間排序（最新的先）
  files.sort((a, b) => b.mtime - a.mtime);

  // 限制數量
  return files.slice(0, MAX_SCAN_FILES);
}

/**
 * 掃描 errors.json 中未解決的錯誤
 */
function scanErrors() {
  const result = {
    total: 0,
    unresolved: [],
    recentNew: [],
    recurring: [],
  };

  try {
    let exists;
    try {
      exists = fs.existsSync(ERRORS_JSON);
    } catch (e) { return result; }
    if (!exists) return result;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(ERRORS_JSON, 'utf-8'));
    } catch (e) { return result; }
    const errors = data.errors || [];
    result.total = errors.length;

    const now = Date.now();
    const dayAgo = now - ONE_DAY_MS;

    for (const err of errors) {
      if (err.resolved) continue;
      result?.unresolved?.push(err);

      // 最近 24 小時新增
      const ts = new Date(err.timestamp).getTime();
      if (ts > dayAgo) {
        result?.recentNew?.push(err);
      }

      // 重複出現（count > 3）
      if ((err.count || 1) > 3) {
        result?.recurring?.push(err);
      }
    }
  } catch (e) {
    log('red', `⚠️  無法讀取 errors.json: ${e.message}`);
  }

  return result;
}

/**
 * Error Pattern Analysis — 深度分析 errors.json 中的錯誤模式
 * 對每個 error type 提供根本原因、修復建議、是否需要人手介入
 */
function analyzeErrorPatterns() {
  const result = {
    totalAnalyzed: 0,
    types: [],
    needsHumanIntervention: [],
    autoResolvable: [],
  };

  try {
    let exists;
    try {
      exists = fs.existsSync(ERRORS_JSON);
    } catch (e) { return result; }
    if (!exists) return result;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(ERRORS_JSON, 'utf-8'));
    } catch (e) { return result; }
    const errors = data.errors || [];
    if (errors.length === 0) return result;

    // 按 type 分組
    const byType = {};
    for (const err of errors) {
      const type = err.type || 'Unknown';
      if (!byType[type]) byType[type] = [];
      byType[type].push(err);
    }

    // 已知 error type 分析知識庫
    const analysisDB = {
      'Syntax Error': {
        rootCause: '代碼語法錯誤，通常係變數重複宣告、括號不匹配、或 JSON 格式錯誤',
        fixSuggestion: '運行 `node --check <file>` 定位問題行，修復語法後重新測試',
        needsHuman: true,
        humanReason: '需要理解代碼邏輯先至可以正確修復',
      },
      'Rate Limit': {
        rootCause: 'API 調用頻率超過限制（429 Too Many Requests），常見於密集 cron job 或 burst 請求',
        fixSuggestion: '增加請求間隔、實現 exponential backoff、或減少 cron 頻率',
        needsHuman: false,
        humanReason: null,
      },
      'Ollama Error': {
        rootCause: 'Ollama 本地模型服務錯誤，可能係 API key 無效（401）、服務未啟動、或模型未下載',
        fixSuggestion: '檢查 `ollama list` 確認模型存在；重啟 `ollama serve`；驗證 API key',
        needsHuman: true,
        humanReason: '可能需要重新配置 Ollama 環境或更新 API key',
      },
      'File Not Found': {
        rootCause: 'ENOENT — 引用嘅檔案路徑不存在，可能係路徑 hardcode 錯誤或檔案被刪除',
        fixSuggestion: '確認路徑正確，用 process.env.HOME 代替 hardcoded 路徑；如有需要重新生成缺失檔案',
        needsHuman: true,
        humanReason: '需要判斷缺失檔案是否應該存在，以及正確的內容',
      },
      'Timeout': {
        rootCause: '操作超時，常見於 L0/L1 Generator 處理大量記憶體檔案時',
        fixSuggestion: '增加 timeout 值、或用 extraction fallback 替代完整生成',
        needsHuman: false,
        humanReason: null,
      },
      'Model Error': {
        rootCause: 'Model 名稱錯誤或 model 不可用（例如 minimax-portal/qwen3 應為 ollama/qwen3）',
        fixSuggestion: '對照 TOOLS.md 確認正確嘅 model 名稱格式',
        needsHuman: true,
        humanReason: '需要確認應該使用邊個 model',
      },
      'Discord Error': {
        rootCause: 'Discord 訊息傳送失敗，通常係暫時性網絡問題或 bot token 過期',
        fixSuggestion: '等待後重試；檢查 Discord bot status 同 token 有效性',
        needsHuman: false,
        humanReason: null,
      },
      'Memory Error': {
        rootCause: 'OOM (Out of Memory) — Node.js heap 超過限制，常見於處理大檔案',
        fixSuggestion: '用 `--max-old-space-size=4096` 增加 heap；archive 舊 session 釋放記憶體',
        needsHuman: true,
        humanReason: '可能需要架構調整或增加系統資源',
      },
    };

    for (const [type, typeErrors] of Object.entries(byType)) {
      const totalCount = typeErrors.reduce((sum, e) => sum + (e.count || 1), 0);
      const unresolvedCount = typeErrors.filter(e => !e.resolved).length;
      const recentCount = typeErrors.filter(e => {
        const ts = new Date(e.timestamp).getTime();
        return ts > Date.now() - ONE_DAY_MS;
      }).length;

      // 查找分析知識庫
      const analysis = Object.entries(analysisDB).find(
        ([k]) => k.toLowerCase() === type.toLowerCase()
      )?.[1] || {
        rootCause: '未知錯誤類型 — 需要進一步調查',
        fixSuggestion: '檢查 error log 中的完整錯誤訊息，手動分析根本原因',
        needsHuman: true,
        humanReason: '未有已知的自動化解法',
      };

      const typeAnalysis = {
        type,
        occurrences: typeErrors.length,
        totalCount,
        unresolvedCount,
        recentCount,
        rootCause: analysis.rootCause,
        fixSuggestion: analysis.fixSuggestion,
        needsHuman: analysis.needsHuman,
        humanReason: analysis.humanReason,
        trend: recentCount > 3 ? 'increasing' : recentCount > 0 ? 'active' : 'stable',
        sampleErrors: typeErrors.slice(0, 3).map(e => ({
          id: e.id,
          problem: (e.problem || '').substring(0, 100),
          date: e.date,
          count: e.count || 1,
        })),
      };

      result?.types?.push(typeAnalysis);

      if (analysis.needsHuman) {
        result?.needsHumanIntervention?.push(typeAnalysis);
      } else {
        result?.autoResolvable?.push(typeAnalysis);
      }
    }

    // 按 occurrences 排序
    result?.types?.sort((a, b) => b.totalCount - a.totalCount);
    result.totalAnalyzed = errors.length;

  } catch (e) {
    log('red', `⚠️  Error pattern analysis failed: ${e.message}`);
  }

  return result;
}

/**
 * 分析單個檔案
 */
function analyzeFile(filePath) {
  const result = {
    file: path.relative(WS, filePath),
    lowRisk: [],
    highRisk: [],
  };

  // 使用 Cache 讀取檔案
  const { content } = helpers.getFileContent(filePath);
  if (!content) {
    result?.highRisk?.push({
      rule: 'read-error',
      name: '無法讀取檔案',
      details: 'getFileContent returned empty content',
      severity: 'high',
    });
    return result;
  }

  // 跳過超大檔案 (> 100KB)
  if (content.length > MAX_FILE_SIZE_BYTES) {
    result?.highRisk?.push({
      rule: 'file-too-large',
      name: '檔案過大',
      details: `${(content.length / 1024).toFixed(0)}KB - 跳過詳細分析`,
      severity: 'medium',
      suggestion: '考慮拆分檔案',
    });
    return result;
  }

  // Low-risk 檢測
  for (const rule of LOW_RISK_RULES) {
    try {
      const detectFn = _resolveDetect(rule);
      if (!detectFn) continue;
      const detection = detectFn(content, filePath);
      if (detection.found) {
        result?.lowRisk?.push({
          rule: rule.id,
          name: rule.name,
          category: rule.category,
          details: detection.details,
          lines: detection.lines,
        });
      }
    } catch { /* ignore */ }
  }

  // High-risk 檢測
  for (const rule of HIGH_RISK_RULES) {
    try {
      const detection = rule.detect(content, filePath);
      if (detection.found) {
        result?.highRisk?.push({
          rule: rule.id,
          name: rule.name,
          category: detection.category || rule.category,
          details: detection.details,
          lines: detection.lines,
          severity: detection.severity,
          suggestion: detection.suggestion,
        });
      }
    } catch { /* ignore */ }
  }

  // 過濾 Skip List 中的 false positives
  result.highRisk = result?.highRisk?.filter(issue => {
    if (helpers.isSkipped(issue, result.file)) {
      return false;
    }
    return true;
  });

  return result;
}

/**
 * 自動修復 low-risk 問題
 */
function autoFixFile(filePath, issues) {
  if (issues.length === 0) return { fixed: 0, details: [] };

  // Skip test files and /tmp/ fixtures — low-risk rules may corrupt
  // string literals used as test data (e.g. /Users/ paths, fs calls
  // inside test fixture strings). This is a safety net even if the
  // file walker already excludes these.
  if (FILE_EXCLUDE_PATTERNS.some(p => p.test(filePath))) {
    return { fixed: 0, details: ['excluded (test/tmp file)'] };
  }

  // 使用 Cache 讀取檔案
  const { content: originalContent } = helpers.getFileContent(filePath);
  if (!originalContent) {
    return { fixed: 0, details: ['無法讀取檔案'] };
  }

  let content = originalContent;
  const fixedDetails = [];

  for (const issue of issues) {
    // Translate audit camelCase/snake_case rule IDs to low-risk kebab-case IDs.
    // The `||` fallback keeps already-correct kebab-case IDs working untouched
    // (e.g. when the local scanner pushed `rule.id` directly). Unmapped IDs
    // (like `todo_fixme`) fall through to find() returning undefined → silently
    // skipped, preserving the no-error contract.
    const fixRuleId = AUDIT_TO_FIX_RULE_MAP[issue.rule] || issue.rule;
    const rule = LOW_RISK_RULES.find(r => r.id === fixRuleId);
    if (!rule) continue;
    // Phase 2: prefer AST-aware fix when USE_AST_RULES enables it.
    const fixFn = _resolveFix(rule);
    if (!fixFn) continue;

    try {
      const newContent = fixFn(content, filePath);
      if (newContent && newContent !== content) {
        // Phase 1 (2026-06-26): per-rule dry-run validation.
        // The 4 buggy rules (optional-chaining, fs-sync-trycatch, hardcoded-home-path,
        // simplified-chinese) produce syntactically valid OR semantically equivalent
        // output only by luck. This catches bad fixes BEFORE they accumulate.
        const validation = validateFix({
          oldContent: content,
          newContent,
          filePath,
          rule,
        });
        if (!validation.valid) {
          const failedChecks = validation.checks
            .filter(c => !c.valid)
            .map(c => `${c.name}: ${c.details || 'failed'}`)
            .join('; ');
          logValidation({
            ruleId: rule.id,
            filePath,
            status: 'SKIPPED',
            details: failedChecks,
          });
          fixedDetails.push(`⚠️ ${rule.name}: skipped (validation failed: ${failedChecks})`);
          // Do NOT apply the bad fix — keep `content` unchanged for next rule
          continue;
        }
        content = newContent;
        logValidation({ ruleId: rule.id, filePath, status: 'APPLIED' });
        fixedDetails.push(`✅ ${rule.name}`);
      }
    } catch (e) {
      logValidation({ ruleId: rule.id, filePath, status: 'ERROR', details: e.message });
      fixedDetails.push(`❌ ${rule.name}: ${e.message}`);
    }
  }

  // Phase 4: Determine fix strategy based on MIN_CONFIDENCE
  // For auto_fix.js, all local regex fixes are treated as HIGH confidence (0.95)
  // unless overridden by --min-confidence flag
  const FIX_CONFIDENCE = 0.95; // Local rule-based fixes are highly reliable
  const fixTier = getConfidenceTier(FIX_CONFIDENCE);

  // 只在有改動且非 dry-run 時寫入
  if (content !== originalContent && !isDryRun) {
    const metadata = {
      confidence: FIX_CONFIDENCE,
      reason: `auto_fix.js rule-based fix (${fixedDetails.filter(d => d.startsWith('✅')).length} rules applied)`,
      rule: 'auto_fix_local_rules',
      originalCode: originalContent
    };

    if (isQuarantineOnly || fixTier.action === 'quarantine') {
      // MEDIUM confidence or explicit quarantine mode — write to quarantine
      const result = quarantineFix(filePath, content, { ...metadata, line: 1 });
      if (result.status === 'success') {
        quarantineCount++;
        return { fixed: 0, quarantined: 1, details: [`📋 ${filePath} — quarantined for review`] };
      } else {
        return { fixed: 0, details: [`❌ Quarantine failed: ${result.quarantineId}`] };
      }
    } else {
      // HIGH confidence — use safe writer with backup + atomic rename
      const result = safeFix(filePath, originalContent, content, metadata);
      if (result.status === 'success') {
        // All good, backup preserved
      } else if (result.status === 'reverted') {
        return { fixed: 0, details: [`❌ Fix reverted: ${result.reason}`] };
      } else {
        return { fixed: 0, details: [`❌ Safe write failed: ${result.reason}`] };
      }
    }
  }

  return {
    fixed: fixedDetails.filter(d => d.startsWith('✅')).length,
    details: fixedDetails,
    changed: content !== originalContent,
    quarantined: 0
  };
}

// ==================== REPORT ====================

/**
 * 用 pure_ai_audit 結果標註報告
 */
function annotateWithPureAI(report) {
  const pureIssues = loadPureAIResults();
  if (!pureIssues || pureIssues.length === 0) return report;

  report.highRisk = report?.highRisk?.map(item => {
    const isHandled = pureIssues.some(p =>
      p.rule === item.rule || (p.type === item.rule && p.file?.endsWith(item.file))
    );
    return {
      ...item,
      pureAIAuditHandled: isHandled,
      note: isHandled ? '（已由 pure_ai_audit 處理）' : null
    };
  });

  return report;
}

/**
 * 生成並保存報告
 */
function generateReport(scanResult) {
  const report = {
    timestamp: new Date().toISOString(),
    timestampHKT: toHKT(new Date().toISOString()),
    mode: isDryRun ? 'dry-run' : command,
    summary: {
      filesScanned: scanResult.filesScanned,
      filesWithIssues: scanResult.filesWithIssues,
      lowRiskFixed: scanResult.totalLowRiskFixed,
      lowRiskTotal: scanResult.totalLowRisk,
      quarantined: quarantineCount,
      highRiskTotal: scanResult.totalHighRisk,
      errorsUnresolved: scanResult.errorsUnresolved,
      errorsRecurring: scanResult.errorsRecurring,
      systemAuditIssues: scanResult.systemAudit ? (
        scanResult?.systemAudit?.syntax?.js?.length +
        scanResult?.systemAudit?.syntax?.sh?.length +
        scanResult?.systemAudit?.hardcodedPaths?.length +
        scanResult?.systemAudit?.cronMissing?.length +
        scanResult?.systemAudit?.cronHardcodedDates?.length +
        scanResult?.systemAudit?.danglingRefs?.length +
        (scanResult?.systemAudit?.moduleNotFound || []).length +
        (scanResult?.systemAudit?.filenamePatternMismatch || []).length +
        (scanResult?.systemAudit?.gitPushWithoutApproval || []).length +
        (scanResult?.systemAudit?.diskCheckPathError || []).length +
        (scanResult?.systemAudit?.missingHelper || []).length +
        (scanResult?.systemAudit?.syncInAsync || []).length +
        (scanResult?.systemAudit?.infiniteLoopRisk || []).length
      ) : 0,
    },
    fixed: scanResult.fixResults,
    highRisk: scanResult.highRiskItems,
    errors: scanResult.errorSummary,
    errorAnalysis: scanResult.errorAnalysis || null,
    systemAudit: scanResult.systemAudit || null,
  };

  // 保存報告
  if (!isDryRun) {
    ensureDir(STATE_DIR);
    const tmpReport = `${AUDIT_REPORT}.tmp.${Date.now()}`;
    try {
      fs.writeFileSync(tmpReport, JSON.stringify(report, null, 2));
      fs.renameSync(tmpReport, AUDIT_REPORT);
    } catch (e) {
      console.error(`⚠️ 無法寫入報告: ${e.message}`);
      try {
        fs.unlinkSync(tmpReport);
      } catch { /* ignore */ }
    }

    // 追加到歷史 (使用 auto_fix_history.js 的新格式)
    const { addFixRecord, readHistory, writeHistory } = require('./auto_fix_history');
    const history = readHistory();

    // 添加 audit 記錄作為一個特殊的 fix record
    const auditRecord = {
      id: `AUDIT-${new Date().toISOString().slice(0, 10)}`,
      timestamp: report.timestamp,
      file: 'auto_fix.js',
      issue: 'Audit cycle completed',
      fix_applied: `Scanned ${report?.summary?.filesScanned} files, fixed ${report?.summary?.lowRiskFixed} low-risk issues`,
      expected_effect: 'Code quality improved',
      verified: true,
      success_rate: 100,
      verification_count: 1,
      failures: 0,
      status: 'verified',
      isAuditRecord: true,
      auditSummary: report.summary,
    };

    // 檢查是否已有今天的 audit 記錄，有的話更新，沒有則添加
    const existingIdx = history.fixes.findIndex(f => f.id === auditRecord.id);
    if (existingIdx >= 0) {
      history.fixes[existingIdx] = auditRecord;
    } else {
      history.fixes.push(auditRecord);
    }

    // 保留最近 50 條 fix 記錄
    if (history.fixes.length > 50) {
      history.fixes = history.fixes.slice(-50);
    }

    if (!writeHistory(history)) {
      console.error(`⚠️ 無法寫入歷史記錄`);
    }
  }

  // 用 pure_ai_audit 結果標註報告
  annotateWithPureAI(report);

  return report;
}

/**
 * 生成 Markdown 格式報告
 */
function generateMarkdownReport(report) {
  const s = report.summary;
  const lines = [];

  lines.push('# 🔍 Auto-Audit Report');
  lines.push('');
  lines.push(`📅 **時間:** ${report.timestampHKT} HKT`);
  lines.push(`🔧 **模式:** ${report.mode}${isDryRun ? ' (預覽，未修改任何檔案)' : ''}`);
  lines.push('');

  // 📊 概覽
  lines.push('## 📊 概覽');
  lines.push('');
  lines.push(`| 項目 | 數值 |`);
  lines.push(`|------|------|`);
  lines.push(`| 掃描檔案 | ${s.filesScanned} |`);
  lines.push(`| 有問題檔案 | ${s.filesWithIssues} |`);
  lines.push(`| Low-risk 已修復 | ${s.lowRiskFixed}/${s.lowRiskTotal} |`);
  lines.push(`| High-Risk 問題 | ${s.highRiskTotal} |`);
  lines.push(`| 未解決錯誤 | ${s.errorsUnresolved} |`);
  lines.push(`| 重複錯誤 | ${s.errorsRecurring} |`);
  lines.push(`| 系統審計問題 | ${s.systemAuditIssues} |`);
  lines.push('');

  // ✅ 已修復 (Low-Risk)
  if (report.fixed && report?.fixed?.length > 0) {
    lines.push('## ✅ 已自動修復 (Low-Risk)');
    lines.push('');
    for (const item of report.fixed) {
      lines.push(`### 📄 ${item.file}`);
      for (const d of item.details) {
        lines.push(`- ${d}`);
      }
      lines.push('');
    }
  }

  // ⚠️ High-Risk 問題
  if (report.highRisk && report?.highRisk?.length > 0) {
    lines.push('## ⚠️ High-Risk 問題');
    lines.push('');
    for (const item of report.highRisk) {
      const sevIcon = item.severity === 'critical' ? '🔴' :
                      item.severity === 'high' ? '🟠' :
                      item.severity === 'medium' ? '🟡' : '⚪';
      const pureAINote = item.pureAIAuditHandled ? ` *(已由 pure_ai_audit 處理)*` : '';
      lines.push(`### ${sevIcon} ${item.file}${pureAINote}`);
      lines.push('');
      lines.push(`- **問題:** ${item.name}`);
      lines.push(`- **詳情:** ${item.details}`);
      if (item.suggestion) {
        lines.push(`- **建議:** ${item.suggestion}`);
      }
      if (item.lines && item?.lines?.length > 0) {
        lines.push(`- **行號:** ${item?.lines?.slice(0, 10).join(', ')}${item?.lines?.length > 10 ? '...' : ''}`);
      }
      if (item.context && item?.context?.length > 0) {
        lines.push(`- **Context:**`);
        for (const ctx of item.context) {
          if (ctx && ctx.before) {
            lines.push('  ```');
            ctx?.before?.forEach(l => { if (l.trim()) lines.push(l); });
            lines.push('> ' + ctx.current);
            ctx?.after?.forEach(l => { if (l.trim()) lines.push(l); });
            lines.push('  ```');
          }
        }
      }
      if (item.id) {
        lines.push(`- **ID:** \`${item.id}\` (用 \`confirm ${item.id}\` 確認已處理)`);
      }
      lines.push('');
    }
  }

  // 🚨 錯誤摘要
  if (report.errors && (report?.errors?.recentNew?.length > 0 || report?.errors?.recurring?.length > 0)) {
    lines.push('## 🚨 錯誤摘要');
    lines.push('');
    if (report?.errors?.recentNew?.length > 0) {
      lines.push('### 🆕 新錯誤 (24h 內)');
      for (const err of report?.errors?.recentNew?.slice(0, 5)) {
        lines.push(`- **[${err.type}]** ${err.problem} (×${err.count || 1})`);
      }
      lines.push('');
    }
    if (report?.errors?.recurring?.length > 0) {
      lines.push('### 🔄 重複錯誤');
      for (const err of report?.errors?.recurring?.slice(0, 5)) {
        lines.push(`- **[${err.type}]** ${err.problem} (×${err.count || 1})`);
      }
      lines.push('');
    }
  }

  // 🔬 Error Pattern Analysis
  if (report.errorAnalysis && report?.errorAnalysis?.types && report?.errorAnalysis?.types?.length > 0) {
    const ea = report.errorAnalysis;
    lines.push('## 🔬 Error Pattern Analysis');
    lines.push('');
    lines.push(`分析咗 ${ea.totalAnalyzed} 個錯誤，識別到 ${ea?.types?.length} 個錯誤類型`);
    lines.push('');
    for (const t of ea.types) {
      const trendIcon = t.trend === 'increasing' ? '📈' : t.trend === 'active' ? '🔄' : '📉';
      const humanTag = t.needsHuman ? '👤 需要人手介入' : '🤖 可自動處理';
      lines.push(`### ${trendIcon} **${t.type}**`);
      lines.push('');
      lines.push(`- 發生次數: ${t.occurrences} 次 (${t.unresolvedCount} 未解決, 24h 內 ${t.recentCount} 次)`);
      lines.push(`- 根本原因: ${t.rootCause}`);
      lines.push(`- 修復建議: ${t.fixSuggestion}`);
      lines.push(`- ${humanTag}${t.humanReason ? ` — ${t.humanReason}` : ''}`);
      lines.push('');
    }
    if (ea?.needsHumanIntervention?.length > 0) {
      lines.push(`⚠️ **需要人手介入:** ${ea?.needsHumanIntervention?.map(t => t.type).join(', ')}`);
    }
    if (ea?.autoResolvable?.length > 0) {
      lines.push(`✅ **可自動處理:** ${ea?.autoResolvable?.map(t => t.type).join(', ')}`);
    }
    lines.push('');
  }

  // 🔧 系統審計
  if (report.systemAudit) {
    const sa = report.systemAudit;
    const hasIssues = !sa?.syntax?.ok || sa?.hardcodedPaths?.length > 0 ||
                      sa?.cronMissing?.length > 0 || sa?.cronHardcodedDates?.length > 0 ||
                      sa?.danglingRefs?.length > 0 ||
                      (sa.moduleNotFound || []).length > 0 ||
                      (sa.filenamePatternMismatch || []).length > 0 ||
                      (sa.gitPushWithoutApproval || []).length > 0 ||
                      (sa.diskCheckPathError || []).length > 0 ||
                      (sa.missingHelper || []).length > 0 ||
                      (sa.syncInAsync || []).length > 0 ||
                      (sa.infiniteLoopRisk || []).length > 0;

    if (hasIssues) {
      lines.push('## 🔧 系統審計');
      lines.push('');

      // 語法錯誤
      if (sa?.syntax?.js?.length > 0 || sa?.syntax?.sh?.length > 0) {
        lines.push('### ❌ 語法錯誤');
        for (const item of sa?.syntax?.js) {
          lines.push(`- 📄 **${item.file}** (JS): \`${item.error}\``);
        }
        for (const item of sa?.syntax?.sh) {
          lines.push(`- 📄 **${item.file}** (SH): \`${item.error}\``);
        }
        lines.push('');
      }

      // 硬編碼路徑
      if (sa?.hardcodedPaths?.length > 0) {
        lines.push(`### ⚠️ 硬編碼路徑 (${sa?.hardcodedPaths?.length} 處)`);
        for (const item of sa.hardcodedPaths) {
          lines.push(`- 📄 **${item.file}:${item.line}**`);
          lines.push(`  \`${item.content}\``);
          lines.push(`  💡 ${item.suggestion}`);
        }
        lines.push('');
      }

      // Cron 缺失腳本
      if (sa?.cronMissing?.length > 0) {
        lines.push(`### ❌ Cron Job 引用缺失腳本 (${sa?.cronMissing?.length} 個)`);
        for (const item of sa.cronMissing) {
          lines.push(`- 🕐 \`${item.cronLine}\``);
          lines.push(`  缺失: **${item.scriptPath}**`);
        }
        lines.push('');
      }

      // Cron 硬編碼日期
      if (sa?.cronHardcodedDates?.length > 0) {
        lines.push(`### ⚠️ Cron Job 硬編碼日期 (${sa?.cronHardcodedDates?.length} 處)`);
        for (const item of sa.cronHardcodedDates) {
          lines.push(`- 📅 **${item.date}** — ${item.source}`);
          if (item.content) {
            lines.push(`  \`${item?.content?.substring(0, 120)}\``);
          } else if (item.cronLine) {
            lines.push(`  \`${item.cronLine}\``);
          }
          lines.push(`  💡 ${item.suggestion}`);
        }
        lines.push('');
      }

      // 懸空引用
      if (sa?.danglingRefs?.length > 0) {
        lines.push(`### ⚠️ 懸空引用 (${sa?.danglingRefs?.length} 個)`);
        for (const item of sa.danglingRefs) {
          lines.push(`- 📄 **${item.file}:${item.line}** → ${item.ref}`);
          lines.push(`  \`${item.resolvedPath}\``);
        }
        lines.push('');
      }

      // Module Not Found
      if ((sa.moduleNotFound || []).length > 0) {
        lines.push(`### ❌ Module Not Found (${sa?.moduleNotFound?.length} 個)`);
        for (const item of sa.moduleNotFound) {
          lines.push(`- 📄 **${item.file}:${item.line}** → require('${item.require}')`);
          lines.push(`  💡 ${item.suggestion}`);
        }
        lines.push('');
      }

      // Filename Pattern Mismatch
      if ((sa.filenamePatternMismatch || []).length > 0) {
        lines.push(`### ⚠️ Filename Pattern 可能漏了 Timestamp (${sa?.filenamePatternMismatch?.length} 處)`);
        for (const item of sa.filenamePatternMismatch) {
          lines.push(`- 📄 **${item.file}:${item.line}**`);
          lines.push(`  \`${item.content}\``);
          lines.push(`  💡 ${item.suggestion}`);
        }
        lines.push('');
      }

      // Git Push Without Approval
      if ((sa.gitPushWithoutApproval || []).length > 0) {
        lines.push(`### ❌ Git Push 可能未經批準 (${sa?.gitPushWithoutApproval?.length} 處)`);
        for (const item of sa.gitPushWithoutApproval) {
          lines.push(`- 📄 **${item.file}:${item.line}**`);
          lines.push(`  \`${item.content}\``);
          lines.push(`  💡 ${item.suggestion}`);
        }
        lines.push('');
      }

      // Missing Helper Function
      if ((sa.missingHelper || []).length > 0) {
        lines.push(`### 🔴 Missing Helper (${sa?.missingHelper?.length} 處)`);
        for (const item of sa.missingHelper) {
          lines.push(`- 📄 **${item.file}:${item.line}** → \`${item.funcName}()\``);
          lines.push(`  \`${item.content}\``);
          lines.push(`  💡 ${item.suggestion}`);
        }
        lines.push('');
      }

      // Sync in Async
      if ((sa.syncInAsync || []).length > 0) {
        lines.push(`### ⚠️ Sync in Async (${sa?.syncInAsync?.length} 處)`);
        for (const item of sa.syncInAsync) {
          lines.push(`- 📄 **${item.file}:${item.line}** — ${item.syncCall} in \`async ${item.asyncFunc}()\``);
          lines.push(`  \`${item.content}\``);
          lines.push(`  💡 ${item.suggestion}`);
        }
        lines.push('');
      }

      // Infinite Loop Risk
      if ((sa.infiniteLoopRisk || []).length > 0) {
        lines.push(`### 🔴 Infinite Loop Risk (${sa?.infiniteLoopRisk?.length} 處)`);
        for (const item of sa.infiniteLoopRisk) {
          lines.push(`- 📄 **${item.file}:${item.line}**`);
          lines.push(`  \`${item.content}\``);
          lines.push(`  💡 ${item.suggestion}`);
        }
        lines.push('');
      }

      // 其他問題
      if ((sa.otherIssues || []).length > 0) {
        lines.push('### 🔍 其他問題 (Auto 智能發現)');
        for (const item of sa.otherIssues) {
          lines.push(`- 📄 **${item.file}:${item.line || 'N/A'}**`);
          lines.push(`  ${item.description}`);
          lines.push(`  💡 ${item.suggestion || '需人工確認'}`);
        }
        lines.push('');
      }
    } else {
      lines.push('## 🔧 系統審計: ✅ 全部通過');
    }
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push(`📁 完整報告: \`.state/auto_fix_report.json\``);
  if (s.highRiskTotal > 0) {
    lines.push(`💡 用 \`node scripts/auto_fix.js confirm <id>\` 確認已處理 high-risk 問題`);
  }

  return lines.join('\n');
}

/**
 * 打印報告到 console
 */
function printReport(report, format) {
  const s = report.summary;

  // 根據 format 輸出
  if (format === 'markdown') {
    console.log(generateMarkdownReport(report));
    return;
  }

  if (format === 'json') {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // format === 'text' — 現有彩色輸出
  log('dim', `📅 ${report.timestampHKT} HKT`);
  log('dim', `🔧 Mode: ${report.mode}${isDryRun ? ' (預覽，未修改任何檔案)' : ''}`);
  console.log('');

  // Summary
  log('cyan', '📊 概覽');
  console.log(`   掃描檔案: ${s.filesScanned}`);
  console.log(`   有問題檔案: ${s.filesWithIssues}`);
  console.log(`   Low-risk 已修復: ${C.green}${s.lowRiskFixed}/${s.lowRiskTotal}${C.reset}`);
  console.log(`   High-Risks Found (${C.yellow}${s.highRiskTotal}${C.reset}):`);
  console.log(`   未解決錯誤: ${s.errorsUnresolved}`);
  console.log(`   重複錯誤: ${s.errorsRecurring}`);
  console.log(`   系統審計問題: ${s.systemAuditIssues > 0 ? C.yellow + s.systemAuditIssues + C.reset : C.green + '0' + C.reset}`);
  console.log('');

  // Fixed items
  if (report.fixed && report?.fixed?.length > 0) {
    log('green', '✅ 已修復 (Low-Risk)');
    for (const item of report.fixed) {
      console.log(`   📄 ${item.file}`);
      for (const d of item.details) {
        console.log(`      ${d}`);
      }
    }
    console.log('');
  }

  // High-risk items
  if (report.highRisk && report?.highRisk?.length > 0) {
    log('yellow', '⚠️  待確認 (High-Risk)');
    for (const item of report.highRisk) {
      const sev = item.severity === 'critical' ? `${C.red}🔴` :
                  item.severity === 'high' ? `${C.yellow}🟠` :
                  item.severity === 'medium' ? `${C.yellow}🟡` : `${C.dim}⚪`;
      const pureAINote = item.pureAIAuditHandled ? ` ${C.green}${item.note}${C.reset}` : '';
      console.log(`   ${sev} ${item.file}${pureAINote}${C.reset}`);
      console.log(`      ${item.name}: ${item.details}`);
      if (item.suggestion) {
        console.log(`      💡 ${C.dim}${item.suggestion}${C.reset}`);
      }
      // Bug 3 Fix: 顯示 context 而不是靜態 line number
      if (item.lines && item?.lines?.length > 0 && item.context) {
        console.log(`      📍 行號: ${item?.lines?.slice(0, 5).join(', ')}${item?.lines?.length > 5 ? '...' : ''}`);
        if (item.context && item?.context?.length > 0) {
          for (const ctx of item.context) {
            if (ctx && ctx.before) {
              console.log(`         ${C.dim}--- context ---${C.reset}`);
              ctx?.before?.forEach((l, idx) => {
                if (l.trim()) console.log(`         ${C.dim}${l}${C.reset}`);
              });
              console.log(`         ${C.cyan}> ${ctx.current}${C.reset}`);
              ctx?.after?.forEach((l) => {
                if (l.trim()) console.log(`         ${C.dim}${l}${C.reset}`);
              });
              console.log(`         ${C.dim}--- end ---${C.reset}`);
            }
          }
        }
      } else if (item.lines && item?.lines?.length > 0) {
        console.log(`      📍 行號: ${item?.lines?.slice(0, 5).join(', ')}${item?.lines?.length > 5 ? '...' : ''}`);
      }
      if (item.id) {
        console.log(`      🔑 ID: ${item.id} (用 \`confirm ${item.id}\` 確認已處理)`);
      }
    }
    console.log('');
  }

  // Error summary
  if (report.errors && (report?.errors?.recentNew?.length > 0 || report?.errors?.recurring?.length > 0)) {
    log('red', '🚨 錯誤摘要');
    if (report?.errors?.recentNew?.length > 0) {
      console.log(`   ${C.red}新錯誤 (24h):${C.reset}`);
      for (const err of report?.errors?.recentNew?.slice(0, 5)) {
        console.log(`      • [${err.type}] ${err.problem} (×${err.count || 1})`);
      }
    }
    if (report?.errors?.recurring?.length > 0) {
      console.log(`   ${C.yellow}重複錯誤:${C.reset}`);
      for (const err of report?.errors?.recurring?.slice(0, 5)) {
        console.log(`      • [${err.type}] ${err.problem} (×${err.count || 1})`);
      }
    }
    console.log('');
  }

  // Error Pattern Analysis
  if (report.errorAnalysis && report?.errorAnalysis?.types && report?.errorAnalysis?.types?.length > 0) {
    const ea = report.errorAnalysis;
    log('magenta', '🔬 Error Pattern Analysis');
    console.log(`   分析咗 ${ea.totalAnalyzed} 個錯誤，識別到 ${ea?.types?.length} 個錯誤類型\n`);

    for (const t of ea.types) {
      const trendIcon = t.trend === 'increasing' ? '📈' : t.trend === 'active' ? '🔄' : '📉';
      const humanIcon = t.needsHuman ? `${C.red}👤 需要人手介入${C.reset}` : `${C.green}🤖 可自動處理${C.reset}`;
      console.log(`   ${trendIcon} ${C.bold}${t.type}${C.reset} — ${t.occurrences} 次 (${t.unresolvedCount} 未解決, 24h 內 ${t.recentCount} 次)`);
      console.log(`      根本原因: ${t.rootCause}`);
      console.log(`      修復建議: ${C.cyan}${t.fixSuggestion}${C.reset}`);
      console.log(`      ${humanIcon}${t.humanReason ? ` — ${t.humanReason}` : ''}`);
      console.log('');
    }

    if (ea?.needsHumanIntervention?.length > 0) {
      log('yellow', `   ⚠️  ${ea?.needsHumanIntervention?.length} 個類型需要人手介入: ${ea?.needsHumanIntervention?.map(t => t.type).join(', ')}`);
    }
    if (ea?.autoResolvable?.length > 0) {
      log('green', `   ✅ ${ea?.autoResolvable?.length} 個類型可自動處理: ${ea?.autoResolvable?.map(t => t.type).join(', ')}`);
    }
    console.log('');
  }

  // System Audit
  if (report.systemAudit) {
    const sa = report.systemAudit;
    const hasIssues = !sa?.syntax?.ok || sa?.hardcodedPaths?.length > 0 ||
                      sa?.cronMissing?.length > 0 || sa?.cronHardcodedDates?.length > 0 ||
                      sa?.danglingRefs?.length > 0 ||
                      (sa.moduleNotFound || []).length > 0 ||
                      (sa.filenamePatternMismatch || []).length > 0 ||
                      (sa.gitPushWithoutApproval || []).length > 0 ||
                      (sa.diskCheckPathError || []).length > 0 ||
                      (sa.missingHelper || []).length > 0 ||
                      (sa.syncInAsync || []).length > 0 ||
                      (sa.infiniteLoopRisk || []).length > 0;

    if (hasIssues) {
      log('cyan', '🔧 系統審計');

      // 語法錯誤
      if (sa?.syntax?.js?.length > 0 || sa?.syntax?.sh?.length > 0) {
        console.log(`\n   ${C.red}❌ 語法錯誤${C.reset}`);
        for (const item of sa?.syntax?.js) {
          console.log(`      📄 ${item.file} (JS)`);
          console.log(`         ${C.dim}${item.error}${C.reset}`);
        }
        for (const item of sa?.syntax?.sh) {
          console.log(`      📄 ${item.file} (SH)`);
          console.log(`         ${C.dim}${item.error}${C.reset}`);
        }
      }

      // 硬編碼路徑
      if (sa?.hardcodedPaths?.length > 0) {
        console.log(`\n   ${C.yellow}⚠️ 硬編碼路徑 (${sa?.hardcodedPaths?.length} 處)${C.reset}`);
        for (const item of sa.hardcodedPaths) {
          console.log(`      📄 ${item.file}:${item.line}`);
          console.log(`         ${C.dim}${item.content}${C.reset}`);
          console.log(`         💡 ${item.suggestion}`);
        }
      }

      // Cron 缺失腳本
      if (sa?.cronMissing?.length > 0) {
        console.log(`\n   ${C.red}❌ Cron Job 引用缺失腳本 (${sa?.cronMissing?.length} 個)${C.reset}`);
        for (const item of sa.cronMissing) {
          console.log(`      🕐 ${C.dim}${item.cronLine}${C.reset}`);
          console.log(`         缺失: ${C.red}${item.scriptPath}${C.reset}`);
        }
      }

      // Cron 硬編碼日期
      if (sa?.cronHardcodedDates?.length > 0) {
        console.log(`\n   ${C.yellow}⚠️ Cron Job 硬編碼日期 (${sa?.cronHardcodedDates?.length} 處)${C.reset}`);
        for (const item of sa.cronHardcodedDates) {
          console.log(`      📅 ${C.yellow}${item.date}${C.reset} — ${item.source}`);
          if (item.content) {
            console.log(`         ${C.dim}${item?.content?.substring(0, 120)}${C.reset}`);
          } else if (item.cronLine) {
            console.log(`         ${C.dim}${item.cronLine}${C.reset}`);
          }
          console.log(`         💡 ${item.suggestion}`);
        }
      }

      // 懸空引用
      if (sa?.danglingRefs?.length > 0) {
        console.log(`\n   ${C.yellow}⚠️ 懸空引用 (${sa?.danglingRefs?.length} 個)${C.reset}`);
        for (const item of sa.danglingRefs) {
          console.log(`      📄 ${item.file}:${item.line} → ${C.red}${item.ref}${C.reset}`);
          console.log(`         ${C.dim}${item.resolvedPath}${C.reset}`);
        }
      }

      // Module Not Found
      if ((sa.moduleNotFound || []).length > 0) {
        console.log(`\n   ${C.red}❌ Module Not Found (${sa?.moduleNotFound?.length} 個)${C.reset}`);
        for (const item of sa.moduleNotFound) {
          console.log(`      📄 ${item.file}:${item.line} → ${C.red}require('${item.require}')${C.reset}`);
          console.log(`         ${C.dim}${item.resolvedPath}${C.reset}`);
          console.log(`         💡 ${item.suggestion}`);
        }
      }

      // Filename Pattern Mismatch
      if ((sa.filenamePatternMismatch || []).length > 0) {
        console.log(`\n   ${C.yellow}⚠️ Filename Pattern 可能漏了 Timestamp (${sa?.filenamePatternMismatch?.length} 處)${C.reset}`);
        for (const item of sa.filenamePatternMismatch) {
          console.log(`      📄 ${item.file}:${item.line}`);
          console.log(`         ${C.dim}${item.content}${C.reset}`);
          console.log(`         💡 ${item.suggestion}`);
        }
      }

      // Git Push Without Approval
      if ((sa.gitPushWithoutApproval || []).length > 0) {
        console.log(`\n   ${C.red}❌ Git Push 可能未經批準 (${sa?.gitPushWithoutApproval?.length} 處)${C.reset}`);
        for (const item of sa.gitPushWithoutApproval) {
          console.log(`      📄 ${item.file}:${item.line}`);
          console.log(`         ${C.dim}${item.content}${C.reset}`);
          console.log(`         💡 ${item.suggestion}`);
        }
      }

      // Disk Check Path Error
      if ((sa.diskCheckPathError || []).length > 0) {
        console.log(`\n   ${C.yellow}⚠️ Disk Check 路徑可能錯誤 (${sa?.diskCheckPathError?.length} 處)${C.reset}`);
        for (const item of sa.diskCheckPathError) {
          console.log(`      📄 ${item.file}:${item.line}`);
          console.log(`         ${C.dim}${item.content}${C.reset}`);
          console.log(`         💡 ${item.suggestion}`);
        }
      }

      // Missing Helper Function
      if ((sa.missingHelper || []).length > 0) {
        console.log(`\n   ${C.red}🔴 Missing Helper: 可能未定義就使用 (${sa?.missingHelper?.length} 處)${C.reset}`);
        for (const item of sa.missingHelper) {
          console.log(`      📄 ${item.file}:${item.line} → ${C.red}${item.funcName}()${C.reset}`);
          console.log(`         ${C.dim}${item.content}${C.reset}`);
          console.log(`         💡 ${item.suggestion}`);
        }
      }

      // Sync in Async
      if ((sa.syncInAsync || []).length > 0) {
        console.log(`\n   ${C.yellow}⚠️ Sync in Async: async function 阻塞等待 (${sa?.syncInAsync?.length} 處)${C.reset}`);
        for (const item of sa.syncInAsync) {
          console.log(`      📄 ${item.file}:${item.line} — ${C.yellow}${item.syncCall}${C.reset} in async ${item.asyncFunc}()`);
          console.log(`         ${C.dim}${item.content}${C.reset}`);
          console.log(`         💡 ${item.suggestion}`);
        }
      }

      // Infinite Loop Risk
      if ((sa.infiniteLoopRisk || []).length > 0) {
        console.log(`\n   ${C.red}🔴 Infinite Loop Risk: 可能冇 break (${sa?.infiniteLoopRisk?.length} 處)${C.reset}`);
        for (const item of sa.infiniteLoopRisk) {
          console.log(`      📄 ${item.file}:${item.line}`);
          console.log(`         ${C.dim}${item.content}${C.reset}`);
          console.log(`         💡 ${item.suggestion}`);
        }
      }

      // ── 其他問題 (Auto 智能發現) ──
      if ((sa.otherIssues || []).length > 0) {
        console.log(`\n   ${C.yellow}🔍 其他問題 (Auto 智能發現):${C.reset}`);
        for (const item of sa.otherIssues) {
          console.log(`      📄 ${item.file}:${item.line || 'N/A'}`);
          console.log(`         ${C.dim}${item.description}${C.reset}`);
          console.log(`         💡 ${item.suggestion || '需人工確認'}`);
        }
      }

      console.log('');
    } else {
      log('green', '🔧 系統審計: ✅ 全部通過');
      console.log('');
    }
  }

  // Footer
  if (s.highRiskTotal > 0) {
    log('dim', `💡 用 \`node scripts/auto_fix.js confirm <id>\` 確認已處理 high-risk 問題`);
  }
  log('dim', `📁 完整報告: .state/auto_fix_report.json`);
  console.log('');
}

// ==================== REVIEWER PATTERN: DEPLOY CHECK ====================

/**
 * 找出 git 中已修改但未提交的檔案
 */
function findGitModifiedFiles() {
  const files = [];
  try {
    let output;
    try {
      output = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
        encoding: 'utf-8',
        timeout: 5000,
        cwd: WS,
      });
    } catch { return files; }
    const lines = output.trim().split('\n').filter(l => l.trim());
    for (const relPath of lines) {
      const fullPath = path.join(WS, relPath);
      const ext = path.extname(relPath);
      const scriptsExts = ['.js', '.sh', '.bash', '.py', '.mjs', '.cjs'];
      let exists;
      try {
        exists = fs.existsSync(fullPath);
      } catch (e) { continue; }
      // Issue 3 fix: skip deleted files
      if (!exists) continue;
      if (scriptsExts.includes(ext)) {
        try {
          const stat = fs.statSync(fullPath);
          files.push({
            path: fullPath,
            name: path.basename(relPath),
            relPath,
            mtime: stat.mtime,
          });
        } catch { /* ignore */ }
      }
    }
  } catch { /* git 可能不在 WS 根目錄，或冇修改 */ }
  return files;
}

/**
 * 完整的 Deploy Check 流程
 */
function runDeployCheck() {
  log('cyan', '🔍 Deploy Check');
  console.log('');

  const now = new Date();
  const dateStr = now.toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong', hour12: false });

  // 1. 找出修改中的檔案
  log('dim', '📋 搜尋修改中的檔案...');
  const gitModified = findGitModifiedFiles();
  const recentFiles = findRecentFiles();

  // 合併：git modified 優先，然後加未在 git 中但最近修改的
  const seenNames = new Set();
  const allModified = [];

  for (const f of gitModified) {
    allModified.push({ ...f, source: 'git' });
    seenNames.add(f.name);
  }
  for (const f of recentFiles) {
    if (!seenNames.has(f.name)) {
      allModified.push({ ...f, source: 'recent' });
      seenNames.add(f.name);
    }
  }

  // 排除 auto_fix.js 自己（審計自己會造成干擾）
  const filtered = allModified.filter(f => f.name !== 'auto_fix.js');

  console.log('');
  log('bold', `🔍 Deploy Check — ${dateStr}`);
  console.log('');
  log('cyan', '📦 Scripts 修改：');
  if (filtered.length === 0) {
    console.log(`   ${C.dim}(冇修改中的 scripts)${C.reset}`);
  } else {
    for (const f of filtered) {
      const icon = f.source === 'git' ? '✏️' : '📝';
      console.log(`   ${icon}  ${f.name} (${f.source})`);
    }
  }
  console.log('');

  if (filtered.length === 0) {
    log('green', '✅ 冇修改中的 scripts，直接通過 Deploy Check！');
    return;
  }

  // 2. 對每個檔案運行審查
  const syntaxResults = [];
  const safetyResults = [];
  const dependencyCount = new Set();
  const cronImpact = [];

  for (const f of filtered) {
    // 語法檢查
    const syntaxCheck = checkSyntax(f.path);
    syntaxResults.push({
      name: f.name,
      ok: syntaxCheck.ok === true,
      error: syntaxCheck.error,
    });

    // Safety 檢查（用 impact analysis 邏輯）
    const { content } = helpers.getFileContent(f.path);
    if (content) {
      const tryCatchIssues = [];
      const dangerousSyncCalls = [
        { method: 'fs.writeFileSync', pattern: /fs\.writeFileSync\s*\(/g },
        { method: 'fs.readFileSync', pattern: /fs\.readFileSync\s*\(/g },
        { method: 'execSync', pattern: /execSync\s*\(/g },
        { method: 'execFileSync', pattern: /execFileSync\s*\(/g },
        { method: 'spawnSync', pattern: /spawnSync\s*\(/g },
      ];
      const allLines = content.split('\n');

      for (const { method, pattern } of dangerousSyncCalls) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const startLine = content.substring(0, match.index).split('\n').length;
          const nearbyLines = allLines.slice(
            Math.max(0, startLine - 3),
            Math.min(allLines.length, startLine + 2)
          );
          const hasTryCatch = nearbyLines.some(l => /\btry\b|\bcatch\b/.test(l));
          if (!hasTryCatch) {
            tryCatchIssues.push(`${f.name}:${startLine}`);
          }
        }
      }

      if (tryCatchIssues.length > 0) {
        for (const issue of tryCatchIssues) {
          safetyResults.push({ name: f.name, issue: 'try-catch 缺失', detail: issue });
        }
      }
    }

    // 依賴影響 — 使用 lightweight scan (一次過)
    const { dependencies, cronImpact: fileCronImpact } = getLightweightImpacts(filtered);
    for (const dep of dependencies) dependencyCount.add(dep);
    for (const c of fileCronImpact) cronImpact.push(c);
  }

  // 3. 顯示審查結果
  const allSyntaxOk = syntaxResults.every(s => s.ok);
  const allSafetyOk = safetyResults.length === 0;

  log('cyan', '✅ 語法檢查：', allSyntaxOk ? `${C.green}全部通過${C.reset}` : `${C.red}有錯誤${C.reset}`);
  if (!allSyntaxOk) {
    for (const s of syntaxResults) {
      if (!s.ok) {
        console.log(`   ${C.red}❌ ${s.name}: ${s.error}${C.reset}`);
      }
    }
  }

  if (safetyResults.length > 0) {
    console.log(`${C.yellow}⚠️  Safety：${safetyResults.length} 個 try-catch 缺失${C.reset}`);
    const seen = new Set();
    for (const r of safetyResults) {
      const key = `${r.name}:${r.issue}`;
      if (!seen.has(key)) {
        seen.add(key);
        console.log(`   ${C.yellow}   ${r.detail}${C.reset}`);
      }
    }
  } else {
    console.log(`${C.green}⚠️  Safety：全部通過${C.reset}`);
  }

  console.log(`${C.cyan}📦 依賴影響：${dependencyCount.size} 個 scripts${C.reset}`);
  if (dependencyCount.size > 0) {
    for (const dep of dependencyCount) {
      console.log(`   ${C.dim}   • ${dep}${C.reset}`);
    }
  }

  console.log(`${C.cyan}🕐 Cron 影響：${cronImpact.length === 0 ? '冇' : cronImpact.length + ' 個'}${C.reset}`);
  if (cronImpact.length > 0) {
    for (const c of cronImpact) {
      console.log(`   ${C.dim}   • ${c}${C.reset}`);
    }
  }

  console.log('');

  // 4. Deploy Checklist
  log('bold', '📋 Deploy Checklist：');
  const syntaxIcon = allSyntaxOk ? `${C.green}✅${C.reset}` : `${C.red}❌${C.reset}`;
  const syntaxText = allSyntaxOk ? 'Syntax check passed' : 'Syntax check FAILED';
  console.log(`   [${syntaxIcon}] ${syntaxText}`);

  const safetyIcon = allSafetyOk ? `${C.green}✅${C.reset}` : `${C.yellow}⚠️${C.reset}`;
  const safetyText = allSafetyOk
    ? 'Safety check passed'
    : `Safety issue found (${safetyResults.length})`;
  console.log(`   [${safetyIcon}] ${safetyText}`);

  const depIcon = dependencyCount.size > 0 ? `${C.yellow}⚠️${C.reset}` : `${C.green}✅${C.reset}`;
  const depText = dependencyCount.size > 0
    ? `Dependencies affected (${dependencyCount.size})`
    : 'Dependencies OK';
  console.log(`   [${depIcon}] ${depText}`);

  const cronIcon = cronImpact.length > 0 ? `${C.yellow}⚠️${C.reset}` : `${C.green}✅${C.reset}`;
  const cronText = cronImpact.length > 0
    ? `Cron jobs affected (${cronImpact.length})`
    : 'Cron jobs OK';
  console.log(`   [${cronIcon}] ${cronText}`);
  console.log('');

  // 5. 最終判斷
  const canDeploy = allSyntaxOk && allSafetyOk;
  if (canDeploy) {
    log('green', '✅ 全部檢查通過！');
    console.log('');
  } else {
    if (!allSafetyOk) {
      log('yellow', `⚠️  發現 ${safetyResults.length} 個 Safety 問題`);
    }
    if (!allSyntaxOk) {
      log('red', `❌ 發現語法錯誤！必須修復先可以 deploy`);
    }
    console.log('');
  }

  // 6. 等用戶確認
  if (!process.stdin.isTTY || args.includes('--yes') || args.includes('-y')) {
    // Non-interactive: auto-confirm or skip
    if (allSyntaxOk && allSafetyOk) {
      log('green', '✅ 全部檢查通過（自動確認）');
      process.exit(0);
    } else {
      log('yellow', '⏹️  Deploy 已取消（仍有問題）');
      process.exit(1);
    }
  }
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = canDeploy
    ? '❓ Continue with deploy? (y/N) '
    : '❓ 仍有問題存在，強制 deploy？ (y/N) ';

  rl.question(question, (answer) => {
    rl.close();
    const confirmed = answer.trim().toLowerCase() === 'y';
    if (confirmed) {
      log('green', '✅ Deploy 確認通過！');
      process.exit(0);
    } else {
      log('yellow', '⏹️  Deploy 已取消。');
      process.exit(1);
    }
  });
}

// ==================== COMMANDS ====================

/**
 * 主掃描 + 修復流程
 */
function runScanAndFix(autofix = true, quiet = false) {
  log('cyan', '🔍 Auto-Audit 開始...');
  if (isDryRun) log('yellow', '⚠️  DRY-RUN 模式 — 不會修改任何檔案');
  console.log('');

  // 1. 掃描 errors.json
  log('dim', '📋 掃描 errors.json...');
  const errorResult = scanErrors();
  log('dim', `   未解決: ${errorResult?.unresolved?.length}, 新增(24h): ${errorResult?.recentNew?.length}, 重複: ${errorResult?.recurring?.length}`);

  // 2. 找到最近修改的檔案
  log('dim', '📂 搜尋最近修改的檔案...');
  const recentFiles = findRecentFiles();
  log('dim', `   找到 ${recentFiles.length} 個檔案`);
  console.log('');

  // 3. Error Pattern Analysis
  log('dim', '🔬 分析 error patterns...');
  const errorAnalysis = analyzeErrorPatterns();
  log('dim', `   識別到 ${errorAnalysis?.types?.length} 個錯誤類型`);
  console.log('');

  // 4. 系統審計（語法檢查、硬編碼路徑、Cron、懸空引用）
  log('dim', '🔧 執行系統審計...');
  const systemAudit = runSystemAudit();
  const saSummary = [];
  if (!systemAudit?.syntax?.ok) saSummary.push(`語法錯誤: ${systemAudit?.syntax?.js?.length} JS, ${systemAudit?.syntax?.sh?.length} SH`);
  if (systemAudit?.hardcodedPaths?.length > 0) saSummary.push(`硬編碼路徑: ${systemAudit?.hardcodedPaths?.length}`);
  if (systemAudit?.cronMissing?.length > 0) saSummary.push(`Cron 缺失腳本: ${systemAudit?.cronMissing?.length}`);
  if (systemAudit?.cronHardcodedDates?.length > 0) saSummary.push(`Cron 硬編碼日期: ${systemAudit?.cronHardcodedDates?.length}`);
  if (systemAudit?.danglingRefs?.length > 0) saSummary.push(`懸空引用: ${systemAudit?.danglingRefs?.length}`);
  if ((systemAudit.missingHelper || []).length > 0) saSummary.push(`Missing Helper: ${systemAudit?.missingHelper?.length}`);
  if ((systemAudit.syncInAsync || []).length > 0) saSummary.push(`Sync in Async: ${systemAudit?.syncInAsync?.length}`);
  if ((systemAudit.infiniteLoopRisk || []).length > 0) saSummary.push(`Infinite Loop: ${systemAudit?.infiniteLoopRisk?.length}`);
  if ((systemAudit.otherIssues || []).length > 0) saSummary.push(`其他問題: ${systemAudit?.otherIssues?.length}`);
  if (saSummary.length > 0) {
    log('yellow', `   ⚠️ ${saSummary.join(', ')}`);
  } else {
    log('green', '   ✅ 系統審計通過');
  }
  console.log('');

  if (recentFiles.length === 0) {

    log('green', '✅ 沒有最近修改的檔案需要審計');
    const report = generateReport({
      filesScanned: 0,
      filesWithIssues: 0,
      totalLowRisk: 0,
      totalLowRiskFixed: 0,
      totalHighRisk: 0,
      errorsUnresolved: errorResult?.unresolved?.length,
      errorsRecurring: errorResult?.recurring?.length,
      fixResults: [],
      highRiskItems: [],
      errorSummary: {
        recentNew: errorResult.recentNew,
        recurring: errorResult.recurring,
      },
      errorAnalysis,
      systemAudit,
    });
    if (!quiet) printReport(report, outputFormat);
    // 只有實際修復模式才更新 lastAudit
    if (autofix && !isDryRun) {
      saveAuditState({
        lastAudit: new Date().toISOString(),
        lastAuditFiles: [],
        version: 1,
      });
    }
    return report;
  }

  // 4. 分析每個檔案
  let totalLowRisk = 0;
  let totalLowRiskFixed = 0;
  let totalHighRisk = 0;
  let filesWithIssues = 0;
  const fixResults = [];
  const highRiskItems = [];
  const seenHighRisk = new Set(); // 去重：rule.id + file + lines
  let highRiskCounter = 0;

  for (const file of recentFiles) {
    log('dim', `   🔍 ${file.name}...`);
    const analysis = analyzeFile(file.path);

    const hasIssues = analysis?.lowRisk?.length > 0 || analysis?.highRisk?.length > 0;
    if (hasIssues) filesWithIssues++;

    totalLowRisk += analysis?.lowRisk?.length;
    totalHighRisk += analysis?.highRisk?.length;

    // Auto-fix low-risk
    if (autofix && analysis?.lowRisk?.length > 0) {
      const fixResult = autoFixFile(file.path, analysis.lowRisk);
      totalLowRiskFixed += fixResult.fixed;
      if (fixResult?.details?.length > 0) {
        fixResults.push({
          file: analysis.file,
          fixed: fixResult.fixed,
          details: fixResult.details,
        });

        // Record each successful fix in history
        for (const detail of fixResult.details) {
          if (detail.startsWith('✅ ')) {
            const ruleName = detail.slice(2).trim();
            // Extract issue description from lowRisk issues
            const matchedIssues = analysis?.lowRisk?.filter(i => i.name === ruleName);
            const issueDesc = matchedIssues.length > 0
              ? matchedIssues[0].details || matchedIssues[0].name
              : ruleName;
            const expectedEffect = `Low-risk fix: ${ruleName} — should reduce ${ruleName} occurrences`;

            if (!isDryRun) {
              try {
                const fixId = addFixRecord(analysis.file, issueDesc, ruleName, expectedEffect);
                if (fixId) log('dim', `   📝 Recorded to fix history: ${fixId}`);
              } catch (e) {
                log('dim', `   ⚠️  History recording failed: ${e.message}`);
              }
            }
          }
        }
      }
    } else if (analysis?.lowRisk?.length > 0) {
      // scan-only mode: 列出但不修復
      fixResults.push({
        file: analysis.file,
        fixed: 0,
        details: analysis?.lowRisk?.map(i => `🔎 ${i.name}: ${i.details}`),
      });
    }

    // Collect high-risk (with deduplication)
    for (const hr of analysis.highRisk) {
      // 去重 key: rule.id + 最關鍵的行號（取第一行）
      const firstLine = hr.lines && hr?.lines?.length > 0 ? hr.lines[0] : 0;
      const dedupKey = `${hr.rule}:${analysis.file}:${firstLine}`;
      if (seenHighRisk.has(dedupKey)) continue;
      seenHighRisk.add(dedupKey);

      highRiskCounter++;
      highRiskItems.push({
        id: `HR-${String(highRiskCounter).padStart(3, '0')}`,
        file: analysis.file,
        ...hr,
      });
    }
  }

  // 5. 生成報告
  const report = generateReport({
    filesScanned: recentFiles.length,
    filesWithIssues,
    totalLowRisk,
    totalLowRiskFixed,
    totalHighRisk,
    errorsUnresolved: errorResult?.unresolved?.length,
    errorsRecurring: errorResult?.recurring?.length,
    fixResults,
    highRiskItems,
    errorSummary: {
      recentNew: errorResult?.recentNew?.map(e => ({
        id: e.id, type: e.type, problem: e.problem, count: e.count,
      })),
      recurring: errorResult?.recurring?.map(e => ({
        id: e.id, type: e.type, problem: e.problem, count: e.count,
      })),
    },
    errorAnalysis,
    systemAudit,
  });

  if (!quiet) printReport(report, outputFormat);

  // 6. 更新狀態（只有實際修復模式才更新 lastAudit，scan/dry-run 不更新）
  if (autofix && !isDryRun) {
    saveAuditState({
      lastAudit: new Date().toISOString(),
      lastAuditFiles: recentFiles.map(f => f.name),
      version: 1,
    });
  }

  return report;
}

/**
 * 查看上次報告
 */
function showReport() {
  try {
    let exists;
    try {
      exists = fs.existsSync(AUDIT_REPORT);
    } catch (e) {
      log('red', `❌ 無法檢查報告: ${e.message}`);
      return;
    }
    if (!exists) {
      log('yellow', '⚠️  尚未有 audit 報告。執行 `node scripts/auto_fix.js` 先。');
      return;
    }
    let report;
    try {
      report = JSON.parse(fs.readFileSync(AUDIT_REPORT, 'utf-8'));
    } catch (e) {
      log('red', `❌ 無法讀取報告: ${e.message}`);
      return;
    }
    printReport(report, outputFormat);
  } catch (e) {
    log('red', `❌ 無法讀取報告: ${e.message}`);
  }
}

/**
 * 確認 high-risk 問題已處理
 */
function confirmHighRisk(id) {
  if (!id) {
    log('yellow', '⚠️  請提供 high-risk ID，例如: confirm HR-001');
    return;
  }

  try {
    let exists;
    try {
      exists = fs.existsSync(AUDIT_REPORT);
    } catch (e) {
      log('red', `❌ 無法檢查報告: ${e.message}`);
      return;
    }
    if (!exists) {
      log('yellow', '⚠️  尚未有 audit 報告。');
      return;
    }

    let report;
    try {
      report = JSON.parse(fs.readFileSync(AUDIT_REPORT, 'utf-8'));
    } catch (e) {
      log('red', `❌ 無法讀取報告: ${e.message}`);
      return;
    }
    const item = (report.highRisk || []).find(h => h.id === id.toUpperCase());

    if (!item) {
      log('red', `❌ 找不到 ID: ${id}`);
      log('dim', `可用 IDs: ${(report.highRisk || []).map(h => h.id).join(', ')}`);
      return;
    }

    // 標記為已確認
    item.confirmed = true;
    item.confirmedAt = new Date().toISOString();
    const tmpFile = `${AUDIT_REPORT}.tmp.${Date.now()}`;
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(report, null, 2));
      fs.renameSync(tmpFile, AUDIT_REPORT);
    } catch (e) {
      log('red', `❌ 無法更新報告: ${e.message}`);
      try {
        fs.unlinkSync(tmpFile);
      } catch { /* ignore */ }
      return;
    }

    log('green', `✅ 已確認 ${id}: ${item.name} (${item.file})`);
  } catch (e) {
    log('red', `❌ 確認失敗: ${e.message}`);
  }
}

// ==================== IMPACT ANALYSIS ====================

/**
 * Lightweight impact scan — single pass for all modified files at deploy-check time.
 * Avoids calling runImpactAnalysis() per-file (which is slow).
 * Returns { dependencies: Set, cronImpact: string[] }
 */
function getLightweightImpacts(modifiedFiles) {
  const dependencyCount = new Set();
  const cronImpact = [];

  // Pre-collect all scripts (once)
  const extensions = ['.js', '.mjs', '.cjs'];
  const allScripts = [];
  function collectScripts(dir, depth = 0) {
    if (depth > 2) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry?.name?.startsWith('.')) continue;
        if (['node_modules', 'archive', 'lib'].includes(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          collectScripts(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const e = path.extname(entry.name);
          if (extensions.includes(e)) allScripts.push(fullPath);
        }
      }
    } catch { /* ignore */ }
  }
  collectScripts(SCRIPTS_DIR);

  // Parse crontab (once)
  const cronJobs = parseCrontab();

  for (const f of modifiedFiles) {
    const targetName = path.basename(f.path);
    const scriptNameNoExt = targetName.replace(/\.(js|sh|mjs|cjs)$/, '');

    const requirePatterns = [
      new RegExp(`require\\s*\\(\\s*['"](\\.\\.?\\/)?${scriptNameNoExt}['"]\\s*\\)`),
      new RegExp(`require\\s*\\(\\s*['"]${scriptNameNoExt}['"]\\s*\\)`),
      new RegExp(`['"](/[^'"]*${targetName})['"]`),
    ];
    for (const scriptPath of allScripts) {
      try {
        const content = fs.readFileSync(scriptPath, 'utf-8');
        for (const pattern of requirePatterns) {
          pattern.lastIndex = 0;
          if (pattern.test(content)) {
            dependencyCount.add(path.basename(scriptPath));
            break;
          }
        }
      } catch { /* ignore */ }
    }
    for (const job of cronJobs) {
      if (job.script === targetName || job.script === scriptNameNoExt || job?.command?.includes(targetName)) {
        cronImpact.push(`${targetName} → ${describeCronSchedule(job.schedule)}`);
      }
    }
  }
  return { dependencies: dependencyCount, cronImpact };
}


/**
 * 解析 crontab，返回每個 job 的資訊
 */
function parseCrontab() {
  const jobs = [];
  try {
    let output;
    try {
      output = execFileSync('crontab', ['-l'], { encoding: 'utf-8', timeout: 5000 });
    } catch { return jobs; }
    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      // 匹配: minute hour day month dow command
      const match = trimmed.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
      if (match) {
        const [, minute, hour, day, month, dow, command] = match;
        // 提取 script 路徑
        const scriptMatch = command.match(/scripts\/([^\s]+\.js|[^\s]+\.sh)/);
        if (scriptMatch) {
          jobs.push({
            raw: trimmed,
            schedule: `${minute} ${hour} ${day} ${month} ${dow}`,
            script: scriptMatch[1],
            command: command.trim(),
          });
        }
      }
    }
  } catch { /* crontab 可能係空 */ }
  return jobs;
}

/**
 * 描述 cron schedule 為人類可讀格式
 */
function describeCronSchedule(schedule) {
  const parts = schedule.split(' ');
  if (parts.length < 5) return schedule;
  const [minute, hour, day, month, dow] = parts;

  if (minute === '*' && hour === '*') return '每分鐘';
  if (minute === '0' && hour === '*') return '每小時 (xx:00)';
  if (minute === '0' && hour !== '*') return `每日 ${hour}:00`;
  if (minute !== '*' && minute.includes('/')) {
    const interval = minute.split('/')[1];
    return `每 ${interval} 分鐘`;
  }
  if (minute === '0' && hour === '0') return '每日午夜 (00:00)';
  if (minute === '0' && hour === '3') return '每日 03:00';
  if (minute === '0' && hour === '4') return '每日 04:00';
  if (minute === '30' && hour === '0') return '每日 00:30';
  if (minute === '35' && hour === '0') return '每日 00:35';
  if (minute === '0' && hour === '23') return '每日 23:00';
  if (dow && dow !== '*') return `每週 ${dow}`;
  if (day !== '*' && day !== '0') return `每月 ${day} 日`;
  return schedule;
}

/**
 * 檢查檔案是否存在並有語法錯誤
 */
function checkSyntax(filePath) {
  const ext = path.extname(filePath);
  try {
    if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      try {
        execFileSync('node', ['--check', filePath], { timeout: 5000 });
      } catch (e) {
        const msg = e.stderr || e.message || '';
        return { ok: false, error: msg.trim().substring(0, 200) };
      }
      return { ok: true, error: null };
    } else if (ext === '.sh' || ext === '.bash') {
      try {
        execFileSync('bash', ['-n', filePath], { timeout: 5000 });
      } catch (e) {
        const msg = e.stderr || e.message || '';
        return { ok: false, error: msg.trim().substring(0, 200) };
      }
      return { ok: true, error: null };
    }
  } catch (e) {
    const msg = e.stderr || e.message || '';
    return { ok: false, error: msg.trim().substring(0, 200) };
  }
  return { ok: null, error: 'unknown extension' };
}

/**
 * 分析指定 script 的影響範圍
 */
function runImpactAnalysis(scriptName) {
  if (!scriptName) {
    log('yellow', '⚠️  請提供 script 名稱，例如: node scripts/auto_fix.js impact issue_manager.js');
    return;
  }

  // 移除路徑前綴，只保留檔案名
  const targetName = path.basename(scriptName);
  const scriptsDir = SCRIPTS_DIR;
  const targetPath = path.join(scriptsDir, targetName);

  log('cyan', `🔍 Impact Analysis: ${targetName}`);
  console.log('');

  // 1. 檢查檔案是否存在
  let exists;
  try {
    exists = fs.existsSync(targetPath);
  } catch (e) {
    log('red', `❌ 無法檢查檔案: ${e.message}`);
    return;
  }
  if (!exists) {
    log('red', `❌ 檔案唔存在: ${targetPath}`);
    log('dim', '   請確認檔案位於 scripts/ 目錄');
    return;
  }

  // 2. 讀取 target script 內容
  let targetContent;
  try {
    targetContent = fs.readFileSync(targetPath, 'utf-8');
  } catch (e) {
    log('red', `❌ 無法讀取檔案: ${e.message}`);
    return;
  }

  const result = {
    file: targetName,
    path: targetPath,
    timestamp: new Date().toISOString(),
    timestampHKT: toHKT(new Date().toISOString()),
    dependencies: {
      requiredBy: [],
      requires: [],
    },
    safety: {
      syntax: null,
      tryCatch: [],
      hardcodedPaths: [],
      shellInjection: [],
    },
    cronImpact: [],
    recommendations: [],
  };

  // 3. 語法檢查
  const syntaxCheck = checkSyntax(targetPath);
  const safetyObj = result.safety;
  if (syntaxCheck.ok === true) {
    if (safetyObj) safetyObj.syntax = '✅ OK';
  } else if (syntaxCheck.ok === false) {
    if (safetyObj) safetyObj.syntax = `❌ 語法錯誤: ${syntaxCheck.error}`;
    if (result.recommendations) result.recommendations.push('🔴 語法錯誤！必須先修復先可以繼續');
  } else {
    if (safetyObj) safetyObj.syntax = '⚪ 無法檢查（未知副檔名）';
  }

  // 4. 找出 requiredBy（邊個 require 呢個 script）
  const ext = path.extname(targetName);
  const extensions = ['.js', '.mjs', '.cjs'];
  const allScripts = [];

  function collectScripts(dir, depth = 0) {
    if (depth > 2) return;
    try {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) { return; }
      for (const entry of entries) {
        if (entry?.name?.startsWith('.')) continue;
        if (entry.name === 'node_modules' || entry.name === 'archive' || entry.name === 'lib') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          collectScripts(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const e = path.extname(entry.name);
          if (extensions.includes(e) && entry.name !== targetName) {
            allScripts.push(fullPath);
          }
        }
      }
    } catch { /* ignore */ }
  }

  collectScripts(scriptsDir);

  // 構造 require pattern（支援 ./script, ../scripts/script, script 名）
  const requirePatterns = [
    // require('./issue_manager') or require('./issue_manager.js')
    new RegExp(`require\\s*\\(\\s*['"](\\.\\.?/)?${targetName.replace(/\.js$/, '')}['"]\\s*\\)`),
    // require('issue_manager') — 假設有 symlink 或 node_modules
    new RegExp(`require\\s*\\(\\s*['"]${targetName.replace(/\.js$/, '')}['"]\\s*\\)`),
    // Node child_process spawn/exec 引用 script path
    new RegExp(`['"](/[^'"]*${targetName})['"]`),
    // spawn('node', ['scripts/issue_manager.js'])
    new RegExp(`['"]([^'"]*${targetName})['"]`),
  ];

  for (const scriptPath of allScripts) {
    try {
      let content;
      try {
        content = fs.readFileSync(scriptPath, 'utf-8');
      } catch (e) { continue; }
      for (const pattern of requirePatterns) {
        if (pattern.test(content)) {
          result?.dependencies?.requiredBy?.push(path.basename(scriptPath));
          break;
        }
      }
    } catch { /* ignore */ }
  }

  // 5. 找出 requires（呢個 script require 咗邊個）
  const requireMatches = targetContent.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const m of requireMatches) {
    const req = m[1];
    // 跳過相對路徑（自己目錄下）
    if (!req.startsWith('.') && !req.startsWith('/')) {
      result?.dependencies?.requires?.push(req);
    }
  }
  if (result.dependencies) result.dependencies.requires = [...new Set(result?.dependencies?.requires)];

  // 6. Safety 檢查 - try-catch
  // 危險操作：fs.writeFileSync, fs.readFileSync, execSync, execFileSync, spawnSync
  const dangerousSyncCalls = [
    { method: 'fs.writeFileSync', pattern: /fs\.writeFileSync\s*\(/g },
    { method: 'fs.readFileSync', pattern: /fs\.readFileSync\s*\(/g },
    { method: 'execSync', pattern: /execSync\s*\(/g },
    { method: 'execFileSync', pattern: /execFileSync\s*\(/g },
    { method: 'spawnSync', pattern: /spawnSync\s*\(/g },
  ];

  const dangerousAsyncCalls = [
    { method: 'exec', pattern: /exec\s*\(/g },
    { method: 'spawn', pattern: /spawn\s*\(/g },
    { method: 'execFile', pattern: /execFile\s*\(/g },
  ];

  const allLines = targetContent.split('\n');
  const tryCatchRanges = [];
  let inTryCatch = false;
  let tryStart = 0;

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    // 簡化的 try-catch 範圍追蹤
    const tryMatch = line.match(/^\s*try\s*\{?\s*$/);
    const catchMatch = line.match(/^\s*\}\s*catch/);
    const catchEnd = line.match(/\}\s*$/);
    if (tryMatch) { inTryCatch = true; tryStart = i; }
    if (catchMatch) inTryCatch = false;
  }

  for (const { method, pattern } of dangerousSyncCalls) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(targetContent)) !== null) {
      const beforeContext = targetContent.substring(Math.max(0, match.index - 200), match.index);
      const afterContext = targetContent.substring(match.index, match.index + 100);
      // 簡單判斷：檢查呢個 call 前後 5 行內有冇 try-catch
      const startLine = targetContent.substring(0, match.index).split('\n').length;
      const nearbyLines = allLines.slice(Math.max(0, startLine - 3), Math.min(allLines.length, startLine + 2));
      const hasTryCatch = nearbyLines.some(l => /\btry\b|\bcatch\b/.test(l));
      if (!hasTryCatch) {
        result?.safety?.tryCatch?.push(
          `⚠️ ${method} at line ${startLine} - missing try-catch`
        );
      }
    }
  }

  // 7. Safety 檢查 - hardcoded paths
  const homeDir = process.env.HOME || '';
  const hardcodedPathPattern = /(['"`])(?!\$|\{)(?:\/(?:Users|home|usr|var|etc)[^\1]*|[A-Z]:\\(?!%)(?:[^\\"\n]*?))\1/g;
  const homeRelative = new RegExp(`['"']${homeDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\/[^'"\`]+['"']`, 'g');

  // 讀取 lib/config 看預期使用哪些環境變量
  let expectedEnvPaths = [];
  try {
    let configContent;
    try {
      configContent = fs.readFileSync(path.join(scriptsDir, 'lib/config.js'), 'utf-8');
    } catch (e) { /* ignore */ }
    if (configContent) {
      const envMatches = configContent.matchAll(/process\.env\.(\w+)/g);
      for (const m of envMatches) expectedEnvPaths.push(m[1]);
    }
  } catch { /* ignore */ }

  const pathPatterns = [
    { pattern: /(['"`])(?!\$|\{)(?:\/(?:Users|home|usr|var|etc|tmp)[^\1]*)\1/g, type: 'absolute' },
  ];

  for (const { pattern } of pathPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(targetContent)) !== null) {
      const pathVal = match[0].slice(1, -1);
      // 跳過 environment variable 引用
      if (pathVal.includes('HOME') || pathVal.includes('$')) continue;
      // 跳過使用 config 的
      if (expectedEnvPaths.some(p => pathVal.includes(p))) continue;
      const lineNum = targetContent.substring(0, match.index).split('\n').length;
      // 跳過 config.js 自己
      if (targetName === 'config.js') continue;
      result?.safety?.hardcodedPaths?.push(
        `⚠️ line ${lineNum}: \`${pathVal}\` — 建議用 process.env 或 lib/config`
      );
    }
  }

  // 8. Safety 檢查 - shell injection
  const dangerousInputs = [
    /execSync\s*\(\s*`[^`]*\$\{/g,
    /execSync\s*\(\s*['"][^'"]*\$\{/g,
    /spawn\s*\([^,]+,\s*\[[^\]]*`[^`]*\$\{/g,
    /exec\s*\(\s*`[^`]*\$\{/g,
  ];

  for (const pattern of dangerousInputs) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(targetContent)) !== null) {
      const lineNum = targetContent.substring(0, match.index).split('\n').length;
      result?.safety?.shellInjection?.push(
        `⚠️ line ${lineNum}: 可能存在 shell injection — ${match[0].substring(0, 60)}...`
      );
    }
  }

  // 9. Cron impact
  const cronJobs = parseCrontab();
  const scriptNameNoExt = targetName.replace(/\.(js|sh|mjs|cjs)$/, '');
  for (const job of cronJobs) {
    if (job.script === targetName || job.script === scriptNameNoExt || job?.command?.includes(targetName)) {
      result?.cronImpact?.push({
        job: path.basename(job?.command?.split(' ')[0].replace(/.*scripts\//, '')) || job.script,
        schedule: describeCronSchedule(job.schedule),
        rawSchedule: job.schedule,
        command: job?.command?.substring(0, 80),
      });
    }
  }

  // 10. 綜合建議
  if (result?.safety?.syntax === '✅ OK') {
    result?.recommendations?.push('✅ 語法檢查通過');
  }
  if (result?.safety?.tryCatch?.length > 0) {
    result?.recommendations?.push(`⚠️ 有 ${result?.safety?.tryCatch?.length} 處危險操作缺少 try-catch`);
  }
  if (result?.safety?.hardcodedPaths?.length > 0) {
    result?.recommendations?.push(`⚠️ 有 ${result?.safety?.hardcodedPaths?.length} 處 hardcoded paths`);
  }
  if (result?.safety?.shellInjection?.length > 0) {
    result?.recommendations?.push(`🔴 有 ${result?.safety?.shellInjection?.length} 處疑似 shell injection`);
  }
  if (result?.dependencies?.requiredBy?.length > 0) {
    result?.recommendations?.push(
      `📝 影響 ${result?.dependencies?.requiredBy?.length} 個 scripts: ${result?.dependencies?.requiredBy?.join(', ')}`
    );
  } else {
    result?.recommendations?.push('✅ 沒有其他 scripts 依賴呢個檔案');
  }
  if (result?.cronImpact?.length > 0) {
    result?.recommendations?.push(`🕐 Cron jobs 影響: ${result?.cronImpact?.map(j => j.schedule).join(', ')}`);
  } else {
    result?.recommendations?.push('✅ 沒有 cron jobs 依賴呢個檔案');
  }
  result?.recommendations?.push('🔧 修改前建議：先做 syntax check (`node --check`)');

  // ==================== 輸出報告 ====================
  console.log(`${C.bold}📄 ${targetName}${C.reset}`);
  console.log('');

  // Dependencies
  log('cyan', '📦 依賴關係');
  console.log(`   ${C.bold}依賴於 (requires):${C.reset}`);
  if (result?.dependencies?.requires?.length > 0) {
    for (const r of result?.dependencies?.requires?.slice(0, 20)) {
      console.log(`      • ${r}`);
    }
  } else {
    console.log(`      ${C.dim}(冇外部 require)${C.reset}`);
  }
  console.log(`   ${C.bold}被依賴於 (requiredBy):${C.reset}`);
  if (result?.dependencies?.requiredBy?.length > 0) {
    for (const r of result?.dependencies?.requiredBy) {
      console.log(`      ⚠️  ${C.yellow}${r}${C.reset}`);
    }
  } else {
    console.log(`      ${C.dim}(冇其他 scripts 依賴)${C.reset}`);
  }
  console.log('');

  // Safety
  log('cyan', '🔒 安全性檢查');
  console.log(`   Syntax: ${result?.safety?.syntax}`);
  if (result?.safety?.tryCatch?.length > 0) {
    console.log(`   ${C.yellow}⚠️  Missing try-catch (${result?.safety?.tryCatch?.length}):${C.reset}`);
    for (const t of result?.safety?.tryCatch?.slice(0, 5)) {
      console.log(`      ${C.dim}${t}${C.reset}`);
    }
    if (result?.safety?.tryCatch?.length > 5) {
      console.log(`      ${C.dim}... 仲有 ${result?.safety?.tryCatch?.length - 5} 處${C.reset}`);
    }
  }
  if (result?.safety?.hardcodedPaths?.length > 0) {
    console.log(`   ${C.yellow}⚠️  Hardcoded paths (${result?.safety?.hardcodedPaths?.length}):${C.reset}`);
    for (const p of result?.safety?.hardcodedPaths?.slice(0, 5)) {
      console.log(`      ${C.dim}${p}${C.reset}`);
    }
    if (result?.safety?.hardcodedPaths?.length > 5) {
      console.log(`      ${C.dim}... 仲有 ${result?.safety?.hardcodedPaths?.length - 5} 處${C.reset}`);
    }
  }
  if (result?.safety?.shellInjection?.length > 0) {
    console.log(`   ${C.red}🔴 Shell Injection (${result?.safety?.shellInjection?.length}):${C.reset}`);
    for (const s of result?.safety?.shellInjection) {
      console.log(`      ${C.dim}${s}${C.reset}`);
    }
  }
  if (result?.safety?.tryCatch?.length === 0 && result?.safety?.hardcodedPaths?.length === 0 && result?.safety?.shellInjection?.length === 0) {
    console.log(`   ${C.green}✅ 冇發現安全問題${C.reset}`);
  }
  console.log('');

  // Cron Impact
  log('cyan', '🕐 Cron Jobs 影響');
  if (result?.cronImpact?.length > 0) {
    for (const j of result.cronImpact) {
      console.log(`   🕐 ${C.bold}${j.schedule}${C.reset} — ${C.dim}${j.command}${C.reset}`);
    }
  } else {
    console.log(`   ${C.dim}(冇 cron jobs 依賴呢個檔案)${C.reset}`);
  }
  console.log('');

  // Recommendations
  log('cyan', '💡 建議');
  for (const rec of result.recommendations) {
    if (rec.startsWith('✅')) {
      console.log(`   ${C.green}${rec}${C.reset}`);
    } else if (rec.startsWith('🔴')) {
      console.log(`   ${C.red}${rec}${C.reset}`);
    } else if (rec.startsWith('⚠️')) {
      console.log(`   ${C.yellow}${rec}${C.reset}`);
    } else if (rec.startsWith('📝')) {
      console.log(`   ${C.cyan}${rec}${C.reset}`);
    } else if (rec.startsWith('🔧')) {
      console.log(`   ${C.magenta}${rec}${C.reset}`);
    } else {
      console.log(`   ${rec}`);
    }
  }
  console.log('');

  // JSON output (if requested via --format=json)
  if (outputFormat === 'json') {
    console.log('--- JSON OUTPUT ---');
    console.log(JSON.stringify(result, null, 2));
  }

  return result;
}

// ==================== SPAWN SUB-AGENT ====================

/**
 * 將 audit report 壓縮成文字 brief，供 sub-agent 消化
 */
function generateAuditBrief(report) {
  const s = report.summary;
  const lines = [];

  lines.push('# Auto-Audit Brief');
  lines.push(`📅 ${report.timestampHKT} HKT`);
  lines.push('');

  // Summary
  lines.push('## 📊 概覽');
  lines.push(`- 掃描檔案: ${s.filesScanned}`);
  lines.push(`- 有問題檔案: ${s.filesWithIssues}`);
  lines.push(`- Low-risk 已修復: ${s.lowRiskFixed}/${s.lowRiskTotal}`);
  lines.push(`- High-risk 待確認: ${s.highRiskTotal}`);
  lines.push(`- 未解決錯誤: ${s.errorsUnresolved}`);
  lines.push(`- 重複錯誤: ${s.errorsRecurring}`);
  lines.push(`- 系統審計問題: ${s.systemAuditIssues}`);
  lines.push('');

  // High-risk items
  if (report.highRisk && report?.highRisk?.length > 0) {
    lines.push('## ⚠️ High-Risk 問題');
    for (const item of report.highRisk) {
      lines.push(`### ${item.id} — ${item.file}`);
      lines.push(`- **問題:** ${item.name}`);
      lines.push(`- **嚴重性:** ${item.severity}`);
      lines.push(`- **詳情:** ${item.details}`);
      if (item.suggestion) lines.push(`- **建議:** ${item.suggestion}`);
      if (item.lines && item?.lines?.length > 0) {
        lines.push(`- **行號:** ${item?.lines?.slice(0, 10).join(', ')}`);
      }
      lines.push('');
    }
  }

  // System Audit
  if (report.systemAudit) {
    const sa = report.systemAudit;
    const issues = [];

    if (sa?.syntax?.js?.length > 0) {
      issues.push('### JS 語法錯誤');
      for (const item of sa?.syntax?.js) {
        issues.push(`- ${item.file}: ${item.error}`);
      }
    }
    if (sa?.syntax?.sh?.length > 0) {
      issues.push('### SH 語法錯誤');
      for (const item of sa?.syntax?.sh) {
        issues.push(`- ${item.file}: ${item.error}`);
      }
    }
    if (sa?.hardcodedPaths?.length > 0) {
      issues.push(`### 硬編碼路徑 (${sa?.hardcodedPaths?.length} 處)`);
      for (const item of sa?.hardcodedPaths?.slice(0, 10)) {
        issues.push(`- ${item.file}:${item.line} — ${item.suggestion}`);
      }
    }
    if (sa?.cronMissing?.length > 0) {
      issues.push(`### Cron 引用缺失腳本 (${sa?.cronMissing?.length} 個)`);
      for (const item of sa.cronMissing) {
        issues.push(`- ${item.scriptPath}`);
      }
    }
    if (sa?.cronHardcodedDates?.length > 0) {
      issues.push(`### Cron 硬編碼日期 (${sa?.cronHardcodedDates?.length} 處)`);
      for (const item of sa?.cronHardcodedDates?.slice(0, 5)) {
        issues.push(`- ${item.source}: ${item.date}`);
      }
    }
    if (sa?.danglingRefs?.length > 0) {
      issues.push(`### 懸空引用 (${sa?.danglingRefs?.length} 個)`);
      for (const item of sa?.danglingRefs?.slice(0, 10)) {
        issues.push(`- ${item.file}:${item.line} → ${item.ref}`);
      }
    }
    if ((sa.moduleNotFound || []).length > 0) {
      issues.push(`### Module Not Found (${sa?.moduleNotFound?.length} 個)`);
      for (const item of sa?.moduleNotFound?.slice(0, 10)) {
        issues.push(`- ${item.file}:${item.line} → require('${item.require}')`);
      }
    }
    if ((sa.missingHelper || []).length > 0) {
      issues.push(`### Missing Helper (${sa?.missingHelper?.length} 處)`);
      for (const item of sa?.missingHelper?.slice(0, 10)) {
        issues.push(`- ${item.file}:${item.line} → ${item.funcName}()`);
      }
    }
    if ((sa.syncInAsync || []).length > 0) {
      issues.push(`### Sync in Async (${sa?.syncInAsync?.length} 處)`);
      for (const item of sa?.syncInAsync?.slice(0, 10)) {
        issues.push(`- ${item.file}:${item.line} — ${item.syncCall} in ${item.asyncFunc}()`);
      }
    }
    if ((sa.infiniteLoopRisk || []).length > 0) {
      issues.push(`### Infinite Loop Risk (${sa?.infiniteLoopRisk?.length} 處)`);
      for (const item of sa?.infiniteLoopRisk?.slice(0, 5)) {
        issues.push(`- ${item.file}:${item.line}`);
      }
    }

    if (issues.length > 0) {
      lines.push('## 🔧 系統審計');
      lines.push(...issues);
      lines.push('');
    }
  }

  // Error Analysis
  if (report.errorAnalysis && report?.errorAnalysis?.types && report?.errorAnalysis?.types?.length > 0) {
    lines.push('## 🔬 Error Pattern Analysis');
    for (const t of report?.errorAnalysis?.types) {
      const trendIcon = t.trend === 'increasing' ? '📈' : t.trend === 'active' ? '🔄' : '📉';
      lines.push(`${trendIcon} **${t.type}** — ${t.occurrences} 次 (${t.unresolvedCount} 未解決)`);
      lines.push(`  根本原因: ${t.rootCause}`);
      lines.push(`  建議: ${t.fixSuggestion}`);
      lines.push(`  需人手: ${t.needsHuman ? '是' : '否'}`);
      lines.push('');
    }
  }

  // Fixed items
  if (report.fixed && report?.fixed?.length > 0) {
    lines.push('## ✅ 已自動修復 (Low-Risk)');
    for (const item of report.fixed) {
      lines.push(`- **${item.file}**: ${item?.details?.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 生成 spawn sub-agent 嘅 payload
 * 返回 { model, label, prompt, channel, target }
 */
function generateSpawnPayload(report, brief) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const s = report.summary;

  const prompt = [
    '你係 Auto-Audit Sub-Agent，負責審計 OpenClaw workspace 嘅 scripts。',
    '',
    '## 你的身份',
    '- Model: ' + DEFAULT_MODEL,
    '- 語言: 廣東話 (繁體中文)',
    '- 角色: 代碼審計員',
    '',
    '## 審計數據（由本地掃描器收集）',
    '',
    brief,
    '',
    '## 你的任務',
    '',
    '根據以上審計數據，請完成以下工作：',
    '',
    '### 1. 深度分析 High-Risk 問題',
    '對每個 high-risk 問題：',
    '- 讀取相關檔案嘅實際代碼',
    '- 分析根本原因',
    '- 提供具體修復方案（包含代碼）',
    '- 評估修復風險（會唔會破壞其他嘢）',
    '',
    '### 2. 系統審計問題修復',
    '對系統審計發現嘅問題：',
    '- 語法錯誤：直接修復（如果 low-risk）',
    '- 硬編碼路徑：提供修復建議',
    '- Cron 問題：評估影響同修復方案',
    '- 懸空引用：確認係咪可以安全移除',
    '',
    '### 3. 智能發現',
    '除咗以上問題，主動掃描 scripts/ 目錄：',
    '- 搵出邏輯錯誤',
    '- 搵出效能問題',
    '- 搵出安全漏洞',
    '- 搵出不一致嘅代碼風格',
    '- 搵出未處理嘅邊界情況',
    '',
    '### 4. 識別新規則 🆕',
    '你有第二個重要任務：識別可以永久化嘅新規則。',
    '',
    '#### 🔍 應主動識別嘅 Pattern 類型',
    '1. **重複代碼** — 相似邏輯喺多個檔案出現（如相同嘅 getHKTDate 實現）',
    '2. **不一致嘅 Error Handling** — 有些 function 有 try-catch，有些冇',
    '3. **Shared Logic 散落** — 多個檔案有相同 helper function 但各寫各的',
    '4. **Configuration Hardcoded** — 魔術數值/字串重複出現',
    '5. **Async/Sync 混用** — 有的用 async/await，有的用 callback',
    '',
    '#### 識別標準（必須全部符合）',
    '1. **跨檔案重複**：同一 pattern 必須喺 ≥2 個不同檔案出現（我哋 scripts 只有十幾個檔案，門檻唔好設太高）',
    '2. **非一次性**：唔係某個檔案嘅獨特問題，而係系統性 pattern',
    '3. **可自動化檢測**：可以用 regex 或簡單邏輯自動發現',
    '4. **唔同現有規則重複**：對照以上已有嘅問題列表，避免重複',
    '',
    '#### ❌ 唔好建議嘅情況',
    '- 只出現在 1 個檔案（一次性問題）',
    '- 需要理解複雜業務邏輯先至判斷到',
    '- 主觀代碼風格偏好（如「應該用 const 代替 let」）',
    '- 已經被現有規則覆蓋',
    '- Best Practice Police（如「所有 function 都應該有 JSDoc」）',
    '',
    '#### Output 格式',
    '如果發現新規則，喺報告加入：',
    '```',
    '## 🆕 建議新規則',
    '',
    '### [規則ID]',
    '- **名稱**: [規則名稱]',
    '- **類型**: [HIGH_RISK / LOW_RISK]',
    '- **描述**: [問題描述]',
    '- **Evidence**:',
    '  - `[檔案1]:[行號] — [問題代碼]`',
    '  - `[檔案2]:[行號] — [問題代碼]`',
    '- **檢測方式**: [regex / 邏輯描述]',
    '- **可直接貼上嘅 JS 規則代碼**:',
    '```javascript',
    '// [規則ID] 規則定義',
    '{',
    '  id: \'[規則ID]\',',
    '  name: \'[規則名稱]\',',
    '  category: \'[類別]\',',
    '  severity: \'[low|high|medium]\',',
    '  detect(content) { ... },',
    '  fix(content) { ... } // 如果係 low-risk 可以自動修復',
    '},',
    '```',
    '```',
    '',
    '**核心原則：寧缺勿濫。一個高質量嘅規則建議好過十個 noise。如果冇發現真正嘅新規則，請明確寫「本次審計未發現需要新增嘅規則」。**',
    '',
    '### 5. 生成報告',
    '最後輸出一份結構化報告：',
    '```',
    '## Auto Audit Report — ' + dateStr,
    '### 🔴 Critical (需要立即修復)',
    '### 🟠 High (建議盡快修復)',
    '### 🟡 Medium (可以排期修復)',
    '### ⚪ Low (建議改善)',
    '### ✅ 已自動修復',
    '### 🆕 建議新規則',
    '### 💡 建議',
    '```',
    '',
    '## 重要規則',
    '- 用繁體中文（廣東話）',
    '- 修改檔案前用 --dry-run 預覽',
    '- 唔好修改 auto_fix.js 自身',
    '- 高風險修改要列出具體代碼 diff',
    '- 完成後將報告寫入 ~/.openclaw/workspace/.state/auto_fix_result.md',
  ].join('\n');

  return {
    model: DEFAULT_MODEL,
    label: `auto-audit-${dateStr}`,
    prompt,
    channel: 'discord',
    target: DEFAULT_SPAWN_CHANNEL,
    // 額外 metadata
    _meta: {
      generatedAt: new Date().toISOString(),
      summary: {
        filesScanned: s.filesScanned,
        highRisk: s.highRiskTotal,
        systemAuditIssues: s.systemAuditIssues,
        errorsUnresolved: s.errorsUnresolved,
      },
    },
  };
}

/**
 * 執行掃描 → 生成 spawn payload → 輸出
 * 當運行 `node scripts/auto_fix.js` 或 `node scripts/auto_fix.js spawn` 時調用
 */
function runSpawn() {
  try {
  log('cyan', '🚀 Auto-Audit — Spawn Mode');
  if (isDryRun) log('yellow', '⚠️  DRY-RUN 模式 — 只預覽，唔會寫入 payload');
  console.log('');

  // Step 1: 執行本地掃描（scan-only，唔修復）
  log('dim', '📋 Step 1: 執行本地掃描...');
  const report = runScanAndFix(false, true);  // read-only scan, quiet mode
  console.log('');

  // Step 2: 生成 audit brief
  log('dim', '📝 Step 2: 生成 Audit Brief...');
  const brief = generateAuditBrief(report);

  // Step 3: 生成 spawn payload
  log('dim', '🔧 Step 3: 生成 Spawn Payload...');
  const payload = generateSpawnPayload(report, brief);

  // Step 4: 寫入檔案
  if (!isDryRun) {
    ensureDir(STATE_DIR);
    const tmpPayload = `${SPAWN_PAYLOAD}.tmp.${Date.now()}`;
    try {
      fs.writeFileSync(tmpPayload, JSON.stringify(payload, null, 2));
      fs.renameSync(tmpPayload, SPAWN_PAYLOAD);
      log('green', `   ✅ Payload 已寫入: .state/auto_fix_spawn.json`);
    } catch (e) {
      log('red', `   ❌ 無法寫入 payload: ${e.message}`);
      try {
        fs.unlinkSync(tmpPayload);
      } catch { /* ignore */ }
    }
    const tmpBrief = `${AUDIT_BRIEF}.tmp.${Date.now()}`;
    try {
      fs.writeFileSync(tmpBrief, brief);
      fs.renameSync(tmpBrief, AUDIT_BRIEF);
      log('green', `   ✅ Brief 已寫入: .state/auto_fix_brief.md`);
    } catch (e) {
      log('red', `   ❌ 無法寫入 brief: ${e.message}`);
      try {
        fs.unlinkSync(tmpBrief);
      } catch { /* ignore */ }
    }
  } else {
    log('yellow', '   (dry-run: 跳過寫入)');
  }

  console.log('');

  // Step 5: 輸出 spawn 指示
  const s = report.summary;
  const hasWork = s.highRiskTotal > 0 || s.systemAuditIssues > 0 || s.errorsUnresolved > 0;

  if (!hasWork) {
    log('green', '✅ 冇發現需要 sub-agent 處理嘅問題！');
    log('dim', '   所有檢查通過，唔需要 spawn sub-agent。');
    // 寫入一個空結果標記
    if (!isDryRun) {
      try {
        const emptyResult = {
          timestamp: new Date().toISOString(),
          timestampHKT: toHKT(new Date().toISOString()),
          result: 'no-issues',
          summary: report.summary,
        };
        const tmpFile = `${SPAWN_PAYLOAD}.tmp.${Date.now()}`;
        fs.writeFileSync(tmpFile, JSON.stringify(emptyResult, null, 2));
        fs.renameSync(tmpFile, SPAWN_PAYLOAD);
      } catch { /* ignore */ }
    }
    return;
  }

  log('cyan', '═══════════════════════════════════════════════');
  log('bold', '🤖 Sub-Agent Spawn 準備就緒');
  log('cyan', '═══════════════════════════════════════════════');
  console.log('');
  console.log(`   Model:  ${payload.model}`);
  console.log(`   Label:  ${payload.label}`);
  console.log(`   Issues: ${s.highRiskTotal} high-risk, ${s.systemAuditIssues} system-audit, ${s.errorsUnresolved} errors`);
  console.log('');
  log('dim', '📂 Payload 檔案: .state/auto_fix_spawn.json');
  log('dim', '📂 Brief 檔案:   .state/auto_fix_brief.md');
  console.log('');

  // 輸出可直接使用嘅 spawn JSON（供 main agent 讀取）
  log('yellow', '📤 Spawn Payload (JSON):');
  console.log('');
  console.log('SPAWN_PAYLOAD_START');
  console.log(JSON.stringify({
    model: payload.model,
    label: payload.label,
    prompt: payload.prompt,
  }, null, 2));
  console.log('SPAWN_PAYLOAD_END');
  console.log('');

  log('dim', '💡 Main agent 可以讀取 .state/auto_fix_spawn.json 並用 sessions_spawn 執行');
  log('dim', '💡 或者喺對話中講: "執行 Auto Auto Audit spawn"');
  console.log('');
  } catch (e) {
    log('red', `❌ Spawn 流程失敗: ${e.message}`);
    process.exitCode = 1;
  }
}

// ==================== MAIN ====================

function main() {
  switch (command) {
    case 'scan':
      runScanAndFix(false);  // read-only
      break;
    case 'fix':
      runScanAndFix(true);   // scan + fix
      break;
    case 'spawn':
      runSpawn();            // scan + generate spawn payload
      break;
    case 'report':
      showReport();
      break;
    case 'confirm': {
      const id = args.find(a => a !== 'confirm' && !a.startsWith('-'));
      confirmHighRisk(id);
      break;
    }
    case 'skip':
      helpers.handleSkipCommand(args, { AUDIT_REPORT });
      break;
    case 'impact': {
      const target = args.find(a => a !== 'impact' && !a.startsWith('-'));
      if (!target) {
        log('yellow', '⚠️  Usage: node scripts/auto_fix.js impact <script_name>');
        log('dim', '   Example: node scripts/auto_fix.js impact issue_manager.js');
        break;
      }
      runImpactAnalysis(target);
      break;
    }
    case 'deploy-check': {
      runDeployCheck();
      break;
    }
    default:
      // 預設 = spawn（自動掃描 + 生成 sub-agent payload）
      runSpawn();
      break;
  }
}

if (require.main === module) {
  main();
}
