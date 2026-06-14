# Session Reset 後恢復指南

## 🔄 Reset 後點樣繼續？

當 Token 達到 70%，系統會：
1. 自動將對話備份到 Apple Notes（Ally's Chat History）
2. Send WhatsApp 通知你 Reset
3. **你需要手動 /reset 開新 session**

## 📖 Reset 後恢復方法

### 方法 1：手動查看備份（推薦）

```
1. 打開 Apple Notes
2. 進入「Ally's Chat History」文件夾
3. 查看最新備份（標題：AI Session Archive - YYYY-MM-DD HH:MM）
4. 睇完之後同我講想繼續邊個話題
```

### 方法 2：命令行快速查看

```bash
cd ~/.openclaw/workspace
node scripts/session_recovery_reader.js
```

### 方法 3：直接問我

Reset 之後你可以直接問：
- "繼續我哋頭先講緊嘅 [話題]"
- "睇下上個 session 有咩待辦事項"
- "總結一下之前嘅討論"

我會用 `memory_search` 搵返相關內容。

---

## 💡 最佳實踐

### 每次 Session 開始時：

1. **我會自動**：
   - 檢查heartbeat state
   - 睇下有無待辦事項
   - 檢查cron jobs狀態

2. **你可以講**：
   - "繼續之前嘅工作"
   - "有咩未完成？"
   - "睇下進度"

3. **我會從 MEMORY.md 同 daily notes 搵返**：
   - 進行中項目
   - 待辦事項
   - 重要決定

---

## 📝 自動化（未來改進）

可以設定：
- Reset 後自動讀取備份摘要
- 自動提取待辦事項
- 自動問你要唔要繼續

但目前建議手動講聲，更靈活。

---

## ⚠️ 注意

- Apple Notes 備份係 **完整對話記錄**（可能5000+字）
- 唔好強行塞晒入新 session（會爆 token）
- 揀重點話題繼續就得

---

*Last Updated: 2026-02-06*
