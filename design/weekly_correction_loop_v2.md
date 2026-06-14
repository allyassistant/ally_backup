# Weekly Correction Loop v2 — Design Document

**Created:** 2026-05-29
**Author:** Subagent (design only, no implementation)
**Status:** Draft — for Josh review

---

## 摘要

現有 `weekly_correction_loop.js` 分析的是系統噪音（timeout、rate limit），對 Ally 的行為改善冇用。我哋真正需要係追蹤 Ally 的決策模式，特別係：

- 「我選擇左 SPAWN，但 Josh 直接回答左」
- 「Josh 話唔好再做 X，但我第二天又再做」
- 「我 FDQ triggers 太進取 / 唔夠進取」

---

## 1. 數據來源

### 1.1 主要來源（替換 errors.json）

| 來源 | 檔案 | 目前狀態 | 用途 |
|------|------|----------|------|
| **Router Decision Log** | `scripts/router/decision_log.jsonl` | 42 entries（2026-05-20 起）| 路線選擇（SPAWN/FDQ/CODE/etc） |
| **Feedback Log** | `scripts/router/feedback_log.jsonl` | 🚨 空的（從未寫入）| Josh 明確糾正 |
| **Discord 對話紀錄** | `memory/discord-2026-*.md` | 有（每日一份）| 找出「唔係咁」/「你應該...」/「唔好...」 |
| **Misroute Log** | `scripts/router/misroute_log.jsonl` | 需要檢查（auto_corrector 輸出）| classifier 建議 vs 實際行為差異 |

### 1.2 次要來源（保留 errors.json 但降級）

| 來源 | 用途 |
|------|------|
| `memory/errors.json` | **降級為「技術健康」用途** — HA 監控、API 穩定性。唔再係行為學習嘅主要數據。 |

### 1.3 缺失數據 — 需要新建

| 缺失 | 原因 | 解決方案 |
|------|------|----------|
| **沒有地方記錄「我做了乜」** | decision_log 有 route，但冇記錄 action outcome | 擴充 decision_log.jsonl 加 `outcome` 欄位 |
| **沒有地方記錄「browser tab 關未」** | 個個指令自己負責，但冇集中追蹤 | 新建 `scripts/router/behavior_log.jsonl` |
| **沒有地方記錄「sub-agent spawn 得幾荒謬」** | 同上 | 同上，或加 `trivial_spawn` 標記 |

### 📝 快速 win（不需要基礎設施）

**立即可以做：** 擴充 `decision_logger.js` 的 `logRoute()` 加多兩個可選欄位：

```
extra: {
  outcome: "success" | "followed_up" | "josh_corrected",
  trivialSpawn: true,  // 如果是 spawn 但實際是 trivial task
  browserTabLeft: true  // browser 用完未 close
}
```

---

## 2. 分析邏輯

### 2.1 Pattern Detection（找出重複錯誤）

| Pattern 類型 | 檢測方法 | 例子 |
|--------------|----------|------|
| **Override 模式** | `rule="manual_override"` 出現 ≥3 次 | 我 consistently override classifier 選擇了 SPAWN |
| **Misroute 模式** | `scripts/router/auto_corrector.js` 的 misroute_log | classifier 建議 FDQ，我行了 DIRECT_ANSWER |
| **Contradiction 模式** | Discord 對話往前搵「唔好...」再往後搵再做一次 | 周三說唔好用 rm，周四又用了 |
| **Trivial Spawn 模式** | `trivialSpawn=true` 日誌 + message 簡短 | 我幫 "check status" spawn 左 sub-agent |
| **Stale Tab 模式** | `browserTabLeft=true` 日誌 | 做完 analysis browser tab 仲張開 |
| **FDQ 敏感度** | `route="FDQ"` / `route="DIRECT_ANSWER"` ratio (7天窗口) | 如果 FDQ > 30% of non-SPAWN decisions，trigger 可能太進取 |

### 2.2 Contradiction Detection Algorithm

```
For each correction in discord history:
  1. Extract "唔好..." / "不应该..." directive
  2. Encode directive as semantic hash (topic + action)
  3. Future scan: check if same topic + action appears
  4. If found within 14 days → flag as CONTRADICTION
```

**注意：** 需要 LLM 辅助做 semantic matching，regex 唔够。呢個係 Phase 2。

### 2.3 AGENTS.md Section Relevance Check

**目標：** 發現從未匹配過的 AGENTS.md 規則

```
For each AGENTS.md rule (from classifier.js RULES):
  1. Scan decision_log.jsonl for regex pattern
  2. If never matched AND rule age > 30 days:
     → Flag as "可能是死規則 / 定義有問題"
```

---

## 3. 輸出格式

### 3.1 輸出目標：每周建議摘要（JSON + Markdown）

