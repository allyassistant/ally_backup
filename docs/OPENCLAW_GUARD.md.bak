# OpenClaw Guard - 升級保護方案

防止 OpenClaw 升級後出現故障嘅備份/回滾系統。

## 快速開始

### 1. 手動創建備份（升級前必做）
```bash
cd /Users/ally/.openclaw/workspace
./scripts/openclaw_guard.sh backup
```

### 2. 升級 OpenClaw
```bash
openclaw update
# 或者
openclaw gateway restart
```

### 3. 檢查是否正常
```bash
./scripts/openclaw_guard.sh health
```

如果有問題：
```bash
./scripts/openclaw_guard.sh restore
```

---

## 自動保護（推薦）

### 設定自動備份（每日一次）
```bash
# 編輯 crontab
crontab -e

# 添加以下行（每日凌晨 3 點備份）
0 3 * * * /Users/ally/.openclaw/workspace/scripts/openclaw_guard.sh auto >> /Users/ally/.openclaw/workspace/memory/backup.log 2>>1
```

### 設定看門狗（每 5 分鐘檢查一次）
```bash
# 編輯 crontab
crontab -e

# 添加以下行
crontab -l > /tmp/mycron
echo "*/5 * * * * /Users/ally/.openclaw/workspace/scripts/openclaw_guard.sh health >> /Users/ally/.openclaw/workspace/memory/health.log 2>>1" >> /tmp/mycron
crontab /tmp/mycron
rm /tmp/mycron
```

---

## 命令參考

| 命令 | 說明 |
|------|------|
| `backup` | 創建完整備份 |
| `restore` | 從備份還原 |
| `status` | 顯示當前狀態 |
| `health` | 運行健康檢查 |
| `fix` | 嘗試自動修復 |
| `auto` | 自動備份+健康檢查 |

---

## 備份包含咩？

- ✅ Git repo 完整歷史
- ✅ MEMORY.md、AGENTS.md 等重要文件
- ✅ scripts/ 目錄（所有腳本）
- ✅ memory/ 目錄（每日記錄）
- ✅ public/ 目錄（GitHub Pages 文件）
- ✅ 版本信息（Node、OpenClaw 版本）

---

## 故障處理流程

### 情景 1: 升級後 OpenClaw 啟動唔到
```bash
# 1. 檢查狀態
./scripts/openclaw_guard.sh status

# 2. 還原到上次備份
./scripts/openclaw_guard.sh restore

# 3. 手動重啟
openclaw gateway restart
```

### 情景 2: 重要文件被改壞
```bash
# 直接還原
./scripts/openclaw_guard.sh restore
```

### 情景 3: 想睇下有冇備份
```bash
./scripts/openclaw_guard.sh status
```

---

## 作者原文啟示

> 「別再寫更長的規則文件了。開始寫執行 Code Hook 吧。」

呢個腳本就係一個「Code Hook」—— 無論 AI 點改文件，你都有退路。

**核心原則：**
1. **備份先行** - 任何升級前先備份
2. **自動化** - 用 cron 定期檢查
3. **快速回滾** - 一條命令還原

---

## 檢查清單（升級前）

- [ ] 運行 `./scripts/openclaw_guard.sh backup`
- [ ] 確認備份成功（睇 `status`）
- [ ] 記低當前版本號
- [ ] 升級 OpenClaw
- [ ] 升級後運行 `health` 檢查
- [ ] 測試基本功能（發 WhatsApp、查資料等）

如果全部通過 ✅，升級成功！
如果有問題 ❌，運行 `restore` 回滾。