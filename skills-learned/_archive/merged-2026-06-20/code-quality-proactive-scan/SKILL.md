---
name: code-quality-proactive-scan
description: 系統性執行代碼質量主動掃描，自動分類問題嚴重性，並根據位置（production/tmp/test） triage 補救行動
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T02:31:07.825Z
---

## Workflow

1. **觸發掃描** — 執行 `node /Users/ally/.openclaw/workspace/scripts/code_quality_manager.js fix --quiet --enable-skill-scan`，使用 `--quiet` 模式避免 cron 輸出噪音

2. **解析結果** — 從 stdout 提取分類數據：
   - Critical / High / Medium / Low 問題數量
   - Auto-fixable 問題數量
   - 掃描耗時（用於效能監控）
   - 具體 issue type（如 `fsSync_missing_trycatch`）

3. **按嚴重性分組** — 分離 production script 問題與 tmp_*/test file 問題：
   - Critical/High 優先處理，特別是出現在 production scripts 的
   - Medium/Low 通常屬於 code quality 改善，非 urgent

4. **位置 triage** — 關鍵判斷邏輯：
   - 如果 High issues 全部集中喺 `tmp_*` 或 `test files` → 結論：唔影響 production，無需跟進行動
   - 如果 production scripts 有 High/Critical → 觸發修復流程
   - Low issues（magic numbers 等）→ 視乎團隊 code style 政策

5. **結論呈現** — 用 Emoji 格式報告結果：
   - 🔴 Critical: N
   - 🟠 High: N（註明位置分佈）
   - 🟡 Medium: N
   - 🟢 Low: N
   - 🔧 Auto-fixable: N

6. **後續行動閾值** — 建議跟進條件：
   - 有任何 Critical 問題 → 立即修復
   - High 問題出現在 production scripts → 48 小時內修復
   - High 問題只在 tmp/test files → 視為技術債，計劃性清理

## Pitfalls

- ⚠️ **只看總數不看分佈** — CQM 報告 High: 10 如果全部喺 tmp_*，結論係「無需跟進」；但如果其中 1 個喺 production，就變成「需跟進」。必須拆解位置資訊。

- ⚠️ **誤判 magic numbers 嚴重性** — Low issues 如 magic numbers 屬於 code quality 改善，通常唔需要即時行動，但可列入 refactoring backlog。

- ⚠️ **忽略 auto-fixable 數量** — 如果有 auto-fixable 問題，應該嘗試自動修復而非直接忽略，避免問題累積。

- ⚠️ **掃描耗時異常** — 正常 CQM scan 282 files 約需 0.17s。如果耗時突然增加，可能表示 codebase 結構變化或 scanner 本身有問題。

- ⚠️ **tmp_* 檔案殘留** — 大量 `tmp_*` 檔案出現 trycatch 問題，表示有暫存腳本未清理。這類檔案遲早會被刪除，修復價值有限。

## References

- CQM script path: `~/.openclaw/workspace/scripts/code_quality_manager.js`
- Issue types: `fsSync_missing_trycatch`, `magic_number` 等定義於 scanner 規則集
- 觸發頻率: 每小時一次（由 cron 控制）

## Related Skills

- `system-code-debug-triage` — 被動式 bug 修復流程（當問題已經浮現時使用）
- `cron-health-triage` — Cron job 健康狀態 triage（本技能專注代碼質量，cron-health-triage 專注排程健康）
