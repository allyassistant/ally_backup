---
name: pipeline-heartbeat-debugging
description: 如何識別與修復 LLM pipeline 輸出 heartbeat 佔位符而非實際內容的問題
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-08T04:01:04.847Z
---

## Workflow

1. **觀察輸出**：檢查 LLM 回應是否包含 `HEARTBEAT_OK` 或其他 heartbeat 標記（而非預期的實際內容）
2. **確認失敗**：若輸出是 heartbeat 而非內容，pipeline 已靜默失敗。工具 call 仍報告 `success: true`，但內容為空
3. **終止當前流程**：不要嘗試繼續處理 — heartbeat 輸出代表上游步驟未生成內容
4. **重新執行核心步驟**：直接再次呼叫 LLM（或上游工具），不依賴 pipeline 的中間結果
5. **驗證新輸出**：確保新回應包含實際內容，而非 heartbeat 標記
6. **如持續失敗**：檢查上游 pipeline 配置、timeout 設定、或模型調用參數

## Pitfalls

- **不要忽略 `HEARTBEAT_OK`**：看似成功但實際是佔位符。若直接回覆用戶，會顯示 "All good" 而非實際內容
- **工具回應 `success: true` 不等於內容有效**：Pipeline 可能在內容生成失敗時仍報告成功
- **避免深層追蹤 pipeline 源代碼**：問題通常是 timeout 或模型回應被截斷，優先重新執行而非除錯
- **別在 heartbeat 輸出上繼續下游處理**：下游步驟無法處理空內容，只會產生更多 heartbeat
