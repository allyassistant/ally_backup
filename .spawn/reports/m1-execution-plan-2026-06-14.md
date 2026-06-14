# M1 Execution Plan — Skill Pipeline Description Quality + Activation Control
*Design document | 2026-06-14 10:42 HKT | Author: M3 sub-agent (depth 1/1)*
*For: Discord #🧑🏻‍💻編程 | Master issue: #161 (re-scoped) | Sibling: #158 (Phase 3 in flight)*

> **Mission：** Recall 質量直接對齊 Josh 真正 goal — 提升 LLM 揀 skill 嘅 precision，減少 false positive 觸發，控制敏感 skill 嘅 auto-invocation。  
> **M1.1 done：** OpenClaw 完全支援 `disable-model-invocation: true` frontmatter (first-class field)。  
> **剩 8 tasks (M1.2–M1.9)，總 effort ~16 hr over 1 week (Mon 06-15 → Sun 06-21)。**

---

## 0. Executive Summary

| 維度 | Decision |
|------|----------|
| **Execution order** | M1.6 (validator) → M1.2 (auditor) → M1.3 (top-10 batch) → M1.5 (manual 6) → M1.4 (remaining 31) → M1.7 (activation tester) → M1.8 (AGENTS.md) → M1.9 (close) |
| **Critical path** | M1.6 → M1.2 → M1.3 (5 hr) — 其他 tasks 可平行或後置 |
| **Parallel work** | M1.5 + M1.4 喺 M1.3 完成後可拆 2 條 worker；M1.7 + M1.8 可同時做 |
| **Stage gates** | Day 3 (auditor ready)、Day 5 (top-10 done + 6 manual classified)、Day 7 (all + tested) |
| **Biggest risk** | 3-段 formula 改完之後 trigger behaviour 變咗 → false negative 增加 → recall hit rate 跌 |
| **Scope explosion 防範** | Stage gate 嚴格執行 + auto-fix 唔直接寫 disk（先 dry-run report）|
| **總時間 budget** | 16 hr ± 2 hr buffer = 18 hr 硬上限。超出 → 拆 #161 Phase 2 |

---

## 1. Execution Order — Dependency Graph

```
                  ┌─ M1.6 ─┐
                  │validate │  ← Day 1 (1hr) — first，因為新 skill 必須先合規格先入 batch
                  │ Appendix C │
                  └────┬─────┘
                       ↓
                  ┌─ M1.2 ──────┐
                  │ description │  ← Day 1-2 (2hr) — 用 Appendix C 嘅 spec 做 audit
                  │   auditor   │
                  └────┬────────┘
                       ↓
                  ┌─ M1.3 ──────┐
                  │  top-10     │  ← Day 2-3 (3hr) — 攞高頻 skills 先 batch 試水溫
                  │  batch      │     [depends on M1.2 score output]
                  └────┬────────┘
                       ↓
                ┌──────┴──────┐
                ↓             ↓
          ┌─ M1.5 ─┐    ┌─ M1.4 ──────┐
          │ 6      │    │ remaining   │  ← Day 4-5 (5hr) — 31 個
          │ manual │    │ 31 skills   │     [parallel with M1.5]
          └────┬───┘    └──────┬──────┘
               │              │
               └──────┬───────┘
                      ↓
              ┌─ M1.7 ──────────┐
              │ activation      │  ← Day 5-6 (2hr) — verify 6 個 manual 真係唔 trigger
              │ tester          │
              └────┬────────────┘
                   ↓
              ┌─ M1.8 ──────────┐
              │ AGENTS.md       │  ← Day 6 (30min) — Path F fallback section
              │ Skill Recall    │
              └────┬────────────┘
                   ↓
              ┌─ M1.9 ──────────┐
              │ update #158     │  ← Day 7 (15min) — final cross-ref + close #161
              │ close #161      │
              └─────────────────┘
```

### Dependency rationale
- **M1.6 先做：** 如果 validator 唔識 3-段 formula check，auditor score 會同 production validator 唔一致 → 改完嘅 description 寫 disk 後先被擋駕，浪費 effort
- **M1.2 喺 M1.3 前：** Auditor 必須先量化「現時幾差」，先至知道 top-10 揀邊個（用 score < 50 嘅 skill 排優先）
- **M1.3 先於 M1.4：** Top-10 (3hr) 用嚟試 3-段 formula + LLM extraction pipeline，先 3 個 manual review → 然後 same pattern scale 到 31 個，避免 scaling 後先發現 prompt 唔 work
- **M1.5 parallel M1.4：** 6 manual skills 嘅 frontmatter 加 `activation: manual` 同 description 改動係 independent，可以 split worker
- **M1.7 after M1.5：** Tester 必須有 manual flag 存在先 verify 到
- **M1.8 最後：** AGENTS.md section 引用晒前面所有成果，先有意義
- **M1.9 last：** 純 metadata update，所有上面 done 先做

---

## 2. Critical Path Analysis

**Critical path:** M1.6 (1h) → M1.2 (2h) → M1.3 (3h) = **6 hours wall time** (non-parallelizable foundation)

| Task | Wall time | Parallel? | Blocks |
|------|-----------|-----------|--------|
| M1.6 | 1h | No (must be first) | M1.2, M1.7 |
| M1.2 | 2h | No (after M1.6) | M1.3, M1.4, M1.5 |
| M1.3 | 3h | No (after M1.2) | M1.4, M1.5 |
| M1.4 | 5h | **Yes** (parallel with M1.5) | M1.7 |
| M1.5 | 2h | **Yes** (parallel with M1.4) | M1.7 |
| M1.7 | 2h | **Yes** (parallel with M1.8) | M1.9 |
| M1.8 | 0.5h | **Yes** (parallel with M1.7) | M1.9 |
| M1.9 | 0.25h | No (must be last) | — |

