# 自動歸檔系統設置完成

## 系統概覽

已設置**雙重保障**自動歸檔系統：

### 1. OpenClaw Cron (主要)
- **ID**: `e8ba74bb-7cce-45df-a674-c3f282229d76`
- **名稱**: Daily Memory Archive
- **時間**: 每天 00:00 (Asia/Hong_Kong)
- **動作**: 觸發 Heartbeat，執行 `node scripts/archive_smart.js`
- **狀態**: ✅ 已啟用

**查看命令**:
```bash
openclaw cron list
openclaw cron runs  # 查看執行歷史
```

### 2. macOS Launchd (備份)
- **Label**: `ai.openclaw.daily-archive`
- **時間**: 每天 00:00
- **動作**: 直接執行 `node scripts/archive_smart.js`
- **狀態**: ✅ 已加載

**管理命令**:
```bash
# 查看狀態
launchctl list | grep openclaw

# 手動啟動
launchctl start ai.openclaw.daily-archive

# 停止
launchctl stop ai.openclaw.daily-archive

# 重新加載
launchctl unload ~/Library/LaunchAgents/ai.openclaw.daily-archive.plist
launchctl load ~/Library/LaunchAgents/ai.openclaw.daily-archive.plist
```

---

## 歸檔規則

```
_daily/ 內超過 2 天的文件 → 自動移到 _archive/
```

**例子**:
- 今天是 2月1日
- `_daily/2026-01-31.md` → 保留 (1天)
- `_daily/2026-01-29.md` → 移到 `_archive/`

---

## 檔案位置

| 項目 | 位置 |
|------|------|
| 歸檔腳本 | `scripts/archive_smart.js` |
| Cron 腳本 | `scripts/archive_cron.js` |
| Launchd 配置 | `~/Library/LaunchAgents/ai.openclaw.daily-archive.plist` |
| 狀態記錄 | `memory/archive-state.json` |
| 執行日誌 | `~/.openclaw/logs/archive.log` |
| 錯誤日誌 | `~/.openclaw/logs/archive.err.log` |

---

## 其他 Cron Jobs

目前系統有 3 個定時任務：

| ID | 名稱 | 頻率 | 狀態 |
|----|------|------|------|
| 6cc75b13-... | Token Monitor | 每小時 | ✅ 運行中 |
| df7382f7-... | Daily Self-Learning | 每天 00:00 | ✅ 運行中 |
| e8ba74bb-... | Daily Memory Archive | 每天 00:00 | ✅ 運行中 |

---

## 故障排除

### 檢查歸檔是否運行
```bash
# 查看狀態檔案
cat memory/archive-state.json

# 查看日誌
cat ~/.openclaw/logs/archive.log
tail -f ~/.openclaw/logs/archive.log
```

### 手動執行歸檔
```bash
# 智能歸檔 (檢查今天是否已執行)
node scripts/archive_smart.js

# 強制歸檔 (無視時間限制)
node scripts/archive_daily.js
```

### 如果 OpenClaw Cron 失效
macOS Launchd 會繼續運行，確保歸檔不會中斷。

### 如果兩者都失效
手動執行：
```bash
cd ~/.openclaw/workspace
node scripts/archive_smart.js
```

---

## 設置時間
2026-02-01 00:20

## 下次歸檔
2026-02-03 00:00 (將歸檔 2月1日之前的文件)
