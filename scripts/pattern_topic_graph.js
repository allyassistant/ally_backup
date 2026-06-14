/**
 * pattern_topic_graph.js
 * 跨 Topic 關聯 - 建立 Topic 關係圖
 *
 * 用法: node pattern_topic_graph.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { getHKTDateTime } = require('./lib/time');

// === CONFIG ===
const MEMORY_DIR = path.join(process.env.HOME, '.openclaw/workspace/memory');
const OUTPUT_FILE = path.join(MEMORY_DIR, 'patterns', 'topic-graph.json');
const DRY_RUN = process.argv.includes('--dry-run');

// Topic definitions with related keywords
const TOPIC_DEFINITIONS = {
  'discord': {
    keywords: ['Discord', 'discord', 'channel', '頻道', 'message', 'DM'],
    color: '#7289da'
  },
  'stock': {
    keywords: ['stock', 'Stock', '庫存', '股票', 'diamond', 'diamond stock'],
    color: '#📈'
  },
  'coding': {
    keywords: ['編程', 'code', 'coding', 'script', 'javascript', 'node', 'python', 'bash'],
    color: '#💻'
  },
  'github': {
    keywords: ['GitHub', 'github', 'repo', 'repository', 'commit', 'pull', 'issue'],
    color: '#🐙'
  },
  'finance': {
    keywords: ['財務', 'finance', 'stock', '股票', '投資', 'money', 'price'],
    color: '#💰'
  },
  'system': {
    keywords: ['system', '系統', 'cron', 'backup', 'ha', 'failover', 'server'],
    color: '#⚙️'
  },
  'memory': {
    keywords: ['memory', '記憶', 'l0', 'l1', 'l2', 'compress', 'archiver'],
    color: '#🧠'
  },
  'apple': {
    keywords: ['Apple', 'apple', 'Notes', 'Reminders', 'iOS', 'macOS'],
    color: '#🍎'
  },
  'project': {
    keywords: ['項目', 'project', 'issue', '進度', 'task'],
    color: '#📋'
  },
  'review': {
    keywords: ['review', 'audit', '審計', 'review', 'check'],
    color: '#🔍'
  },
  'browser': {
    keywords: ['browser', 'chrome', 'browser', '網頁', 'scraping'],
    color: '#🌐'
  },
  'error': {
    keywords: ['error', 'Error', '錯誤', 'fail', 'failed', 'exception', 'bug'],
    color: '#❌'
  }
};

// Transition keywords that suggest topic flow
const TRANSITION_KEYWORDS = [
  'so', 'thus', 'therefore', 'resulting', '導致', '因此',
  'then', 'next', 'after', 'following', '然後', '之後',
  'also', 'additionally', '另外', '還有',
  'related', 'similarly', 'similar', '相關', '類似'
];

function log(...args) {
  console.log('[pattern_topic_graph]', ...args);
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
    log('❌ Error reading memory directory:', e.message);
    return [];
  }
}

function parseDate(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : 'unknown';
}

function detectTopics(content) {
  const detectedTopics = new Set();

  Object.entries(TOPIC_DEFINITIONS).forEach(([topicName, def]) => {
    def.keywords.forEach(kw => {
      if (content.includes(kw)) {
        detectedTopics.add(topicName);
      }
    });
  });

  return Array.from(detectedTopics);
}

function detectTopicTransitions(lines) {
  const edges = [];

  for (let i = 0; i < lines.length - 1; i++) {
    const line1 = lines[i];
    const line2 = lines[i + 1];

    const topics1 = detectTopics(line1);
    const topics2 = detectTopics(line2);

    // Check if there's a transition indicator
    const hasTransition = TRANSITION_KEYWORDS.some(kw => line2.toLowerCase().includes(kw.toLowerCase()));

    // Create edges between topics in consecutive lines
    topics1.forEach(t1 => {
      topics2.forEach(t2 => {
        if (t1 !== t2) {
          edges.push({ from: t1, to: t2, hasTransition });
        }
      });
    });
  }

  return edges;
}

function analyzeTopicGraph() {
  const memoryFiles = getMemoryFiles();
  log(`📂 Found ${memoryFiles.length} memory files`);

  const nodes = {};
  const edgeMap = {};

  // Initialize nodes from definitions
  Object.keys(TOPIC_DEFINITIONS).forEach(topic => {
    nodes[topic] = {
      count: 0,
      first: null,
      last: null,
      co_occurrences: []
    };
  });

  memoryFiles.forEach(filePath => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fileDate = parseDate(path.basename(filePath));

      // Detect all topics in this file
      const fileTopics = detectTopics(content);

      // Update node counts
      fileTopics.forEach(topic => {
        if (!nodes[topic]) {
          nodes[topic] = { count: 0, first: null, last: null, co_occurrences: [] };
        }

        nodes[topic].count++;

        if (!nodes[topic].first || fileDate < nodes[topic].first) {
          nodes[topic].first = fileDate;
        }
        if (!nodes[topic].last || fileDate > nodes[topic].last) {
          nodes[topic].last = fileDate;
        }
      });

      // Track co-occurrences
      for (let i = 0; i < fileTopics.length; i++) {
        for (let j = i + 1; j < fileTopics.length; j++) {
          const pair = [fileTopics[i], fileTopics[j]].sort().join('+');
          if (!nodes[fileTopics[i]].co_occurrences.includes(pair)) {
            nodes[fileTopics[i]].co_occurrences.push(pair);
          }
          if (!nodes[fileTopics[j]].co_occurrences.includes(pair)) {
            nodes[fileTopics[j]].co_occurrences.push(pair);
          }
        }
      }

      // Detect topic transitions
      const lines = content.split('\n');
      const edges = detectTopicTransitions(lines);

      edges.forEach(edge => {
        const edgeKey = `${edge.from}->${edge.to}`;
        if (!edgeMap[edgeKey]) {
          edgeMap[edgeKey] = {
            from: edge.from,
            to: edge.to,
            weight: 0,
            examples: []
          };
        }
        edgeMap[edgeKey].weight++;
        if (edgeMap[edgeKey].examples.length < 3) {
          edgeMap[edgeKey].examples.push(fileDate);
        }
      });
    } catch (e) {
      log(`⚠️ Error reading ${filePath}: ${e.message}`);
    }
  });

  // Convert edge map to array
  const edges = Object.values(edgeMap)
    .filter(e => e.weight >= 1)
    .sort((a, b) => b.weight - a.weight);

  // Remove nodes with zero count
  Object.keys(nodes).forEach(topic => {
    if (nodes[topic].count === 0) {
      delete nodes[topic];
    }
  });

  return { nodes, edges };
}

function generateOutput(nodes, edges) {
  return {
    last_updated: getHKTDateTime(),
    summary: {
      total_nodes: Object.keys(nodes).length,
      total_edges: edges.length
    },
    nodes: nodes,
    edges: edges.slice(0, 30) // Top 30 edges
  };
}

function printGraph(nodes, edges) {
  console.log('\n📊 Topic Nodes:');
  Object.entries(nodes)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([topic, data]) => {
      console.log(`   🔵 ${topic}: ${data.count} mentions (${data.first} ~ ${data.last})`);
    });

  console.log('\n🔗 Topic Relationships (Top 10):');
  edges.slice(0, 10).forEach(edge => {
    console.log(`   ${edge.from} → ${edge.to} (weight: ${edge.weight})`);
  });
}

function main() {
  try {
    console.log('\n🔍 === Pattern Topic Graph ===\n');
    log('Starting topic relationship analysis...');
    log('Dry run:', DRY_RUN ? 'YES (no files will be written)' : 'NO');

    ensurePatternsDir();

    const { nodes, edges } = analyzeTopicGraph();
    const output = generateOutput(nodes, edges);

    printGraph(nodes, edges);

    console.log(`\n📊 Summary:`);
    console.log(`   Total topics: ${output.summary.total_nodes}`);
    console.log(`   Total relationships: ${output.summary.total_edges}`);

    if (!DRY_RUN) {
      try {
        const tmpFile = OUTPUT_FILE + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(output, null, 2));
        fs.renameSync(tmpFile, OUTPUT_FILE);
        log(`\n✅ Written to ${OUTPUT_FILE}`);
      } catch (e) {
        log('\n❌ Failed to write output:', e.message);
      }
    } else {
      log('\n🔍 [DRY-RUN] Would write output');
    }

    return output;
  } catch (e) {
    log('\n❌ main() failed:', e.message);
  }
}

main();
