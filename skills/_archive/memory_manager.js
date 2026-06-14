/**
 * Skill: Memory Manager
 * 功能: 儲存/回憶記憶
 */

const SKILL = {
  name: "memory_manager",
  keywords: ["remember", "記住", "memory", "記憶", "save", "記錄"],
  intents: ["save_memory", "recall", "儲存記憶", "回憶", "記住呢樣嘢"],
  description: "儲存/回憶記憶"
};

function saveMemory(content, tags = []) {
  return {
    skill: "memory_manager",
    action: "save",
    content: content?.substring(0, 100),
    tags: tags,
    message: `💾 Memory saved${tags.length ? ' with tags: ' + tags.join(', ') : ''}`
  };
}

function recallMemory(query) {
  return {
    skill: "memory_manager",
    action: "recall",
    query: query,
    message: `🔍 Searching memory: "${query}"`
  };
}

function listMemories(filter = {}) {
  return {
    skill: "memory_manager",
    action: "list",
    filter: filter,
    message: "📋 Listing memories..."
  };
}

module.exports = { skill: SKILL, saveMemory, recallMemory, listMemories };
