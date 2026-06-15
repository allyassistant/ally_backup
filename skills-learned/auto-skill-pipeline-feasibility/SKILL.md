---
name: auto-skill-pipeline-feasibility
description: "Systematic evaluation of auto skill pipeline feature feasibility with architecture reality check, documentation tracing, and file:line citation. Use when: new pipeline features proposed, architecture feasibility assessment needed, documentation tracing required. Key capabilities: architecture reality check, documentation tracing, file:line citation, pipeline feasibility scoring."
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-12T11:34:04.932Z
---

## Workflow

1. **Define scope boundaries** — 清楚列出 4 個 sub-goal，每個具體係做乜、範圍幾大、用戶係邊個（Josh / system / sub-agent）

2. **Reality check existing code** — 掃描相關 script 源代碼，確認 "而家係點做嘅"。好多時用戶假設某個功能未做，但實際上已經 wired。

3. **Build evidence table** — 兩欄對比：
   - 左欄：用戶以為 / task brief 聲稱
   - 右欄：實際代碼 reality（file:line citation）
   
   呢個係區分 feasibility study 同一廂情願嘅關鍵。

4. **Identify the real new surface** — 從 evidence table 拎 "已做" 嘅功能，剩余未做或部分做嘅功能就係真正需要做嘅範圍。

5. **Document findings with citations** — 每個 claim 都要有 `file:line` 引用，唔係 "應該係咁" 或 "大概". 引用方式：
   - 函數调用：`script.js:410`
   - 配置值：`config.json:23`
   - Cron schedule：`crontab -l` output

6. **Assess dependency graph** — 新功能 A 依賴功能 B？拆開睇，避免一口氣做全部。常用分層：
   - Week 1：Safety nets（backup、fence、quarantine）
   - Week 2：Core loop
   - Week 3：Edge cases

7. **Output structured report** — 保存到 `.spawn/reports/<descriptive-name>-<date>.md`，方便日後翻查。

## Pitfalls

- **Task brief assumption ≠ reality**：最常見錯誤係 assume 用戶描述 = 實際架構。必ず要 code dive 驗證。例子：task brief 話 "需要 1-click approval"，但實際上 auto-symlink 早已 wired。

- **把 "已做" 當 "未做" 做**：浪費時間重新發明輪盤。Before 分析，現有代碼起碼要 read 一遍。

- **引用格式唔一致**：每個 claim 都要有 `file:line` 引用，否則日後無法驗證。引用格式：`path:lineNumber`。

- **Scope creep**：一次 feasibility study 可能發現 10 個新問題，但唔好一次過全部做。用 Week 分層。

- **唔保存 report**：Analysis 完成後要即時保存到 `.spawn/reports/`，唔係留喺 session history 入面俾 truncation 影響。

- **唔區分 "分析緊乜" 同 "修復緊乜"**：Feasibility study 係 analysis phase，唔係 implementation phase。搞混咗會浪費時間喺 research 而唔係 building。

- **唔考慮 fallback**：每個新功能要問：如果 X fail 會點？thin executor 定 full LLM？呢個係系統性思維。

- **唔檢查 system skills**：好多功能（skill matching、context gathering）可能已經喺 `skills/` 入面係 system skill，唔需要另外創建 learned skill。

- **Assume user know system internals**：用戶提嘅功能名稱可能係佢自己嘅 mental model，唔一定對應實際代碼。Always verify。

- **忽略現有 skill catalog 重疊**：分析新功能之前，先 check `skills-learned/` catalog，避免重複建設。
