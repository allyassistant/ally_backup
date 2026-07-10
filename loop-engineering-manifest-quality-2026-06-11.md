Here is the complete 8-part report on the Termination Manifest quality standards. I'm outputting the full report directly per the task's explicit instruction ("直接 output 完整報告喺你 final response，唔好淨係話「寫咗喺 file」").

---

# 1.1 Termination Manifest Deep Analysis — 質量標準定義

**Author:** M3 sub-agent (SPAWN_QUALITY)
**Date:** 2026-06-11 19:49 HKT
**Route:** SPAWN_QUALITY (MiniMax-M3) — Josh explicit M3 request
**Scope:** 4.5hr design, 8 parts, 26 crons (5 LLM full + 21 non-LLM light)
**Related:**
- `loop-engineering-analysis-2026-06-11.md` (7,000 字 M3 deep analysis)
- `loop-engineering-phase1-plan-2026-06-11.md` (M3 phase plan)
- `skills-learned/loop-engineering-implementation/SKILL.md`
- `HEARTBEAT.md` (26 crons list)

---

## Josh 核心問題

> **「點為之行完 + 達到質量標準先算完成」**

呢個問題可以拆成 3 個 orthogonal dimension：
- **D1「行完」** = Execution completion (binary: 跑完/未跑完)
- **D2「質量標準」** = Quality completion (spectrum: 0-100 分)
- **D3「失敗點 handle」** = Failure handling (recovery mechanism)

Termination Manifest 嘅 job 係統一呢 3 個 dimension 嘅 vocabulary，令每個 cron 嘅「OK / not OK / 要 escalate」可以客觀判斷，唔靠人睇 log。

---

## Part 1: Manifest Schema 詳細設計

### 1.1 Format 揀邊個: YAML

| Option | Pros | Cons | 結論 |
|--------|------|------|------|
| **YAML** ✅ | 人 readable、git diff friendly、lark/obsidian 都識 parse、Phase 1 plan 已經用緊 | 冇 native schema validation | **揀** |
| JSON | machine 啱使、native validation | 唔 readable、git diff 嘈、每次 add field 要更新所有 entry | 唔啁 |
| Markdown table | 最 readable | 冇 nested structure（quality_checks 入面有 sub-field 處理唔到）| 唔啁 |
| TOML | 兩者之間 | Node.js 支援麻麻 | 唔啁 |

**YAML + JSON Schema 雙轨：** YAML 嘅 schema 喺 `cron_config/manifest_schema.json` 描述，`scripts/validate_manifest.js` 自動驗證。咁就有 readability + validation 雙重保證。

### 1.2 5 LLM Crons — Full Spec Schema Fields

```yaml
# === LLM Cron: Full Spec ===
# 對應 Phase 1 plan Part 1 揀嘅 5 個 LLM crons

cron_name:
  # ── Basic ──
  schedule: "string"             # cron 表達式
  script: "string"               # relative path
  is_llm: true                   # flag for shared lib
  enabled: true                  # kill switch (false = cron skip)

  # ── Execution window ──
  runtime_window_sec:
    expected: 60                 # baseline (anomaly detection 用)
    max: 120                     # hard cap (cron timeoutSeconds 必須 ≥ 此值)

  # ── Success signals (D1: 行完) ──
  success_artifact: "string"     # 主要 file path (e.g. ".skill_review_queue.jsonl")
  expected_artifact_min_size_bytes: 100
  success_log_pattern: "regex"   # grep regex (e.g. "\\[DONE\\] .* completed")
  expected_log_min_lines: 1      # min lines in cron output for "ran"

  # ── Quality checks (D2: 質量標準) ──
  quality_checks:
    - type: output_length        # A) Length
      min_chars: 200             # L0 基準；L1=600；Daily Summary=100
      target_chars: 500
    - type: structural           # B) Sections
      required_sections: ["## Quality", "## Notes"]
    - type: sanity               # D) Forbidden patterns
      forbidden_patterns: ["undefined", "NaN", "[TODO]"]
    - type: cross_reference      # E) Sources
      must_cite_at_least: 1
    - type: format               # format check
      format: "json" | "markdown"
    - type: llm_judge            # C) LLM-as-judge (optional, expensive)
      judge_prompt: "Rate 1-5 for completeness"
      min_score: 3
      judge_model: "minimax-portal/MiniMax-M2.7"
      cost_budget_usd: 0.02

  # ── Failure classification (D3) ──
  hard_failures:                 # Tier 1 — exit non-zero
    - llm_call_timeout
    - manifest_file_missing
    - artifact_size_zero
  soft_warnings:                 # Tier 2 — log only
    - output_length_below_min
    - structural_check_partial
    - runtime_above_expected

  # ── Recovery config (Part 4) ──
  recovery_action: "retry"       # retry | circuit_break | escalate
  failure_history_window_days: 7
  failure_thresholds:
    self_recover: 2
    alert: 3
    circuit_break: 5

  # ── Observability ──
  tracking_file: ".token_budget.jsonl"  # append-only
```

### 1.3 21 Non-LLM Crons — Light Spec Schema Fields

```yaml
# === Non-LLM Cron: Light Spec ===
# 冇 LLM output，quality checks 改為 process-level

cron_name:
  schedule: "string"
  script: "string"
  is_llm: false
  enabled: true

  runtime_window_sec:
    expected: 30                 # baseline
    max: 60                      # hard cap

  # ── Success signals (D1) ──
  success_artifact: "string"     # 例如 ".skill_junk_rate.jsonl"
  expected_artifact_min_size_bytes: 50

  # ── Quality checks (D2) — 改為 process quality ──
  quality_checks:
    - type: runtime              # process check
      max_runtime_sec: 60
    - type: coverage             # F) Idempotency / coverage
      min_coverage_percent: 95   # e.g. processed 95/100 records
    - type: error_count
      max_critical_errors: 0
      max_warnings: 5
    - type: idempotency          # F) Idempotency check
      enabled: true

  hard_failures:
    - script_exit_nonzero
    - artifact_size_zero
  soft_warnings:
    - runtime_above_expected
    - coverage_below_min

  recovery_action: "retry"
  failure_thresholds:
    self_recover: 2
    alert: 3
    circuit_break: 5
```

### 1.4 Complete Manifest Entry 1: Skill Reviewer (LLM, Full Spec)

**Grep evidence:** `scripts/skill_reviewer_bot.js:604` (LLM call location), line 30 (MODEL = 'minimax-portal/MiniMax-M2.7'), line 35 (TIMEOUT_MS = 300000 = 5min hard limit, our cap is 2min so kill-switch 一致).

```yaml
# LLM Cron: Skill Reviewer (30 min loop, highest frequency)
skill_reviewer:
  schedule: "*/30 * * * *"
  script: "scripts/skill_reviewer_bot.js --quiet"
  is_llm: true
  enabled: true

  runtime_window_sec:
    expected: 60                 # baseline: 30-90s typical
    max: 120                     # hard cap (cron timeoutSeconds = 180, 留 buffer)

  success_artifact: ".skill_review_queue.jsonl"
  expected_artifact_min_size_bytes: 100  # queue should not be empty
  success_log_pattern: "\\[DONE\\] Review completed|Queue empty, no action"
  expected_log_min_lines: 1

  quality_checks:
    - type: output_length        # A) Length
      min_chars: 200             # SKILL.md body 至少 200 chars
      target_chars: 800          # target 800 chars
    - type: structural           # B) Sections
      required_sections:
        - "## When to Use"
        - "## Quality"
      optional_sections:
        - "## Steps"
        - "## Pitfalls"
    - type: sanity               # D) Forbidden
      forbidden_patterns:
        - "undefined"
        - "NaN"
        - "[TODO]"
        - "\\[PLACEHOLDER\\]"
    - type: cross_reference      # E) Sources
      must_cite_at_least: 1      # at least 1 source reference
    - type: format
      format: "markdown"         # SKILL.md must be valid markdown
    # llm_judge skipped here (cost vs value ratio 唔抵；QW-1~5 已經提供 validator gate)

  hard_failures:
    - llm_call_timeout           # > 5 min TIMEOUT_MS
    - manifest_file_missing      # .skill_review_queue.jsonl 不存在
    - artifact_size_zero         # queue empty + no skill reviewed = potential fail
    - llm_response_empty         # LLM call returned empty

  soft_warnings:
    - output_length_below_min    # < 200 chars (suspicious)
    - structural_check_partial   # missing 1 optional section
    - runtime_above_expected     # > 60s but < 120s
    - queue_overflow             # > 50 items in queue (back-pressure)

  recovery_action: "retry"
  failure_history_window_days: 7
  failure_thresholds:
    self_recover: 2              # ≤2 fails in 7d
    alert: 3                     # 3-4 fails
    circuit_break: 5             # ≥5 fails → pause

  tracking_file: ".token_budget.jsonl"
  notes: |
    Highest-frequency LLM cron (48 calls/day).
    Hard cap is critical: at $0.03/call × 48 = $1.44/day,
    a stuck loop could burn $43/month silently.
    QW-1~5 validators (commit bcf253c) handle content quality;
    manifest handles execution quality.
```

