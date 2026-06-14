---
name: documentation-code-drift-detection
description: 檢測並修復代碼變更期間文檔與實際行爲的漂移，包括重複段落、事實錯誤、和遺漏更新
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-10T04:34:07.564Z
---

## Workflow

1. **列舉改動範圍** — 完成代碼變更後，立即列出所有修改過的檔案，包括 `.md` 文檔
2. **識別相關文檔** — 用 `grep -r "<keyword>"` 搜索所有 `.md` 檔案中與改動相關的章節（關鍵字通常是功能名、模型名、配置鍵）
3. **檢查重複段落** — 搜索是否存在同標題的多個章節（常見於 AGENTS.md 的 `## Fallback` 或 `## Route` 段落）
4. **交叉驗證事實** — 比對文檔描述的模型/行爲與實際代碼中的 `const` 值、YAML 映射、測試斷言
5. **驗證 Issue Body** — 如果變更有對應的 issue，檢查其 `改動範圍 table` 是否列齊所有檔案，測試數量是否準確
6. **修復並確認** — 用 `edit` 修復所有 drift，運行 `grep` 確認無殘留矛盾

## Pitfalls

- **忽略 .md 檔案** — 只更新代碼忘了更新文檔，尤其是 AGENTS.md、HEARTBEAT.md、SOUL.md
- **重複段落陷阱** — 多次變更時可能在文檔末尾追加新段落而非更新舊段落，導致同標題多個版本內容矛盾
- **事實漂移** — 文檔寫 `M3` 但代碼實際用 `M2.7`，或 fallback 鏈與實際配置不符
- **Issue 內容過期** — Issue 建立時的假設（test count、影響範圍）後來被更新，但 issue body 未同步
- **只 grep 未校對** — 搜索到關鍵字不等於內容正確，必須人工比對代碼與文檔的實際值

## Trigger Signals

- 代碼變更涉及模型配置、路由邏輯、YAML 結構
- 用戶提到「AGENTS.md drift」或「文檔不一致」
- Issue 建立後代碼持續迭代超過 3 個 commit
- 發現 `grep` 結果中同一標題出現 ≥2 次

## Reference Examples

### AGENTS.md 重複段落檢測
```bash
grep -n "## Fallback" ~/.openclaw/workspace/AGENTS.md
# 預期：每個標題只出現 1 次；出現 2+ 次 = 需合併
