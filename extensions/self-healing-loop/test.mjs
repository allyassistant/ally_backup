/**
 * test.mjs — Self-test for self-healing-loop's 3-Layer Defense
 *
 * Tests the pure helper functions exported by index.mjs:
 *   - Layer 1: isIsolatedCronSession (caller session check)
 *   - Layer 2: isSkillPath (path-based skip with path.sep delimiter)
 *   - Layer 3: classifyErrorForSkillPath / gateSkillPathFix (fix-type whitelist)
 *
 * Does NOT spin up the OpenClaw plugin host; tests the deterministic logic
 * that drives the after_tool_call and spawnFixer gates.
 *
 * Run: node test.mjs
 */

import {
  isIsolatedCronSession,
  isSkillPath,
  classifyErrorForSkillPath,
  gateSkillPathFix,
  ISOLATED_CRON_PATTERNS,
  SKILL_PATH_MARKERS,
  SKILL_ALLOWED_PATTERNS,
  SKILL_BLOCKED_PATTERNS,
  TELEMETRY_SKIP_SKILL_SESSION,
  TELEMETRY_SKIP_SKILL_PATH,
  TELEMETRY_SKILL_FIX_BLOCKED,
} from "./lib/skill-gate.mjs";

import path from "node:path";
import os from "node:os";
import fs from "node:fs";

let passed = 0;
let failed = 0;

function ok(label, detail = "") {
  console.log(`✅ ${label}${detail ? " — " + detail : ""}`);
  passed++;
}
function bad(label, detail = "") {
  console.log(`❌ ${label}${detail ? " — " + detail : ""}`);
  failed++;
}
function assert(cond, label, detail = "") {
  if (cond) ok(label, detail);
  else bad(label, detail);
}

// =========================================================================
// Layer 1: isIsolatedCronSession
// =========================================================================
console.log("\n=== Layer 1: isIsolatedCronSession ===");

// Should be true: isolated cron sessions
assert(
  isIsolatedCronSession("agent:main:isolated:abc-123") === true,
  "isolated session key detected",
  "agent:main:isolated:abc-123"
);
assert(
  isIsolatedCronSession("agent:main:isolated:session-XYZ") === true,
  "another isolated key"
);

// Should be true: session keys containing cron
assert(
  isIsolatedCronSession("agent:cron-job:run-123") === true,
  "cron in key path"
);
assert(
  isIsolatedCronSession("agent:worker:cron/daily") === true,
  "cron as path segment"
);

// Should be true: skill-reviewer marker
assert(
  isIsolatedCronSession("plugin:skill-reviewer:run-1") === true,
  "skill-reviewer explicit marker"
);
assert(
  isIsolatedCronSession("plugin:skill_reviewer:run-1") === true,
  "skill_reviewer underscore variant"
);

// Should be false: main sessions
assert(
  isIsolatedCronSession("agent:main:discord:channel:1473384999003619500") === false,
  "main discord session NOT flagged"
);
assert(
  isIsolatedCronSession("agent:main:webchat:user-1") === false,
  "main webchat session NOT flagged"
);

// Should be false: empty/null/undefined
assert(isIsolatedCronSession("") === false, "empty string NOT flagged");
assert(isIsolatedCronSession(null) === false, "null NOT flagged");
assert(isIsolatedCronSession(undefined) === false, "undefined NOT flagged");
assert(isIsolatedCronSession(42) === false, "non-string NOT flagged");

// Pattern constants exposed
assert(ISOLATED_CRON_PATTERNS.length >= 3, "ISOLATED_CRON_PATTERNS has 3+ patterns");

// =========================================================================
// Layer 2: isSkillPath
// =========================================================================
console.log("\n=== Layer 2: isSkillPath ===");

const workspace = os.homedir() + "/.openclaw/workspace";

// Should be true: skill-content paths
assert(
  isSkillPath(`${workspace}/skills-learned/aliveness-noise-reduction/SKILL.md`) === true,
  "skills-learned dir matched"
);
assert(
  isSkillPath(`${workspace}/skills-learned/foo/bar/baz.js`) === true,
  "nested skills-learned matched"
);
assert(
  isSkillPath(`${workspace}/skills/_learned_cron-troubleshooting/SKILL.md`) === true,
  "skills/_learned_/ matched"
);
assert(
  isSkillPath(`${workspace}/skills/_learned_foo/scripts/bar.js`) === true,
  "nested skills/_learned_/ matched"
);

// Should be false: non-skill paths
assert(
  isSkillPath(`${workspace}/extensions/self-healing-loop/index.mjs`) === false,
  "extensions dir NOT matched"
);
assert(
  isSkillPath(`${workspace}/scripts/verify_edit.js`) === false,
  "scripts dir NOT matched"
);
assert(
  isSkillPath(`${workspace}/docs/something.md`) === false,
  "docs dir NOT matched"
);

