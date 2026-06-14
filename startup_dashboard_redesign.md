## 建議 Dashboard Sections（由最重要到最不重要）

---

### 1. 🎯 Current Objective + Next Step
**Why:** 呢個係最重要嘅資訊。Session reset 後，我最想知道：「我喺邊、做緊咩、下一步做咩」。現有 `.session_handoff.md` 已經有呢個，但係散開嘅，唔係 dashboard 格式。
**Format:**
```
## 🎯 當前目標
[一句話描述當前在做的任務]

## → 下一個 Action
- [具體下一步，1-2 行]

## ⏸️ 阻塞狀態
- [如果有的話：等 Josh 確認 / 等某個 event / 等 data]
```

---

### 2. ⏳ Pending Decisions（等 Josh 決定）
**Why:** 我最怕係「自己估咗做，但係 Josh 另有想法」。如果佢表達過某個方向、但未確認 decision，我應該知道。現有 `_pending_decisions.md` 係空白（從未真正寫過），但呢個 section 先係眞正有用嘅資訊。
**Format:**
```
## ⏳ 待 Josh 決定（按緊急性排序）
- [Topic / Decision description] — 等咩？[input/approval/choice]
- [Topic / Decision description] — 等咗幾耐？[3 days / 1 week]
- [Topic / Decision description] — 如果超時點算？[auto-proceed / ask again]
```

---

### 3. 📅 In-Flight Tasks（做咗一半 / 觀察緊）
**Why:** 唔只係 P1，先係「做咗一半」同埋「主動觀察紧」。例如 #124 (觀察7日) 係主動任務，但唔係 urgent；#120 (觀察7日) 係 ongoing monitoring。新版 Dashboard 應該話我知邊個 task 有進度、邊個係被動等待。
**Format:**
```
## 📅 進行中任務（按進度排序）
- [#124] Compaction & Handoff 架構 — Day 2/7 ✅ deploy passed, audit passed
- [#120] SPAWN routing enforcement — Day 2/7 🔍 observing
- [#119] Daily Maintenance cron race condition — 🔴 URGENT: due today
- [#112] Routing Phase 4 (Cross-channel) — 🔴 OVERDUE 3 days
```

---

### 4. 🗓️ 過去 48 小時 Discussion Topics（濃縮版）
**Why:** 「尋日傾咩」比「尋日做咩」更重要。Agent 需要知道 topic context，唔係 task list。L0 summaries 太散，應該壓縮成「3-5 topics with 1-line each」。
**Format:**
```
## 🗓️ 過去 48 小時 Topics
- **AGENTS.md 重構** — Pipeline Tier System 確立，Kimi Deep Research SOP 完成
- **Routing System** — Phase 4 架構規劃中，cross-channel routing 待做
- **Daily Synthesis** — L2 logger fix 完成，thinking partner contract 建立
- **Startup Dashboard** — MVP 完成，正在重新思考 content redesign
```

---

### 5. 🚨 Actionable Alerts（可行動的 alert）
**Why:** 現有 alerts 全部係「data dump」— L0 timeout ×362 次、Generic error ×344 次。呢啲係 metadata，唔係 action。眞正 useful alert 係：「某個 cron job 撞咗 race condition，今日到期要 fix」。
**Format:**
```
## 🚨 需要行動的 Alerts（按 severity 排序）
- 🔴 Daily Maintenance cron (05:00) race condition with memoryFlush — fix pending, due 2026-06-04
- 🟡 Discord Channel Logger cron timeout — model-call-started hang, needs root cause analysis
- 🟡 18 次 SPAWN routing override — classifier 可能 drift，需要 review
```

---