```json
{
  "reportDate": "2026-05-29",
  "summary": {
    "routeDecisions": { "total": 42, "byRoute": {...} },
    "correctionsFound": 3,
    "contradictions": [
      {
        "type": "STILL_DID_IT",
        "topic": "rm_usage",
        "correctionText": "唔好用 rm，要用 trash",
        "firstSeen": "2026-05-20",
        "repeatedOn": "2026-05-25",
        "occurrences": 2,
        "agressiveness": "REPEATED_AFTER_CORRECTION"
      }
    ],
    "ruleGaps": [
      {
        "rule": "AGENTS.md Rule 3 (SOP)",
        "reason": "從未匹配但規則存在 > 30 天",
        "suggestion": "重新定義 SOP 觸發條件或移除"
      }
    ],
    "trivialSpawns": [
      { "text": "check status", "date": "2026-05-22" }
    ]
  },
  "suggestions": [
    {
      "id": "sug-001",
      "severity": "HIGH",
      "category": "CONTRADICTION",
      "title": "重複被糾正：以後再用 rm",
      "evidence": "2026-05-20 糾正，周三再用",
      "agressiveness": "2nd occurrence — 建議立即改 AGENTS.md",
      "proposedAction": "在 Coding Standards 加 P0: 禁止直接用 rm",
      "autoApply": false
    }
  ],
  "health": {
    "systemErrors": 3,
    "feedbackEntries": 0,
    "misrouteEntries": 0,
    "routeDistribution": { "FDQ": 5, "DIRECT_ANSWER": 20, "SPAWN": 10, ... }
  }
}
```

### 3.2 Discord 報告（保留 Josh 鐘意睇嘅 system health）

保留目前格式，但加入 **Behavior Section**：

```
🤖 Weekly Correction Loop — 2026-05-29

🔵 Behavior Analysis（新增）
   ⚠️ 矛盾：2 次（周三話唔好再用 rm，周四又用了）
   📋 從未觸發規則：1（AGENTS.md Rule 3 SOP）
   💡 輕率 Spawn：3 次

🔴 System Health（維持現有）
   錯誤：3（rate limit × 2, timeout × 1）
   模式：3 distinct patterns
   趨勢：+15%（相對上周）

🔒 No AGENTS.md changes this week（手動確認模式）
```

### 3.3 核心改變：❌ 不要自動寫入 AGENTS.md

現有 script 會 silent auto-apply rules，呢個係危險的。新設計：

- **Generate suggestion** ✅
- **Josh reviews + approves** ✅
- **Auto-write to AGENTS.md** ❌

---

## 4. 檔案變動

### 4.1 修改現有（只做增量改動）

| 檔案 | 改動 |
|------|------|
| `scripts/router/decision_logger.js` | 加 `outcome`、`trivialSpawn`、`browserTabLeft` 可選欄位 |
| `scripts/router/feedback_collector.js` | 建立 CLI interface（現在係空的但 module 已有 `collectFeedback` function）|
| `scripts/weekly_correction_loop.js` | **完全重寫**（見 4.2）|
| `memory/correction-loop-state.json` | 改名 `behavior-loop-state.json`， schema 改為新格式 |
| `scripts/lib/config.js` | 加新路徑 constants |

### 4.2 新建檔案

| 檔案 | 用途 |
|------|------|
| `scripts/router/behavior_log.jsonl` | 輕量行為日誌（browser tab close? trivial spawn?）|
| `scripts/router/contradiction_detector.js` | 分析 Discord 對話找出矛盾 |
| `scripts/router/rule_relevance_checker.js` | 檢查 AGENTS.md 規則是否從未匹配 |
| `scripts/weekly_correction_v2.js` | 新脚本（將來會取代 v1）|
| `design/weekly_correction_loop_v2.md` | 呢份文件 |

### 4.3 删除危險行為

| 檔案 | 危險點 |
|------|--------|
| `scripts/weekly_correction_loop.js` 的 `applyAutoRules()` | Silent write to AGENTS.md |
| `scripts/weekly_correction_loop.js` 的 `processAuditFindings()` | 同上，從 audit results auto-apply |

---

## 5. 時間線

### 🚀 Phase 0 — 立即（1-2 hours，不需要新基礎設施）

**目標：** 停止危險行為 + 建立最低可用數據

- [ ] 把 `applyAutoRules()` 和 `processAuditFindings()` 的 AGENTS.md auto-write 移除，改成 generate suggestion only
- [ ] 確認 `feedback_log.jsonl` 係空的 — 呢個係核心缺失
- [ ] 建立 Feedback CLI：`node scripts/router/feedback_collector.js --wrong FDQ --correct DIRECT_ANSWER --reason "應該直接答" --message-id "xyz"`
- [ ] 更新 decision_logger.js 加入 outcome/trivialSpawn/browserTabLeft 欄位
- [ ] Weekly report 加入 behavior section header

**評論：** Phase 0 唔需要任何新 infra，只需要執靓現有 code 加禁區標記。

### 🔧 Phase 1 — 基礎建設（一週）

**目標：** 建立數據管道，讓 weekly report 有野可分析

- [ ] 實現 `contradiction_detector.js`：掃 `memory/discord-*.md` 搵「唔好...」/「你應該...」/「唔係咁」 patterns
  - 用 keyword trigger list 而唔需要 LLM（粤语：唔好、唔應該、唔係、你应该、你应该...）
  - 簡單的 topic extraction（noun/verb pair）
