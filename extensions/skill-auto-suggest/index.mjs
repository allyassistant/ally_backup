/**
 * skill-auto-suggest — OpenClaw before_prompt_build hook
 *
 * Auto-matches user task to top-3 relevant skills, injects as
 * <suggested_skills> block in system prompt.
 *
 * Architecture:
 *   - Loads all skill descriptions from ~/.openclaw/workspace/skills
 *   - Filters out disable-model-invocation: true (AGENTS.md hard rule)
 *   - Filters out status: draft / archived skills (AGENTS.md hard rule)
 *   - Computes 3-segment weighted keyword score + optional vector cosine score
 *   - Caches skill metadata + embeddings to avoid repeated I/O / embedding calls
 *   - FAIL-OPEN: any error → empty result, no model block
 *
 * Plugin SDK: definePluginEntry (matches existing skill-learner plugin)
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  loadSkills,
  computeTopMatches,
  formatSuggestions,
  extractTask,
  recordSuggestion,
  ensureSkillEmbeddings,
} from "./core.mjs";
import { createProviderFromConfig } from "./embedding.mjs";

export default definePluginEntry({
  id: "skill-auto-suggest",
  name: "Skill Auto-Suggest",
  description: "before_prompt_build hook: matches user task to top-3 skills, injects <suggested_skills> block.",
  configSchema: {
    type: "object",
    properties: {
      embeddingProvider: {
        type: "string",
        enum: ["ollama", "disabled"],
        default: "ollama",
      },
      ollamaBaseUrl: {
        type: "string",
        default: "http://localhost:11434",
      },
      ollamaModel: {
        type: "string",
        default: "nomic-embed-text",
      },
      vectorWeight: {
        type: "number",
        minimum: 0,
        maximum: 1,
        default: 0.7,
      },
    },
    additionalProperties: false,
  },
  register(api) {
    const pluginConfig = api.pluginConfig || {};
    const provider = createProviderFromConfig(pluginConfig);

    api.on("before_prompt_build", async (hookContext) => {
      try {
        const task = extractTask(hookContext);
        if (!task) return {};

        const skills = await loadSkills();
        if (skills.length === 0) return {};

        const skillEmbeddings = await ensureSkillEmbeddings(skills, provider);

        const matches = await computeTopMatches(task, skills, {
          provider,
          skillEmbeddings,
          vectorWeight: pluginConfig.vectorWeight,
        });
        const block = formatSuggestions(matches);

        // Fire-and-forget telemetry; never block the model.
        recordSuggestion(task, matches).catch(() => {});

        if (!block) return {};

        // Use prependSystemContext so providers can cache the static guidance block.
        return { prependSystemContext: block };
      } catch (err) {
        // FAIL-OPEN: never block the model on a hook error
        console.error("[skill-auto-suggest] error:", err.message);
        return {};
      }
    }, { priority: 10 });
  },
});
