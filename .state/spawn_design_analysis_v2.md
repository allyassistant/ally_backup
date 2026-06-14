# Spawn Design v2 Analysis — 兩篇文整合深度評估
**作者：** Ally Sub-Agent (架構分析師)  
**日期：** 2026-05-26  
**輸入：**  
- `.state/spawn_design_analysis.md` (v1 MiniMax 分析)  
- `AGENTS.md` (現有行為規則)  
- `SOUL.md` (現有 spawn mindset)  
- 老金文章 summary (Surgical Changes + Goal Verification + Pipeline)  
- Kanika 文章 summary (Four Core Roles + Three Architectures + Task-first thinking)  

---

## 1️⃣ Synthesis — 兩篇文點 combine

### 1.1 互補的核心概念

| 老金文章 | Kanika 文章 | 點解互補 |
|----------|-------------|----------|
| **Surgical Changes** — scope 紀律 | **Task-first thinking** — 定義 Task + Tools + Output + Constraints | 兩者都強調「唔好做大範圍改動」，老金係紀律口號，Kanika 係具體框架 |
| **Goal Verification** — 成功/失敗條件 | **Output + Constraints** — 每個 task 必須有明確交付物 | 完全一致，都係話「唔好模糊目標」 |
| **Pipeline (Explore→Plan→Execute→Review)** | **Three Architectures** (Sequential / Parallel / Hierarchical) | Pipeline = Sequential 嘅特例；Kanika 話你揀架構，老金話你 pipeline 幾個階段 |
| （冇直接對應） | **Four Core Roles** (Orchestrator / Researcher / Producer / Critic) | 老金冇角色概念，只有流程概念；Kanika 補完「邊個做咩」 |
| （冇直接對應） | **Critic/Reviewer 係被低估最重要嘅角色** | 完全新 insight，老金 pipeline 嘅 Review phase 需要呢個角色，但冇詳細說明 |
| **Surgical Changes** | **Think in Tasks, Not Roles** | 互補：老金話「唔好改 scope」，Kanika 話「用 task 定義 work」 |

**結論：** 老金係「點解要做紀律」（底層原則），Kanika 係「點樣組織團隊」（上層架構）。兩者層次唔同，可以叠埋一齊。

### 1.2 Conflict / 需要取捨的地方

| 衝突點 | 老金立場 | Kanika 立場 | 需要取捨 |
|--------|----------|-------------|----------|
| **角色定義粒度** | 只有 sub-agent（隱性：Ally 主導） | 明確四種角色（Orchestrator / Researcher / Producer / Critic） | 我哋係 1 個 Ally + N 個 sub-agent，唔係多 agent 團隊。Kanika 角色劃分適用於 Pipeline，但日常 spawn 唔需要咁多角色 |
| **Pipeline 必要條件** | Explore → Plan → Execute → Review 適合複雜工作 | Sequential / Parallel / Hierarchical 係通用框架 | 老金 pipeline 係 Sequential 嘅一個具體 implementation。對簡單 task 用 Sequential，對複雜 task 用 Pipeline，兩者唔衝突 |
| **Token cost 考量** | 冇提（Claude Code 係另一個使用場景） | 提咗 Parallel 係最有效率，但冇提 cost | **呢度係最大 conflict**：Kanika 建議 Parallel 可以加速，但老金冇提。Parallel = 多個 sub-agent 同時跑 = 更高 cost。我哋處於兩者之間 |
| **Critic 角色** | Review phase 存在，但冇強調重要性 | Critic 係被低估、最重要嘅角色 | 我哋現有 system 完全冇 Critic role，只有 Ally 自己 review。這係最大Gap |

### 1.3 兩篇都強調的核心原則

以下係兩篇文唯一共同強調嘅嘢，呢啲係最冇爭議、最值得落地嘅設計：

> **原則 1：唔好模糊目標（Goal Verification / Task-first）**
> 每次 spawn 必須有：✅ 交付物、✅ 驗證方法、❌ scope 邊界、❌ abort 條件

> **原則 2：Scope 紀律（Surgical Changes / Task constraints）**
> 只改被要求改的，唔好順手改其他

> **原則 3：Review 係必要階段（老金 Pipeline phase 4 / Kanika Critic role）**
> 冇 review 嘅 task 質素無法保證

