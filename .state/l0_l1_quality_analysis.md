# L0/L1 記憶生成系統質量分析報告

**分析日期：** 2026-04-07  
**分析者：** Subagent (Ally task)  
**覆蓋範圍：** 2026-04-03 至 2026-04-06

---

## 摘要

L0/L1 記憶生成系統存在**四個相互關聯的根本性問題**，導致輸出質量長期不穩定。核心問題不是 AI 能力不足，而是**輸入數據幾乎全部是系統噪音（cron job 輸出），而非真實對話內容**。

---

## 一、根因分析：Top 3 問題

### 🔴 Problem 1：輸入數據幾乎全部是系統噪音（根本原因）

**現象：**
- 抽查 2026-04-06 的 14 個 L2 檔案，**每個檔案只有 7 行，全部是 cron job 輸出**
- 所有 L2 檔案內容相同/相似：都是 `code_quality_manager.js scan` 的運行日志
- 總內容量：747-1123 bytes/檔案，極度稀疏

**L2 檔案內容範例（2026-04-06）：**
```
# Daily Memory - 2026-04-06
- * [上午10:04] [記錄: 2026-04-06] [MAIN]: [cron:...] 執行 Code Quality Manager 流程：
- * [上午10:04] [記錄: 2026-04-06] [MAIN]: ==================================================
- * [上午10:04] [記錄: 2026-04-06] [MAIN]: Scan 完成。發現 25 個 High 問題...
- * [上午10:04] [記錄: 2026-04-06] [MAIN]: Low-risk 修復完成 (13 個)。
- * [上午10:04] [事件: 2026-04-05 | 記錄: 2026-04-06] [MAIN]: 🔧 Running system check...
```

**根本原因：**
- **Discord/Signal 對話根本冇寫入 L2 檔案** — 對話記錄系統可能故障或未啟用
- L2 記憶系統只捕捉到 cron job 输出了 `system_check_bot.js`, `code_quality_manager.js`
- 真實用戶對話（股票詢價、閒聊、編程問題）完全不在 L2 數據中

---

### 🟠 Problem 2：Ollama gemma4:e2b 經常失敗 → 觸發 Fallback

**現象：**
- Log 顯示 `Ollama returned invalid response: null` → L0 fallback
- Log 顯示 Ollama pre-check 通過但 API call 返回 null
- Fallback mode 輸出 raw log lines 而非有意義摘要

**L0 Fallback 輸出範例（2026-04-06）：**
```
# L0 Abstract - 2026-04-06
當日共有 5 個主要討論話題，涵蓋：[上午04:01] [事件: 2026-04-05 | 記錄...
## Today's Key Topics
* [上午04:01] [事件: 2026-04-05 | 記錄: 2026-04-06] [MAIN]: 🔧 Running system check for
* [上午06:03] [事件: 2026-04-05 | 記錄: 2026-04-06] [MAIN]: 🔧 Running system check for
...
---
*Generated: 2026-04-06T16:05:25.572Z (extraction fallback — enhanced)*
```

**根本原因：**
- Ollama API 返回 null 但 curl exit code 仍是 0 → error 未被捕捉
- Fallback 只是字面上抽取最長的 log 行，**完全冇理解能力**
- Fallback header "Today's Key Topics" 後面係 timestamp 碎片，毫無價值

**L1 成功但有 hallucination（2026-04-06）：**
```
## 程式品質管理報告摘要 (2024-04-06)  ← 錯誤年份！
```
- 日期 hallucination：2024 vs 2026（差了 2 年）
- 模型填充了"建議"和"結論"，這些內容不在輸入中

---

### 🟡 Problem 3：L2 檔案數量差異達 4.4 倍

**每日 L2 檔案數量：**

| 日期 | L2 檔案數 | 變化幅度 |
|------|----------|---------|
| 2026-04-03 | **53** | 基準 |
| 2026-04-04 | 22 | -59% |
| 2026-04-05 | 12 | -77% |
| 2026-04-06 | 14 | -74% |

