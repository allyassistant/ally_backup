#!/usr/bin/env node

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

/**
 * Memory Cleanup - 記憶清理（支援 P0/TTL）
 * Run: node scripts/memory_cleanup.js [--dry-run]
 *
 * 根據 P0/P1/P2/P3 優先級同 TTL 自動清理過期記憶
 */

const fs = require('fs');
const path = require('path');

const { WS, MEMORY_DIR } = require('./lib/config');
const MEMORY_FILE = path.join(WS, 'MEMORY.md');
const { getHKTDate } = require('./lib/time');

// ==================== SAFE FS HELPERS ====================

function safeExistsSync(filepath) {
  try {
    return fs.existsSync(filepath);
  } catch (e) {
    console.error('Error checking file existence: ' + e.message);
    return false;
  }
}

function safeReadFileSync(filepath, encoding = 'utf-8') {
  try {
    return fs.readFileSync(filepath, encoding);
  } catch (e) {
    console.error('Error reading file: ' + e.message);
    return null;
  }
}

function safeMkdirSync(dirpath, options) {
  try {
    return fs.mkdirSync(dirpath, options);
  } catch (e) {
    if (e.code === 'EEXIST') {
      return;
    }
    console.error('Error creating directory: ' + e.message);
    throw e;
  }
}

function safeAtomicWriteSync(filepath, content) {
  try {
    const { atomicWriteSync } = require('./lib/state');
    return atomicWriteSync(filepath, content);
  } catch (e) {
    console.error('Error writing file atomically: ' + e.message);
    throw e;
  }
}

const { atomicWriteSync } = require('./lib/state');

// ==================== HELPERS ====================
// ==================== CONFIG (Magic Numbers) ====================
const CONFIG = {
  // TTL (Time To Live) by priority — null means never expire
  TTL_DAYS: {
    'P0': null,   // Never expire (P0 = critical/permanent)
    'P1': 180,    // 6 months
    'P2': 90,     // 3 months
    'P3': 30      // 1 month
  },
  TTL_FALLBACK_DAYS: 90, // Default TTL if priority not specified (was hardcoded 90)
};

// Alias for backward compat
const TTL_DAYS = CONFIG.TTL_DAYS;

// ==================== PARSE MEMORY ====================

