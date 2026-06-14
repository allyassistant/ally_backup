# 每週存儲復盤 - 設計方案

## 目標
建立每週自動復盤機制，確保：
- 文件系統健康
- 備份完整
- Token 使用合理
- 潛在問題及早發現

---

## 復盤頻率
- **標準**：每週一次（建議禮拜日 23:00）
- **觸發**：cron job + heartbeat 備份
- **手動**：用戶可隨時要求「執行復盤」

---

## 檢查清單

### 1. 文件位置檢查

#### 1.1 核心文件存在性
| 文件 | 路徑 | 檢查內容 |
|------|------|---------|
| MEMORY.md | `workspace/MEMORY.md` | 存在、可讀、大小合理 |
| AGENTS.md | `workspace/AGENTS.md` | 存在、可讀 |
| TOOLS.md | `workspace/TOOLS.md` | 存在、可讀 |
| SOUL.md | `workspace/SOUL.md` | 存在、可讀 |
| USER.md | `workspace/USER.md` | 存在、可讀 |

#### 1.2 Daily Notes 檢查
| 檢查項 | 標準 | 動作 |
|--------|------|------|
| 過去 7 日 | 每個日期都有檔案 | 缺失則警告 |
| 檔案大小 | > 0 bytes | 空檔案警告 |
| 命名格式 | `YYYY-MM-DD.md` | 錯誤格式警告 |

#### 1.3 重要數據文件
| 文件 | 路徑 | 檢查 |
|------|------|------|
| Diamond Stock | `memory/diamond_stock.json` | 存在、可解析 |
| Rapaport DB | `memory/rapaport_db.json` | 存在、可解析 |
| Contact DB | `memory/contact-database.json` | 存在（可選） |
| Backup Tracker | `memory/backup-status-tracker.json` | 存在、最新 |

---

### 2. 備份完整性檢查

#### 2.1 本地備份
```bash
# 檢查備份目錄
ls -la memory/backups/
```

| 檢查項 | 標準 | 動作 |
|--------|------|------|
| 備份數量 | 最少 7 份（每日） | 少於 7 警告 |
| 最新備份時間 | < 24 小時 | 過舊警告 |
| 備份大小 | 合理範圍（±20%） | 異常警告 |
| 備份可讀性 | 可解壓/可解析 | 損壞警告 |

#### 2.2 Apple Notes 備份驗證
```bash
# 檢查 Apple Notes 最近備份
osascript -e 'tell application "Notes" to count notes of folder "Ally\'s Notes"'
```

| 檢查項 | 標準 | 動作 |
|--------|------|------|
| 備份存在 | 最近 7 日有備份 | 缺失警告 |
| 內容驗證 | 非空 note | 空 note 警告 |
| 同步狀態 | iCloud 同步正常 | 延遲警告 |

#### 2.3 GitHub 備份（如有）
| 檢查項 | 標準 | 動作 |
|--------|------|------|
| 最後推送 | < 7 日 | 過舊提醒 |
| 倉庫狀態 | 無未提交更改 | 有更改則提交 |

---

### 3. Token 使用趨勢

#### 3.1 收集數據
```json
{
  "date": "2026-02-16",
  "sessions": [
    {
      "session_id": "xxx",
      "start_tokens": 0,
      "end_tokens": 45000,
      "duration_min": 120
    }
  ],
  "daily_total": 45000,
  "weekly_total": 285000
}
```

#### 3.2 趨勢分析
| 指標 | 計算 | 標準 |
|------|------|------|
| 每週平均 | 7 日總和 / 7 | 基準線 |
| 增長率 | (本週-上週) / 上週 | > 30% 警告 |
| 峰值日 | 最高用量日 | 分析原因 |
| 效率比 | tokens / 對話數 | 異常則調查 |

#### 3.3 警告閾值
| 情況 | 閾值 | 動作 |
|------|------|------|
| 單日異常高 | > 平均 2 倍 | 記錄原因 |
| 持續增長 | 連續 3 週增長 | 優化建議 |
| 效率下降 | 效率比 < 0.5 | 調查 |

---

### 4. 系統健康檢查

#### 4.1 Cron Jobs 狀態
```bash
# 檢查 cron jobs
openclaw cron list
```

| 檢查項 | 標準 | 動作 |
|--------|------|------|
| 所有 jobs 存在 | 無缺失 | 缺失警告 |
| 最後執行 | < 24 小時 | 過舊檢查 |
| 錯誤日誌 | 無新錯誤 | 有錯誤則報告 |

#### 4.2 Heartbeat 狀態
| 檢查項 | 標準 | 動作 |
|--------|------|------|
| 最後運行 | < 1 小時 | 檢查是否正常 |
| 檢查項目 | 全部完成 | 缺失項目警告 |

#### 4.3 磁碟空間
| 檢查項 | 標準 | 動作 |
|--------|------|------|
| 可用空間 | > 10GB | 低於警告 |
| 日誌大小 | < 1GB | 過大清理 |
| 備份大小 | < 5GB | 過大歸檔 |

---

## 輸出格式