---

## 2️⃣ 重新評估三層設計（以 Kanika 框架再 check）

### Layer 1：AGENTS.md 加規則

**v1 評估：** 加入 Surgical Changes + Pipeline Trigger Criteria  
**Kanika 重 check：**

| v1 建議 | Kanika 新視角 | 評估 |
|---------|---------------|------|
| Surgical Changes 段落 | Task-first thinking（Task 綁定 Tools + Output + Constraints） | ✅ 兩者一致，方向啱 |
| Pipeline Trigger Criteria | Three Architectures（Sequential / Parallel / Hierarchical） | ⚠️ 需要expand：唔只係 Pipeline Trigger，仲要揀 architecture |
| （冇） | Critic/Reviewer 角色 | 🔴 **最大Gap：完全冇 Critic role 概念** |
| Goal Verification | Output + Constraints | ✅ 一致，但需要升級：加 abort criteria |

**需要新增到 AGENTS.md 的內容（Kanika insight）：**

```markdown
### Task Definition 標準格式（2026-05-26 新增）
> 每次 spawn sub-agent，Task 必須包含：
> - 🎯 Output：交付咩（檔案/格式/動作）
> - 🔧 Tools：可以用咩工具
> - ⛔ Constraints：唔准做咩（scope restriction）
> - 🚨 Abort Criteria：咩情況立即停手匯報
```

**評估：Layer 1 係夠嘅，但需要升級。** 主要缺口係缺 Critic role 概念，以及 Task Definition 格式不夠嚴謹。

---

### Layer 2：`.spawn/` template 目錄

**v1 建議：**
```
workspace/.spawn/
├── _preamble.md      # 通用守則
├── code_fix.template
├── audit.template
└── research.template
```

**Kanika 重 check：**

| 問題 | Kanika 觀點 | 評估 |
|------|-------------|------|
| 四種角色點樣映射到 templates？ | Four Core Roles：Orchestrator / Researcher / Producer / Critic | ⚠️ 現有 design 只有 task type templates，冇 role templates |
| 邊個係 Critic？ | Critic = 獨立 review agent，唔係同一個 agent 自己 review | 🔴 **我哋冇 Critic template** |
| Hierarchical architecture 點implement？ | 上層 Orchestrator 協調多個 Specialist Producers | 適用於 Pipeline，但日常 spawn 唔需要 |

**需要新增的 templates：**

```markdown
# .spawn/critic.template（新增）

## 角色：你係資深 Critic Reviewer
> 你唔係執行者，你係批評者。你的 job 係搵問題，唔係俾解決方案。

## 任務
審閱以下工作成果：
<填寫 sub-agent output>

## 審查維度（每個必須回答）
1. **準確性**：有冇明顯錯誤或遺漏？
2. **完整性**：所有 acceptance criteria 滿足嗎？
3. **安全性**：有冇引入新 risk？
4. **可維護性**：其他 maintainer 可以理解嗎？
5. **Surgical Compliance**：有冇改超出 scope 的嘢？

## 輸出格式
```
## 結論
✅ PASS / ⚠️ CONDITIONAL PASS / ❌ FAIL

## 問題列表（按 severity）
### P0 - 必須修復
### P1 - 強烈建議修復
### P2 - 可選優化
```

# .spawn/orchestrator.template（新增，用於 Pipeline mode）

## 角色：你係 Orchestrator
> 你負責協調整個工作流程。你唔需要係所有領域嘅專家，但你要知幾時需要召喚邊種專家。

## 任務
管理以下 multi-step task：
<填寫 task>

## 當前階段
<填寫 Phase 1/2/3...>

## 請決定
1. 呢個 phase 需要乜嘢 specialist？（researcher / producer / critic）
2. 下一步係乜？
3. 幾時應該終止（abort criteria）？
```

**評估：Layer 2 方向啱，但需要加 `critic.template` + `orchestrator.template`，唔只係 task-type templates。**

---

### Layer 3：Pipeline / Checkpoint Model

**v1 建議：** Checkpoint Model（1 個 sub-agent 分 checkpoint 寫 output）取代 4-phase full pipeline  
**Kanika Three Architectures 重 check：**

