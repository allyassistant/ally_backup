#!/usr/bin/env node
/**
 * shl-noise-sanity.mjs
 *
 * Verify the new magic-number regex (6+ digits, non-literal) correctly
 * suppresses false positives while keeping real magic numbers flaggable.
 *
 * Run:
 *   node ~/.openclaw/workspace/scripts/shl-noise-sanity.mjs
 *
 * Exit code 0 = all expectations met, 1 = surprise.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const VERIFY_SCRIPT = "/Users/ally/.openclaw/workspace/scripts/verify_edit.js";

// Each case: { label, source, expectedIssues: [substring that MUST appear in output]
//                              mustNotContain: [substring that MUST NOT appear in output] }
const CASES = [
  {
    label: "NS-1 Discord snowflake in single quotes (was noise)",
    source: `const channel = '1473376125584670872';\n`,
    mustContain: [],
    mustNotContain: ["Magic numbers", "1473376125584670872"],
  },
  {
    label: "NS-2 Discord snowflake in double quotes (was noise)",
    source: `const channel = "1473376125584670872";\n`,
    mustContain: [],
    mustNotContain: ["Magic numbers", "1473376125584670872"],
  },
  {
    label: "NS-3 Color hex literal (was noise)",
    source: `const COLOR = '#133';\nconst FOO = 1;\n`,
    mustContain: [],
    mustNotContain: ["Magic numbers", "133"],
  },
  {
    label: "NS-4 Color hex mid-line (was noise)",
    source: `function paint() { return '#154'; }\n`,
    mustContain: [],
    mustNotContain: ["Magic numbers", "154"],
  },
  {
    label: "NS-5 5-digit timeout in string (was noise)",
    source: `const TIMEOUT = '60000';\n`,
    mustContain: [],
    mustNotContain: ["Magic numbers", "60000"],
  },
  {
    label: "NS-6 5-digit raw number in code (below new threshold, not flagged)",
    source: `function wait() { return 60000; }\n`,
    mustContain: [],
    mustNotContain: ["Magic numbers", "60000"],
  },
  {
    label: "REAL-1 6-digit magic number in code (must flag)",
    source: `function f() { return 123456; }\n`,
    mustContain: ["Magic numbers", "123456"],
    mustNotContain: [],
  },
  {
    label: "REAL-2 7-digit magic number, raw (must flag)",
    source: `function f() { return 2013250; }\n`,
    mustContain: ["Magic numbers", "2013250"],
    mustNotContain: [],
  },
  {
    label: "REAL-3 18-digit raw number outside string (must flag)",
    source: `const ID = 1473376125584670872;\n`,
    mustContain: ["Magic numbers", "1473376125584670872"],
    mustNotContain: [],
  },
  {
    label: "REAL-4 18-digit in backticks (template literal) — must skip",
    source: "const tpl = `id is ${1473376125584670872}`;\n",
    mustContain: [],
    mustNotContain: ["Magic numbers", "1473376125584670872"],
  },
];

// Build a single test file that imports all cases as separate lines,
// run verify_edit.js on it, and verify the output.
const tmpDir = mkdtempSync(path.join(os.tmpdir(), "shl-noise-"));
const tmpFile = path.join(tmpDir, "noise-fixture.js");

const sections = [];
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  // Wrap each case in a marker function so verify_edit.js scans line-by-line
  sections.push(`// ===== CASE ${i + 1}: ${c.label} =====`);
  sections.push(c.source);
}
writeFileSync(tmpFile, sections.join("\n"));

console.log(`Running verify_edit.js against ${tmpFile} ...\n`);
const res = spawnSync("node", [VERIFY_SCRIPT, tmpFile], { encoding: "utf8" });
const stdout = res.stdout || "";
rmSync(tmpDir, { recursive: true, force: true });

let surprises = 0;
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  const ok = (cond) => (cond ? "✓" : "✗");

  // mustContain
  let mustOk = true;
  for (const substr of c.mustContain) {
    if (!stdout.includes(substr)) {
      console.log(`  ✗ ${c.label}\n     missing in output: "${substr}"`);
      mustOk = false;
      surprises++;
    }
  }
  // mustNotContain
  let mustNotOk = true;
  for (const substr of c.mustNotContain) {
    if (stdout.includes(substr)) {
      console.log(`  ✗ ${c.label}\n     should NOT contain: "${substr}"`);
      mustNotOk = false;
      surprises++;
    }
  }
  if (mustOk && mustNotOk) {
    console.log(`  ✓ ${c.label}`);
  }
}

console.log(`\nSurprises: ${surprises}`);
console.log(`\n=== Raw verify output (relevant portion) ===`);
const filteredLines = stdout
  .split("\n")
  .filter((l) => l.includes("🚨") || l.includes("Magic") || l.includes("P0") || l.includes("P1") || l.includes("error") || l.includes("ERROR"));
if (filteredLines.length === 0) {
  console.log("  (no magic-number or P0 issues flagged — clean)");
} else {
  for (const l of filteredLines) console.log(`  ${l}`);
}

process.exit(surprises === 0 ? 0 : 1);
