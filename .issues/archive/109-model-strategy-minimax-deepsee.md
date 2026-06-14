---
id: 109
title: Model Strategy — MiniMax + DeepSeek 最佳化利用
status: archive
priority: P2
created: 2026-05-07
due: 
updated: 2026-05-23
progress: 0/0
---

# Model Strategy — MiniMax + DeepSeek 最佳化利用

## 兩者優勢對比

| 能力 | **DeepSeek V4 Flash** | **DeepSeek V4 Pro** | **MiniMax M2.5/2.7** |
|------|----------------------|---------------------|-----------------------|
| **Context Window** | **1,000,000** 🏆 | **1,000,000** 🏆 | 200,000 |
| **Vision (VLM)** | ❌ | ❌ | ✅ **有** |
| **收費模式** | Pay-per-token | Pay-per-token | **訂閱制（固定月費）** |
| 速度 | ✅ 快 | ⚠️ 中等 | ✅ highspeed 都好快 |
| Reasoning | ✅ 有 | ✅ 有 | ✅ 有 |
| 繁中支援 | ✅ 好 | ✅ 好 | ✅ 好好 |

## 現有 Config 問題

### 1️⃣ Fallback Chain 太長
而家有 **11 個 fallbacks**，好多係重複：
```
deepseek-v4-flash → M2.7 → M2.5 → M2 → M2.1 → highspeed ×4 → lightning → deepseek-v4-pro
```
實際上 fallback 機制係逐個試，試到得為止。頭幾個 fail 晒先會去到最尾，**浪費時間**。

### 2️⃣ Bootstrap 接近爆煲
```
Total bootstrap injected chars: 57,827 (96% of max 60,000)
```
已經 96%，即係 OpenClaw 成日要壓縮 context。

### 3️⃣ DeepSeek 1M Context 未善用
DeepSeek V4 有 1M context，但我哋只 set 咗 `bootstrapMaxChars: 20000` — 完全浪費咗個超大 context window。

---

## 🎯 最佳化方案

### Phase 1 — Model Chain 精簡

將 11 個 fallbacks 縮做 3-4 個真正有用嘅：

```
Primary:  deepseek/deepseek-v4-flash     # 1M ctx，日常對話
Fallback: deepseek/deepseek-v4-pro       # 1M ctx，難題用
Fallback: minimax-portal/MiniMax-M2.5    # 訂閱制，DeepSeek 死咗時 backup
Fallback: minimax-portal/MiniMax-M2.5-highspeed  # 最快 fallback
```

### Phase 2 — 加大 Bootstrap，減少壓縮

| 而家 | 建議 | 效果 |
|------|------|------|
| `bootstrapMaxChars: 20000` | **50000-80000** | 減少 OpenClaw compression 頻率 |
| 壓縮次數：頻密 | **壓縮次數減半** | 回應更快、記憶更完整 |
| compaction: safeguard | 保留 | 安全機制，唔使改 |

DeepSeek V4 有 1M context，80K bootstrap 完全係小意思。

### Phase 3 — Vision Tasks → MiniMax（訂閱制）

而家 GIA cert OCR 已經用緊 MiniMax VLM（`describeImageWithMinimaxVLM`），呢個係啱嘅 — 訂閱制等於 unlimited vision calls，唔洗擔心 token 成本。

其他可以用 MiniMax Vision 嘅：
- GIA 證書 OCR ✅（已經用緊）
- Browser screenshots 分析
- PDF/圖片提取數據
- 任何需要睇圖嘅任務

### Phase 4 — 任務分類路由

| 任務類型 | 用邊個 | 原因 |
|---------|--------|------|
| **日常對話** | DeepSeek V4 Flash | 快 + 1M ctx |
| **Code review / refactor** | DeepSeek V4 Flash | 1M ctx 可以放晒成個 file |
| **複雜分析** | DeepSeek V4 Pro / MiniMax M2.7 | 更強模型 |
| **圖像處理 / Vision** | **MiniMax** 🏆 | 訂閱制 + Vision 能力 |
| **GIA 證書 OCR** | MiniMax VLM | 訂閱制，已經用緊 |
| **長文件分析** | DeepSeek V4 Flash | 1M ctx 優勢 |
| **Budget-sensitive batch** | MiniMax | 固定月費，狂用唔心痛 |

---

## 實作建議步驟

### Step 1: 簡化 Fallback Chain

```json
"fallbacks": [
  "deepseek/deepseek-v4-pro",           // 難題 upgrade
  "minimax-portal/MiniMax-M2.5",        // DeepSeek 死咗時 backup
  "minimax-portal/MiniMax-M2.5-highspeed"  // 超快 backup
]
```

由 11 個 → **3 個**，唔使逐個試。

### Step 2: 加大 Bootstrap

```json
"bootstrapMaxChars": 60000
```

由 20K → **60K**（config max 係 60K，但可以加大個上限）

要同時改 `agents.defaults.bootstrapTotalMaxChars` 上限。

### Step 3: 確保 Vision 任務行 MiniMax

而家 GIA analyzer 已經直接 call MiniMax API（`api.minimax.io`），唔經 OpenClaw model routing。呢個係正確嘅 — Vision 任務直接用 MiniMax 就唔會浪費 DeepSeek token。

---

## 要改嘅 Config

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "deepseek/deepseek-v4-flash",
        "fallbacks": [
          "deepseek/deepseek-v4-pro",
          "minimax-portal/MiniMax-M2.5",
          "minimax-portal/MiniMax-M2.5-highspeed"
        ]
      },
      "bootstrapMaxChars": 60000,
      "bootstrapTotalMaxChars": 80000,
      "compaction": {
        "mode": "safeguard",
        "memoryFlush": {
          "enabled": true
        }
      }
    }
  }
}
```

## 預計效果

| 指標 | 而家 | 改完後 |
|------|------|--------|
| Fallback chain length | 11 個 | **3 個** |
| Bootstrap 用量 | 57,827 (96%) | **~30-40%** |
| Compression 頻率 | 頻密 | **大減** |
| Vision tasks | DeepSeek 唔做得到 | **MiniMax 做晒** |
| Token cost | DeepSeek 佔全部 | **MiniMax 分擔 vision** |
