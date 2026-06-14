# HA 雙機架構設定指南 (OpenClaw High Availability)

*建立日期：2026-03-11*
*最後更新：2026-03-11*

---

## 📋 目錄

1. [系統概覽](#系統概覽)
2. [事前準備](#事前準備)
3. [Tailscale 安裝](#tailscale-安裝)
4. [SSH 設定](#ssh-設定)
5. [HA Coordinator 設定](#ha-coordinator-設定)
6. [Cron Job 設定](#cron-job-設定)
7. [測試與驗證](#測試與驗證)
8. [疑難排解](#疑難排解)

---

## 系統概覽

### 架構

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaw HA 雙機                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   Ally (主力對話)                    Bliss (後勤)         │
│   ┌─────────────┐                ┌─────────────┐         │
│   │  Discord   │◄─── Tailscale ──►│  Stock     │         │
│   │  Signal    │    VPN (100.x)   │  L1 Gen    │         │
│   │  WhatsApp  │                  │  Cron      │         │
│   │  Browser   │                  │            │         │
│   └─────────────┘                └─────────────┘         │
│                                                          │
│   Primary: 對話                   Primary: 後勤           │
│   Failover: 後勤                  Failover: 對話          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### IP 資料

| Node | Local IP | Tailscale IP | SSH User | SSH Password |
|------|----------|--------------|----------|--------------|
| Ally | [LOCAL_ALLY_IP] | [TAILSCALE_ALLY_IP] | ally | [SSH_PASSWORD_REDACTED] |
| Bliss | [LOCAL_BLISS_IP] | [TAILSCALE_BLISS_IP] | bliss | [SSH_PASSWORD_REDACTED] |

---

## 事前準備

### 1. 確認兩部 Mac 都安裝咗 OpenClaw

```bash
which openclaw
# 應該顯示 /opt/homebrew/bin/openclaw
```

### 2. 確認 Homebrew 可用

```bash
brew --version
```

### 3. 確認 SSH keys 可用

```bash
ls ~/.ssh/
```

---

## Tailscale 安裝

### Step 1: 安裝 Tailscale (兩部機都要)

```bash
brew install tailscale
```

### Step 2: 啟動 Tailscale 服務

```bash
sudo brew services start tailscale
```

### Step 3: 登入 Tailscale (兩部機用同一個帳號)

```bash
sudo tailscale up
```

會顯示一個 URL，用瀏覽器打開並登入（Google/Microsoft/GitHub都用得）。

### Step 4: 獲取 Tailscale IP

```bash
tailscale ip -4
```

**記錄低呢個 IP，稍後會用到。**

---

## SSH 設定

### 方法 1: 使用密碼（推薦新手）

#### 確保 Remote Login 開啟

**Ally 機：**
1. Apple Menu → System Settings → General → Sharing
2. 開啟 "Remote Login"

**或者用 Terminal：**
```bash
sudo systemsetup -setremotelogin on
```

#### 測試 SSH 連線

```bash
# 從 Ally 連到 Bliss
ssh bliss@<BLISS_TAILSCALE_IP>

# 從 Bliss 連到 Ally
ssh ally@<ALLY_TAILSCALE_IP>
```

### 方法 2: 使用 SSH Key（更安全，推薦長期使用）

```bash
# Ally 生成 SSH Key (如果未有)
ssh-keygen -t ed25519

# Copy 到 Bliss
ssh-copy-id bliss@<BLISS_TAILSCALE_IP>

# 同樣從 Bliss copy 到 Ally
ssh-copy-id ally@<ALLY_TAILSCALE_IP>
```

---

## HA Coordinator 設定

### Step 1: 創建 HA 共享資料夾

**兩部機都要執行：**

```bash
mkdir -p ~/Desktop/OpenClaw-HA-Shared/ally-state
mkdir -p ~/Desktop/OpenClaw-HA-Shared/bliss-state
mkdir -p ~/Desktop/OpenClaw-HA-Shared/shared
```

### Step 2: 獲取 HA Coordinator Script

從有嘅機 copy 或者 create 新既：

```bash
# 位置
~/.openclaw/workspace/scripts/ha_coordinator_ssh.sh
```

### Step 3: 配置 Script

編輯 `ha_coordinator_ssh.sh`，修改以下部分：

```bash
# Tailscale IPs (remote access)
if [ "$NODE_ID" = "ally" ]; then
    MY_IP="<ALLY_TAILSCALE_IP>"
    PEER_IP="<BLISS_TAILSCALE_IP>"
    PEER_PASS="<BLISS_SSH_PASSWORD>"
else
    MY_IP="<BLISS_TAILSCALE_IP>"
    PEER_IP="<ALLY_TAILSCALE_IP>"
    PEER_PASS="<ALLY_SSH_PASSWORD>"
fi
```

### Step 4: 複製到兩部機

```bash
# Copy 到 Bliss
scp ~/.openclaw/workspace/scripts/ha_coordinator_ssh.sh bliss@<BLISS_TAILSCALE_IP>:~/.openclaw/workspace/scripts/
```

### Step 5: 設定執行權限

```bash
chmod +x ~/.openclaw/workspace/scripts/ha_coordinator_ssh.sh
```

---

## Cron Job 設定

### Ally (每5分鐘 heartbeat)

```bash
# 編輯 crontab
crontab -e

# 加入呢行
*/5 * * * * export HA_NODE_ID=ally && export HA_PEER_ID=bliss && $HOME/.openclaw/workspace/scripts/ha_coordinator_ssh.sh heartbeat >> /tmp/ha_heartbeat.log 2>&1
```

### Bliss (每5分鐘 heartbeat)

```bash
# 登入 Bliss
ssh bliss@<BLISS_TAILSCALE_IP>

# 編輯 crontab
crontab -e

# 加入呢行
*/5 * * * * export HA_NODE_ID=bliss && export HA_PEER_ID=ally && $HOME/.openclaw/workspace/scripts/ha_coordinator_ssh.sh heartbeat >> /tmp/ha_heartbeat.log 2>&1
```

---

## 測試與驗證

### 1. 手動發送 Heartbeat

```bash
# Ally 發送
export HA_NODE_ID=ally && export HA_PEER_ID=bliss && ~/.openclaw/workspace/scripts/ha_coordinator_ssh.sh heartbeat

# Bliss 發送
export HA_NODE_ID=bliss && export HA_PEER_ID=ally && ~/.openclaw/workspace/scripts/ha_coordinator_ssh.sh heartbeat
```

### 2. 檢查狀態

```bash
export HA_NODE_ID=ally && export HA_PEER_ID=bliss && ~/.openclaw/workspace/scripts/ha_coordinator_ssh.sh status
```

應該顯示：
- Ally: 🟢 alive
- Bliss: 🟢 Online

### 3. 檢查 Heartbeat 檔案

```bash
# Ally 本地
cat ~/Desktop/OpenClaw-HA-Shared/bliss-state/heartbeat.json

# 從 Ally 檢查 Bliss
ssh bliss@<BLISS_TAILSCALE_IP> "cat ~/Desktop/OpenClaw-HA-Shared/ally-state/heartbeat.json"
```

---

## 疑難排解

### ❌ Tailscale SSH 連線失敗

**檢查 Tailscale 狀態：**
```bash
tailscale status
```

**確保 Tailscale 運行：**
```bash
sudo tailscale up
```

### ❌ SSH Permission Denied

**檢查密碼是否正確**
**確保 Remote Login 開啟：**
```bash
sudo systemsetup -getremotelogin
```

### ❌ iCloud Sync 衝突 (resource deadlock)

**解決方法：**
- 放棄 iCloud sync
- 改用 SSH 直接讀取對方 heartbeat（目前方法）

### ❌ Cron Job 唔運作

**檢查日誌：**
```bash
tail -f /tmp/ha_heartbeat.log
```

**手動測試：**
```bash
$HOME/.openclaw/workspace/scripts/ha_coordinator_ssh.sh heartbeat
```

---

## 📝 重要提醒

1. **Tailscale 必須保持登入** - 如果 logout，VPN 會斷線
2. **Remote Login 必須開啟** - 雙向 SSH 都需要
3. **密碼要記錄低** - 設定 script 要用到
4. **定期檢查狀態** - 用 `ha_coordinator_ssh.sh status`

---

## 🔧 相關檔案位置

```
~/.openclaw/workspace/
├── scripts/
│   ├── ha_coordinator_ssh.sh       # 主要 HA script
│   └── ha_coordinator.js           # 舊版 (iCloud)
├── SOUL.md                          # Bot 身份定義
├── AGENTS.md                        # 行為準則
├── IDENTITY.md                      # 網絡身份
└── TOOLS.md                         # 工具指南

~/Desktop/OpenClaw-HA-Shared/
├── ally-state/
│   └── heartbeat.json
├── bliss-state/
│   └── heartbeat.json
└── shared/
    └── failover-mode.json
```

---

## ✅ Setup Checklist

- [ ] 兩部機安裝 Tailscale
- [ ] Tailscale 登入同一帳號
- [ ] 獲取並記錄 Tailscale IPs
- [ ] 開啟 Remote Login (兩部機)
- [ ] 測試 SSH 連線 (雙向)
- [ ] 創建 HA 共享資料夾
- [ ] 設定 ha_coordinator_ssh.sh
- [ ] 設定 Cron Jobs
- [ ] 測試 Heartbeat
- [ ] 驗證 Status

---

*建立者: Ally (2026-03-11)*
*用途: OpenClaw HA 雙機快速設定參考*
