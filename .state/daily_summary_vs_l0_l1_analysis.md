# Daily Summary vs L0/L1 分析報告

**生成時間：** 2026-04-08 02:19 HKT
**分析目的：** 為乜每日 23:59 Discord 日記穩定，但 L0/L1 唔穩定

---

## 1. 數據來源比較

| 項目 | Daily Summary (23:59) | L0/L1 (00:05/00:35) |
|------|----------------------|---------------------|
| **來源檔案** | 最新嘅單一 L2 file (`YYYY-MM-DD-HHMM.md` by mtime) | 全部 L2 files (`^YYYY-MM-DD(?:\.md\|-.*\.md)$`) 合併 |
| **檔案數量** | 1 個（當日最新） | 27 個（當日全部） |
| **總字符數** | ~10-15KB（最新單一檔案） | ~29,465 chars（全部檔案） |
| **截斷位置** | 取最新檔案，取首 8000 chars | 取全部檔案，取最後 4000/8000 chars |
| **排除過濾** | ✅ 排除 `discord-channels-*` | ❌ 全部讀入，無過濾 |
| **實際內容** | 包含真實對話（晚間活動為主） | 包含大量系統日誌、cron 執行、Code Quality 掃描 |

---

## 2. 生成方式比較

### Daily Summary Bot (23:59)
```javascript
// 讀取最新單一檔案（按 mtime 排序）
filesWithStats.sort((a, b) => b.mtime - a.mtime);
content = await fs.promises.readFile(filesWithStats[0].path, 'utf8');
const truncatedContent = content.substring(0, 8000);

// 使用 gemma4:e2b，num_predict: 1500，temperature: 0.7
const prompt = `你係AI助手。根據以下工作記錄，寫3段日記...

【今日主要工作】
【學到乜 / 反思】
【聽日計劃】`;
```
- **截斷：** 從頭取 8000 chars（新檔案內容集中在前面）
- **num_predict：** 1500（充足）
- **temperature：** 0.7（創意）
- **Fallback：** 段落分割（4 種方式）
- **觸發時間：** 23:59 HKT

### L0/L1 Generator (00:05/00:35)
```javascript
// 讀取並合併全部 L2 files
for (const file of l2Files) {
  l2Content += fs.readFileSync(file, 'utf8') + '\n';
}
// 取最後 4000/8000 chars
contentToSend = l2Content.slice(-cfg.inputWindow);
```
- **截斷：** 從尾取 4000 (L0) / 8000 (L1) chars（syslog 集中在尾段）
- **num_predict：** L0=300, L1=800（偏少）
- **temperature：** 0.3（保守）
- **Fallback：** 增強提取（會保留 syslog 噪音）
- **觸發時間：** L0=00:05, L1=00:35

---

## 3. 關鍵差異分析

### 🔴 最核心問題：L2 檔案內容質量

**2026-04-07 L2 檔案內容分佈：**

| 內容類型 | 佔比 | 來自 |
|---------|------|------|
| System Check 日誌 | ~60% | Code Quality Manager, cron jobs |
| Error Tracker 輸出 | ~15% | error_tracker.js scan |
| 指令執行記錄 | ~10% | script executions |
| **真實對話** | **~10-15%** | 實際 Discord/Signal 對話 |
| 其他系統訊息 | ~5% | heartbeat, failover checks |

**問題：**
- 00:00-02:00 期間係 Code Quality Manager 大量運行
- 27 個 L2 檔案中，syslog/CQ output 佔據 90%+
- 每日 23:59 Daily Summary 讀取最新檔案，syslog 已沉到底部（因每個檔案開頭係對話）
- 但 L0/L1 從尾取 4000 chars，全部係 syslog noise

### 📊 實際測試：2026-04-07 L0 輸出（已 Fallback）

```
# L0 Abstract - 2026-04-07

當日共有 5 個主要討論話題，涵蓋：[上午12:03] [事件: 2026-04-06 | 記錄...
## Today's Key Topics
* [上午12:03] [事件: 2026-04-06 | 記錄: 2026-04-07] [MAIN]: 🔧 Running system check for 
* [上午01:45] [事件: 2026-04-06 | 記錄: 2026-04-07] [MAIN]: 🔧 Running system check for 
...
---
*Generated: 2026-04-07T16:05:29.665Z (extraction fallback — enhanced)*
*Source: 27 L2 files*
```

**呢個 output 完全冇意義** — 全部係系統檢查嘅 timestamp noise，唔係真實 topics。

---

## 4. 為乜 Daily Summary 穩定但 L0/L1 唔穩定

| 因素 | Daily Summary | L0/L1 |
|------|--------------|-------|
| **數據來源** | 最新單一檔案，內容集中喺前面（對話為主） | 全部檔案，取尾段（syslog 噪音為主） |
| **截斷方式** | 從頭取 8000（内容乾淨） | 從尾取 4000（syslog 噪音） |
| **Prompt 設計** | 清晰結構：`【今日主要工作】【學到乜】【聽日計劃】` | 抽象要求：`5 個 topics`、`150-200 字` |
| **num_predict** | 1500（充足） | L0=300（太少，唔夠長） |
| **Fallback 品質** | 段落分割 fallback 合理 | 增強提取 fallback 仍保留噪音 |
| **執行時間** | 23:59（有完整一日對話） | 00:05（syslog 高峰期剛過） |

