# Skills Audit Report — 2026-06-08

**Auditor:** Senior skills curator subagent (M3 + thinking:high)
**Scope:** `~/.openclaw/workspace/skills-learned/` — 27 skills
**Method:** Read every SKILL.md fully → score 1-5 on three dimensions → cross-reference overlap → output report

---

## 0. Audit Constraints & Caveats

| 限制 | 影響 |
|------|------|
| **冇 per-skill invocation stats** | `.skill_metrics.json` 只有 reviewer run counts（97 個 entry，1 curator run），無 per-skill hit count。Score 全部靠 manual content review。 |
| **Status label 同 frontmatter 唔一致** | User task table 寫「25 skills」，實際 **27 個**。Table 入面好多標 `active` 嘅 skill，frontmatter 入面係 `draft`（見 §1 source-of-truth check）。以 **frontmatter 為準**。 |
| **讀 only，無 write skill 內容** | 全部 modify/archive 建議都係 recommendation，唔郁 file。 |
| **Stubs 已 archived** | cron-job-testing (385B), route-enforcer-plugin-debugging (806B), llm-call-execfile-migration (402B) 屬 truncated output。3 個都係真 stub。 |

---

## 1. 評分 Matrix（27 個 skills）

> **Generic** = 跨項目可用（5 = 任何 agent system 直接 apply；1 = 極度 OpenClaw 綁定）
> **Helpful** = 跟住做真係 work（5 = 唔使再問；1 = 純 theory）
> **Clarity** = step-by-step executable（5 = 直接 run；1 = 空泛）
> **Status OK?** = frontmatter 嘅 status 同 content 質素夾唔夾

| # | Skill | Size | Status (frontmatter) | Generic | Helpful | Clarity | Status OK? | Recommendation |
|---|-------|------|----------------------|---------|---------|---------|------------|----------------|
| 1 | ai-hot-push-workflow | 1188B | draft | 2 | 4 | 4 | fix | **modify**（promote，generic-ify 少少）|
| 2 | cron-debugging-procedures | 1499B | draft | 2 | 3 | 3 | fix | **merge** → cron-failure-investigation |
| 3 | cron-failure-investigation | 2724B | draft | 3 | 5 | 5 | fix | **modify**（promote，Type A/B 框架就係 gold）|
| 4 | cron-job-testing | 385B | archived | 2 | 1 | 1 | yes | **regenerate** OR delete（視乎有冇測試需求）|
| 5 | cron-model-selection-verification | 13429B | draft | 3 | 5 | 5 | fix | **keep** + promote（13KB 詳細，top pick）|
| 6 | cron-thin-executor-migration | 1375B | active | 4 | 4 | 4 | yes | **keep** |
| 7 | daily-synthesis | 3862B | draft | 4 | 4 | 4 | fix | **modify**（promote）|
| 8 | deep-research-subagent-spawning | 3733B | draft | 4 | 4 | 4 | fix | **modify**（promote）|
| 9 | issue-conclusion-overturn-cleanup | 6129B | draft | 4 | 5 | 5 | fix | **keep** + promote（single-source-of-truth pattern）|
| 10 | knowledge-curation-from-browser | 5966B | draft | 3 | 5 | 5 | fix | **keep** + promote（7-step + Cantonese 範本）|
| 11 | llm-call-execfile-migration | 402B | draft | 3 | 1 | 1 | no | **regenerate**（truncated after Context header）|
| 12 | memory-flush-date-boundary | 3700B | draft | 3 | 4 | 4 | fix | **modify**（promote）|
| 13 | model-migration-workflow | 2118B | draft | 4 | 4 | 3 | fix | **modify**（promote；同 cron-model-selection 有 overlap）|
| 14 | multi-phase-subagent-orchestration | 3399B | draft | 4 | 4 | 4 | fix | **modify**（promote）|
| 15 | multi-session-resumption | 5482B | draft | 4 | 4 | 5 | fix | **modify**（promote；同 SOUL.md Compaction Contract 有 overlap）|
| 16 | openclaw-config-schema-debugging | 6525B | draft | 2 | 4 | 5 | fix | **keep** + promote（niche 但極 deep）|
| 17 | parallel-subagent-implementation | 8278B | active | 5 | 5 | 5 | yes | **keep** ⭐（top pick）|
| 18 | pipeline-heartbeat-debugging | 1434B | draft | 4 | 3 | 4 | fix | **modify**（promote）|
| 19 | provider-response-sanitization | 5701B | draft | 4 | 5 | 5 | fix | **keep** + promote（scrubber pattern，top pick）|
| 20 | rapaport-email-summary | 2868B | active | 1 | 5 | 5 | yes | **keep**（超 niche 但 perfect — 唔好 generic-ify）|
| 21 | route-enforcer-plugin-debugging | 806B | archived | 2 | 1 | 1 | yes | **regenerate** OR **delete** |
| 22 | skill-curation-pattern | 8896B | draft | 3 | 5 | 5 | fix | **keep** + promote（meta 但 useful）|
| 23 | skills-audit-workflow | 2625B | draft | 3 | 4 | 3 | fix | **modify**（promote；meta — 考慮做 SOP 唔做 skill）|
| 24 | sub-agent-spawning-workflow | 1578B | draft | 4 | 3 | 3 | fix | **modify** OR **merge** → AGENTS.md spawn 原則（太 thin）|
| 25 | subagent-code-tuning-workflow | 1871B | draft | 4 | 3 | 3 | fix | **modify**（promote；surgical pattern 有用）|
| 26 | subagent-sideeffect-containment | 5266B | draft | 5 | 5 | 5 | fix | **keep** + promote ⭐（opt-in vs opt-out，top pick）|
| 27 | system-code-debug-triage | 3242B | draft | 4 | 4 | 4 | fix | **modify**（promote）|

