# 代碼審計方案比較報告
**Generated:** 2026-04-06 18:15 HKT  
**Analyst:** Kimi Code CLI (Subagent)  
**Working Directory:** ~/.openclaw/workspace

---

## 📊 現有系統架構分析

### 現有系統組成

| 組件 | 行數 | 功能 |
|------|------|------|
| `pure_ai_audit.js` | 848 | AI payload generator (生成俾 Kimi sub-agent 分析) |
| `auto_fix.js` | 2752 | Scanner + aggregator + MiniMax spawner |
| `code_quality_manager.js` | 969 | CLI wrapper (統一入口) |
| `lib/auditOrchestrator.js` | ~600 | 協調 Local/AI/Error 三種 Scanner |
| `lib/rules/` | ~800 | Modular rules (high-risk, low-risk) |
| `lib/helpers/` | ~600 | Context-aware helpers (context_helpers, whitelist_patterns, skip-list) |

**Total:** ~5700+ lines

---

## 🚨 今日遇到嘅 False Positive 問題

| 問題 | 根本原因 | 現有緩解 |
|------|---------|---------|
| execSync import 被標為真正調用 | LocalScanner 用 `\bexecSync\s*\(` regex | ✅ 已修復：加入 destructuring assignment 檢測 |
| Template string 示例代碼被標記 | 唔識追蹤 template literal 邊界 | ✅ 已修復：加入 template depth tracking |
| try-catch 在 10 行之外被當成冇 protection | 盲目向前找 20 行 | ✅ 已修復：正確計算 brace depth |
| 需要分開多次修復 | 缺少 batch 確認機制 | ❌ 未解決 |

---

## 方案 A vs 方案 B 深度比較

