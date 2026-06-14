# HA Config - Tailscale 連線資料
# 雙方都需要呢啲資料做 SSH 互相訪問
# Last Updated: 2026-03-12

## Mac A - Ally (主力對話機)
- **Tailscale IP:** [TAILSCALE_ALLY_IP]
- **Hostname:** Mac-mini
- **SSH User:** ally
- **SSH Password:** [SSH_PASSWORD_REDACTED]
- **Location:** Home

## Mac B - Bliss (後勤機)
- **Tailscale IP:** [TAILSCALE_BLISS_IP]
- **Hostname:** MacBook-Neo
- **SSH User:** bliss
- **SSH Password:** [SSH_PASSWORD_REDACTED]
- **Location:** MacBook-Neo

## 連線測試
```bash
# From Ally to Bliss
sshpass -p '[SSH_PASSWORD_REDACTED]' ssh -o StrictHostKeyChecking=no bliss@[TAILSCALE_BLISS_IP] "command"

# From Bliss to Ally
sshpass -p '[SSH_PASSWORD_REDACTED]' ssh -o StrictHostKeyChecking=no ally@[TAILSCALE_ALLY_IP] "command"
```

## 狀態檢查
```bash
# Check Bliss from Ally
~/.openclaw/workspace/scripts/heartbeat.sh check-peer

# Check Ally from Bliss  
~/.openclaw/workspace/scripts/heartbeat.sh check-peer
```

## 緊急修復
如果其中一方死咗，可以 SSH 過去 restart：
```bash
# Mac A restart Mac B
sshpass -p '[SSH_PASSWORD_REDACTED]' ssh -o StrictHostKeyChecking=no bliss@[TAILSCALE_BLISS_IP] "/opt/homebrew/bin/openclaw gateway restart"

# Mac B restart Mac A
sshpass -p '[SSH_PASSWORD_REDACTED]' ssh -o StrictHostKeyChecking=no ally@[TAILSCALE_ALLY_IP] "/opt/homebrew/bin/openclaw gateway restart"
```