### 1.5 Complete Manifest Entry 2: Skill Junk Tracker (Non-LLM, Light Spec)

**Grep evidence:** `scripts/skill_junk_tracker.js:69-87` (rolling 7-day computation), line 125 (target = 10.0%, pass target check).

```yaml
# Non-LLM Cron: Skill Junk Rate Tracker (daily 23:55)
skill_junk_tracker:
  schedule: "55 23 * * *"
  script: "scripts/skill_junk_tracker.js --days 1 --quiet"
  is_llm: false
  enabled: true

  runtime_window_sec:
    expected: 5                  # baseline: 1-3s for 100 events
    max: 30                      # hard cap (cron timeoutSeconds = 60)

  success_artifact: ".skill_junk_rate.jsonl"
  expected_artifact_min_size_bytes: 50  # JSON line ~100 bytes

  quality_checks:
    - type: runtime
      max_runtime_sec: 30
    - type: coverage             # F) Idempotency / coverage
      min_coverage_percent: 95   # must read ≥95% of .skill_created.jsonl events
    - type: error_count
      max_critical_errors: 0
      max_warnings: 3
    - type: idempotency          # F) Idempotency
      enabled: true
      hash_strategy: "input_content_hash"  # re-run same day → same output
    - type: numeric_sanity       # extra: non-LLM specific
      field: "junkRatePercent"
      expected_range: [0, 100]   # must be valid percentage

  hard_failures:
    - script_exit_nonzero        # Node.js crash
    - artifact_size_zero         # no log entry written
    - source_file_missing        # .skill_created.jsonl 不存在

  soft_warnings:
    - runtime_above_expected     # > 5s (suspiciously slow)
    - coverage_below_min         # < 95% of events processed
    - junk_rate_above_target     # junk rate > 10% (the actual business KPI)

  recovery_action: "retry"
  failure_history_window_days: 7
  failure_thresholds:
    self_recover: 2
    alert: 3
    circuit_break: 5

  tracking_file: ".skill_junk_rate.jsonl"
  business_kpi:
    field: "junkRatePercent"
    target: 10.0
    alert_threshold: 30.0        # different from system failure — business alert
    notes: |
      Cron can run perfectly (Tier 1 success) while business KPI is bad
      (junk rate > 30%). Manifest separates these:
        - hard_failure = cron itself broke
        - business_alert = cron ran OK but junk rate is alarming
      Both should be tracked, but only hard_failure triggers circuit breaker.
```

**Insight:** Manifest distinguishes **execution quality** (did it run?) from **business quality** (was the output good?). Cron failure ≠ business failure. Both need tracking, but recovery actions are different.

---

## Part 2: Quality Check Implementation 詳解 (6 Checks A-F)

**Design principle:** All checks return a **tier (0/1/2/3/4)** + **message**. Shared lib `lib/quality_checks.js` exposes functions, called by cron wrapper or post-LLM hook.

### A) Output Length Check (`min_chars: 200`)

| Field | Spec |
|-------|------|
| **Where** | Post-LLM call, before save file (e.g. after line 604 in skill_reviewer_bot.js) |
| **What data flows** | Input: LLM response string + min_chars. Output: `{ tier: 0-4, actualChars, message }` |
| **How** | `response.trim().length` (chars) + `response.split(/\s+/).length` (words). Compare to threshold. |
| **Failure handling** | Below min → tier 2 (soft warning). Log + save with quality flag. |
| **Cost** | < 1ms (string length is O(1)) |

**Edge case: LLM output 係 code/JSON, words 唔準**
- **Solution:** Use `chars` not `words` for primary check. Code/JSON 嘅「length」用 chars 更 reliable. `words` heuristic 只做 secondary signal.
- **Example:** `{"foo": "bar"}` 12 chars vs 2 words — 兩者都算合格因為我哋用 chars.

```javascript
// lib/quality_checks.js
function checkOutputLength(response, minChars, targetChars) {
  const trimmed = (response || '').trim();
  const actualChars = trimmed.length;
  const actualWords = trimmed.split(/\s+/).filter(Boolean).length;

  if (actualChars === 0) {
    return { tier: 1, actualChars, actualWords,
             message: 'EMPTY output — hard fail (no chars)' };
  }
  if (actualChars < minChars) {
    return { tier: 2, actualChars, actualWords,
             message: `Output ${actualChars} chars < min ${minChars} (soft fail)` };
  }
  if (actualChars < targetChars) {
    return { tier: 4, actualChars, actualWords,
             message: `Output ${actualChars} < target ${targetChars} chars (pass with note)` };
  }
  return { tier: 0, actualChars, actualWords, message: 'PASS' };
}
```

### B) Structural Check (`required_sections: ["## When to Use", "## Quality"]`)

| Field | Spec |
|-------|------|
| **Where** | Post-write, after file saved (or post-LLM, before save) |
| **What data flows** | Input: file content (string) + required_sections list. Output: `{ tier, missing, present }` |
| **How** | For each section, regex match `^#{1,3}\s+${escape(section)}` |
| **Failure handling** | Any required section missing → tier 2 (soft). All missing → tier 1 (hard). |
| **Cost** | < 5ms (regex per section, typically 3-5 sections) |

**Edge case: 標題可能係 "## Summary" 或 "## Summary：" 或 "## Summary -"**
- **Solution:** Normalize section name (strip trailing `:`, `-`, whitespace, lowercase first letter match).

```javascript
function normalizeSectionName(s) {
  return s
    .replace(/[:：\-—_]+$/, '')      // strip trailing punctuation
    .replace(/\s+/g, ' ')             // collapse whitespace
    .trim();
}

function checkStructural(content, requiredSections) {
  const lines = (content || '').split('\n');
  const present = [];
  const missing = [];

  for (const required of requiredSections) {
    const normalizedReq = normalizeSectionName(required).toLowerCase();
    const found = lines.some(line => {
      const m = line.match(/^#{1,3}\s+(.+)/);
      if (!m) return false;
      return normalizeSectionName(m[1]).toLowerCase() === normalizedReq;
    });
    if (found) present.push(required);
    else missing.push(required);
  }

  if (missing.length === 0) return { tier: 0, present, missing, message: 'PASS' };
  if (missing.length === requiredSections.length) {
    return { tier: 1, present, missing,
             message: `ALL required sections missing: ${missing.join(', ')}` };
  }
  return { tier: 2, present, missing,
           message: `Partial sections: missing ${missing.join(', ')}` };
}
```

### C) LLM-as-a-Judge (`judge_prompt: "Rate 1-5 for completeness"`, `min_score: 3`)

| Field | Spec |
|-------|------|
| **Where** | Post-output, **additional LLM call** (always isolated sub-agent) |
| **What data flows** | Input: original_output + judge_prompt + judge_model. Output: `{ tier, score, reasoning }` |
| **How** | Spawn sub-agent (M2.7 cheap), parse rating 1-5, compare to min_score |
| **Failure handling** | Judge LLM 死咗 → fallback to no-judge (treat as tier 4 pass-with-note, log warning) |
| **Cost** | ~$0.005-0.02 per call (M2.7 judge). Skipped by default; enable per-cron via manifest flag. |

**Edge case: Judge LLM 死咗 / 答非所問**
- **Solution 3-tier fallback:**
  1. **Primary judge:** M2.7 (cheap). Timeout 30s.
  2. **Fallback 1:** deepseek-v4-flash. Timeout 30s.
  3. **Fallback 2 (degraded):** Skip judge, return tier 4 (pass with note: "judge unavailable, manual review recommended"). Log + Discord warn.
- **Failure injection:** Judge LLM answer non-numeric (e.g. "Yes I'd say it's good") → regex `/\b([1-5])\b/` extract. If no match → fallback to tier 4.

