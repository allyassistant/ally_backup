/**
 * OpenClaw Hook: message:received
 *
 * 當收到新消息時：
 * 1. 觸發 auto_remember（原有功能，保留不變）
 * 2. Router classifier 做 routing decision（新增功能）
 *
 * 非阻塞：使用 setImmediate 避免 block 消息處理流程
 * 錯誤隔離：所有操作包 try-catch
 */

const { detectAndCreate } = require('../auto_remember');
const { classifySync, logDecision } = require('../router/classifier');
const config = require('../router/config');

// Proof marker: write to /tmp every time this hook fires
const fs = require('fs');
try { fs.appendFileSync('/tmp/hook_fired.log', new Date().toISOString() + '\n'); } catch {}

// Pre-compile trigger pattern for auto_remember
const TRIGGER_PATTERN = /(?:記住|記得|唔好忘記|記低|請記住|要做|跟進|任務|行動|規則係|bug|錯誤|失敗|崩潰)/i;

module.exports = async (event) => {
  // Only process user messages with text content
  if (!event?.message?.text) return;

  const text = event.message.text;

  // ───原有功能：auto_remember（完全保留）──────────────────
  if (TRIGGER_PATTERN.test(text)) {
    setImmediate(async () => {
      try {
        await detectAndCreate(text);
      } catch (error) {
        console.error('[message-received hook] auto_remember error:', error.message);
      }
    });
  }

  // ───新增功能：Router Classifier─────────────────────────
  // Non-blocking classification for every message
  // Uses classifySync (regex only, ~1ms). LLM classify is too heavy for hook.
  setImmediate(() => {
    try {
      const result = classifySync(text);

      // Build metadata from event (safely access properties)
      const metadata = {};
      if (event?.message?.channel) metadata.channel = event.message.channel;
      if (event?.message?.author?.id) metadata.authorId = event.message.author.id;
      if (event?.guild?.id) metadata.guildId = event.guild.id;

      // Log to decision_log.jsonl (append-only JSON Lines)
      logDecision(result, text, metadata);

      // If OpenClaw supports event.message.metadata, expose routing result
      // Otherwise log to console as fallback
      if (event?.message?.metadata && typeof event.message.metadata === 'object') {
        event.message.metadata.routing = {
          route: result.route,
          matched: result.matched,
          rule: result.rule,
          classifiedAt: new Date().toISOString(),
        };
      } else {
        // Fallback: console.log (does not interfere with message processing)
        console.log(`[router] route=${result.route} matched=${result.matched} rule="${result.rule}"`);
      }
    } catch (error) {
      console.error('[message-received hook] router error:', error.message);
    }
  });
};
