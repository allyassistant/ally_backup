# Router Agent 可行性研究

> **Phase 2 — 研究報告**
> 日期：2026-05-20
> 負責：Router System 研究
> 評級：輕量研究，唔係完整 PRD

---

## 1. 問題定義

### 1.1 咩係 Router Agent？

傳統 routing 係硬編碼嘅 decision tree（Phase 0 — regex classifier），
或者用 LLM 一次性 classify（Phase 1 — intent classifier）。

Router Agent 係另一種 paradigm：
**一個 AI Agent 自動分析 task、拆解、揀選最適合嘅 worker/sub-agent**。

類似 Google ADK-style 的 implicit routing：
```
User Message
    ↓
[Router Agent]
  ├─ 分析意圖
  ├─ 評估 complexity / context window / urgency
  ├─ 決定：自己回答 / spawn sub-agent / defer
  └─ 揀選邊個 worker 同 model
```

### 1.2 我哋現有架構

```
User Message
    ↓
Phase 0 Classifier (regex) ─→ Route Suggestion
    ↓
Phase 1 LLM Intent Classifier ─→ Route Suggestion (more accurate)
    ↓
Agent Execute (spawn / direct / etc.)
```

目前我哋係 **semi-explicit routing**：
- classifier 俾 suggestion
- 主 agent 最後 decision

Router Agent 會係 **fully implicit**：
- agent 自己決定，冇 external suggestion

---

## 2. 分析

### 2.1 好處（Pro）

| 好處 | 說明 |
|------|------|
| **動態適應** | 可以根據 actual runtime context（load、latency、cost）動態揀 model |
| **任務拆解** | 複雜 task 可以自動拆成 sub-tasks，分配唔同 worker |
| **意圖理解** | 比 regex classifier 更好地理解模糊/複雜嘅 user message |
| **減少 Prompt engineering** | 唔需要為每種 route 寫大量 if-then rules |
| **自我優化** | 可以根據 feedback 持續改進 routing strategy |

### 2.2 壞處（Con）

| 壞處 | 說明 |
|------|------|
| **增加 Latency** | Router Agent 自己係一個 LLM call，多一層 overhead |
| **不可預測** | Routing decision 唔透明，難以 audit / debug |
| **Over-engineering** | 目前係 semi-explicit routing，已經運作良好 |
| **Cost 增加** | 多一個 LLM call = 多啲 token cost |
| **Debug 複雜** | 一個 misroute 唔係睇 log 就知係邊步錯 |

### 2.3 數據分析（估算）

**目前數據（根據日常觀察）：**

| 指標 | 估算 | 備註 |
|------|------|------|
| 每日 message volume | ~50-100 | Discord 主要 channel |
| 需要 spawn sub-agent | ~15-20% | 研究/分析/複雜code任務 |
| 需要 deep analysis | ~10% | 多步驟/架構决策 |
| 簡單直接回答 | ~40% | Yes/No、解釋、常規操作 |
| FDQ（問清楚） | ~10% | 模糊請求 |
| Catch-all (SPAWN) | ~25% | 目前 Phase 0 catch-all |

**Multi-step task 佔比：~10-15%**
**複雜到值得 Router Agent 拆解：~5%**

### 2.4 比較：Explicit vs Implicit Routing

| 維度 | Explicit (Phase 0/1) | Implicit (Router Agent) |
|------|---------------------|----------------------|
| Latency | ✅ 低（regex / 1 LLM call） | ❌ 高（+1 LLM call） |
| 可解釋性 | ✅ High（rule-based log） | ❌ Low（black box） |
| 維護成本 | ✅ Low（改 rules） | ❌ High（改 prompt/data） |
| 準確度 | ⚠️ 中（regex 有限） | ✅ 高（LLM理解） |
| 成本 | ✅ 低 | ❌ 高（多一個 call） |
| Debug 容易度 | ✅ Easy | ❌ Hard |

---

## 3. 預估 Effort

### 3.1 如果要做 Router Agent