```javascript
async function checkLlmJudge(originalOutput, judgePrompt, minScore, model = 'minimax-portal/MiniMax-M2.7') {
  const fullPrompt = `${judgePrompt}\n\n---\n\nOutput to judge:\n${originalOutput}\n\n---\n\nRate 1-5 (just the number, no explanation):`;

  for (const m of [model, 'deepseek/deepseek-v4-flash']) {
    try {
      const result = execFileSync('openclaw', [
        'infer', 'model', 'run',
        '--model', m,
        '--max-tokens', '20',
        '--input', fullPrompt
      ], { timeout: 30000, encoding: 'utf8' });

      const match = result.match(/\b([1-5])\b/);
      if (!match) continue;  // try fallback

      const score = parseInt(match[1], 10);
      if (score < minScore) {
        return { tier: 2, score, model: m,
                 message: `Judge score ${score} < min ${minScore}` };
      }
      return { tier: 0, score, model: m, message: `Judge PASS (${score}/5)` };
    } catch (e) {
      // timeout / network → try next fallback
      continue;
    }
  }
  return { tier: 4, score: null, model: null,
           message: 'All judge models failed — pass with note, manual review' };
}
```

### D) Sanity Check (`forbidden_patterns: ["undefined", "NaN", "[TODO]"]`)

| Field | Spec |
|-------|------|
| **Where** | Post-LLM, **before save** (catch garbage early) |
| **What data flows** | Input: response + forbidden list. Output: `{ tier, hits, message }` |
| **How** | For each pattern, regex search. If hit → tier 2 (or tier 1 if critical pattern). |
| **Failure handling** | Any hit → tier 2 soft fail. Multiple hits → tier 1 hard fail. |
| **Cost** | < 1ms per pattern |

**Edge case: 正當 output 偶然有 "..." (ellipsis) — false positive 點避免?**
- **Solution:** Use word-boundary regex, exclude ellipsis `...` from default patterns, allow per-cron override.
- **Example:** `\bundefined\b` 唔會 hit `undefinedBehavior` (camelCase identifier). `[TODO]` 用 bracket-wrapped pattern 避免 hit `today` / `todoList`.

```javascript
function checkSanity(content, forbiddenPatterns) {
  // Default patterns are word-bounded to reduce false positives
  const defaultSafe = {
    'undefined': /\bundefined\b/i,
    'NaN': /\bNaN\b/,
    '[TODO]': /\[TODO\]/,
    '[PLACEHOLDER]': /\[PLACEHOLDER\]/,
    'XXX': /\bXXX\b/  // comment placeholder
  };

  const hits = [];
  const patterns = forbiddenPatterns || Object.keys(defaultSafe);

  for (const p of patterns) {
    const re = defaultSafe[p] || new RegExp(p, 'g');
    const matches = (content || '').match(re);
    if (matches && matches.length > 0) {
      hits.push({ pattern: p, count: matches.length });
    }
  }

  if (hits.length === 0) return { tier: 0, hits, message: 'PASS' };
  if (hits.length >= 3) {
    return { tier: 1, hits,
             message: `Multiple forbidden patterns (${hits.length})` };
  }
  return { tier: 2, hits,
           message: `Forbidden patterns found: ${hits.map(h => h.pattern).join(', ')}` };
}
```

### E) Cross-Reference Check (`must_cite_at_least: 1`)

| Field | Spec |
|-------|------|
| **Where** | Post-write |
| **What data flows** | Input: output content + required source IDs/regex. Output: `{ tier, foundSources, missing }` |
| **How** | Extract `\b\[\[([^\]]+)\]\]` (Obsidian wikilink) or `(\w+_log_id_\w+)` patterns. Compare to required list. |
| **Failure handling** | Below min → tier 2 (soft). Zero → tier 1 (hard, because cross-ref is core quality signal). |
| **Cost** | < 5ms (regex scan) |

**Edge case: Optional 引用 vs Required 引用**
- **Solution:** Manifest distinguishes `must_cite_at_least: N` (required, hard if zero) vs `optional_cite_recommended: N` (soft warning if below).

```javascript
function checkCrossReference(content, required, minCount) {
  // Extract all source-like patterns
  const wikilinks = (content || '').match(/\[\[([^\]]+)\]\]/g) || [];
  const logIds = (content || '').match(/\b(memory_log_id_\w+|session_\w+|issue_\d+)\b/g) || [];

  const found = [...new Set([...wikilinks, ...logIds])];

  // Check required sources are present
  const missing = (required || []).filter(r => !found.some(f => f.includes(r)));

  if (missing.length > 0) {
    return { tier: 1, foundSources: found, missing,
             message: `Required sources missing: ${missing.join(', ')}` };
  }
  if (found.length < minCount) {
    return { tier: 2, foundSources: found, missing: [],
             message: `Cross-ref count ${found.length} < min ${minCount}` };
  }
  return { tier: 0, foundSources: found, missing: [], message: `PASS (${found.length} refs)` };
}
```

### F) Idempotency Check (non-LLM, e.g. Skill Junk Tracker)

| Field | Spec |
|-------|------|
| **Where** | **Pre-run** (before script executes) |
| **What data flows** | Input: input data hash + previous output hash. Output: `{ tier, isDuplicate }` |
| **How** | Compute SHA256 of input file. Compare to last successful run's input hash. If same → flag as duplicate (warn, don't auto-skip). |
| **Failure handling** | Duplicate detected → tier 4 (pass with note: "re-run with identical input, output should be same"). |
| **Cost** | < 10ms (hash computation) |

**Edge case: Inputs slightly different but should be same output**
- **Solution:** Use **content hash with normalization** (strip timestamps, sort entries). Allow per-cron normalization rules in manifest.

```javascript
const crypto = require('crypto');
const fs = require('fs');

function checkIdempotency(inputFile, lastRunFile) {
  if (!fs.existsSync(inputFile) || !fs.existsSync(lastRunFile)) {
    return { tier: 0, isDuplicate: false, message: 'No prior run to compare' };
  }

  const inputHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(inputFile))
    .digest('hex')
    .slice(0, 16);

  let lastHash = null;
  try {
    const lastRun = JSON.parse(fs.readFileSync(lastRunFile, 'utf8'));
    lastHash = lastRun.inputHash;
  } catch (e) {
    return { tier: 0, isDuplicate: false, message: 'No prior run record' };
  }

  if (inputHash === lastHash) {
    return { tier: 4, isDuplicate: true, inputHash,
             message: 'Identical input as last run — output should be identical' };
  }
  return { tier: 0, isDuplicate: false, inputHash, message: 'New input, proceed' };
}
```

### Check Cost Summary

| Check | Cost (ms) | When | Tier impact |
|-------|-----------|------|-------------|
| A) Length | <1 | post-LLM | soft |
| B) Structural | <5 | post-LLM/post-write | soft/hard |
| C) LLM Judge | 5000-30000 | post-output | soft (judge 死就 pass-with-note) |
| D) Sanity | <1 | post-LLM, pre-save | soft/hard |
| E) Cross-ref | <5 | post-write | soft/hard |
| F) Idempotency | <10 | pre-run | pass-with-note |

**Total overhead per LLM cron (without judge):** < 22ms. Negligible vs 60-120s LLM call.

---

## Part 3: 4 Quality Tiers

### Tier 1 — Hard Fail
- **Trigger:** Execution broke (no file written, exit non-zero, manifest file missing, LLM call timeout, empty response)
- **Action:** `process.exit(1)`, log error, **next cron run retries** (self-recover)
- **Cumulative impact:** 1 fail contributes to failure_thresholds circuit breaker
- **Example:** skill_reviewer: `manifest_file_missing` (`.skill_review_queue.jsonl` not found) → Tier 1

### Tier 2 — Soft Fail (Quality Warning)
- **Trigger:** Quality check failed but execution completed (e.g. < 200 chars, missing optional section, forbidden pattern found 1x)
- **Action:** Save with `quality_flag: "soft_fail"` in metadata, log warning, **cron still considered successful** (exit 0). Add to `.quality_warnings.jsonl` for review.
- **Cumulative impact:** 3 soft fails in a row → escalate to Tier 1 (count as 1 hard fail in circuit breaker counter)
- **Example:** L0 generator produces 180 chars (target 200+) → Tier 2, file still written, daily synthesis still includes it

### Tier 3 — Degraded (Partial Success)
- **Trigger:** LLM call timed out halfway / partial output written / some quality checks failed AND artifact exists
- **Action:** Save partial output to `.partial/<date>-<cron>.md`, mark with `quality_flag: "degraded"`, **exit 0** (cron succeeded with caveats), notify Discord #⚙️系統 (warning level)
- **Cumulative impact:** 1 degraded = 0.5 hard fail in circuit breaker counter (so 10 degraded = 5 hard fail = circuit break)
- **Example:** Knowledge Ingester LLM call timed out at 180s, but 3 of 5 documents classified → Tier 3, partial state, Discord warn

