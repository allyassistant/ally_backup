---
name: script-integration-analysis
description: 分析兩個週期性 script 是否應該合併、串聯或保持獨立的工作流程
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-10T14:31:05.885Z
---

## Workflow

1. **確認目標與候選清單**
   - 用戶問「X script 值唔值得整合入 Y」，或「呢3個 script 係咪可以合併」
   - 確認 target bot/script（整合目標）和 candidate scripts（候選清單）
   - 用 `exec` 讀取所有相關檔案，確認行數、架構、shared utilities

2. **量化 Code Overlap**
   - 比對 duplicated helpers（log, loadState, saveState, runChild, nowHktString 等）
   - 計算每個 helper 在各 script 中的重複行數
   - 識別 shared state file、Discord webhook、schedule pattern
   - 輸出量化表格：每個 helper 在邊個 script 出現、行數、Verdict（合併/保留）

3. **判斷整合價值**
   - 價值維度：減少未來 bug multiplier、減少維護負擔、統一行為
   - 成本維度：refactoring 時間、風險、測試需求
   - 如果所有候選 script 都健康運行中 → 「值得做，但唔 urgent」
   - 如果有重複 bug 或行為不一致 → 「urgent，整合有直接價值」

4. **Spawn M3 Sub-agent 做 Architecture Analysis（可選但推薦）**
   - 當涉及大量 code review（>500 LOC 候選）或架構抉擇時，用 M3 分析
   - 準備詳細 brief：target bot 資料、candidate scripts 行數與功能、specific questions
   - 用 `sessions_spawn` 發送 M3 任務，設定 `model: m3`
   - M3 自動完成後 relay 結果給用戶（用繁體中文）

5. **向用戶報告建議**
   - 格式：`值得做/唔值得做` + 原因（價值維度 + 成本維度）
   - 如果值得做：提供 next step（立即做 / 之後做）
   - 如果唔 urgent：問用戶係咪想立即搞

## Pitfalls

- **唔好假設用戶已知邊3個 script** — 先確認候選清單再開始分析
- **唔好盲目相信 issue 描述** — #148 的相對路徑問題需要實際 inspect，唔係直接抄 issue 內容
- **唔好喺 group chat 用 message tool** — 在 #🧑🏻‍💻編程 等 group chat 正常回覆，唔好用 DM
- **M3 sub-agent 需要清晰 brief** — 唔好叫佢「自己 read晒所有檔案」，要俾已 gather 嘅 context + 具體問題
- **Context overflow 風險** — 大量 tool calls（100+）會觸發 context overflow，如果 session 太長考虑截斷舊 outputs 再重試

## M3 Sub-agent Brief Template

```
## Context (already gathered for you)
**Target bot:** [path] (X lines)
- [brief description]

**3 candidate scripts:**
1. [path] (Y lines) - [功能描述]
2. [path] (Y lines) - [功能描述]
3. [path] (Y lines) - [功能描述]

**Questions:**
1. [具體問題1]
2. [具體問題2]
