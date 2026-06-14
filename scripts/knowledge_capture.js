#!/usr/bin/env node
/**
 * knowledge_capture.js
 * Capture knowledge (preferences/decisions/people) and auto-update
 * cross_session_bootstrap output.
 *
 * Usage:
 *   node scripts/knowledge_capture.js preference "label" "content"
 *   node scripts/knowledge_capture.js decision "deploy-2026-05" "Use Docker in Phase 2"
 *   node scripts/knowledge_capture.js people "Desanna" "Phone: +852XXXXXX"
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const KNOWLEDGE_DIR = path.join(process.env.HOME, ".openclaw/workspace/memory/knowledge");

const CATEGORIES = {
  preference: { dir: "preferences", label: "偏好設定" },
  decision: { dir: "decisions", label: "重要決定" },
  people: { dir: "people", label: "人物關係" }
};

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    console.error(`Error creating directory ${dir}: ${e.message}`);
    process.exit(1);
  }
}

function capture(categoryKey, label, content) {
  const cat = CATEGORIES[categoryKey];
  if (!cat) {
    console.error("Error: Unknown category. Use: preference, decision, people");
    process.exit(1);
  }

  const catDir = path.join(KNOWLEDGE_DIR, cat.dir);
  ensureDir(catDir);

  const filename = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + ".md";
  const filePath = path.join(catDir, filename);

  const timestamp = new Date().toISOString().split("T")[0];
  const contentParts = content.split("|").map(s => s.trim());

  let md = `# ${label}\n\n`;
  md += `> Created: ${timestamp}\n\n`;
  contentParts.forEach(part => {
    md += `- ${part}\n`;
  });
  md += "\n";

  try {
    fs.writeFileSync(filePath, md, "utf8");
  } catch (e) {
    console.error(`Error writing ${filePath}: ${e.message}`);
    process.exit(1);
  }
  console.log(`✅ Saved: ${categoryKey}/${filename}`);

  // Auto-update cross_session_bootstrap
  try {
    execSync("node " + path.join(process.env.HOME, ".openclaw/workspace/scripts/cross_session_bootstrap.js") + " --quiet", {
      timeout: 10000
    });
    console.log("✅ Cross-session context updated");
  } catch (e) {
    console.error("Warning: Failed to update context: " + e.message);
  }
}

// CLI
const args = process.argv.slice(2);
if (args.length < 3) {
  console.log("Usage:");
  console.log("  node scripts/knowledge_capture.js <category> <label> <content>");
  console.log("");
  console.log("Categories: preference, decision, people");
  console.log("");
  console.log("Examples:");
  console.log('  node scripts/knowledge_capture.js preference "report-format" "Excel: 置中, 自動欄寬, 標題加粗"');
  console.log('  node scripts/knowledge_capture.js decision "gem-project" "使用Node.js + SQLite"');
  console.log('  node scripts/knowledge_capture.js people "Desanna" "Phone: +852XXXXXX | Role: 合作夥伴"');
  process.exit(1);
}

capture(args[0], args[1], args[2]);
