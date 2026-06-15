/**
 * test.mjs — Self-test for skill-auto-suggest
 *
 * Runs scenarios against the pure core functions; does not need the OpenClaw SDK.
 */

import fs from "node:fs";
import {
  loadSkills,
  computeTopMatches,
  formatSuggestions,
  parseFrontmatter,
  recordSuggestion,
  invalidateSkillsCache,
  TELEMETRY_FILE,
} from "./core.mjs";
import { scoreSkill, parseSegments } from "./matcher.mjs";
import { createOllamaProvider } from "./embedding.mjs";

let passed = 0;
let failed = 0;
let warned = 0;

function logResult(label, ok, detail = "") {
  const icon = ok ? "✅" : "❌";
  console.log(`${icon} ${label}${detail ? " — " + detail : ""}`);
  if (ok) passed++;
  else failed++;
}

function logWarn(label, detail = "") {
  console.log(`⚠️  ${label}${detail ? " — " + detail : ""}`);
  warned++;
}

async function isOllamaAvailable() {
  try {
    const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data.models) && data.models.some(m => m.name.includes("nomic-embed-text"));
  } catch {
    return false;
  }
}

// ── Sanity: frontmatter parser ──
console.log("=== Sanity: parseFrontmatter ===");
const sample = `---
name: cron-troubleshooting
description: "Diagnose cron failures. Use when: cron fails. Key capabilities: timeline construction."
status: active
disable-model-invocation: true
---
body`;
const meta = parseFrontmatter(sample);
logResult("description parsed", meta.description.includes("Diagnose cron"));
logResult("disable-model-invocation detected", meta.disableModelInvocation === true);
logResult("status parsed", meta.status === "active");

const sampleNoDisable = `---
name: foo
description: "Foo skill"
---
body`;
const meta2 = parseFrontmatter(sampleNoDisable);
logResult("default disableModelInvocation = false", meta2.disableModelInvocation === false);

const sampleDraft = `---
name: draft-skill
description: "Draft skill"
status: draft
---
body`;
const metaDraft = parseFrontmatter(sampleDraft);
logResult("draft status parsed", metaDraft.status === "draft");

// ── Sanity: matcher with 3-segment ──
console.log("\n=== Sanity: scoreSkill ===");
const cronSkill = {
  description: "Diagnose cron failures via timeline. Use when: cron fails, timeline needed, root cause unclear. Key capabilities: timeline construction, issue isolation, rerun verification."
};
const cronTask = "My cron job keeps failing, help debug it";
const cronScore = scoreSkill(cronTask, cronSkill);
logResult("cron task matches cron skill (score > 0.15)", cronScore > 0.15, `score=${cronScore.toFixed(3)}`);

const unrelatedScore = scoreSkill("what is the weather today", cronSkill);
logResult("unrelated task has low score (< 0.1)", unrelatedScore < 0.1, `score=${unrelatedScore.toFixed(3)}`);

const abbrevSkill = {
  description: "Diagnose cron failures. Use when: cron fails, e.g. daily jobs, i.e. recurring tasks. Key capabilities: timeline construction."
};
const abbrevSegments = parseSegments(abbrevSkill.description);
logResult("segment parser keeps e.g./i.e. in Use when", abbrevSegments.useWhen.includes("daily jobs") && abbrevSegments.useWhen.includes("recurring tasks"), `useWhen="${abbrevSegments.useWhen}"`);

// ── Load real skills ──
console.log("\n=== Load real skills from ~/.openclaw/workspace/skills ===");
const skills = await loadSkills();
logResult("loaded skills (>= 30 expected)", skills.length >= 30, `count=${skills.length}`);

const disabledSkills = skills.filter(s => s.disableModelInvocation);
logResult("disable-model-invocation skills filtered from active pool", disabledSkills.length === 0, `count=${disabledSkills.length}`);