**根本原因：**
- L2 檔案數量 = cron job 運行次數（日志快照）
- 53 files = 2 小時一次 cron job × 53 個時間點
- 12-14 files = 某些 cron job 停了或改了頻率
- **根本冇對話內容**，所以數量差異冇實際意義

---

## 二、數據質量報告

### L2 檔案抽樣分析（2026-04-06）

| 檔案 | 大小 | 行數 | 內容類型 |
|------|------|------|---------|
| 2026-04-06-0005.md | 747B | 7 | cron system check |
| 2026-04-06-1004.md | 1123B | 7 | code quality scan |
| 2026-04-06-1409.md | 1123B | 7 | code quality scan |
| 2026-04-06-1603.md | 1012B | 7 | mixed cron output |
| 2026-04-06-2001.md | 1038B | 7 | mixed cron output |

**結論：** 所有抽樣的 L2 檔案都是**系統自動產生的 cron job 輸出**，冇有任何真實用戶對話內容。

### L1 輸出質量評估

| 日期 | 檔案數 | L1 質量 | 問題 |
|------|--------|---------|------|
| 2026-04-03 | 53 | 一般 | 仍以 cron output 為主，但起碼有 Issue #081 提到 |
| 2026-04-04 | 22 | 差 | 完全係「請告訴我」的迴響式回覆 |
| 2026-04-05 | 13 | 一般 | 比 04-04 稍好，但空洞 |
| 2026-04-06 | 14 | 差 | 年份 hallucination (2024→2026) |

---

## 三、Prompt 評估

### 現有 Prompt
```
你是一個專業的繁體中文摘要助手。你必須使用繁體中文（香港用語），絕對禁止使用簡體中文。

生成 ${cfg.label} for ${dateStr}。

要求：
- ${cfg.wordRange} 字
- 必須使用繁體中文（香港/台灣用語），禁止使用簡體中文
- 例如：使用「學習」而非「學习」，使用「討論」而非「討論」，使用「這個」而非「這個」
- ${cfg.topicDescription}
- ${cfg.detailInstruction}

對話記錄：
${content}
```

### Prompt 問題

1. **「對話記錄」標籤誤導** — 實際輸入是 cron job 日志，不是對話
2. **冇給出具體輸出格式** — 只說「${cfg.detailInstruction}"直接輸出，唔需要標題解釋"」，但 L1 還是生成了 Markdown 標題
3. **冇指定日期提取方式** — 導致模型自己估年份（2024 instead of 2026）
4. **溫度 0.3 偏低但仍是 Q4 量化模型** — gemma4:e2b 是 Q4_K_M 量化版，能力受限
5. **num_predict 太少** — L1 只預測 800 tokens，但要求 500-600 字，加上 prompt  overhead，輸入 window 8000 chars 會超

### Prompt 改進建議

```
你是一個專業的繁體中文摘要助手。
背景：以下係 ${dateStr} 呢一日嘅系統日誌同操作記錄。
注意：呢啲唔係用戶對話，主要係 cron job 同自動化腳本嘅輸出。

任務：從以下混雜嘅系統日誌中，提取真正有意義嘅工作成果。
- 忽略重複嘅 cron 檢查輸出
- 專注於：實際完成嘅任務、發現嘅問題、作出嘅決定

要求：
- ${cfg.wordRange} 字繁體中文摘要
- 如果日誌內容空洞（「請告訴我」或重複的系統檢查），明確說明「本日主要為系統自動化，無顯著用戶活動」
- 禁止幻想唔存在嘅內容
- 日期必須係 ${dateStr}，唔好自己估年份

輸出格式：
${cfg.label} - ${dateStr}
[直接正文，唔需要標題]
```

---

## 四、最佳實踐建議

### 📌 推薦運行時間

| 現狀 | 問題 | 建議 |
|------|------|------|
| 未發現 cron job | L0/L1 generator 似乎冇固定排程 | 需要先確認實際運行時間 |

