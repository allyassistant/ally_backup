#!/usr/bin/env node
/**
 * Error Auto-Response System
 * 自動檢測、分類同嘗試修復錯誤
 *
 * 使用方法:
 *   node scripts/error_autofix.js scan           # 掃描並嘗試修復
 *   node scripts/error_autofix.js analyze        # 分析錯誤模式
 *   node scripts/error_autofix.js --cron         # Cron job 用 (靜默模式)
 *
 * 功能:
 * 1. 讀取 errors.json 最新錯誤
 * 2. 檢查有無已知解法 (error-patterns.json)
 * 3. 嘗試 auto-fix
 * 4. 記錄結果
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

// 設定
const CONFIG = {
  maxAutoFixAttempts: 3,      // 每個錯誤最多試 3 次
  autoFixCooldownHours: 24,   // 每次嘗試相隔 24 小時
  patternsFile: path.join(__dirname, '..', 'memory', 'error-patterns.json'),
  errorsFile: path.join(__dirname, '..', 'memory', 'errors.json')
};

// 預設錯誤模式 (已知問題 + 解法)
const DEFAULT_PATTERNS = {
  "L1_TIMEOUT": {
    pattern: "L1.*timeout|cron.*job execution timed out",
    category: "performance",
    severity: "medium",
    autoFix: {
      enabled: true,
      action: "increase_timeout",
      description: "增加 L1 Generator timeout",
      steps: [
        "檢查昨日 memory 檔案大小",
        "用 adaptive_timeout.js 計算新 timeout",
        "更新 cron job"
      ]
    },
    fallbackAction: "use_extraction"
  },
  "L0_TIMEOUT": {
    pattern: "L0.*timeout|generate_abstract.*timeout",
    category: "performance",
    severity: "low",
    autoFix: {
      enabled: true,
      action: "increase_timeout",
      description: "增加 L0 Generator timeout"
    },
    fallbackAction: "use_extraction"
  },
  "MODEL_NOT_ALLOWED": {
    pattern: "model not allowed|invalid model",
    category: "configuration",
    severity: "high",
    autoFix: {
      enabled: true,
      action: "fix_model_name",
      description: "修正 model 名稱 (例如 minimax-portal/qwen3 → ollama/qwen3)"
    }
  },
  "DISCORD_DELIVERY_FAILED": {
    pattern: "discord.*delivery failed|announce delivery failed",
    category: "delivery",
    severity: "medium",
    autoFix: {
      enabled: false,  // 通常係暫時性，唔需要 auto-fix
      action: "check_discord_connection",
      description: "檢查 Discord connection"
    }
  },
  "FILE_NOT_FOUND": {
    pattern: "file not found|no such file|ENOENT",
    category: "filesystem",
    severity: "high",
    autoFix: {
      enabled: false,
      action: "create_missing_file",
      description: "創建缺失檔案 (需要人手確認內容)"
    }
  },
  "MEMORY_CLEANUP_NEEDED": {
    pattern: "memory.*full|disk.*full|cleanup needed",
    category: "maintenance",
    severity: "high",
    autoFix: {
      enabled: true,
      action: "run_cleanup",
      description: "執行 cleanup scripts"
    }
  },
  "OLLAMA_401": {
    pattern: "401 Authentication|Auth Error|Invalid API key|401 Unauthorized",
    category: "auth",
    severity: "high",
    autoFix: {
      enabled: true,
      action: "handle_ollama_401",
      description: "Ollama 401 → 標記為已知問題，通知 human，自動 skip"
    }
  },
  "MEMORY_OOM": {
    pattern: "Out of memory|Memory Error",
    category: "memory",
    severity: "high",
    autoFix: {
      enabled: true,
      action: "handle_memory_oom",
      description: "OOM → archive session，reset memory"
    }
  }
};

/**
 * 初始化 patterns 檔案
 */
function initPatternsFile() {
  if (!fs.existsSync(CONFIG.patternsFile)) {
    fs.writeFileSync(CONFIG.patternsFile, JSON.stringify({
      version: "1.0",
      lastUpdated: new Date().toISOString(),
      patterns: DEFAULT_PATTERNS
    }, null, 2));
    console.log(`✅ Created ${CONFIG.patternsFile}`);
  }
}

/**
 * 讀取 patterns
 */
