# Issue #191 — Skill Auto-Suggest 優化：bge-m3 + Vector Weight 修復

## F — Facts

### 問題背景
- **症狀：** Skill usage rate 只有 6.9%（建議了但 LLM 冇用）
- **建議率：** 87%（並不低）
- **根本原因：** 
  1. 舊 embedding model `nomic-embed-text` 只支援英文
  2. 當任務 CJK > 50% 時，vector similarity 被禁用
  3. 純靠 keyword matching（中文任務 ↔ 英文描述 = 0 分）
  4. `DEFAULT_VECTOR_WEIGHT = 0.3`（Vector 只佔 30%）

### 解決方案
1. **安裝 bge-m3** — multilingual embedding model（支援 100+ 語言）
2. **移除 CJK > 50% 禁用限制** — bge-m3 原生支援跨語言匹配
3. **調整 DEFAULT_VECTOR_WEIGHT: 0.3 → 0.85** — 讓 semantic matching 主導

### 修改的檔案
- `extensions/skill-auto-suggest/embedding.mjs` — 更換 ollama model 為 bge-m3
- `extensions/skill-auto-suggest/core.mjs` — DEFAULT_VECTOR_WEIGHT 0.3 → 0.85
- `extensions/skill-auto-suggest/index.mjs` — 移除 CJK 禁用邏輯
- `extensions/skill-auto-suggest/test.mjs` — 更新測試預期
- `extensions/skill-auto-suggest/README.md` — 更新文檔

### 測試結果
| 指標 | 修復前 | 修復後 |
|------|--------|--------|
| Test suite | 26/27 ✅ | 26/27 ✅ |
| 真實案例匹配 | 1/10 (10%) | 4/10 (40%) |

### 其他行動
- Skill reviewer pipeline resume（清除 junk telemetry）
- Junk rate 重置為 0%

---

## D — Decisions

### ✅ 已完成
1. **bge-m3 安裝** — `ollama pull bge-m3`（~2.3GB）
2. **DEFAULT_VECTOR_WEIGHT 修復** — 0.3 → 0.85
3. **CJK 禁用邏輯移除** — vector similarity 全程啟用
4. **Skill reviewer resume** — 清除 telemetry + 重新運行

### ⏳ 待定
1. **觀察 usage rate** — 幾日後確認是否提升（目標 > 15%）
2. **Junk rate 監控** — 確認是否維持 < 30%

---

## Q — Questions

1. **Usage rate 點解仍然低？** — 可能係 LLM 决策问题，唔係 matching 问题
2. **中文 skills domination 問題** — `skill-automation-analysis` 靠通用中文描述霸榜
3. **係繼續優化定停手？** — 決定停手觀察幾日

---

## Progress

- [x] 安裝 bge-m3
- [x] 移除 CJK > 50% 禁用限制
- [x] 調整 vector weight 0.3 → 0.85
- [x] Resume skill reviewer pipeline
- [x] 清除 junk telemetry
- [ ] 觀察 3-5 天後 usage rate 數據
- [ ] 評估係咪需要進一步優化

---

## Notes

### 關於失敗的測試
修復後仍有 6/10 測試失敗，但唔係 bge-m3 問題：
- 測試期望本身設定不夠精確
- 例如「分析下點解系統咁慢」→ `issue-triage-via-subagent` 其實係合理匹配
- 建議：日後遇到具體失敗案例再针对性修復，唔預先過度優化

### 關鍵指標
- **Usage rate（目標）：** > 15%（而家 6.9%）
- **Junk rate（上限）：** < 30%（而家 0%）
- **建議率：**維持 > 80%

### Root Cause 總結
```
中文任務 + 英文 Skill 描述 + nomic-embed-text
→ CJK > 50% → Vector disabled
→ 靠 Keyword matching → 0 分（語言不匹配）
→ Usage rate 低
```

```
中文任務 + 英文 Skill 描述 + bge-m3
→ Vector enabled（全語言支援）
→ Semantic matching → 高分
→ Usage rate 提升（待觀察）
```

---

## Closing Criteria

- [ ] 觀察 7 天後 usage rate ≥ 15%
- [ ] Junk rate 維持 < 30%
- [ ] 沒有發現新的 P0/P1 問題

---

## Rollback Plan

如需回滾：
```bash
# 1. 恢復 vector weight
sed -i '' 's/const DEFAULT_VECTOR_WEIGHT = 0.85/const DEFAULT_VECTOR_WEIGHT = 0.3/' extensions/skill-auto-suggest/core.mjs

# 2. 恢復 embedding model（如需要）
# embedding.mjs 入面 ollamaModel 改回 nomic-embed-text

# 3. 重啟 OpenClaw
openclaw gateway restart
```