**Optimistic:** 1 + 2 + 3 + max(5, 2) + max(2, 0.5) + 0.25 = **13.75 hr**
**Realistic (+buffer for test/review):** **~16 hr** (matches estimate)

**Parallelization strategy:**
- Day 4-5: 同時跑 M1.4 (description batch, slow) + M1.5 (manual frontmatter, fast)
- Day 6: 同時跑 M1.7 (tester) + M1.8 (AGENTS.md text)

---

## 3. M1.2 — `skill_description_auditor.js` Detailed Spec

### 3.1 3-段 Description Formula (Anthropic standard)

```
格式: [做咩 — 第一人稱行動動詞] | [幾時用 — trigger conditions] | [關鍵能力 — specific tools/functions]
```

**Example transformation:**

| | 現時 (one-liner 廣東話) | 改完 (3-段) |
|---|---|---|
| ❌ BAD | "Discord skill tools" | (vague, English, no triggers) |
| ❌ BAD | "Skill helpers" | (no action, no trigger) |
| ⚠️ CURRENT | "系統性 cron job migration 工作流 — 包括舊 kind → command kind 遷移、CLI bypass、thin executor 轉換與 model swap 上下文窗口陷阱" | (做咗邊啲, 唔夠 explicit 幾時用) |
| ✅ TARGET | "Migrate cron jobs 從 `agentTurn` kind 到 `command` kind thin executor. Use when: agentTurn cron 冇 LLM dependency / 識得分類 pure-logic vs LLM-dependent / 處理 rate limit 陷阱. Key capabilities: `openclaw cron list --json` inventory, batch parallel `cron <id> set model=...`, dry-run validation." | (explicit 3 segments, English keywords for matching, specific CLI commands) |

**Formula rules:**
1. **Length:** 80–200 chars ideal (sweet spot for `<categorized_skills>` block density)
2. **Third person** (per Anthropic): "Migrate cron jobs..." NOT "I migrate cron jobs..." / "你應該用呢個 migrate..."
3. **First segment (做咩):** Verb-first, action-oriented, 5-15 words
4. **Second segment (幾時用):** "Use when: ..." 開頭，3-5 trigger conditions (comma-separated)
5. **Third segment (關鍵能力):** "Key capabilities: ..." 開頭，3-5 specific tools/commands (use backticks for code)
6. **Vague words 禁用:** "helper", "utility", "stuff", "things", "various", "general" — 觸發即扣分
7. **Triggers 唔好 spam:** 唔好每句都用 "Use when" / "Apply this when" / "Trigger this when" — 同一份 description 最多 1 次
8. **NO XML/尖括號:** `<skill>`, `</skill>`, `<tool>` — 破壞 system prompt injection
9. **NO ALL CAPS section headers** (per Anthropic): 唔好寫 "**USE WHEN:**" — 用 sentence case

### 3.2 Auditor Spec

**File:** `scripts/skill_description_auditor.js` (NEW, ~250 lines)
**Inputs:**
- `skills/_learned_*/SKILL.md` (48 active skills, 06-14)
- `--skills-dir <path>` flag (default: `~/.openclaw/workspace/skills`)
- `--format jsonl|markdown` flag (default: `jsonl`)
- `--auto-fix` flag (optional, see §3.3)
- `--review` flag (default, see §3.3)
- `--min-score <0-100>` flag (default: `70`, skills below get flagged)
- `--verbose` flag

**Outputs:**
- `.spawn/reports/description_audit_2026-MM-DD.jsonl` — one line per skill
- `.spawn/reports/description_audit_2026-MM-DD.md` — human-readable summary (top 10 worst + top 5 best)

**Scoring rubric (0-100):**

| Criterion | Max points | Detector |
|-----------|------------|----------|
| **1. 有 [做咩] 行動動詞** | 20 | First 50 chars match `/^[A-Z\u4e00-\u9fff].*([a-z]{3,}\|.*[動處作]|ing\b)/` OR contain specific verb ("Migrate", "Build", "Diagnose", "Scan", "Spawn", "Workflow", "Convert", "Audit", "Deploy", "Verify", "Diagnose", "Workflow for X-ing") |
| **2. 有 [幾時用] trigger** | 25 | Contains "Use when" OR "Use this when" OR "Trigger" OR "Apply when" (case-insensitive) + has comma-separated 3+ conditions OR clear use-case (e.g., "when X fails", "for Y scenarios") |
| **3. 有 [關鍵能力] segment** | 20 | Contains "Key capabilities" OR "Capabilities" OR specific tool names (`node`, `git`, `cron`, `bash`, `ssh`, `openclaw`, backtick code) |
| **4. Length 80-200 chars** | 10 | `description.length` in range |
| **5. 冇 vague words** | 10 | Does NOT contain /\b(helper\|utility\|stuff\|things\|various\|general purpose\|misc)\b/i |
| **6. 冇 XML/尖括號** | 5 | No `<...>` patterns |
| **7. 冇 trigger spam** | 5 | Count of "use when" / "apply when" / "trigger" ≤ 1 |
| **8. 3-person perspective** | 5 | Doesn't start with "I " / "你" / "We " / "你應該" |
| **TOTAL** | **100** | |

**Pass threshold:** ≥70

**Output format (JSONL):**
```json
{
  "skill": "cron-migration",
  "path": "skills/_learned_cron-migration/SKILL.md",
  "description": "系統性 cron job migration 工作流 — 包括...",
  "length": 78,
  "score": 35,
  "passed": false,
  "criteria": {
    "action_verb": {"score": 15, "max": 20, "note": "Has 'Workflow' but not verb-first"},
    "trigger": {"score": 0, "max": 25, "note": "No 'Use when' / trigger phrase"},
    "capabilities": {"score": 10, "max": 20, "note": "Has cron-specific terms but no 'Key capabilities' header"},
    "length": {"score": 0, "max": 10, "note": "78 chars < 80 ideal"},
    "vague_words": {"score": 10, "max": 10, "note": "Clean"},
    "xml_brackets": {"score": 5, "max": 5, "note": "Clean"},
    "trigger_spam": {"score": 5, "max": 5, "note": "Clean"},
    "perspective": {"score": 0, "max": 5, "note": "No 3rd person verb form"}
  },
  "suggested_description": "Migrate cron jobs 從 agentTurn kind 到 command kind thin executor. Use when: ... Key capabilities: ...",
  "rewrite_confidence": 0.85,
  "needs_human_review": false
}
```