| Architecture | 適用場景 | 我哋應該用？ |
|-------------|---------|-------------|
| **Sequential** | 子任務有依賴關係，必須 order | ✅ Checkpoint Model 就係 Sequential — 一個 phase 完成再做下一個 |
| **Parallel** | 多個獨立的子任務同時進行 | ⚠️ 適合獨立的 research tasks，但 cost 高 |
| **Hierarchical** | Orchestrator 協調多個 Specialist Producers | ⚠️ 適合超複雜任務（> 5 files, > 1 hour）|

**以 Kanika 框架重新設計 Pipeline architecture choice：**

```markdown
## Pipeline Architecture Decision Tree（2026-05-26 新增）

### 簡單 Spawn（Sequential，1 個 sub-agent）
觸發條件：
- 單一檔案 / 單一問題
- 估計 token cost < $0.50
- 有明确 scope
→ 用 `.spawn/code_fix.template` 或對應 template

### Pipeline Mode（Sequential，multiple agents）
觸發條件：
- ≥ 3 個相互依賴的檔案
- 需要 Explore → Plan → Execute → Review
- 估計 token cost $1-5
→ 用 Checkpoint Model（唔係 full 4-phase）

### Hierarchical Mode（Orchestrator + Specialists）
觸發條件：
- 全新 architecture decision
- ≥ 5 個檔案涉及
- 涉及 shared dependencies
- 估計 token cost > $5
→ 用 `.spawn/orchestrator.template` + role-specific templates
```

**Checkpoint Model 重新定義（以 Kanika Sequential 為基礎）：**

```
Checkpoint Model 流程：
1. Ally 創建 Execution Plan document（一次性）
2. Sub-agent 執行，每個 checkpoint 寫入狀態
3. 如果 session reset → Ally resume 讀 checkpoint
4. 如果複雜 → Ally spawn Critic 對 output 獨立審查
```

**評估：Layer 3 方向啱，但需要用 Kanika architecture choice 取代原來模糊的「Pipeline」概念。**

---

## 3️⃣ 對我們架構最直接 Actionable 的 3-5 個改動

### 改動 1：升級 Task Definition 格式（P0）

**改咩：** 在 AGENTS.md spawn 段落加入嚴謹的 Task Definition template

**點改：** 在 AGENTS.md 的「Spawn 原則」段落加入：

```markdown
### Task Definition 標準（每次 spawn 必須包含）

## 🎯 Output（交付物）
-

## 🔧 Tools（可用工具）
-

## ✅ Success Criteria（成功標準，可驗證）
-

## ⛔ Constraints（Scope 限制）
- ✅ 可以改：
- ❌ 唔准改：

## 🚨 Abort Criteria（立即停手條件，>=1 觸發就匯報）
-
```

**Priority：** P0 — 呢個係最大Gap，兩篇文都強調  
**預期 Impact：** 
- Sub-agent 唔會 scope creep
- Session reset 後可從 checkpoint resume
- Token cost 可預測

---

### 改動 2：建立 `critic.template`（P0）

**改咩：** 在 `.spawn/critic.template` 建立 Critic role template

**點改：** 
```bash
mkdir -p ~/.openclaw/workspace/.spawn
cat > ~/.openclaw/workspace/.spawn/critic.template << 'EOF'
## 角色：你係資深 Critic Reviewer
（見上面 Section 2.2 完整內容）
EOF
```

**AGENTS.md spawn 段落加：**
> 當 task 涉及 `≥ 2 個檔案` 或 `P1+ risk`，spawn 後必須獨立地再 spawn Critic 審查 output

**Priority：** P0 — Kanika 最強調的 insight，我哋完全冇  
**預期 Impact：** 
- Catch 高風險改動問題
- 彌補 Ally 自己 review 的盲點
- 對標 industry best practice（Critic = 最低估但最重要的角色）

---

### 改動 3：建立 Pipeline Architecture Decision Tree（P1）

**改咩：** 在 AGENTS.md 加入architecture choice heuristic，取代模糊的「Pipeline 適用」

**點改：** 在 AGENTS.md 加入（見上面 Section 2.3 的 decision tree）

