---
name: cron-passive-job-detection
description: 識別並修復已退化為被動 systemEvent+main 模式的 cron jobs——透過 duration 指標、config kind 對比、以及手動執行驗證來發現「得把口」但無實際運行的 jobs。
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-10T02:32:30.394Z
---

## 背景

Cron jobs 從 `agentTurn` + `toolsAllow: exec` 遷移到 `systemEvent` + `sessionTarget: main` 時，可能會「退化」成一種看似正常但實際只係射文字入 session、被動等用戶或另一個 session 執行嘅模式。呢種 jobs 喺 OpenClaw 介面顯示「成功」，但從未真正執行過 script。

呢個 skill 描述點樣系統性地發現呢類被動 jobs，並將佢哋修復為真正嘅 thin executor。

## Workflow

1. **列舉所有 cron jobs**  
   用 `cron list` 取得完整 jobs 清單，記錄每個 job 嘅 `id`、`name`、`schedule`、`lastRunAt`、`duration`、`consecutiveErrors`。

2. **計算 Duration 健康線**  
   健康嘅 thin executor jobs 通常 runtime ≥ 5s。被動 jobs 典型係 **4ms（只係 inject text）**。低於 500ms 係高度可疑信號，4ms 幾乎可以確診。

3. **識別高風險 jobs**  
   從清單中標記所有符合以下條件嘅 jobs：
   - `kind: systemEvent` 且 `sessionTarget: main`
   - 最近一次 `duration ≤ 500ms`
   - `consecutiveErrors: 0`（外觀正常，但實際冇行過）

4. **對比歷史記錄**  
   用 `cron history <job-id>` 查看佢嘅 run history：
   - 以前有 `agentTurn` + `toolsAllow` 執行記錄（duration 30-80s）→ 確認係退化，唔係從來都冇行過
   - 從未出現過長 duration → 可能係從未正常過，唔係退化

5. **手動執行驗證**  
   克隆 job payload 嘅 command，手動喺 terminal run：
   ```bash
   node /path/to/script.js --quiet