### 復盤報告 (Markdown)
```markdown
# 每週存儲復盤報告

**日期**: 2026-02-16 (Week 07)
**執行**: Qwen3 (自動)

---

## 📊 執行摘要
| 項目 | 狀態 |
|------|------|
| 文件檢查 | ✅ 通過 |
| 備份驗證 | ⚠️ 1 個警告 |
| Token 趨勢 | ✅ 正常 |
| 系統健康 | ✅ 良好 |

**整體**: 🟢 健康

---

## 📁 文件位置檢查

### 核心文件
| 文件 | 狀態 | 大小 |
|------|------|------|
| MEMORY.md | ✅ | 52KB |
| AGENTS.md | ✅ | 8KB |
| ... | ... | ... |

### Daily Notes
| 日期 | 狀態 | 大小 |
|------|------|------|
| 2026-02-10 | ✅ | 2KB |
| 2026-02-11 | ✅ | 4KB |
| ... | ... | ... |

---

## 💾 備份完整性

### 本地備份
- 備份數量: 12 ✅
- 最新備份: 2026-02-16 03:00 ✅
- 平均大小: 45MB ✅

### Apple Notes
- 最近備份: 2026-02-15 ✅
- 備份數量: 7 ✅

⚠️ **警告**: 2026-02-14 備份內容較短，可能未完整

---

## 📈 Token 使用趨勢

### 本週統計
| 指標 | 數值 | 變化 |
|------|------|------|
| 總用量 | 285,000 | +5% |
| 日均 | 40,714 | +3% |
| 峰值日 | 2026-02-14 (65,000) | 原因: 大整理 |
| 效率比 | 1.2 | 正常 |

### 趨勢圖
```
Mon: ████████ 42K
Tue: ████████ 45K
Wed: ██████   35K
Thu: ████████████ 65K (峰值)
Fri: ██████   38K
Sat: ██████   35K
Sun: ██████   35K
```

---

## 🔧 系統健康

### Cron Jobs
| Job | 最後執行 | 狀態 |
|-----|---------|------|
| health_monitor | 2026-02-16 12:00 | ✅ |
| token_monitor | 2026-02-16 12:00 | ✅ |
| ... | ... | ... |

### 磁碟空間
- 可用: 45GB ✅
- 日誌: 120MB ✅
- 備份: 2.1GB ✅

---

## 📝 建議行動

1. **低優先**: 2026-02-14 Apple Notes 備份較短，可考慮手動補充
2. **資訊**: Token 使用平穩，無需調整

---

*報告生成: 2026-02-16 23:05*
*下次復盤: 2026-02-23*
```

---

## 通知方式

### 1. Apple Notes 存檔
```bash
# 自動創建 Note
osascript << 'EOF'
tell application "Notes"
    set theFolder to folder "Ally's Notes"
    set noteTitle to "每週復盤 - Week 07"
    set noteBody to "[復盤報告內容]"
    make new note at theFolder with properties {name:noteTitle, body:noteBody}
end tell
EOF
```

### 2. WhatsApp 通知
| 情況 | 通知內容 |
|------|---------|
| 全部正常 | 「✅ 本週復盤完成，系統健康」 |
| 有警告 | 「⚠️ 復盤完成，發現 X 個問題，詳見 Apple Notes」 |
| 有錯誤 | 「🔴 復盤發現問題，建議檢查 [具體問題]」 |

### 3. 本地日誌
```
memory/weekly-reports/
├── 2026-week-07.md
├── 2026-week-08.md
└── index.json
```

---

## 數據結構

### 復盤狀態追蹤
```json
{
  "last_review": "2026-02-16",
  "schedule": "weekly",
  "next_review": "2026-02-23",
  "history": [
    {
      "date": "2026-02-16",
      "week": 7,
      "overall_status": "healthy",
      "issues": [
        {
          "severity": "warning",
          "category": "backup",
          "message": "2026-02-14 Apple Notes backup short"
        }
      ]
    }
  ],
  "trends": {
    "token_usage": [42000, 45000, 35000, 65000, 38000, 35000, 35000],
    "backup_count": 12,
    "file_health": "good"
  }
}
```

### 檢查結果結構
```json
{
  "timestamp": "2026-02-16T23:00:00Z",
  "checks": {
    "files": {
      "status": "pass",
      "details": [...]
    },
    "backups": {
      "status": "warning",
      "details": [...]
    },
    "tokens": {
      "status": "pass",
      "details": [...]
    },
    "system": {
      "status": "pass",
      "details": [...]
    }
  },
  "summary": {
    "total_checks": 15,
    "passed": 13,
    "warnings": 2,
    "errors": 0
  }
}
```

---

## 強制分析模式整合

### 觸發時機
- **自動**：每週日 23:00 cron job
- **手動**：用戶講「執行復盤」

### 執行模型
- **數據收集**：Qwen3（本地執行，讀取檔案）
- **趨勢分析**：Kimi（分析 pattern）
- **報告生成**：MiniMax（格式整理）
- **通知發送**：Qwen3（執行通知）

### 優先級
- 低於用戶對話
- 使用閒置時段執行

---

## 實施清單

### Phase 1: 基礎檢查
- [ ] 文件存在性檢查腳本
- [ ] 備份數量檢查
- [ ] Token 數據收集
- [ ] 簡單報告生成

### Phase 2: 趨勢分析
- [ ] Token 趨勢計算
- [ ] 異常檢測
- [ ] 歷史比較
- [ ] 建議生成

### Phase 3: 自動化
- [ ] 每週定時執行
- [ ] Apple Notes 存檔
- [ ] WhatsApp 通知
- [ ] Dashboard 整合

---

## Kimi 實施注意點

1. **數據源**：
   - Token 數據：從 session 日誌提取
   - 備份數據：讀取 `backup-status-tracker.json`
   - 文件數據：直接檔案系統檢查

2. **性能**：
   - 檢查應該喺 30 秒內完成
   - 避免阻塞用戶對話

3. **可靠性**：
   - 即使部分檢查失敗，仍然生成報告
   - 記錄所有錯誤以便調查

4. **整合**：
   - 同現有 `health_monitor.js` 配合
   - 避免重複檢查

---

*設計完成：2026-02-16*
*負責人：MiniMax*