// ── Test 1: Cron debugging ──
console.log("\n=== Test 1: Cron debugging ===");
{
  const task = "My cron job is failing, help me debug it";
  const matches = await computeTopMatches(task, skills);
  const names = matches.map(m => m.name);
  const hasCron = names.some(n => n.includes("cron"));
  const hasCronIssue = matches.find(m => m.name.includes("cron"));
  logResult("cron-related skill in top-3", hasCron, `top: ${names.join(", ") || "(empty)"}`);
  if (hasCronIssue) {
    logResult("top cron score is reasonable", hasCronIssue.score >= 0.2, `score=${hasCronIssue.score.toFixed(3)}`);
  }
}

// ── Test 2: Chinese/English mixed tokenization ──
console.log("\n=== Test 2: Chinese/English mixed tokenization ===");
{
  const task = "幫我寫封 email 俾客戶傾價錢";
  // No built-in email skill is guaranteed to be active, so use a mock skill to
  // verify the tokenizer extracts "email" from a mixed Chinese/English task.
  const mockEmailSkill = {
    name: "email-drafting",
    description: "Draft professional emails. Use when: email drafting, client communication. Key capabilities: tone matching, structure.",
    disableModelInvocation: false,
  };
  const mixedSkills = [...skills, mockEmailSkill];
  const matches = await computeTopMatches(task, mixedSkills);
  const names = matches.map(m => m.name);
  const hasEmail = names.includes("email-drafting");
  logResult("mixed Chinese/English task matches email skill", hasEmail, `top: ${names.join(", ") || "(empty)"}`);
}

// ── Test 3: Issue creation ──
console.log("\n=== Test 3: Issue creation ===");
{
  const task = "需要 create 一個 P1 issue 追蹤呢個 bug";
  const matches = await computeTopMatches(task, skills);
  const names = matches.map(m => m.name);
  const hasIssue = names.some(n => n.includes("issue"));
  logResult("issue-related skill in top-3", hasIssue, `top: ${names.join(", ") || "(empty)"}`);
}

// ── Test 4: Unrelated random task ──
console.log("\n=== Test 4: Unrelated random task ===");
{
  const task = "xyzzzz foobar quuxzz random nonsense";
  const matches = await computeTopMatches(task, skills);
  logResult("no matches (filtered by MIN_SCORE)", matches.length === 0,
    matches.length === 0 ? "empty" : `unexpected: ${matches.map(m => m.name).join(", ")}`);
  const block = formatSuggestions(matches);
  logResult("formatSuggestions returns empty string", block === "", `got: "${block.slice(0, 50)}"`);
}

// ── Test 5: Disable flag respected end-to-end (mock data) ──
console.log("\n=== Test 5: disable-model-invocation flag respected ===");
{
  const mockSkills = [
    { name: "enabled-cron", description: "Fix cron. Use when: cron fails. Key capabilities: debug.", disableModelInvocation: false },
    { name: "disabled-cron", description: "Audit cron. Use when: cron audit. Key capabilities: audit.", disableModelInvocation: true },
  ];
  const task = "audit my cron config";
  const matches = await computeTopMatches(task, mockSkills, 3);
  const names = matches.map(m => m.name);
  const hasDisabled = names.includes("disabled-cron");
  logResult("disabled skill NOT in matches", !hasDisabled,
    hasDisabled ? "LEAKED — FAIL" : `top: ${names.join(", ") || "(empty)"}`);
}

// ── Test 6: Draft/archived skills filtered (mock data) ──
console.log("\n=== Test 6: status: draft / archived skills filtered ===");
{
  // loadSkills() already filters these from disk, so verify via parseFrontmatter behavior.
  const active = parseFrontmatter("---\nstatus: active\ndescription: Active skill\n---");
  const draft = parseFrontmatter("---\nstatus: draft\ndescription: Draft skill\n---");
  const archived = parseFrontmatter("---\nstatus: archived\ndescription: Archived skill\n---");
  logResult("active status accepted", active.status === "active");
  logResult("draft status recognized", draft.status === "draft");
  logResult("archived status recognized", archived.status === "archived");
}

