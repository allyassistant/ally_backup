/**
 * pattern_project_tracker.js
 * 長期項目追蹤 - 從 L2 記憶追蹤項目進度
 *
 * 用法: node pattern_project_tracker.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { getHKTDateTime } = require('./lib/time');

// === CONFIG ===
const MEMORY_DIR = path.join(process.env.HOME, '.openclaw/workspace/memory');
const ISSUES_DIR = path.join(process.env.HOME, '.openclaw/workspace/.issues/active');
const OUTPUT_FILE = path.join(MEMORY_DIR, 'patterns', 'projects.json');
const DRY_RUN = process.argv.includes('--dry-run');

// Project keywords (must appear in context that suggests actual project discussion)
const PROJECT_KEYWORDS = ['項目', 'project', '進度', '繼續搞', '搞緊', '進行中', '開發', '開發中'];

// Markdown table pattern to exclude (e.g., "| 數值 | |------|")
const MARKDOWN_TABLE_PATTERN = /^\s*\|[^|]*\|\s*[-:|]/;

// Issue pattern: Issue #數字
const ISSUE_PATTERN = /Issue #(\d+)/g;
const ISSUE_REF_PATTERN = /#(\d{3})/g;

function log(...args) {
  console.log('[pattern_project_tracker]', ...args);
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

function getIssueFiles() {
  try {
    const files = fs.readdirSync(ISSUES_DIR);
    return files
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(ISSUES_DIR, f));
  } catch (e) {
    log('⚠️ No .issues/active directory found:', e.message);
    return [];
  }
}

function parseIssueFile(filePath) {
  try {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      console.error('⚠️ File read failed: ' + e.message);
      return null;
    }
    const fileName = path.basename(filePath);

    const idMatch = fileName.match(/^(\d+)-/);
    const id = idMatch ? idMatch[1] : '000';

    const titleMatch = content.match(/^#\s+(.+)$/m) || content.match(/title:\s*(.+)/i);
    const title = titleMatch ? titleMatch[1].trim() : `Issue #${id}`;

    const statusMatch = content.match(/status:\s*(\w+)/i);
    const status = statusMatch ? statusMatch[1].toLowerCase() : 'unknown';

    const priorityMatch = content.match(/priority:\s*(P\d)/i);
    const priority = priorityMatch ? priorityMatch[1] : 'P3';

    const createdMatch = content.match(/created:\s*(\d{4}-\d{2}-\d{2})/i);
    const created = createdMatch ? createdMatch[1] : null;

    const updatedMatch = content.match(/updated:\s*(\d{4}-\d{2}-\d{2})/i);
    const updated = updatedMatch ? updatedMatch[1] : created;

    const progressMatch = content.match(/progress:\s*(\d+)\/(\d+)/i);
    const progress = progressMatch ? `${progressMatch[1]}/${progressMatch[2]}` : null;

    return {
      id: id.padStart(3, '0'),
      title: title.substring(0, 60),
      status,
      priority,
      created,
      updated,
      progress
    };
  } catch (e) {
    return null;
  }
}

function extractProjectName(line) {
  // Try to extract project name from line
  // Pattern: "項目名稱" or ### Project Name

  // Skip JSON-like lines (contain "last_updated", "first_seen", timestamps, etc.)
  // These are pattern output files, not actual project discussions
  if (line.match(/last_updated|first_seen|last_seen|resolved_at|completed_at|archived_at|timestamp|isostring/i)) {
    return null;
  }

  // Skip lines that look like JSON data structures
  if (line.match(/^\s*["']\w+["']\s*:\s*[{["']/) || line.match(/^\s*\{.*\}$/)) {
    return null;
  }

  const quotedMatch = line.match(/["'"]([^"']+)["']/);
  if (quotedMatch) {
    const name = quotedMatch[1].trim();
    // Filter out table-like content
    if (name.includes('|')) return null;
    // Filter out JSON-like field names
    if (name.match(/^(last_|first_|updated|created|timestamp|date|status|id|count)$/i)) {
      return null;
    }
    return name;
  }

  // After keywords like "項目" or "project"
  const afterKeyword = line.match(/(?:項目|project|進度)[:\s]+(.+)/i);
  if (afterKeyword) {
    const name = afterKeyword[1].trim();
    // Filter out table-like content (contains | which indicates markdown table cell)
    if (name.includes('|') || name.match(/^\s*[-:]+\s*$/)) {
      return null;
    }
    // Filter out JSON-like field values
    if (name.match(/^\d{4}-\d{2}-\d{2}|true|false|null|undefined$/i)) {
      return null;
    }
    return name.substring(0, 50);
  }

  // GitHub issue reference
  const issueMatch = line.match(/#(\d{3})/);
  if (issueMatch) return `Issue #${issueMatch[1]}`;

  return null;
}

function determineStatus(content) {
  const lower = content.toLowerCase();
  if (lower.includes('完成') || lower.includes('done') || lower.includes('✅') || lower.includes('completed')) {
    return 'completed';
  }
  if (lower.includes('暫停') || lower.includes('pause') || lower.includes('擱置')) {
    return 'paused';
  }
  if (lower.includes('放棄') || lower.includes('放棄') || lower.includes('cancelled')) {
    return 'cancelled';
  }
  if (lower.includes('繼續') || lower.includes('resume') || lower.includes('恢復')) {
    return 'resumed';
  }
  return 'active';
}

function analyzeProjects() {
  const memoryFiles = getMemoryFiles();
  const issueFiles = getIssueFiles();

  log(`📂 Found ${memoryFiles.length} memory files`);
  log(`📂 Found ${issueFiles.length} active issues`);

  const projectsMap = {};
  const issueMap = {};

  // First, index all issues
  issueFiles.forEach(filePath => {
    const issue = parseIssueFile(filePath);
    if (issue) {
      issueMap[`#${issue.id}`] = issue;
    }
  });

  // Scan memory files for project mentions
  memoryFiles.forEach(filePath => {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fileName = path.basename(filePath);
      const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})/);
      const fileDate = dateMatch ? dateMatch[1] : 'unknown';

      const lines = content.split('\n');

      lines.forEach(line => {
        // Skip markdown table lines - any line starting with | after trim is likely a table row
        const trimmed = line.trim();
        if (trimmed.startsWith('|')) {
          return; // Skip this line - it's a markdown table
        }

        const hasProjectKeyword = PROJECT_KEYWORDS.some(kw => line.includes(kw));

        if (hasProjectKeyword) {
          const projectName = extractProjectName(line);
          if (projectName) {
            const key = projectName.toLowerCase().substring(0, 30);

            if (!projectsMap[key]) {
              projectsMap[key] = {
                name: projectName,
                first_seen: fileDate,
                last_seen: fileDate,
                discussion_count: 0,
                status: determineStatus(content),
                sessions: []
              };
            }

            projectsMap[key].last_seen = fileDate;
            projectsMap[key].discussion_count++;

            // Extract issue references
            const issueRefs = line.match(ISSUE_REF_PATTERN) || [];
            issueRefs.forEach(ref => {
              if (!projectsMap[key].sessions.includes(ref)) {
                projectsMap[key].sessions.push(ref);
              }
            });
          }
        }

        // Also check for direct issue references
        const issueRefs = line.match(ISSUE_REF_PATTERN);
        if (issueRefs) {
          issueRefs.forEach(ref => {
            const issue = issueMap[ref];
            if (issue && issue.status === 'active') {
              const key = `issue-${ref}`.toLowerCase();

              if (!projectsMap[key]) {
                projectsMap[key] = {
                  name: issue.title,
                  first_seen: issue.created || fileDate,
                  last_seen: fileDate,
                  discussion_count: 1,
                  status: issue.status,
                  sessions: [ref],
                  issue_id: ref.replace('#', ''),
                  priority: issue.priority,
                  progress: issue.progress
                };
              } else {
                projectsMap[key].last_seen = fileDate;
                projectsMap[key].discussion_count++;
                if (!projectsMap[key].sessions.includes(ref)) {
                  projectsMap[key].sessions.push(ref);
                }
              }
            }
          });
        }
      });
    } catch (e) {
      log(`⚠️ Error reading ${filePath}: ${e.message}`);
    }
  });

  // Enrich with issue data
  Object.values(projectsMap).forEach(project => {
    if (project.sessions) {
      project.sessions.forEach(ref => {
        const issue = issueMap[ref];
        if (issue) {
          project.priority = project.priority || issue.priority;
          project.progress = project.progress || issue.progress;
          if (!project.status || project.status === 'active') {
            project.status = issue.status;
          }
        }
      });
    }
  });

  return Object.values(projectsMap);
}

function generateOutput(projects) {
  return {
    last_updated: getHKTDateTime(),
    projects: projects.sort((a, b) => b.discussion_count - a.discussion_count)
  };
}

function main() {
  console.log('\n🔍 === Pattern Project Tracker ===\n');
  log('Starting project tracking analysis...');
  log('Dry run:', DRY_RUN ? 'YES (no files will be written)' : 'NO');

  ensurePatternsDir();

  const projects = analyzeProjects();
  const output = generateOutput(projects);

  console.log('\n📊 Results:');
  console.log(`   Total projects tracked: ${output.projects.length}`);

  output.projects.slice(0, 10).forEach(proj => {
    const statusEmoji = proj.status === 'completed' ? '✅' :
                        proj.status === 'paused' ? '⏸️' :
                        proj.status === 'active' ? '🔄' : '📌';
    console.log(`   ${statusEmoji} ${proj.name}`);
    console.log(`      Discussions: ${proj.discussion_count} | Last: ${proj.last_seen} | Status: ${proj.status}`);
  });

  if (!DRY_RUN) {
    const tmpFile = OUTPUT_FILE + '.tmp';
    try {
      fs.writeFileSync(tmpFile, JSON.stringify(output, null, 2));
      fs.renameSync(tmpFile, OUTPUT_FILE);
    } catch (e) {
      console.error('⚠️ File write failed: ' + e.message);
      return;
    }
    log(`\n✅ Written to ${OUTPUT_FILE}`);
  } else {
    log('\n🔍 [DRY-RUN] Would write output');
  }

  return output;
}

main();
