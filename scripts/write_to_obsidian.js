#!/usr/bin/env node
/**
 * write_to_obsidian.js - Directly write a note to Obsidian vault
 *
 * Usage:
 *   node scripts/write_to_obsidian.js \
 *     --title "Note Title" \
 *     --content "$(cat analysis.md || echo 'body text')" \
 *     --category AI \
 *     --tags "ai,agent,analysis" \
 *     --links "[[Related Note]],[[Another Note]]" \
 *     --source "X post / email / discussion"
 *
 * Or pipe:
 *   node scripts/write_to_obsidian.js --title "Title" --category AI << 'EOF'
 *   Body content...
 *   EOF
 *
 * Folder structure:
 *   ~/Documents/Obsidian Vault/
 *   ├── Knowledge/{AI,Business,Tech,Diamond,Concepts}/
 *   └── Projects/           (for project-specific notes, --category Project)
 *
 * Enrichment (auto):
 *   - Sanitize filename from title
 *   - Add import date frontmatter
 *   - Preserve existing tags if note already exists
 */

const fs = require('fs');
const path = require('path');

const VAULT = path.join(process.env.HOME, 'Documents', 'Obsidian Vault');
const OUTPUT_FOLDER = path.join(VAULT, '03-Output');

// ===== Category → folder mapping =====
const CATEGORY_FOLDERS = {
  'AI': 'Knowledge/AI',
  'Business': 'Knowledge/Business',
  'Tech': 'Knowledge/Tech',
  'Concept': 'Knowledge/Concepts',
  'Diamond': 'Knowledge/Diamond',
  'Project': 'Projects',
  'Daily': 'Daily',
};

// ===== Note types (from Dami-Defi's vault intelligence system) =====
const VALID_TYPES = ['observation', 'reaction', 'pattern', 'question', 'number', 'reference'];

const TYPE_DESCRIPTIONS = {
  observation: '留意到嘅嘢，未打磨（things I noticed, unpolished）',
  reaction: '對某事嘅 gut response（honest gut response to something）',
  pattern: '同一原理跨領域出現（same principle in two different domains）',
  question: '未解決嘅問題（things I genuinely do not know yet）',
  number: '真實數據點 + 來源（real data points with the source）',
  reference: '保存嘅內容未來用（saved content for future use）',
};

// ===== Parse args =====
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { title: '', body: '', category: 'AI', tags: [], links: [], source: '', connection: '', question: '', application: '' };

  let stdin;
  try {
    stdin = fs.readFileSync('/dev/stdin', 'utf-8').trim();
  } catch (e) {
    console.error(`File read failed: ${e.message}`);
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--title': parsed.title = args[++i] || 'Untitled'; break;
      case '--content': parsed.body = (args[++i] !== undefined) ? args[i] : stdin; break;
      case '--category': parsed.category = args[++i] || 'AI'; break;
      case '--type': parsed.ntype = (args[++i] || '').toLowerCase(); break;
      case '--tags': parsed.tags = (args[++i] || '').split(',').map(t => t.trim()).filter(Boolean); break;
      case '--links': parsed.links = (args[++i] || '').split(',').map(l => l.trim()).filter(Boolean); break;
      case '--source': parsed.source = args[++i] || ''; break;
      case '--connection': parsed.connection = args[++i] || ''; break;
      case '--question': parsed.question = args[++i] || ''; break;
      case '--application': parsed.application = args[++i] || ''; break;
    }
  }

  // If no --content, use stdin
  if (!parsed.body && stdin) parsed.body = stdin;

  return parsed;
}

// ===== Sanitize filename =====
function sanitizeFilename(title) {
  return title
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100) || 'untitled';
}