**Confidence levels:**
- `≥ 0.85`: auto-fix eligible
- `0.60–0.84`: auto-suggest (write to review queue, NO disk write)
- `< 0.60`: needs human review (manual rewrite required)

### 3.3 Two Modes

**Mode A: `--review` (default, safe)**
- Scan all 48 skills
- Output JSONL + markdown summary
- NO disk write — human reads report, manually approves each rewrite
- Used: initial audit, M1.2 first run

**Mode B: `--auto-fix` (gated, dangerous)**
- ONLY triggers if `--min-score 90` AND explicit `--i-understand-this-modifies-files`
- Skips confidence < 0.85
- Writes to `skills/_learned_<name>/SKILL.md` via atomic `safeWriteFileSync` (per audit BUG-06)
- Creates backup `.bak-<ts>` first
- Logs to `.skill_description_audit.jsonl`
- Used: M1.3/M1.4 batch update AFTER first run is reviewed

### 3.4 Test Cases (built into script as self-test)

```js
// Self-test cases — auditor should pass all
const testCases = [
  { desc: "Migrate cron jobs 從 agentTurn 到 command kind. Use when: ...", expected: "pass" },
  { desc: "Discord skill tools", expected: "fail (no trigger, vague)" },
  { desc: "<tool>helper</tool>", expected: "fail (xml brackets)" },
  { desc: "Use when X. Use when Y. Use when Z.", expected: "fail (trigger spam)" },
  { desc: "I migrate your cron jobs for you", expected: "fail (1st person)" },
  { desc: "Diagnose session-resume failures via spawn_config.js + queue audit. Use when: ...", expected: "pass" }
];
```

---

## 4. M1.3 + M1.4 — Batch Description Update Strategy

### 4.1 Top-10 Selection Criteria (M1.3)

**Pick top-10 by frequency in `<categorized_skills>` block + low score:**

| Priority | Skill | Current Score | Why |
|---|---|---|---|
| 1 | `cron-migration` | ~35 | 78 chars, 冇 trigger, migration-related (= high trigger) |
| 2 | `openclaw-managed-upgrade` | ~40 | 35 chars too short, no trigger |
| 3 | `cross-machine-deployment` | ~40 | 40 chars too short |
| 4 | `subagent-context-overflow-recovery` | ~30 | too short |
| 5 | `main-session-execution-loop-recovery` | ~30 | too short, vague |
| 6 | `error-auto-issue` | ~60 | 2-段 but no explicit trigger |
| 7 | `cron-health-triage` | ~50 | 2-段 but vague 開頭 |
| 8 | `anomaly-proactive-push` | ~60 | 2-段 but no trigger phrase |
| 9 | `cron-config-audit` | ~45 | 1-段 no capabilities |
| 10 | `code-quality-proactive-scan` | ~50 | English, 1-段 |

(以上 score 係 estimate，實際由 M1.2 第一次 run 決定)

### 4.2 LLM Extraction Pipeline (M1.3 → M1.4)

**一次性 vs incremental?**
- 一次性 (M1.3 全部跑 + 手動 review) 然後 incremental (M1.4 same pipeline on remaining 31)
- 唔好 parallel 兩個 — 避免 hallucination pattern 嘅 bug 一次過爆 48 個

**Confidence threshold:**
- ≥ 0.85 → auto-apply
- 0.60–0.84 → write to `description_rewrite_proposals.jsonl`, Josh 30 min review session
- < 0.60 → manual rewrite by M3 sub-agent on-demand

**邊啲 skills 唔郁?**
- Already score ≥ 90 → skip (estimated 5-10 skills, will know from M1.2 first run)
- Junk in `skills-learned/` (no symlink) → skip, cleanup separately (not M1 scope)

### 4.3 Version Control Strategy

**Pre-change:**
```bash
# Day 1 of M1.3
git add -A
git commit -m "snapshot: pre-M1.3-description-batch-2026-06-XX"
git tag m1-baseline
```

**Per-skill change:**
```bash
# Per rewrite:
# 1. Backup to skills/_learned_<name>/SKILL.md.bak-<ts>
# 2. safeWriteFileSync atomic write
# 3. Run validate_skill_file.js
# 4. If fail → restore from .bak-<ts>
```

**Post-change verification:**
```bash
# After M1.3 done
node scripts/skill_description_auditor.js --review --skills-dir ~/.openclaw/workspace/skills
# All 10 skills should now score ≥ 70

# Then sample-test 5 random skills with 1 actual conversation thread
# (manually observe LLM does/doesn't trigger)
```

### 4.4 Rollback (per skill)

```bash
# Per-skill revert
cp skills/_learned_<name>/SKILL.md.bak-<ts> skills/_learned_<name>/SKILL.md
node scripts/validate_skill_file.js skills/_learned_<name>/SKILL.md
```

**Trigger conditions for rollback:**
- LLM recall hit rate drops > 20% (measure via pre/post comparison, 10 messages each)
- False positive increases > 10% (LLM uses wrong skill for known tasks)
- Junk rate tracker (`#150`) > 15% for 2 consecutive days

---

## 5. M1.5 — 6 Manual Skills Classification

### 5.1 Selection Criteria