### Tier 4 — Pass with Note
- **Trigger:** All quality checks passed BUT warning signs (e.g. runtime > expected, idempotency detected, judge unavailable, output length between min and target)
- **Action:** Save normally with `quality_flag: "pass_with_note"`, log info, **no alert**
- **Cumulative impact:** 0 (informational only)
- **Example:** L1 generator took 280s (expected 200s, max 300s) → Tier 4, pass, but noted for performance trend

### Tier 表格 Summary

| Tier | Cron status | Exit code | File saved? | Discord notify? | Circuit breaker weight |
|------|-------------|-----------|-------------|-----------------|------------------------|
| **0 PASS** | success | 0 | yes (clean) | no | 0 |
| **4 Pass+Note** | success | 0 | yes (with note) | no | 0 |
| **2 Soft** | success | 0 | yes (flagged) | no (logged) | 0 |
| **3 Degraded** | partial | 0 | yes (partial) | yes (warn) | 0.5 |
| **1 Hard** | failure | 1 | no | yes (error) | 1.0 |

**Insight:** Tier 3 (degraded) is the trickiest — cron can be "successful" (exit 0, file written) but with caveats. Manifest distinguishes via `quality_flag` so downstream synthesis (Daily Summary) knows to flag these.

---

## Part 4: Failure Recovery Mechanisms (4 Tiers)

**Implementation file:** `scripts/cron_recovery_monitor.js` (per Part 5)
**Data source:** `.cron_failure.jsonl` (append-only, every cron run logs `{ ts, cron, tier, reason, exitCode }`)
**Decision logic:** Reads `.cron_failure.jsonl`, applies rolling 7-day window, triggers Tier A/B/C/D.

### Tier A — Self-Recovery
- **Trigger condition:** Single failure (any tier) in past 24h
- **Action sequence:**
  1. Log fail to `.cron_failure.jsonl`
  2. Exit code based on tier (1 = hard fail, 0 = soft/degraded)
  3. Next cron run retries automatically (cron schedule handles this)
- **Recovery path:** Default — no human action needed
- **Notification:** None (silent recovery)
- **Threshold:** ≤ 2 fails in 7 days = Tier A

### Tier B — Alert (Notify but Continue)
- **Trigger condition:** 3 fails in 7 days (configurable per cron)
- **Action sequence:**
  1. Send Discord #⚙️系統 embed with cron name, failure history, sample error logs
  2. Still auto-retry next run (no auto-pause)
  3. Track in `.cron_alerts.jsonl` (audit trail)
- **Recovery path:** If next 3 runs succeed, downgrade to Tier A (auto-recover)
- **Notification:** Discord message with `re-enable` instruction if circuit breaks later
- **Threshold:** 3-4 fails in 7 days = Tier B

### Tier C — Circuit Break (Pause + Manual)
- **Trigger condition:** ≥ 5 fails in 7 days
- **Action sequence:**
  1. Set `enabled: false` in manifest YAML (atomic write)
  2. Send Discord #⚙️系統 with full diagnostic: last 5 error logs, runtime trend, suggested next steps
  3. **Cron 暫停** — next runs no-op (manifest `enabled: false` check)
  4. Provide `re-enable` command: `node scripts/cron_recovery_monitor.js --re-enable <cron_name>`
- **Recovery path:** Josh manually:
  1. Reviews Discord diagnostic
  2. Investigates (read scripts, check dependencies)
  3. If safe: run re-enable command → manifest `enabled: true` → cron resumes
  4. If unsafe: leave disabled, create issue
- **Notification:** Discord alert with `re-enable` button + `node scripts/cron_recovery_monitor.js --re-enable <name>` command
- **Threshold:** ≥ 5 fails in 7 days = Tier C

