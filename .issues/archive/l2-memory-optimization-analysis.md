# L2 記憶日誌優化方案研究報告
**分析日期：** 2026-05-24 | **作者：** Subagent (Ally 分析)

---

## 問題背景

| 症狀 | 數據 |
|------|------|
| 每日 L2 file 噪音比例 | ~95%（實測 2026-05-23） |
| Decision log 現有 entries | 42 條（5月23日整天） |
| 現有 skip patterns | ~200+ 條，仍漏大量 cron noise |
| Archived issues 可用 | 124 個 |

---

## 問題一：新方法列表

### 方法 A：「Session Scan 改用 Decision Log 為主」✅ 最可行

**做法：** 不再掃 session jsonl，改為以 decision_log.jsonl 為 primary source。

- Decision log 每筆 entry 已有：`route`（SPAWN/DIRECT_ANSWER/CODE等）+ `textPreview`（用戶實際訊息）+ `channel`
- 每日 42 條 decisions 全部係真實 user message routing decisions，noise ratio = 0%
- 配合 Issues archive（今日 close 嘅 task）作爲 task summary

**優點：** 數據乾淨、已有現成程式、唔需要改架構
**缺點：** 42條/日 sample 偏少（只有有意識 call logRoute 嘅先入 log）

---

### 方法 B：「Daily Aggregator Cron（晚間彙整器）」✅ 高價值

**做法：** 新增一個每晚 23:30 跑的 cron job，唔 scan session，改为汇总多个 signal sources：

1. Decision log（今日所有 entries）
2. Issues archive（今日 completed/closed）
3. Daily summary generator output（L1 風格）
4. Git commits / deploy logs（如果有的話）

直接 generate 一個乾淨的 L2 entry，唔經過 session scan。

**優點：** 完全繞過 session scan noise problem、唔受 OpenClaw hook bug 影響
**缺點：** 要寫新 script（~200行）、需要定時執行

---

### 方法 C：「Beacon Pattern 插入法」📝 創新但複雜

**做法：** 在重要的決策點（spawn 完成、issue close、code merge）主動寫入一個 "beacon"（小型structured JSON）到一個乾淨的 daily beacon file，例如：

```json
{"ts":"2026-05-23T14:26","type":"X_link_analysis","result":"shared to #programming","ref":"issue #109"}
```

然後每日 L2 logger 只讀取 beacon file 做 aggregation，唔 scan sessions。

**優點：** 數據最乾淨精準
**缺點：** 要改多個現有 scripts（每個決策點加 beacon write）、維護成本高

---

### 方法 D：「fs.watch 被動監控」❌ 不推薦

**做法：** 用 `fs.watch` 監控 session file 變化，事件驅動式寫 L2。

**缺點：**
- macOS fs.watch 不穩定（時常漏、重複）
- 需要長期 running process，唔適合 cron
- 複雜度高，收益低

---

### 方法 E：「Webhook/Callback 架構」❌ 超出範圍

**做法：** 每個 agent decision 完成後 call webhook，aggregator 收集。

**缺點：** OpenClaw 内部架構依赖，不受控；实现成本高。

---

### 方法 F：「L0/L1 降級利用」✅ 被忽略的現成資産

**做法：** L0 Abstract（00:05）和 L1 Overview（00:35）已經每日生成高質量結構化摘要，但都係內部使用。可以設定 daily_summary_bot.js 直接取 L0/L1 内容作爲 L2 的骨幹，減少對 session scan 的依賴。

**優點：** L0/L1 已解決 noise problem（佢係主動生成，唔係被動 scan）、維護成本低
**缺點：** L0/L1 時間固定，唔一定覆盖全日

---

## 問題二：評分表（5分制）

| 方法 | Dev Effort | Maintenance | Reliability | Noise Level | Overall |
|------|------------|--------------|-------------|-------------|---------|
| **A. Decision Log → L2** | ★★☆ (2) | ★★★☆ (3) | ★★★★☆ (4) | ★★★★★ (5) | **3.5** |
| **B. Daily Aggregator** | ★★★☆ (3) | ★★★★☆ (4) | ★★★★☆ (4) | ★★★★★ (5) | **4.0** |
| **C. Beacon Pattern** | ★★★★☆ (4) | ★★☆☆ (2) | ★★★★☆ (4) | ★★★★★ (5) | **3.75** |
| **D. fs.watch** | ★★★★☆ (4) | ★★☆☆ (2) | ★★☆☆ (2) | ★★★★☆ (4) | **3.0** |
| **E. Webhook** | ★★★★★ (5) | ★★☆☆ (2) | ★★★☆☆ (3) | ★★★★☆ (4) | **3.5** |
| **F. L0/L1 利用** | ★☆☆☆☆ (1) | ★★★★★ (5) | ★★★★☆ (4) | ★★★★★ (5) | **3.75** |
| **現狀：Improve Skip** | ★★☆☆ (2) | ★☆☆☆☆ (1) | ★★★☆☆ (3) | ★★☆☆☆ (2) | **2.0** |

