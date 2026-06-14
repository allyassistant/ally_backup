# Spawn Design Analysis — Architectural Review
**作者：** Ally Sub-Agent (架構分析師)  
**日期：** 2026-05-26  
**任務：** 評估三層 Spawn Design 提案是否符合張 X 文章（老金 @freeman1266）「用 Claude Code 簡化 80% 日常工作」嘅三大概念  

---

## 📋 Executive Summary

三層設計方向係啱嘅，但有 **4 個關鍵 Gap**、**2 個 Better Alternatives**、以及 **Implementation Risk** 需要注意。

**最值得馬上做：** Layer 1 的 Goal Verification + Layer 2 的 `.spawn_instructions.md`（改名）。  
**可以 skip：** Layer 3 Pipeline fully implemented（風險太高，見下）。

---

## 1️⃣ Gap Analysis — 我哋漏咗啲乜？

### Gap 1：**Sub-Agent 唔會自動繼承 Surgical Changes discipline**

文章嘅 Surgical Changes 概念喺我哋現有設計入面只係依附喺 AGENTS.md 嘅 Coding Standards，但：

- **問題：** Spawn prompt 完全獨立於 AGENTS.md。即使喺 AGENTS.md 寫明「唔好顺手改冇要求改嘅 code」，sub-agent 只要唔被餵呢個資訊就唔會遵守。
- **證據：** `auto_fix.js` 嘅 `generateSpawnPayload()` 嘅 prompt 完全冇提「唔好顺手改其他檔案」。佢只係話「根據以上審計數據，請完成以下工作」，然後列出 High-Risk / System Audit items — 基本上係叫 sub-agent 自己搵嘢嚟做。
- **後果：** Sub-agent 可能會「順手」優化啲冇被要求改的檔案，引發預期外的 regression。

**修復方案：** 喺 spawn prompt 嘅 **「你的任務」段落最開頭** 加入：
> 「⚠️ 重要紀律：只處理明確指定的檔案和問題。不要主動修改、優化、或『順手』改任何冇被要求的內容。如果發現其他問題，請在報告中記錄但唔好自行修復。」

### Gap 2：**Goal Verification 缺少「失敗條件」定義**

Goal Verification 唔只係「話俾 sub-agent 知道目標係乜」，重點係「點樣知道我失敗咗」。

現有 `generateAuditBrief()` 會生成一份結構化 report，但冇定義：
1. **Acceptance Criteria** — 修復後預期係咩（例如：「所有 JS 語法錯誤已清除」）
2. **Boundary界定** — 咩係范圍內，咩係范圍外
3. **Abort Criteria** — 咩情況 sub-agent 應該立即停低、唔郁手（例如：「涉及 security/permission/認證」）

**修復方案：** 在每次 spawn 前，Ally 應該喺 prompt 計算：

```
✅ Success Criteria（可交付）：
  - [具體交付物名稱 + 格式]
  - [驗證方法：睇邊個檔案 / 跑邊個 command]
  
❌ Abandon Criteria（立即停手）：
  - 需要修改 ≥3 個未被授權的檔案
  - 涉及認證、密鑰、permission 變化
  - 觸及 HA / failover 邏輯
```

### Gap 3：**Session Reset Context Loss 未被系統性處理**

文章冇提呢個，但我哋 constraint 明確寫咗：Session reset 後所有狀態需要 file-based。

**問題：** Sub-agent 有可能喺 session reset 前已做好部分工作，但下次啟動時佢唔記得做到邊。由於 sub-agent 唔會自動「繼續」上一次的狀態，呢個係 настоящий 風險。

**現有對策：**
- `spawn_kimi_agent-config.json` — 有 `task` / `label` / `timeout`，但冇 `checkpoint` 機制
- 冇任何「中斷點」/ 「進度 snapshot」機制

**修復方案（低風險）：**
- 在每次 sub-agent 完成後，立即將 output summary 寫入 `.state/<label>_result.md`
- 喺 `sessions_yield` 之後，确保主要 agent 有明确的下一步指示（唔係等 sub-agent 自己决定）
- 如果係超複雜long-running task，用 TaskFlow（`taskflow` skill）而唔係普通 spawn

### Gap 4：**Token Cost 計算缺失**

Pipeline 會增加 round trips，但現有設計完全冇考慮 token budget：

