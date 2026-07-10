# Absorbed from `skill-automation-analysis` (extracted from skill-curation-pattern)

> **Provenance:** Merged via `scripts/merge_skills.js` (2026-06-20). Original location: `skill-automation-analysis/SKILL.md` (now archived in `_archive/merged-2026-06-20/skill-automation-analysis/`).
> **Why extracted:** Content is M3 sub-agent ROI analysis workflow — distinct enough from `skill-curation-pattern` core workflow to be reference material rather than core steps.

## Workflow

1. **掃描現有 Skills**
   - 讀取 `skills-learned/` 目錄所有 SKILL.md
   - 列出每個 skill：name、size、status（active/draft）、關鍵 steps
   - 對比現有 cron schedule（`~/.openclaw/config.yaml`），避免 overlap

2. **Spawn M3 Sub-agent 做深度分析**
   - `sessions_spawn` with model `M3`, thinking level `high`
   - Task：
     a. **Categorize 每個 skill** into 3 類：
        - **Type A — Cron-able**：可以 set 做 isolated cron job（`node scripts/xxx.js` 模式）
        - **Type B — Integration target**：可以 hook 入現有 script（`scripts/` 已有嘅流程）
        - **Type C — Manual SOP**：需要人手 trigger，唔值得自動化
     b. **計算 ROI**（effort vs frequency × impact）
        - High ROI：cron-able + high frequency（daily/weekly）
        - Medium ROI：integration target，reduces manual effort
        - Low ROI：manual SOP，frequency 太低
     c. **Output**：`/tmp/skill_analysis/report.md`（structured Cantonese）
        - 每個 skill 一段：name、type、action、effort、trigger scenario
        - Top 3 ROI recommendations table
        - Full 25+ skill 列表

3. **Delivery 格式**
   - Report 為 Markdown，儲存喺 `/tmp/skill_analysis/report.md`
   - Main session 讀取 report，做 executive summary（top 3 table）
   - 如果 user 跟進，按 report action item 執行

## Pitfalls

- **唔好 analysis 自己** — `skills-audit-workflow`、`skill-quality-verification` 係 pipeline skill，唔需要 automation analysis
- **避免 cron overlap** — 讀取 cron schedule 確認現有 jobs，先 analysis 再建議新 cron
- **Type A 要確認 thin executor 可行** — 如果 skill 需要 LLM reasoning，唔適合 cron（要用 agentTurn），呢個係「fragile cron」唔係 automation candidate
- **Effort 評估要實際** — 計算 token cost、setup time、maintenance overhead；唔好 just say "easy" without estimating
- **Report 要有 trigger scenario** — 只寫 "set as cron" 唔夠，要寫清楚幾時 trigger（e.g. 週五 09:00 HKT when Rapaport email arrives）
