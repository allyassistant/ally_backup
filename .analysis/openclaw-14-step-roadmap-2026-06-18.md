# OpenClaw 基座工程 14 步 Implementation Roadmap

*對比基座：@servasyy_ai (huangserva) X 文章「Agent Loop 基座工程 - 14 步从单代理到自我进化系统」*
*對比對象：OpenClaw + Ally/Bliss HA 系統*
*產生日期：2026-06-18 10:53 HKT*
*Subagent route: SPAWN_QUALITY (M3)*

---

## Executive Summary

**已做到幾多：** 14 步入面，我哋已經**有 11 步做到 Partial 或以上**（11/14 = 79%），其中 **5 步係 Full**（基座定義、Router、Skill、Sub-agent、Skill 編排、Loop/Cron），**6 步係 Partial**（Settings 權限、Sub-agent 類型、Hooks 強制執行、Skills 庫、Loop 智能、Loop 编排）。

**最大 gap 係咩：** 三個方向：
1. **Step 12（agent-memory/ 持久化 lessons learned）** — 完全冇獨立嘅狀態文件。我哋有 L0/L1/L2 三層 + cross_session_context，但**冇**一個專門俾 agent 自己睇嘅「上次做錯過咩 → 下次唔好再做」狀態文件。呢個係自我進化嘅核心元件，缺失會令 base 永遠只係有經驗而唔會自我改進。
2. **Step 13（自我進化迴路 = 審查 → 寫記憶 → 提鍊技能 → 下次繼承）** — 有零散組件（skill-learner plugin、skill_reviewer_bot、daily_synthesis、issue_auto_followup、anomaly_monitor），但**冇一個閉環**串起呢 4 步。每日 data 喺唔同 file 各做各的，冇 systematic hand-off。
3. **Step 14（打包成 plugin 共享）** — 0%。所有 skill 仍然係 Ally 個人用嘅 symlink。`~/.openclaw/extensions/` 有 8 個 plugin（route-enforcer、skill-learner、skill-auto-suggest、self-healing-loop、skill-tools、debug-event、channel-context、self-healing-loop），呢啲就係「plugin」嘅起點，但**完全冇 packaging / sharing / onboarding 流程**。

**30 日 plan 重心：** Week 1 做兩個 Quick Win（agent-memory/ 啟動 + skill feedback loop 接駁返 cross_session_context）；Week 2-3 砌自我進化迴路（sampler → evaluator → action pipeline）— 呢個已經喺 #169 WP2 設計好，直接 commit；Week 4 做 plugin packaging spec（雖然唔實際 ship，但至少寫清楚點打包）。

---

## 14 步 × OpenClaw 現狀 Mapping Table