### Status Source-of-Truth Check

| Category | Count | Notes |
|----------|-------|-------|
| Frontmatter = `active` | **3 個**（cron-thin-executor-migration, parallel-subagent-implementation, rapaport-email-summary）| 完全對得返。|
| Frontmatter = `draft` | **22 個** | User task table 將 12 個標錯做 active — 全部以 frontmatter 為準。|
| Frontmatter = `archived` | **2 個**（cron-job-testing, route-enforcer-plugin-debugging）| 兩個都係 stub。對嘅。|
| 應該 active 但 frontmatter 寫 draft | **~20 個** | 大量 >2KB 成熟 workflow 仍然 draft，無 promotion gate。|

---

## 2. Top Picks（值得用 — 8 個）

### ⭐ #1. parallel-subagent-implementation (8278B, active)
**Generic 5 / Helpful 5 / Clarity 5**

- **點解 generic：** Batch-chaining + audit-implement pairing + post-implementation audit gate，呢三個 pattern 完全唔同 OpenClaw 綁死。任何 multi-agent framework 都有「多 track 同步改 + merge 結果」嘅需要。
- **點幫到 user：** 11 個 step 入面包埋 sub-agent 死亡、phantom success、context drift、orphaned state 嘅 pitfall。**Audit sub-agent 寫 report 落 disk** 呢個 detail 係真功夫 — 好多人會忘記。
- **Evidence:** "Post-Implementation Standalone Audit" section (Step 9) 有「HIGH bugs block deploy」嘅明確 gate criteria。

### ⭐ #2. subagent-sideeffect-containment (5266B, draft → should be active)
**Generic 5 / Helpful 5 / Clarity 5**

- **點解 generic：** 「Opt-in vs opt-out」係 software design 通用 pattern，唔係 agent 獨有。任何 shared utility（DB connection、notification sender、log writer）都中招。
- **點幫到 user：** Step 5-6 嘅 `optInFlag AND NOT optOutFlag` precedence rule + 「cron 已 pass opt-out 所以唔會 regression」嘅 migration reasoning，係真係做過呢類 migration 先寫得出。
- **真正 value：** Section「Key Design Principles」嘅「**sub-agent cannot be relied upon to pass opt-out flags**」係 architectural insight，唔只係 procedural。