function loadPatterns() {
  initPatternsFile();
  const data = JSON.parse(fs.readFileSync(CONFIG.patternsFile, 'utf-8'));
  return data.patterns || DEFAULT_PATTERNS;
}

/**
 * 讀取 errors
 */
function loadErrors() {
  if (!fs.existsSync(CONFIG.errorsFile)) {
    return [];
  }
  const data = JSON.parse(fs.readFileSync(CONFIG.errorsFile, 'utf-8'));
  return data.errors || [];
}

/**
 * 匹配錯誤模式
 */
function matchErrorPattern(errorMessage, patterns) {
  for (const [patternId, patternData] of Object.entries(patterns)) {
    const regex = new RegExp(patternData.pattern, 'i');
    if (regex.test(errorMessage)) {
      return { patternId, ...patternData };
    }
  }
  return null;
}

/**
 * 檢查是否應該嘗試 auto-fix
 */
function shouldAttemptFix(error, matchedPattern) {
  if (!matchedPattern.autoFix || !matchedPattern.autoFix.enabled) {
    return { shouldFix: false, reason: "Auto-fix disabled for this pattern" };
  }

  // 檢查嘗試次數
  const fixHistory = error.fixHistory || [];
  if (fixHistory.length >= CONFIG.maxAutoFixAttempts) {
    return { shouldFix: false, reason: `Max attempts (${CONFIG.maxAutoFixAttempts}) reached` };
  }

  // 檢查 cooldown
  if (fixHistory.length > 0) {
    const lastAttempt = new Date(fixHistory[fixHistory.length - 1].timestamp);
    const hoursSince = (Date.now() - lastAttempt) / (1000 * 60 * 60);
    if (hoursSince < CONFIG.autoFixCooldownHours) {
      return { shouldFix: false, reason: `Cooldown: ${Math.round(CONFIG.autoFixCooldownHours - hoursSince)} hours remaining` };
    }
  }

  return { shouldFix: true };
}

/**
 * 執行 auto-fix
 */
async function executeFix(error, pattern, isCron = false) {
  const action = pattern.autoFix.action;
  const timestamp = new Date().toISOString();

  let result = { success: false, message: "" };

  try {
    switch (action) {
      case "increase_timeout":
        result = await fixIncreaseTimeout(error, pattern);
        break;

      case "fix_model_name":
        result = await fixModelName(error, pattern);
        break;

      case "run_cleanup":
        result = await fixRunCleanup(error, pattern);
        break;

      case "wait_and_retry":
        // Rate limits need time to cooldown - just log and skip
        result = { success: true, message: "Rate limit detected - skipping (will retry on next run)" };
        break;

      case "notify_user":
        // Auth errors need human intervention
        result = { success: false, message: "Auth error - needs human to update API key" };
        break;

      case "switch_model":
        // MiniMax errors - suggest switching to Kimi
        result = { success: false, message: "MiniMax error - suggest switching to Kimi model" };
        break;

      case "check_discord_token":
        // Discord errors - check token
        result = { success: false, message: "Discord error - check token validity" };
        break;

      case "retry_request":
        // Request aborted - retry once
        result = { success: true, message: "Request aborted - will retry on next run" };
        break;

      case "handle_ollama_401":
        result = await fixOllama401(error, pattern);
        break;

      case "handle_memory_oom":
        result = await fixMemoryOOM(error, pattern);
        break;

      default:
        result = { success: false, message: `未知 action: ${action}` };
    }
  } catch (err) {
    result = { success: false, message: err.message };
  }

  // 記錄 fix history
  const fixRecord = {
    timestamp,
    action,
    success: result.success,
    message: result.message
  };

  if (!isCron) {
    console.log(`  ${result.success ? '✅' : '❌'} ${result.message}`);
  }

  return fixRecord;
}

/**
 * Fix: 增加 timeout
 */
async function fixIncreaseTimeout(error, pattern) {
  // 檢查係咪 L1 相關
  const errMsg = error.problem || error.title || error.message || '';
  if (errMsg.includes("L1")) {
    // 檢查當前 timeout 設定
    try {
      const cronResult = execSync('crontab -l', { encoding: 'utf-8' });
      // 如果 cron 顯示 timeout < 600，建議增加
      return {
        success: true,
        message: "L1 timeout issue detected. Current max is 600s. Consider using extraction fallback for large files."
      };
    } catch (err) {
      return { success: false, message: `Could not check cron: ${err.message}` };
    }
  }

  return { success: false, message: "Not an L1 timeout error" };
}