| Criterion | 描述 | 例子 |
|----------|------|------|
| **A. 不可逆操作** | 操作一旦執行難以 rollback | `rm -rf`、service restart、API key rotation |
| **B. Cross-system blast** | 一台機搞錯 → 影響另一台 | SSH 跨機、shared state 改動 |
| **C. Production-affecting** | 改 prod config / cron schedule | Cron migration、config audit |
| **D. 罕用但高 impact** | 一年用 1-2 次但搞錯 cost 高 | OpenClaw upgrade、systemEvent migration |
| **E. Sub-agent 之前標記過** | #146, #158, #136 等 issue 提過 | #158 嘅 plugin-related skills |

### 5.2 Recommended 6 Manual Skills

| # | Skill | Reason | Activation |
|---|-------|--------|-----------|
| 1 | `openclaw-managed-upgrade` | OpenClaw 升級 = gateway restart + potential break everything（#161 root impact） | manual |
| 2 | `cross-machine-deployment` | SSH 跨機 deploy = 同時影響 Ally + Bliss HA pair，#146 P0 bugs source | manual |
| 3 | `model-migration-workflow` | Cron model swap = 19+ jobs batch change, #145 嘅 spawn intent gate sub-product | manual |
| 4 | `systemevent-main-session-isolation` | Session key cleanup = potentially crash main session, #157 + #144 嘅 root issue | manual |
| 5 | `cron-migration` | Cron kind swap = agentTurn → command, LLM dependency mis-classify = silent failure | manual |
| 6 | `cron-config-audit` | Cron model config drift detect = #146 P0 fix source, modifying crons in bulk | manual |

### 5.3 Alternative candidates (if any 1 of above rejected)

| Skill | Reason why alt |
|-------|----------------|
| `error-auto-issue` | 自動建 P1 issue 喺 error pattern ≥3次 — false positive 會 spam issue tracker |
| `anomaly-proactive-push` | Auto-degrade cron 喺 critical anomaly = silent kill switch |
| `skill-validation-failure-cleanup` | Archive skills = data loss if mis-fire |

**Josh pick 1 個 alt** (我嘅 recommendation = 上面 6 個，alt 只喺 reject 嗰個先用)

### 5.4 Frontmatter Change

```yaml
# Before
---
name: openclaw-managed-upgrade
description: 透過 managed service API 升級 OpenClaw 並驗證 gateway 重啟成功的流程
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-12T02:07:36.138Z
---

# After (add activation + reason)
---
name: openclaw-managed-upgrade
description: Upgrade OpenClaw via managed service API and verify gateway restart. Use when: ...
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-12T02:07:36.138Z
activation: manual
activationReason: "irreversible (gateway restart, can break all plugins) + cross-system impact"
manualTriggerSyntax: "/skill:openclaw-managed-upgrade"
---
```

**6 個 frontmatter 改動:** Day 4 一次性 batch via `edit` tool，每個獨立 commit (細粒度 rollback)

### 5.5 Why "manual" 比較安全 (rationale)

| 模式 | Auto (default) | Manual (override) |
|------|----------------|-------------------|
| **Trigger** | LLM 根據 description 自己決定 | Josh 必須 explicit call (`/skill:name` or `use the openclaw-managed-upgrade skill`) |
| **Risk surface** | 50+ skills descriptions 互相 cross-trigger，#161 root | 1 skill, 1 explicit call, 0 accidental |
| **Auditing** | 隱形 — 唔知幾時 trigger | 顯形 — 每次 manual call 有 intent |
| **Testability** | 難以 verify 真正 trigger conditions | 直接 unit test call signature |
| **Override escape** | N/A | Josh 隨時可以 force-trigger，唔受限制 |

**For these 6 skills, false positive cost >> false negative cost. Trade-off favors manual.**

---

## 6. M1.6 — Validator Appendix C Extension

### 6.1 Current validator state (June 14)

`scripts/validate_skill_file.js` (200 lines) already has:
- ✅ Stub detection (composite of 3 signals, fixed BUG-03)
- ✅ Stateful code-block tracking (fixed BUG-05)
- ✅ Pitfalls count (≥3 required)
- ✅ Workflow section (≥3 steps, no colon-truncation)
- ✅ Template spam detection (body < 3x description)

**What's missing for M1.6:**

### 6.2 Appendix C — New Checks (add ~80 lines)

```js
// APPENDIX C — 3-段 formula + activation control validation

// C1. Description length 80-200 chars (soft check, warn-only)
const DESC_MIN = 80, DESC_MAX = 200;
const descMatch = content.match(/^description:\s*["']([^"']+)["']/m);
if (descMatch) {
  const desc = descMatch[1];
  if (desc.length < DESC_MIN) {
    warnings.push(`Description short (${desc.length} < ${DESC_MIN} chars): "${desc.slice(0, 60)}..."`);
  } else if (desc.length > DESC_MAX) {
    warnings.push(`Description long (${desc.length} > ${DESC_MAX} chars): consider splitting into frontmatter + body`);
  }
}

// C2. NO XML/尖括號 in description (hard error — breaks system prompt)
if (desc && /<[a-zA-Z\/][^>]*>/.test(desc)) {
  errors.push(`Description contains XML/angle-bracket pattern: "${desc.match(/<[^>]+>/)[0]}" — breaks system prompt injection`);
}

// C3. NO trigger phrase spam (hard error)
if (desc) {
  const triggerCount = (desc.match(/\b(use when|use this when|apply this when|trigger this when)\b/gi) || []).length;
  if (triggerCount > 1) {
    errors.push(`Description has ${triggerCount} trigger phrases — spam, only 1 allowed`);
  }
}

// C4. NO vague words (hard error)
const VAGUE_PATTERNS = /\b(helper|utility|utilities|stuff|things|various|general purpose|miscellaneous|misc)\b/i;
if (desc && VAGUE_PATTERNS.test(desc)) {
  errors.push(`Description contains vague word: "${desc.match(VAGUE_PATTERNS)[0]}" — be specific`);
}

// C5. NO ALL CAPS section headers in description
if (desc && /[A-Z]{4,}/.test(desc)) {
  const caps = desc.match(/\b[A-Z]{4,}\b/g) || [];
  if (caps.length > 0) {
    warnings.push(`Description has ALL CAPS words: ${caps.join(', ')} — use sentence case`);
  }
}

// C6. activation field validation
const activationMatch = content.match(/^activation:\s*["']?(auto|manual)["']?/m);
if (activationMatch) {
  const activation = activationMatch[1];
  if (activation === 'manual') {
    // C6a. manualTriggerSyntax required
    if (!/^manualTriggerSyntax:\s*["'].*["']/m.test(content)) {
      errors.push(`Manual activation requires manualTriggerSyntax field`);
    }
    // C6b. activationReason required (for audit trail)
    if (!/^activationReason:\s*["'].*["']/m.test(content)) {
      warnings.push(`Manual activation should have activationReason for audit trail`);
    }
  }
}

// C7. disable-model-invocation cross-check (Anthropic compat)
const dmi = content.match(/^disable-model-invocation:\s*["']?(true|false)["']?/m);
if (dmi && dmi[1] === 'true' && activationMatch && activationMatch[1] === 'auto') {
  errors.push(`disable-model-invocation: true conflicts with activation: auto — pick one`);
}
```

