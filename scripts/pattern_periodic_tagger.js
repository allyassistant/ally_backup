/**
 * pattern_periodic_tagger.js
 * 週期性問題標記 - 分析時間模式
 *
 * 用法: node pattern_periodic_tagger.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { getHKTDateTime } = require('./lib/time');

// === CONFIG ===
const MEMORY_DIR = path.join(process.env.HOME, '.openclaw/workspace/memory');
const OUTPUT_FILE = path.join(MEMORY_DIR, 'patterns', 'periodic.json');
const DRY_RUN = process.argv.includes('--dry-run');
const MIN_DAYS = 14; // Minimum days of data required

// Topic keywords to track
const TOPIC_KEYWORDS = {
  'stock': ['stock', 'Stock', '庫存', '股票'],
  'coding': ['編程', 'code', 'coding', 'script', 'javascript', 'node'],
  'discord': ['Discord', 'discord', '頻道', 'channel'],
  'github': ['GitHub', 'github', 'repo', 'repository'],
  'finance': ['財務', 'finance', 'stock', '股票', '投資'],
  'system': ['system', '系統', 'cron', 'backup', 'ha', 'failover'],
  'memory': ['memory', '記憶', 'l0', 'l1', 'l2', 'compress'],
  'apple': ['Apple', 'apple', 'Notes', 'Reminders', 'iOS'],
  'project': ['項目', 'project', 'issue', '進度'],
  'review': ['review', 'audit', '審計', 'review']
};

// Day of week names (HKT)
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function log(...args) {
  console.log('[pattern_periodic_tagger]', ...args);
}

function ensurePatternsDir() {
  const patternsDir = path.dirname(OUTPUT_FILE);
  try {
    if (!fs.existsSync(patternsDir)) {
      fs.mkdirSync(patternsDir, { recursive: true });
      log('📁 Created patterns directory:', patternsDir);
    }
  } catch (e) {
    console.error('Error creating directory: ' + e.message);
    return;
  }
}

function getMemoryFiles() {
  try {
    const files = fs.readdirSync(MEMORY_DIR);
    const memoryFiles = files
      .filter(f => /^\d{4}-\d{2}-\d{2}.*\.md$/.test(f))
      .map(f => path.join(MEMORY_DIR, f))
      .sort();
    return memoryFiles;
  } catch (e) {
    console.error('⚠️ readdir failed: ' + e.message);
    return [];
  }
}

function parseDate(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) {
    const date = new Date(match[1] + 'T00:00:00+08:00');
    return {
      dateStr: match[1],
      dayOfWeek: date.getDay(),
      dayName: DAY_NAMES[date.getDay()],
      timestamp: date.getTime()
    };
  }
  return null;
}

function extractTopics(content) {
  const topics = [];

  Object.entries(TOPIC_KEYWORDS).forEach(([topicName, keywords]) => {
    keywords.forEach(kw => {
      if (content.includes(kw)) {
        if (!topics.includes(topicName)) {
          topics.push(topicName);
        }
      }
    });
  });

  return topics;
}

function analyzePeriodicPatterns() {
  const memoryFiles = getMemoryFiles();
  log(`📂 Found ${memoryFiles.length} memory files`);

  // Calculate date range
  if (memoryFiles.length > 0) {
    const sorted = memoryFiles.sort();
    const first = parseDate(path.basename(sorted[0]));
    const last = parseDate(path.basename(sorted[sorted.length - 1]));

    if (first && last) {
      const dayDiff = Math.floor((last.timestamp - first.timestamp) / (1000 * 60 * 60 * 24));
      log(`📅 Date range: ${first.dateStr} to ${last.dateStr} (${dayDiff} days)`);

      if (dayDiff < MIN_DAYS) {
        log(`⚠️ Warning: Only ${dayDiff} days of data, recommend ${MIN_DAYS}+ days for accurate patterns`);
      }
    }
  }

  // Build day-of-week -> topics mapping
  const dayTopicMatrix = {};
  DAY_NAMES.forEach(day => {
    dayTopicMatrix[day] = {};
  });

  const dayTopicExamples = {};
  DAY_NAMES.forEach(day => {
    dayTopicExamples[day] = {};
  });

  memoryFiles.forEach(filePath => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = parseDate(path.basename(filePath));

      if (!parsed) return;

      const topics = extractTopics(content);

      topics.forEach(topic => {
        if (!dayTopicMatrix[parsed.dayName][topic]) {
          dayTopicMatrix[parsed.dayName][topic] = 0;
          dayTopicExamples[parsed.dayName][topic] = [];
        }
        dayTopicMatrix[parsed.dayName][topic]++;

        if (dayTopicExamples[parsed.dayName][topic].length < 3) {
          dayTopicExamples[parsed.dayName][topic].push(parsed.dateStr);
        }
      });
    } catch (e) {
      console.error('⚠️ File read failed: ' + e.message);
      return;
    }
  });

  // Find recurring patterns
  const patterns = [];

  DAY_NAMES.forEach(day => {
    Object.entries(dayTopicMatrix[day]).forEach(([topic, count]) => {
      if (count >= 2) { // At least 2 occurrences
        // Calculate confidence based on how many weeks
        const weeks = memoryFiles.length / 7;
        const confidence = Math.min(count / weeks, 1.0);

        if (confidence >= 0.3) {
          patterns.push({
            pattern: `every_${day.toLowerCase()}`,
            description: `每週${day}討論${topic}相關`,
            day_of_week: day,
            topic: topic,
            confidence: Math.round(confidence * 100) / 100,
            occurrences: count,
            examples: dayTopicExamples[day][topic]
          });
        }
      }
    });
  });

  // Detect topic co-occurrence patterns (topics that appear together frequently)
  const topicCooccur = {};

  memoryFiles.forEach(filePath => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const topics = extractTopics(content);

      if (topics.length >= 2) {
        // Sort topics to ensure consistent key
        const sortedTopics = [...topics].sort();

        for (let i = 0; i < sortedTopics.length; i++) {
          for (let j = i + 1; j < sortedTopics.length; j++) {
            const key = `${sortedTopics[i]}+${sortedTopics[j]}`;
            if (!topicCooccur[key]) {
              topicCooccur[key] = { topics: [sortedTopics[i], sortedTopics[j]], count: 0, examples: [] };
            }
            topicCooccur[key].count++;
          }
        }
      }
    } catch (e) {
      console.error('⚠️ Skipping file due to error: ' + e.message);
    }
  });

  // Convert co-occurrence to patterns
  Object.values(topicCooccur).forEach(cooc => {
    if (cooc.count >= 2) {
      patterns.push({
        pattern: `topic_pair`,
        description: `${cooc.topics[0]} 經常與 ${cooc.topics[1]} 一起討論`,
        topics: cooc.topics,
        confidence: Math.min(cooc.count / 5, 1.0),
        occurrences: cooc.count,
        examples: cooc.examples
      });
    }
  });

  return patterns;
}

function generateOutput(patterns) {
  // Sort by confidence
  const sortedPatterns = patterns.sort((a, b) => b.confidence - a.confidence);

  return {
    last_updated: getHKTDateTime(),
    min_days_analyzed: MIN_DAYS,
    patterns: sortedPatterns.slice(0, 20) // Top 20 patterns
  };
}

function main() {
  console.log('\n🔍 === Pattern Periodic Tagger ===\n');
  log('Starting periodic pattern analysis...');
  log('Dry run:', DRY_RUN ? 'YES (no files will be written)' : 'NO');

  ensurePatternsDir();

  const patterns = analyzePeriodicPatterns();
  const output = generateOutput(patterns);

  console.log('\n📊 Results:');
  console.log(`   Total patterns found: ${output.patterns.length}`);

  output.patterns.forEach(p => {
    const confPct = Math.round(p.confidence * 100);
    console.log(`   📌 ${p.description}`);
    console.log(`      Confidence: ${confPct}% | Occurrences: ${p.occurrences}`);
  });

  if (!DRY_RUN) {
    const tmpFile = OUTPUT_FILE + '.tmp';
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(output, null, 2));
      fs.renameSync(tmpFile, OUTPUT_FILE);
      log(`\n✅ Written to ${OUTPUT_FILE}`);
    } catch (e) {
      console.error('⚠️ File write failed: ' + e.message);
      return;
    }
  } else {
    log('\n🔍 [DRY-RUN] Would write output');
  }

  return output;
}

main();