### ⭐ #3. provider-response-sanitization (5701B, draft → should be active)
**Generic 4 / Helpful 5 / Clarity 5**

- **點解 generic：** Scrubber pattern（deterministic + composable + idempotent + self-contained）係任何需要處理 LLM output 嘅 system 都用得着。`<thinking>` tag 只係 one example — 任何 leaked content 都通用。
- **點幫到 user：** Step 5 edge cases list（single block, multiple, nested, malformed, mixed, empty, idempotent）係 mature test plan。Pitfall「auto-delivery bypasses the scrubber」係真 bug class，唔係 toy example。
- **Caveat：** 個 example 用 `MiniMax <thinking>` leak 比較 niche，但核心 pattern 100% generic。

### ⭐ #4. cron-model-selection-verification (13429B, draft → should be active)
**Generic 3 / Helpful 5 / Clarity 5**

- **點解 generic：** 雖然有 MiniMax-M3 / deepseek 細節，但**Step 2.5「session jsonl model_change events」嘅 forensic pattern 適用任何有 fallback chain 嘅 LLM system**。
- **點幫到 user：** 「`cron_run_logs.model` records the FINAL model after fallbacks, NOT initial attempt」係 #1 trap — 呢個 pitfall 解決咗好多人嘅「auto 跑用 deepseek 但 manual 跑用 M3」嘅 false diagnosis。
- **Real example:** 文件入面 embed 咗 2026-06-07 嘅真實 cron investigation log 配 model_change chain。**呢個 evidence-based writing 係其他 skills 應該學嘅標準**。

### ⭐ #5. issue-conclusion-overturn-cleanup (6129B, draft → should be active)
**Generic 4 / Helpful 5 / Clarity 5**

- **點解 generic：** Single-source-of-truth rewrite pattern 通用到任何 document 系統（issue tracker、wiki、design doc、incident report）。
- **點幫到 user：** Section 4 嘅 new structure template（TL;DR → Final Root Cause → Evidence → Actions → Open Items → Lessons）係 production-grade doc structure。Pitfall「Don't keep a "what we used to think" section」係 wisdom。
- **Sub-pattern:** Section 3 嘅「archive raw data, don't delete」同 Section 5 verify checklist 係 methodological maturity。

### ⭐ #6. knowledge-curation-from-browser (5966B, draft → should be active)
**Generic 3 / Helpful 5 / Clarity 5**

- **點解 generic：** Article → structured note + tags + cross-links + 啟發 reflection，係 any knowledge management system 都通用（Notion, Roam, Obsidian, Logseq）。
- **點幫到 user：** 7-step workflow 連 Obsidian frontmatter format + `## 啟發` requirement + 5 test cases for filename length / X thread scroll timeout。Pitfall「## 啟發 is NOT optional」係用過之後真係會 work。
- **Caveat:** Obsidian + Cantonese + 啟發 有少少 niche，但 core 嘅「don't re-read same article」+「tags must be useful for recall」係通用。

### ⭐ #7. cron-failure-investigation (2724B, draft → should be active)
**Generic 3 / Helpful 5 / Clarity 5**

- **點解 generic：** Type A (script-direct) vs Type B (agent-internal) 分類，係任何 cron / scheduled job 系統都通用（k8s CronJob, AWS EventBridge, GitHub Actions 都面對同樣 trade-off）。
- **點幫到 user：** Step 6 嘅 4 大 root cause 分類（LLM timeout, LLM quota, script error, config error）係真係 systematic 嘅 debugging taxonomy。Pitfall「Script 行完但 agent echo 唔到 唔係 script 問題」係 high-value insight。

### ⭐ #8. skill-curation-pattern (8896B, draft → should be active)
**Generic 3 / Helpful 5 / Clarity 5**

