---
name: subagent-output-accessibility-recovery
description: 當 sub-agent 輸出被隔離到 sandbox 外無法讀取時，從 final message + memory flush 恢復資訊的工作流
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-11T05:31:05.839Z
---

## Workflow

1. **Spawn sub-agent with explicit output instruction**  
   當 spawn sub-agent 時，明確要求佢喺 final message 中完整總結 output（唔只話「已寫入檔案」），包括關鍵數字、decision、recommendation。如果 sub-agent 會寫檔案，指定路徑為 workspace 內可達位置（例如 `memory/`、`scripts/`、或相對路徑）。

2. **嘗試讀取 output 檔案**  
   Spawn 完成後嘗試 `read` output 檔案。如果收到 sandbox protection / permission denied error，立即轉步驟 3。

3. **從 sub-agent final message 提取資訊**  
   Sub-agent 嘅 final message 通常包含完整 summary。搜尋以下關鍵字：
   - `Key facts`、`Key deliverables`、`Summary`
   - 具體數字（分數、時間估算、steps count）
   - Decision 聲明（`recommend`、`defer`、`skip`）
   
   唔好喺 sandbox error 後放棄 — sub-agent 通常已經喺 final message 總結咗重點。

4. **檢查 memory/ 和 cross-session context**  
   如果 sub-agent 有更新 memory（例如 `memory/2026-06-11.md`），讀取該檔案。如果 cross-session context 有 dashboard briefing，提取相關資訊。

5. **Memory flush 前捕獲 sub-agent 工作**  
   如果準備發送 Discord 或做 memory flush，先將 sub-agent 嘅關鍵 output append 到 memory，確保資訊唔會因 compaction 丢失。格式：
