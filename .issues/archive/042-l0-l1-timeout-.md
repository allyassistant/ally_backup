---
id: 042
title: L0/L1 記憶系統timeout失效
status: archive
priority: P1
created: 2026-03-14
due: 2026-03-20
updated: 2026-03-20
progress: 0/3
---

## 問題

L0/L1 記憶系統因為 AI 生成 timeout 而失效，導致記憶未能完美記錄。

### 現況 (2026-03-14 確認)

| File | 狀態 |
|------|------|
| L0 (今日) | ❌ 冇 |
| L1 (昨日) | ❌ 冇 |
| L2 (之前) | ✅ 有 |

### 實際 Size

| Layer | Bytes | 字數 (大約) |
|-------|-------|-------------|
| L0 | 300 - 2300 | ~100-800 字 |
| L1 | 800 - 3500 | ~300-1200 字 |

**其實已經唔算大！問題唔係file太大，而係生成既時候要讀大量session content，先至timeout。**

### 根本原因

1. **生成 timeout** - AI 生成 L0/L1 要讀大量內容，導致 timeout (180s)
2. **寫入慢** - 每次要生成幾千字，先至寫得
3. **Fail率高** - 十次生成九次 fail

## 新增：文章啟發 (2026-03-14)

**參考：小龍蝦真正接近完美的標準**

> 第一，啟動文件越短越好！
> MEMORY.md、HEARTBEAT.md 呢兩個一長，系統馬上變重。
> 原始細節去 daily memory，呢度保留蒸餾過既長期有效內容就好。

> 第二，身份、用戶、工具、流程必須徹底分層。
> - SOUL 只講氣質
> - IDENTITY 只講角色
> - USER 只講邊個係你
> - TOOLS 只講可以點樣動手
> - AGENTS 只講編排同啟動流程
> - MEMORY 只講長期記憶
> - HEARTBEAT 只講輕巡檢

> 第三，長期記憶靠提煉，唔靠堆積。

### 應用到我地既問題

1. **MEMORY.md 太長** → 簡化到淨係幾百字既核心長期記憶
2. **HEARTBEAT.md 太長** → 淨係留低幾個關鍵檢查
3. **L0/L1 失敗** → 改為少量多次寫入 L2

## 討論方向

### 方向1: 放棄 L0/L1，直接用 L2

- 每次 session reset 後直接讀 L2 既 tail
- 唔需要 summary 生成
- 簡單、直接

### 方向2: 少量多次寫入 L2

- 每 30 分鐘寫一次，每次 200 字
- 覆寫模式，唔會越寫越大
- 讀既時候只讀 tail (最後 50 行)

### 方向3: 整好 L0/L1 生成

- 增加 timeout
- 減少生成內容量
- 加強 error handling

## 調查結果 (2026-03-15)

### 真正原因

1. **Ollama Qwen3/3.5 thinking bug** - 所有 output 入晒 thinking 度，response 空
2. **MiniMax direct API** - HTTP 401 auth error (但 OpenClaw 內部既 MiniMax 正常)

### 實際狀態

| Job | Model | Status | 原因 |
|-----|-------|--------|------|
| L0 (00:05) | MiniMax (OpenClaw) | ✅ 正常 | 內部 API 免費 |
| L1 (00:35) | MiniMax (OpenClaw) | ✅ 正常 | 內部 API 免費 |
| Daily Summary | Ollama qwen2.5:3b | ✅ 已修復 | qwen2.5 冇 thinking bug |

### MiniMax vs Ollama 分析

- **MiniMax through OpenClaw**: 免費 (月費已包)
- **Ollama qwen2.5:3b**: 免費 (本地)

**轉去 Ollama 唔會慳到額外 token！**

### Cron Jobs Timeout 優化

| Job | 之前 | 之後 |
|-----|------|------|
| Reminder Discussion | 30秒 | 60秒 |
| Daily Media Cleanup | 60秒 | 120秒 |
| L0/L1 Fallback | 180秒 | 300秒 |

## 結論

- L0/L1 用 MiniMax through OpenClaw - 正常運作 ✅
- Daily Summary 用 qwen2.5:3b - 已修復 ✅
- **所有野已經正常！**

---
*Last Updated: 2026-03-15 03:12 HKT*
