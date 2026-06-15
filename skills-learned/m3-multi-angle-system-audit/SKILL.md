---
name: m3-multi-angle-system-audit
description: "Spawn M3 sub-agent for multi-angle health audit. Use when: health audit needed, multi-angle analysis required, decisions pending. Key capabilities: M3 spawn, multi-angle analysis, decision support."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T09:45:01.049Z
---

## Workflow

1. **Clarify the audit objective** — User asks "Spawn M3 深入分析" 或 "睇吓而家應該做啲咩" 時，先確認要分析邊個系統範圍。典型範圍包括：cron jobs 狀態、pipeline 執行、E2E 測試覆蓋、跨系統一致性。

2. **Identify the 4 analysis angles** — 根據系統架構，拆解為四個可並行審計的角度：
   - 🔍 **Cron config correctness** — 檢查 cron job 配置與 script 內部 model config 的一致性
   - 🧪 **LLM judge E2E 真實測試** — 用 `--force` flag 跑 batch，驗證 judge chain 實際運作
   - 🔗 **Pipeline integration** — 審計 execFileSync vs execSync、queue 狀態、step ordering
   - ⚖️ **Cross-system consistency** — 檢查 router configs、env vars、spawn config 是否 drift

3. **Spawn M3 sub-agent with structured prompt** — 使用 `sessions_spawn` 工具發送 M3，prompt 需包含：
   - 明確的四角度審計目標
   - 預期輸出格式（每角度 findings + 綜合建議）
   - 可用的工具權限（exec, read, sessions_spawn）

4. **Await auto-announce results** — M3 sub-agent 完成後會自動 announce 結果。唔需要主動 poll，等佢完成。

5. **Parse and present findings** — 收到 M3 回傳後，按四個角度分組呈現，highlight 關鍵問題同建議優先順序。

6. **Informed next action** — 根據 M3 建議，決定係即時執行修復、創建 issue、還是 further investigation。

## Pitfalls

- ⚠️ **Single-angle bias** — 只 request M3 做一個角度的分析（如單純 cron health check），忽略 pipeline 整合問題或 cross-system drift。確保四個角度都涵蓋，唔係會漏掉跨層問題。

- ⚠️ **Unstructured spawn prompt** — prompt 唔夠具體時，M3 可能只做表面 scan 而唔深入每個角度。必須喺 prompt 明確列出四個審計維度同預期 output format。

- ⚠️ **M3 output token limit** — 複雜的多角度審計可能超出 M3 output token limit（~8K），導致 partial completion。監察 M3 回傳長度，若截斷需手動執行唔依賴 sub-agent（見 `subagent-context-overflow-recovery`）。

- ⚠️ **Same-model rate limit collision** — 若 main session 同 sub-agent session 同時用 M2.7，會觸發 rate limit。確保 sub-agent 用 M3（`--model MiniMax-M3`），main session 用 M2.7 分離。

- ⚠️ **Interpreting "success: true" as all-clear** — transcript 顯示 `Success: true` 只代表工具執行無拋錯，唔代表系統無問題。M3 審計發現的 warning/error 狀態仍需跟進。

- ⚠️ **Orphaned isolated session** — 若 sub-agent session 無正常 close，會殘留喺 systemEvent session list，造成 drift。spawn 前確認 session isolation 配置正確。

## References

- `subagent-m3-reliability` — M3 sub-agent failure diagnosis and recovery when output is partial or NO_REPLY
- `subagent-context-overflow-recovery` — Fallback when M3 crashes due to token limits
- `cron-config-audit` — Cron job configuration consistency checking (Angle 1 deep-dive)
- `pipeline-llm-call-timeout-debugging` — Pipeline integration issues (Angle 3 deep-dive)
- `concurrent-session-rate-limit-avoidance` — Rate limit collision avoidance between sessions