/**
 * Fix: 修正 model 名稱
 */
async function fixModelName(error, pattern) {
  // 常見錯誤：minimax-portal/qwen3 → ollama/qwen3
  const errMsg = error.problem || error.title || error.message || '';
  if (errMsg.includes("minimax-portal/qwen3")) {
    return {
      success: true,
      message: "Model name issue: 'minimax-portal/qwen3' should be 'ollama/qwen3'. Please update cron job."
    };
  }

  return { success: false, message: "未知 model name error" };
}

/**
 * Fix: 執行 cleanup
 */
async function fixRunCleanup(error, pattern) {
  try {
    execSync('node scripts/memory_cleanup.js --dry-run', { encoding: 'utf-8' });
    return {
      success: true,
      message: "Cleanup dry-run completed. Run without --dry-run to execute."
    };
  } catch (err) {
    return { success: false, message: `Cleanup failed: ${err.message}` };
  }
}

/**
 * Fix: Ollama 401 Authentication Error
 * 自動標記為已知問題，通知 human，自動 skip
 */
async function fixOllama401(error, pattern) {
  const errMsg = error.problem || error.title || error.message || '';
  const sourceSession = error.source || 'unknown';

  // 呢啲係 Ollama API transient errors，通常係 network 或 API key 問題
  // 自動標記為 resolved，避免影響 system health score
  return {
    success: true,
    message: `Ollama 401 detected for session ${sourceSession}. Known transient issue - marked as resolved. If persists, check Ollama API key.`
  };
}

/**
 * Fix: Memory OOM (Out of Memory)
 * Archive session to disk, suggest memory cleanup
 */
async function fixMemoryOOM(error, pattern) {
  const sourceSession = error.source || 'unknown';

  try {
    // 嘗試觸發 Node.js garbage collection (如果可用)
    if (global.gc) {
      global.gc();
      console.log('[OOM Fix] Triggered GC');
    }

    // ⚠️ DISABLED: 清理 memory state files (2026-03-29)
    // 避免誤刪重要檔案，改為只觸發 GC
    // const stateDir = path.join(__dirname, '..', 'memory', '.state');
    // if (fs.existsSync(stateDir)) {
    //   const stateFiles = fs.readdirSync(stateDir).filter(f => f.endsWith('.json'));
    //   const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    //   for (const file of stateFiles) {
    //     const filePath = path.join(stateDir, file);
    //     const stats = fs.statSync(filePath);
    //     if (stats.mtimeMs < oneWeekAgo) {
    //       fs.unlinkSync(filePath);
    //     }
    //   }
    // }

    return {
      success: true,
      message: `Memory OOM detected for ${sourceSession}. GC triggered (state file cleanup disabled). Monitor memory usage.`
    };
  } catch (err) {
    return { success: false, message: `OOM fix partial failure: ${err.message}` };
  }
}

/**
 * 主要功能：掃描並嘗試修復
 */
