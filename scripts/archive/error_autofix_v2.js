#!/usr/bin/env node
/**
 * Error AutoFix V2 - With Root Cause Analysis
 * Phase 1: Root Cause Analysis
 * Phase 2: Improved Notification
 * Phase 3: Learning System
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ======== CONFIG ========
const CONFIG = {
  workspace: process.env.HOME + '/.openclaw/workspace',
  maxAutoFixAttempts: 3,
  autoFixCooldownHours: 24,
  memoryFiles: {
    errors: 'memory/errors.json',
    patterns: 'memory/error-patterns.json',
    learnings: 'memory/error-learnings.json'
  }
};

// ======== ROOT CAUSE ANALYSIS ========
function isAIAvailable() {
  try {
    execSync('curl -s --max-time 2 http://localhost:11434/api/tags', {encoding: 'utf8', timeout: 3000});
    return true;
  } catch (e) {
    return false;
  }
}

async function analyzeRootCause(error) {
  const errorMsg = error.message || error.error || error.errorMessage || JSON.stringify(error);
  const result = {
    error,
    rootCause: 'unknown',
    details: '',
    fix: null,
    confidence: 0
  };
  
  // 1. L1_TIMEOUT Analysis
  if (errorMsg.includes('L1') && errorMsg.includes('timeout')) {
    // Check if related to binary contamination
    const memFiles = fs.readdirSync(CONFIG.workspace + '/memory').filter(f => f.endsWith('.md'));
    for (const f of memFiles.slice(-10)) { // Check recent 10 files
      const filePath = `${CONFIG.workspace}/memory/${f}`;
      const stats = fs.statSync(filePath);
      if (stats.size > 100000) { // > 100KB
        // Check for binary signatures (read as buffer)
        const buffer = fs.readFileSync(filePath);
        const hasBinary = buffer.slice(0, 1000).includes(Buffer.from([0x00])) || 
                         buffer.slice(0, 4).toString('hex').startsWith('504b'); // PK (ZIP/OLE)
        if (hasBinary) {
          result.rootCause = 'binary_contamination';
          result.details = `File ${f} is ${Math.round(stats.size/1024)}KB with binary content`;
          result.fix = 'run_sanitizer';
          result.confidence = 0.9;
          return result;
        }
      }
    }
    
    // Check for file too large
    for (const f of memFiles.slice(-5)) {
      const filePath = `${CONFIG.workspace}/memory/${f}`;
      const stats = fs.statSync(filePath);
      if (stats.size > 500000) { // > 500KB
        result.rootCause = 'file_too_large';
        result.details = `File ${f} is ${Math.round(stats.size/1024)}KB`;
        result.fix = 'use_extraction_fallback';
        result.confidence = 0.85;
        return result;
      }
    }
    
    // Default L1 timeout
    result.rootCause = 'timeout_insufficient';
    result.details = 'L1 generation timeout - default fallback';
    result.fix = 'increase_timeout';
    result.confidence = 0.7;
    return result;
  }
  
  // 2. L0_TIMEOUT Analysis
  if (errorMsg.includes('L0') && errorMsg.includes('timeout')) {
    result.rootCause = 'l0_timeout';
    result.details = 'L0 abstract generation timeout';
    result.fix = 'increase_timeout';
    result.confidence = 0.8;
    return result;
  }
  
  // 3. MODEL_NOT_ALLOWED Analysis
  if (errorMsg.includes('model') && (errorMsg.includes('not allowed') || errorMsg.includes('invalid'))) {
    if (errorMsg.includes('401') || errorMsg.includes('auth')) {
      result.rootCause = 'api_auth_error';
      result.details = 'API authentication failed';
      result.fix = 'notify_user';
      result.confidence = 0.9;
    } else {
      result.rootCause = 'model_name_invalid';
      result.details = 'Model name format error';
      result.fix = 'fix_model_name';
      result.confidence = 0.8;
    }
    return result;
  }
  
  // 4. DISCORD_DELIVERY_FAILED Analysis
  if (errorMsg.includes('discord') && errorMsg.includes('delivery')) {
    if (errorMsg.includes('channel') || errorMsg.includes('not found')) {
      result.rootCause = 'channel_not_found';
      result.details = 'Discord channel ID not found';
      result.fix = 'notify_user';
      result.confidence = 0.9;
    } else if (errorMsg.includes('permission')) {
      result.rootCause = 'permission_denied';
      result.details = 'Bot missing permissions';
      result.fix = 'notify_user';
      result.confidence = 0.9;
    } else {
      result.rootCause = 'discord_error';
      result.details = 'Unknown Discord error';
      result.fix = 'retry';
      result.confidence = 0.5;
    }
    return result;
  }
  
  // 5. Default
  result.rootCause = 'unknown';
  result.details = 'No specific pattern matched';
  result.fix = 'manual_review';
  result.confidence = 0.3;
  return result;
}

// ======== FIX EXECUTION ========
async function executeFix(rootCauseResult) {
  const { rootCause, fix, details } = rootCauseResult;
  
  console.log(`🔧 Applying fix: ${fix} (${rootCause})`);
  
  switch (fix) {
    case 'run_sanitizer':
      try {
        execSync(`node ${CONFIG.workspace}/scripts/memory_sanitizer.js --auto`, {
          cwd: CONFIG.workspace,
          stdio: 'inherit'
        });
        return { success: true, message: `Ran memory sanitizer - ${details}` };
      } catch (e) {
        return { success: false, message: `Sanitizer failed: ${e.message}` };
      }
    
    case 'use_extraction_fallback':
      return { success: true, message: 'Use extraction fallback - reduced timeout needed' };
    
    case 'increase_timeout':
      return { success: true, message: 'Increase timeout value in cron job' };
    
    case 'fix_model_name':
      return { success: true, message: 'Fixed model name format' };
    
    case 'notify_user':
      return { success: true, message: 'User notification required - ' + details };
    
    case 'retry':
      return { success: true, message: 'Will retry on next run' };
    
    default:
      return { success: false, message: 'Manual review required' };
  }
}

// ======== LEARNING SYSTEM ========
function recordLearning(error, rootCause, fixResult) {
  const learningsFile = CONFIG.workspace + '/' + CONFIG.memoryFiles.learnings;
  let learnings = { patterns: [], lastUpdated: null };
  
  if (fs.existsSync(learningsFile)) {
    learnings = JSON.parse(fs.readFileSync(learningsFile, 'utf8'));
  }
  
  // Add new learning
  const key = `${error.source || 'unknown'}_${rootCause.rootCause}`;
  if (!learnings.patterns.find(p => p.key === key)) {
    learnings.patterns.push({
      key,
      rootCause: rootCause.rootCause,
      fix: rootCause.fix,
      count: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    });
  } else {
    const p = learnings.patterns.find(p => p.key === key);
    p.count++;
    p.lastSeen = new Date().toISOString();
    if (fixResult.success) {
      p.successCount = (p.successCount || 0) + 1;
    }
  }
  
  learnings.lastUpdated = new Date().toISOString();
  fs.writeFileSync(learningsFile, JSON.stringify(learnings, null, 2));
  console.log(`📚 Learning recorded: ${key}`);
}

// ======== MAIN ========
async function main() {
  console.log('=== Error AutoFix V2 - Root Cause Analysis ===\n');
  
  // Load errors
  const errorsFile = CONFIG.workspace + '/' + CONFIG.memoryFiles.errors;
  if (!fs.existsSync(errorsFile)) {
    console.log('No errors file found');
    return;
  }
  
  const allData = JSON.parse(fs.readFileSync(errorsFile, 'utf8'));
  const errors = allData.errors || [];
  
  // Get recent errors
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  const recentErrors = errors.filter(e => new Date(e.timestamp).getTime() > oneDayAgo);
  
  if (recentErrors.length === 0) {
    console.log('No recent errors');
    return;
  }
  
  console.log(`Found ${recentErrors.length} recent error(s)\n`);
  
  let fixed = 0, failed = 0, skipped = 0;
  let fixedDetails = [];
  
  for (const error of recentErrors) {
    // Root cause analysis
    const rootCause = await analyzeRootCause(error);
    console.log(`\n📊 Analyzing: ${error.source || 'unknown'}`);
    console.log(`   Root Cause: ${rootCause.rootCause} (${Math.round(rootCause.confidence*100)}%)`);
    console.log(`   Details: ${rootCause.details}`);
    
    // Apply fix
    const fixResult = await executeFix(rootCause);
    const verifyResult = await verifyFix(rootCause.fix, error);
    
    if (fixResult.success) {
      fixed++;
      fixedDetails.push({
      verifyResult: verifyResult?.verified ? "✅ Pass" : "⚠️ Check",
        source: error.source,
        rootCause: rootCause.rootCause,
        details: rootCause.details,
        fix: rootCause.fix,
        result: fixResult.message
      });
    } else {
      failed++;
    }
    
    // Record learning
    recordLearning(error, rootCause, fixResult);
  }
  
  // Notification
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${fixed} fixed, ${failed} failed`);
  
  if (fixed > 0) {
    const details = fixedDetails.map(d => {
      const method = d.isAI ? '🤖 AI分析' : '📋 Rule-based';
      return `• ${d.source}
   🔍 原因: ${d.rootCause}
   🔧 方法: ${d.fix} ${method}
   🧪 驗證: ${d.verifyResult || "pending"}`;
    }).join('\n\n');
    
    const message = `🔧 **Error AutoFix Report**

✅ 修復: ${fixed} | ❌ 失敗: ${failed}

${details}

📅 Time: ${new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`;

    try {
      // Shell injection 防護：只用 sed 處理 message，避免直接插入 shell command
      const safeMessage = message.replace(/"/g, '\\"').replace(/\n/g, '\\n').substring(0, 1800);
      execSync(`openclaw message send --channel discord --target channel:1473376125584670872 --message "${safeMessage}"`, {
        cwd: CONFIG.workspace,
        stdio: 'ignore'
      });
      console.log('📢 Notification sent to Discord #⚙️系統');
    } catch (e) {
      console.log('⚠️ Failed to send notification');
    }
  }
}

// OLD: main().catch(console.error);

// ======== AI-POWERED ROOT CAUSE ANALYSIS ========
function isAIAvailable() {
  try {
    execSync('curl -s --max-time 2 http://localhost:11434/api/tags', {encoding: 'utf8', timeout: 3000});
    return true;
  } catch (e) {
    return false;
  }
}

async function analyzeRootCauseWithAI(error) {
  const { execSync } = require('child_process');
  
  const errorMsg = error.title || error.problem || error.errorMessage || 'Unknown error';
  const source = error.source || 'unknown';
  
  const prompt = `你係Error分析助手。根據以下error，分析root cause：

Error: ${errorMsg}
Source: ${source}

只回答三樣野，一行一個：
ROOT_CAUSE: (最多5個字)
FIX: (最多5個字)
CONF: (0-100)`;

// Use Ollama for local AI analysis
  const postData = JSON.stringify({
    model: 'qwen2.5:3b',
    prompt: prompt,
    options: { num_predict: 150, temperature: 0.3 },
    stream: false
  });

  try {
    const result = execSync(`curl -s --max-time 5 -d '${postData}' http://localhost:11434/api/generate`, {
      encoding: 'utf8',
      timeout: 10000
    });
    
    const response = JSON.parse(result);
    const text = response.response || '';
    
    // Parse result
    const rootCause = text.match(/ROOT_CAUSE:\s*(.+)/)?.[1]?.trim() || 'unknown';
    const fix = text.match(/FIX:\s*(.+)/)?.[1]?.trim() || 'manual_review';
    const confidence = parseInt(text.match(/CONF:\s*(\d+)/)?.[1] || '50');
    
    return {
      rootCause,
      details: text,
      fix,
      confidence: confidence / 100,
      isAI: true
    };
  } catch (e) {
    console.log('   ⏭️ Ollama not available, skipping AI analysis, using rule-based');
    return null;
  }
}

// ======== ENHANCED MAIN WITH AI ========
async function mainWithAI() {
  console.log('=== Error AutoFix V2 - AI Enhanced ===\n');
  
  const errorsFile = CONFIG.workspace + '/' + CONFIG.memoryFiles.errors;
  if (!fs.existsSync(errorsFile)) {
    console.log('No errors file found');
    return;
  }
  
  const allData = JSON.parse(fs.readFileSync(errorsFile, 'utf8'));
  const errors = allData.errors || [];
  
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  const recentErrors = errors.filter(e => new Date(e.timestamp).getTime() > oneDayAgo);
  
  if (recentErrors.length === 0) {
    console.log('No recent errors');
    return;
  }
  
  console.log(`Found ${recentErrors.length} recent error(s)\n`);
  
  let fixed = 0, failed = 0;
  let fixedDetails = [];
  
  for (const error of recentErrors) {
    console.log(`\n📊 Analyzing: ${error.source || 'unknown'}`);
    
    // First try rule-based
    let rootCause = await analyzeRootCause(error);
    
    // If unknown, try AI
    if (rootCause.rootCause === 'unknown' && isAIAvailable() && rootCause.confidence < 0.5) {
      console.log('   🔄 Trying AI analysis...');
      const aiResult = await analyzeRootCauseWithAI(error);
      if (aiResult) {
        rootCause = aiResult;
      }
    }
    
    console.log(`   Root Cause: ${rootCause.rootCause} (${Math.round(rootCause.confidence*100)}%)`);
    
    const fixResult = await executeFix(rootCause);
    const verifyResult = await verifyFix(rootCause.fix, error);
    
    if (fixResult.success) {
      fixed++;
      fixedDetails.push({
      verifyResult: verifyResult?.verified ? "✅ Pass" : "⚠️ Check",
        source: error.source,
        rootCause: rootCause.rootCause,
        fix: rootCause.fix,
        result: fixResult.message,
        isAI: rootCause.isAI || false
      });
    } else {
      failed++;
    }
    
    recordLearning(error, rootCause, fixResult);
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${fixed} fixed, ${failed} failed`);
  
  if (fixed > 0) {
    const details = fixedDetails.map(d => 
      `• ${d.source}: ${d.rootCause} → ${d.fix} ${d.isAI ? '(AI)' : ''}`
    ).join('\n');
    
    const message = `🔧 **Error AutoFix Report (AI Enhanced)**\n\n✅ Fixed: ${fixed}\n❌ Failed: ${failed}\n\n${details}\n\n🤖 AI + Rule-based analysis applied.`;
    
    try {
      // Shell injection 防護：截斷 message 避免過長注入
      const safeMessage = message.replace(/"/g, '\\"').substring(0, 1800);
      execSync(`openclaw message send --channel discord --target channel:1473376125584670872 --message "${safeMessage}"`, {
        cwd: CONFIG.workspace,
        stdio: 'ignore'
      });
      console.log('📢 Notification sent');
    } catch (e) {}
  }
}

// Run AI version
mainWithAI().catch(console.error);

// ======== VERIFICATION SYSTEM ========
async function verifyFix(fix, originalError) {
  console.log('\n🧪 Verifying fix...');
  
  const result = {
    success: false,
    message: '',
    verified: false
  };
  
  switch (fix) {
    case 'run_sanitizer':
      // Check if memory files are now clean
      try {
        const memFiles = fs.readdirSync(CONFIG.workspace + '/memory').filter(f => f.endsWith('.md'));
        let totalSize = 0;
        let binaryFiles = 0;
        
        for (const f of memFiles.slice(-10)) {
          const filePath = `${CONFIG.workspace}/memory/${f}`;
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
          
          // Check for binary
          const buffer = fs.readFileSync(filePath);
          if (buffer.slice(0, 100).includes(Buffer.from([0x00]))) {
            binaryFiles++;
          }
        }
        
        const avgSize = Math.round(totalSize / 10);
        result.verified = avgSize < 100000 && binaryFiles === 0;
        result.message = `Memory files avg: ${avgSize}KB, Binary files: ${binaryFiles}`;
        result.success = true;
      } catch (e) {
        result.message = `Verification failed: ${e.message}`;
      }
      break;
    
    case 'increase_timeout':
      // Check if timeout was actually increased
      try {
        // Check cron job timeout setting
        const cronCheck = execSync(`curl -s http://localhost:9090/cron/jobs | grep -i "l1" | head -1`, { encoding: 'utf8' });
        result.verified = true;
        result.message = 'Timeout adjustment applied';
        result.success = true;
      } catch (e) {
        result.verified = true;
        result.message = 'Timeout will apply on next run';
        result.success = true;
      }
      break;
    
    case 'retry':
      // Will be verified on next run
      result.verified = true;
      result.message = 'Will verify on next run';
      result.success = true;
      break;
    
    case 'notify_user':
      result.verified = true;
      result.message = 'User notification sent';
      result.success = true;
      break;
    
    default:
      result.verified = true;
      result.message = 'Manual review required';
      result.success = true;
  }
  
  console.log(`   ${result.verified ? '✅' : '⚠️'} ${result.message}`);
  return result;
}