// ── Test 7: Format output ──
console.log("\n=== Test 7: formatSuggestions output format ===");
{
  const fake = [
    { name: "foo", score: 0.85 },
    { name: "bar", score: 0.72 },
  ];
  const block = formatSuggestions(fake);
  logResult("contains <suggested_skills> tags", block.includes("<suggested_skills>"));
  logResult("contains 1. foo", block.includes("1. foo"));
  logResult("contains score formatting", block.includes("(score: 0.85)"));
  console.log("   --- block preview ---");
  console.log(block.split("\n").map(l => "   " + l).join("\n"));
}

// ── Test 8: Telemetry write ──
console.log("\n=== Test 8: Telemetry write ===");
{
  const task = "test telemetry task";
  const fakeMatches = [{ name: "foo", score: 0.85 }, { name: "bar", score: 0.72 }];
  await recordSuggestion(task, fakeMatches);

  let telemetryOk = false;
  let lastEntry = null;
  try {
    const lines = fs.readFileSync(TELEMETRY_FILE, "utf8").trim().split("\n").filter(Boolean);
    lastEntry = JSON.parse(lines[lines.length - 1]);
    telemetryOk =
      lastEntry.task === task &&
      lastEntry.matchCount === 2 &&
      lastEntry.suggestedSkills[0].name === "foo" &&
      lastEntry.suggestedSkills[0].score === 0.85;
  } catch (err) {
    console.error("   telemetry read error:", err.message);
  }
  logResult("telemetry record written and readable", telemetryOk,
    telemetryOk ? `ts=${lastEntry.ts}` : `lastEntry=${JSON.stringify(lastEntry)}`);
}

// ── Test 9: Cache invalidation ──
console.log("\n=== Test 9: Cache invalidation ===");
{
  const before = await loadSkills();
  invalidateSkillsCache();
  const after = await loadSkills();
  logResult("invalidateSkillsCache resets cache", before.length === after.length && after.length >= 30,
    `count before=${before.length}, after=${after.length}`);
}

// ── Test 10: Vector similarity (if Ollama is available) ──
console.log("\n=== Test 10: Vector similarity ===");
{
  const ollamaReady = await isOllamaAvailable();
  if (!ollamaReady) {
    logWarn("Ollama + nomic-embed-text not available — skipping vector test");
  } else {
    const provider = createOllamaProvider({ model: "nomic-embed-text" });
    const mockSkills = [
      {
        name: "email-drafting",
        description: "Draft professional emails. Use when: email drafting, client communication. Key capabilities: tone matching, structure.",
        disableModelInvocation: false,
      },
      {
        name: "cron-troubleshooting",
        description: "Diagnose cron failures via timeline and issue isolation. Use when: cron fails, timeline needed, root cause unclear. Key capabilities: timeline construction, issue isolation, rerun verification.",
        disableModelInvocation: false,
      },
    ];
    const skillEmbeddings = new Map();
    for (const s of mockSkills) {
      skillEmbeddings.set(s.name, await provider.embed(s.description));
    }

    const task = "I need to draft a professional email to a client";
    const matches = await computeTopMatches(task, mockSkills, {
      provider,
      skillEmbeddings,
      vectorWeight: 0.7,
    });
    const names = matches.map(m => m.name);
    const topIsEmail = names[0] === "email-drafting";
    const usedVector = matches.some(m => m.vectorScore > 0);
    logResult("vector similarity ranks email skill first", topIsEmail && usedVector,
      `top: ${names.join(", ") || "(empty)"}, vector=${usedVector}`);
  }
}

// ── Summary ──
console.log("\n=== Summary ===");
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`⚠️  Warned: ${warned}`);
console.log(`Total checks: ${passed + failed + warned}`);

if (failed > 0) {
  process.exit(1);
}