| Phase | Task | Effort (hrs) |
|-------|------|-------------|
| Design | Router Agent prompt / system design | 3-4 |
| Implement | Router Agent implementation | 6-8 |
| Testing | Integration test + edge cases | 3-4 |
| Monitoring | Audit log + dashboard metrics | 2-3 |
| **Total** | | **14-19 hrs** |

### 3.2 如果繼續用 Explicit Routing (Phase 1)

| Phase | Task | Effort (hrs) |
|-------|------|-------------|
| LLM Classifier | Phase 1 intent classifier | 4-6 |
| Model Router | Model selection engine | 2-3 |
| Dashboard | Basic routing dashboard | 3-4 |
| **Total** | | **9-13 hrs** |

---

## 4. 決策框架

### 4.1 建議 Condition（幾時先做 Router Agent）

Router Agent 只係以下條件 **全部滿足** 先值得做：

1. **Multi-step task 佔比 > 30%**
   - 目前估算 ~10-15%，未達標
   - 需要等 Phase 1 routing data 累積 1 個月先有準確數字

2. **Explicit routing 已優化到瓶頸**
   - Phase 1 classifier accuracy < 80%
   - 且 misroute correction 頻繁

3. **Latency 不是主要痛點**
   - Router Agent overhead ~2-5 秒
   - 如果日常對話係秒級回應，5秒 overhead 影響明顯

4. **有 stable prompt dataset**
   - 需要累積足够多 examples 训练/few-shot prompt

### 4.2 替方案（如果唔做 Router Agent）

| 方案 | Description | 適用場景 |
|------|-------------|---------|
| **改進 sub-agent prompting** | 優化 spawn prompt，减少 misroute | 簡單有效 ✅ |
| **Phase 1 LLM Classifier** | 升級 regex → LLM intent classifier | 平衡 cost/accuracy ✅ |
| **Hybrid routing** | Simple = regex, Complex = LLM Classifier | 目前計劃 ✅ |
| **Model Router** | 根據 email type / task complexity 揀 model | 已經喺 Phase 2 ✅ |

---

## 5. 建議

### 5.1 結論

**暫時唔建議做 Router Agent。**

理由：
1. 目前 multi-step task 佔比低（~10-15%），唔值得多一個 LLM call 的 overhead
2. Phase 1 explicit routing 已經有足够能力應付目前需求
3. Router Agent 的 latency penalty 影響日常對話體驗
4. 14-19 小時 effort 可以更好地投放到 Phase 1 或其他功能

### 5.2 時間線建議

```
2026-05 (now)        Phase 2 — Email Router + Failure Recovery ✅
                     Phase 2 — This Study → Done 📋

2026-06              Phase 1 — LLM Intent Classifier + Model Router

2026-06 (end)        收集 routing data 1 month

2026-07              Review: multi-step task %?

                     IF multi-step > 30% AND Phase 1 accuracy < 80%
                        THEN → Router Agent Design Phase
                     ELSE
                        → Continue with Explicit Routing + Hybrid
```

### 5.3 如果將來要做 Router Agent

建議架構係 **lightweight planning layer**，唔係 full agent：

```
┌─────────────────────────────────┐
│  Lightweight Planner            │
│  ├─ 分析 complexity (low/med/high) │
│  ├─ 簡單 → Direct Answer      │
│  ├─ 中等 → Spawn sub-agent     │
│  └─ 複雜 → Router Agent (rare) │
└─────────────────────────────────┘
```

呢個 planner 係 deterministic（if-then），唔係另一個 LLM，
保持 routing decision 可解釋、可 audit。

---

## 6. 附錄：相關資源

- [Google ADK Router](https://google.github.io/adk-docs/agents/router/) — Implicit routing 的 reference
- Phase 0 Classifier: `scripts/router/classifier.js`
- Phase 1 LLM Intent Classifier: (in progress)
- Router Agent alternative: `scripts/router/email_router.js` — cost-aware email routing

---

## 7. 更新記錄

| 日期 | 更新內容 |
|------|---------|
| 2026-05-20 | 初始版本 |