- **問題：** Explore → Plan → Execute → Review 理论上最多 4 個 sub-agent spawn，代價可能高達 $5-10/次
- **現有監控：** `code_quality_manager.js` 有 `VERIFY_TIMEOUT_MS` / `AUTO_FIX_TIMEOUT_MS`，但冇 token cost estimate
- **建議：** 在 AGENTS.md 加入「Pipeline 觸發條件」，唔好所有嘢都用 Pipeline

**Threshold 建議：**
```
Pipeline 適用（值得增加開銷）：
  - 需要修改 ≥5 個檔案
  - 涉及 Shared dependency（冇人跟進就會break多人）
  - 全新 architecture decision

Pipeline 不適用（用 Simple Spawn）：
  - 單一檔案 bug fix
  - Low-risk batch changes
  - 簡單 search/research 任務
```

---

## 2️⃣ Better Alternatives — 有冇更好做法？

### Alternative A（推薦）：**`.spawn_instructions.md` → 按 task type 分拆成多個 prompt templates**

**問題：** `.spawn_instructions.md` 作為單一 template 會變得非常臃腫。任何 task 都會被迫讀取完整 template，即使 80% 内容唔關佢事。

**建議做法：**
```
workspace/.spawn/
├── _ preamble.md         # 通用守則（Surgical Changes + 紀律）
├── _ verify.md          # Goal Verification 框架
├── code_fix.template    # 代碼修復用 template
├── audit.template       # 審計用 template  
├── research.template    # 研究用 template
└── _ pipeline.md        # Pipeline 執行共識（只有 Triggered 時才讀）
```

**好處：** Sub-agent 只 `cat` 佢需要的那個 template，唔使讀成噃超長通用守則。

**注意：** `preamble.md` 必須包含所有通用守則（至少 Surgical Changes），其他 templates 就喺 `_ preamble.md` 之後追加。

---

### Alternative B：**Pipeline → 改成「檢查點模式」而非「階段模式」**

**文章建議：** Explore → Plan → Execute → Review 四階段 pipeline。

**我哋的 Constraints：** Token cost + Session reset。

**Better Alternative — Checkpoint Model：**

```
1. Ally 寫出一個 "Execution Plan" 文件（一次性的，會被下次 reset 參考）
2. Sub-agent 每次完成一個 Checkpoint 就寫入 ✅ 完成標記 + 進度摘要
3. 如果 session reset，Ally 讀取 checkpoint 文件，resume 或重新 spawn
```

好處：
- 唔需要 4 個 sub-agent（可以係 1 個做曡，但每個 phase 有明確 output）
- Token cost 低得多
- 有 audit trail，唔怕 session reset 之後 lost

---

### Alternative C（可選）：**Goal Verification 用「假設性測試」取代「模糊目標」**

**文章重點：** 俾可驗證的完成條件，唔係「分析下呢個 codebase」呢種模糊目標。

**建議加強格式：**

```
## 你的成功標準（必須全部滿足才完成）
✅ 交付：XXXX（咩檔案/咩格式）
✅ 驗證方法：`node --check <file>` 或 `git diff --stat`
✅ 不在範圍內：
   - ❌唔准修改 X 檔案
   - ❌唔准接觸 Y 設定（除非 human 確認）
✅ 觸發「立即匯報」的條件：
   - 發現 security issue 
   - 發現超出原本 scope 的 systemic problem
```

---

## 3️⃣ Implementation Risk — 每層改動的潛在問題

### Layer 1: AGENTS.md 修改

| Risk | 概率 | 影響 | Mitigation |
|------|------|------|------------|
| **新規則同現有 Coding Standards 重疊** | 🟡 中 | 高：變成 noise，失去重點 | 新規則只加喺 Spawn 相关位置，Coding Standards 維持原狀 |
| **規則太抽象無法執行** | 🟠 中高 | 高：Sub-agent 無法判斷 | 每條規則提供具體 example |
| **AGENTS.md 變得更長，main agent 自己都唔知全部內容** | 🔴 高 | 中：用家體驗下降 | 用分層目錄+快速索引（見下） |

### Layer 2: `.spawn_instructions.md` 改名（→ `/workspace/.spawn/` 結構）