**Priority：** P1  
**預期 Impact：** 
- Ally 每次 spawn 前自動揀正確模式
- 避免over-engineering（小事唔用 Hierarchical）
- 避免under-engineering（大事唔只用 Simple Spawn）

---

### 改動 4：升級 `auto_fix.js` generateSpawnPayload() 加入 Scope Block（P1）

**改咩：** `generateSpawnPayload()` 的 prompt 內加入 Task Definition block（改動 1 的格式）

**點改：**

在 `generateSpawnPayload()` 內的 prompt template 开头加：

```javascript
const TASK_DEFINITION_BLOCK = `
## 🎯 Output：
## 🔧 Tools：
## ✅ Success Criteria：
## ⛔ Constraints：
## 🚨 Abort Criteria：
`;
```

然後喺 spawn payload 前面加呢個 block

**Priority：** P1  
**預期 Impact：** 所有 auto_fix 相關的 spawn 有 consistent structure

---

### 改動 5：建立 `orchestrator.template` + decision rule（P2）

**改咩：** 建立 Orchestrator template only for Hierarchical mode

**點改：** 
```bash
cat > ~/.openclaw/workspace/.spawn/orchestrator.template << 'EOF'
## 角色：你係 Orchestrator
（見上面 Section 2.2 完整內容）
EOF
```

在 AGENTS.md 加入觸發條件：
> Hierarchical Mode 只喺 ≥ 5 files 或全新 architecture decision 或 token estimate > $5 先用

**Priority：** P2 — 複雜任務先需要，日常 spawn 唔需要  
**預期 Impact：** 複雜任務有結構化協調，唔會變成失控的 multi-agent chaos

---

## 4️⃣ Overall Assessment

### 現有架構 Maturity：5 / 10

| 維度 | 分數 | 原因 |
|------|------|------|
| Tool Decision Tree | 8/10 | Regex classifier 穩定，route 清晰 |
| Spawn Prompt Quality | 4/10 | 缺 Task Definition、Scope Block、Abort Criteria |
| Pipeline Design | 3/10 | 有概念但冇觸發條件、冇架構選擇 |
| Role Specialisation | 2/10 | 只有 generic sub-agent，完全冇 Critic/Orchestrator |
| Token Cost Awareness | 3/10 | 只有 timeout，冇 cost estimate |
| Checkpoint/Resume | 1/10 | 完全冇機制，session reset = progress lost |

### 最值得立即做（按 priority order）

| # | 改動 | Why Now |
|---|------|---------|
| **1** | Task Definition 格式進 AGENTS.md | 兩篇文共同核心，Gap 最大，立即提升 quality |
| **2** | `critic.template` 建立 | Kanika 最強調的 insight，我哋零成本可以加 |
| **3** | `auto_fix.js` prompt 升級 | 直接影響日常 spawn quality |
| **4** | Pipeline Architecture Decision Tree | 避免 over/under engineering |

### 可以之後再做

| # | 改動 | 原因 |
|---|------|------|
| **5** | `orchestrator.template` | 只有複雜任務先需要 |
| **6** | Token cost tracking | 等累積多啲 spawn data 先做 |
| **7** | Checkpoint Model full implementation | 用 taskflow skill，需要比較多時間 |

### 唔應該做（理由）

| # | 避免做 | 理由 |
|---|--------|------|
| **唔應該** | Full 4-phase Pipeline for every task | Token cost太高，老金自己都話適合複雜工作 |
| **唔應該** | 引入 4 種完整角色（Orchestrator/Researcher/Producer/Critic for every task） | 我哋係 1 主 agent + N sub-agent，唔係多 agent 團隊。日常 task 用唔着咁多角色 |
| **唔應該** | Parallel architecture（多個 sub-agent 同時跑） | Token cost 太高，我哋未需要，而且冇 safety net |
| **唔應該** | 將 `.spawn/` templates 變得太複雜 | Templates 複雜化 = sub-agent prompt 變長 = 反而降低 quality |

---

## 5️⃣ 整合後的 Target Architecture（High-Level）

