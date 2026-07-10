#!/usr/bin/env node
/**
 * shl-rule-audit.mjs
 *
 * Isolated unit test that requires LOW_RISK_RULES directly (no plugin host)
 * and reports detect()/fix() behavior on real cases pulled from the SHL
 * telemetry log.
 *
 * Run:
 *   node ~/.openclaw/workspace/scripts/shl-rule-audit.mjs
 *
 * Output: structured report per rule + per case. Exit code = 0 if no
 * surprises, 1 if any case produces unexpected output.
 *
 * Why this exists:
 *   - SHL telemetry shows 0 `fixes_applied` events despite 46 enqueues.
 *   - Hypothesis: rule coverage does not match verify_edit.js error output.
 *   - This script proves/disproves by running each rule against known
 *     inputs pulled from real telemetry samples.
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { LOW_RISK_RULES } = require("./lib/rules/low-risk.js");

// ── Test harness ───────────────────────────────────────────────────────────
let totalCases = 0;
let surprises = 0;
const results = [];

function record(ruleId, caseName, expected, actual, ok) {
  totalCases++;
  if (!ok) surprises++;
  results.push({ ruleId, caseName, expected, actual, ok });
}

function runCase({ ruleId, name, input, expectDetect, expectFixChanged }) {
  const rule = LOW_RISK_RULES.find((r) => r.id === ruleId);
  if (!rule) {
    record(ruleId, name, "rule to exist", "rule not found", false);
    return;
  }
  let detection, fixed;
  try {
    detection = rule.detect(input.content, input.filePath || "test.js");
  } catch (e) {
    record(ruleId, name, "detect() to run", `detect threw: ${e.message}`, false);
    return;
  }
  const detected = !!detection?.found;
  if (detected !== expectDetect) {
    record(ruleId, name, `detect.found=${expectDetect}`, `detect.found=${detected} (${detection?.details || ""})`, false);
  } else {
    record(ruleId, name, `detect.found=${expectDetect}`, `detect.found=${detected}`, true);
  }
  try {
    fixed = rule.fix(input.content, input.filePath || "test.js");
  } catch (e) {
    record(ruleId, `${name} (fix)`, "fix() to run", `fix threw: ${e.message}`, false);
    return;
  }
  const changed = typeof fixed === "string" && fixed !== input.content;
  if (changed !== expectFixChanged) {
    record(ruleId, `${name} (fix)`, `fix changed=${expectFixChanged}`, `fix changed=${changed}`, false);
  } else {
    record(ruleId, `${name} (fix)`, `fix changed=${expectFixChanged}`, `fix changed=${changed}`, true);
  }
}

// ── Test cases ─────────────────────────────────────────────────────────────

// === Rule 8: fs-sync-trycatch ===
runCase({
  ruleId: "fs-sync-trycatch",
  name: "R8-1 fs.unlinkSync no try-catch (the most common P0 in telemetry)",
  expectDetect: true, expectFixChanged: true,
  input: {
    content: `const fs = require('fs');
fs.unlinkSync('/tmp/test.txt');
console.log('done');
`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "fs-sync-trycatch",
  name: "R8-2 fs.unlinkSync already inside try-catch",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `const fs = require('fs');
try {
  fs.unlinkSync('/tmp/test.txt');
} catch (e) {
  console.error('fail', e);
}
`,
  filePath: "test.js",
  },
});

runCase({
  ruleId: "fs-sync-trycatch",
  name: "R8-3 const result = fs.readFileSync(...) (return value)",
  expectDetect: true, expectFixChanged: true,
  input: {
    content: `const fs = require('fs');
function load() {
  const data = fs.readFileSync('/etc/config.json', 'utf8');
  return JSON.parse(data);
}
`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "fs-sync-trycatch",
  name: "R8-4 line is inside a comment",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `// remember to call fs.unlinkSync('/tmp/x') here
function cleanup() {}
`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "fs-sync-trycatch",
  name: "R8-5 multi-line fs.writeFileSync call (no assignment)",
  expectDetect: true, expectFixChanged: true,
  input: {
    content: `function save() {
  fs.writeFileSync(
    '/tmp/out.json',
    JSON.stringify(data),
  );
}
`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "fs-sync-trycatch",
  name: "R8-6 execSync (no fs prefix)",
  expectDetect: true, expectFixChanged: true,
  input: {
    content: `const { execSync } = require('child_process');
const out = execSync('ls -la', { encoding: 'utf8' });
console.log(out);
`,
    filePath: "test.js",
  },
});

// === Rule 6: magic-numbers-safe (the suspected no-op) ===
runCase({
  ruleId: "magic-numbers-safe",
  name: "R6-1 detect-only sanity: same 4-digit number 2+ times (CRITICAL: expected fix=no-op)",
  expectDetect: true, expectFixChanged: false,
  input: {
    content: `function f() {
  return 1473376125584670872;
}
function g() {
  return 1473376125584670872;
}
`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "magic-numbers-safe",
  name: "R6-2 same 5-digit number (60000 from telemetry)",
  expectDetect: true, expectFixChanged: false,
  input: {
    content: `const a = 60000;
setTimeout(fn, 60000);
`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "magic-numbers-safe",
  name: "R6-3 only 1 occurrence (should NOT flag)",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `const TIMEOUT = 12345;
`,
    filePath: "test.js",
  },
});

// === Rule 4: hardcoded-home-path ===
runCase({
  ruleId: "hardcoded-home-path",
  name: "R4-1 /Users/ally/... in code (not comment)",
  expectDetect: true, expectFixChanged: true,
  input: {
    content: `const path = '/Users/ally/.openclaw/workspace/data.json';
`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "hardcoded-home-path",
  name: "R4-2 /Users/ally/... in comment (should skip)",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `// TODO: move /Users/ally/foo to a config
const x = 1;
`,
    filePath: "test.js",
  },
});

// === Rules 1-3: formatting ===
runCase({
  ruleId: "trailing-whitespace",
  name: "R1 line with trailing spaces",
  expectDetect: true, expectFixChanged: true,
  input: { content: `const x = 1;   \nconst y = 2;\n`, filePath: "test.js" },
});

runCase({
  ruleId: "missing-eof-newline",
  name: "R2 file without final newline",
  expectDetect: true, expectFixChanged: true,
  input: { content: `const x = 1;`, filePath: "test.js" },
});

runCase({
  ruleId: "consecutive-blank-lines",
  name: "R3 four blank lines in a row",
  expectDetect: true, expectFixChanged: true,
  input: { content: `a\n\n\n\n\nb\n`, filePath: "test.js" },
});

// === COVERAGE GAP probes: verify-edit.js reports these, NO rule covers them ===
// These cases intentionally have expectDetect=false to PROVE there's no rule.
runCase({
  ruleId: "fs-sync-trycatch",
  name: "GAP-1 TypeError pattern (no rule covers this)",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `function f(obj) {
  return obj.foo.bar;
}
`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "magic-numbers-safe",
  name: "GAP-2 unused import (no rule covers)",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `import { unused } from 'foo';
const x = 1;
`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "simplified-chinese",
  name: "GAP-3 simplified chinese characters (rule exists, check coverage)",
  expectDetect: true, expectFixChanged: true,
  input: {
    content: `// 这是一行简体的注释
function f() { return 1; }
`,
    filePath: "test.js",
  },
});

// === Rule 9: optional-chaining (NEW — 防 TypeError on undefined chain) ===
runCase({
  ruleId: "optional-chaining",
  name: "OC-1 simple 3-level chain (user.profile.avatar)",
  expectDetect: true, expectFixChanged: true,
  input: {
    content: `const url = user.profile.avatar;\n`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "optional-chaining",
  name: "OC-2 4-level chain (a.b.c.d)",
  expectDetect: true, expectFixChanged: true,
  input: {
    content: `const x = a.b.c.d;\n`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "optional-chaining",
  name: "OC-3 chain as function argument (f(a.b.c))",
  expectDetect: true, expectFixChanged: true,
  input: {
    content: `process(some.obj.value);\n`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "optional-chaining",
  name: "OC-4 SAFE Math root (Math.PI.toFixed) — must skip",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `const s = Math.PI.toFixed(2);\n`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "optional-chaining",
  name: "OC-5 SAFE JSON root (JSON.parse(x).data) — must skip",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `const data = JSON.parse(text).result;\n`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "optional-chaining",
  name: "OC-6 SAFE process root (process.env.HOME) — must skip",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `const home = process.env.HOME;\n`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "optional-chaining",
  name: "OC-7 SAFE Buffer root (Buffer.from(x).toString) — must skip",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `const s = Buffer.from(input).toString('utf8');\n`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "optional-chaining",
  name: "OC-8 already uses ?. (obj?.prop.value) — must skip (chain opt-in)",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `const x = obj?.prop.value;\n`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "optional-chaining",
  name: "OC-9 line is a comment — must skip",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `// remember to refactor user.profile.avatar\n`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "optional-chaining",
  name: "OC-10 destructuring left side — must skip",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `const { x } = obj.prop.foo;\n`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "optional-chaining",
  name: "OC-11 only 2 levels — must skip (need 3+)",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `const x = obj.prop;\n`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "optional-chaining",
  name: "OC-12 indexed chain (response.data.items[0]) — must flag",
  expectDetect: true, expectFixChanged: true,
  input: {
    content: `const first = response.data.items[0];\n`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "optional-chaining",
  name: "OC-13 mixed: existing ?. + new chain on same line — must skip (line opt-in)",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `const y = obj?.a.b.c;\n`,
    filePath: "test.js",
  },
});

runCase({
  ruleId: "optional-chaining",
  name: "OC-14 safe console root (console.log(process.env.X)) — must skip",
  expectDetect: false, expectFixChanged: false,
  input: {
    content: `console.log(process.env.NODE_ENV);\n`,
    filePath: "test.js",
  },
});

// ── Report ─────────────────────────────────────────────────────────────────
console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║  SHL LOW_RISK_RULES AUDIT                                         ║");
console.log("╚══════════════════════════════════════════════════════════════════╝");
console.log();
console.log(`Total cases:  ${totalCases}`);
console.log(`Surprises:    ${surprises}`);
console.log();

const byRule = new Map();
for (const r of results) {
  if (!byRule.has(r.ruleId)) byRule.set(r.ruleId, []);
  byRule.get(r.ruleId).push(r);
}

for (const [ruleId, cases] of byRule) {
  console.log(`─── ${ruleId} ───`);
  for (const c of cases) {
    const mark = c.ok ? "✓" : "✗";
    console.log(`  ${mark} ${c.caseName}`);
    if (!c.ok) console.log(`     expected: ${c.expected}\n     actual:   ${c.actual}`);
  }
  console.log();
}

// ── Summary table ──────────────────────────────────────────────────────────
const summary = [];
for (const rule of LOW_RISK_RULES) {
  const cases = byRule.get(rule.id) || [];
  const allPass = cases.every((c) => c.ok);
  summary.push({
    id: rule.id,
    category: rule.category,
    tested: cases.length / 2, // detect + fix halves
    pass: cases.filter((c) => c.ok).length / 2,
  });
}

console.log("─── Coverage matrix ───");
console.log("rule.id                category       tested pass   verdict");
console.log("──────────────────────────────────────────────────────────────");
for (const s of summary) {
  const verdict = s.tested === s.pass ? "PASS" : "FAIL";
  console.log(
    `${s.id.padEnd(22)} ${s.category.padEnd(14)} ${String(s.tested).padStart(3)}    ${String(s.pass).padStart(3)}    ${verdict}`,
  );
}

console.log();
console.log("─── Coverage gaps (verify_edit.js reports these, no rule covers) ───");
console.log("  - Magic numbers (10+ digits): rule exists but fix() is no-op (by design)");
console.log("  - TypeError: Cannot read properties of undefined");
console.log("  - console.log / console.error in production code");
console.log("  - Unused imports");
console.log("  - TODO / FIXME markers");
console.log("  - unused-vars");
console.log("  - Bare try-catch without error handling");
console.log();

process.exit(surprises === 0 ? 0 : 1);