| 步驟 | 名 | 我哋現狀 | File/Script Ref | 等級 (Full / Partial / Missing) |
|------|----|---------|-----------------|--------------------------------|
| 01 | 基座 = 模型 + 工具 + 工具權限 + 啟動上下文 | ✅ Full | AGENTS.md L4-15（DISPATCH 架構）、`scripts/router/route_model.yaml`（model）、TOOLS.md（tools）、HEARTBEAT.md（context bootstrap） | 4 樣嘢全部覆蓋 |
| 02 | 同一模型，不同基座 = 完全兩個代理 | ✅ Full | `route_model.yaml` routes 7 個；同一個 minimax-portal provider 配 SPAWN vs SOP vs CODE 3 個 route 各自獨立 config | 體現咗文章論點 |
| 03 | 基座分界線：常量放 context、強制規則放 hooks、操作流程放 skills、隔離任務放 sub-agents | ✅ Full | AGENTS.md `## 對話行為` 4-tier（VALIDATION → ROUTER → CONTENT → DEFAULT）、`scripts/hooks/message_received.js`、41 個 `_learned_*` skill symlinks、sessions_spawn 架構 | 4 層分界完整 |
| 04 | Default Claude Code = 空殼，次次 session 重新推導 | ⚠️ Partial | 有 cross_session_bootstrap（`scripts/cross_session_bootstrap.js`）+ L0/L1 摘要（每日 00:05/00:35 cron）+ `.cross_session_context.md` | 有 handoff 機制，但 context 仲係 15420 bytes，**過大會自動 truncate 重要資料**（見 .cross_session_context.md Compaction Contract） |
| 05 | CLAUDE.md < 500 tokens，事實放呢度，流程放 skill，folder rule 放 rules/ | ⚠️ Partial | AGENTS.md 主文件 ~430 行（難以估算 token 但明顯 > 1500 tokens），混合咗「事實 + 流程 + 規則 + SOP」 | **冇** < 500 tokens 嘅「事實 only」精簡版；冇 rules/ 子目錄；技能有但佔多 |
| 06 | settings.json = 權限 auto-approve vs 阻擋（按回滾成本） | ⚠️ Partial | `route_model.yaml` 有 `cooldown_seconds` + `fallback_chain`，CQM 有 pre-commit hook 阻擋 P0 | 權限分級（auto/deny）**冇** 統一 config；`additionalProperties: false` 喺 plugin schema 出現過 trap 問題（見 issue 範疇） |
| 07 | Sub-agents = 隔離噪音保護主 context。最有價值嘅 = 審查主 agent 質素嘅 sub-agent | ✅ Full | `sessions_spawn` 完整架構、41 個 sub-agent skills（m3-adversarial-challenge-spawn, subagent-qa-verification-workflow, parallel-subagent-implementation, subagent-sideeffect-containment, m3-multi-angle-system-audit 等） | 5 個 sub-agent 類型 skill，**審查主 agent** 嘅有 m3-adversarial-challenge + m3-multi-angle-system-audit — 完全對應 |
| 08 | Skills = 可復用指令單元。基座進化關鍵 | ✅ Full | 41 active `_learned_*` symlinks + openclaw bundled + `skill_workshop` tool + `skill_reviewer_bot.js` (24hr auto-pipeline) + `skill_junk_pause.js` (30-min cron) + `skill_junk_tracker.js` (23:55) | 完整 ecosystem，有 auto-creation（skill-learner plugin）+ auto-curation（skill_reviewer_bot）+ auto-quarantine（junk pause） |
| 09 | Hooks = 強制執行，退出碼可攔操作（pre-tool / post-change / session-end） | ⚠️ Partial | `scripts/hooks/message_received.js`（message:received hook）、`self-healing-loop` plugin（`~/.openclaw/extensions/self-healing-loop/`）、CQM pre-commit（git hook）、route-enforcer plugin、auto_remember.js | 有 5 個 hook equivalent（message:received / pre-commit / before_prompt_build / agent_end / edit_post），但**唔係按 Claude Code 嘅 PreToolUse/PostToolUse/SessionEnd 3-tier 設計**；`additionalProperties: false` schema 限制 hook 擴展 |
| 10 | Loop = Claude Code /loop + /goal。Loop 唔增添智能，複用基座一切 | ✅ Full | 27 live cron + 1 per-min crontab（HEARTBEAT.md），每個 cron 用 thin executor + `toolsAllow:["exec"]` + `delivery.mode:"none"`（HEARTBEAT.md header 2026-06-10 改動） | 完美對應「Loop 唔增添智能，複用基座」；每個 cron 都係用基座現有 skill/script 執行 |
| 11 | 動態工作流 = agent() / parallel() / pipeline() 編排 | ⚠️ Partial | parallel-subagent-implementation skill、`spawn_config.js`（spawn 編排）、`taskflow` skill (openclaw bundled)、`task_router.js` + `taskflow-inbox-triage` | 有**靜態**任務流程（taskflow, parallel-subagent），但**冇 dynamic DAG**；`pipeline()` / `agent()` 呢類動態編排**未有** unified orchestrator（雖然 `scripts/orchestrator/` 唔存在，但有 4 個同 orchestrator 相關嘅 skill） |
| 12 | 狀態文件（agent-memory/）= 持久化 lessons learned | ❌ Missing | 有 L0/L1/L2 memory（MEMORY.md L8-12） + `.cross_session_context.md` + `errors.json` + `correction_suggestions.json` | **冇** agent 專用嘅「lessons learned」狀態文件；現有 memory 係「對話記錄」+「AI 摘要」，唔係「agent 自我改進筆記」 |
| 13 | 自我進化迴路 = 審查 → 寫記憶 → 提鍊技能 → 下次繼承 | ❌ Missing | 零散組件：skill-learner plugin（agent_end hook → auto-generate SKILL.md）、skill_reviewer_bot（30-min 評估）、daily_synthesis（08:00 反思）、anomaly_monitor（06:30/18:30 異常）、issue_auto_followup、weekly_correction_loop（Sun 03:00） | **冇** 4 步閉環；每個組件做自己嗰 part，冇 systematic hand-off；#169 WP2 設計咗 evaluator layer 但未 commit |
| 14 | 打包成 plugin = 從個人 config → 共享 infra | ❌ Missing | `~/.openclaw/extensions/` 有 8 個 plugin（route-enforcer、skill-learner、skill-auto-suggest、self-healing-loop、skill-tools、debug-event、channel-context、skill-learner） | 0% sharing infra；plugin 全部內部用，**冇** packaging format doc + 冇 onboarding flow + 冇 cross-team share 機制 |

