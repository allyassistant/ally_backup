---
name: m3-subagent-article-analysis
description: Spawn M3 sub-agent 分析外部文章，評估架構適用性，寫入 Obsidian 並回傳摘要
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-11T19:33:15.621Z
---

## Workflow

1. **Spawn M3 sub-agent** — 使用 `SPAWN_QUALITY` route，傳入 article URL 和 intent 提示（見下面 Prompt Template）
2. **收集架構評估回傳** — M3 會返回：
   - 文章核心發現（key findings）
   - 與現有架構的對比分析（comparison matrix）
   - 建議的整合方案（recommended approach）
3. **掃描現有 codebase 重复** — 在收到 M3 建議後，主動檢查現有 scripts 是否已有類似功能：
   - `grep` 相關關鍵字於 `scripts/` 目錄
   - 比對 M3 建議 vs 現有實作的功能覆蓋度
   - 如果發現 ≥80% 重疊，優先考虑修改現有 script 而非創建新 script
4. **產出方案比較表** — 用 markdown table 格式呈現：
   | 方案 | Detection Lag | 新 Script | Cron 數 | Effort |
   |------|:------------:|:---------:|:-------:|:------:|
   | **A** — ... | ... | ... | ... | ... |
5. **寫入 Obsidian** — 將分析結果寫入 `~/obsidian/architecture-review/<date>-<source>.md`
6. **升級為 L2 Issue（如適用）** — 如果建議涉及系統性變更：
   - 創建 P2+ issue
   - 升級至 L2 SOP 格式（見 AGENTS.md Issue Quality SOP）
   - 包含：F/D/Q sections、Progress checklist、Closing criteria、Rollback plan、Cross-references

## Prompt Template（用於 Spawn）