// Should be false: substring collision (defense)
assert(
  isSkillPath(`${workspace}/my-skills-data/foo.js`) === false,
  "substr collision 'my-skills-data' NOT matched (path.sep delimiter)"
);
assert(
  isSkillPath(`${workspace}/fooskills-learnedbar/baz.js`) === false,
  "substr collision 'fooskills-learnedbar' NOT matched"
);
assert(
  isSkillPath(`${workspace}/something/_learned_nope/file.js`) === false,
  "substr collision '_learned_' inside longer word NOT matched"
);
assert(
  isSkillPath(`${workspace}/skills-learneddata/file.js`) === false,
  "substr collision 'skills-learneddata' NOT matched"
);

// Should be false: empty/null
assert(isSkillPath("") === false, "empty path NOT matched");
assert(isSkillPath(null) === false, "null path NOT matched");
assert(isSkillPath(undefined) === false, "undefined path NOT matched");

// Markers exposed
assert(SKILL_PATH_MARKERS.length === 2, "SKILL_PATH_MARKERS has 2 markers");
assert(SKILL_PATH_MARKERS.includes("skills-learned"), "marker 'skills-learned' present");
assert(SKILL_PATH_MARKERS.includes("_learned_"), "marker '_learned_' present");

// Edge: relative path that resolves to a skill path
const relSkillPath = path.join(workspace, "skills-learned", "foo", "bar.js");
assert(isSkillPath(relSkillPath) === true, "relative skill path matched after path.resolve");

// Edge: path with trailing slash
assert(
  isSkillPath(`${workspace}/skills-learned`) === true,
  "skill path at end of string matched"
);
assert(
  isSkillPath(`${workspace}/skills/_learned_foo`) === true,
  "_learned_ at end of string matched"
);

// =========================================================================
// Layer 3: classifyErrorForSkillPath
// =========================================================================
console.log("\n=== Layer 3: classifyErrorForSkillPath ===");

// Allowed: syntax errors
assert(
  classifyErrorForSkillPath("SyntaxError: Unexpected token ';' at line 5") === "allowed",
  "syntax error allowed"
);
assert(
  classifyErrorForSkillPath("/path/file.js:5 — SyntaxError: Unexpected end of input") === "allowed",
  "verifier-style syntax error allowed"
);

// Allowed: undefined symbol references
assert(
  classifyErrorForSkillPath("foo is not defined") === "allowed",
  "undefined symbol allowed"
);
assert(
  classifyErrorForSkillPath("ReferenceError: bar is not defined") === "allowed",
  "ReferenceError allowed"
);
assert(
  classifyErrorForSkillPath("Cannot find name 'baz'") === "allowed",
  "Cannot find name allowed"
);
assert(
  classifyErrorForSkillPath("Cannot find module 'qux'") === "allowed",
  "Cannot find module allowed"
);

// Blocked: judgment-class
assert(
  classifyErrorForSkillPath("Magic numbers in code (10+): 1024") === "blocked",
  "magic numbers blocked"
);
assert(
  classifyErrorForSkillPath("console.log without proper wrapping") === "blocked",
  "console.log blocked"
);
assert(
  classifyErrorForSkillPath("unused-import detected for foo") === "blocked",
  "unused-import blocked"
);
assert(
  classifyErrorForSkillPath("execSync 外面冇 try-catch") === "blocked",
  "P0 try-catch blocked"
);
assert(
  classifyErrorForSkillPath("readFileSync 外面冇 try-catch") === "blocked",
  "P0 readFileSync blocked"
);

// Unmatched (conservative → blocked)
assert(
  classifyErrorForSkillPath("some unknown error message") === "blocked",
  "unmatched error conservatively blocked"
);
assert(
  classifyErrorForSkillPath("") === "blocked",
  "empty message blocked"
);
assert(
  classifyErrorForSkillPath(null) === "blocked",
  "null message blocked"
);

// Pattern constants exposed
assert(SKILL_ALLOWED_PATTERNS.length >= 2, "SKILL_ALLOWED_PATTERNS has 2+ patterns");
assert(SKILL_BLOCKED_PATTERNS.length >= 5, "SKILL_BLOCKED_PATTERNS has 5+ patterns");

// =========================================================================
// Layer 3 (gate): gateSkillPathFix
// =========================================================================
console.log("\n=== Layer 3 (gate): gateSkillPathFix ===");

// All-allowed: should pass
let r = gateSkillPathFix([
  { msg: "SyntaxError: Unexpected token" },
  { msg: "foo is not defined" },
]);
assert(r.allowed === true, "all-allowed errors → fix allowed");
assert(r.blockedMsgs.length === 0, "no blocked msgs");
assert(r.allowedMsgs.length === 2, "2 allowed msgs");

// Mixed: should fail (conservative)
r = gateSkillPathFix([
  { msg: "SyntaxError: Unexpected token" },
  { msg: "Magic numbers in code (10+): 999" },
]);
assert(r.allowed === false, "mixed errors → fix blocked (conservative)");
assert(r.blockedMsgs.length === 1, "1 blocked msg");
assert(r.allowedMsgs.length === 1, "1 allowed msg (but fix still blocked)");

// All-blocked: should fail
r = gateSkillPathFix([
  { msg: "console.log debug statement" },
  { msg: "Magic numbers in code (10+): 1024" },
]);
assert(r.allowed === false, "all-blocked errors → fix blocked");
assert(r.blockedMsgs.length === 2, "2 blocked msgs");