**Summary：**
- ✅ Full: 5/14 (01, 02, 03, 07, 08, 10 — 6 個實際，但 02 同 03 嚴格嚟講係 01 嘅 sub-dimension，所以 5 個真獨立)
- ⚠️ Partial: 5/14 (04, 05, 06, 09, 11)
- ❌ Missing: 3/14 (12, 13, 14)

---

## Gap Deep Dive（按 step 編號）

### Step 04 · Session context 持久化
- **現狀：** `scripts/cross_session_bootstrap.js`（每日 06:30 cron）將 SOUL.md → MEMORY.md → cross_session_context → issues → Bliss status → proactive alerts 順序 boot 出嚟。`.cross_session_context.md` 15420 bytes。
- **Reference：** AGENTS.md `## ✅ 每個 Session 必做` L183-216、`scripts/cross_session_bootstrap.js`
- **Gap：** Compaction Contract 雖然有，但**未自動化**。Context 超 80% 時先 yield + 寫 handoff，靠模型自己 trigger，唔係 systematic。**冇 mid-conversation handoff 工具**（見 AGENTS.md ④ 觸發條件，但**未實現 hook**）。
- **Fix：** 
  - 寫 `scripts/context_pressure_monitor.js`：每分鐘 check `.cross_session_context.md` 嘅 token count，> 12K tokens (80% of 15K safe) → 自動寫 handoff + yield
  - 改善 `cross_session_bootstrap.js`：「去蕪存菁」邏輯 — 同 priority 衝突時自動 drop 「低價值 acknowledgements」+ 「old raw logs」
  - Effort: M / Impact: M
- **Effort:** M（4-6hr）
- **Impact:** M（避免 context 過大時丟失 P0 資料）

### Step 05 · CLAUDE.md < 500 tokens 精簡版
- **現狀：** AGENTS.md ~430 行，混合咗：①核心真理（SOUL 性質）②決策樹（流程）③SOP 索引（規則）④Spawn 配置（執行）⑤Coding standards（policy）。**冇 rules/ 子目錄**。
- **Reference：** AGENTS.md（成個文件）、`skills/_learned_*`（41 個 symlinks）
- **Gap：** 文章講「事實放 CLAUDE.md，流程放 skill，folder rule 放 rules/」。我哋有 skill 分離（41 個 symlinks），但**冇** CLAUDE.md 精簡版 + 冇 rules/ folder。
- **Fix：**
  - 拆出 `AGENTS_FACTS.md` (< 200 tokens)：只包 P0 事實 — file structure、model 配對、HA 架構、唔變嘅 user preferences
  - 拆出 `rules/` folder：`rules/routing.md`、`rules/spawn.md`、`rules/safety.md` 各自一個 file
  - 改 AGENTS.md → 變成「決策樹 + index to rules/ + index to skills」，< 1500 tokens
  - **🚨 觸發 Abort：** 改 core 行為文件（AGENTS.md / SOUL.md）要 Josh 批准，**唔可以做 surgical edit** — 至少要 draft 等 review
- **Effort:** L（8-12hr，需要 Josh 過目）
- **Impact:** M（context efficiency ↑，但有 surgical edit 風險）

### Step 06 · Settings = 權限 auto/deny（按回滾成本）
- **現狀：** `route_model.yaml` 有 `cooldown_seconds` + `fallback_chain`（失敗時 fallback），CQM 有 pre-commit hook 阻擋 P0 violation。**冇** 統一 `permissions.yaml` 講「邊啲 command auto-approve、邊啲 deny、邊啲 require approval」。
- **Reference：** `route_model.yaml`、CQM schema、`openclaw.config.schema` 
- **Gap：** 文章講「按回滾成本分級」。我哋有 CQM pre-commit（commit time gate），但**冇 runtime permission gate**（例：執行 `rm -rf` 會唔會被攔？答案：見 AGENTS.md `## ⚠️ Stop and Ask`，靠**模型自己記住**規則，唔係 hook 強制）。
- **Fix：**
  - 寫 `permissions.yaml`：
    ```yaml
    auto_approve: [read, list, jq, git status, ...]   # 冇 side effect
    require_approval: [rm, chmod, kill, crontab, ...]  # 有 side effect
    deny: [rm -rf /, rm -rf ~, chmod 000, ...]          # 永遠 block
    ```
  - 寫 `scripts/permission_gate.js` — pre-exec hook check command
  - 喺 `scripts/hooks/` 加 `pre_tool_use.js`
- **Effort:** M（4-6hr）
- **Impact:** L（直接防護 catastrophic mistake）

### Step 09 · Hooks = 強制執行
- **現狀：** 有 5 個 hook equivalent：
  1. `message:received` → `scripts/hooks/message_received.js`（routing）
  2. `before_prompt_build` → `skill-auto-suggest` plugin
  3. `agent_end` → `skill-learner` plugin
  4. `edit_post` / `PreToolUse` → `self-healing-loop` plugin
  5. `pre-commit` → CQM git hook
