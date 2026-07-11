---
name: subagent-code-tuning-workflow
description: "Use sub-agents for surgical script edits with test flags. Use when: edits needed, test flags required, rollback possible. Key capabilities: scoped edits, test verification, state restoration."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T05:03:52.979Z
---

## Workflow

1. **分析問題範圍**
   - 列出所有需要修改的 files 及每個 issue 的優先級（P0→P1→P2）
   - 按優先級排序：P0 最緊急，先修

2. **Spawn 修復 sub-agent（每次一個 issue）**
   - 每次只 spawn 一個 sub-agent 處理一個 issue（如 C1）
   - 不要一次過 dump 6 個 fix 落同一個 patch
   - Task prompt 清晰說明：
     - 目標 script 路径
     - 具體要改什麼
     - 要用什麼驗證方式

3. **驗證修復**
   - 等 sub-agent 完成後，立即驗證
   - 用實際 command 測試（如 `exec` 直接跑 openclaw / deepseek 測試）
   - 確認 output 符合預期（JSON parse 成功、exit code 0 等）
   - 只有驗證通過才寫入 disk

4. **寫入 handoff note**
   - 紀錄修復狀態（✅/❌）、誰做的、驗證結果
   - 為下一個 issue 的 sub-agent 做準備

5. **重複步驟 2-4**
   - 對每個後續 issue 重複（從 P1 開始）
   - 不要累積多個未驗證的 fix

6. **最終整合驗證**
   - 所有 fix 完成後，跑一次 smoke test
   - 確認所有相關 script 的 `--check` syntax 通過

## Pitfalls

- ⚠️ **一次過修復多個 issue** — 累積多個 fix 落同一個 patch，萬一其中一個有問題就難追踪。應該逐個 fix 驗證後再下一個。

- ⚠️ **不驗證就寫入 disk** — sub-agent 回報完成不代表真的修復了。要用實際 command 測試（exec 直接跑），確認 output 符合預期。

- ⚠️ **假設 sub-agent 一定成功** — sub-agent 可能遇到 M3 token limit (HTTP 429)、API overload、partial completion。要準備 fallback：直接手動執行而唔靠 sub-agent。

- ⚠️ **忽略 M3 token 刷新時間** — M3 429 error 通常係 token 用完，12:00 HKT 左右常見。等下一個整點 refresh（13:00, 14:00...）再 retry。

- ⚠️ **JSON regex 貪心匹配** — `/\{[\s\S]*\}/` 會匹配到不平衡的大括號。如果 JSON 可能被其他文字包圍，用 balanced-brace extractor 代替。

- ⚠️ **Cron timeout < script max runtime** — cron 的 `timeoutSeconds` 必須大於 script 內部可能的最長執行時間。Phase 2 batch 最長 650s，cron timeout 360s 會導致 script 被 kill。

- ⚠️ **openclaw CLI flags 不存在** — 唔好用 `--prompt-file`、`--quiet`、`--max-tokens` 等 flags，這些可能不存在。要用 `--model`、`--prompt`、`--json` 並配合 `execFileSync`。

## Verification Template

每個 fix 完成後用以下 template 確認：

| Check | Command | Expected |
|-------|---------|----------|
| Syntax | `node --check <file>` | exit 0 |
| Runtime | 直接 exec 測試（如 deepseek / openclaw） | JSON output + exit 0 |
| Logic | 讀取修改後的代碼，確認邏輯正確 | N/A |