// Empty: should fail (nothing to fix)
r = gateSkillPathFix([]);
assert(r.allowed === false, "empty errors → fix blocked (nothing to fix)");
assert(r.allowedMsgs.length === 0, "0 allowed msgs");

// Non-array: should fail safely
r = gateSkillPathFix(null);
assert(r.allowed === false, "null errors → fix blocked");

// =========================================================================
// Telemetry event names
// =========================================================================
console.log("\n=== Telemetry event names ===");

assert(
  TELEMETRY_SKIP_SKILL_SESSION === "skip_skill_session",
  "skip_skill_session event name"
);
assert(
  TELEMETRY_SKIP_SKILL_PATH === "skip_skill_path",
  "skip_skill_path event name"
);
assert(
  TELEMETRY_SKILL_FIX_BLOCKED === "skill_fix_blocked",
  "skill_fix_blocked event name"
);

// =========================================================================
// Integration scenarios (simulate the 3-layer flow)
// =========================================================================
console.log("\n=== Integration: end-to-end 3-layer scenarios ===");

// Scenario 1: cron session + skill path + syntax error → should NOT fix
{
  const sessionKey = "agent:main:isolated:abc";
  const filePath = `${workspace}/skills-learned/test/foo.js`;
  const errors = [{ msg: "SyntaxError: Unexpected token" }];
  const skipReason = isIsolatedCronSession(sessionKey)
    ? TELEMETRY_SKIP_SKILL_SESSION
    : isSkillPath(filePath)
    ? TELEMETRY_SKIP_SKILL_PATH
    : gateSkillPathFix(errors).allowed
    ? "ok"
    : TELEMETRY_SKILL_FIX_BLOCKED;
  assert(skipReason === TELEMETRY_SKIP_SKILL_SESSION, "S1: cron+skill+syntax → Layer 1 hit", `reason=${skipReason}`);
}

// Scenario 2: main session + skill path + syntax error → Layer 2 hit
{
  const sessionKey = "agent:main:discord:channel:1";
  const filePath = `${workspace}/skills-learned/test/foo.js`;
  const errors = [{ msg: "SyntaxError: Unexpected token" }];
  const skipReason = isIsolatedCronSession(sessionKey)
    ? TELEMETRY_SKIP_SKILL_SESSION
    : isSkillPath(filePath)
    ? TELEMETRY_SKIP_SKILL_PATH
    : "proceed";
  assert(skipReason === TELEMETRY_SKIP_SKILL_PATH, "S2: main+skill+syntax → Layer 2 hit", `reason=${skipReason}`);
}

// Scenario 3: main session + skill path + console.log → Layer 2 hit
{
  const sessionKey = "agent:main:webchat:1";
  const filePath = `${workspace}/skills/_learned_test/foo.js`;
  const errors = [{ msg: "console.log debug statement" }];
  const skipReason = isIsolatedCronSession(sessionKey)
    ? TELEMETRY_SKIP_SKILL_SESSION
    : isSkillPath(filePath)
    ? TELEMETRY_SKIP_SKILL_PATH
    : gateSkillPathFix(errors).allowed
    ? "ok"
    : TELEMETRY_SKILL_FIX_BLOCKED;
  assert(skipReason === TELEMETRY_SKIP_SKILL_PATH, "S3: main+skill+console.log → Layer 2 hit", `reason=${skipReason}`);
}

// Scenario 4: main session + non-skill path + syntax error → proceed
{
  const sessionKey = "agent:main:discord:channel:1";
  const filePath = `${workspace}/extensions/self-healing-loop/index.mjs`;
  const errors = [{ msg: "SyntaxError: Unexpected token" }];
  const skipReason = isIsolatedCronSession(sessionKey)
    ? TELEMETRY_SKIP_SKILL_SESSION
    : isSkillPath(filePath)
    ? TELEMETRY_SKIP_SKILL_PATH
    : "proceed";
  assert(skipReason === "proceed", "S4: main+non-skill+syntax → proceed (no gate hit)", `reason=${skipReason}`);
}

// Scenario 5: Layer 3 in isolation (imagine Layer 1+2 both miss) → fix-type gate
{
  const sessionKey = "agent:main:webchat:1";
  const filePath = `${workspace}/extensions/some-plugin/foo.js`; // non-skill
  const errors = [{ msg: "console.log debug statement" }];
  // In this case Layer 2 doesn't fire, so we reach Layer 3
  // (in real flow Layer 3 only fires if isSkillPath is true; here we test
  // the gate function directly)
  const gate = gateSkillPathFix(errors);
  assert(gate.allowed === false, "S5: console.log alone → Layer 3 would block", `blockedMsgs=${gate.blockedMsgs.length}`);
}

// =========================================================================
// Summary
// =========================================================================
console.log(`\n${"─".repeat(60)}`);
console.log(`Passed: ${passed} | Failed: ${failed}`);
console.log(`${"─".repeat(60)}`);

if (failed > 0) {
  console.log(`\n❌ ${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log(`\n✅ All ${passed} tests passed`);
  process.exit(0);
}
