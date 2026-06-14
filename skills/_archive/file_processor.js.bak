/**
 * Skill: File Processor
 * 功能: 檔案讀寫、處理
 */

const SKILL = {
  name: "file_processor",
  keywords: ["file", "檔案", "read", "write", "處理", "打開", "save"],
  intents: ["read_file", "write_file", "處理檔案", "save_file"],
  description: "讀寫、處理檔案"
};

function readFile(filePath) {
  return {
    skill: "file_processor",
    action: "read",
    path: filePath,
    message: `📖 Reading file: ${filePath}`
  };
}

function writeFile(filePath, content) {
  return {
    skill: "file_processor",
    action: "write",
    path: filePath,
    message: `💾 Writing to: ${filePath}`
  };
}

function processFile(filePath, operation) {
  return {
    skill: "file_processor",
    action: operation,
    path: filePath,
    message: `⚙️ Processing: ${filePath} (${operation})`
  };
}

module.exports = { skill: SKILL, readFile, writeFile, processFile };