### Tier D — Escalation (Critical Failure Pattern)
- **Trigger condition:** Quality degraded progressively (e.g. average tier score < 0.6 for 3 consecutive days) OR cross-system impact detected
- **Action sequence:**
  1. Spawn M3 sub-agent (debug specialist) with full diagnostic bundle
  2. Sub-agent investigates (read scripts, check external dependencies, analyze failure pattern)
  3. Send full diagnostic to Josh (Discord DM or #⚙️系統 thread)
  4. Do **NOT** auto-disable — wait for Josh decision
- **Recovery path:** Josh reviews sub-agent's report, decides: re-enable, modify script, or retire cron
- **Notification:** Discord #⚙️系統 thread with sub-agent's full analysis
- **Threshold:** avg tier < 0.6 for 3 days = Tier D

### Tier Comparison Table

| Tier | Trigger | Action | Cron running? | Notify? | Auto-recover? |
|------|---------|--------|---------------|---------|---------------|
| **A Self** | 1-2 fails/7d | log + retry | yes | no | yes |
| **B Alert** | 3-4 fails/7d | Discord warn + retry | yes | yes (warn) | yes (3 success) |
| **C Break** | ≥5 fails/7d | disable + Discord | no | yes (alert) | no (manual) |
| **D Escalate** | avg tier < 0.6 / 3d | spawn debug agent | yes | yes (full diag) | no (manual) |

**Insight:** Tier C and D both require manual intervention, but Tier C is "cron broken" (specific failure) while Tier D is "quality pattern broken" (gradual degradation). Manifest distinguishes via `quality_score` trend tracking.

---

## Part 5: Code & Config Examples (4 Required)

### Example 1: Manifest YAML (subset, full file at `docs/loop_termination_manifest.yaml`)

```yaml
# docs/loop_termination_manifest.yaml
# Loop Termination Manifest — 26 crons
# Generated: 2026-06-11
# Spec: SPAWN_QUALITY analysis

schema_version: 1
manifest_metadata:
  description: "Termination conditions for all Ally/Bliss crons"
  author: "Ally M3 sub-agent"
  observation_period: "2026-06-18 to 2026-06-25"

# ──────────────────────────────────────────────
# LLM Crons (5 — full spec)
# ──────────────────────────────────────────────

skill_reviewer:
  schedule: "*/30 * * * *"
  script: "scripts/skill_reviewer_bot.js --quiet"
  is_llm: true
  enabled: true
  runtime_window_sec: { expected: 60, max: 120 }
  success_artifact: ".skill_review_queue.jsonl"
  expected_artifact_min_size_bytes: 100
  success_log_pattern: "\\[DONE\\] Review completed|Queue empty"
  expected_log_min_lines: 1
  quality_checks:
    - { type: output_length, min_chars: 200, target_chars: 800 }
    - { type: structural, required_sections: ["## When to Use", "## Quality"] }
    - { type: sanity, forbidden_patterns: ["undefined", "NaN", "[TODO]"] }
    - { type: cross_reference, must_cite_at_least: 1 }
    - { type: format, format: "markdown" }
  hard_failures: [llm_call_timeout, manifest_file_missing, llm_response_empty]
  soft_warnings: [output_length_below_min, structural_check_partial, queue_overflow]
  recovery_action: retry
  failure_thresholds: { self_recover: 2, alert: 3, circuit_break: 5 }
  tracking_file: ".token_budget.jsonl"

knowledge_ingester:
  schedule: "25 6 * * *"
  script: "scripts/knowledge_ingester.js --discord-channel 1473376125584670872"
  is_llm: true
  enabled: true
  runtime_window_sec: { expected: 90, max: 180 }
  success_artifact: "memory/kb-ingest/$(date +%Y-%m-%d).jsonl"
  expected_artifact_min_size_bytes: 500
  success_log_pattern: "\\[DONE\\] Ingested \\d+ items"
  quality_checks:
    - { type: output_length, min_chars: 100, target_chars: 500 }
    - { type: structural, required_sections: ["## Summary"] }
    - { type: sanity, forbidden_patterns: ["undefined", "NaN"] }
    - { type: coverage, min_coverage_percent: 90 }  # ≥90% input docs processed
  hard_failures: [llm_call_timeout, no_documents_processed]
  soft_warnings: [partial_ingest, output_length_below_min]
  recovery_action: retry
  failure_thresholds: { self_recover: 2, alert: 3, circuit_break: 5 }

l1_generator:
  schedule: "35 0 * * *"
  script: "node scripts/memory_generator.js --level L1"
  is_llm: true
  enabled: true
  runtime_window_sec: { expected: 200, max: 300 }
  success_artifact: "memory/l1-overview/$(date +%Y-%m-%d).md"
  expected_artifact_min_size_bytes: 600  # L1 must be ≥600 chars per spec
  success_log_pattern: "\\[DONE\\] L1 generation complete"
  quality_checks:
    - { type: output_length, min_chars: 600, target_chars: 1200 }  # L1 spec
    - { type: structural, required_sections: ["## Summary", "## Insights", "## Notes"] }
    - { type: sanity, forbidden_patterns: ["undefined", "NaN", "[TODO]"] }
    - { type: cross_reference, must_cite_at_least: 2 }  # L1 must reference multiple L0
  hard_failures: [llm_call_timeout, file_write_failed, output_empty]
  soft_warnings: [output_length_below_min, structural_check_partial]
  recovery_action: retry
  failure_thresholds: { self_recover: 2, alert: 3, circuit_break: 5 }

l0_generator:
  schedule: "5 0 * * *"
  script: "node scripts/memory_generator.js --level L0"
  is_llm: true
  enabled: true
  runtime_window_sec: { expected: 60, max: 120 }
  success_artifact: "memory/l0-abstract/$(date +%Y-%m-%d).md"
  expected_artifact_min_size_bytes: 200
  success_log_pattern: "\\[DONE\\] L0 generation complete"
  quality_checks:
    - { type: output_length, min_chars: 200, target_chars: 500 }
    - { type: structural, required_sections: ["## Summary"] }
    - { type: sanity, forbidden_patterns: ["undefined", "NaN", "[TODO]"] }
  hard_failures: [llm_call_timeout, file_write_failed]
  soft_warnings: [output_length_below_min]
  recovery_action: retry
  failure_thresholds: { self_recover: 2, alert: 3, circuit_break: 5 }

daily_summary:
  schedule: "59 23 * * *"
  script: "node scripts/daily_summary_bot.js"
  is_llm: true
  enabled: true
  runtime_window_sec: { expected: 90, max: 180 }
  success_artifact: "memory/daily-journal/$(date +%Y-%m-%d).md"
  expected_artifact_min_size_bytes: 300
  success_log_pattern: "Journal generated|Posted to Discord"
  quality_checks:
    - { type: output_length, min_chars: 100, target_chars: 600 }
    - { type: structural, required_sections: ["## Today's Summary", "## Insights"] }
    - { type: sanity, forbidden_patterns: ["undefined"] }
    - { type: llm_judge, judge_prompt: "Rate 1-5 for honesty (no fabrication)", min_score: 3, judge_model: "minimax-portal/MiniMax-M2.7", cost_budget_usd: 0.02 }
  hard_failures: [llm_call_timeout, no_journal_generated]
  soft_warnings: [output_length_below_min, judge_unavailable]
  recovery_action: retry
  failure_thresholds: { self_recover: 2, alert: 3, circuit_break: 5 }

# ──────────────────────────────────────────────
# Non-LLM Crons (21 — light spec, sample shown)
# ──────────────────────────────────────────────

skill_junk_tracker:
  schedule: "55 23 * * *"
  script: "node scripts/skill_junk_tracker.js --days 1 --quiet"
  is_llm: false
  enabled: true
  runtime_window_sec: { expected: 5, max: 30 }
  success_artifact: ".skill_junk_rate.jsonl"
  expected_artifact_min_size_bytes: 50
  quality_checks:
    - { type: runtime, max_runtime_sec: 30 }
    - { type: coverage, min_coverage_percent: 95 }
    - { type: error_count, max_critical_errors: 0, max_warnings: 3 }
    - { type: idempotency, enabled: true }
  hard_failures: [script_exit_nonzero, artifact_size_zero]
  soft_warnings: [runtime_above_expected, junk_rate_above_target]
  recovery_action: retry
  failure_thresholds: { self_recover: 2, alert: 3, circuit_break: 5 }
  business_kpi: { field: "junkRatePercent", target: 10.0, alert_threshold: 30.0 }

# (其他 20 個 non-LLM crons 用 light spec，省略)
# heartbeat, daily_maintenance, code_quality_manager, anomaly_monitor, etc.
```

### Example 2: Shared Check Library (`lib/quality_checks.js`)

```javascript
// lib/quality_checks.js — Shared quality check library
// 6 checks (A-F), each returns { tier, message, details }

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

/**
 * A) Output Length Check
 * @param {string} response - LLM output
 * @param {number} minChars - Hard minimum (Tier 2 if below)
 * @param {number} targetChars - Soft target (Tier 4 if below)
 * @returns {{tier: number, actualChars: number, actualWords: number, message: string}}
 */
function checkOutputLength(response, minChars, targetChars) {
  const trimmed = (response || '').trim();
  const actualChars = trimmed.length;
  const actualWords = trimmed.split(/\s+/).filter(Boolean).length;

  if (actualChars === 0) {
    return { tier: 1, actualChars, actualWords,
             message: 'EMPTY output — hard fail (no chars)' };
  }
  if (actualChars < minChars) {
    return { tier: 2, actualChars, actualWords,
             message: `Output ${actualChars} chars < min ${minChars} (soft fail)` };
  }
  if (actualChars < targetChars) {
    return { tier: 4, actualChars, actualWords,
             message: `Output ${actualChars} < target ${targetChars} chars (pass with note)` };
  }
  return { tier: 0, actualChars, actualWords, message: 'PASS' };
}

/**
 * B) Structural Check
 */
function normalizeSectionName(s) {
  return s.replace(/[:：\-—_]+$/, '').replace(/\s+/g, ' ').trim();
}

function checkStructural(content, requiredSections) {
  const lines = (content || '').split('\n');
  const present = [];
  const missing = [];

  for (const required of requiredSections) {
    const normalizedReq = normalizeSectionName(required).toLowerCase();
    const found = lines.some(line => {
      const m = line.match(/^#{1,3}\s+(.+)/);
      if (!m) return false;
      return normalizeSectionName(m[1]).toLowerCase() === normalizedReq;
    });
    if (found) present.push(required);
    else missing.push(required);
  }

  if (missing.length === 0) return { tier: 0, present, missing, message: 'PASS' };
  if (missing.length === requiredSections.length) {
    return { tier: 1, present, missing,
             message: `ALL required sections missing: ${missing.join(', ')}` };
  }
  return { tier: 2, present, missing,
           message: `Partial sections: missing ${missing.join(', ')}` };
}

/**
 * C) LLM-as-a-Judge (with 3-tier fallback)
 */
async function checkLlmJudge(originalOutput, judgePrompt, minScore,
                              primaryModel = 'minimax-portal/MiniMax-M2.7') {
  const fullPrompt = `${judgePrompt}\n\n---\n\nOutput to judge:\n${originalOutput}\n\n---\n\nRate 1-5 (just the number):`;
  const fallbacks = [primaryModel, 'deepseek/deepseek-v4-flash'];

  for (const m of fallbacks) {
    try {
      const result = execFileSync('openclaw', [
        'infer', 'model', 'run',
        '--model', m,
        '--max-tokens', '20',
        '--input', fullPrompt
      ], { timeout: 30000, encoding: 'utf8' });

      const match = result.match(/\b([1-5])\b/);
      if (!match) continue;

      const score = parseInt(match[1], 10);
      if (score < minScore) {
        return { tier: 2, score, model: m,
                 message: `Judge score ${score} < min ${minScore}` };
      }
      return { tier: 0, score, model: m, message: `Judge PASS (${score}/5)` };
    } catch (e) {
      continue;  // try next fallback
    }
  }
  return { tier: 4, score: null, model: null,
           message: 'All judge models failed — pass with note' };
}

/**
 * D) Sanity Check (forbidden patterns)
 */
function checkSanity(content, forbiddenPatterns) {
  const defaultSafe = {
    'undefined': /\bundefined\b/i,
    'NaN': /\bNaN\b/,
    '[TODO]': /\[TODO\]/,
    '[PLACEHOLDER]': /\[PLACEHOLDER\]/,
    'XXX': /\bXXX\b/
  };

  const hits = [];
  const patterns = forbiddenPatterns || Object.keys(defaultSafe);

  for (const p of patterns) {
    const re = defaultSafe[p] || new RegExp(p, 'g');
    const matches = (content || '').match(re);
    if (matches && matches.length > 0) {
      hits.push({ pattern: p, count: matches.length });
    }
  }

  if (hits.length === 0) return { tier: 0, hits, message: 'PASS' };
  if (hits.length >= 3) {
    return { tier: 1, hits, message: `Multiple forbidden patterns (${hits.length})` };
  }
  return { tier: 2, hits, message: `Forbidden patterns: ${hits.map(h => h.pattern).join(', ')}` };
}

/**
 * E) Cross-Reference Check
 */
function checkCrossReference(content, required, minCount) {
  const wikilinks = (content || '').match(/\[\[([^\]]+)\]\]/g) || [];
  const logIds = (content || '').match(/\b(memory_log_id_\w+|session_\w+|issue_\d+)\b/g) || [];
  const found = [...new Set([...wikilinks, ...logIds])];

  const missing = (required || []).filter(r => !found.some(f => f.includes(r)));

  if (missing.length > 0) {
    return { tier: 1, foundSources: found, missing,
             message: `Required sources missing: ${missing.join(', ')}` };
  }
  if (found.length < minCount) {
    return { tier: 2, foundSources: found, missing: [],
             message: `Cross-ref count ${found.length} < min ${minCount}` };
  }
  return { tier: 0, foundSources: found, missing: [], message: `PASS (${found.length} refs)` };
}

/**
 * F) Idempotency Check (pre-run)
 */
function checkIdempotency(inputFile, lastRunFile) {
  if (!fs.existsSync(inputFile) || !fs.existsSync(lastRunFile)) {
    return { tier: 0, isDuplicate: false, message: 'No prior run' };
  }

  const inputHash = crypto.createHash('sha256')
    .update(fs.readFileSync(inputFile)).digest('hex').slice(0, 16);

  let lastHash = null;
  try {
    const lastRun = JSON.parse(fs.readFileSync(lastRunFile, 'utf8'));
    lastHash = lastRun.inputHash;
  } catch (e) {
    return { tier: 0, isDuplicate: false, message: 'No prior run record' };
  }

  if (inputHash === lastHash) {
    return { tier: 4, isDuplicate: true, inputHash,
             message: 'Identical input as last run' };
  }
  return { tier: 0, isDuplicate: false, inputHash, message: 'New input' };
}

module.exports = {
  checkOutputLength,
  checkStructural,
  checkLlmJudge,
  checkSanity,
  checkCrossReference,
  checkIdempotency
};
```

### Example 3: Manifest Validation (`scripts/validate_manifest.js`)

```javascript
#!/usr/bin/env node
// scripts/validate_manifest.js — Manifest consistency validator
// Usage: node scripts/validate_manifest.js [--cron-config <yaml>]

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');  // need to add to package.json

const WORKSPACE = process.env.WORKSPACE_DIR || path.join(process.env.HOME, '.openclaw/workspace');
const MANIFEST = path.join(WORKSPACE, 'docs/loop_termination_manifest.yaml');

const errors = [];
const warnings = [];

function validate(manifest) {
  // 1. All 26 crons present
  const expectedCrons = [
    'skill_reviewer', 'knowledge_ingester', 'l1_generator', 'l0_generator', 'daily_summary',
    'skill_junk_tracker'  // + 20 others
  ];
  for (const c of expectedCrons) {
    if (!manifest[c]) errors.push(`Missing cron: ${c}`);
  }

  // 2. LLM crons have LLM-specific fields
  const llmCrons = ['skill_reviewer', 'knowledge_ingester', 'l1_generator', 'l0_generator', 'daily_summary'];
  for (const c of llmCrons) {
    const cron = manifest[c];
    if (!cron) continue;
    if (!cron.is_llm) errors.push(`${c}: LLM cron but is_llm=false`);
    if (!cron.success_log_pattern) errors.push(`${c}: missing success_log_pattern`);
    if (!cron.quality_checks || cron.quality_checks.length === 0) {
      errors.push(`${c}: LLM cron must have quality_checks`);
    }
  }

  // 3. runtime_window_sec.max ≤ cron timeoutSeconds
  for (const [name, cron] of Object.entries(manifest)) {
    if (typeof cron !== 'object' || !cron.runtime_window_sec) continue;
    const maxRuntime = cron.runtime_window_sec.max;
    // Assume cron timeoutSeconds ≈ 2x max_runtime (heuristic)
    const minTimeout = maxRuntime * 1.5;  // 1.5x buffer
    if (minTimeout > 600) {  // 10min hard limit
      warnings.push(`${name}: max_runtime ${maxRuntime}s suggests cron timeout should be ~${Math.ceil(minTimeout)}s`);
    }
  }

  // 4. failure_thresholds are monotonic
  for (const [name, cron] of Object.entries(manifest)) {
    if (typeof cron !== 'object' || !cron.failure_thresholds) continue;
    const t = cron.failure_thresholds;
    if (!(t.self_recover < t.alert && t.alert < t.circuit_break)) {
      errors.push(`${name}: failure_thresholds not monotonic (${t.self_recover} < ${t.alert} < ${t.circuit_break})`);
    }
  }

  // 5. quality_checks reference valid types
  const validCheckTypes = ['output_length', 'structural', 'sanity', 'cross_reference', 'format', 'llm_judge', 'runtime', 'coverage', 'error_count', 'idempotency', 'numeric_sanity'];
  for (const [name, cron] of Object.entries(manifest)) {
    if (typeof cron !== 'object' || !cron.quality_checks) continue;
    for (const check of cron.quality_checks) {
      if (!validCheckTypes.includes(check.type)) {
        errors.push(`${name}: invalid check type '${check.type}'`);
      }
    }
  }

  // 6. Non-LLM crons should have lighter checks
  for (const [name, cron] of Object.entries(manifest)) {
    if (typeof cron !== 'object' || cron.is_llm) continue;
    const hasLlmCheck = (cron.quality_checks || []).some(c =>
      ['output_length', 'llm_judge', 'cross_reference'].includes(c.type));
    if (hasLlmCheck) {
      warnings.push(`${name}: non-LLM cron has LLM-specific check (waste of CPU)`);
    }
  }
}

try {
  const data = yaml.load(fs.readFileSync(MANIFEST, 'utf8'));
  validate(data);
} catch (e) {
  console.error(`FATAL: manifest parse error: ${e.message}`);
  process.exit(1);
}

if (errors.length > 0) {
  console.error(`\n❌ Validation FAILED (${errors.length} errors):`);
  errors.forEach(e => console.error(`  - ${e}`));
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn(`\n⚠️  ${warnings.length} warnings:`);
  warnings.forEach(w => console.warn(`  - ${w}`));
}

console.log(`✅ Manifest validation PASSED (${Object.keys(data).length} entries)`);
```

### Example 4: Recovery Daemon (`scripts/cron_recovery_monitor.js`)

```javascript
#!/usr/bin/env node
// scripts/cron_recovery_monitor.js — Reads .cron_failure.jsonl, applies Tier A/B/C/D
// Usage:
//   node scripts/cron_recovery_monitor.js --check          # run periodic check
//   node scripts/cron_recovery_monitor.js --re-enable <cron_name>  # manual re-enable
//   node scripts/cron_recovery_monitor.js --status         # show current state

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const WORKSPACE = process.env.WORKSPACE_DIR || path.join(process.env.HOME, '.openclaw/workspace');
const FAILURE_LOG = path.join(WORKSPACE, '.cron_failure.jsonl');
const MANIFEST = path.join(WORKSPACE, 'docs/loop_termination_manifest.yaml');

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_ALERTS;  // from .env
const FAILURE_WINDOW_DAYS = 7;

function loadFailures(windowDays) {
  if (!fs.existsSync(FAILURE_LOG)) return [];
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  return fs.readFileSync(FAILURE_LOG, 'utf8')
    .trim().split('\n').filter(Boolean)
    .map(l => JSON.parse(l))
    .filter(f => new Date(f.ts).getTime() >= cutoff);
}

function getCronFails(failures, cronName) {
  return failures.filter(f => f.cron === cronName);
}

function getTier(manifest, cronName) {
  const cron = manifest[cronName];
  if (!cron) return 'A';
  const fails = getCronFails(loadFailures(FAILURE_WINDOW_DAYS), cronName);
  const t = cron.failure_thresholds || { self_recover: 2, alert: 3, circuit_break: 5 };

  if (fails.length >= t.circuit_break) return 'C';
  if (fails.length >= t.alert) return 'B';
  if (fails.length >= t.self_recover) return 'B';  // 2 fails = warn Josh already
  return 'A';
}

function sendDiscordAlert(cronName, tier, fails) {
  const msg = `🚨 Cron \`${cronName}\` escalated to **Tier ${tier}**\n` +
    `Fails in last ${FAILURE_WINDOW_DAYS}d: ${fails.length}\n` +
    `Latest: ${fails[fails.length - 1].reason}\n` +
    (tier === 'C' ? `\n**Circuit broken.** Manual re-enable required:\n` +
     `\`node scripts/cron_recovery_monitor.js --re-enable ${cronName}\`` : '');

  // Send via Discord webhook (simplified)
  try {
    execFileSync('curl', ['-X', 'POST', DISCORD_WEBHOOK,
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ content: msg })]);
  } catch (e) {
    console.error('Discord send failed:', e.message);
  }
}

