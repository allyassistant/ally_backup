# 記憶架構深度分析報告
## 清理 Sessions 會唔會失憶？

*分析時間: 2026-03-07 01:45*

---

## 一、記憶系統數據流

```
對話發生
    ↓
[Session File] (agents/main/sessions/*.jsonl) - 實時完整記錄
    ↓ (Pre-compaction Flush 自動觸發)
[L2 Daily] (memory/YYYY-MM-DD-HHMM.md) - 摘要存檔
    ↓ (每日 00:05/00:35 Cron Job)
[L0 Abstract] (memory/l0-abstract/YYYY-MM-DD.md) - 200字精華
[L1 Overview] (memory/l1-overview/YYYY-MM-DD.md) - 600字詳情
    ↓
[長期記憶] (MEMORY.md, AGENTS.md, errors.json)
```

---

## 二、各層級關係分析

### Session Files (已清理 844 個)
- **用途**: OpenClaw 內部恢復對話上下文
- **格式**: JSON Lines (完整對話歷史)
- **生命周期**: 對話期間 → 清理後刪除
- **清理影響**: ⚠️ 無法恢復該 session 嘅完整上下文

### L2 Daily Memory (86 個文件)
- **用途**: 人工維護嘅記憶摘要
- **格式**: Markdown
- **生成方式**: 
  - Pre-compaction flush (自動)
  - log_to_daily_memory.js (手動/Cron)
- **清理影響**: ✅ **不受影響** (獨立儲存)

### L0/L1 (15/17 個文件)
- **用途**: AI 生成嘅每日摘要
- **來源**: 從 L2 Daily 生成
- **生成時間**: 每日 00:05 (L0), 00:35 (L1)
- **清理影響**: ✅ **不受影響** (只讀 L2)

---

## 三、會否失憶？

### ✅ **唔會失憶嘅情況**

| 情況 | 原因 |
|------|------|
| 查詢過去事件 | L0/L1/L2 已保存摘要 |
| 長期規則/錯誤 | MEMORY.md, errors.json 已記錄 |
| 重要決定 | 已通過 Pre-compaction flush 保存 |

### ⚠️ **會「失憶」嘅情況**

| 情況 | 影響 |
|------|------|
| 恢復 3 日前嘅完整對話 | Session 已清理，無法恢復完整上下文 |
| 追查舊 session 嘅詳細錯誤 | error_tracker 無法掃描已刪除嘅 session |
| 查看未 flush 到 L2 嘅內容 | 如果 pre-compaction 前 session 被刪，內容丢失 |

---

## 四、風險評估

### 高風險 ⚠️⚠️⚠️
- **未 Flush 即清理**: 如果 session 喺 pre-compaction flush 前被清理，內容會永久丢失

### 中風險 ⚠️⚠️
- **Error 追溯**: error_tracker 依賴 session files 掃描錯誤，清理後無法追溯

### 低風險 ⚠️
- **上下文恢復**: 超過 3 日嘅舊對話通常唔需要恢復

---

## 五、改進建議

### 立即執行
1. **確保 Pre-compaction Flush 優先執行**
   ```bash
   # 修改 cleanup script，先 flush 再清理
   node scripts/log_to_daily_memory.js --auto
   sleep 5
   # 然後先執行清理
   ```

2. **Error Tracker 改進**
   - 喺清理前掃描並記錄所有 errors
   - 或者改為從 L2 而非 sessions 掃描

### 中期改進
3. **Session Archive 而非 Delete**
   - 大於 5MB 嘅 session 歸檔到 `_archive/sessions/`
   - 保留 30 日後先徹底刪除

4. **自動 Flush 機制**
   - 喺 session 達到某個大小/年齡時自動 flush 到 L2

### 長期改進
5. **統一記憶接口**
   - 建立單一數據源，避免 sessions 同 L2 嘅數據不一致

---

## 六、結論

**清理 sessions 唔會導致「真正嘅失憶」**，因為：
- ✅ 重要信息已通過 L0/L1/L2 保存
- ✅ MEMORY.md 記錄咗核心規則
- ✅ errors.json 記錄咗錯誤教訓

**但會導致「上下文失憶」**：
- ⚠️ 無法恢復舊對話嘅完整細節
- ⚠️ 無法追溯 3 日前嘅詳細錯誤

**建議**：
- 繼續現有清理機制
- 加強 Pre-compaction Flush 嘅可靠性
- 考慮將重要 session 歸檔而非直接刪除

---

*分析完成時間: 2026-03-07 01:45*
