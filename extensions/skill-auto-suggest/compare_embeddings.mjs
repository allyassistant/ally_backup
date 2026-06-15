/**
 * compare_embeddings.mjs — Benchmark embedding models for skill-auto-suggest.
 *
 * Compares nomic-embed-text, bge-m3 and qwen2.5:3b on the same tasks.
 * Uses in-memory embeddings (no disk cache) so each model is tested cleanly.
 */

import { loadSkills, computeTopMatches, invalidateSkillsCache } from "./core.mjs";
import { createOllamaProvider } from "./embedding.mjs";

const MODELS = ["nomic-embed-text", "bge-m3", "qwen2.5:3b"];

const MOCK_EMAIL_SKILL = {
  name: "email-drafting",
  description: "Draft professional emails. Use when: email drafting, client communication. Key capabilities: tone matching, structure.",
  disableModelInvocation: false,
};

const TASKS = [
  { id: "cron-en", task: "My cron job is failing, help me debug it", expectKeyword: "cron" },
  { id: "email-mixed", task: "幫我 write email 俾 client 傾價錢", expectKeyword: "email" },
  { id: "issue-en", task: "Create a P1 issue to track this bug", expectKeyword: "issue" },
  { id: "email-cn", task: "幫我寫封 email 俾客戶傾價錢", expectKeyword: "email" },
  { id: "curate-cn", task: "我想整理同歸納我啲 skill，點做？", expectKeyword: "curation" },
];

async function embedAllSkills(skills, provider) {
  const embeddings = new Map();
  console.log(`  generating ${skills.length} skill embeddings with ${provider.model}...`);
  const start = Date.now();
  for (const skill of skills) {
    try {
      embeddings.set(skill.name, await provider.embed(skill.description));
    } catch (err) {
      console.error(`    FAILED ${skill.name}: ${err.message}`);
      return null;
    }
  }
  console.log(`  done in ${Date.now() - start}ms`);
  return embeddings;
}

async function testModel(model, skills) {
  console.log(`\n=== Model: ${model} ===`);
  const provider = createOllamaProvider({ model });

  // Verify model is available.
  try {
    await provider.embed("ping");
  } catch (err) {
    console.log(`  model unavailable: ${err.message}`);
    return null;
  }

  const skillEmbeddings = await embedAllSkills(skills, provider);
  if (!skillEmbeddings) return null;

  const results = [];
  for (const { id, task, expectKeyword } of TASKS) {
    const matches = await computeTopMatches(task, skills, {
      provider,
      skillEmbeddings,
      vectorWeight: 0.7,
    });
    const top3 = matches.slice(0, 3).map(m => ({
      name: m.name,
      score: Number(m.score.toFixed(3)),
      keywordScore: Number(m.keywordScore.toFixed(3)),
      vectorScore: Number(m.vectorScore.toFixed(3)),
    }));
    const rank = top3.findIndex(m => m.name.includes(expectKeyword));
    const result = {
      taskId: id,
      task,
      expectKeyword,
      top3,
      foundAt: rank === -1 ? null : rank + 1,
    };
    results.push(result);
    const found = rank === -1 ? "NOT FOUND" : `#${rank + 1}`;
    console.log(`  ${id}: ${found} — ${top3.map(m => `${m.name}(${m.score})`).join(", ") || "(empty)"}`);
  }
  return { model, results };
}

async function main() {
  invalidateSkillsCache();
  const skills = [...await loadSkills(), MOCK_EMAIL_SKILL];
  console.log(`Loaded ${skills.length} active skills (including mock email skill)`);

  const all = [];
  for (const model of MODELS) {
    const res = await testModel(model, skills);
    if (res) all.push(res);
  }

  // Summary table
  console.log("\n=== Summary ===");
  console.log(["task".padEnd(14), ...MODELS.map(m => m.padEnd(12))].join(" | "));
  console.log("-".repeat(14 + 3 + MODELS.length * 15));
  for (const t of TASKS) {
    const cells = [t.id.padEnd(14)];
    for (const model of MODELS) {
      const modelRes = all.find(r => r.model === model);
      if (!modelRes) {
        cells.push("N/A".padEnd(12));
        continue;
      }
      const taskRes = modelRes.results.find(r => r.taskId === t.id);
      const rank = taskRes.foundAt ?? "×";
      cells.push(String(rank).padEnd(12));
    }
    console.log(cells.join(" | "));
  }

  // Write detailed JSON
  const outPath = new URL("embedding_comparison.json", import.meta.url).pathname;
  await (await import("node:fs/promises")).writeFile(outPath, JSON.stringify(all, null, 2), "utf8");
  console.log(`\nDetailed results written to ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