- **Reference：** `~/.openclaw/extensions/` 8 個 plugin、`scripts/hooks/`、`scripts/code_quality_manager.js`
- **Gap：** **冇** 統一 hook registry。我哋嘅 hook 散落喺唔同 file/plugin，**冇** 一個地方可以查「有邊啲 hook fired 過、有邊啲可加」。另外 hook 順序衝突：route-enforcer + skill-auto-suggest 兩個 plugin 都喺 before_prompt_build 階段干擾，**冇 priority system**。
- **Fix：**
  - 寫 `hooks_registry.yaml`：列出所有 hook（5 個）+ 觸發時機 + priority
  - 寫 `scripts/hook_priority_resolver.js`：解決同階段 hook 衝突
  - 加 `Stop` hook（AgentStop equivalent）→ 自動 log session 結果 + skill usage feedback
- **Effort:** M（6-8hr）
- **Impact:** M（hook 行為可觀察 + 可 debug）

### Step 11 · 動態工作流（DAG 編排）
- **現狀：** 有 `taskflow` skill（openclaw bundled） + `parallel-subagent-implementation` skill + `taskflow-inbox-triage` skill。但都係**靜態**（定義一次 → 執行一次）。
- **Reference：** `skills/_learned_parallel-subagent-implementation/`、`openclaw bundled taskflow`
- **Gap：** **冇** dynamic DAG 引擎。例：「spawn 5 個 sub-agent → 全部完成 → spawn evaluator → 結果好就 spawn applier → 結果差就 spawn rewriter」呢類 conditional branching **要手動 code 落 script**。
- **Fix：**
  - 寫 `scripts/dag_engine.js`：接受 YAML DAG 定義（nodes + edges + conditions）→ execute
  - 範例：`workflows/skill_evolution.yaml`（對應 Step 13 嘅 4 步閉環）：
    ```yaml
    nodes:
      - id: review, type: subagent_spawn, task: "審查今日 skill usage"
      - id: remember, type: script, run: "node scripts/write_lesson.js", depends_on: review
      - id: distill, type: subagent_spawn, depends_on: remember
    ```
  - #169 WP2 嘅 evaluator layer 已經有類似設計，可以**重用**
- **Effort:** L（10-15hr，要 worktree 隔離做測試）
- **Impact:** L（enable 真正嘅自我進化迴路 Step 13）

### Step 12 · 狀態文件（agent-memory/）= 持久化 lessons learned
- **現狀：** 冇。M3 嘅「agent 視角」學習系統缺失。現有 memory 都係「對話 / 摘要」唔係「agent 反思」。
- **Reference：** MEMORY.md（L0/L1/L2 結構）、`.cross_session_context.md`、AGENTS.md Compaction Contract L142-178
- **Gap：** 100%。Agent 做完任務後，**冇 systematic way** 寫「我學到 X，下次應該 Y」。現有做法靠 session-end handoff + L0/L1 生成，但 L0/L1 係「對話摘要」唔係「agent 反思」。
- **Fix：**
  - 開 `agent-memory/` folder，3 個 file：
    - `agent-memory/lessons.md`（append-only，新 lesson 加到頂）
    - `agent-memory/patterns.md`（cross-task patterns，由 lessons 蒸餾出嚟）
    - `agent-memory/forbidden.md`（永遠唔好再做嘅事，例如 "用 `audit --ts` 喺 60K 行 JSONL 上面會 freeze 10 分鐘"）
  - 寫 `scripts/write_lesson.js`：CLI 工具，`node write_lesson.js --lesson "..." --category bug/pattern/optimization`
  - Session-end hook → 自動 prompt：「今次 session 有冇 lesson 要記？」
  - 改 `scripts/cross_session_bootstrap.js` → boot 時 load `agent-memory/lessons.md` 嘅 top 10 → inject 入 context
- **Effort:** S（2-3hr 開 folder + script + session-end hook）
- **Impact:** L（自我進化嘅核心 — 冇呢個 Step 13 冇得做）

### Step 13 · 自我進化迴路（4 步閉環）
- **現狀：** 零散組件，**冇閉環**。
  - 「審查」：skill_reviewer_bot（30-min）、daily_synthesis（08:00）、weekly_correction_loop（Sun 03:00）
  - 「寫記憶」：MEMORY.md（L0/L1） + errors.json
  - 「提鍊技能」：skill-learner plugin（agent_end hook）
  - 「下次繼承」：cross_session_bootstrap 將 memory 注入
