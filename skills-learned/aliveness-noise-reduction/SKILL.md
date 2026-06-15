---
name: aliveness-noise-reduction
description: "Detect system aliveness tests and heartbeat pings with minimal-noise responses. Use when: system sends HEARTBEAT_OK pings, aliveness probes arrive, noisy analysis is generated for trivial signals. Key capabilities: identify heartbeat patterns, suppress verbose analysis, return concise acknowledgment only."
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T12:30:00.000+08:00
---

## Workflow

1.  **偵測活躍度測試** — 當用戶輸入內容僅包含 cron 元數據或用於檢查系統活躍度的腳本命令（例如 `node scripts/... --quiet`），或者輸入的內容是明顯的系統測試時，判斷其為活躍度 ping。
2.  **❌ 檢查是否有待處理的用戶請求** — 在回應活躍度檢查之前，必須檢查是否存在未完成的用戶請求（如要求總結、分析等）。如果存在，必須優先處理用戶請求，並將活躍度檢查視為次要任務，在完成用戶任務後再簡短回應。
3.  **產生最小回應** — 如果活躍度檢查是唯一的任務，僅輸出最簡潔的確認資訊（如 `HEARTBEAT_OK`）。不要附加任何分析、對話或多餘的字句。
4.  **避免使用工具** — 除非活躍度檢查腳本失敗或需要進一步診斷，否則不要因為活躍度檢查而發起工具調用（如 `exec`、`read` 等）。最小回應不需要調用任何工具。

## Pitfalls

- ⚠️ **優先級錯誤** — 最常見的錯誤是在回應用戶請求時插入 `HEARTBEAT_OK` 回應。活躍度檢查絕不能中斷正在進行的、由用戶主動發起的對話或工作流程。應將其視為背景噪聲。
- ⚠️ **過度分析** — 如果活躍度檢查成功，不需要說「腳本完成」或「沒有錯誤」。僅僅輸出 `HEARTBEAT_OK` 已經足夠。任何額外的文字都是干擾。
- ⚠️ **將活躍度檢查與用戶任務混合** — 不要在一個完整的用戶回覆中加入 `HEARTBEAT_OK`。必須將其拆分為一個單獨的、極簡的訊息，或者（理想情況下）完全抑制它，直到用戶請求的任務完成。