- **點解 generic：** Upstream filtering + post-creation verification + junk decision tree，係 any content curation system 通用。
- **點幫到 user：** Step 9 嘅「`bodyLength < 200` AND `daysSinceMtime < 30` → draft」decision tree 係 production-grade。Step 12-13 嘅「`skills.entries` config registration, NOT symlinks」係 architecture 真相 — **呢個係好多 OpenClaw 用戶會踩嘅坑**。

---

## 3. 修改清單（值得救 — 11 個優先）

按 priority 同 work estimate 排：

### 🔴 P0 — 必須改（重大 overlap 或 status 錯）

| # | Skill | Action | Work | Reason |
|---|-------|--------|------|--------|
| **M1** | **cron-debugging-procedures** + **cron-failure-investigation** | **合併**：cron-debugging-procedures（1499B）只有 5 步同 cron-failure-investigation（2724B）高度重疊。將 cron-debugging 嘅 timeline step 摺入 cron-failure 嘅 Step 1 / Step 6。 | ~30 min | 後者已經有 Type A/B framework + 7 steps，cron-debugging 冇 additive value。|
| **M2** | **sub-agent-spawning-workflow** | **合併入 AGENTS.md「Spawn 原則」section** 或者大幅 enhance | ~45 min | 1578B 只有 5 steps + 5 pitfalls，大量同 AGENTS.md / route_model.yaml 重疊。**獨立 skill 唔 justify。** |
| **M3** | **multi-session-resumption** | **抽走 Step 1 (trigger phrase 識別) 同 SOUL.md Compaction Contract 對齊** | ~30 min | 6 steps 入面 Step 1「recognize trigger」太 trivial。Step 3-6 嘅 issue file 真理 + live state verify 係真 value。|
| **M4** | **model-migration-workflow** | **合併入 cron-model-selection-verification** 或者明確劃分邊個做 rate limit recovery、邊個做 model swap | ~45 min | Step 7（rate limit recovery）同 cron-model-selection-verification 嘅 Step 4 高度重疊。 |

### 🟡 P1 — 應該改（status 升級 + 小 modify）

| # | Skill | Action | Work | Reason |
|---|-------|--------|------|--------|
| **M5** | **ai-hot-push-workflow** (1188B) | `status: active` + 加 generic framework（push channel 抽象化）| ~20 min | Content 已經 mature，draft 唔合理。|
| **M6** | **daily-synthesis** (3862B) | `status: active` + 把 path 抽象成 `${OBSIDIAN_VAULT}/my-daily/${DATE}.md` | ~15 min | 硬 code `~/my-daily/` 唔 portable。|
| **M7** | **deep-research-subagent-spawning** (3733B) | `status: active` | ~5 min | M3 thinking-high sub-agent pattern 通用，但 draft 阻礙採用。|
| **M8** | **memory-flush-date-boundary** (3700B) | `status: active` + abstract OpenClaw `compaction.mode: "safeguard"` 為 generic 嘅「date-prefixed file safety check」| ~25 min | 個 pattern 通用，但描述太綁死 OpenClaw safeguard。|
| **M9** | **multi-phase-subagent-orchestration** (3399B) | `status: active` | ~5 min | 内容齊全。|
| **M10** | **pipeline-heartbeat-debugging** (1434B) | `status: active` | ~5 min | HEARTBEAT_OK detection 通用，4 個 pitfalls 夠用。|
| **M11** | **system-code-debug-triage** (3242B) | `status: active` | ~5 min | 7 步 systematic debugging，generic 4。|
| **M12** | **subagent-code-tuning-workflow** (1871B) | `status: active` + 補充「multiple agents in parallel on different files」scenario | ~15 min | 5 步 surgical，但缺 parallel-scope 嘅 safety rule。|

### 🟢 P2 — 升 active + 維持原樣

- **openclaw-config-schema-debugging** (6525B) — promote to active，**唔好 generic-ify**。`additionalProperties: false` + `openclaw doctor` + dist file patching 都係 OpenClaw-specific，**留住做 reference doc**。

---

## 4. Archive 清單（建議刪除或大幅 modify）