- **Reference：** 
  - 設計：`#169 WP2 Evaluator Layer`（2026-06-17 M3 已做 deep analysis）
  - 組件：skill_reviewer_bot.js、daily_synthesis.js、skill-learner plugin、cross_session_bootstrap.js
- **Gap：** 4 步冇 hand-off 機制。skill_reviewer_bot 評完 → 寫去 `.skill_created.jsonl` → 冇人睇。daily_synthesis 反思 → 寫去 Obsidian → 冇 feedback 落回 skill/agent-memory。
- **Fix：**
  - 寫 `scripts/evolution_loop.js`：orchestrator 串起 4 步
    ```
    review (skill_reviewer 結果) 
      → remember (寫入 agent-memory/lessons.md)
      → distill (M3 sub-agent 蒸餾 lesson → skill proposal)
      → inherit (skill_workshop apply → next session load)
    ```
  - 對應 #169 WP2 嘅 `sampler → evaluator → action pipeline`，直接 implement
  - 用 Step 11 嘅 dag_engine 跑呢個 workflow
  - **⏰ 注意：** #169 WP2 設計完成但未 commit，要等 Josh 批准先做
- **Effort:** L（15-20hr，要 M3 sub-agent 做蒸餾）
- **Impact:** XL（呢個係 Step 14 嘅 pre-requisite — 冇自我進化就冇 plugin 化嘅價值）

### Step 14 · 打包成 plugin 共享
- **現狀：** 0% sharing。Plugin 全部內部用。**冇** doc 講「點將我嘅 skill pack 變 plugin 俾第二個 agent 用」。
- **Reference：** `~/.openclaw/extensions/`（8 個 plugin source）、`~/.openclaw/workspace/skills/_learned_*/`（41 個 skill symlinks）
- **Gap：** 文章講「從個人 config → 共享 infra」。我哋而家嘅 plugin 係「Ally 個人」唔係「團隊共用」。Skill 同 plugin 之間**冇 standard conversion 流程**。
- **Fix：**
  - 寫 `docs/plugin_packaging.md`：spec 講「一個 plugin 應該包含咩」（manifest.json、SKILL.md、hooks/、tests/、README.md）
  - 寫 `scripts/pack_skill_to_plugin.js`：將 41 個 `_learned_*` skill 自動 pack 為 plugin format（draft 階段，唔實際 ship）
  - 揀 1 個 skill 做 pilot（建議：`skill-automation-analysis`，因為佢本身就係講「邊個 skill 值得自動化」）
  - **🚨 觸發 Abort：** 真係 ship plugin 出去 = 接觸 external，需要 Josh 批准 + 整 sharing infra
- **Effort:** XL（20-30hr，要整 infra + 揀 pilot）
- **Impact:** L（長期 ROI 高，但 short-term 唔 direct impact Ally 自己）

---

## ROI Ranking（按 Impact/Effort）

> 評分標準：Effort S=<4hr, M=4-8hr, L=8-20hr, XL=>20hr
> Impact S=局部改善, M=明顯改善, L=顯著改善, XL=核心 capability unlock

| Rank | Step | Effort | Impact | ROI | Why |
|------|------|--------|--------|-----|-----|
| 1 | **12** agent-memory/ 狀態文件 | S | L | 🟢🟢🟢 | 開 folder + 寫 lesson CLI + session-end hook = 2-3hr，**直接 unlock Step 13**。Low cost，high unlock value。 |
| 2 | **13** 自我進化迴路（reuse #169 WP2 設計） | L | XL | 🟢🟢🟢 | M3 設計已完成（#169），commit 嘅 effort 主要係 implementation + testing。**呢個係文章核心論點嘅實現**。 |
| 3 | **06** Settings 權限分級 | M | L | 🟢🟢 | 4-6hr 起 permissions.yaml + permission_gate.js。**直接防 catastrophic mistake**（rm -rf 喺 shell session 仍然係靠模型自律，唔夠 robust）。 |
| 4 | **11** 動態工作流 (DAG engine) | L | L | 🟢🟢 | 10-15hr，但係 Step 13 嘅 infrastructure。**冇 DAG engine 就要每個 workflow 手寫 orchestrator script**。 |
| 5 | **04** Session context 持久化優化 | M | M | 🟢 | 4-6hr 加 context_pressure_monitor + bootstrap 改善。避免 context 過大時丟 P0 資料。 |
| 6 | **09** Hooks registry + priority resolver | M | M | 🟢 | 6-8hr。**現有 5 個 hook 散落唔同 file**，冇 single source of truth。 |
| 7 | **14** Plugin packaging（pilot only） | XL | L | 🟡 | 20-30hr，短期 ROI 低（只 Ally 用），但長期係 scaling prereq。**只做 pilot，不 ship**。 |
| 8 | **05** AGENTS.md 精簡 + rules/ folder | L | M | 🟡 | 8-12hr + 觸發 Abort condition（改 core 行為文件要 Josh 批准）。**唔 surgical**。 |
| 9 | **01** 基座定義 | - | - | ✅ | 已完成 |
| 10 | **02** 同一模型不同基座 | - | - | ✅ | 已完成 |
| 11 | **03** 基座分界線 | - | - | ✅ | 已完成 |
| 12 | **07** Sub-agents（5 個 skill） | - | - | ✅ | 已完成 |
| 13 | **08** Skills ecosystem | - | - | ✅ | 已完成 |
| 14 | **10** Loop/Cron（27 個） | - | - | ✅ | 已完成 |