### 方案 A：Unified Scanner + AI Verification Layer

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: Local Scanner (快速發現候選問題)                   │
│  ├── Rule-based detection (regex)                          │
│  ├── Context-aware helpers (避免 FP)                       │
│  └── 輸出候選問題列表 (CANDIDATES)                          │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 2: Kimi Batch Verification (一次過確認所有問題)     │
│  ├── 將候選問題 + 相關代碼上下文打包成 payload              │
│  ├── 一次過問 Kimi：「邊個係真正問題？」                    │
│  └── 輸出 confirmed issues (含 confidence score)            │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 3: Self-Learning Pattern Store                     │
│  ├── Kimi 確認結果寫入 Pattern Store                        │
│  ├── 用戶反饋寫入 Pattern Store                             │
│  └── 自動更新 Local Scanner 白名單                         │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 4: Auto-Fix (按 confidence 決定係咪自動修復)        │
│  ├── confidence >= 0.9 → 全自動修復                        │
│  ├── confidence 0.7-0.9 → 修復 + 通知                       │
│  └── confidence < 0.7 → 只報告，等用戶確認                  │
└─────────────────────────────────────────────────────────────┘
```

**優點：**
- ✅ AI 二次確認，大幅減少 FP
- ✅ Self-Learning 避免重複犯錯
- ✅ Batch verification，唔洗分開多次修復
- ✅ Phase 3 慢慢學習，適應 OpenClaw 環境

**缺點：**
- ❌ 需要新增 Phase 2/3 架構
- ❌ Kimi API 調用次數增加 (但 batch 減少次數)
- ❌ 需要建立 Pattern Store

**估計工作量：**
- 新增 Phase 2/3 程式碼：~500-800 行
- 修改現有 LocalScanner 介面：~150 行
- Pattern Store 實現：~300 行

---

### 方案 B：Pure AI Audit + 改良 Local Scanner

```
┌─────────────────────────────────────────────────────────────┐
│  保持現有架構不變                                           │
│  └── pure_ai_audit.js (AI payload generator)               │
│  └── auto_fix.js (Scanner + spawner)                       │
│  └── code_quality_manager.js (CLI wrapper)                 │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  大幅改良 Local Scanner 規則                               │
│  ├── 加入更精確的 context detection                        │
│  ├── 加入更多白名單 patterns                               │
│  └── 減少 regex 的 false positive                           │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  加入 AI 二次確認步驟                                       │
│  ├── Local Scanner 發現問題                                │
│  ├── 發送 payload 俾 pure_ai_audit.js                       │
│  └── AI 確認邊個係真正問題                                  │
└─────────────────────────────────────────────────────────────┘
```

**優點：**
- ✅ 保持現有架構，風險低
- ✅ 只需改良 Local Scanner 規則
- ✅ Kimi 仍然用於確認

**缺點：**
- ❌ 需要大量手工調整規則
- ❌ 規則維護成本高
- ❌ 沒有 self-learning，會重複犯錯
- ❌ FP 問題無法根本解決

**估計工作量：**
- 改良 LocalScanner：~400-600 行 (需要大量測試)
- 持續維護規則：無底洞

---

## 📊 技術可行性分析

### 1. 需要改幾多代碼？

| 方面 | 方案 A | 方案 B |
|------|--------|--------|
| 新增程式碼 | 800-1100 行 | 0 |
| 修改現有程式碼 | 200-300 行 | 400-600 行 |
| 測試時間 | 中等 (新架構有完整邏輯) | 高 (規則調整無底洞) |
| 維護成本 | 低 (self-learning) | 高 (持續手工調整) |

### 2. 邊個方案更符合 OpenClaw 架構？

**方案 A 優勢：**
- 與現有 `lib/auditOrchestrator.js` 架構一致
- 現有 Phase 1 (LocalScanner) → 方案 A 保留
- 現有 Phase 2 (AIScanner) → 方案 A 強化
- 現有 helpers (context_helpers, skip-list) → 方案 A 繼續使用

**方案 B 缺點：**
- 繼續依賴 rule-based 規則，無法治本
- 與現有 Pattern Store (memory/patterns/) 完全唔整合

### 3. Token 消耗對比

| 場景 | 方案 A | 方案 B |
|------|--------|--------|
| Local Scanner | 少量 (regex) | 少量 (regex) |
| AI Verification | Batch 一次過 (efficient) | 多次確認 (inefficient) |
| Learning | 增量更新，唔洗重新訓練 | 不適用 |
| 總消耗 | ⭐ 低 | ⭐⭐⭐ 高 |

---

## 🎯 False Positive 問題解決方案

### 今日遇到嘅問題 vs 解決方案

| 問題 | 方案 A 解決 | 方案 B 解決 |
|------|-------------|-------------|
| execSync import 被標 | LocalScanner 已修復 ✅ | 繼續需要手工調整規則 |
| Template string 被標 | LocalScanner 已修復 ✅ | 繼續需要手工調整規則 |
| try-catch 10 行外 | LocalScanner 已修復 ✅ | 繼續需要手工調整規則 |
| 分開多次修復 | **Kimi Batch Verification ✅** | ❌ 仍然需要多次 |
| FP 問題重複 | **Self-Learning Pattern Store ✅** | ❌ 會持續出現 |

**方案 A 根本解決：**
- Phase 2 Kimi Batch Verification 一次過確認所有候選問題
- Phase 3 Self-Learning 自動學習，唔會再犯同樣的 FP

---

## 🧠 Self-Learning Pattern Store 實現

### 建議架構

```
memory/patterns/
├── fp_whitelist.json      # False Positive 白名單
├── confirmed_issues.json # 已確認的問題
├── feedback_loop.json     # 用戶反饋記錄
└── learning_stats.json   # 學習統計
```

### Pattern Store 結構

```javascript
// memory/patterns/fp_whitelist.json
{
  "patterns": [
    {
      "id": "fp_execSync_import",
      "match": "const { execSync } = require",
      "reason": "Destructuring import, not actual call",
      "confidence": 0.95,
      "learned_at": "2026-04-06",
      "learned_from": "Kimi verification"
    },
    {
      "id": "fp_template_example",
      "match": "Template literal containing execSync example",
      "reason": "Code example in documentation",
      "confidence": 0.90,
      "learned_at": "2026-04-06",
      "learned_from": "Kimi verification"
    }
  ],
  "last_updated": "2026-04-06T18:00:00+08:00"
}
```

### Feedback Loop 運作

```
┌────────────────────────────────────────────────────────────┐
│  Local Scanner 發現候選問題                                 │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│  Kimi Batch Verification                                  │
│  「問題 A、B、C 邊個係真正問題？請解釋。」                  │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│  結果寫入 Pattern Store                                    │
│  ├── True Positive → 修復 + 學習                                                   │
│  └── False Positive → 加入白名單                                                  │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│  下次掃描時                                               │
│  ├── 白名單 patterns自動跳過                              │
│  └── 確認的問題高 confidence 直接修復                       │
└────────────────────────────────────────────────────────────┘
```

### 可以借鑒的現有系統

1. **memory/patterns/errors.json** - 現有的 error pattern tracking
   - 結構：`{ error_type, first_seen, last_seen, count, pattern, history }`
   - 可擴展到 FP patterns

2. **lib/helpers/whitelist_patterns.js** - 現有的白名單
   - 結構：`{ SAFE_CONTEXTS, DANGER_SIGNALS, SAFE_HELPERS }`
   - 可整合進 Pattern Store

3. **lib/helpers/skip-list.js** - 現有的 skip 邏輯
   - 結構：`{ isStylePreference, SKIP_PATTERNS }`
   - 可改為讀取 Pattern Store

---

## 💡 建議

### 🏆 推薦：方案 A (Unified Scanner + AI Verification Layer)

**理由：**

1. **根本解決 FP 問題** - Kimi Batch Verification + Self-Learning
2. **符合 OpenClaw 架構** - 與現有 auditOrchestrator.js 一致
3. **Token 高效** - Batch verification 比多次確認更慳
4. **長期低成本** - Self-Learning 減少持續維護

### 分階段實現 Roadmap

#### Phase 1: 整合現有資源 (Week 1)
- ✅ 使用現有 `lib/helpers/context_helpers.js`
- ✅ 使用現有 `lib/helpers/whitelist_patterns.js`
- ✅ 使用現有 `lib/helpers/skip-list.js`
- 目標：移除重複邏輯，統一入口

#### Phase 2: Kimi Batch Verification (Week 2-3)
- 新增 `scripts/lib/kimi_batch_verifier.js`
- 修改 `auditOrchestrator.js` 加入 Phase 2 調用
- 實現 batch payload 生成 + Kimi 調用

#### Phase 3: Self-Learning Pattern Store (Week 4)
- 新增 `memory/patterns/fp_whitelist.json`
- 修改 LocalScanner 讀取白名單
- 實現 feedback loop

#### Phase 4: Auto-Fix 按 Confidence (Week 5-6)
- 修改 `auto_fix.js` 加入 confidence threshold
- 實現 `confidence >= 0.9 → 全自動修復`

---

## 📈 預期效果

| 指標 | 現在 | 方案 A 完成後 |
|------|------|---------------|
| False Positive 率 | ~30% (估計) | < 5% |
| 修復次数 | 多次 | 一次 batch |
| Token 消耗 | 高 (多次確認) | 低 (batch) |
| 維護成本 | 高 | 低 |

---

## 🔧 下一步行動建議

1. **立即：** 修復今日的 FP 問題（已部分修復）
2. **短期：** 實現 Phase 1（整合現有資源）
3. **中期：** 實現 Phase 2（Kimi Batch Verification）
4. **長期：** 實現 Phase 3-4（Self-Learning + Auto-Fix）

---

**結論：方案 A 更適合 OpenClaw，能根本解決 False Positive 問題，長期維護成本更低。**