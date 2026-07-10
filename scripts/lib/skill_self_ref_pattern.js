'use strict';

/**
 * scripts/lib/skill_self_ref_pattern.js
 *
 * Shared self-reference regex for skill-pipeline meta-skills.
 *
 * Background: skill_reviewer_bot.js (pre-write) and
 * extensions/skill-auto-suggest/pre-emit-dedup.mjs (pre-cosine) each need to
 * block skill files whose name or description references the skill pipeline
 * itself. Without a shared constant the two regexes drift — the bot's 5-
 * pattern version missed 9 family names (per Sub-2 audit 2026-06-28), letting
 * `skill-reviewer-*, skills-reviewer-*, skill-validator-*` slip through.
 *
 * This module is the single source of truth. Both consumers require() it and
 * use the exported `SELF_REF_PATTERN` constant.
 *
 * Blocked family names (11 patterns):
 *   - skill-reviewer, skills-reviewer, skill reviewer, skill-reviwer (typo)
 *   - curator, self-improvement, bot-self
 *   - skill-validation, skill-validation-failure-cleanup
 *   - skill-curation, skill-quality, skill-audit, skill-pipeline
 *   - auto-skill, auto skill
 *   - m3-adversarial, m3-multi-angle, m3-subagent
 *
 * Match logic: case-insensitive substring; matches any of the literal
 * fragments above. Designed for cheap pre-check before the more expensive
 * cosine similarity pass.
 */

const SELF_REF_PATTERN = /(skill[\s-]?reviewer|skills[\s-]?reviewer|skill[\s-]?reviwer|curator|self[\s-]?improvement|bot[\s-]?self|skill[\s-]?validation|skill[\s-]?curation|skill[\s-]?quality|skill[\s-]?audit|skill[\s-]?pipeline|auto[\s-]?skill|auto[\s-]?skill[\s-]?pipeline|m3[\s-]?(adversarial|multi-angle|subagent))/i;

module.exports = { SELF_REF_PATTERN };
