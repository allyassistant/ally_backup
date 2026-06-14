# errors.md - 錯誤記錄與教訓

*記錄犯過嘅錯誤，避免重蹈覆轍。*

---

## 2026-03-06 - PDF 提取錯誤案例

### 📋 背景
用戶提供鑽石庫存 PDF，要求提取數據轉換為 Excel。

### ❌ 問題
1. **字符誤認**：PDF 提取工具將 **VVS1/VVS2** 誤認為 **WS1/WS2**
2. **證書號碼錯誤**：Row 9 證書號碼 `7531558780` 被誤讀為 `2235842549`
3. **數據錯位**：Row 25 深度/台面數值調轉
4. **過度自信**：未經人工核對就提交結果

### 🔍 根本原因
- **字體問題**：PDF 使用特殊字體，兩個 V 字黐埋睇落似 W
- **工具限制**：pypdf/pdfplumber/Tesseract OCR 都無法 100% 準確識別
- **缺乏驗證**：無逐行對照原始文件

### ✅ 解決方案
1. **截圖對照**：提取後必須截圖逐行核對關鍵數據
2. **雙重驗證**：證書號碼、淨度、重量等關鍵欄位必須人工確認
3. **用戶確認**：提交前主動要求用戶抽查驗證

### 📌 教訓
> **自動提取只做 80%，關鍵數據必須人工核對**

特別注意：
- 證書號碼（唯一識別）
- 價格/重量（影響價值）
- 淨度/顏色（分級標準）

---

*Last Updated: 2026-04-26*

---

## 2026-04-26 - Knowledge Ingester Timeout 問題

### 📋 背景
Knowledge Base Daily Ingest cron job (每日 06:00) 長期 timeout，timeout 設定 300 秒但依然爆錶。

### ❌ 問題
1. **CLI Hang**：Cron job 用 `execSync` 調用 `openclaw message read` CLI 時完全 hang
2. **JSON Parse Error**：OpenClaw CLI 輸出既 JSON 含有未轉義字符 (`Unterminated string at position 59111`)
3. **isolated Session 限制**：Cron job 行喺 isolated session，冇 `message tool` 权限，只能用 CLI
4. **Delivery Notification 失敗**：cron job delivery mode 設為 "announce" 但 channel 係 "heartbeat" (唔支援)

### 🔍 根本原因
- **架構問題**：`execSync` + CLI 需要 CLI 本身有獨立認證，但 isolated session 環境下 CLI hang
- **認證問題**：OpenClaw CLI 喺 isolated session 需要單獨既 Discord Bot Token
- **Config 問題**：cron job delivery 預設 "last" channel，但 "heartbeat" 唔支援 announce

### ✅ 解決方案
1. **v2.4 重構**：將 `execSync` 改為直接使用 `discord.js REST API`
   ```javascript
   const { REST } = require('@discordjs/rest');
   const { Routes } = require('discord-api-types/v10');
   const rest = new REST({ version: '10' }).setToken(CONFIG.DISCORD_BOT_TOKEN);
   ```
2. **讀取 OpenClaw Config Bot Token**：從 OpenClaw config 讀取已配置既 bot token
3. **修復 Delivery**：將 delivery channel 改為 `discord:1473376125584670872` (#⚙️系統)

### 📌 教訓
> **遇到 "CLI hang / timeout" 問題時，優先考慮用 SDK/API 取代 execSync + CLI**

特別注意：
- Isolated session 環境下 CLI 可能需要獨立認證
- Discord Bot Token 可以從 OpenClaw config 共享
- Cron job delivery channel 必須明確指定，唔好用 "last"

### 🔧 技術細節
| 組件 | 問題 | 修復 |
|------|------|------|
| `knowledge_ingester.js` | execSync + CLI hang | 改用 discord.js REST API |
| `knowledge_ingester.js` | JSON parse error | 直接用 REST API 結構化回傳 |
| Cron Job delivery | channel="heartbeat" | 改為 discord:1473376125584670872 |
| Cron Job timeout | 300秒唔夠 | 加大到 600秒 |