| Risk | 概率 | 影響 | Mitigation |
|------|------|------|------------|
| **需要更新所有使用 `cat .spawn_instructions.md` 的地方** | 🟡 中 | 低：範圍可控 | 先做 search，找到所有 references 再一次過更新 |
| **Sub-agent 唔知去邊讀** | 🟡 中 | 高：整個 system 失效 | AGENTS.md spawn 段落明确写路径 |
| **Template 數量變多後難以維護** | 🟡 中 | 中：版本不一致 | 建立簡單的 changelog |

### Layer 3: Pipeline Implementation（可選）

| Risk | 概率 | 影響 | Mitigation |
|------|------|------|------------|
| **4 個 sub-agent × 3 分鐘/seesion reset = 極高 token cost** | 🔴 高 | 高：$budget 爆錶 | 設定 Pipeline 的觸發门槛，只對真正複雜的 task 啟用 |
| **Pipeline 同 Session Reset 不兼容** | 🟠 高 | 高：任務失敗 | 用 Checkpoint Model 而唔係 phase model（見 Alternative B） |
| **Phase 2 (Plan) 在很多情況下係多餘的** | 🟡 中 | 中：浪費 | Plan Phase 設为 optional，不是 every task 都跑 |
| **Sub-agent 在 Phase 4 (Review) 可能不同意 Phase 1 的 Assessment** | 🟡 中 | 中：結論衝突 | 明確每個 phase 的 scope 邊界 |

---

## 4️⃣ Priority Order — 邊個行先？

### 🚀 P0（立即實行，價值最高、風險最低）

**1. Layer 1 — 在 AGENTS.md 加入 Surgical Changes 規則**
- 具體寫法（加入 AGENTS.md 的「Spawn 原則」段落）：
  ```
  ### Surgical Changes 紀律（2026-05-26 新增）
  > 每次 spawn sub-agent 處理 code task 時，明確列出：
  > - ✅ 可以改的檔案/範圍
  > - ❌ 唔准改的檔案/範圍
  > - 📋 交付標準（驗證方法）
  > 
  > Sub-agent 只處理明確範圍內的問題。
  > 如果發現範圍外的問題，記錄喺報告，但唔好自行修復。
  ```

**2. Layer 2 — 把 `.spawn_instructions.md` 改名為 `.spawn/_preamble.md`**
- 同時將 Surgical Changes + Goal Verification 紀律寫入 `_preamble.md`
- AGENTS.md spawn 段落更新：`cat .spawn/_preamble.md` → `cat .spawn/code_fix.template`

### 🟡 P1（值得做，但要小心實現）

**3. Layer 1 — 加入「Pipeline 觸發條件」到 AGENTS.md**
- 寫明幾時用 Pipeline / 幾時用 Simple Spawn

**4. Layer 2 — 建立 `code_audit.template` / `research.template` / `code_fix.template`**
- 按 task type 分類 templates
- 每個 template 預先填充 task-specific instruction

### ⚪ P2（可選，以下情況先考慮）

**5. Layer 3 — Checkpoint Model（取代 Phase Pipeline）**
- 只有喺 task 超過 1 小時代碼先考慮

**6. Token Cost Tracking**
- 每次 spawn 前 estimate cost
- 依家可以 skip，等累積多次 spawn 之後先有數據

---

## 5️⃣ 來自文章的額外 Insights（值得融入設計）

### Insight 1：**「Goal Verification」的核心係「失敗條件」，唔只係「目標」**

文章話「俾可驗證的完成條件」，我哋通常理解為「告知 sub-agent 目標係咩」。

但真正有意義的是：定義清楚 **「點樣知道自己失敗咗 / 幾時應該放棄」**。

例如：
- 「如果 `node --check` fail 第二次，停止並匯報，唔好再retry」
- 「如果需要修改的檔案數量 > 原来 scope 的 200%，停止並重新詢問」

呢個 concept 現有架構完全沒有（`auto_fix.js`、`spawn_kimi_agent-config.json` 都没有 abort criteria）。

### Insight 2：**「Surgical Changes」需要配套的 Scope 文件**

文章建議「Surgical」，但冇具體說明 scope 點表達。

**建議格式（每次 code task spawn 都附帶）：**

```markdown
## 📋 本次 Task Scope

### ✅ 在範圍內
- `.openclaw/workspace/scripts/auto_fix.js` — 修復 try-catch wrapper

### ❌ 明確在範圍外
- `.openclaw/workspace/scripts/code_quality_manager.js`（未經授權不動）
- `.openclaw/workspace/scripts/router/classifier.js`

### 📦 交付標準
- 所有 JS files passing `node --check`
- Low-risk fix applies silently
- High-risk fix reported with diff
```