// ===== Main =====
function main() {
  const cfg = parseArgs();

  // Validate note type
  if (cfg.ntype && !VALID_TYPES.includes(cfg.ntype)) {
    console.error(`❌ Invalid --type: "${cfg.ntype}". Valid: ${VALID_TYPES.join(', ')}`);
    console.error('');
    console.error('  Type descriptions:');
    VALID_TYPES.forEach(t => console.error(`    ${t.padEnd(12)} ${TYPE_DESCRIPTIONS[t]}`));
    process.exit(1);
  }

  if (!cfg.title || cfg.title === 'Untitled') {
    console.error('❌ Usage: node write_to_obsidian.js --title "Title" --category AI [--type pattern] [--tags "ai,tech"] [--links "[[Note]]"]');
    console.error('   Or pipe: echo "body" | node write_to_obsidian.js --title "Title" --category AI');
    process.exit(1);
  }

  if (!cfg.body) {
    console.error('❌ No content provided. Use --content "..." or pipe via stdin.');
    process.exit(1);
  }

  // Determine folder
  const subfolder = CATEGORY_FOLDERS[cfg.category];
  const dir = subfolder ? path.join(VAULT, subfolder) : path.join(VAULT, 'Knowledge', cfg.category);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      console.error(`Directory creation failed: ${e.message}`);
    }
  }

  // Build filename
  const filename = sanitizeFilename(cfg.title) + '.md';
  const filepath = path.join(dir, filename);

  // Check if file exists already
  const exists = fs.existsSync(filepath);
  let existingTags = [];
  if (exists) {
    let existing;
    try {
      existing = fs.readFileSync(filepath, 'utf-8');
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
    const tagMatch = existing.match(/^tags: \[(.+)\]/m);
    if (tagMatch) existingTags = tagMatch[1].split(', ').filter(Boolean);
  }

  // Merge tags
  const allTags = ['wiki_direct', ...new Set([...existingTags, ...cfg.tags])];

  // Build wikilinks section
  let linksSection = '';
  if (cfg.links.length > 0) {
    linksSection = '\n---\n🔗 **相關筆記**\n' + cfg.links.map(l => `- ${l}`).join('\n') + '\n';
  }

  // Source line
  let sourceLine = '';
  if (cfg.source) {
    sourceLine = `\n📎 **來源：** ${cfg.source}\n`;
  }

  // Build note content
  const today = new Date().toISOString().split('T')[0];
  const noteTypeLine = cfg.ntype ? `type: ${cfg.ntype}` : '';
  const noteContent = `---
tags: [${allTags.join(', ')}]
created: ${today}
category: ${cfg.category}
${noteTypeLine}
${cfg.source ? `source: ${cfg.source}` : ''}
${cfg.connection ? `capture_connection: "${cfg.connection}"` : ''}
${cfg.question ? `capture_question: "${cfg.question}"` : ''}
${cfg.application ? `capture_application: "${cfg.application}"` : ''}
---

# ${cfg.title}

${cfg.body.trim()}
${cfg.connection || cfg.question || cfg.application ? '\n---\n## 捕獲\n' : ''}${cfg.connection ? '**Connection：** ' + cfg.connection + '\n\n' : ''}${cfg.question ? '**Question：** ' + cfg.question + '\n\n' : ''}${cfg.application ? '**Application：** ' + cfg.application + '\n' : ''}
${sourceLine}
${linksSection}

---
> 🖊️ 直接寫入 | ${today}${cfg.ntype ? ` | 類型: ${cfg.ntype}` : ''}
`;

  // Write
  const mode = exists ? '🔄 更新' : '✅ 新增';
  try {
    fs.writeFileSync(filepath, noteContent);
    const relPath = path.relative(VAULT, filepath);
    console.log(`${mode} ${relPath}`);

    // Save output copy
    const outputDir = path.join(OUTPUT_FOLDER, today.substring(0, 7)); // YYYY-MM
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Build output copy
    const noteType = cfg.ntype || 'analysis';
    const slug = sanitizeFilename(cfg.title).toLowerCase().replace(/\s+/g, '-').substring(0, 40);
    const outputFilename = today + '-' + noteType + '-' + slug + '.md';
    const outputPath = path.join(outputDir, outputFilename);

    // Dup handling: if exists, add -2, -3
    let outputFinalPath = outputPath;
    let dupCounter = 1;
    while (fs.existsSync(outputFinalPath)) {
      dupCounter++;
      outputFinalPath = path.join(outputDir, today + '-' + noteType + '-' + slug + '-' + dupCounter + '.md');
    }

    const outputContent = '---\ntitle: ' + cfg.title + '\ndate: ' + today + '\nsource: ' + (cfg.source || '') + '\ntags: [' + cfg.tags.join(', ') + ']\ntype: ' + noteType + '\n---\n\n' + cfg.body.trim();
    try {
      fs.writeFileSync(outputFinalPath, outputContent);
    } catch (e) {
      console.error(`File write failed: ${e.message}`);
    }
    const outputRelPath = path.relative(VAULT, outputFinalPath);
    console.log('📤 Output copy: ' + outputRelPath);

    process.exit(0);
  } catch (e) {
    console.error(`❌ Write error: ${e.message}`);
    process.exit(1);
  }
}

main();
