#!/usr/bin/env node
/**
 * cqm_confidence.js — Centralized confidence thresholding for CQM auto-fix
 *
 * Part of the Safe Auto-Fix Architecture (#189 Phase 4):
 * - Defines confidence tiers (HIGH/MEDIUM/LOW)
 * - Routes fixes based on confidence score
 * - Used by auto_fix.js and auto_repair.js
 */

/**
 * Confidence tiers with repair strategies
 */
const CONFIDENCE_TIERS = {
  HIGH: {
    threshold: 0.90,
    action: 'auto_fix',
    description: 'Auto-fix without human review'
  },
  MEDIUM: {
    threshold: 0.70,
    action: 'quarantine',
    description: 'Write to quarantine, require human review'
  },
  LOW: {
    threshold: 0.0,
    action: 'skip',
    description: 'Skip and learn pattern'
  }
};

/**
 * Determine the action for a given confidence score
 * @param {number} confidence - Confidence score (0.0 - 1.0)
 * @returns {object} - { tier, action, description }
 */
function getConfidenceTier(confidence) {
  if (confidence >= CONFIDENCE_TIERS.HIGH.threshold) {
    return {
      tier: 'HIGH',
      action: CONFIDENCE_TIERS.HIGH.action,
      description: CONFIDENCE_TIERS.HIGH.description,
      confidence
    };
  } else if (confidence >= CONFIDENCE_TIERS.MEDIUM.threshold) {
    return {
      tier: 'MEDIUM',
      action: CONFIDENCE_TIERS.MEDIUM.action,
      description: CONFIDENCE_TIERS.MEDIUM.description,
      confidence
    };
  } else {
    return {
      tier: 'LOW',
      action: CONFIDENCE_TIERS.LOW.action,
      description: CONFIDENCE_TIERS.LOW.description,
      confidence
    };
  }
}

/**
 * Filter issues by confidence tier
 * @param {Array} issues - Array of issues with confidence scores
 * @param {string} minTier - Minimum tier to include ('HIGH', 'MEDIUM', 'LOW')
 * @returns {object} - { high, medium, low }
 */
function categorizeByConfidence(issues, minTier = 'MEDIUM') {
  const result = {
    high: [],
    medium: [],
    low: []
  };

  for (const issue of issues) {
    const confidence = issue.confidence || issue.metadata?.confidence || 0;
    const tier = getConfidenceTier(confidence);

    if (tier.tier === 'HIGH') {
      result.high.push({ ...issue, _tier: tier });
    } else if (tier.tier === 'MEDIUM') {
      result.medium.push({ ...issue, _tier: tier });
    } else {
      result.low.push({ ...issue, _tier: tier });
    }
  }

  // Filter based on minTier
  if (minTier === 'HIGH') {
    return { high: result.high, medium: [], low: [] };
  } else if (minTier === 'MEDIUM') {
    return { high: result.high, medium: result.medium, low: [] };
  }

  return result;
}

/**
 * Get default minimum confidence from environment or config
 */
function getDefaultMinConfidence() {
  return parseFloat(process.env.CQM_MIN_CONFIDENCE || '0.90');
}

/**
 * CLI entry point
 */
function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
cqm_confidence.js — Confidence thresholding for CQM auto-fix

Usage:
  node cqm_confidence.js --confidence <0.0-1.0>
  node cqm_confidence.js --categorize <file.json>

Options:
  --confidence <n>    Show tier for a confidence score
  --categorize <f>    Categorize issues from a JSON file
  --default           Show default minimum confidence

Tiers:
  HIGH (≥0.90):   Auto-fix without human review
  MEDIUM (0.70-0.89): Write to quarantine, require human review
  LOW (<0.70):    Skip and learn pattern
`);
    process.exit(0);
  }

  if (args.includes('--default')) {
    const defaultConf = getDefaultMinConfidence();
    console.log(`Default min confidence: ${defaultConf}`);
    process.exit(0);
  }

  const confIdx = args.indexOf('--confidence');
  if (confIdx !== -1 && args[confIdx + 1]) {
    const confidence = parseFloat(args[confIdx + 1]);
    const tier = getConfidenceTier(confidence);
    console.log(`Confidence: ${confidence}`);
    console.log(`Tier: ${tier.tier}`);
    console.log(`Action: ${tier.action}`);
    console.log(`Description: ${tier.description}`);
    process.exit(0);
  }

  const catIdx = args.indexOf('--categorize');
  if (catIdx !== -1 && args[catIdx + 1]) {
    const fs = require('fs');
    let data;
    try {
      data = fs.readFileSync(args[catIdx + 1], 'utf8');
    } catch (e) {
      console.error(`File read failed: ${e.message}`);
    }
    const issues = data.merged || data.verified || data.issues || [];
    const categorized = categorizeByConfidence(issues);

    console.log(`Total issues: ${issues.length}`);
    console.log(`  HIGH:   ${categorized.high.length}`);
    console.log(`  MEDIUM: ${categorized.medium.length}`);
    console.log(`  LOW:    ${categorized.low.length}`);

    // Show breakdown
    if (categorized.high.length > 0) {
      console.log('\nHIGH confidence (will auto-fix):');
      for (const issue of categorized.high.slice(0, 5)) {
        console.log(`  - ${issue.file}:${issue.line} — ${issue.title || issue.message} (${issue._tier.confidence.toFixed(2)})`);
      }
    }

    if (categorized.medium.length > 0) {
      console.log('\nMEDIUM confidence (will quarantine):');
      for (const issue of categorized.medium.slice(0, 5)) {
        console.log(`  - ${issue.file}:${issue.line} — ${issue.title || issue.message} (${issue._tier.confidence.toFixed(2)})`);
      }
    }

    if (categorized.low.length > 0) {
      console.log('\nLOW confidence (will skip):');
      for (const issue of categorized.low.slice(0, 5)) {
        console.log(`  - ${issue.file}:${issue.line} — ${issue.title || issue.message} (${issue._tier.confidence.toFixed(2)})`);
      }
    }

    process.exit(0);
  }

  console.error('Usage: cqm_confidence.js [--confidence <n>] [--categorize <file.json>] [--default] [--help]');
  process.exit(1);
}

module.exports = {
  CONFIDENCE_TIERS,
  getConfidenceTier,
  categorizeByConfidence,
  getDefaultMinConfidence
};

if (require.main === module) {
  main();
}
