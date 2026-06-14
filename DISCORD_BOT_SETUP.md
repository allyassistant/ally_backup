# Discord Bot 從頭設定指南 (OpenClaw 用)

*建立日期：2026-03-11*

---

## 📋 目錄

1. [Discord Developer Portal - 創建 Bot](#1-discord-developer-portal---創建-bot)
2. [設定 Bot Permissions](#2-設定-bot-permissions)
3. [邀請 Bot 加入 Server](#3-邀請-bot-加入-server)
4. [獲取 Token](#4-獲取-token)
5. [設定 OpenClaw Config](#5-設定-openclaw-config)
6. [常見問題](#常見問題)

---

## 1. Discord Developer Portal - 創建 Bot

### Step 1: 去 Discord Developer Portal
```
https://discord.com/developers/applications
```

### Step 2: 登入
用你既 Discord 帳號登入。

### Step 3: 創建 New Application
1. 點右上角 **"New Application"**
2. 輸入名稱（例如：`OpenClaw-Ally` 或者 `OpenClaw-Bliss`）
3. 同意 Terms of Service
4. 點 **"Create"**

### Step 4: 創建 Bot
1. 左手邊菜單，點 **"Bot"**
2. 點 **"Add Bot"**
3. 確認 **"Yes, do it!"**
4. Bot 創建成功！

---

## 2. 設定 Bot Permissions

### 方法 1: 快速設定（推薦）

1. 喺 Bot 頁面，向下滑見到 **"Bot Permissions"**
2. 選擇你需要既權限：

**Essential Permissions (必需):**
- ✅ View Channels (睇 channel)
- ✅ Send Messages (發訊息)
- ✅ Read Message History (讀訊息歷史)
- ✅ Use Slash Commands (用斜線指令)
- ✅ Manage Threads (管理 thread)
- ✅ Embed Links (嵌入連結)
- ✅ Attach Files (上傳檔案)

**Advanced Permissions (進階):**
- ✅ Manage Messages (管理訊息)
- ✅ Mention Everyone (提 everyone)
- ✅ Manage Roles (管理角色)
- ✅ Move Members (移動成員)

3. 選擇完後，向下滑會見到 **"Generate OAuth2 URL"**
4. 撳 **"Copy"** 複製嗰個 URL

### 方法 2: 精確權限

1. 左手邊菜單，點 **"OAuth2"** → **"URL Generator"**
2. **Scopes** (勾選):
   - ✅ `bot`
   - ✅ `applications.commands`

3. **Bot Permissions** (勾選):
   - ✅ Administrator (如果想要全部權限)
   
   或者精確選擇：
   - ✅ View Channels
   - ✅ Send Messages
   - ✅ Read Message History
   - ✅ Use Slash Commands
   - ✅ Manage Messages
   - ✅ Embed Links
   - ✅ Attach Files
   - ✅ Manage Threads
   - ✅ Use External Emojis
   - ✅ Use External Stickers
   - ✅ Add Reactions

4. 向下滾，Copy **"Generated URL"**

---

## 3. 邀請 Bot 加入 Server

### Step 1: 用 Invite URL
1. 瀏覽器度開啟你 generate 既 URL
2. 選擇你要加入既 Discord Server
3. 點 **"Authorize"**
4. 驗證人類（reCAPTCHA）

### Step 2: 確認加入成功
1. 去你既 Discord Server
2. 確認 Bot 出現在成員列表（右手邊）

### Step 3: 設定 Channel 權限（如果需要）
1. Server Settings → **Channels**
2. 揀一個 Channel → **Edit Channel**
3. 點 **"Permissions"** → **"Advanced Permissions"**
4. 加入 Bot 角色，設定權限

---

## 4. 獲取 Token

### ⚠️ 重要：Token 必須保密！

1. 喺 Bot 頁面，向上看見 **"Token"** 區域
2. 點 **"Reset Token"**（如果從未獲取）
3. 點 **"Copy"** 複製 Token

**注意：**
- 唔好公開呢個 Token
- 任何人有咗呢個 Token 都可以控制你既 Bot

### 如果 token 唔小心公開點算？
1. 立即 Reset Token
2. 將新 Token 放入 OpenClaw config

---

## 5. 設定 OpenClaw Config

### 方法 A: 透過 Terminal（直接修改）

1. 開啟 config 檔案：
```bash
nano ~/.openclaw/openclaw.json
```

2. 找到 `"discord"` 區域，修改 `token`：

```json
"discord": {
  "enabled": true,
  "token": "YOUR_NEW_TOKEN_HERE",
  "groupPolicy": "allowlist",
  "guilds": {
    "1473343323124011182": {
      "channels": {
        "1473343330170572904": {
          "allow": true
        },
        "1473376125584670872": {
          "allow": true
        }
        // ... 其他 channels
      }
    }
  }
}
```

3. **保存並退出** (Ctrl+O, Enter, Ctrl+X)

4. Restart OpenClaw：
```bash
openclaw gateway restart
```

### 方法 B: 透過 Web UI

1. 去 http://localhost:18789
2. 點 **Settings** → **Channels**
3. 找到 Discord，輸入新 Token
4. Save

---

## 6. 常見問題

### ❌ "Invalid Token"
- 檢查 Token 有冇 copy 正確
- 確保冇多餘既空格

### ❌ "Bot is not in the server"
- 用正確既 OAuth2 URL 邀請
- 確認你有 Admin 權限

### ❌ "Missing Permissions"
- 去 Server Settings → Members
- 確認 Bot 有足夠權限

### ❌ "Channel not found"
- 確保 Channel ID 正確
- Bot 必須要能夠睇到個 Channel

### ❌ "Bot 只 respond 一個 channel"
- 檢查 `guilds.channels` 設定
- 每個 channel 都要加入去

---

## 🔧 快速 Reference

### Channel ID 點樣獲取？
1. 打開 Discord Desktop App
2. 開啟 Developer Mode: 
   - User Settings → Advanced → **Developer Mode: ON**
3. Right-click channel → **Copy Channel ID**

### Guild ID 點樣獲取？
1. 打開 Developer Mode
2. 對住 Server 名稱 → Right-click → **Copy Server ID**

### 測試 Bot
@mention the bot in any channel:
```
@YourBotName test
```

---

## 📝 Checklist

- [ ] 創建 Discord Application
- [ ] 創建 Bot User
- [ ] 設定 Permissions
- [ ] 生成 OAuth2 URL
- [ ] 邀請 Bot 加入 Server
- [ ] 確認 Bot 在 Server 內
- [ ] 獲取並保存 Token
- [ ] 設定 OpenClaw Config
- [ ] Restart OpenClaw
- [ ] 測試 Bot 回應

---

*建立者: Ally (2026-03-11)*