> **評分說明：** Dev Effort 越高=越難整；Maintenance 越高=越少更新；Reliability 越高=越穩定；Noise Level 越高=越乾淨

---

## 問題三：建議 Roadmap

### 🚀 短期（今晚搞掂）

**目標：** 馬上改善今日 summary quality，零額外開發

| Action | 做法 |
|--------|------|
| **1. 強化 SKIP_PATTERNS** | 加入今日發現的漏網 pattern：<br>`Now I have the raw data`、`AI HOT 推送完成`、`Daily memory logger completed`、`✅ 完成 ✅` 等 |
| **2. Decision log 補錄** | 對著今日殘留的 session noise，反向補入 decision log 作記錄 |
| **3. 改 `--auto` 為決策日誌+issue混合** | 新增至 `log_to_daily_memory.js`，add mode `decision_log`：優先從 decision_log.jsonl 取 entries，issue archive 作 secondary |

**Immediate win：** 加強 skip patterns 預計可消除額外 30-40% noise，馬上見效。

---

### 📆 中期（呢個星期）

**目標：** 建立不依賴 session scan 的日誌系統

| Phase | 做法 |
|-------|------|
| **Phase 1（Day 1-2）** | 寫 `daily_log_aggregator.js`：<br>- Read decision_log.jsonl（今日 entries）<br>- Read `.issues/active/` + archive（今日 completed）<br>- Read L0/L1 files（已結構化）<br>- Output 一個乾淨的 `YYYY-MM-DD-summary.md` |
| **Phase 2（Day 3-4）** | 設定每晚 23:00 cron 跑 aggregator，output 直接進 memory/ |
| **Phase 3（Day 5）** | 修改 `daily_summary_bot.js` 的 input source：<br>從 session scan → 改為讀取 aggregator output |
| **Phase 4（Day 6-7）** | 設定 daily_summary_bot 在 L2 aggregator 完成後才執行（依賴鏈） |

**預期效果：** noise ratio 從 95% → 15% 以下

---

### 🏗️ 長期（OpenClaw 修復 hook 後）

**觸發條件：** OpenClaw hook-runner bug 修復並 stable

| 做法 |
|------|
| 1. 啟用 `classifySync()` → `decision_logger.js` 的 hook（每個 message 自動記錄） |
| 2. 將 decision log 作為 L2 的 primary source，session scan 降級為 fallback |
| 3. 考慮 Beacon Pattern：在重要 task 完成點（如 issue close、PR merge）插入 structured beacon |
| 4. 日記/回顧自動化：L0/L1/L2 → daily_summary_bot 全部打通 |

---

## 組合方案摘要

```
最優組合（今晚 + 呢個星期）：

[短期] SKIP_PATTERNS 强化
  → 馬上減 30-40% noise，零開發

[中期] daily_log_aggregator.js（新 script）
  → 繞過 session scan，以 decision_log + issues 為核心
  → 每晚 23:00 自動彙整
  → daily_summary_bot 改為讀取 aggregator output

[長期] Beacon Pattern（可選）
  → 喺重要 decision points 主動寫 beacon
  → 配合 OpenClaw hook 修復後啓動
```

---

## 關鍵建議

1. **立即行動：** 今天就要增强 SKIP_PATTERNS，呢個零成本，即刻見效。
2. **核心轉向：** 停止依賴 session scan 作為 L2 來源，改用 decision_log.jsonl（已係乾淨數據）。
3. **Aggregator 係關鍵：** 寫一個乾淨的 `daily_log_aggregator.js`，每晚一次，係中期最有價值既投資。
4. **L0/L1 是被忽略的資産：** L0/L1 已經係結構化乾淨摘要，直接利用作 L2 骨幹，省大量功夫。

---

*分析基於：log_to_daily_memory.js (833行)、daily_summary_bot.js、decision_log.jsonl (42 entries)、.issues/archive (124 files)*