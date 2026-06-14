# log_to_daily_memory.js 對話記錄分析報告

**生成時間：** 2026-04-08 02:10 HKT  
**分析目標：** 點樣改為記錄真正對話內容

---

## 1. 目前問題

### 目前 log_to_daily_memory.js 讀取嚟源

| Source | 內容 | 問題 |
|--------|------|------|
| `~/.openclaw/agents/main/sessions/*.jsonl` | Session logs | ✅ 有真正對話 |
| `tail -n 20` 每個 session | 最近 20 行 | ⚠️ 只能睇尾部 |

### 實際 logged 內容（睇 daily_memory.log）

```
✅ Logged: [MAIN]: ✅ Logged: [MAIN]: (no output)
✅ Logged: [MAIN]: 所有四個檔案已完成修復。
✅ Logged: [MAIN]: [cron:2f9b5b1c-328a-4589-8f4b-a33a7ec387d5 System Check...]
✅ Logged 5 message(s) from sessions
```

**問題：** 記錄咗 cron job output 同 system messages，唔係真正嘅 user/assistant 對話！

---

## 2. 真正對話嘅來源

### Session JSONL 格式分析

每個 `.jsonl` 檔案包含多個 `{"type":"message", ...}` 記錄：

```json
{"type":"message","id":"xxx","parentId":"xxx","timestamp":"...","message":{"role":"assistant","content":[...]}}
```

### 真實對話存在嘅位置

從 session logs 抽出嘅真實對話例子：

```
User: "用Kimi Code CLI檢查下同error_tracker有關連..."
Assistant: "✅ 已 spawn Kimi sub-agent..."
```

```
User: "## 任務：修復 error_tracker.js Async/Sync 混用問題"
Assistant: "<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>..."
```

### Discord 對話來源

目前 Discord 對話係通過 OpenClaw gateway 處理：
- Discord message → OpenClaw gateway → agent session
- Session logs 入面有 `sender_id`、`conversation_label` 等 metadata
- 但呢啲係作為 system context，唔係直接記錄

### 有冇 Discord channel logger？

```bash
ls -la ~/.openclaw/workspace/logs/discord_channel_logger.json
# ❌ 不存在
```

**結論：** Discord 對話唔係單獨 logging，全部通過 OpenClaw session 管理。

---

## 3. 問題分析

### 為乜而家記錄唔到真正對話？

1. **Skip patterns 太 aggressive**
   ```javascript
   const skipPatterns = [
     '✅ Logged:',           // 自己 output
     '📝 記錄了',
     'Logged 5 message',    // summary output
     'HEARTBEAT_OK',
     'NO_REPLY',
     // ... 更多
   ];
   ```
   呢啲 skip patterns 跳過嘅係 output，但真正問題係讀取咗 cron messages。

2. **Cron trigger messages 係 user role**
   ```json
   {"role":"user","content":"[cron:3ad2bf02-0cbb-4ae7-... Daily Memory Logger]..."}
   ```
   Cron jobs 以 `user` role 出現，被當成真正用戶輸入！

3. **真正對話被稀釋**
   每個 cron run 產生 5 條 messages，全部係 system 內容
   真正 user/assistant 對話被淹沒喺 system messages 入面

4. **只讀取 tail -n 20**
   - 最新嘅 session 可能只有 cron output
   - 真正嘅對話喺早期嘅 messages

---

## 4. 建議修改方案

### Option A: 從 Discord gateway logs 直接提取 ⭐（推薦）

**原理：** Discord 對話有獨立 logs，可以直接讀取。

```javascript
// Discord gateway logs
const DISCORD_GATEWAY_LOG = '/Users/ally/.openclaw/logs/gateway.log';
```

**好處：**
- 直接記錄 Discord 原始消息
- 包含 sender info、channel、timestamp
- 唔會被 cron jobs 干擾

**壞處：**
- Gateway log 格式複雜，需要 parsing
- 唔包含 assistant responses（喺 session logs）

**實作：**
```javascript
async function extractDiscordMessages() {
  const logFile = '/Users/ally/.openclaw/logs/gateway.log';
  const content = fs.readFileSync(logFile, 'utf8');
  const lines = content.split('\n');
  
  // 找 Discord messages
  const discordMsgs = lines
    .filter(line => line.includes('discord') && line.includes('content'))
    .map(line => parseDiscordMessage(line))
    .filter(msg => !msg.isSystem);
  
  return discordMsgs;
}
```

---

### Option B: 修改 skipPatterns + 改變讀取策略 ⭐（最易實作）

**原理：** 加強 skip patterns + 讀取更多行數

**好處：**
- 最少代碼改動
- 利用現有架構

**壞處：**
- 需要不斷更新 skip patterns
- 仍然可能漏掉真正對話

**具體改動：**

