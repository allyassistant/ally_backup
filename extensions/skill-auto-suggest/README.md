# skill-auto-suggest

OpenClaw `before_prompt_build` hook — automatically matches the user's task to the
top-3 relevant skills and injects a `<suggested_skills>` block in the system prompt.

## Why

Ally has 34+ active `_learned_*` skills plus a few built-in skills under
`~/.openclaw/workspace/skills/`, but **does not automatically match** them to
the user task. This hook makes skill recall automatic — Ally sees
"skill X is relevant, score 0.85" and can choose to `read` the SKILL.md.

This is **Step 2 + Step 3** of the Skill Viewer roadmap:

- **Step 1** — Manual visibility (CLI tool: `scripts/skill_inspector.js`)
- **Step 2** — Automatic injection (this hook)
- **Step 3** — Vector cosine similarity ← now implemented (Ollama `nomic-embed-text`)
- **Step 4** — Usage telemetry (issue #163.2)

## How it works

```
User task ──► keyword score + vector cosine ──► top-3 by score ──► <suggested_skills> block
                                                │                    │
                                                │                    └─ telemetry log
                                                │
                                                └─ filtered: disable-model-invocation
                                                └─ filtered: status: draft / archived
                                                └─ filtered: score < 0.1
```

### Scoring: keyword + vector blend

Each skill gets two scores:

1. **Keyword score** — 3-segment weighted overlap between task words and the
   skill description (`Use when`, `Key capabilities`, `Key tasks`).
2. **Vector score** — cosine similarity between the task embedding and the
   skill description embedding, generated via Ollama `nomic-embed-text`.

Final score = `(1 - vectorWeight) × keywordScore + vectorWeight × vectorScore`

Default `vectorWeight` is `0.7`. Set it to `0.0` in config to disable vector
similarity and fall back to pure keyword matching.

Keyword formula:

```
(overlap_USE × 1.0 + overlap_CAP × 0.7 + overlap_TASKS × 0.5) / |normalizer|
```

* `normalizer` = ASCII task words for mixed CJK/English tasks; otherwise all task words.
* Tokenizer treats ASCII sequences of 2+ chars as one token and each CJK character as one token, with common English stop words dropped.
* If no `Use when:` marker is found, the **whole description** is treated as USE WHEN.

**Chinese/CJK heuristic:** `nomic-embed-text` is English-centric, so when a task
contains > 50% CJK characters the vector weight is automatically reduced to `0`
and only the keyword score is used.

## Files

| File          | Purpose |
|---------------|---------|
| `index.mjs`   | Hook entry — `definePluginEntry`, `before_prompt_build`, config handling |
| `core.mjs`    | Pure logic — `loadSkills()`, `computeTopMatches()`, `formatSuggestions()`, embeddings cache |
| `matcher.mjs` | Keyword scoring, segment parsing, vector similarity helper |
| `embedding.mjs` | Ollama embedding provider, cosine similarity, provider factory |
| `test.mjs`    | Self-test — 10 scenarios + sanity checks |
| `compare_embeddings.mjs` | Optional benchmark: compare embedding models |
| `openclaw.plugin.json` | Plugin manifest + config schema |
| `README.md`   | This file |

## Hook signature

```js
api.on("before_prompt_build", async (hookContext) => {
  // hookContext may have: userMessage, task, message, prompt
  // returns: { prependSystemContext: string }
  // fail-open: any error → return {}
});
```

## Constraints

| Rule | Enforcement |
|------|-------------|
| **Fail-open** | All errors caught → empty return, never blocks model |
| **disable-model-invocation** | Skills with this flag are filtered out (AGENTS.md hard rule) |
| **status: draft / archived** | Non-active skills are filtered out (AGENTS.md hard rule) |
| **Cache 60s + mtime invalidation** | Skill metadata cached, but refreshed as soon as any SKILL.md changes |
| **Embedding cache** | Skill-description embeddings persisted to `.skill_auto_suggest_embeddings.json`; regenerated when model or skill changes |
| **Telemetry** | Every suggestion event appended to `.skill_auto_suggest_telemetry.jsonl` |
| **CJK/ASCII tokenizer** | Mixed Chinese/English tasks match on ASCII keywords without being diluted by CJK characters |
| **Vector fallback** | If Ollama is unavailable, embedding generation fails, or task is CJK-heavy, falls back to keyword matching |
| **Pure Node.js** | No external deps, ESM (.mjs) only |
| **Skip broken symlinks** | `try/catch` around `stat` and `readFile` |

## Usage

### Enable

1. Symlink the workspace extension into the runtime extension directory:

   ```bash
   ln -sfn ~/.openclaw/workspace/extensions/skill-auto-suggest ~/.openclaw/extensions/skill-auto-suggest
   ```

2. Add to `~/.openclaw/openclaw.json` under `plugins.entries` (or via `openclaw extension enable`):

   ```json
   {
     "skill-auto-suggest": {
       "enabled": true,
       "hooks": {
         "allowConversationAccess": true
       },
       "config": {
         "embeddingProvider": "ollama",
         "ollamaBaseUrl": "http://localhost:11434",
         "ollamaModel": "nomic-embed-text",
         "vectorWeight": 0.7
       }
     }
   }
   ```

   Config options:

   | Key | Type | Default | Description |
   |-----|------|---------|-------------|
   | `embeddingProvider` | string | `"ollama"` | `"ollama"` or `"disabled"` |
   | `ollamaBaseUrl` | string | `"http://localhost:11434"` | Ollama server URL |
   | `ollamaModel` | string | `"nomic-embed-text"` | Embedding model name |
   | `vectorWeight` | number | `0.7` | Blend weight for vector vs keyword score (`0` = keyword only) |

3. (Optional but recommended) If your learned skills are symlinked from
   `skills-learned/`, add that directory to `skills.load.allowSymlinkTargets`
   to avoid OpenClaw skill-scanner warnings:

   ```json
   {
     "skills": {
       "load": {
         "allowSymlinkTargets": [
           "~/.openclaw/workspace/skills-learned"
         ]
       }
     }
   }
   ```

### Self-test

```bash
cd ~/.openclaw/workspace/extensions/skill-auto-suggest
node test.mjs
```

Expected: all 10 scenarios pass.

### Sample output

User asks: "My cron job keeps failing, help me debug it"

```xml
<suggested_skills>
The user's task may benefit from one of these skills. Read the SKILL.md if a match is strong enough:
1. cron-troubleshooting (score: 0.45)
2. cron-health-triage (score: 0.32)
3. error-auto-issue (score: 0.21)
</suggested_skills>
```

(Scores are task-dependent; this is illustrative.)

## Known limitations

- **English-centric embeddings** — Default `nomic-embed-text` works best for English tasks; CJK-heavy tasks automatically fall back to keyword matching
- **No fuzzy matching** — typo in user task → low score
- **Chinese/Cantonese semantic gap** — Skill descriptions are currently English-only; mixed tasks match on shared ASCII tokens (e.g. "cron", "email", "issue")
- **Telemetry is local-only** — Events are logged but not yet correlated with whether Ally actually used a suggested skill
- **First-run embedding cost** — The first prompt after a skill change triggers one Ollama embedding call per skill (~39 calls); subsequent prompts use the cached embeddings

## Related

- `extensions/skill-learner/index.mjs` — sibling plugin that **creates** skills
- `scripts/lib/skill_discovery.js` — shared skill directory scanner
- `scripts/lib/frontmatter.js` — shared YAML frontmatter parser
- `scripts/skill_inspector.js` — Step 1 CLI tool
- `~/.openclaw/workspace/.skill_auto_suggest_telemetry.jsonl` — local suggestion telemetry
- `~/.openclaw/workspace/.skill_auto_suggest_embeddings.json` — cached skill-description embeddings
- Issue #163.1 — Skill Viewer roadmap
- Issue #163.2 — Usage telemetry (Step 4)
- `.spawn/reports/disable-model-invocation-research-2026-06-14.md` — research that informed this design