- [ ] 實現 `rule_relevance_checker.js`：用 classifier regex patterns 掃 decision_log，有幾多從未匹配
- [ ] 把 `weekly_correction_loop.js` 重寫成 `v2`，讀新數據源，生成 structured suggestion summary
- [ ] 每週日的 cron trigger 保持，但 output 變成 `weekly_correction_v2.js`

**依賴：** phase 0 完成後再做。Phase 1 需要一定量 data accumulation（建議累積起碼 100+ decision log entries）。

### 📊 Phase 2 — 深度分析（兩週或以上）

**目標：** 真正有價值的 pattern detection

- [ ] LLM-assisted contradiction detection（semantic similarity > keyword matching*)
  - 問題複雜，暫時 Phase 1 用 keyword 就够
- [ ] FDQ sensitivity tracker：每周顯示 FDQ / total ratio trend
- [ ] "Josh always corrects me on X" counter（用 feedback_log，如果佢願意每週手動 call feedback_collector）

**注意：** Phase 2 需要 Josh 主動參與（定期 call feedback_collector）。如果佢懶，Phase 1 就是上限。

### 🎯 Phase 3 — 閉環（如果 Phase 2 feedback loop 建立得起）

**目標：** 讓 system 自己 identify + apply corrections（但仍然需要 Ally 主動確認，唔係 auto-write）

- [ ] 將 suggestion summary 寫入 `memory/pending_corrections.json`
- [ ] Ally 在 weekly review 中睇到 pending_corrections，確認邊個要加 AGENTS.md
- [ ] 呢個係願望清單，如果 Phase 1/2 數據唔够就繼續係 Phase 1

---

## 6. 架構圖

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Weekly Cron Trigger                             │
└───────────────────────────────┬───────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│              weekly_correction_v2.js (NEW)                         │
│                                                                   │
│  Data Sources:                                                     │
│    1. decision_log.jsonl     → route distribution, misroutes       │
│    2. feedback_log.jsonl     → explicit corrections (EMPTY!)       │
│    3. discord-*.md           → implicit corrections (contradict)   │
│    4. behavior_log.jsonl     → trivial spawns, stale tabs          │
│    5. errors.json           → system health (degraded source)    │
│                                                                   │
│  Analysis:                                                         │
│    - contradiction_detector.js    (discord history scan)           │
│    - rule_relevance_checker.js   (unused rules)                   │
│    - behavior_analyzer.js       (pattern from behavior_log)       │
│                                                                   │
│  Output:                                                           │
│    - suggestion_summary.json  (NEW: no auto-apply)                 │
│    - Discord report (modified, includes behavior section)          │
└───────────────────────────────┬───────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│             Ally Reviews + Edits AGENTS.md Manually               │
│                    (NO AUTO-APPLY ANYMORE)                        │
└───────────────────────────────────────────────────────────────────┘
```

---

## 7. 已知問題與警告

### 7.1 feedback_log.jsonl 係空的 — 最大問題

`feedback_collector.js` module 有 `collectFeedback()` 但從未有人主動 call。冇 feedback log 的情况下，我哋只能靠：

1. **Discord 對話被動掃描** — 複雜，有噪音
2. **misroute_log** — 取決於 auto_corrector.js 有冇被 call
3. **decision_log** — 只有 route，冇 feedback（即係「我行左呢個 route，但係咪啱？」）

**建議：** Josh 願意每週手動打一次 feedback 咁緊要。如果唔願意，Phase 1 就係極限。

### 7.2 Decision Log 只有 42 Entries

呢個係非常細的樣本。數據要累積到 200+ 先有 statistical significance。

### 7.3 Circular Dependency Risk

現有架構有潛在問題：`weekly_correction_loop.js` 自己 analysis 自己然後 auto-write AGENTS.md，新設計已排除呢個。

新 script `weekly_correction_v2.js` 唔應該 require 自己 output 的任何檔案。

### 7.4 Discord 對話 Parse 複雜性

`memory/discord-*.md` 係每日聊天 log，parser 需要識別：
- 邊個係 Josh，邊個係 Ally
- 邊個係 correction（"唔好..."）
- 邊個係 re-occurrence（"你又用 rm 了"）

呢個係 Phase 1 最大的技術挑戰。建議先用簡單 keyword trigger，逐步改善。

---

## 8. 快速 wins 總結

| Action | Impact | Time |
|--------|--------|------|
| 移除 auto-apply to AGENTS.md | 🔴 HIGH（危險）| 30 min |
| 建立 feedback CLI | 🔴 HIGH（核心數據缺失）| 1 hour |
| Weekly report 加 behavior section | 🟡 MED | 1 hour |
| 擴充 decision_logger.js fields | 🟡 MED（改善數據 quality）| 30 min |
| contradiction_detector.js (keyword) | 🟡 MED（主要分析）| 2-3 hours |

**建议：** 先做 Phase 0，skip Phase 2/3 直場 Phase 1，等累積足夠 data 先再决定係唔係值得做 Phase 2。

---

*Last Updated: 2026-05-29 | Design only — no implementation*
