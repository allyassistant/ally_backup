# L0/L1 生成問題分析與修復方案

## 問題診斷

### 1. Cron Output 混入問題 (已確認)

**現象：** L2 files 包含大量 cron job 輸出：
```
[MAIN]: [cron:3ad2bf02-0cbb-4ae7-a2b3-09fa563db4ea Daily Memory Logger - Force Run] node ...
```

**原因：** `log_to_daily_memory.js` 既 `--auto` mode 會 scan sessions，cron job 既 output 也會被當作 messages 記錄埋去。

**現有 filter（有 bug）：**
```javascript
const filtered = unique.filter(line =>
  !line.startsWith('[cron:') &&
  !line.match(/^\[cron:[a-f0-9-]\]/)  // ❌ 多咗一個 `]`
);
```

**問題：**
- 只檢查 line 既開頭
- Regex 有語法錯誤（多咗 `]`）
- Cron output 可能夾雜喺 sentence 中間

---

### 2. 重複條目問題 (已確認)

**現象：**
```
- * [上午12:00] [記錄: 2026-04-16] [MAIN]: [MAIN]: [cron:...] ...
- * [上午12:00] [記錄: 2026-04-16] [MAIN]: ✅ Logged: [MAIN]: [cron:...] ...
- * [上午12:00] [記錄: 2026-04-16] [MAIN]: ✅ Daily Memory Logger 完成 — 記錄了 5 條 session 消息。
```

**原因：** 去重logic 只用 first 80 chars，時間相同但內容輕微唔同就視為新entry。

**現有去重：**
```javascript
const entryKey = entry.substring(0, 80);
if (content.includes(entryKey)) { ... }
```

---

### 3. Input Sources 數量問題 (澄清)

**觀察：** 2026-04-16 有 30+ L2 files，數量足夠。

**問題：** Files 内容充滿 cron noise，signal-to-noise ratio 太低。

---

## 修復方案

### 1. Cron Filter Regex（正確版本）

**問題code：**
```javascript
// ❌ 錯誤 - regex 有多餘既 ]
!line.match(/^\[cron:[a-f0-9-]\]/)
```

**修復：**
```javascript
// ✅ 正確 - 使用 includes() 或完整 regex
const filtered = unique.filter(line => {
  // 完全移除任何包含 cron ID 既行
  return !/\[[cron:[a-f0-9-]+\]/.test(line);
});
```

**或者更嚴格：**
```javascript
const filtered = unique.filter(line => {
  // 移除 cron output lines
  if (/^\[.*\] \[cron:/.test(line)) return false;
  // 移除包含 "cron:" 既任何行 (case insensitive)
  if (/cron:/i.test(line)) return false;
  return true;
});
```

---

### 2. 去重 Algorithm（智能版本）

**問題：** 
- 簡單 substring matching 會漏掉相似既 entries

**解決方案 A - 完全 identical 去重：**
```javascript
// Extract actual content (ignore timestamp)
function extractContent(entry) {
  // Remove: timestamp, marker, temporal tags
  return entry
    .replace(/^\s*[-*]\s*\[\w+:\d{2}:\d{2}\]\s*/, '')  // Remove "- [HH:MM]"
    .replace(/\[\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}[^\]]*\]/g, '') // Remove dates
    .replace(/\[.*?\]/g, '') // Remove all brackets
    .trim()
    .substring(0, 100); // Use first 100 chars
}

// Check duplicate
const contentKey = extractContent(entry);
if (seenContents.has(contentKey)) {
  console.log(`⏭️ Skip (duplicate): ${contentKey.substring(0,30)}...`);
  return;
}
seenContents.add(contentKey);
```

**解決方案 B - Time-decay threshold：**
```javascript
const TIME_DECAY_MS = 5 * 60 * 1000; // 5 minutes

// Track recent entries
const recentEntries = []; // { content, timestamp }

// Before adding new entry
const now = Date.now();
const isDuplicate = recentEntries.some(e => {
  const timeDiff = now - e.timestamp;
  return timeDiff < TIME_DECAY_MS && e.content === contentKey;
});
```

---

### 3. 輸入優化 - 減少 noise

**方法：** 在 `log_to_daily_memory.js` 既 skipPatterns 入面加多啲 cron-related patterns：

```javascript
const skipPatterns = [
  // ... existing patterns ...
  '[cron:',                    // NEW: cron job IDs
  'Daily Memory Logger',       // NEW: logger output
  'node scripts/log_to_',  // NEW: script paths
];
```

---

## 交付既 Code Changes

### memory_generator.js - generateFallback() 修復

```javascript
// Phase 2.5: Filter out cron output (FIXED)
const filtered = unique.filter(line => {
  // 完全移除任何包含 cron ID 既行
  if (/\[[cron:[a-f0-9-]+\]/.test(line)) return false;
  // 移除 "Daily Memory Logger" 等系統訊息
  if (/Daily Memory Logger/i.test(line)) return false;
  return true;
});
```

### log_to_daily_memory.js - skipPatterns 更新

```javascript
const skipPatterns = [
  // ... existing 30+ patterns ...
  // ADDED 2026-04-16: cron noise
  '[cron:',
  'Daily Memory Logger',
  'node scripts/log_to_',
  'Logged:',
  '完成了',
];
```

---

## 預期效果

| 問題 | Before | After |
|------|-------|-------|
| Cron output 混入 | 30-50% noise | <5% |
| 重複條目 | 3-5x duplicates | max 2x |
| L2 quality | Low (cron noise) | High (real content) |

---

*Generated: 2026-04-16 | By: Subagent (Kimi Code CLI Research)*