| Skill | 狀態 | 建議 | Reason |
|-------|------|------|--------|
| **cron-job-testing** (385B) | archived (stub) | **Regenerate** 或 **delete** | 385B 內容得 1 line「確認 cron job 已注册」，完全唔 usable。如果未來需要 testing SOP，先 regenerate 唔好盲 delete。|
| **route-enforcer-plugin-debugging** (806B) | archived (stub) | **Regenerate** 或 **delete** | 806B stub，內容只係「搜 `before_model_resolve` hook」。如果 route-enforcer 仲有 active issue，先 regenerate。|
| **llm-call-execfile-migration** (402B) | draft (truncated) | **Regenerate** | 402B 但 frontmatter status = draft，content truncated after `## Context` header。**呢個唔係 archived 而係 draft — reviewer 出 output 時 truncated 咗**。需要 regenerate，唔可以 archive。|

> **Net recommendation:** 三個 stub 全部 regenerate（唔好 archive），因為佢哋對應嘅 use case（cron testing, plugin debugging, shell→execFile 遷移）都係會再撞到嘅。Stubs 唔好刪 — 等下次撞到同樣 issue 就有現成 trigger 用。

---

## 5. 重疊 / 合併建議

### Cluster A: Cron 故障排查（4 → 2）

| Original | 合併後 |
|----------|--------|
| cron-debugging-procedures (1499B) | **併入 cron-failure-investigation**（摺 Step 1-3 + 5 pitfalls）|
| cron-failure-investigation (2724B) | **保留**做主 skill，promote to active |
| cron-job-testing (385B stub) | **Regenerate**，變 cron-failure-investigation 嘅 Step 4「verify fix」sub-section |
| cron-model-selection-verification (13429B) | **保留獨立**（focused 喺 model/fallback，有 13KB 內容 justify）|
| cron-thin-executor-migration (1375B) | **保留獨立**（係 migration pattern，唔係 debug）|

**Final cron suite:** `cron-failure-investigation` (主) + `cron-model-selection-verification` (深) + `cron-thin-executor-migration` (transform) = 3 個而唔係 5 個。

### Cluster B: Sub-agent spawning（6 → 4）

| Original | 合併後 |
|----------|--------|
| sub-agent-spawning-workflow (1578B) | **併入 AGENTS.md**「⚠️ Spawn 原則」section 或者大幅 enhance |
| deep-research-subagent-spawning (3733B) | **保留獨立**（focused use case，promote）|
| multi-phase-subagent-orchestration (3399B) | **保留獨立**（sequential pattern，promote）|
| parallel-subagent-implementation (8278B) | **保留獨立**（parallel pattern，top pick）|
| subagent-code-tuning-workflow (1871B) | **保留獨立**（surgical pattern，promote）|
| subagent-sideeffect-containment (5266B) | **保留獨立**（design pattern，top pick）|

**Final sub-agent suite:** 4 個 focused skills + 1 個放返 AGENTS.md。唔好併埋 — 每個 focused use case 都 independent。

### Cluster C: Memory / Session（2 → 1）

| Original | 合併後 |
|----------|--------|
| memory-flush-date-boundary (3700B) | **保留獨立**（specific bug class）|
| multi-session-resumption (5482B) | **保留獨立**但抽走 trigger phrase step 對齊 SOUL.md |

兩個唔同 concerns（one 係 bug class，一個係 resumption workflow），**唔好合併**。

### Cluster D: Sanitization / Pipeline（2 → 2）

| Original | 合併後 |
|----------|--------|
| provider-response-sanitization (5701B) | **保留獨立**（top pick）|
| pipeline-heartbeat-debugging (1434B) | **保留獨立**（HEARTBEAT_OK detection，唔同於 sanitization）|

唔同 concerns。唔合併。

### Cross-cluster 重疊（不需合併，但要 cross-link）