function setCronEnabled(cronName, enabled) {
  const manifest = yaml.load(fs.readFileSync(MANIFEST, 'utf8'));
  if (!manifest[cronName]) throw new Error(`Cron ${cronName} not in manifest`);
  manifest[cronName].enabled = enabled;
  fs.writeFileSync(MANIFEST, yaml.dump(manifest), 'utf8');
}

// Main: --check mode
function check() {
  const manifest = yaml.load(fs.readFileSync(MANIFEST, 'utf8'));
  const failures = loadFailures(FAILURE_WINDOW_DAYS);

  for (const cronName of Object.keys(manifest)) {
    if (typeof manifest[cronName] !== 'object') continue;
    const tier = getTier(manifest, cronName);
    const cronFails = getCronFails(failures, cronName);

    console.log(`[${cronName}] Tier ${tier} (${cronFails.length} fails/7d)`);

    if (tier === 'B' && !manifest[cronName]._lastTierAlerted) {
      sendDiscordAlert(cronName, 'B', cronFails);
      manifest[cronName]._lastTierAlerted = 'B';
    } else if (tier === 'C' && manifest[cronName].enabled) {
      setCronEnabled(cronName, false);
      sendDiscordAlert(cronName, 'C', cronFails);
    }
  }
  fs.writeFileSync(MANIFEST, yaml.dump(manifest), 'utf8');
}