**建議：** 如果要設定排程，應該是 **09:00-10:00**（讓過夜的所有 cron job 完成），但更關鍵的係先修復數據源。

### 📌 數據準備要求

1. **確保 Discord/Signal 對話有寫入 L2** — 這是最高優先級
   - 檢查對話記錄系統是否正常
   - 確認 session 结束后有寫入 memory

2. **過濾 cron job noise**
   - 在 memory_generator.js 中新增 filter，排除重複的 system_check 輸出
   - 或在寫入 L2 時就過濾（更好的方案）

3. **最低數據量要求**
   - 至少 5KB 有效對話內容才運行 L0
   - 至少 10KB 有效對話內容才運行 L1
   - 否則應該 skip 並記錄原因

### 📌 Prompt 優化方向

1. **加入「無內容」處理分支** — 當輸入全是 cron output 時，明確告知模型
2. **要求提取具體 action items** — 而非泛泛的「討論了什麼」
3. **限制 num_predict** — L0 300 → 200，L1 800 → 600（避免 modelhallucinating filler）
4. **加入日期驗證** — prompt 中明確包含日期字符串，model hallucination 年份的幾率會降低

---

## 五、決策建議

### 最終建議：**改進後保留，不建議放棄**

**理由：**
1. 架構方向係啱嘅 — L0/L1 分層抽象係合理嘅記憶系統
2. 問題全部係可修復的 — 數據源、Prompt、Model selection
3. Ollama fallback 問題可繞過 — 改用 MiniMax API 而非本地 gemma4:e2b

### 改進優先級

| 優先級 | 行動 | Impact |
|--------|------|--------|
| **P0** | 修復對話記錄寫入機制，確保 Discord/Signal 對話進入 L2 | 解決 80% 質量問題 |
| **P0** | 在 L0/L1 input 前過濾 cron output noise | 提升輸入信噪比 |
| **P1** | Fallback mode 改用 MiniMax 或 skip（唔好 output raw logs） | 消除最差輸出 |
| **P1** | Prompt 加入「無顯著活動」的明確分支 | 減少 hallucination |
| **P2** | 設定固定 cron job 運行時間（09:00） | 系統化 |
| **P2** | Ollama gemma4:e2b → qwen2.5:3b 或 MiniMax | 模型質量 |

### 立即可做的 Quick Wins

1. **加入 input validation** — 如果 combined L2 content 中「cron」「system check」佔比 >70%，輸出 warning 並可選 skip
2. **Fallback mode 改為簡單 message** — 唔好 output 生成的 raw log lines，改為「⚠️ Ollama 失敗，輸入數據不足，請手動檢查」
3. **Log 中標記 Ollama 失敗原因** — `null` response 需要區分是 model 問題還是 API 問題

---

## 附錄：關鍵證據

### L2 檔案日誌截圖
```
# Daily Memory - 2026-04-06
- * [上午12:05] [記錄: 2026-04-06] [MAIN]: kimi, version 1.28.0
- * [上午12:05] [記錄: 2026-04-06] [MAIN]: zsh:1: command not found: sessions_spawn
- * [上午12:05] [記錄: 2026-04-06] [MAIN]: { "status": "yielded", "message": "Option 3 可行性分析已完成..." }
```
→ 注意：「對話記錄」實際上係 log lines，唔係真正嘅 user ↔ bot 對話

### Cron Job 現況
```
# Memory archiver - 每日 03:00
0 3 * * * node .../memory_archiver.js
# Memory section cleanup - 每日 04:00
0 4 * * * node .../memory_section_cleanup.js
```
→ **L0/L1 generator 冇 cron job！** 似乎係手動或間接觸發

### Ollama 模型狀態
```
gemma4:e2b - 5.1B parameters, Q4_K_M quantization
```
→ Q4 量化版，能力比 full precision 差，可能係 hallucination 和 null response 的原因之一

---

*Report generated: 2026-04-07*
