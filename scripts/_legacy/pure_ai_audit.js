#!/usr/bin/env node
/**
 * Pure AI Code Audit - 列出檔案 + 生成 AI 分析 payload
 *
 * 流程：
 * 1. 列出所有 JS 檔案
 * 2. 生成 payload 檔案 (俾 AI sub-agent 分析用)
 * 3. 生成 spawn 指令
 *
 * 注意：呢個 script 只係準備工作，真正分析靠 AI sub-agent
 *
 * 使用方法:
 *   node scripts/pure_ai_audit.js              # 列出檔案 + 生成 payload + 顯示 spawn 指令
 *   node scripts/pure_ai_audit.js --spawn      # 列出檔案 + 生成 payload + 標記等待 spawn
 *   node scripts/pure_ai_audit.js report       # 顯示上次審計結果
 *
 * 與 auto_fix.js 嘅分工：
 *   - pure_ai_audit.js: 生成 payload，俾 Kimi sub-agent 分析
 *   - auto_fix.js: 本地 Scanner + MiniMax 生成 brief
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWriteSync } = require('./lib/config');

// ============ GLOBAL STATE ============
let _quiet = false;

// ============ CONFIG ============
const CONFIG = {
  // Script paths
  scriptsDir: __dirname,
  excludeDirs: ['node_modules', '.git', 'dist', 'build', '.openclaw', '.state', 'archive'],
  excludeFiles: ['pure_ai_audit.js', 'pure_ai_audit_v2.js', 'auto_fix.js'],
  extensions: ['.js'],

  // Severity mapping for specific issue types
  // This provides context-aware severity ratings
  SEVERITY_MAP: {
    // execSync_missing_trycatch - context-sensitive severity
    // Critical data writes → High (potential data loss/corruption)
    // General file operations → Medium
    // Non-critical operations (logging, cleanup) → Low
    execSync_missing_trycatch: {
      critical: ['errors.json', 'state', 'config', 'cache'],
      high: ['writeFileSync', 'writeFile', 'createWriteStream'],
      medium: ['readFileSync', 'readFile', 'readdirSync', 'existsSync'],
      low: ['appendFileSync', 'log', 'console'],
    },
    // magic_numbers - just style issue, auto-fixable → Low (P3)
    magic_numbers: {
      low: ['default'],
    },
    // logic_error - depends on impact scope
    logic_error: {
      medium: ['calculation', 'condition', 'validation'],
      low: ['default', 'formatting'],
    },
  },


  // File output paths
  outputFile: '.state/pure_ai_audit_payload.json',
  resultFile: '.state/pure_ai_audit_results.json',
  spawnPayloadFile: '.state/pure_ai_audit_spawn.json',
  cacheFile: '.state/pure_ai_audit_cache.json',

  // Pending spawn paths
  PENDING_SPAWNS_DIR: '.state/pending_spawns',
  pendingSpawnFile: '.state/pending_spawns/pure_audit.json',

  // File scan limits (magic numbers → named constants)
  MAX_FILE_SIZE_BYTES: 100 * 1024, // 100KB max file size for audit
  PROGRESS_LOG_INTERVAL: 10,       // Log progress every N files
  SCAN_MAX_DEPTH: 20,              // Max directory recursion depth
  useHashCheck: true,               // Enable file hash check for cache accuracy
};

// ============ UTILITY: 安全 JSON 解析 ============
function safeJsonParse(jsonString, defaultValue = null) {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    if (!_quiet) console.error(`   ⚠️  JSON 解析失敗: ${error.message}`);
    return defaultValue;
  }
}

// ============ UTILITY: 安全讀取檔案 ============
function safeReadFile(filePath, encoding = 'utf8', defaultValue = null) {
  try {
    return fs.readFileSync(filePath, encoding);
  } catch (error) {
    if (!_quiet) console.error(`   ⚠️  讀取檔案失敗 ${filePath}: ${error.message}`);
    return defaultValue;
  }
}

// ============ UTILITY: 安全寫入檔案 ============
function safeWriteFile(filePath, content, options = 'utf8') {
  try {
    atomicWriteSync(filePath, content, options);
    return true;
  } catch (error) {
    if (!_quiet) console.error(`   ⚠️  寫入檔案失敗 ${filePath}: ${error.message}`);
    return false;
  }
}

// ============ UTILITY: 計算檔案 Hash ============
function getFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (error) {
    return null;
  }
}

// ============ UTILITY: 檔案狀態緩存 ============
function loadFileCache() {
  const cachePath = path.join(CONFIG.scriptsDir, '..', CONFIG.cacheFile);
  let exists = false;
  try {
    exists = fs.existsSync(cachePath);
  } catch (e) {
    console.error('Error: ' + e.message);
    return {};
  }
  if (!exists) {
    return {};
  }
  const content = safeReadFile(cachePath, 'utf8', '{}');
  return safeJsonParse(content, {});
}

function saveFileCache(cache) {
  const cacheDir = path.dirname(CONFIG.cacheFile);
  const fullCacheDir = path.join(CONFIG.scriptsDir, '..', cacheDir);
  let exists = false;
  try {
    exists = fs.existsSync(fullCacheDir);
  } catch (e) {
    console.error('Error: ' + e.message);
    exists = false;
  }
  if (!exists) {
    try {
      fs.mkdirSync(fullCacheDir, { recursive: true });
    } catch (error) {
      if (!_quiet) console.error(`   ⚠️  創建緩存目錄失敗: ${error.message}`);
      return false;
    }
  }
  const cachePath = path.join(CONFIG.scriptsDir, '..', CONFIG.cacheFile);
  return safeWriteFile(cachePath, JSON.stringify(cache, null, 2), 'utf8');
}

function hasFileChanged(filePath, stats, cache) {
  const relativePath = path.relative(CONFIG.scriptsDir, filePath);
  const cached = cache[relativePath];

  if (!cached) {
    return { changed: true, isNew: true };
  }

  // 檢查修改時間和大小
  if (cached.mtime !== stats.mtime.getTime() || cached.size !== stats.size) {
    return { changed: true, isNew: false };
  }

  // 額外檢查 hash（可選，更準確但較慢）
  if (CONFIG.useHashCheck) {
    const currentHash = getFileHash(filePath);
    if (currentHash && currentHash !== cached.hash) {
      return { changed: true, isNew: false };
    }
  }

  return { changed: false, isNew: false };
}

function updateFileCache(filePath, stats, cache) {
  const relativePath = path.relative(CONFIG.scriptsDir, filePath);
  cache[relativePath] = {
    mtime: stats.mtime.getTime(),
    size: stats.size,
    hash: getFileHash(filePath),
    lastAudited: new Date().toISOString()
  };
}

// ============ COMMAND: report mode ============
function reportMode() {
  const payloadPath = path.join(CONFIG.scriptsDir, '..', CONFIG.outputFile);
  const resultPath = path.join(CONFIG.scriptsDir, '..', CONFIG.resultFile);

  if (!_quiet) console.log('\n📊 Pure AI Audit Report\n');
  if (!_quiet) console.log('═'.repeat(50) + '\n');

  // 讀取上次 payload
  let payloadExists = false;
  try {
    payloadExists = fs.existsSync(payloadPath);
  } catch (e) {
    console.error('Error: ' + e.message);
    payloadExists = false;
  }
  if (payloadExists) {
    const payload = safeJsonParse(safeReadFile(payloadPath, 'utf8', '{}'), {});
    if (payload && payload.timestamp) {
      if (!_quiet) console.log('📅 上次審計時間：' + new Date(payload.timestamp).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }));
      if (!_quiet) console.log('📂 檔案據量：' + (payload.files ? payload.files.length : 0) + ' 個');
      if (!_quiet) console.log('💾 Payload：' + payloadPath + '\n');
    } else {
      if (!_quiet) console.log('⚠️  Payload 檔案格式無效\n');
    }
  } else {
    if (!_quiet) console.log('⚠️  未找到上次 payload 檔案\n');
  }

  // 讀取上次結果
  let resultExists = false;
  try {
    resultExists = fs.existsSync(resultPath);
  } catch (e) {
    console.error('Error: ' + e.message);
    resultExists = false;
  }
  if (resultExists) {
    const results = safeJsonParse(safeReadFile(resultPath, 'utf8', '{}'), {});
    if (results) {
      if (!_quiet) console.log('📊 審計結果：');
      if (!_quiet) console.log('   🔴 Critical: ' + (results.critical || 0));
      if (!_quiet) console.log('   🟠 High: ' + (results.high || 0));
      if (!_quiet) console.log('   🟡 Medium: ' + (results.medium || 0));
      if (!_quiet) console.log('   ⚪ Low: ' + (results.low || 0));

      if (results.issues && results.issues.length > 0) {
        if (!_quiet) console.log('\n📋 發現嘅問題：');
        results.issues.slice(0, 10).forEach((issue, i) => {
          if (!_quiet) console.log(`   ${i + 1}. [${issue.severity || '⚪'}] ${issue.file || 'Unknown'} - ${issue.title || 'N/A'}`);
        });
        if (results.issues.length > 10) {
          if (!_quiet) console.log(`   ... 仲有 ${results.issues.length - 10} 個問題`);
        }
      }
    } else {
      if (!_quiet) console.log('📊 審計結果：無法讀取結果檔案');
    }
  } else {
    if (!_quiet) console.log('📊 審計結果：未運行過審計（未有 results 檔案）');
  }

  if (!_quiet) console.log('\n' + '═'.repeat(50) + '\n');
}

// ============ STEP 1: 列出檔案（淨係列出，唔分析）============
function getJSFiles(dir, files = [], options = {}) {
  const { showProgress = false, useCache = true, maxDepth = CONFIG.SCAN_MAX_DEPTH, currentDepth = 0 } = options;

  if (currentDepth > maxDepth) {
    if (!_quiet) console.error(`   ⚠️  目錄深度超過限制: ${dir}`);
    return files;
  }

  let exists = false;
  try {
    exists = fs.existsSync(dir);
  } catch (e) {
    console.error('Error: ' + e.message);
    return files;
  }
  if (!exists) return files;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (!_quiet) console.error(`   ⚠️  無法讀取目錄 ${dir}: ${error.message}`);
    return files;
  }

  // 載入緩存
  const cache = useCache ? loadFileCache() : {};
  let newFiles = 0;
  let modifiedFiles = 0;
  let skippedFiles = 0;
  let oversizedFiles = 0;

  const totalEntries = entries.length;
  let processedCount = 0;

  for (const entry of entries) {
    processedCount++;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // 跳過排除既目錄
      if (CONFIG.excludeDirs.includes(entry.name)) continue;
      // 遞迴
      getJSFiles(fullPath, files, { showProgress: false, useCache, maxDepth, currentDepth: currentDepth + 1 });
    } else if (entry.isFile()) {
      // 只揀 JS 檔案
      const ext = path.extname(entry.name).toLowerCase();
      if (CONFIG.extensions.includes(ext) && !CONFIG.excludeFiles.includes(entry.name)) {
        // 檢查檔案大小
        let stats;
        try {
          stats = fs.statSync(fullPath);
        } catch (error) {
          if (!_quiet) console.error(`   ⚠️  無法獲取檔案資訊 ${fullPath}: ${error.message}`);
          continue;
        }

        if (stats.size > CONFIG.MAX_FILE_SIZE_BYTES) {
          oversizedFiles++;
          const relativePath = path.relative(CONFIG.scriptsDir, fullPath);
          if (!_quiet) console.log(`   ⏭️  跳過（檔案過大 ${(stats.size / 1024).toFixed(1)}KB > ${CONFIG.MAX_FILE_SIZE_BYTES / 1024}KB）: ${relativePath}`);
          continue;
        }

        // 檢查檔案是否變更
        const changeStatus = hasFileChanged(fullPath, stats, cache);
        if (changeStatus.changed) {
          if (changeStatus.isNew) {
            newFiles++;
          } else {
            modifiedFiles++;
          }
          updateFileCache(fullPath, stats, cache);
        } else {
          skippedFiles++;
        }

        // 轉為相對路徑
        const relativePath = path.relative(CONFIG.scriptsDir, fullPath);
        files.push({
          path: fullPath,
          relative: relativePath,
          name: entry.name,
          size: stats.size,
          mtime: stats.mtime,
          isNew: changeStatus.isNew,
          changed: changeStatus.changed
        });
      }
    }

    // 顯示進度
    if (showProgress && processedCount % CONFIG.PROGRESS_LOG_INTERVAL === 0) {
      const progress = Math.round((processedCount / totalEntries) * 100);
      if (!_quiet) console.log(`   📊 掃描進度: ${processedCount}/${totalEntries} (${progress}%) - 已找到 ${files.length} 個檔案`);
    }
  }

  // 保存緩存
  if (useCache && (newFiles > 0 || modifiedFiles > 0)) {
    saveFileCache(cache);
  }

  // 顯示掃描摘要
  if (showProgress) {
    if (!_quiet) console.log(`   📈 掃描摘要: +${newFiles} 新檔案, ~${modifiedFiles} 已修改, =${skippedFiles} 未變更, ⚠️${oversizedFiles} 過大跳過`);
  }

  return files;
}

// ============ STEP 2: 生成 AI Prompt ============
function generateAuditPrompt(files) {
  const fileList = files.map(f => `  - ${f.relative}`).join('\n');
  const fileCount = files.length;

  return `你係代碼審計專家。請審計以下 ${fileCount} 個 JavaScript 檔案：

## ⚠️ 重要：必須跳過的目錄
以下目錄中的檔案請勿分析（它們是歸檔文件或測試代碼）：
- archive/ 目錄：已歸檔的舊腳本，無需審計
- __tests__/ 目錄：測試代碼
- lib/rules/、lib/analyzers/、lib/helpers/：規則定義文件

## 檔案清單
${fileList}

## 審計重點

### 1. 安全性 🔐
- 動態程式碼執行 (eval / Function / setTimeout with code string)
- hardcoded secrets、API keys、passwords
- SQL injection、Command injection、Path traversal
- 不安全既 crypto 使用

### 2. 錯誤處理 🛡️
- try-catch 缺失或太闊
- Promise rejection 無處理
- async/await 無 try-catch
- callback error 無處理

### 3. 邏輯錯誤 🧠
- return 語句錯誤
- 邊界情況未處理
- 變量作用域問題
- 邏輯運算子錯誤（&& vs ||）

### 4. 效能 ⚡
- 同步操作喺 async context
- blocking I/O
- 無限迴圈
- 記憶體洩漏

### 5. 型別安全 📝
- undefined / null 未檢查
- 類型強制轉換問題
- NaN 處理

### 6. 登出 🚪
- credentials 無正確清除
- session 無正確終止

## 輸出格式

請為每個發現既問題提供：

\`\`\`
### 🔴/🟠/🟡/⚪ [檔案名稱]
**位置：** [行號]
**問題：** [描述]
**風險：** [Critical/High/Medium/Low]
**建議：** [修復方案]
\`\`\`

## 分級標準（上下文感知）

### 通用分級
- 🔴 **Critical**：立即修復（crash/security/data loss）
- 🟠 **High**：盡快修復（logic error/reliability）
- 🟡 **Medium**：建議修復（architecture/code quality）
- ⚪ **Low**：可自動修復（formatting/style）

### execSync_missing_trycatch 特殊規則
根據操作類型調整評級：

| 操作類型 | 評級 | 原因 |
|----------|------|------|
| 寫入 errors.json / state / config / cache | 🟠 High | 據據丟失/損壞風險 |
| 寫入一般檔案 (writeFileSync) | 🟡 Medium | 可靠性問題 |
| 讀取檔案 (readFileSync/readdirSync) | ⚪ Low | 影響有限 |
| 非關鍵操作 (logging/cleanup) | ⚪ Low | 影響可忽略 |

### 重要說明：require() 語句不是問題！

請勿將 require('child_process') 標記為問題！這只是 import，不是實際調用。只有 execSync() 或 exec() 的實際調用才需要檢查 try-catch。同樣，require('fs'), require('path') 等標準 import 都不是問題。

### 重要說明：註釋中的關鍵字不是問題！

請跳過註釋中的關鍵字！例如 "TODO: 使用 execSync 實現" 只是註釋，不是實際代碼。只檢查實際的代碼行，不要將註釋中的關鍵字當作問題。

### magic_numbers 特殊規則
- **評級：⚪ Low (P3)**
- **原因：** 純粹 coding style 問題，可由 auto_fix 自動修復
- **修復方式：** 提升為 CONFIG 常量

### logic_error 特殊規則
根據影響範圍調整評級：

| 影響類型 | 評級 |
|----------|------|
| 計算邏輯錯誤 (calculation) | 🟡 Medium |
| 條件判斷錯誤 (condition) | 🟡 Medium |
| 其他邏輯問題 | ⚪ Low |

## 要求

1. **直接讀取每個檔案**進行分析
2. **唔好假設**，所有問題都必須睇到實際代碼先提出
3. **提供具體修復方案**，唔係只指出問題
4. **分優先次序**，Critical 放最前
5. **如果冇問題**，明確標示「此檔案無發現問題」

請開始審計。`;
}

// ============ STEP 3: 寫入 Payload ============
function writePayload(files, prompt) {
  // 確保目錄存在
  const outputDir = path.dirname(CONFIG.outputFile);
  const fullOutputDir = path.join(CONFIG.scriptsDir, '..', outputDir);

  let exists = false;
  try {
    exists = fs.existsSync(fullOutputDir);
  } catch (e) {
    console.error('Error: ' + e.message);
    exists = false;
  }
  if (!exists) {
    try {
      fs.mkdirSync(fullOutputDir, { recursive: true });
    } catch (error) {
      if (!_quiet) console.error(`   ⚠️  創建輸出目錄失敗: ${error.message}`);
      return null;
    }
  }

  const payload = {
    version: '2.0',
    timestamp: new Date().toISOString(),
    config: {
      totalFiles: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      scriptsDir: CONFIG.scriptsDir,
      maxFileSize: CONFIG.MAX_FILE_SIZE_BYTES,
      newFiles: files.filter(f => f.isNew).length,
      modifiedFiles: files.filter(f => f.changed && !f.isNew).length
    },
    files: files.map(f => ({
      path: f.relative,
      size: f.size,
      isNew: f.isNew,
      changed: f.changed
    })),
    prompt: prompt,
    auditFocus: [
      '安全性 (eval, secrets, injection)',
      '錯誤處理 (try-catch, Promise rejection)',
      '邏輯錯誤 (return, edge cases)',
      '效能 (sync in async, blocking)',
      '型別安全 (undefined, NaN)',
      '登出 (credentials, session)'
    ]
  };

  const outputPath = path.join(CONFIG.scriptsDir, '..', CONFIG.outputFile);
  const success = safeWriteFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  return success ? CONFIG.outputFile : null;
}

// ============ STEP 4: 生成 Spawn 指令 ============
function printSpawnInstructions(payload) {
  const outputPath = path.resolve(CONFIG.outputFile);

  if (!_quiet) console.log('\n' + '═'.repeat(60));
  if (!_quiet) console.log('🚀 AI Sub-Agent Spawn 指令');
  if (!_quiet) console.log('═'.repeat(60) + '\n');

  if (!_quiet) console.log('📋 Payload 檔案已生成：');
  if (!_quiet) console.log(`   ${outputPath}\n`);

  if (!_quiet) console.log('📂 審計檔案據量：', payload.files.length, '個\n');

  if (!_quiet) console.log('💡 使用以下指令 spawn AI sub-agent：\n');

  // 方案 1：OpenClaw spawn
  if (!_quiet) console.log('```');
  if (!_quiet) console.log('# OpenClaw spawn 指令（60分鐘 timeout）');
  if (!_quiet) console.log('# 分析使用 minimax-portal/MiniMax-M2.7，修復使用 Kimi Code CLI');
  if (!_quiet) console.log('spawn subagent \\');
  if (!_quiet) console.log('  --model "minimax-portal/MiniMax-M2.7" \\');
  if (!_quiet) console.log('  --timeout 3600 \\');
  if (!_quiet) console.log('  --context "Read the payload at: ' + outputPath + '"');
  if (!_quiet) console.log('```\n');

  // 方案 2：詳細嘅 prompt
  if (!_quiet) console.log('或者喺 OpenClaw 直接輸入：\n');
  if (!_quiet) console.log('```');
  if (!_quiet) console.log('請讀取 ' + outputPath);
  if (!_quiet) console.log('併根據 payload 中既 prompt 進行代碼審計');
  if (!_quiet) console.log('```\n');

  if (!_quiet) console.log('═'.repeat(60) + '\n');
}

// ============ SPAWN MODE: 寫入 payload + pending spawn marker ============
function runSpawnMode() {
  if (!_quiet) console.log('🎯 Pure AI Code Audit - Spawn Mode\n');
  if (!_quiet) console.log('⏱️  開始時間：', new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }));
  if (!_quiet) console.log('');

  // STEP 1: 列出所有 JS 檔案
  if (!_quiet) console.log('📂 STEP 1: 掃描 JS 檔案...');
  if (!_quiet) console.log(`   📏 檔案大小限制: ${CONFIG.MAX_FILE_SIZE_BYTES / 1024}KB`);
  const files = getJSFiles(CONFIG.scriptsDir, [], { showProgress: true, useCache: true });

  if (!_quiet) console.log(`   ✅ 已找到 ${files.length} 個 JS 檔案（符合大小限制）\n`);

  if (files.length === 0) {
    if (!_quiet) console.log('⚠️  冇發現任何符合條件嘅 JS 檔案！\n');
    throw new Error('No JS files found');
  }

  // STEP 2: 生成 AI Prompt
  if (!_quiet) console.log('✍️  STEP 2: 生成審計 Prompt...');
  const prompt = generateAuditPrompt(files);
  if (!_quiet) console.log(`   Prompt 長度：${prompt.length} 字元\n`);

  // STEP 3: 寫入 Payload
  if (!_quiet) console.log('💾 STEP 3: 寫入 Payload...');
  const workspaceDir = path.join(CONFIG.scriptsDir, '..');
  const outputFile = path.join(workspaceDir, CONFIG.outputFile);
  const outputResult = writePayload(files, prompt);
  if (!outputResult) {
    if (!_quiet) console.error('   ❌ 寫入 Payload 失敗！\n');
    process.exit(1);
  }
  if (!_quiet) console.log(`   ✅ 已寫入：${outputFile}\n`);

  // STEP 4: 生成 Spawn Payload
  if (!_quiet) console.log('📋 STEP 4: 生成 Spawn Payload...');
  const spawnPayload = {
    type: 'pure_ai_audit',
    model: 'minimax-portal/MiniMax-M2.7',
    label: 'pure-audit',
    prompt: `你係代碼審計專家，負責審計 OpenClaw workspace 嘅 JavaScript 檔案。

## 你的任務

請根據以下 prompt 進行代碼審計：

${prompt}

## 額外指示

1. **讀取每個檔案**進行深度分析
2. **審計重點**：安全性、錯誤處理、邏輯錯誤、效能、型別安全、登出
3. **輸出格式**：每個問題包含 severity、file、line、title、description、fix
4. **寫入結果**：完成後將結果寫入以下檔案（使用 write tool）：
   路徑：${workspaceDir}/${CONFIG.resultFile}

   結果格式：
   {
     "timestamp": "ISO時間",
     "filesAudited": [檔案列表],
     "summary": { "critical": N, "high": N, "medium": N, "low": N },
     "issues": [問題陣列]
   }

請開始審計。`,
    channel: 'discord',
    target: process.env.DISCORD_PROGRAMMING_CHANNEL || '1473384999003619500',
    _meta: {
      generatedAt: new Date().toISOString(),
      totalFiles: files.length,
      files: files.map(f => f.relative)
    }
  };

  // 確保目錄存在
  const pendingDir = path.join(workspaceDir, CONFIG.PENDING_SPAWNS_DIR);
  let exists = false;
  try {
    exists = fs.existsSync(pendingDir);
  } catch (e) {
    console.error('Error: ' + e.message);
    exists = false;
  }
  if (!exists) {
    try {
      fs.mkdirSync(pendingDir, { recursive: true });
    } catch (error) {
      if (!_quiet) console.error(`   ⚠️  創建 pending 目錄失敗: ${error.message}`);
      throw new Error(`Failed to create pending directory: ${error.message}`);
    }
  }

  // 寫入 spawn payload
  const spawnPayloadPath = path.join(workspaceDir, CONFIG.spawnPayloadFile);
  if (!safeWriteFile(spawnPayloadPath, JSON.stringify(spawnPayload, null, 2), 'utf8')) {
    if (!_quiet) console.error('   ❌ 寫入 Spawn Payload 失敗！\n');
    throw new Error('Failed to write spawn payload');
  }
  if (!_quiet) console.log(`   ✅ Spawn Payload 已寫入：${spawnPayloadPath}\n`);

  // 寫入 pending spawn marker
  const pendingMarker = {
    type: 'pure_ai_audit',
    spawnFile: CONFIG.spawnPayloadFile,
    payloadFile: CONFIG.outputFile,
    resultFile: CONFIG.resultFile,
    createdAt: new Date().toISOString(),
    status: 'pending'
  };
  const pendingPath = path.join(workspaceDir, CONFIG.pendingSpawnFile);
  if (!safeWriteFile(pendingPath, JSON.stringify(pendingMarker, null, 2), 'utf8')) {
    if (!_quiet) console.error('   ❌ 寫入 Pending Marker 失敗！\n');
    throw new Error('Failed to write pending marker');
  }
  if (!_quiet) console.log(`   ✅ Pending Marker 已寫入：${pendingPath}\n`);

  // 輸出 SPAWN_READY 標記（供 main agent 檢測）
  console.log('PURE_AUDIT_SPAWN_READY');
  console.log(JSON.stringify({
    type: 'pure_ai_audit',
    spawnFile: spawnPayloadPath,
    payloadFile: outputFile,
    resultFile: path.join(workspaceDir, CONFIG.resultFile),
    filesCount: files.length
  }));
  console.log('PURE_AUDIT_SPAWN_END');
  if (!_quiet) console.log('');

  if (!_quiet) console.log('✅ Pure AI Audit Spawn Mode 完成');
  if (!_quiet) console.log(`📂 檔案據量：${files.length} 個`);
  if (!_quiet) console.log(`📄 Spawn Payload：${spawnPayloadPath}`);
  if (!_quiet) console.log(`📄 Pending Marker：${pendingPath}`);
  if (!_quiet) console.log('');
  if (!_quiet) console.log('⏱️  完成時間：', new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }));
  if (!_quiet) console.log('');
}

// ============ MAIN ============
function main() {
  const args = process.argv.slice(2);
  _quiet = args.includes('--quiet');

  // 檢查是否為 report mode
  const command = args.find(a => !a.startsWith('-')) || 'default';
  const isSpawnMode = args.includes('--spawn');

  if (command === 'report') {
    reportMode();
    return;
  }

  // Spawn mode
  if (isSpawnMode) {
    runSpawnMode();
    return;
  }

  // Default mode: 列出檔案 + 生成 payload + 顯示 spawn 指令
  if (!_quiet) console.log('🎯 Pure AI Code Audit - 完全自動化版本\n');
  if (!_quiet) console.log('⏱️  開始時間：', new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }));
  if (!_quiet) console.log('');
  if (!_quiet) console.log('💡 使用 --spawn 自動生成併標記等待 spawn：');
  if (!_quiet) console.log('   node scripts/pure_ai_audit.js --spawn\n');

  // STEP 1: 列出所有 JS 檔案
  if (!_quiet) console.log('📂 STEP 1: 掃描 JS 檔案...');
  if (!_quiet) console.log(`   📏 檔案大小限制: ${CONFIG.MAX_FILE_SIZE_BYTES / 1024}KB`);
  const files = getJSFiles(CONFIG.scriptsDir, [], { showProgress: true, useCache: true });

  if (!_quiet) console.log(`   ✅ 已找到 ${files.length} 個 JS 檔案（符合大小限制）\n`);

  if (files.length === 0) {
    if (!_quiet) console.log('⚠️  冇發現任何符合條件嘅 JS 檔案！\n');
    process.exit(1);
  }

  // 列出檔案（可選，顯示前10個）
  const newFiles = files.filter(f => f.isNew);
  const modifiedFiles = files.filter(f => f.changed && !f.isNew);

  if (files.length <= 10) {
    files.forEach(f => {
      const marker = f.isNew ? '🆕' : (f.changed ? '📝' : '=');
      if (!_quiet) console.log(`   ${marker} ${f.relative}`);
    });
  } else {
    files.slice(0, 10).forEach(f => {
      const marker = f.isNew ? '🆕' : (f.changed ? '📝' : '=');
      if (!_quiet) console.log(`   ${marker} ${f.relative}`);
    });
    if (!_quiet) console.log(`   ... 仲有 ${files.length - 10} 個檔案`);
  }

  if (newFiles.length > 0 || modifiedFiles.length > 0) {
    if (!_quiet) console.log(`\n   📊 變更摘要: 🆕 ${newFiles.length} 新檔案, 📝 ${modifiedFiles.length} 已修改`);
  }
  if (!_quiet) console.log('');

  // STEP 2: 生成 AI Prompt
  if (!_quiet) console.log('✍️  STEP 2: 生成審計 Prompt...');
  const prompt = generateAuditPrompt(files);
  if (!_quiet) console.log(`   Prompt 長度：${prompt.length} 字元\n`);

  // STEP 3: 寫入 Payload
  if (!_quiet) console.log('💾 STEP 3: 寫入 Payload...');
  const outputFile = writePayload(files, prompt);
  if (!outputFile) {
    if (!_quiet) console.error('   ❌ 寫入 Payload 失敗！\n');
    throw new Error('Failed to write payload');
  }
  if (!_quiet) console.log(`   ✅ 已寫入：${outputFile}\n`);

  // STEP 4: 生成 Spawn 指令
  if (!_quiet) console.log('📋 STEP 4: 生成 Spawn 指令...\n');

  const payload = {
    version: '2.0',
    timestamp: new Date().toISOString(),
    config: {
      totalFiles: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      newFiles: newFiles.length,
      modifiedFiles: modifiedFiles.length
    },
    files: files.map(f => ({
      path: f.relative,
      size: f.size,
      isNew: f.isNew,
      changed: f.changed
    })),
    prompt: prompt
  };

  printSpawnInstructions(payload);

  // 完成 summary
  if (!_quiet) console.log('✅ Pure AI Audit Payload 已生成');
  if (!_quiet) console.log(`📂 檔案據量：${files.length} 個`);
  if (!_quiet) console.log(`📄 Payload：${outputFile}`);
  if (!_quiet) console.log('');

  // 嘗試讀取上次審計結果
  const resultFile = path.join(CONFIG.scriptsDir, '..', CONFIG.resultFile);
  let exists = false;
  try {
    exists = fs.existsSync(resultFile);
  } catch (e) {
    console.error('Error: ' + e.message);
    exists = false;
  }
  if (exists) {
    const resultContent = safeReadFile(resultFile, 'utf8', '{}');
    const results = safeJsonParse(resultContent, {});
    if (results) {
      if (!_quiet) console.log('\n📊 上次審計結果（如有）：');
      if (!_quiet) console.log('   🔴 Critical: ' + (results.critical || 0));
      if (!_quiet) console.log('   🟠 High: ' + (results.high || 0));
      if (!_quiet) console.log('   🟡 Medium: ' + (results.medium || 0));
      if (!_quiet) console.log('   ⚪ Low: ' + (results.low || 0));
    }
  }

  if (!_quiet) console.log('');
  if (!_quiet) console.log('⏱️  完成時間：', new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }));
  if (!_quiet) console.log('');
}

// 執行
try {
  main();
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
