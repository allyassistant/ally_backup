---
id: 107
title: MiniMax ↔ DeepSeek 自動 Context-Aware 切換系統
status: archive
priority: P2
created: 2026-05-06
due: 
updated: 2026-05-23
progress: 0/0
---

# Issue #107 — MiniMax ↔ DeepSeek 自動 Context-Aware 切換系統

**Priority:** P2 | **Created:** 2026-05-06 | **Status:** 📝 Planned
**Related:** AGENTS.md, hooks/message_received.js, openclaw.json

---

## 目的

建立自動切換機制，根據當前對話 context 使用率決定用 MiniMax M2.7（195k context）定 DeepSeek V4 Flash（977k context），以平衡速度、成本同穩定性。

## 背景資料

### Benchmark 測試結果

| 指標 | MiniMax M2.7 | DeepSeek V4 Flash |
|------|-------------|-------------------|
| Per-response 速度 | ~593ms | ~1,726ms |
| Context 上限 | 195k | 977k |
| 月費 vs 按量 | ✅ 月費已包 | $0.14/1M input |
| 繁中/粵語 | ✅ 優秀 | ✅ 更自然 |
| Thinking | ❌ | ✅ 內置 |
| Vision/OCR | ✅ MiniMax VLM | ❌ Text-only |
| 現有 context (2026-05-06) | ~160k (82%) | ~160k (16%) |

### 用家反饋

- Josh 觀察到 MiniMax 接近 195k 時變慢 + 幻覺
- OpenClaw compaction 要等（額外延遲）
- DeepSeek 1M context 完全未需要 compaction
- 一條問題速度：MiniMax 快 ~3x，但現實體驗 DeepSeek 感覺更快（冇 compaction）
- DeepSeek 係 text-only，需要保留 MiniMax 做 OCR/Vision 任務

## 技術分析

### 方案比較

| 方案 | Survive Reset？ | 自動化程度 | 複雜度 |
|------|----------------|-----------|--------|
| 1. 我每次自己 session_status 檢查 | ⚠️ 靠 AGENTS.md | 半自動 | 低 |
| 2. message_received.js Hook 自動切 | ✅ File system | 全自動 | 中 |
| 3. Fallback chain only | ✅ openclaw.json | 被動（fail 先跳） | 低 |
| 4. 混合：Hook + Fallback + 口頭通知 | ✅ | 全自動 + 通知 | 中 |

### 建議方案（混合）

**A. openclaw.json Fallback Chain（基礎）：**
```json
"primary": "minimax-portal/MiniMax-M2.7",
"fallbacks": [
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v4-pro",
  ...
]
```

**B. message_received.js Hook（主動切換）：**
- 每次收到 message，check 當前 session context %
- 如果 >80% → 改 model 為 DeepSeek V4 Flash
- 如果 <50% → 轉返 MiniMax M2.7
- Record log 俾用家知

**C. AGENTS.md 規則（後備）：**
- 我每次回覆前 session_status check
- Context >80% 通知用家

### 需要注意

- DeepSeek 係 text-only → Vision/OCR 必須保留 MiniMax
- message_received.js hook 修改 model 有限制（需測試）
- Context 係 per-session，唔係 global
- 需要 graceful handling — 如果 DeepSeek 太慢/fail，自動 fallback 返 MiniMax

## 實作步驟

### Phase 1 — AGENTS.md 規則（今晚）
- [ ] 加入 context check 規則
- [ ] 每個 session 自動 session_status

### Phase 2 — message_received.js Hook（跟進）
- [ ] 讀取 session context %
- [ ] 根據 threshold 自動切換 model
- [ ] 通知 Josh

### Phase 3 — Testing
- [ ] 測試 context >80% 時自動跳 DeepSeek
- [ ] 測試 context <50% 時自動跳返 MiniMax
- [ ] 確認 Vision/OCR 仍用 MiniMax

## 結論

先觀察 DeepSeek 用落嘅效果同穩定性，確保 fallback chain 正常運作，再決定實作自動切換。

## Links

- [AGENTS.md](~/.openclaw/workspace/AGENTS.md)
- [message_received.js](~/.openclaw/workspace/scripts/hooks/message_received.js)
- [openclaw.json](~/.openclaw/openclaw.json)
- [openclaw session_status](~/.openclaw/agents/main/sessions/)