- `multi-session-resumption` Step 5「Status must be actionable」同 AGENTS.md「Compaction Contract」section 高度相似。**Cross-link 唔抄。**
- `model-migration-workflow` Step 7「Rate limit recovery」同 `cron-model-selection-verification` Step 4 相似。**Cross-link 唔抄。**
- `system-code-debug-triage` Step 1「Read the file to verify each bug is real」同 AGENTS.md「🟢 Post-Edit 必須驗證」section 相似。**Cross-link 唔抄。**

---

## 6. 對 skill-reviewer 嘅 Feedback

### 🔴 Systemic Issues

#### 6.1 高 Truncation Rate（11%）

**Stats:** 27 個入面有 3 個 truncated stubs (cron-job-testing 385B, route-enforcer-plugin-debugging 806B, llm-call-execfile-migration 402B)。仲有 1 個係 silently truncated（llm-call-execfile-migration 標 `status: draft` 唔係 `archived` — 表示 reviewer 冇 detect 到 truncation，mark 做 draft 就算「OK」）。

**Root cause:** Reviewer 寫到某個 step 就 hit token limit 停咗，frontmatter 仍然有齊 fields 所以表面上睇落 OK。**冇 truncation detector**。

**Suggested fix:**
- Reviewer 寫完必須自己 `wc -c` 確認 file size ≥ 1500B（below 呢個就 reject 並 regenerate）
- frontmatter 必須有 `bodyCharCount` field，curator 入面 assert ≥ 1500
- Truncation stub 應該 auto-`status: archived` + `archivedReason: "truncated output, bodyCharCount=N < 1500"`，唔好當 draft

#### 6.2 Status Labelling 嚴重 Lag

**Stats:** 22 個 frontmatter 寫 `draft`，但 **>2KB + 有 Workflow + Pitfalls sections 嘅至少有 18 個** 應該 active。User task table 將 12 個標錯 active 更係 reflect 咗呢個問題 — reviewer / curator 從來冇 system 升呢啲 skill。

**Suggested fix:**
- **Auto-promote rule:** `bodyLength >= 2000` AND `has ## Workflow section` AND `has ## Pitfalls section` AND `daysSinceMtime >= 7` → auto `status: active`
- Curator 嘅 promote gate 唔好 manual，**用 threshold rule**
- User task table 同 frontmatter 唔 match 表示 curator validation 冇 run（或者 fail silent）

#### 6.3 缺乏 Overlap Detection

**Stats:** cron-debugging-procedures、cron-failure-investigation、cron-job-testing 三個 skills 全部都係「cron 壞咗點算」use case，reviewer 冇 check 創建前有冇同類。

**Root cause:** Reviewer prompt 寫「create a skill for this」但冇 explicit step 叫佢 `read skills-learned/ | grep -l "cron"` 先。

**Suggested fix:**
- Reviewer prompt 加 explicit step：**「Before creating, list existing skills with similar trigger keywords. If overlap detected, mark skill as `superseded` (referring to existing skill) instead of creating new」**
- Curator 入面加 dedup scan：create new skill 時 grep 已有 skill descriptions，>60% word overlap → quarantine

#### 6.4 過度 OpenClaw 綁定

**Stats:** 27 個入面有 ~10 個 hard-code OpenClaw 細節（`openclaw.json`、`openclaw doctor`、`~/.openclaw/agents/main/sessions/`, `compaction.mode: "safeguard"`, `agents.defaults.fallbackNoticeMode`, etc.）。

**Suggested fix:**
- Reviewer prompt 加 explicit guidance：**「Prefer generic patterns; hard-code specific system paths only when truly unique」**
- 每個 skill 寫完 reviewer 要問自己：「如果我將呢個 skill 抄去一個 LangChain / AutoGen setup，70% 嘅 step 仲啱唔啱？」< 70% → 標 `niche-openclaw-only`

#### 6.5 Stale 嘅 Niche 內容冇 Lifecycle

**Stats:** `rapaport-email-summary` 完美 niche，但呢類 skill 應該有 freshness check — 萬一 Rapaport 改 format，呢個 skill 就 stale。

