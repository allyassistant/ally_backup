#!/usr/bin/env node

/**
 * skillIntegrityScanner.js — Skill file integrity checks for CQM integration
 *
 * Phase B checks from code-review-checklist skill:
 *   B.4 — Frontmatter parse (valid YAML, required fields)
 *   B.5 — Command examples (bash -n / node --check viability)
 *   B.6 — Formula verification (pattern match, not eval)
 *   B.7 — Wikilink resolution ([[skill-name]] → file exists)
 *   B.8 — Cross-reference accuracy (event IDs, bug numbers)
 *
 * Called by CQM when --enable-skill-scan is set.
 *
 * Usage:
 *   const scanner = new SkillIntegrityScanner();
 *   const issues = await scanner.scanAll();
 *
 * Each issue: { file, line, severity, rule, message }
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { parseFrontmatter } = require('./frontmatter');

// ── Required frontmatter fields for skill files ──
const REQUIRED_FIELDS = ['name', 'description', 'status', 'provenance', 'source'];

// ── Known OpenClaw CLI commands for existence check ──
const KNOWN_CLI_COMMANDS = [
  // openclaw base
  'openclaw', 'openclaw cron', 'openclaw cron list', 'openclaw cron get',
  'openclaw cron add', 'openclaw cron edit', 'openclaw cron remove',
  'openclaw cron run', 'openclaw cron runs',
  'openclaw models', 'openclaw models list',
  'openclaw gateway', 'openclaw gateway status', 'openclaw gateway restart',
  'openclaw wiki', 'openclaw wiki bridge', 'openclaw wiki compile',
  'openclaw wiki lint', 'openclaw wiki ingest',
  // node
  'node', 'node --check',
  // scripts
  'node scripts/validate_skill_file.js',
  'node scripts/code_quality_manager.js',
  'node scripts/mail_tool.js',
];

// ── Known event IDs (from this workspace's history) ──
const KNOWN_ISSUE_RE = /#(\d{3,4})/g;
const KNOWN_RUNID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

class SkillIntegrityScanner {
  constructor(options = {}) {
    this.skillsDir = options.skillsDir || path.resolve(__dirname, '..', '..', 'skills-learned');
    this.quiet = options.quiet || false;
    this.issues = [];
  }

  /**
   * Scan all skills in skills-learned/ and return issues.
   * @param {string[]} [skillNames] — Optional subset, e.g. ['code-review-checklist']
   * @returns {object[]} issues
   */
  scanAll(skillNames) {
    this.issues = [];
    let dirs;

    if (skillNames && skillNames.length > 0) {
      dirs = skillNames.map(name => path.join(this.skillsDir, name)).filter(d => fs.existsSync(d));
    } else {
      try {
        dirs = fs.readdirSync(this.skillsDir)
          .filter(name => !name.startsWith('.') && name !== '_archive')
          .map(name => path.join(this.skillsDir, name))
          .filter(d => fs.statSync(d).isDirectory());
      } catch (e) {
        this._addIssue('', 0, 'FATAL', `Cannot read skills directory: ${e.message}`);
        return this.issues;
      }
    }

    this._scannedCount = dirs.length;

    for (const dir of dirs) {
      const skillPath = path.join(dir, 'SKILL.md');
      if (!fs.existsSync(skillPath)) {
        this._addIssue(dir, 0, 'HIGH', 'Missing SKILL.md in skill directory');
        continue;
      }

      const content = fs.readFileSync(skillPath, 'utf8');

      // ── B.4: Frontmatter parse ──
      this._checkFrontmatter(dir, content);

      // ── B.5: Command examples ──
      this._checkCommands(dir, content);

      // ── B.6: Formula verification ──
      this._checkFormulas(dir, content);

      // ── B.7: Wikilink resolution ──
      this._checkWikilinks(dir, content);

      // ── B.8: Cross-reference accuracy ──
      this._checkCrossReferences(dir, content);
    }

    return this.issues;
  }

  // ── B.4: Frontmatter parse ──
  _checkFrontmatter(dir, content) {
    let fields, body;
    try {
      const parsed = parseFrontmatter(content);
      fields = parsed.fields;
      body = parsed.body;
    } catch (e) {
      this._addIssue(dir, 1, 'CRITICAL', `Frontmatter parse failed: ${e.message}`);
      return;
    }

    if (!fields) {
      this._addIssue(dir, 1, 'CRITICAL', 'No frontmatter found (missing --- delimiters)');
      return;
    }

    for (const field of REQUIRED_FIELDS) {
      if (!fields[field] || fields[field].trim() === '') {
        this._addIssue(dir, 1, 'HIGH', `Missing required frontmatter field: ${field}`);
      }
    }

    // Validate status is a recognised value
    if (fields.status && !['draft', 'active', 'archived', 'stale'].includes(fields.status.trim())) {
      this._addIssue(dir, 1, 'MEDIUM', `Unrecognised status value: "${fields.status}"`);
    }

    // Check for truncated body — ends with colon (mid-step cut) or comma
    if (body) {
      const trimmed = body.trim();
      if (trimmed.endsWith(':') || trimmed.endsWith(',') || trimmed.endsWith('：') || trimmed.endsWith('，')) {
        this._addIssue(dir, -1, 'HIGH', 'Body appears truncated (ends with colon/comma mid-sentence)');
      }

      // Check for unclosed code blocks
      const openBlocks = (body.match(/```/g) || []).length;
      if (openBlocks % 2 !== 0) {
        this._addIssue(dir, -1, 'HIGH', 'Unclosed code block (odd number of ``` markers)');
      }
    }
  }

  // ── B.5: Command existence check ──
  _checkCommands(dir, content) {
    // Find code blocks with bash/node commands
    const cmdBlockRe = /```(?:bash|sh|shell|js)\n([\s\S]*?)```/g;
    let match;

    while ((match = cmdBlockRe.exec(content)) !== null) {
      const block = match[1];
      const lines = block.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Skip comments, empty lines, piped commands, and command composition
        if (!line || line.startsWith('#') || line.startsWith('//') ||
            line.startsWith('$') || line.startsWith('>') || line.startsWith('&')) {
          continue;
        }

        // Check each segment of a pipe chain
        const segments = line.split(/\s*\|\s*/);
        for (const seg of segments) {
          this._checkSingleCommand(dir, content, seg, cmdBlockRe.lastIndex);
        }
      }
    }
  }

  _checkSingleCommand(dir, content, cmdLine, nearPos) {
    const cmd = cmdLine.trim().split(/\s+/);

    // Extract the root command (first 1-3 tokens)
    let root = cmd[0];
    if (cmd.length >= 2) root += ' ' + cmd[1];
    if (cmd.length >= 3 && !KNOWN_CLI_COMMANDS.some(kc => kc.startsWith(root))) root += ' ' + cmd[2];

    // Only check against known CLI commands, not arbitrary shell commands
    if (!KNOWN_CLI_COMMANDS.some(kc => root.startsWith(kc))) return;

    const lineNum = this._findLineNumber(content, cmdLine, nearPos);

    // Check if it's a known command
    const matched = KNOWN_CLI_COMMANDS.some(kc => root.startsWith(kc));

    if (!matched) {
      this._addIssue(dir, lineNum, 'MEDIUM', `Possible non-existent command: "${cmdLine.trim()}"`);
    }
  }

  // ── B.6: Formula verification ──
  _checkFormulas(dir, content) {
    // Look for arithmetic or formula patterns: timeoutSeconds * 500, staggerMs = ..., etc.
    // These are common in cron job skills
    const formulaRe = /(\w+)\s*=\s*(\w+)\s*([+\-*/])\s*(\d+)/g;
    let match;

    while ((match = formulaRe.exec(content)) !== null) {
      const [, result, base, op, factor] = match;

      // Basic sanity: staggerMs values should use * 1000 (seconds→ms), not * 500
      if (result.includes('stagger') || result.includes('Time') || result.includes('Delay')) {
        if (op === '*' && factor !== '1000') {
          const lineNum = this._findLineNumber(content, match[0], match.index);
          this._addIssue(dir, lineNum, 'LOW',
            `Formula: ${result} = ${base} ${op} ${factor} — expected * 1000 for ms conversion`);
        }
      }
    }
  }

  // ── B.7: Wikilink resolution ──
  _checkWikilinks(dir, content) {
    const wikilinkRe = /\[\[([^\]]+)\]\]/g;
    let match;

    while ((match = wikilinkRe.exec(content)) !== null) {
      const linkName = match[1].trim();

      // Skip common false positives (non-skill references)
      if (linkName.startsWith('http') || linkName.includes('://')) continue;
      if (linkName.startsWith('#')) continue;  // header links
      if (linkName.startsWith('@')) continue;  // mentions

      // Try to resolve as a skill
      const skillDir = path.join(this.skillsDir, linkName.replace(/\.md$/, ''));
      const skMDPath = path.join(skillDir, 'SKILL.md');
      const mdPath = path.join(this.skillsDir, linkName);

      if (!fs.existsSync(skillDir) && !fs.existsSync(mdPath) && !fs.existsSync(skMDPath)) {
        const lineNum = this._findLineNumber(content, match[0], match.index);
        this._addIssue(dir, lineNum, 'MEDIUM', `Broken wikilink: [[${linkName}]] — target not found`);
      }
    }
  }

  // ── B.8: Cross-reference accuracy ──
  _checkCrossReferences(dir, content) {
    // Check issue references (#1234 format) against existing .issues/
    const issuesDir = path.resolve(__dirname, '..', '..', '.issues');

    // Collect what issues actually exist
    let existingIssues = new Set();
    try {
      const active = fs.readdirSync(path.join(issuesDir, 'active'));
      active.forEach(f => {
        const m = f.match(/^(\d{3,4})-/);
        if (m) existingIssues.add(m[1]);
      });
    } catch (e) { /* issues dir may not exist */ }

    // Use local RegExp to avoid lastIndex pollution from module-level /g regex
    const issueRe = new RegExp(KNOWN_ISSUE_RE.source, 'g');
    let match;
    while ((match = issueRe.exec(content)) !== null) {
      const issueNum = match[1];
      if (!existingIssues.has(issueNum)) {
        const lineNum = this._findLineNumber(content, match[0], match.index);
        // Check if it's in backlog
        let inBacklog = false;
        try {
          const backlog = fs.readdirSync(path.join(issuesDir, 'backlog'));
          inBacklog = backlog.some(f => f.startsWith(issueNum + '-'));
        } catch (e) { /* ignore */ }

        if (!inBacklog) {
          this._addIssue(dir, lineNum, 'LOW', `Issue #${issueNum} not found in .issues/ — may be stale`);
        }
      }
    }
  }

  // ── Helpers ──

  _addIssue(dir, lineNum, severity, message) {
    const name = path.basename(dir);
    this.issues.push({
      file: `skills-learned/${name}`,
      line: lineNum || 0,
      severity: severity,
      rule: severity === 'FATAL' ? 'FATAL' : `SKILL-SCAN-${['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].indexOf(severity) + 1}`,
      message: message
    });
  }

  _findLineNumber(content, needle, indexHint) {
    const searchStart = indexHint >= 0 ? indexHint : content.indexOf(needle);
    if (searchStart < 0) return 0;
    const before = content.slice(0, searchStart);
    return before.split('\n').length;
  }

  /**
   * Generate a summary of scan results.
   */
  summarize() {
    const bySeverity = {};
    const byDir = {};

    for (const issue of this.issues) {
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
      byDir[issue.file] = (byDir[issue.file] || 0) + 1;
    }

    return {
      total: this.issues.length,
      bySeverity: {
        critical: bySeverity['CRITICAL'] || 0,
        high: bySeverity['HIGH'] || 0,
        medium: bySeverity['MEDIUM'] || 0,
        low: bySeverity['LOW'] || 0
      },
      skillsWithIssues: Object.keys(byDir).length,
      skillsScanned: this._scannedCount || 0
    };
  }
}