```javascript
// 1. 新增 skip patterns
const skipPatterns = [
  // ... 現有 patterns ...
  
  // Cron trigger patterns
  '[cron:',           // Cron job triggers
  'Daily Memory Logger',
  'System Check',
  'Code Quality Manager',
  'HEARTBEAT',
  
  // System messages
  '📝 Daily Memory Logger',
  '✅ Logged: [MAIN]:',
  '✅ Logged 5 message',
  '<final>',           // Stream markers
  '<<<BEGIN_',        // Subagent results
  '<<<END_',
  'NO_REPLY',
  
  // Discord metadata (唔係真正對話)
  'Conversation info',
  'Sender (untrusted',
  'UNTRUSTED content',
  '<<<EXTERNAL_',
];

// 2. 改變讀取策略 - 唔只讀 tail
// 讀取整個檔案但只過濾有真正 content 嘅 messages
// 或者讀取 head + tail
```

---

### Option C: 創建 Discord channel logger ⭐⭐（最完整）

**原理：** 创建独立嘅 Discord 對話 logger

**好處：**
- 完全分離 concerns
- 可以記錄完整對話（user + assistant）
- 唔會被 cron jobs 干擾

**壞處：**
- 需要創建新嘅 logger script
- 需要調整現有 workflow

**實作：**

```javascript
// scripts/discord_channel_logger.js
// 獨立 process，監聽 Discord messages 並寫入 logs

async function logDiscordMessage(message) {
  const logFile = `~/.openclaw/workspace/logs/discord/YYYY-MM-DD.jsonl`;
  
  const entry = {
    timestamp: new Date().toISOString(),
    channelId: message.channelId,
    senderId: message.senderId,
    senderName: message.senderName,
    content: message.content,
    role: 'user'  // or 'assistant'
  };
  
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
}
```

然後修改 `log_to_daily_memory.js` 讀取呢個 log。

---

## 5. 最佳方案推薦

### 推薦：Option B（立即可做）+ Option C（長遠）

**短期（Option B）：**
1. 修改 skipPatterns，加入 cron trigger patterns
2. 改變讀取策略，過濾 system messages
3. 加入 sender/role 識別

**長期（Option C）：**
1. 創建 `discord_channel_logger.js`
2. 獨立記錄 Discord 對話
3. `log_to_daily_memory.js` 讀取呢個 log

---

## 6. 具體 Code Changes

### Option B - 立即可做

```javascript
// scripts/log_to_daily_memory.js

// 新增 skip patterns
const SYSTEM_SKIP_PATTERNS = [
  // Cron triggers
  '[cron:',
  'Daily Memory Logger',
  'System Check',
  'Code Quality Manager',
  
  // Internal outputs
  '✅ Logged: [MAIN]:',
  '✅ Logged 5 message',
  '📝 Daily Memory Logger',
  '<final>',
  'NO_REPLY',
  
  // Meta messages
  '[Internal task completion',
  'conversation_info',
  'sender_id',
  'UNTRUSTED',
  '<<<EXTERNAL_',
  '<<<BEGIN_UNTRUSTED',
  '<<<END_UNTRUSTED',
  
  // Subagent results
  '<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>',
  'Stats:',
  'Action:',
];

// 改變 message 識別邏輯
function isRealConversation(msgContent) {
  // Skip if matches any system pattern
  for (const pattern of SYSTEM_SKIP_PATTERNS) {
    if (msgContent.includes(pattern)) return false;
  }
  
  // Skip if contains only special characters
  if (/^[\s\n\r\t]*$/.test(msgContent)) return false;
  
  // Skip if too short (< 10 chars)
  if (msgContent.trim().length < 10) return false;
  
  // Skip if looks like JSON metadata
  if (msgContent.trim().startsWith('{') && 
      (msgContent.includes('"message_id"') || 
       msgContent.includes('"sender_id"'))) {
    return false;
  }
  
  return true;
}

// 讀取更多 lines
let recentLines = [];
try {
  const tailOutput = execSync(`tail -n 50 "${filePath}"`, { ... });  // 改為 50
  recentLines = tailOutput.split('\n').filter(l => l.trim()).slice(-30);  // 讀 30 行
} catch (e) { ... }
```

---

## 7. 總結

| 問題 | 原因 | 解決方案 |
|------|------|----------|
| 記錄 cron output | cron jobs 以 user role 出現 | 加 skipPatterns |
| 記錄 system messages | skipPatterns唔夠全面 | 擴展 skipPatterns |
| 真正對話被稀釋 | 只讀 tail，cron 產生大量 noise | 改變識別邏輯 |
| Discord 對話唔完整 | 全部通過 session | 考慮創建獨立 logger |

**下一步：**
1. 實施 Option B（立即可做）
2. 評估是否需要 Option C（長遠方案）

---

*Generated: 2026-04-08 | Subagent Analysis*