**Suggested fix:**
- Niche skill（Generic 1-2）入面要加 `lastVerifiedAt: YYYY-MM-DD` 字段
- Curator monthly 掃 niche skills 嘅 `lastVerifiedAt` > 90 日 → flag for review

#### 6.6 「META 還是 SKILL？」模糊地帶

**Stats:** `skill-curation-pattern`（curator 用）、`skills-audit-workflow`（audit 用）— 呢兩個係 meta workflow，唔係 task workflow。佢哋做嘅嘢其實係 SOP（run by cron，not by user prompt trigger）。

**Suggested fix:**
- 將 meta skills 同 task skills 分開 directory：`skills-learned/meta/` vs `skills-learned/task/`
- 或者加 frontmatter field：`triggerType: "meta" | "user-task"`
- 唔好 inject 入 `<available_sk�ills>`，改用 cron entry point

#### 6.7 缺少「Failure Mode 自我披露」

**Stats:** 大部分 skills 寫「點做」但少寫「點做會失敗」。`subagent-sideeffect-containment` 嘅 Pitfall section 係金標準（5 條 pitfalls，2 條有 architectural insight）— 其他 skills 應該學。

**Suggested fix:**
- Reviewer prompt 加 requirement：**「每個 skill 必須有 ≥ 3 pitfalls，當中至少 1 個係 architectural insight 而唔係 procedural」**
- Curator lint pass：pitfalls count < 3 → flag

---

## 7. 30/60/90 Day Action Plan

### Within 30 min (now)
- ✅ Promote 8 個 top picks to `status: active`（cron-model-selection-verification, cron-failure-investigation, parallel-subagent-implementation, subagent-sideeffect-containment, provider-response-sanitization, issue-conclusion-overturn-cleanup, knowledge-curation-from-browser, skill-curation-pattern, cron-thin-executor-migration, rapaport-email-summary）
- ✅ Regenerate llm-call-execfile-migration (402B stub)

### Within 7 days
- 🔴 Merge cron-debugging-procedures → cron-failure-investigation
- 🔴 Merge sub-agent-spawning-workflow → AGENTS.md「Spawn 原則」section
- 🔴 Promote 11 個 P1 modify skills to active

### Within 30 days
- 🟡 Implement truncation detector in reviewer
- 🟡 Implement auto-promote rule in curator
- 🟡 Implement overlap detection in reviewer prompt
- 🟡 Split meta skills from task skills (skill-curation-pattern, skills-audit-workflow → `meta/`)

### Within 90 days
- 🟢 Generic-ify pass on 6 個 most-OpenClaw-bound skills（ai-hot-push-workflow, daily-synthesis, memory-flush-date-boundary, openclaw-config-schema-debugging, route-enforcer-plugin-debugging, model-migration-workflow）
- 🟢 Curator monthly freshness check for niche skills
- 🟢 Per-skill invocation tracking（補 audit 限制）

---

## 8. 結論

**27 個 skills 入面：**
- **8 個 top picks**（parallel-subagent-implementation, subagent-sideeffect-containment, provider-response-sanitization, cron-model-selection-verification, issue-conclusion-overturn-cleanup, knowledge-curation-from-browser, cron-failure-investigation, skill-curation-pattern）— keep as is 或 promote
- **11 個值得救**（M1-M12）— modify、merge、promote
- **3 個 stub**（cron-job-testing, route-enforcer-plugin-debugging, llm-call-execfile-migration）— regenerate，**唔好 archive**
- **5 個 ambient / meta skills**（cron-thin-executor-migration, multi-phase-subagent-orchestration, deep-research-subagent-spawning, subagent-code-tuning-workflow, system-code-debug-triage）— keep + promote

**Overall 結論：** Skill-reviewer 嘅 output 質素其實唔差，workflows 好多係真功夫（特別係 cron-failure-investigation、subagent-sideeffect-containment、provider-response-sanitization）。**但 curation pipeline 落後於 creation** — truncation detection 冇、auto-promote 冇、overlap detection 冇。**最大 ROI 改善係補呢 3 個 curator 缺口**，唔係改 skill content。