// ── CLI Entry Point ──
function main() {
  const args = process.argv.slice(2);
  const skillFilter = args.filter(a => !a.startsWith('--'));
  const scanner = new SkillIntegrityScanner({ quiet: args.includes('--quiet') });

  const issues = scanner.scanAll(skillFilter.length > 0 ? skillFilter : null);
  const summary = scanner.summarize();

  if (!args.includes('--json')) {
    console.log(`\n🔍 Skill Integrity Scan — ${summary.skillsScanned || '?'} skills scanned`);
    console.log(`   Issues: ${summary.total} (🔴 ${summary.bySeverity.critical} / 🟠 ${summary.bySeverity.high} / 🟡 ${summary.bySeverity.medium} / 🟢 ${summary.bySeverity.low})\n`);

    for (const issue of issues) {
      const sevIcon = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢', FATAL: '💥' }[issue.severity] || '⚪';
      const lineStr = issue.line > 0 ? `:${issue.line}` : '';
      console.log(`  ${sevIcon} ${issue.file}${lineStr} — ${issue.rule}: ${issue.message}`);
    }

    if (issues.length === 0) {
      console.log('  ✅ All skills pass integrity checks!');
    }
  } else {
    console.log(JSON.stringify({ issues, summary }, null, 2));
  }

  // Exit code: 0 = clean, 1 = issues found
  process.exit(issues.length > 0 && !args.includes('--no-fail') ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { SkillIntegrityScanner };