### 6.3 Pre-write gate vs Post-write gate

**Pre-write gate (執行 M1.3/M1.4 嘅 auto-fix):**
- 喺 `writeSkillFiles()` 入面 call `validateSkillContent()` BEFORE `safeWriteFileSync()`
- 如果 C2/C3/C4 任何 hard error → refuse to write, log to `.skill_audit_pre_write_failures.jsonl`
- 對 M1.3 auto-fix 至關重要 — 唔好將 broken description 寫入 disk

**Post-write gate (cron / existing flow):**
- 保持現有 `validate_skill_file.js` post-write check
- 加 C1-C7 新 checks 為 warnings/errors
- Junk rate tracker (`#150`) 加入 description quality 分數 trend

**位置:**
```js
// scripts/skill_reviewer_bot.js line ~277 (writeSkillFiles)
// PRE-WRITE: add before safeWriteFileSync
const validation = validateSkillContent(block.content);
if (!validation.valid) {
  err('Pre-write validation failed for', block.filePath, ':', validation.errors);
  // Option A: refuse + quarantine
  quarantineBlock(block, validation.errors);
  continue;
}
```

---

## 7. M1.7 — `skill_activation_tester.js` Spec

### 7.1 Purpose

Verify `activation: manual` skills 真係唔會被 LLM auto-trigger when 50 test prompts 應該用佢。

### 7.2 Design

**File:** `scripts/skill_activation_tester.js` (NEW, ~180 lines)
**Inputs:**
- `--skills-dir <path>` (default `~/.openclaw/workspace/skills`)
- `--test-prompts <file>` (default `.spawn/reports/activation_test_prompts.jsonl` — 50 prompts)
- `--output <path>` (default `.spawn/reports/activation_test_<ts>.jsonl`)

**Test prompt generation:**

```js
// Auto-generate 50 test prompts by reading manual skill descriptions + crafting prompts
// For each of 6 manual skills, generate ~8 prompts that SHOULD trigger them
// 5 categories per skill:
// 1. Exact-match trigger phrase (from description)
// 2. Paraphrased trigger (e.g., "升級 OpenClaw" if description says "Upgrade OpenClaw")
// 3. Domain keyword trigger (e.g., "managed service" or "gateway restart")
// 4. Adjacent topic (e.g., "service availability" — should NOT trigger)
// 5. Out-of-scope topic (e.g., "skill audit") — should NOT trigger
```

**Test flow:**

```js
async function testManualSkill(skill, prompts) {
  const results = [];
  for (const prompt of prompts) {
    // Simulate user message by calling skill-learner plugin's before_prompt_build
    // (or call openclaw agent --prompt <prompt> --print with no skill activation)
    // Then inspect: did `<categorized_skills>` block contain this skill?
    const response = await simulatePrompt(prompt);
    const skillsInjected = extractSkillNames(response);
    const triggered = skillsInjected.includes(skill.name);
    results.push({
      prompt,
      expected_trigger: prompt.shouldTrigger,
      actual_trigger: triggered,
      skills_injected: skillsInjected,
      pass: triggered === prompt.shouldTrigger
    });
  }
  return results;
}
```

**Pass criteria:**
- 100% prompts that SHOULD trigger manual skill → LLM does NOT inject (no false positive)
- 100% prompts that should NOT trigger → LLM does NOT inject (no false negative)
- **Overall: 50/50 pass = skill_activation_tester exits 0**

**Auto-generated test prompts (示例 for 1 skill):**

```json
[
  {"skill": "openclaw-managed-upgrade", "prompt": "幫我升級 OpenClaw", "shouldTrigger": false, "reason": "manual"},
  {"skill": "openclaw-managed-upgrade", "prompt": "Upgrade OpenClaw to latest version", "shouldTrigger": false, "reason": "manual"},
  {"skill": "openclaw-managed-upgrade", "prompt": "managed service API 點用", "shouldTrigger": false, "reason": "manual"},
  {"skill": "openclaw-managed-upgrade", "prompt": "gateway restart 失敗", "shouldTrigger": false, "reason": "adjacent topic, not upgrade"},
  {"skill": "openclaw-managed-upgrade", "prompt": "check OpenClaw version", "shouldTrigger": false, "reason": "version check != upgrade"},
  // ... 5 more for each skill
]
```

### 7.3 Test Output Format

```json
{
  "test_run": "2026-06-XX",
  "skills_tested": 6,
  "prompts_tested": 50,
  "pass_rate": 1.0,
  "results": [
    {"skill": "openclaw-managed-upgrade", "prompt": "...", "pass": true, "skills_injected": ["cron-migration", "..."]},
    ...
  ],
  "failures": [],
  "verdict": "PASS"
}
```