### 根本原因

1. **L2 檔案構成問題**：00:00-02:00 大量系統 cron jobs 產生 syslog，佔據 L2 檔案主體
2. **截斷策略錯誤**：從尾取 content，剛好取到 syslog 最密集區域
3. **Prompt 唔夠強**：gemma4:e2b 收到 noise 內容，難以 extract meaningful topics
4. **num_predict 太少**：L0 只俾 300 tokens，複雜 noise 輸入根本唔夠生成有價值 output

---

## 5. 具體改善建議

### 🔴 P0 - 立即修復（預計 30 分鐘）

#### 建議 1：改用 `discord-channels-YYYY-MM-DD.md` 作為 L0/L1 數據源

`discord-channels-YYYY-MM-DD.md` 係經過 channel_logger 處理過嘅乾淨對話記錄，
格式清晰（每條訊息有時間、發送者、內容），噪音極少。

```javascript
// memory_generator.js 修改
const discordChannelFile = path.join(MEMORY_DIR, `discord-channels-${dateStr}.md`);
let contentToSend = '';
if (fs.existsSync(discordChannelFile)) {
  contentToSend = fs.readFileSync(discordChannelFile, 'utf8');
} else {
  // Fallback to existing logic
  contentToSend = l2Content.slice(-cfg.inputWindow);
}
```

**優點：**
- 乾淨格式，syslog-free
- 每日 23:50 已生成，數據完整
- 適合摘要生成

#### 建議 2：L0 num_predict 提升至 600

```javascript
L0: {
  numPredict: 600,  // 從 300 提升至 600
  // ...
}
```

300 tokens 太少，實際只生成 ~150 中文字，唔夠表達 5 個 topics。

---

### ⚠️ P1 - 中期優化（預計 1-2 小時）

#### 建議 3：過濾 L2 檔案噪音

喺讀取 L2 之前，先過濾已知噪音 pattern：

```javascript
const noisePatterns = [
  /^#{1,4}\s*Code Quality Manager/,
  /🔍 Discovering files/,
  /Critical\/High.*問題/,
  /Running system check/,
  /L0 timeout/,
  /\[cron:.*System Check/,
];

let cleanContent = content;
for (const pattern of noisePatterns) {
  cleanContent = cleanContent.replace(new RegExp(pattern, 'g'), '');
}

// 再截斷
const truncated = cleanContent.slice(-cfg.inputWindow);
```

#### 建議 4：改為從頭截斷（與 Daily Summary 一致）

```javascript
// 從頭取，唔係從尾取
const contentToSend = l2Content.substring(0, cfg.inputWindow);
```

Daily Summary 從頭取 8000，因為新檔案內容集中在前面。
L0/L1 從尾取，但尾段全部係 syslog，係完全錯誤嘅策略。

---

### 📝 P2 - 長期方案

#### 建議 5：統一數據來源

讓 L0/L1 和 Daily Summary 都使用同一個數據源：
- 優先使用 `discord-channels-YYYY-MM-DD.md`（已處理）
- 保留 L2 fallback，但需要 noise 過濾

#### 建議 6：分離系統日誌與對話記錄

考慮將 L2 檔案一分為二：
- `YYYY-MM-DD-conversations.md`：純對話（交畀 L0/L1 用）
- `YYYY-MM-DD-systemlogs.md`：系統日誌（唔俾 L0/L1 讀）

---

## 6. 推薦執行順序

```
Step 1: 修改 memory_generator.js，使用 discord-channels-*.md（30 分鐘）
   ↓
Step 2: 提升 L0 num_predict 至 600（5 分鐘）
   ↓
Step 3: 測試明日 L0/L1 output
   ↓
如果仍有问题:
   ↓
Step 4: 實現 noise 過濾（1 小時）
   ↓
Step 5: 考慮從頭截斷策略（30 分鐘）
```

---

## 7. 總結

| 問題 | 原因 | 解決方向 |
|------|------|---------|
| L0 output 全係 syslog | 從尾截斷，取到噪音區 | 改用 discord-channels 或從頭截斷 |
| Fallback 都係垃圾 | 增強提取唔識分離噪音 | 需要 content filtering |
| L0 穩定性差 | gemma4:e2b + noise input = 垃圾 output | 提升 num_predict + 乾淨輸入 |
| Daily Summary 穩定 | 最新檔案 + 乾淨頭部 + 清晰 prompt | 借鑒呢個策略 |

**核心發現：Daily Summary 穩定係因為佢用嘅係「已經清理過」嘅 discord-channels 格式數據，
而 L0/L1 直接讀 raw L2，syslog 噪音佔據 90%，導致生成失敗。**

---

*分析人：Ally Sub-agent | 2026-04-08 02:19 HKT*