// Main: --re-enable mode
function reEnable(cronName) {
  setCronEnabled(cronName, true);
  console.log(`✅ Cron '${cronName}' re-enabled in manifest`);
  sendDiscordAlert(cronName, 'A', []);  // notify recovery
}

const args = process.argv.slice(2);
if (args.includes('--check')) check();
else if (args.includes('--re-enable')) reEnable(args[args.indexOf('--re-enable') + 1]);
else if (args.includes('--status')) {
  // Print current tier of all crons
  check();
} else {
  console.log('Usage: --check | --re-enable <name> | --status');
}
```

---

## Part 6: 7-Day Observation Design (Jun 18-25)

**Prerequisite:** #152 (QW-1~5) + #153 (Ollama) close on Jun 18 → OK to start #154

### Day-by-Day Checkpoints

| Day | Date | Check Command | Expected | Action if Failed |
|-----|------|--------------|----------|-----------------|
| **D1** | Jun 18 | `node scripts/validate_manifest.js` | ✅ 0 errors | fix YAML syntax |
| **D1** | Jun 18 | `node scripts/cron_recovery_monitor.js --status` | All 26 crons at Tier A | investigate |
| **D2** | Jun 19 | Trigger synthetic soft fail (kill L0 gen mid-run) | Tier 2 logged, file saved with flag | adjust threshold |
| **D2** | Jun 19 | `tail -5 .quality_warnings.jsonl` | warnings have correct tier classification | tune check logic |
| **D3** | Jun 20 | Trigger synthetic degraded (LLM timeout at 150s) | Tier 3 logged, partial file saved | test partial recovery |
| **D3** | Jun 20 | Verify Discord #⚙️系統 got degraded alert | message received | check Discord webhook |
| **D4** | Jun 21 | `wc -l .quality_warnings.jsonl` | ≥5 soft fails logged (false positive test) | tighten checks |
| **D5** | Jun 22 | Simulate 3 consecutive skill_reviewer soft fails | Tier B alert sent to Discord | verify alert content |
| **D5** | Jun 22 | `node scripts/cron_recovery_monitor.js --status` | skill_reviewer at Tier B | ensure auto-recovery logic works |
| **D6** | Jun 23 | Simulate 5+ fails in 7d (run old broken version 5 times) | Tier C circuit break, cron disabled | verify re-enable flow |
| **D7** | Jun 25 | Final aggregate check | All checks pass OR 0 critical regression | close #154 |

### Closing Criteria

| Outcome | Condition | Action |
|---------|-----------|--------|
| ✅ **PASS** | All 7 days green + 0 false positives + 4 tiers all triggered correctly + 0 regression | Promote Phase 1 → approve Phase 2 |
| 🟡 **PARTIAL** | 1-2 false positives OR 1 tier didn't trigger correctly (fixable) | Adjust thresholds, extend observation 3 days |
| 🟠 **NEEDS MORE** | 3+ false positives OR multiple tiers misbehaving | Pause new checks, debug, extend 7 days |
| 🔴 **REGRESSION** | Circuit breaker triggers incorrectly OR cron failures spike OR cost > 2x baseline | `git revert`, review mechanism design |

### Rollback Plan

| Rollback | Command | Time | Impact |
|----------|---------|------|--------|
| Full revert | `git revert <sha>` | 1 min | All 4 files (manifest, lib, validate, recovery) reverted |
| Disable manifest | `node scripts/cron_recovery_monitor.js --re-enable <all>` | 30s | All crons forced enabled |
| Remove lib import | Comment out `require('./lib/quality_checks.js')` in cron scripts | 5 min | Back to pre-Phase 1 behavior |
| Delete manifest | `rm docs/loop_termination_manifest.yaml` | 10s | No runtime change (cron schedule unaffected) |

---

## Part 7: Cross-System Insights (5)

### Insight 1: QW-1~5 (Junk Rate) ↔ Manifest Quality Checks = Input vs Output Defense
QW-1~5 (commit `bcf253c`) 修咗 **content quality**（SKILL.md output 有冇 self-ref、有冇 fence bug、有冇 4-backtick issues）— 呢個係 **input quality to L0/L1 generator**。Manifest quality checks 修 **execution quality**（cron 有冇行、output 達唔達標）— 呢個係 **output quality of LLM crons**。兩者係 orthogonal defense layers:
- QW 防止「壞 prompt」產出壞 SKILL.md
- Manifest 防止「好 prompt」因為 runtime issue 產生壞 output

**Together:** QW 5 fixes + Manifest 6 checks = 11-layer defense for skill content quality. **Insight value:** Manifest extends QW 嘅 philosophy（quality gate）from "static validation" to "dynamic runtime validation". 兩者加埋先可以 scale skill creation loop.

### Insight 2: #153 (Ollama) + Manifest = Cost + Output Quality
#153 將 2 個 cron 轉 ollama (cost = $0)。Manifest 嘅 token budget (Phase 1.2) caps 其他 3 個 cron 嘅 cost。Manifest 嘅 quality checks 確保 ollama output 都有 quality gate（無分 ollama / minimax，全部行同一套 check）。**Combined:** Cost ↓ 50% (from #153) + quality stable (from manifest checks) = 真正嘅 Loop Engineering 嘅 Karpathy Loop prerequisite。

**Edge case handled:** Ollama 冇 token count return — manifest quality checks **唔靠 token count**，靠 output length / structural / sanity 嚟判斷 quality。Token count 係 cost tracking 用（Part 5 manifest `tracking_file`），唔係 quality gate 用。**Decoupling 係 critical** — ollama 唔報 token 我哋都 quality check 到。

### Insight 3: Karpathy "Termination is THE prerequisite" → 我哋 system 嘅具體體現
Karpathy 嘅 3 個前提裡面，佢自己講 termination 係最難。Reason：metrics 同 time limit 可以直接實作，但 termination 需要 "what counts as done" 嘅共識 — 呢個係 design judgement，唔係 engineering。

我哋 system 嘅 termination 體現：
- **5 LLM crons 嘅 success 定義唔同**（L0 = 200 chars, L1 = 600 chars, Daily Summary = 100 chars + Discord post）— 唔可以 one-size-fits-all
- **Soft vs hard fail 嘅 4 tiers** 反映「**quality 係 spectrum，唔係 binary**」嘅 Karpathy insight
- **Circuit breaker** 體現 Karpathy 嘅 "fixed time limit" — 超過 5 fails / 7d 自動停，避免無限 burn

**Insight value:** 4-tier quality system (Part 3) + 4-tier recovery (Part 4) = 16 combinations, 反映真實 LLM output 嘅 nuance。**binary success/fail 嘅 manifest 一定 fail** — 因為 LLM output 永遠唔係 binary.

### Insight 4: Reddit "Edge Loop" → Verification Mapping
Reddit framework：loop at edge (collect, verify, dedupe)，唔 loop core (creative decisions). 我哋嘅 manifest **6 quality checks 全部係 verification (edge)，冇一個係 creative (core)**:
- A) Length = structural verify
- B) Sections = structural verify
- C) LLM Judge = quality verify
- D) Sanity = placeholder verify
- E) Cross-ref = source verify
- F) Idempotency = dedup verify

**全部都係 edge verification.** Manifest 故意冇 "is this insight novel?" / "is this analysis correct?" 呢類 core creative check — 因為呢類應該係人做，唔可以 loop 化（Reddit insight）。

**Insight value:** Manifest 嘅 scope 由 Reddit framework 指導，唔可以無限制 expand。如果 Josh 問「點解 manifest 唔 judge insight quality」，答案係 **核心創意決策留俾人，manifest 只 verify edge**。咁先符合 Loop Engineering 嘅 philosophy。

### Insight 5: Token Budget (1.2) ↔ Manifest (1.1) 嘅 Interaction
Phase 1 plan Part 2 嘅 token budget 處理「**cost overrun**」，Manifest Part 3 處理「**quality 唔達標**」。兩者嘅 Tier 對應：

| Scenario | Token Budget Reaction | Manifest Reaction | Final outcome |
|----------|----------------------|-------------------|---------------|
| LLM call 用 60K tokens（>50K budget）| log warn | (irrelevant) | **Tier 4** (pass with note) |
| LLM output 50 chars (< 200 min) | (irrelevant) | Tier 2 soft | **Soft fail** (file still saved) |
| LLM call timeout 300s | (irrelevant) | Tier 1 hard | **Hard fail** (no file) |
| 兩者都 fail（timeout + bad output）| log warn | Tier 1 hard | **Hard fail** + cost warn |
| Budget exceeded → exit early | Tier A self-recover | (cron didn't run quality check) | **Soft "no-output"** |

**Insight:** Token budget failure = **process failure (Tier 1)**, output quality failure = **content failure (Tier 2/3/4)**. 兩者可以同時發生，manifest 嘅 tier system 必須能夠 composite（例如：timeout + good output = 兩者矛盾，default 用 hard fail 因為 file 根本冇寫）。

---

## Part 8: Final Recommendation (1 page)

### Recommended Manifest Format
**YAML** + JSON Schema validation. Trade-off: YAML 唔似 JSON 咁有 native validation，但可讀性 + git diff + Obsidian compatible 嘅優勢值得。Validation 透過 `scripts/validate_manifest.js` 補返。

### Recommended Quality Check Library
**`lib/quality_checks.js`** — 6 個 check functions (A-F), 每個 return `{tier, message, details}`。Shared module，5 個 LLM cron + 任何 quality-gated script 都可以 import。**Cost overhead: < 22ms per LLM cron run** (without judge). Negligible.

### Recommended Recovery Mechanism
**4-tier recovery (A/B/C/D) with rolling 7-day window**:
- A (≤2 fails/7d) = silent self-recover
- B (3-4 fails/7d) = Discord warn, continue
- C (≥5 fails/7d) = circuit break, manual re-enable
- D (avg quality < 0.6/3d) = spawn M3 sub-agent debug

**Trigger:** Cron run logs `{ts, cron, tier, reason}` to `.cron_failure.jsonl`. Recovery daemon reads log, applies thresholds, sends alerts, updates manifest `enabled` field.

### Effort Breakdown (4.5hr total)

| Sub-task | Effort | Owner | Dependencies |
|----------|--------|-------|--------------|
| Create `docs/loop_termination_manifest.yaml` (26 entries) | 1.5hr | Main agent | HEARTBEAT.md (done) |
| Create `lib/quality_checks.js` (6 functions) | 1.5hr | Sub-agent (CODE) | None |
| Create `scripts/validate_manifest.js` | 30min | Sub-agent (CODE) | manifest yaml |
| Create `scripts/cron_recovery_monitor.js` | 45min | Sub-agent (CODE) | manifest yaml + lib |
| Wire 5 LLM cron scripts to use lib | 30min | Sub-agent (CODE) | lib done |
| Total | **4.5hr** | | |

### Day-by-Day Schedule (Jun 11-25)

| Date | Action | Decision Point |
|------|--------|----------------|
| Jun 11 (今日) | Create files (4 deliverables) | Josh: approve scope? |
| Jun 12 | Git commit + manual test (1 cron) | Josh: merge PR? |
| Jun 12-17 | Passive: crons log to .cron_failure.jsonl | — |
| Jun 18 | #152/#153 close → start #154 observation | Josh: proceed? |
| Jun 18-25 | D1-D7 checkpoints (Part 6) | — |
| Jun 25 | #154 close: PASS/PARTIAL/NEEDS MORE/REGRESSION | Josh: approve Phase 2? |

### Risk Mitigation (5 Major)

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| 1. False positive in quality checks 殺死正常 cron | 🟡 Medium | 🟡 Medium | D2-D4 觀察期 + synthetic fail test |
| 2. Circuit breaker 誤觸發（5 fails 正常）| 🟢 Low | 🔴 High | Threshold 5 fails/7d 已經 conservative；D6 test |
| 3. Manifest YAML typo 影響 cron (Phase 1 plan 同樣 risk) | 🟢 Low | 🔴 High | `validate_manifest.js` pre-deploy hook |
| 4. 5 LLM cron refactor 引入 syntax error | 🟡 Medium | 🟡 Medium | `verify_edit.js` post-edit + manual test 1 cron |
| 5. LLM Judge (Check C) cost 失控 | 🟢 Low | 🟢 Low | Judge 預設 disabled，per-cron opt-in + cost_budget_usd cap |

### Decision Points (Josh Approval Required)

1. **Today (Jun 11):** "Approve 4.5hr scope to build manifest + lib + recovery + validation?" → **Yes / Defer / Scope reduction**
2. **Jun 12:** "Merge PR after manual test?" → **Yes / Hold**
3. **Jun 18:** "Start #154 7-day observation?" → **Yes / Skip / Extend pre-obs**
4. **Jun 25:** "Promote Phase 1 → Phase 2 prep (add LLM judge to daily_summary)?" → **Yes / Hold / Different path**

---

## Summary Table (1 page recap)

| Component | Status | Effort | Key Trade-off |
|-----------|--------|--------|---------------|
| Manifest YAML (26 crons) | Designed | 1.5hr | Readable vs JSON validation |
| 6 Quality Checks (A-F) | Designed + coded | 1.5hr | Coverage vs LLM judge cost |
| 4 Quality Tiers (0-4) | Designed | (in manifest) | Granular vs simple binary |
| 4 Recovery Tiers (A-D) | Designed + coded | 45min | Auto-recover vs circuit break threshold |
| Manifest validation | Designed + coded | 30min | Pre-commit hook vs post-deploy check |
| 7-day observation | Designed | (passive) | Conservative thresholds vs false positives |

**Total:** 4.5hr design + code, 7-day observation period, 4 decision points with Josh.

**Final 1-liner:** Termination Manifest 唔係「為 26 cron 加 spec doc」咁簡單 — 佢係將 Karpathy 嘅 3 個 prerequisite (file perm ✓ / objective metric ✓ / time limit ✓) 全部 formalize 做 YAML + 6 checks + 4 quality tiers + 4 recovery tiers，等我哋 system 由「cron 跑咗」升級到「cron 跑咗 + 達標 + 失敗可控」嘅真正 Loop。

---

*End of Report. Total: ~7,500 字, 8 parts, 4 complete code examples, 5 cross-system insights.*

---

**Subagent 完成報告（俾 main agent 參考）:**

我已經完成咗呢份 1.1 Termination Manifest Deep Analysis。整份報告涵蓋 Josh 嘅核心問題「點為之行完 + 達到質量標準先算完成」，分 8 個 part：
- **Part 1**: Manifest schema 詳細設計 + 2 個 complete entries (Skill Reviewer full spec + Skill Junk Tracker light spec)
- **Part 2**: 6 個 quality checks (A-F) 全部有 implementation code + edge case 處理
- **Part 3**: 4 個 quality tiers (0-4) with trigger/action/cumulative impact
- **Part 4**: 4 個 recovery tiers (A/B/C/D) with threshold/action/recovery path
- **Part 5**: 4 個 actual code examples (YAML manifest + JS lib + JS validator + JS recovery daemon)
- **Part 6**: 7-day observation plan with D1-D7 checkpoints + closing criteria + rollback
- **Part 7**: 5 個 cross-system insights (QW-1~5, #153, Karpathy, Reddit, Token Budget ↔ Manifest)
- **Part 8**: 1 page final recommendation with effort breakdown + risks + decision points

**Grep evidence 用咗:**
- `scripts/skill_reviewer_bot.js:604` (LLM call)
- `scripts/skill_reviewer_bot.js:30, 35` (MODEL, TIMEOUT_MS)
- `scripts/skill_junk_tracker.js:69-87, 125` (rolling window, target)
- `scripts/memory_generator.js:294, 311` (L0/L1 LLM call)
- `scripts/daily_summary_bot.js:188-189` (LLM call)
- `HEARTBEAT.md` (26 crons list)

**Total 字數:** ~7,500 字（6-8 page 範圍內）。**符合所有 Definition of Done checkboxes**。Main agent 可以直接 forward 呢份完整 report 畀 Josh。