### 7.4 Failure Handling

- If ANY test fails → exit 1, Josh reviews
- Failure type A: manual skill IS in `<categorized_skills>` block → OpenClaw not filtering → bug
- Failure type B: manual skill NOT injected but other auto-skill also not → check if catalog is correct

---

## 8. M1.8 — AGENTS.md "Skill Recall Trigger" Section (Path F)

### 8.1 Section Spec

**Location:** `~/.openclaw/workspace/AGENTS.md`, new section between "✅ 每個 Session 必做" and "📝 Issue 內容 Quality SOP"
**Length:** ~40-50 lines
**Style:** Same as existing sections (markdown headers + tables + 1-line action)

### 8.2 Content (draft)

```markdown
### 🧠 Skill Recall Trigger (Path F — fallback for LLM auto-recall)

> **When to use this section:** Skill-learner plugin auto-injects `<categorized_skills>` block into every prompt. This block contains all active skill names + descriptions. LLM should use this as the primary recall mechanism. This section is the **explicit policy + decision tree** for how to use that block.

#### Step 1: Scan `<categorized_skills>` block at session start

Every message already includes the block. Locate it in system prompt, near bottom. If you don't see it → log to `.skill_recall_missing.jsonl` and continue without skill lookup (don't fail).

#### Step 2: Evaluate skill fit (decision tree)

```
User message → categorize intent
    ↓
    ├─ Has explicit /skill:name or "use the X skill" call? → Use that skill, skip matching
    ├─ Has clear domain match in 1 skill description? → Use it
    ├─ Multiple skill candidates match? → Pick highest-frequency + most-specific
    ├─ No clear match? → Do task without skill (don't force-invoke)
    └─ Manual skill (activation: manual) detected? → Tell Josh "this is manual, confirm?" before invoking
```

#### Step 3: When to invoke

- **DO invoke** when: skill's trigger phrase appears in user message, AND skill is `activation: auto`
- **DON'T invoke** when: skill is `activation: manual` (tell Josh first), OR no clear match, OR you have alternative direct approach
- **NEVER invoke** for: vague similarity, "this could maybe help", "just in case"

#### Step 4: How to invoke (auto skills)

Most auto skills require NO explicit invocation — they're instructions/patterns the LLM follows. To "use" them, follow their Workflow section.

Example: `cron-migration` skill has Workflow "### Phase 1: Migration Planning" → just execute that plan.

#### Step 5: How to invoke (manual skills)

```bash
# Either explicit slash command:
/skill:openclaw-managed-upgrade

# Or in message: "use the openclaw-managed-upgrade skill"
# Then WAIT for Josh's confirmation before executing
```

#### Step 6: When to ignore a skill

- Skill description doesn't match user intent
- Skill is for a different domain (e.g., `cron-migration` for a non-cron task)
- Skill is stale (check `generatedAt` — if > 30 days, flag for review)
- Multiple skills conflict → pick safest (lowest blast radius)

#### Step 7: Change invocation mode (audit-driven)

If a skill triggers too often (false positive > 30% per junk rate tracker) → add `activation: manual` to its frontmatter. If a skill never triggers but is high-value → consider rewording description or removing from library.

**Audit cadence:** M2 Mini-Curator (weekly Sunday 02:00) checks for under/over-triggering.
```

### 8.3 Why this section is needed

- **Path F fallback** (per `plugin-skill-matcher-analysis-2026-06-14.md`): Even with skill-learner injecting catalog, LLM needs explicit policy to avoid random triggering
- **Decision tree** removes ambiguity — LLM has 1 algorithm to follow
- **Manual skill gate** prevents accidental invocation of dangerous skills
- **Audit hook** creates feedback loop for continuous improvement

### 8.4 5 SOP Steps (compressed, for AGENTS.md)

1. **Scan** `<categorized_skills>` at session start
2. **Match** user intent → skill via decision tree
3. **Auto-invoke** if `activation: auto` + clear match
4. **Confirm** if `activation: manual` (NEVER auto-invoke)
5. **Ignore** if no match (don't force-invoke)

---

## 9. M1.9 — Update #158 + Close #161

### 9.1 #158 Cross-reference Update

Add to `158-skill-reviewer-vs-anthropic-sk.md`:
- Reference to M1.2-M1.9 (1-line summary: "M1 execution plan completed; description quality + activation control implemented")
- Link to `.spawn/reports/m1-execution-plan-2026-06-14.md`
- Status: Anthropic hybrid strategy (writing guide + activation control) implemented

### 9.2 #161 Close

Update `161-fakemaidenmaker-skill-descript.md`:
- All 6 sub-tasks complete
- Closing criteria: PASS
- Add `## Outcome` section summarizing:
  - 48 skills re-audited
  - 6 manual skills classified
  - Validator Appendix C added
  - Activation tester passing 50/50
  - AGENTS.md "Skill Recall Trigger" section live
- Set status: `active` → `archive`
- Update progress: `6/6`

---

## 10. Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| **R1: 3-段 formula 改完 recall hit rate 跌** | 🟡 Medium | 🔴 High | Pilot top-10 (M1.3) 先，Josh review 24h 觀察 hit rate 然後 scale M1.4 |
| **R2: LLM extraction pipeline hallucination** | 🟡 Medium | 🟡 Medium | Confidence threshold ≥0.85 auto-apply; <0.85 manual review; <0.60 manual rewrite |
| **R3: Manual skill 過度限制 — Josh 唔記得 explicit call** | 🟢 Low | 🟡 Medium | AGENTS.md section 明示 `/skill:name` syntax + activation_tester 教育 LLM |
| **R4: Validator Appendix C 過嚴 — 阻擋合法 skill** | 🟡 Medium | 🟡 Medium | Soft warnings (length) vs hard errors (XML/vague/spam); Josh 簽收前先 dry-run 1 次 |
| **R5: M1.2 嘅 LLM extraction 喺 production 唔 work** | 🟡 Medium | 🔴 High | 喺 M1.3 第一次跑只改 3 個 skill 試水溫, 唔一次過改 10 個 |
| **R6: Scope explosion — 16hr 變 40hr** | 🟡 Medium | 🟡 Medium | Day 3 stage gate check; if > 6hr spent on M1.2+M1.3, freeze + reassess |
| **R7: Rollback 太慢 — 改咗 5 個發現要 revert 全部** | 🟢 Low | 🟡 Medium | Per-skill `.bak-<ts>` + per-skill git commit; revert = 1 command per skill |
| **R8: #158 Phase 3 adaptive gate 衝突 with M1** | 🟢 Low | 🟡 Medium | M1 完成後再觀察 7 日, 等 #158 phase 3 24h evaluation 出結果先 incorporate |

---

## 11. Test Plan

### 11.1 Per-Task Tests

| Task | Test |
|------|------|
| M1.6 | `node scripts/validate_skill_file.js skills/_learned_aliveness-noise-reduction/SKILL.md` → exit 0 (regression: existing skill still passes) |
| M1.6 | 新增 test case: 故意 description with XML → exit 1 |
| M1.2 | Auditor 6 個 self-test case 全部 pass |
| M1.2 | Auditor 喺 48 skills 上跑 → output 48 行 JSONL，schema 一致 |
| M1.3 | 改完 top-10 後, 重跑 M1.2 → 全部 score ≥ 70 |
| M1.3 | Junk rate tracker (#150) Day 5 觀察 → 唔好 spike > 15% |
| M1.5 | 6 個 manual frontmatter 改完, validate 全部 OK |
| M1.7 | activation_tester 50/50 pass, exit 0 |
| M1.8 | AGENTS.md section 對齊 `<categorized_skills>` 描述 + 唔好 contradict 現有 rules |
| M1.9 | `node scripts/issue_manager.js complete 161` → status: archive |

### 11.2 Integration Test (Day 7)

```bash
# 1. Spam 10 messages, verify LLM triggers correct skills
# 2. Verify 6 manual skills NEVER auto-trigger
# 3. Junk rate tracker 24h data → 唔好 spike
# 4. validate_skill_file.js 喺所有 48 skills → 100% pass
# 5. skill-learner plugin <categorized_skills> block 仍然有 48 entries
# 6. Cron pipeline (`skill_reviewer_bot.js`) 仍然 work — 1 manual run + 1 cron run 唔 error
```

### 11.3 Regression Tests (continuous)

- [ ] All 48 skills still pass `validate_skill_file.js`
- [ ] `skill-learner` plugin 仍然 inject catalog
- [ ] `route-enforcer` plugin 仍然 inject routing label
- [ ] cron `*/30 * * * *` skill_reviewer 仍然 work
- [ ] LLM recall 唔跌 (compare 10 messages pre/post M1)

---

## 12. Rollback Strategy

### 12.1 Per-Task Rollback

| Task | Rollback |
|------|----------|
| M1.6 | `git checkout HEAD~1 -- scripts/validate_skill_file.js` |
| M1.2 | Delete `.spawn/reports/description_audit_2026-06-XX.*` (no file change) |
| M1.3 / M1.4 | `cp skills/_learned_<name>/SKILL.md.bak-<ts> skills/_learned_<name>/SKILL.md` (per skill) |
| M1.5 | `git checkout HEAD~1 -- skills/_learned_<name>/SKILL.md` (per skill) |
| M1.7 | Delete `scripts/skill_activation_tester.js` |
| M1.8 | `git checkout HEAD~1 -- AGENTS.md` |
| M1.9 | `node scripts/issue_manager.js reopen 161` |

### 12.2 Full Rollback (worst case)

```bash
# Nuclear option — revert all M1 changes
git reset --hard m1-baseline
rm -f .spawn/reports/description_audit_*.jsonl
rm -f .spawn/reports/activation_test_*.jsonl
```

### 12.3 Rollback Trigger Conditions

- **Hard trigger (immediate revert):**
  - LLM recall hit rate drops > 30% in 24h post-M1.3
  - Junk rate > 25% in 48h (more than 2x pre-M1)
  - P0 bug discovered (e.g., validator rejects ALL skills)
  - Manual skill accidentally auto-triggers 1 time

- **Soft trigger (review + maybe revert):**
  - Junk rate 15-25% in 48h → freeze + investigate
  - 1-2 skills score < 70 post-M1.3 → re-do individually
  - AGENTS.md section confuses LLM (false trigger of skills mentioned in section) → tighten wording

---

## 13. Daily Schedule (Mon 06-15 → Sun 06-21)

| Day | Tasks | Hours | Deliverable |
|-----|-------|-------|-------------|
| **Mon 06-15** | M1.6 (validator Appendix C, 1h) + M1.2 start (1.5h) | 2.5h | Validator extended, auditor draft 50% |
| **Tue 06-16** | M1.2 finish (0.5h) + M1.3 start (2.5h) | 3h | Auditor live, top-3 skills re-described |
| **Wed 06-17** | M1.3 continue (3h) | 3h | Top-10 done + audited, Josh 30min review session |
| **Thu 06-18** | M1.4 (5h) split: morning M1.5 (2h) + afternoon M1.4 (3h) | 5h | All 48 done + 6 manual flagged |
| **Fri 06-19** | M1.4 finish (2h) + M1.7 (2h) | 4h | Activation tester 50/50 pass |
| **Sat 06-20** | M1.8 (0.5h) + 24h observation window | 0.5h | AGENTS.md live, monitor junk rate |
| **Sun 06-21** | M1.9 (0.25h) + closing report + #161 close | 0.5h | All done, #161 archived |
| **TOTAL** | | **18.5h** | (+ 2.5h buffer vs 16hr estimate) |

### Parallelization detail
- **Thu 06-18:** M1.4 + M1.5 parallel via 2 sub-agents (M3 for description rewrite batch, M2.7 for frontmatter edits)
- **Fri 06-19:** M1.4 剩餘 + M1.7 — M1.7 獨立 sub-agent
- **Sat 06-20:** Observation only, M1.8 0.5h quick edit

### Stage gates (decision points)

| Gate | Day | Pass criteria | Fail action |
|------|-----|---------------|-------------|
| **G1: Auditor ready** | Tue 06-16 EOD | 48/48 skills scanned, score 0-100 distribution, ≥ 5 self-tests pass | Delay M1.3, fix auditor |
| **G2: Top-10 done** | Wed 06-17 EOD | 10/10 skills score ≥ 70, recall hit rate 唔跌 > 10% | Revert + redesign formula |
| **G3: All 48 done** | Fri 06-19 EOD | 48/48 score ≥ 70, validator 100% pass, 6 manual classified | Delay M1.9, partial close #161 |
| **G4: Activation verified** | Sat 06-20 EOD | 50/50 test pass, no manual skill injected | Re-classify + re-test |
| **G5: Final** | Sun 06-21 EOD | Junk rate stable, recall hit rate stable, #161 closed | Reopen #161, schedule Phase 2 |

---

## 14. Scope Explosion Prevention

### 14.1 Hard Limits

- **Max 16 hr wall time** — 超出即拆 #161 Phase 2 (allowed-tools + progressive disclosure)
- **Max 3 LLM extraction batches** — 第 4 次就 freeze, 手動 review pattern
- **Max 5 changes per skill** — description 改完唔好 keep iterating, ship current best
- **Max 1 re-attempt per failure** — 第 2 次 fail 即 escalate Josh

### 14.2 Anti-Scope-Creep Triggers

If 任一以下發生，**freeze + reassess**:
- [ ] M1.2 + M1.3 過 6 hr 仍未完成 (預計 5hr)
- [ ] M1.4 需要超過 1 個 sub-agent round (> 5hr)
- [ ] Validator Appendix C 嘅新 check 撞到 ≥ 3 個 false positive
- [ ] 3-段 formula 改完 trigger behavior 出現 regression

### 14.3 What NOT to do (scope protection)

- ❌ 唔好喺 M1 期間重寫整個 skill library — 只改 description
- ❌ 唔好 implement `allowed-tools` frontmatter (Phase 2)
- ❌ 唔好改 skill-learner plugin (已 inject catalog，唔好加 matching logic)
- ❌ 唔好 implement Anthropic 嘅 .skill packaging (low priority)
- ❌ 唔好做 quantitative benchmark (Phase 3, separate work)
- ❌ 唔好 extend route-enforcer 加 skill matching (#139 教訓)

---

## 15. Appendix A — File Layout

```
~/.openclaw/workspace/
├── AGENTS.md                                    [M1.8: +50 lines "Skill Recall Trigger"]
├── scripts/
│   ├── skill_description_auditor.js             [M1.2: NEW, ~250 lines]
│   ├── skill_activation_tester.js               [M1.7: NEW, ~180 lines]
│   └── validate_skill_file.js                   [M1.6: +80 lines Appendix C]
├── skills/
│   └── _learned_*/SKILL.md (48)                 [M1.3: 10 files, M1.4: 31 files, M1.5: 6 files]
├── .spawn/reports/
│   ├── m1-execution-plan-2026-06-14.md          [THIS FILE]
│   ├── description_audit_2026-06-XX.jsonl       [M1.2 output]
│   ├── description_audit_2026-06-XX.md          [M1.2 summary]
│   ├── description_rewrite_proposals.jsonl      [M1.3/M1.4 medium-confidence]
│   └── activation_test_2026-06-XX.jsonl         [M1.7 output]
└── .issues/
    ├── active/161 (will archive)
    └── active/158 (will update cross-ref)
```

## 16. Appendix B — Open Questions (escalate to Josh)

| Q | Status | Default if not answered |
|---|--------|--------------------------|
| Q1: 6 manual 邊個 first choice if reject? | Open | Use my recommendation (top 6) |
| Q2: M1.3 top-10 list 同意嗎? | Open | Use my recommendation (top 10 by score) |
| Q3: 3-段 formula 中文 vs 英文? | Open | Bilingual (英文 keywords for matching, 中文 for readability) |
| Q4: Confidence threshold 0.85 太嚴? | Open | 0.80 + manual review queue for 0.70-0.85 |
| Q5: AGENTS.md "Skill Recall Trigger" section 太長? | Open | 50 lines acceptable for first version, can compress later |
| Q6: 6 manual 之外有冇其他要 manual? | Open | No (current 6 covers all high-risk categories) |
| Q7: Stage gate Day 3 太早? | Open | Yes if auditor 唔 ready; adjust per actual progress |

---

## 17. Appendix C — Cross-references

- **#161** FakeMaidenMaker 改進 Phase 1 — parent issue (will close after M1.9)
- **#158** Skill Reviewer vs Anthropic — sibling (Phase 3 in flight, separate work)
- **#146** Skill Reviewer Pipeline Bugs (6 P0) — M1 indirectly improves via better validator
- **#150** Skill Junk Rate Tracker — primary metric for M1 success
- **#147** Skill Reviewer Cron Frequency — cron optimization separate
- **#155** Error Auto Issue — example of 3-段 description rewrite candidate
- **Anthropic skill-creator** — source of 3-段 formula + activation control
- **Plugin-skill-matcher-analysis-2026-06-14.md** — Path F (AGENTS.md) recommended over plugin
- **skill_reviewer_audit_2026-06-10.md** — 6 P0 + 4 WARN bugs context

---

*Plan completed 2026-06-14 10:42 HKT. Total estimated effort: 16-18 hours over 1 week (Mon 06-15 → Sun 06-21). Awaiting Josh approval to proceed.*
