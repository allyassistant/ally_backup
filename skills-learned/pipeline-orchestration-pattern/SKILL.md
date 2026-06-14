---
name: pipeline-orchestration-pattern
description: 將多個獨立階段（reviewer → junk pause → fallback）串聯成單一 pipeline script，配合 --quiet 模式供 cron 執行
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T02:05:06.740Z
---

## Workflow

1. **識別階段邊界** — 分析需要串聯的工作階段（例如 reviewer、junk pause、pitfalls fallback），每個階段應為獨立可執行的單元
2. **建立 pipeline 主控腳本** — 建立單一 JS 腳本（例如 `skill_reviewer_pipeline.js`），用 `const { execSync }` 或 child_process 依序呼叫各階段模組
3. **實作 --quiet 模式** — 在腳本開頭解析 `--quiet` flag，抑制 stdout/stderr 輸出，確保 cron 執行時不產生噪音
4. **串聯階段 + 錯誤處理** — 每個 `execSync` 包在 try-catch，失敗時記錄錯誤但繼續執行後續階段（graceful degradation）
5. **驗證階段狀態** — 執行完畢後输出階段狀態摘要（例如 "reviewer: ok, junk pause: ok, pitfalls fallback: ok"）
6. **測量執行時間** — 在腳本層級記錄總執行時間，監控效能（例如 133ms）
7. **配置 cron trigger** — 將 pipeline script 加入 cron schedule，確保 `--quiet` flag 傳遞正確

## Pitfalls

- ⚠️ **階段之間狀態洩漏** — 前一階段的輸出可能污染後續階段的 input，確保每個階段有獨立的 filesystem context 或明確的 input/output boundary
- ⚠️ **--quiet flag 解析位置錯誤** — 如果在 execSync 內層解析 flag，會導致部分輸出仍外洩；应在 script 入口點頂層解析
- ⚠️ **Pipeline 阻塞在高耗時階段** — 如果某個階段（如 LLM call）超時，會卡住整個 pipeline；添加階段級別 timeout（`execSync` 第三個參數 `options.timeout`）
- ⚠️ **階段失敗後錯誤狀態覆蓋** — 最後報告 "all stages ok" 但中間有階段失敗了；每個階段要有明確的 pass/fail state，不被後續覆蓋
- ⚠️ **Cron schedule 與 pipeline 執行時間衝突** — 如果 pipeline 執行時間 > cron interval，會積壓重疊執行；添加 pid lock file 防止並發
