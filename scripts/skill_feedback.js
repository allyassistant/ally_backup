#!/usr/bin/env node
/**
 * skill_feedback.js — Record explicit skill usage feedback.
 *
 * Used by agents or humans to tell the skill matcher whether a suggested
 * skill was useful. Feedback is appended to .skill_usage_log.jsonl and
 * consumed offline by analyze_skill_usage.js.
 *
 * Usage:
 *   node scripts/skill_feedback.js --skill cron-troubleshooting --event used --task "my cron failed"
 *   node scripts/skill_feedback.js --skill email-drafting --event skipped --reason "score too low" --task "write email"
 */

'use strict';

const path = require('path');

// skill-auto-suggest is an ESM module; use dynamic import.
async function main() {
  const { recordSkillFeedback } = await import(path.join(__dirname, '../extensions/skill-auto-suggest/core.mjs'));

  const args = process.argv.slice(2);
  const skillIdx = args.indexOf('--skill');
  const eventIdx = args.indexOf('--event');
  const taskIdx = args.indexOf('--task');
  const reasonIdx = args.indexOf('--reason');

  const skill = skillIdx >= 0 ? args[skillIdx + 1] : '';
  const event = eventIdx >= 0 ? args[eventIdx + 1] : '';
  const task = taskIdx >= 0 ? args[taskIdx + 1] : '';
  const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : '';

  if (!skill || !event) {
    console.error('Usage: node scripts/skill_feedback.js --skill <name> --event <used|skipped|rejected> [--task <text>] [--reason <text>]');
    process.exit(1);
  }

  if (!['used', 'skipped', 'rejected'].includes(event)) {
    console.error(`Invalid event: ${event}. Must be used, skipped, or rejected.`);
    process.exit(1);
  }

  await recordSkillFeedback({ event, skill, task, reason });
  console.log(`✅ Recorded ${event} feedback for "${skill}"`);
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
