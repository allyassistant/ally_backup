#!/usr/bin/env node
/**
 * Daily Archive Script
 * 每日自動歸檄舊日誌文件
 */

const fs = require('fs');
const path = require('path');

const MEMORY_DIR = '/Users/ally/.openclaw/workspace/memory';
const DAILY_DIR = path.join(MEMORY_DIR, '_daily');
const ARCHIVE_DIR = path.join(MEMORY_DIR, '_archive');

function getFileDate(filename) {
  const match = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(`${match[1]}-${match[2]}-${match[3]}`);
}

function daysDiff(date1, date2) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((date2 - date1) / msPerDay);
}

function archiveOldFiles() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let moved = 0;
  let errors = [];
  
  // 確保目錄存在
  if (!fs.existsSync(DAILY_DIR)) {
    fs.mkdirSync(DAILY_DIR, { recursive: true });
  }
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }
  
  // 讀取 _daily 目錄
  const files = fs.readdirSync(DAILY_DIR).filter(f => f.endsWith('.md'));
  
  for (const file of files) {
    const fileDate = getFileDate(file);
    if (!fileDate) continue;
    
    const daysOld = daysDiff(fileDate, today);
    
    // 超過 2 天的文件移到 archive
    if (daysOld > 2) {
      const srcPath = path.join(DAILY_DIR, file);
      const destPath = path.join(ARCHIVE_DIR, file);
      
      try {
        fs.renameSync(srcPath, destPath);
        moved++;
        console.log(`📦 Archived: ${file} (${daysOld} days old)`);
      } catch (err) {
        errors.push(`${file}: ${err.message}`);
      }
    }
  }
  
  // 更新日誌
  const logEntry = {
    timestamp: new Date().toISOString(),
    archived: moved,
    errors: errors,
    dailyFilesRemaining: files.length - moved
  };
  
  const logPath = path.join(MEMORY_DIR, 'archive-log.json');
  let logs = [];
  if (fs.existsSync(logPath)) {
    logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  }
  logs.push(logEntry);
  // 只保留最近 30 條記錄
  logs = logs.slice(-30);
  fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
  
  console.log(`\n✅ Archive complete: ${moved} files moved`);
  if (errors.length > 0) {
    console.log(`⚠️  Errors: ${errors.length}`);
    errors.forEach(e => console.log(`   - ${e}`));
  }
  
  return { moved, errors };
}

// 執行
if (require.main === module) {
  archiveOldFiles();
}

module.exports = { archiveOldFiles };
