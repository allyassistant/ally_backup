/**
 * Skill: Learning Processor
 * 功能: 從內容中學習、提取要點
 */

const SKILL = {
  name: "learning_processor",
  keywords: ["learn", "學習", "extract", "提炼", "summary", "學嘢"],
  intents: ["learn_from_content", "extract_key_points", "總結"],
  description: "從內容中學習、提取要點"
};

function learnFromContent(content) {
  return {
    skill: "learning_processor",
    action: "learn",
    contentLength: content?.length || 0,
    message: `🧠 Learning from content (${content?.length || 0} chars)`
  };
}

function extractKeyPoints(content) {
  return {
    skill: "learning_processor",
    action: "extract",
    contentLength: content?.length || 0,
    message: `📝 Extracting key points from content`
  };
}

function summarize(content, maxLength = 100) {
  return {
    skill: "learning_processor",
    action: "summarize",
    originalLength: content?.length || 0,
    maxLength: maxLength,
    message: `📚 Summarizing content (max ${maxLength} chars)`
  };
}

module.exports = { skill: SKILL, learnFromContent, extractKeyPoints, summarize };