### Insight 3：**Explore → Plan 可以合併（Reduce Round Trips）**

文章原文：
> Explore → Plan → Execute → Review

但我哋的 token cost constraint 令呢個 Pipeline 成本太高。

**最佳實踐：** 
> **Explore 與 Plan 可以係同一個 sub-agent 的前两步**  
> - Sub-agent 先 Explore（read-only；發现问题）  
> - 立刻跟住 Plan（给出方案及风险）  
> - 最後 Execute（if explicitly allowed）  

**唔同阶段用唔同的 tool set：**
- Explore：read / grep / file_discovery tools（冇 write）
- Plan：analysis + recommendations（read-only output）
- Execute：edit / exec tools（需要 explicit scope approval）
- Review：read-only verification（verify against success criteria）

---

## 6️⃣ 現有 System 的 Specific Issues

### Issue A：`auto_fix.js` generateSpawnPayload() 的 prompt 太長、太通用

现有 prompt 的问题：
1. 個 prompt 夾雜咗「你的任務」+「規則」+「Output 格式」—— 没有明显的 scope 界定
2. 冇明確的 scope restriction（sub-agent 會疑惑「我到底應唔應該改其他檔案」）
3. 「智能發現」部分（識別新規則）其實係 Phase 1 Explore 的工作，但被塞入同一個 prompt

**建議：** 重寫 `generateSpawnPayload()` 內的 prompt template，分拆成明确的 phases。

### Issue B：`spawn_kimi_agent-config.json` 沒有 Goal Verification

`spawn_kimi_agent-config.json` 的 `task` 字段只有任務描述，冇：
- Success criteria
- Scope (啥改、啥唔改)
- Abort criteria

**建議：** 喺 config.json 之外創建一個 parallel 的 `.scope.md`，spawn 前 cat 埋一齊。

### Issue C：`code_quality_manager.js` 有 Verify + Auto-fix timeout，但冇 Cost Estimation

`VERIFY_TIMEOUT_MS = 120000` / `AUTO_FIX_TIMEOUT_MS = 300000` 只係時間 timeout，唔反映真實成本。

**建議：** 加入簡單的 token counting（使用 API response 的 usage 欄位），logger 行一次就能睇到。

---

## 7️⃣ Recommended Implementation Roadmap

```
Week 1（價值最高的低風險 changes）：
├── 1.1 在 AGENTS.md 加入 Surgical Changes 段落
├── 1.2 在 AGENTS.md 加入 Pipeline Trigger Criteria
└── 1.3 建立 workspace/.spawn/_preamble.md

Week 2（係 1 的基礎上精細化）：
├── 2.1 重寫 generateSpawnPayload() 的 prompt structure（加入 scope block）
├── 2.2 建立 code_fix.template / audit.template
└── 2.3 在 classifier.js 加入 Pipeline heuristic（> 5 files → Pipeline suggestion）

Week 3（可選，視乎需要）：
├── 3.1 實現 Checkpoint Model（涉及 taskflow skill）
└── 3.2 加 Token Cost Tracking 到 code_quality_manager.js
```

---

## 8️⃣ Conclusion

三層設計的**方向係啱嘅**，但Execution上有幾個要注意的地方：

| 層 | 評估 | 建議 |
|----|------|------|
| **Layer 1** | ✅ 值得做，但只需要「加入 surgical changes + trigger criteria」兩句說話 | 立即做 |
| **Layer 2** | ✅ 改名為 `.spawn/` 結構係好主意，但需要配合 templates | Week 2 做 |
| **Layer 3** | ⚠️ Pipeline 想法好，但 full 4-phase 太貴 | Week 3 做 Checkpoint Model |

**最重要的 change：** 在每次 spawn 的 scope 定義中加入「失敗條件 + scope 邊界」，呢個係現有 system 完全缺失的。

---

*Analysis by Ally Sub-Agent (架構分析師)*  
*Task: Evaluate Three-Layer Spawn Design against 老金@freeman1266 article*  
*Files Referenced: AGENTS.md, SOUL.md, auto_fix.js (spawn section ~line 2450), classifier.js, spawn_kimi_agent-config.json*