### 6. 🔇 Do-Not-Redo（唔好重复做）
**Why:** 呢個係 session handoff 最重要但最常被忽略嘅部分。上個 session 做咗啲咩、結論係啲咩，agent 好容易喺 reset 後重新糾纏一次。如果有一個「不要重做」清單，新 agent 可以直接跳過。
**Format:**
```
## 🔇 唔好再做
- SOUL.md Level 4 人格蒸餾 — 已決定現有架構足夠，唔使重構
- Wiki ingest timeout fix — 已 deploy，觀察緊，唔使再改
- AGENTS.md spawn rule — 已確認正確，唔使再拗
- [Topic] — [Reason]: 已確認結論，唔使再討論
```

---

### 7. 💡 Behavioral Correction（從 Weekly Correction Loop 來的 actionable feedback）
**Why:** 現有 `.cross_session_context.md` 入面嘅「18 次 override」係 statistics，唔係 feedback。應該變成：「你最近傾向 [behavior]，建議改為 [alternative]」，agent 先可以行。
**Format:**
```
## 💡 行為改善建議
- 🟡 SPAWN routing — 18 次手動 override，classifier 可能需要微調。建議：下次遇到邊界 case 先記錄再決定，唔好直接 override
```

---

## MVP 現有 Sections 評估

### Today in Review（L0 summaries）
🔴 **Cut / Merge** — 現有 L0 太長（~200字/日），而且同「Discussion Topics」功能重疊。建議合併成「過去 48 小時 Topics」，用 3-5 行一句話 summary。

### System（Ally/Bliss health）
🟡 **Merge into Alerts** — 正常狀況下唔需要睇 system health，除非有問題。應該變成「Alert if unhealthy」，唔係日常 display。如果 cron job fail > 3 次，先變成 Alert，再喺 dashboard 顯示。

### Alerts（.proactive_alerts.json）
🟡 **Redesign** — 現有係 raw data dump（5 Warning、3 Discord error、3 Syntax error）。應該改成「Actionable Alerts」，只顯示「需要行動」嘅 alert，唔係所有 error patterns。

### Active Tasks（P1 issues）
🟢 **Keep but refine** — P1 issues 仍然有用，但應該加多兩個維度：
1. **Overdue** highlight（紅色）
2. **In-progress vs monitoring** 區分

### Pending Decisions（_pending_decisions.md）
🟡 **Keep but fill** — 呢個 section 概念啱，但目前係空白。應該喺每個 session end 時自動填充，唔係靠手動。

---

## 最終建議 Sections（5個 max）

| Priority | Section | Source | Key Change |
|----------|---------|--------|------------|
| 🔴 P0 | **Current Objective + Next Step** | `.session_handoff.md` | 標準化格式，明確列出 block 狀態 |
| 🔴 P0 | **Pending Decisions（等 Josh 決定）** | `_pending_decisions.md` | 每次 session end 自動填充 |
| 🟡 P1 | **In-Flight Tasks** | `.issues/active/` | 加 urgency + progress 欄，唔只 P1 |
| 🟡 P1 | **Discussion Topics（48hr）** | L0/L1 summaries | 壓縮成 3-5 topics，唔係 raw summaries |
| 🟢 P2 | **Actionable Alerts** | `.proactive_alerts.json` | 只顯示需要行動的，唔係 data dump |

---

## 删减掉的 Sections

- **System (Ally/Bliss health)** → 降級為被動 alert，唔係日常 dashboard
- **Today in Review (raw L0)** → 合併入 Discussion Topics（用濃縮格式）
- **Weekly Correction Stats** → 改為 Actionable Feedback（見 Section 7）

---

## 結論

MVP 5 個 sections 入面，**保留 3 個（Tasks, Pending Decisions, 部分 Alerts）**，**砍 1 個（System）**，**合併 1 個（Today in Review → Discussion Topics）**。

最大 gap 係 **Current Objective** — 目前冇一個統一格式可以快速知道「我喺邊」。建議用 `.session_handoff.md` 做標準化，dashboard 直接讀取。

---
*Analysis by subagent | Data sources: .cross_session_context.md, .session_handoff.md, .issues/active/, memory/l0-abstract/, memory/l1-overview/, .proactive_alerts.json*