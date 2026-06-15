/**
 * embedding.mjs — Pluggable embedding provider + vector similarity helpers.
 *
 * Default provider: Ollama (http://localhost:11434) with nomic-embed-text.
 * Designed to be swapped for OpenAI-compatible or other providers later.
 */

/**
 * Create an Ollama embedding provider.
 *
 * @param {Object} opts
 * @param {string} opts.baseUrl   — Ollama base URL (default: http://localhost:11434)
 * @param {string} opts.model     — model name (default: nomic-embed-text)
 * @returns {{ embed: (text: string) => Promise<number[]> }}
 */
export function createOllamaProvider(opts = {}) {
  const baseUrl = (opts.baseUrl || "http://localhost:11434").replace(/\/$/, "");
  const model = opts.model || "nomic-embed-text";

  return {
    async embed(text) {
      const url = `${baseUrl}/api/embeddings`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Ollama embedding failed: ${res.status} ${body}`);
      }
      const data = await res.json();
      if (!Array.isArray(data.embedding)) {
        throw new Error("Ollama embedding response missing embedding array");
      }
      return data.embedding;
    },
    model,
  };
}

/**
 * Create a no-op provider that always fails.
 * Used when embedding is disabled or unavailable, forcing keyword fallback.
 */
export function createDisabledProvider() {
  return {
    async embed() {
      throw new Error("embedding disabled");
    },
    model: "disabled",
  };
}

/**
 * Compute cosine similarity between two vectors.
 * Returns a value in [-1, 1].
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Normalize cosine similarity to a [0, 1] score.
 * Cosine range [-1, 1] is shifted/scaled to [0, 1].
 */
export function normalizeSimilarity(similarity) {
  return Math.max(0, Math.min(1, (similarity + 1) / 2));
}

/**
 * Create a provider from a config object.
 *
 * @param {Object} config
 * @param {string} [config.embeddingProvider] — "ollama" | "disabled"
 * @param {string} [config.ollamaBaseUrl]
 * @param {string} [config.ollamaModel]
 */
export function createProviderFromConfig(config = {}) {
  const provider = config.embeddingProvider || "ollama";
  if (provider === "disabled") return createDisabledProvider();
  if (provider === "ollama") {
    return createOllamaProvider({
      baseUrl: config.ollamaBaseUrl,
      model: config.ollamaModel,
    });
  }
  throw new Error(`Unknown embedding provider: ${provider}`);
}