**Top 3 Quick Wins（<= 1 week）：**
1. Step 12 — agent-memory/ folder + lessons.md + write_lesson.js + session-end hook
2. Step 06 — permissions.yaml + permission_gate.js pre-tool hook
3. Step 04 (partial) — context_pressure_monitor.js

---

## 30 日 Rolling Plan

### Week 1（Days 1-7）— Quick Wins：基礎設施

**目標：** Step 12（agent-memory）落地 + Step 06（權限 gate）prototype + 解決 1 個現有痛點

- [ ] **Day 1-2（~6hr）：** Step 12 開 folder + write_lesson.js CLI
  - 創 `agent-memory/{lessons.md, patterns.md, forbidden.md}`
  - 寫 `scripts/write_lesson.js --lesson "..." --category bug|pattern|optimization`
  - Seed 5 條已有 lessons（從 errors.json 抽 top 3 + 從 L0 abstract 抽 2 條 pattern）
  - verify_edit 驗證 + CQM scan
- [ ] **Day 3-4（~8hr）：** Step 06 permissions.yaml + permission_gate.js
  - 寫 `permissions.yaml`（auto_approve / require_approval / deny 三層）
  - 寫 `scripts/permission_gate.js` pre-tool-use hook
  - 喺 `scripts/hooks/` 加 entry，連入 OpenClaw hook system
  - **測試 5 個 dangerous command**（rm -rf, chmod 000, etc.）確認 deny 生效
  - 灰度：先 log-only，唔實際 block（避免 false positive break workflow）
- [ ] **Day 5（~4hr）：** Step 04 context_pressure_monitor.js（partial）
  - 寫 `scripts/context_pressure_monitor.js`：每分鐘 check `.cross_session_context.md` token count
  - > 12K → 自動 yield + 寫 handoff
  - 加去 cron：`* * * * *` per-min check
- [ ] **Day 6-7（~6hr）：** Review + 觀察 + 補 issue
  - 建立 `.issues/active/` 3 個 issue：#Step12, #Step06, #Step04（按 SOP 標準 L2 詳細度）
  - 觀察 Week 1 metrics：context 平均 size / permission gate 攔截次數 / lesson 寫入次數
  - 如果 Week 1 數據 OK → 申請 commit + log-only 模式

**Week 1 Done 標準：**
- [ ] agent-memory/ 有 ≥ 5 條 lessons + cross_session_bootstrap 自動 load
- [ ] permission_gate.js log-only 模式跑緊，攔截 ≥ 0 個 dangerous command 嘗試（證明 hook 觸發到）
- [ ] context_pressure_monitor 喺 cron 入面，觀察 7 日
- [ ] 3 個 issue 全部 L2 級別

### Week 2（Days 8-14）— 自我進化迴路 Part 1

**目標：** Step 11 (DAG engine) prototype + Step 13 嘅 4 步閉環第一段

- [ ] **Day 8-9（~10hr）：** Step 11 dag_engine.js 基礎
  - 寫 `scripts/dag_engine.js`：YAML → 執行
  - 支援 4 種 node type：script、subagent_spawn、conditional、parallel
  - 範例 workflow：`workflows/skill_evolution_phase1.yaml`（只 run review + remember 兩步）
  - 測試：dry-run mode 唔真係執行，只 print execution plan
- [ ] **Day 10-12（~14hr）：** Step 13 evolution_loop.js Part 1
  - 寫 `scripts/evolution_loop.js`：orchestrator 串 review → remember
  - review：調用 skill_reviewer_bot 嘅最新 output
  - remember：將 review 結果自動寫入 agent-memory/lessons.md
  - Cron schedule：每日 04:30（避開 pattern_analysis_daily.js）
- [ ] **Day 13-14（~8hr）：** 觀察 + 整合
  - 觀察 evolution_loop 7 日 run log
  - 整合入 daily_synthesis：8:00 嘅 synthesis 多一個 section 「Evolution: 昨日有咩 lessons 寫入」
  - CQM scan + verify_edit