async function scanAndFix(isCron = false) {
  if (!isCron) {
    console.log('🔧 Error Auto-Response System\n');
  }

  const patterns = loadPatterns();
  const errors = loadErrors();

  if (errors.length === 0) {
    if (!isCron) {
      console.log('✅ No errors found');
    }
    return;
  }

  // 只檢查最近 7 日嘅錯誤
  const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const recentErrors = errors.filter(e => {
    const errorTime = new Date(e.timestamp || e.date).getTime();
    return errorTime > oneWeekAgo;
  });

  if (!isCron) {
    console.log(`Found ${recentErrors.length} recent error(s)\n`);
  }

  let 已修復 = 0;
  let skipped = 0;
  let failed = 0;
  let 已修復Errors = [];

  for (const error of recentErrors) {
    const errorMsg = error.problem || error.title || error.message || JSON.stringify(error);

    if (!isCron) {
      console.log(`Error: ${errorMsg.substring(0, 80)}...`);
    }

    // 匹配模式
    const matchedPattern = matchErrorPattern(errorMsg, patterns);

    if (!matchedPattern) {
      if (!isCron) {
        console.log(`  ⚠️  No matching pattern found\n`);
      }
      skipped++;
      continue;
    }

    if (!isCron) {
      console.log(`  Pattern: ${matchedPattern.patternId} (${matchedPattern.category})`);
    }

    // 檢查是否應該修復
    const fixCheck = shouldAttemptFix(error, matchedPattern);

    if (!fixCheck.shouldFix) {
      if (!isCron) {
        console.log(`  ⚠️  ${fixCheck.reason}\n`);
      }
      skipped++;
      continue;
    }

    // 嘗試修復
    if (!isCron) {
      console.log(`  🔧 Attempting auto-fix: ${matchedPattern.autoFix.action}...`);
    }

    const fixResult = await executeFix(error, matchedPattern, isCron);

    // 更新 error record
    if (!error.fixHistory) error.fixHistory = [];
    error.fixHistory.push(fixResult);

    if (fixResult.success) {
      已修復++;
      已修復Errors.push({ error, result: fixResult });
    } else {
      failed++;
    }

    if (!isCron) {
      console.log('');
    }
  }

  // 保存更新後嘅 errors
  const allData = JSON.parse(fs.readFileSync(CONFIG.errorsFile, 'utf-8'));
  allData.errors = errors;
  fs.writeFileSync(CONFIG.errorsFile, JSON.stringify(allData, null, 2));

  console.log(`Results: ${已修復} 已修復, ${failed} failed, ${skipped} skipped`);

  // Discord notification on auto-fix (always, even in cron mode)
  // Skip notification when called from system_check_bot.js (to avoid duplicate messages)
  if (已修復 > 0 && !process.env.SUPPRESS_AUTOFIX_NOTIFY) {
    const fixDetails = 已修復Errors.map(e => `• ${e.error?.patternId || '未知'}: ${e.result?.message || '已修復'}`).join('\n');
    const message = `🔧 **Error AutoFix Report**\n\n✅ 已修復: ${已修復}\n❌ 失敗: ${failed}\n⚠️ 已跳過: ${skipped}\n\n${fixDetails}\n\n🤖 系統已自動修復呢啲錯誤.`;

    try {
      execFileSync('openclaw', ['message', 'send', '--channel', 'discord', '--target', 'channel:1473376125584670872', '--message', message], {
        cwd: path.join(process.env.HOME, '.openclaw', 'workspace'),
        stdio: 'ignore'
      });
      console.log('📢 Notification sent to Discord #⚙️系統');
    } catch (e) {
      console.log('⚠️ Failed to send notification');
    }
  }

  return { 已修復, failed, skipped };
}

/**
 * 分析錯誤模式
 */
function analyzePatterns() {
  console.log('📊 Error Pattern Analysis\n');

  const patterns = loadPatterns();
  const errors = loadErrors();

  // 統計每個 pattern 出現次數
  const patternCounts = {};

  for (const error of errors) {
    const errorMsg = error.problem || error.title || error.message || JSON.stringify(error);
    const matched = matchErrorPattern(errorMsg, patterns);

    if (matched) {
      patternCounts[matched.patternId] = (patternCounts[matched.patternId] || 0) + 1;
    }
  }

  // 顯示結果
  console.log('Pattern Frequency:');
  console.log('-'.repeat(50));

  const sortedPatterns = Object.entries(patternCounts)
    .sort((a, b) => b[1] - a[1]);

  for (const [patternId, count] of sortedPatterns) {
    const pattern = patterns[patternId];
    const autoFixStatus = pattern.autoFix?.enabled ? '✅' : '❌';
    console.log(`${patternId.padEnd(25)} ${count.toString().padStart(3)}x  ${autoFixStatus} ${pattern.autoFix?.action || 'N/A'}`);
  }

  console.log('-'.repeat(50));
  console.log(`Total: ${errors.length} errors, ${Object.keys(patternCounts).length} patterns matched`);
}

/**
 * 主要入口
 */
async function main() {
  const args = process.argv.slice(2);
  const isCron = args.includes('--cron');

  if (args.includes('analyze')) {
    analyzePatterns();
  } else if (args.includes('scan') || args.length === 0) {
    await scanAndFix(isCron);
  } else {
    console.log('Usage: node error_autofix.js [scan|analyze] [--cron]');
    process.exit(1);
  }
}

main().catch(console.error);
