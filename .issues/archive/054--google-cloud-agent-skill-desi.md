---
id: 054
title: 實施 Google Cloud Agent Skill Design Patterns
status: archive
priority: P2
created: 2026-03-19
due: 2026-04-09
updated: 2026-04-07
progress: 5/5
---

## Progress Update (2026-04-04)

### ✅ Reviewer Pattern 已完成！

#### 完成功能

1. **`impact <script>` 指令** ✅
   - 分析 script 依賴關係
   - Safety 檢查（try-catch、shell injection）
   - Cron Jobs 影響
   - 輸出影響範圍報告

2. **`deploy-check` 指令** ✅
   - 掃描所有最近修改的檔案
   - 全面審查：語法、Safety、依賴、Cron
   - Deploy Checklist + y/N 確認
   - 等用戶確認後先執行

3. **Kimi CLI 鉤入** ✅
   - `checkScriptModification()` - 檢測任務是否涉及 scripts 修改
   - `runImpactAnalysis()` - 自動運行 impact 分析
   - 用 Kimi 改 scripts 時自動顯示影響範圍警告

4. **AGENTS.md + TOOLS.md 規則** ✅
   - Reviewer Pattern 規則已寫入
   - 使用流程已記錄

#### 指令速查

| 指令 | 功能 | 確認？ |
|------|------|--------|
| `--fix` | 自動修復 | ❌ |
| `--dry-run` | 預覽修復 | ❌ |
| `impact <script>` | 影響分析 | ❌ |
| `deploy-check` | Deploy 把關 | ✅ y/N |

---

## 5種 Design Patterns 狀態

| Pattern | 狀態 | 說明 |
|---------|------|------|
| Tool Wrapper | ✅ | SKILL.md |
| Pipeline | ✅ | Cron jobs |
| Generator | ✅ | report_generator.js |
| System Check Bot | ✅ | Reminders + Errors |
| **Reviewer Pattern** | ✅ | impact + deploy-check |
| Inversion | 🔄 | 有需要時實施 |

---

## Progress Update (2026-03-23)
- [x] Tool Wrapper ✅ (done)
- [x] Pipeline ✅ (done)
- [x] Generator Pattern ✅ (done)
- [x] System Check Bot ✅ (done)
- [x] Reviewer Pattern ✅ (done - 2026-04-04)
- [ ] Inversion Pattern

---

## Next Steps

- [ ] 觀察 3 日確認 deploy-check 運作正常
- [ ] 根據實際使用調整規則
- [ ] Inversion Pattern（複雜任務時考慮）

---

## Description
參考 Google Cloud 官方提出既 5 種 Agent Skill Design Patterns，系統化改進我地既 Skill 設計。

**來源:** Google Cloud Tech (100.4萬觀看)
**文章連結:** https://x.com/googlecloudtech/...

---

## Inversion Pattern - 待討論

### 概念
複雜任務之前，我做「採訪者」，確保完全理解先行動。

### 應用場景
| 場景 | 問題例子 |
|------|---------|
| 刪除檔案 | 「確定係刪呢個？呢個動作冇得undo」 |
| HA 架構改動 | 「你確定要改Failover邏輯？會影響雙機協作」 |
| 批量刪除 | 「你準備刪除 50 個檔案，係咪繼續？」 |

### 實現方案

**Option A：危險操作鉤入**
- 當準備執行高風險操作，自動觸發確認
- 定義危險操作 pattern：rm -rf、DROP TABLE 等

**Option B：自動問題清單**
- 複雜任務之前，自動問問題清單
- 確保完全理解先執行

### 優先選擇
- 簡單版：危險操作前問確認
- 進階版：自動問題清單

---

## 相關文檔
- `scripts/auto_fix.js` - Reviewer Pattern 實現
- `scripts/kimi_cli_runner.js` - Kimi CLI 鉤入
- `AGENTS.md` - Reviewer Pattern 規則
- `TOOLS.md` - Reviewer Pattern 指令文檔