```
┌─────────────────────────────────────────────────────────┐
│  Ally (Main Agent)                                       │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Tool Decision Tree (classifier.js)                   │ │
│  │ → ROUTE: FDQ / DIRECT / SOP / SPAWN / CODE / BROWSER │ │
│  └─────────────────────────────────────────────────────┘ │
│  ↓ SPAWN route                                           │
│  ┌──────────────────┐  Architecture Decision:           │
│  │ Task Definition   │  Simple / Pipeline / Hierarchical │
│  │ (AGENTS.md rule)  │                                  │
│  └────────┬─────────┘                                  │
│           ↓                                             │
│  ┌────────────────────┐                                 │
│  │ .spawn/ templates  │  ← _preamble.md (Surgical)      │
│  │                    │  ← code_fix / audit / research  │
│  │                    │  ← critic.template (NEW)         │
│  │                    │  ← orchestrator.template (P2)   │
│  └────────┬───────────┘                                 │
│           ↓                                             │
│  ┌────────────────────┐                                 │
│  │ Sub-Agent Spawn    │  Append: Task Definition Block   │
│  │ (sessions_spawn)   │  + Scope Block                  │
│  └────────┬───────────┘  + Abort Criteria               │
│           ↓                                             │
│  ┌────────────────────┐  Pipeline Mode (Sequential):     │
│  │ Checkpoint Output  │  1 agent, checkpoint at each     │
│  │ (.state/<label>)   │  phase, Ally resumes on reset    │
│  └────────────────────┘                                 │
│           ↓                                             │
│  ┌────────────────────┐                                 │
│  │ Critic Review      │  ← New: critic.template        │
│  │ (独立 spawn)       │  P≥2 files or P1+ risk only    │
│  └────────────────────┘                                 │
└─────────────────────────────────────────────────────────┘
```

---

## 6️⃣ Recommended Implementation Roadmap（整合版）

```
Week 1（P0 — 立即做）
├── 1.1 AGENTS.md：加入 Task Definition 標準格式（改動 1）
└── 1.2 AGENTS.md：加入 Surgical Changes scope block（改動 1 相關）

Week 2（P1 — 基礎上升級）
├── 2.1 建立 .spawn/critic.template（改動 2）
├── 2.2 建立 .spawn/_preamble.md（升級版）
├── 2.3 AGENTS.md：加入 Pipeline Architecture Decision Tree（改動 3）
└── 2.4 auto_fix.js：升級 generateSpawnPayload() 加入 Task Definition（改動 4）

Week 3-4（P2 — 複雜場景才需要）
├── 3.1 建立 .spawn/orchestrator.template（改動 5）
└── 3.2 TaskFlow skill 整合 Checkpoint Model（如果需要 long-task resume）
```

---

## 7️⃣ Kanika vs 老金 — 最終 Weighting

| Insight 來源 | 核心原則 | 對我哋架構的 weight |
|-------------|---------|-------------------|
| **老金（高 weight）** | Surgical Changes + Scope 紀律 | 立即落地（改動 1） |
| **老金（高 weight）** | Goal Verification（含 Abort Criteria） | 立即落地（改動 1） |
| **老金（中 weight）** | Explore → Plan → Execute → Review | Checkpoint Model 方向參考 |
| **Kanika（高 weight）** | Critic/Reviewer 係最重要角色 | 立即落地（改動 2） |
| **Kanika（中 weight）** | Three Architectures 選擇框架 | 立即落地（改動 3） |
| **Kanika（中 weight）** | Task-first thinking（唔係 Role-first） | 整合進 Task Definition |
| **Kanika（低 weight）** | Four Core Roles | 日常 spawn 唔需要，只有 Pipeline mode 先用 |

**最終結論：**  
兩篇文嘅核心原則完全一致（scope 紀律 + 明確目標 + review 必要），Kanika 補完咗「點樣組織多個 agents」嘅框架，老金補完咗「點樣保持紀律」嘅原則。**我哋唔需要引入完整嘅 4-role 團隊，只需要喺現有 1-agent + sub-agent 架構上加 critic + orchestrator templates，以及强制 Task Definition 格式。**

---

*Analysis by Ally Sub-Agent (架構分析師)*  
*Task: v2 整合分析 — 老金文章 + Kanika 文章 + v1 MiniMax analysis*  
*Files Referenced: .state/spawn_design_analysis.md, AGENTS.md, SOUL.md*  
*Output: .state/spawn_design_v2_analysis.md*