**Week 2 Done 標準：**
- [ ] dag_engine.js 通過 3 個 test case
- [ ] evolution_loop.js 連跑 7 日無 error
- [ ] agent-memory/lessons.md 7 日內累積 ≥ 10 條新 lessons
- [ ] daily_synthesis output 有「Evolution」section

### Week 3（Days 15-21）— 自我進化迴路 Part 2 + Hooks 治理

**目標：** Step 13 嘅 distill + inherit 兩步 + Step 09 hooks registry

- [ ] **Day 15-17（~14hr）：** Step 13 distill 步驟
  - 寫 `scripts/distill_lesson_to_skill.js`：M3 sub-agent 讀 agent-memory/lessons.md → 生成 skill proposal
  - 用 `skill_workshop action=create` 嘅 API
  - 自動 quarantine 7 日（避免污染）
  - Cron：每週日 03:30（接 weekly_correction_loop 之後）
- [ ] **Day 18-19（~10hr）：** Step 13 inherit 步驟
  - 寫 `scripts/inherit_skill_proposals.js`：scan `skill_workshop` 嘅 pending proposals → 自動 apply 通過 quarantine
  - 連入 cross_session_bootstrap：boot 時 load 返新 applied skills
- [ ] **Day 20-21（~8hr）：** Step 09 hooks registry
  - 寫 `hooks_registry.yaml`：列 6 個 hook（加返 Stop hook） + priority
  - 寫 `scripts/hook_priority_resolver.js`
  - 連入 OpenClaw hook system

**Week 3 Done 標準：**
- [ ] evolution_loop.js 4 步閉環完整（review → remember → distill → inherit）
- [ ] 至少 1 個 lesson 成功 distill 為 skill proposal
- [ ] hooks_registry.yaml published + 6 個 hook 有 priority
- [ ] CQM scan 0 P0

### Week 4（Days 22-30）— Plugin 化 Pilot + 收尾

**目標：** Step 14 plugin packaging pilot（不 ship）+ 寫 final doc

- [ ] **Day 22-24（~12hr）：** Step 14 plugin packaging spec
  - 寫 `docs/plugin_packaging.md`：spec + manifest.json schema
  - 寫 `scripts/pack_skill_to_plugin.js`：將 skill folder → plugin structure
  - Pilot 揀 `skill-automation-analysis` 做 pack（Ally 自己寫嘅 skill，唔涉及 sharing）
- [ ] **Day 25-26（~8hr）：** integration + 全 14 步 audit
  - 用今次 roadmap 做 self-audit：跑 14 步 checklist，update 進度
  - 寫 `Knowledge/AI/OpenClaw 基座工程 14 步 Implementation Status.md`（Obsidian note）
- [ ] **Day 27-30（~8hr）：** 收尾 + 30-day retrospective
  - 觀察 Week 1-3 所有新 cron 嘅 14 日 metric
  - 寫 retrospective report
  - 開 `30-day-followup.md`：邊啲 items 留滾去 Day 31-60

**Week 4 Done 標準：**
- [ ] docs/plugin_packaging.md 完成
- [ ] 1 個 pilot plugin 喺 `~/.openclaw/extensions/`（internal use only）
- [ ] Obsidian note publish
- [ ] Retrospective doc 完成

### Post-30日 長線（Day 31-90）

| 項目 | Effort | Priority |
|------|--------|----------|
| **Step 05** AGENTS.md 精簡（**需 Josh 批准**） | L | 🟡 |
| **Step 04** Bootstrap 「去蕪存菁」邏輯 | M | 🟡 |
| **Step 13** Evolution loop 升級：自動生成 skill-v2 取代舊 skill | L | 🟡 |
| **Step 14** 真實 ship plugin 俾第二個 agent（**需 Josh 批准**） | XL | 🟢 |
| **Step 09** Hook observability dashboard | M | 🟢 |

---

## Critical Risks

### 🔴 改 core 行為文件風險
- **AGENTS.md / SOUL.md / MEMORY.md** 改動會**直接影響** model 行為，唔可以 surgical edit。**必須 draft → Josh review → 再 commit**。
- **Step 05（精簡 AGENTS.md）** — 觸發 Abort condition。**Day 1 就要 draft**，唔可以單方面做。
- **Step 12 agent-memory 注入 boot context** — 會**增加 context size**，反而可能觸發 Step 04 嘅 context 過大問題。**要控制 lessons.md size（max 2K bytes / top 10）**。

### 🟡 Hook 互相干擾風險
- 現有 5 個 hook 喺唔同 priority 衝突。Step 09 hooks_registry 嘅 priority resolver **要灰度上線**，唔可以一次過 switch。
- 尤其係 route-enforcer + skill-auto-suggest 兩個 plugin 都喺 before_prompt_build，**改 priority 可能會 break routing**。

