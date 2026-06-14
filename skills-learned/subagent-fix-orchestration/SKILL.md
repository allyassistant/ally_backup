---
name: subagent-fix-orchestration
description: 當上遊分析完成後，將多個修復任務委托畀 M3 sub-agent，包括目標腳本發現、fix list 傳遞、yield/poll 完成追蹤
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-12T16:42:05.820Z
---

## Workflow

1. **Identify fixes with priorities**
   - 從上遊分析或 investigation session 取得完整 fix list
   - 每個 fix 標注優先級（P1/P2/P3）和預計實現時間
   - 確認 fix 之間是否有依賴關係

2. **Discover target script**
   - 用 `grep -r` 或 `find` 定位目標腳本
   - 優先搜索 workspace/scripts/ 目錄
   - 如果有多個候選，用 `read` 確認正確的目標
   - 記錄找到的路徑，供下一步使用

3. **Spawn M3 sub-agent with fix list**
   - 調用 `sessions_spawn` 啟動 M3 sub-agent
   - 在 spawn prompt 中清晰說明：
     - 目標腳本路徑
     - 完整 fix list（每項含優先級和描述）
     - 實現約束和預期行為
   - 附帶相關文件 context（read 目標腳本後傳遞）

4. **Yield and poll for completion**
   - 立即調用 `sessions_yield` 讓出控制權
   - 用 `process` 工具 poll sub-agent session
   - 設置合理 timeout（通常 120 秒）
   - 檢查 poll 結果，確認所有 fix 已實現

## Pitfalls

- ⚠️ **File discovery needs multiple attempts** — grep/find 可能第一次找不到正確腳本，需要調整 search term 或範圍。解決：用多個並行的 grep strategy 而不是單一嘗試

- ⚠️ **Spawn without explicit context causes fix/file mismatch** — sub-agent 可能搞混邊個 fix 應用於邊個文件。解決：在 spawn prompt 中明確列出每個 fix 對應的目標文件

- ⚠️ **Blind yield without poll timeout hangs session** — 如果 sub-agent 失敗或卡住，blind yield 會令 session 永遠等待。解決：總是在 poll 時指定 timeout，並實作 failure recovery 邏輯

- ⚠️ **Fix list without priority ordering leads to wrong sequence** — sub-agent 可能按錯誤順序實現 fix。解決：在 fix list 中明確標注優先級，用結構化格式（P1/P2/P3 + 描述）呈現

- ⚠️ **No file context provided at spawn time** — sub-agent 需要在實現前讀取目標文件。解決：在 spawn 前先 read 目標腳本，將關鍵內容傳遞給 sub-agent

## References

- `skills-learned/context-gather-subagent-orchestrate/` — 預先 gathered context 再 spawn M3 sub-agent 嘅標準模式
- `skills-learned/parallel-subagent-implementation/` — 多軌並行 sub-agent spawning（適用於多個獨立的 fix track）
- `skills-learned/subagent-m3-reliability/` — M3 sub-agent failure 診斷和恢復（包括 output token limit、API overload、partial completion）
- `skills-learned/subagent-context-overflow-recovery/` — 當 sub-agent 大型任務觸發 context overflow 時嘅範圍收窄策略
