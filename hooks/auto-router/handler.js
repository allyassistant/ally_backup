/**
 * Auto Router Handler
 *
 * Fires on every message:preprocessed event.
 * Classifies the incoming message and logs routing decision.
 *
 * This is the REAL auto-fire mechanism — OpenClaw guarantees
 * this handler runs for every incoming message.
 */

const path = require('path');

// Resolve paths relative to workspace
const WORKSPACE = path.join(process.env.HOME, '.openclaw', 'workspace');

module.exports = async (event) => {
  // Only process user messages with text content
  if (!event?.message?.text) return;

  const text = event.message.text;

  try {
    // Dynamically require to avoid module path issues
    const classifierPath = path.join(WORKSPACE, 'scripts', 'router', 'classifier');
    const { classifySync, logDecision } = require(classifierPath);

    const result = classifySync(text);

    // Build metadata from event
    const metadata = { source: 'auto-router' };
    if (event?.message?.channel) metadata.channel = event.message.channel;
    if (event?.message?.author?.id) metadata.authorId = event.message.author.id;
    if (event?.guild?.id) metadata.guildId = event.guild.id;

    logDecision(result, text, metadata);
  } catch (error) {
    // Silent fail — don't break message processing
    console.error('[auto-router] classify error:', error.message);
  }
};
