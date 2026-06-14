# Bliss Backend System - Maintenance Guide
# 每日自動維護系統 (Heartbeat 驅動) - Updated 2026-03-29

## Bliss 角色
- **Primary Role:** 後勤支援 (Backend Helper)
- **Responsibilities:** Stock processing, backend cron jobs, data management
- **Heartbeat:** 每分鐘寫入 `ha-state/bliss/heartbeat.json`

## Crontab 設定

```bash
# Heartbeat - 每分鐘 (Ally/Bliss 雙方都有)
*/1 * * * * export PATH=... && export NODE_ID=bliss && ~/.openclaw/workspace/scripts/heartbeat.sh

# Failover Detector - 每3分鐘 (Ally/Bliss 雙方都有)
*/3 * * * * export PATH=... && export NODE_ID=bliss && ~/.openclaw/workspace/scripts/failover_detector.sh

# Backend Jobs
30 9 * * * node scripts/daily_weather.js          # 每日天氣
*/30 * * * * node scripts/monitor_apple_refurbished.js  # Apple 翻新機監控
```

## 主要 Scripts

| Script | 用途 | 頻率 |
|--------|------|------|
| `heartbeat.sh` | HA Heartbeat 寫入 | 每分鐘 |
| `failover_detector.sh` | HA 狀態檢測 + 通知 | 每3分鐘 |
| `daily_weather.js` | 每日天氣報告 | 09:30 |
| `monitor_apple_refurbished.js` | Apple 翻新機價格監控 | 每30分鐘 |

## HA 同步 (SSH Direct)

Bliss 透過 Tailscale SSH 直接同步狀態：
- **寫入:** `~/.openclaw/workspace/ha-state/bliss/heartbeat.json`
- **讀取:** `~/.openclaw/workspace/ha-state/ally/heartbeat.json`

## 已停用 Scripts (唔需要跑)

以下喺 Mac A 跑但 Bliss 唔需要：
- `daily_maintenance.js` (Mac A 主要負責)
- `weekly_parallel.js` (Mac A 主要負責)
- `l0_generator.js` / `l1_generator.js` (Mac A 主要負責)
- `discord_channel_logger.js` (Mac A 主要負責)

## Backup & Sync

| 項目 | Mac A | Bliss |
|------|-------|-------|
| Qwen3 Knowledge | ❌ | ✅ 同步俾 Mac A |
| Session Cleanup | ✅ | ❌ |
| Stock Processing | ✅ | ✅ (Ally 主要) |

## Quick Reference

```bash
# 檢查 Bliss 狀態
ssh bliss@[TAILSCALE_BLISS_IP] 'cat ~/.openclaw/workspace/ha-state/bliss/heartbeat.json'

# 手動跑 heartbeat
ssh bliss@[TAILSCALE_BLISS_IP] '~/.openclaw/workspace/scripts/heartbeat.sh'

# 檢查 Failover 狀態
ssh bliss@[TAILSCALE_BLISS_IP] '~/.openclaw/workspace/scripts/failover_detector.sh'

# 檢查 Cron 狀態
ssh bliss@[TAILSCALE_BLISS_IP] 'crontab -l'
```