function parseMemory(content) {
  const sections = [];
  const lines = content.split('\n');
  let currentSection = null;
  let currentContent = [];
  let preambleLines = [];
  let foundFirstSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for P0/P1/P2/P3 markers
    const priorityMatch = line.match(/^(#{2,4})\s*(?:[🎯🔴🟡🟢]\s*)?(P[0-3])\s*[-\s]+(.+)$/i);

    if (priorityMatch || line.startsWith('## ')) {
      foundFirstSection = true;
      // Save previous section
      if (currentSection) {
        currentSection.content = currentContent.join('\n');
        sections.push(currentSection);
      }

      // Start new section
      if (priorityMatch) {
        currentSection = {
          priority: priorityMatch[2].toUpperCase(),
          title: priorityMatch[3],
          header: priorityMatch[1],
          lineStart: i,
          hasTTL: false,
          ttl: null
        };
      } else {
        currentSection = {
          priority: null,
          title: line.replace(/^##\s*/, ''),
          header: '##',
          lineStart: i,
          hasTTL: false,
          ttl: null
        };
      }
      currentContent = [line];
    } else if (currentSection) {
      // Check for TTL marker
      const ttlMatch = line.match(/\*📅 Created:\s*(\d{4}-\d{2}-\d{2})\s*\|\s*🔄 Updated:\s*(\d{4}-\d{2}-\d{2})\s*(?:\|\s*⏰ TTL:\s*(\w+))?\*/i);

      if (ttlMatch) {
        currentSection.created = ttlMatch[1];
        currentSection.updated = ttlMatch[2];
        currentSection.hasTTL = true;

        if (ttlMatch[3]) {
          currentSection.ttl = ttlMatch[3] === 'Never' ? null : parseInt(ttlMatch[3]);
        } else {
          // Default TTL based on priority
          currentSection.ttl = TTL_DAYS[currentSection.priority];
        }
      }

      currentContent.push(line);
    } else if (!foundFirstSection) {
      // Collect preamble (content before first ## section)
      preambleLines.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    currentSection.content = currentContent.join('\n');
    sections.push(currentSection);
  }

  return { preamble: preambleLines.join('\n'), sections };
}

// ==================== CHECK EXPIRED ====================

function isExpired(section) {
  // P0 never expires
  if (section.priority === 'P0') return false;

  // If no TTL, check default
  const ttl = section.ttl ?? TTL_DAYS[section.priority] ?? CONFIG.TTL_FALLBACK_DAYS;

  // If TTL is null (Never), don't expire
  if (ttl === null) return false;

  // Check last updated date
  const lastDate = section.updated || section.created;
  if (!lastDate) return false;

  const updated = new Date(lastDate);
  const now = new Date();
  const daysDiff = (now - updated) / (1000 * 60 * 60 * 24);

  return daysDiff > ttl;
}

// ==================== CLEANUP ====================

function cleanup(content, dryRun = false) {
  const { preamble, sections } = parseMemory(content);
  const expired = [];
  const kept = [];
  const p0Sections = [];

  for (const section of sections) {
    if (section.priority === 'P0') {
      p0Sections.push(section);
    }

    if (isExpired(section)) {
      expired.push(section);
    } else {
      kept.push(section);
    }
  }

  // Generate report
  const report = {
    total: sections.length,
    kept: kept.length,
    expired: expired.length,
    p0Protected: p0Sections.length,
    details: expired.map(s => ({
      priority: s.priority,
      title: s.title,
      lastUpdated: s.updated || s.created
    }))
  };

  if (!dryRun && expired.length > 0) {
    // Archive expired sections
    const archiveContent = expired.map(s => s.content).join('\n\n---\n\n');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveFile = path.join(MEMORY_DIR, '_archive', `memory-expired-${getHKTDate()}-${timestamp}.md`);

    try {
      safeMkdirSync(path.dirname(archiveFile), { recursive: true });
    } catch (err) {
      console.error('Error creating directory: ' + err.message);
      return report;
    }
    try {
      safeAtomicWriteSync(archiveFile, `# Expired Memory Sections\n\n*Cleaned on ${new Date().toLocaleString('zh-HK')}*\n\n---\n\n${archiveContent}`);
    } catch (e) {
      console.error('Error writing archive file: ' + e.message);
      return report;
    }

    // Rebuild MEMORY.md (preserve preamble: title, intro text before first ## section)
    const sectionContent = kept.map(s => s.content).join('\n\n');
    const newContent = preamble ? preamble + '\n\n' + sectionContent : sectionContent;
    try {
      safeAtomicWriteSync(MEMORY_FILE, newContent);
    } catch (e) {
      console.error('Error writing memory file: ' + e.message);
    }
  }

  return report;
}

// ==================== ADD TTL TO SECTION ====================

function addTTLToSection(content, sectionTitle, priority = 'P2') {
  const lines = content.split('\n');
  const newLines = [];
  let inTargetSection = false;
  let ttlAdded = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this is the target section
    if (line.includes(sectionTitle) || line.match(new RegExp(`^#{2,4}\\s*(?:[🎯🔴🟡🟢]\\s*)?${priority}\\s*[-\\s]+${sectionTitle}`, 'i'))) {
      inTargetSection = true;
    }

    // Add TTL marker after section header
    if (inTargetSection && !ttlAdded && line.trim() && !line.startsWith('#')) {
      const ttl = TTL_DAYS[priority];
      const ttlText = ttl ? `${ttl}日` : 'Never';
      const today = getHKTDate();

      newLines.push(`*📅 Created: ${today} | 🔄 Updated: ${today} | ⏰ TTL: ${ttlText}*`);
      ttlAdded = true;
      inTargetSection = false; // Only add once
    }

    newLines.push(line);
  }

  return newLines.join('\n');
}

// ==================== MAIN ====================

function main() {
  try {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');

    if (!safeExistsSync(MEMORY_FILE)) {
      log('❌ MEMORY.md not found');
      return;
    }

    const content = safeReadFileSync(MEMORY_FILE, 'utf-8');
    if (content === null) {
      return;
    }
    const report = cleanup(content, dryRun);

    log(`\n🧹 Memory Cleanup Report\n`);
    log(`Total sections: ${report.total}`);
    log(`Kept: ${report.kept}`);
    log(`Expired: ${report.expired}`);
    log(`P0 protected: ${report.p0Protected}`);

    if (report.expired > 0) {
      log(`\nExpired sections:`);
      for (const item of report.details) {
        log(`  - [${item.priority || 'N/A'}] ${item.title.slice(0, 50)}...`);
      }

      if (dryRun) {
        log(`\n⚠️ Dry run - no changes made`);
        log(`Run without --dry-run to apply cleanup`);
      } else {
        log(`\n✅ Cleanup applied`);
        log(`Expired sections archived to memory/_archive/`);
      }
    }

    return report;
  } catch (err) {
    console.error(`❌ Memory cleanup failed: ${err.message}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { cleanup, addTTLToSection, TTL_DAYS };
