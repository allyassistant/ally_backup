# Qwen3 Excel 學習系統 - Apple 整合設置指南

## 📅 Apple Calendar 設置

### 方法一：自動導入 (推薦)

1. **打開 Finder**，前往：
   ```
   ~/.openclaw/workspace/memory/qwen3_training/
   ```

2. **雙擊 `Qwen3_Excel_Training.ics` 文件**

3. **Calendar 會自動打開**，點擊「確定」導入

4. **檢查「Home」日曆**，會見到每日重複的事件：
   - **時間：** 3:00 AM - 9:00 AM
   - **標題：** Qwen3 Excel Training Session
   - **重複：** 每日，直到 2026-07-01

### 方法二：手動創建

如果不想導入 .ics 文件，可以手動創建：

1. 打開 **Apple Calendar**
2. 點擊「+」新增事件
3. 設置：
   - **標題：** Qwen3 Excel Training Session
   - **開始：** 3:00 AM
   - **結束：** 9:00 AM
   - **重複：** 每日
   - **結束重複：** 2026年7月1日
   - **提醒：** 事件開始時
   - **筆記：** Daily automated Excel training for Qwen3 AI assistant

---

## 📝 Apple Notes 設置

### Apple Notes 文件夾

系統會自動喺 **「Ally's Notes」** 文件夾創建筆記（如果冇會自動創建）。

### 每日自動記錄

系統會在 **每日早上 9:00 AM** 自動：
1. 生成學習進度報告
2. 創建筆記在「Ally's Daily」文件夾
3. 筆記標題格式：`Qwen3 學習日誌 - 2026年2月7日`

---

## ⚙️ 自動化排程詳情

### 定時任務一覽

| 時間 | 任務 | Cron ID |
|------|------|---------|
| **3:00 AM** | 開始 Qwen3 學習 | `5f9e0784-bed9-496f-a995-b8874e35d022` |
| **9:00 AM** | 記錄進度到 Apple Notes | `5f1f0242-a4d1-4514-83e7-88edcf4b61d1` |

### 學習流程

```
3:00 AM ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 9:00 AM
    │                                                      │
    ▼                                                      ▼
 Cron 觸發                                             Cron 觸發
 生成任務                                              記錄進度
    │                                                      │
    ▼                                                      ▼
 隔離 Session                                          Apple Notes
 Qwen3 學習                                            生成日誌
    │                                                      │
    ▼                                                      ▼
 保存進度                                              包含：
    │                                                   • 今日學習內容
    ▼                                                   • 完成百分比
 等待明日                                              • 已完成主題
                                                       • 明日預告
```

---

## 📋 Apple Notes 日誌格式

每日自動生成的筆記包含：

```markdown
## 📊 Qwen3 Excel 學習進度

**日期：** 2026年2月7日
**時間：** 03:00 - 09:00 (自動學習時段)

---

### 📚 今日學習內容

**模塊 1/6：** Advanced Formulas

**進度：** 15% 完成

**已完成主題：**
• XLOOKUP
• SUMIFS
• FILTER

---

### 📝 學習摘要

**今日任務：**
...

---

### ✅ 完成項目

✓ Extracted training module
✓ Generated learning task
✓ Saved progress

---

### 🎯 明日預告

繼續 Advanced Formulas 模塊

---

*自動生成於 09:00:00*
*Qwen3 Excel Training System*
```

---

## 🛠️ 管理命令

### 查看所有定時任務
```bash
openclaw cron list
```

### 暫停學習系統
```bash
# 暫停學習
openclaw cron update 5f9e0784-bed9-496f-a995-b8874e35d022 --enabled false

# 暫停進度記錄
openclaw cron update 5f1f0242-a4d1-4514-83e7-88edcf4b61d1 --enabled false
```

### 恢復學習系統
```bash
# 恢復學習
openclaw cron update 5f9e0784-bed9-496f-a995-b8874e35d022 --enabled true

# 恢復進度記錄
openclaw cron update 5f1f0242-a4d1-4514-83e7-88edcf4b61d1 --enabled true
```

### 手動觸發
```bash
# 手動開始學習
node ~/.openclaw/workspace/scripts/qwen3_training_scheduler.js

# 手動記錄進度
node ~/.openclaw/workspace/scripts/qwen3_progress_logger.js
```

### 查看進度
```bash
# 查看進度文件
cat ~/.openclaw/workspace/memory/qwen3_training/progress.json

# 查看今日日誌
cat ~/.openclaw/workspace/memory/qwen3_training/training_$(date +%Y-%m-%d).log
```

---

## 📁 相關文件位置

| 文件 | 路徑 |
|------|------|
| 日曆導入文件 | `memory/qwen3_training/Qwen3_Excel_Training.ics` |
| 學習教材 | `docs/qwen3_excel_training.md` |
| 學習調度器 | `scripts/qwen3_training_scheduler.js` |
| 進度記錄器 | `scripts/qwen3_progress_logger.js` |
| 進度追蹤 | `memory/qwen3_training/progress.json` |
| 每日日誌 | `memory/qwen3_training/training_YYYY-MM-DD.log` |

---

## ✅ 設置檢查清單

### Apple Calendar
- [ ] 導入 `.ics` 文件 或 手動創建事件
- [ ] 確認顯示在「Home」日曆
- [ ] 確認時間為 3:00-9:00 AM
- [ ] 確認每日重複設置

### Apple Notes
- [x] 使用現有「Ally's Notes」文件夾
- [ ] 等待明日 9:00 AM 第一條自動筆記

### Cron Jobs
- [x] 3:00 AM 學習任務已設置
- [x] 9:00 AM 進度記錄已設置

---

## 🎉 完成！

系統會在 **明日開始** 自動運行：
- 每日凌晨 3:00 AM：開始 Qwen3 Excel 學習
- 每日早上 9:00 AM：自動記錄進度到 Apple Notes

你可以在 **Apple Calendar** 查看排程，在 **Apple Notes → Ally's Notes** 追踪學習進度！

---

*設置日期: 2026-02-06*
*首次運行: 2026-02-07 3:00 AM*