### 🟡 Step 13 evolution_loop 失敗 cascade
- 4 步閉環，**任何一步出錯會污染下幾步**。例：distill 步 M3 sub-agent 出 garbage → skill proposal garbage → inherit 後污染 skill library。
- **要加 guard：** distill step 必須有 quality check（長度 > 500 chars、唔可以重複現有 skill、要有 ## Pitfalls section）。
- **要加 rollback：** 如果 7 日內新 applied skill 嘅 usage rate < 1 次 → 自動 quarantine。

### 🟢 Permission gate false positive
- 過嚴會 block normal workflow，過鬆會失效。**灰度策略：Week 1 log-only（只 log 唔 block），Week 2 半 block（只 block deny list），Week 3 先 full block**。
- 要有 escape hatch：`/approve` command（已經喺 OpenClaw 支援）。

---

## Next Action

**今個 session 即刻做嘅 1 樣嘢：**

> **創建 `.issues/active/170-14-step-roadmap-q1.md`** 記錄 Week 1 三個 Quick Win（Step 12 + 06 + 04-partial），用 L2 詳細度（按 AGENTS.md Issue Quality SOP）。

**具體：**
```bash
node scripts/issue_manager.js create "14-Step Roadmap Week 1: agent-memory + permission gate + context monitor" --priority P1 --due 2026-06-25 --fdq
```

**理由：**
1. 唔可以單方面改 core 行為文件（AGENTS.md / SOUL.md），所以 Step 05 要等 Josh 批准，先**唔做**
2. Step 12 嘅 agent-memory/ folder 開 + write_lesson.js + session-end hook = 全部**新 file + 新 script**，唔影響 core，**可以做**
3. Step 06 permission_gate.js 嘅 log-only mode 唔會 block 現有 workflow，**可以灰度上線**
4. 開 issue 係 tracking，**唔係 commit code** — 跟 Issue Quality SOP 做 L2 詳細度

**期望今日 session end 時：**
- 1 個 L2 issue (#170) open
- 3 個 Quick Win 嘅 design notes 喺 issue 內
- Week 1 timeline 排好（Day 1-7 邊日做邊樣）
- 冇 core file 改動

---

## Appendix A · File:Line Reference Quick Index

| File | 主要內容 | 行數（大約） |
|------|----------|------------|
| `AGENTS.md` | 行為準則 + Decision tree | ~430 |
| `SOUL.md` | 身份、FDQ、EVALS、Thinking Partner | ~270 |
| `MEMORY.md` | 精簡長期記憶（L0/L1/L2 結構） | ~150 |
| `HEARTBEAT.md` | 27 cron + 1 per-min | ~170 |
| `TOOLS.md` | 工具用法 | ~270 |
| `route_model.yaml` | 7 routes × 2 providers | ~80 |
| `spawn_config.js` | Smart Router bridge | ~120 |
| `cross_session_bootstrap.js` | Session boot context | ~? |
| `message_received.js` | message:received hook | ~70 |
| `classifier.js` | Regex-based routing | ~150 |
| `skill_reviewer_bot.js` | 30-min skill pipeline | ~600 |
| `~/.openclaw/extensions/` | 8 個 plugin source | 8 dirs |

## Appendix B · Active Issue Cross-Reference

| Issue | 對應今次 14 步 | 關係 |
|-------|---------------|------|
| #154 | Step 10 Loop | Loop Engineering Phase 1 (narrow) — Termination Manifest + Token Budget |
| #162 | Step 08 Skills | Skill Pipeline Master Issue（M1-M9 milestones） |
| #168 | Step 09 Hooks | Self-Healing Loop fix-syntax observation |
| #169 | Step 11+13 Workflow + Evolution | WP1-WP5 Architecture（5 weak points） |
| #145 | Step 07 Sub-agents | SPAWN Intent Gate (M2.7 vs M3) |
| #087 | Step 12 Memory | SOUL.md Level 4 — 人格蒸餾（**同今次 Step 12 有 overlap**） |

**注意：** #087 同今次 Step 12 有 strategic overlap。建議喺 #170 開 issue 時 cross-reference #087，避免重複工作。

---

*Generated: 2026-06-18 10:53 HKT by M3 sub-agent (route: SPAWN_QUALITY)*
*Subagent task ID: agent:main:subagent:db52c564-9623-46bf-82dd-1f2fa7d1a8de*
*Task: 14-step implementation roadmap vs OpenClaw current state*
*Status: ✅ All 14 steps mapped, ROI ranked, 30-day plan ready, 1 next action identified*
