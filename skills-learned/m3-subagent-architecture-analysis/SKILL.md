---
name: m3-subagent-architecture-analysis
description: "Spawn MiniMax M3 sub-agent for architecture and system analysis with adaptive thinking fallback and structured result collection. Use when: architecture analysis needed, system analysis with fallback required, structured result collection needed. Key capabilities: M3 sub-agent spawn for architecture, adaptive thinking fallback, structured result collection."
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T21:01:01.225Z
---

## Workflow

1. **解析用戶意圖** — 確認係架構分析任務（唔係文章分析），判斷係咪適合 M3 quality tier。典型觸發句：「spawn MiniMax M3 sub agent 睇晒有關 XXX 嘅 issue，睇下下一步應該做咩」

2. **取得 spawn config** — 從 `~/.openclaw/spawn_config.json` 讀取 M3 模型配置，包括模型名稱、溫度、max_tokens 等參數

3. **配置 thinking mode** — 嘗試 `thinking:high`，但 M3唔支援 high mode。需要 fallback 到 `adaptive` thinking（無 explicit thinking 參數），否則 sub-agent 會立即返回 NO_REPLY

4. **Spawn sub-agent** — 用 `sessions_spawn` 工具發送任務，確保：
   - 傳遞完整 context（所有相關 issue、memory sink 狀態、相關 cron 配置）
   - 設定預期輸出格式（structured analysis with findings + recommendations）
   - 唔好 busy-poll 等結果 — sub-agent 會自動 announce 結果

5. **等待並接收結果** — sub-agent 完成後自動收到回傳，包含分析結果

6. **Post-process** — 將 M3 分析結果：
   - 摘要關鍵發現（🚨 critical bugs / 📊 insights）
   - 確認是否需要跟進（spawn further fix sub-agents）
   - 考慮發送 Discord summary 到相關 channel

## Pitfalls

- ⚠️ **M3 `thinking:high` not supported** — 直接用 `thinking:high` 參數會導致 sub-agent 立即 NO_REPLY。必須用 `adaptive` 或省略 thinking 參數，否則整個 spawn 失敗

- ⚠️ **Context overflow risk** — 架構分析任務涉及多個 system components（memory/、wiki/、Obsidian、skills-learned/、cron configs），token 消耗高。M3 sub-agent 的 max_tokens 如果設定太低，分析會被截斷。預先估算 context size，超過 30KB 考慮分段傳遞

- ⚠️ **Sub-agent results never arrive** — sessions_spawn 是 fire-and-forget，如果 sub-agent 遇到 output token limit 或 API overload，會 partial completion 但唔會主動通知。需要在 spawn 前設定 output size expectation，並在收到結果後驗證 completeness

- ⚠️ **Vault path assumption mismatch** — M3 分析時常假設 Obsidian vault 在 `~/obsidian-vault/` 或 `~/obsidian/`。實際路徑係 `~/Documents/Obsidian Vault/`（有空格）。任何涉及 vault path 的 sub-agent 任務都要明確傳遞正確路徑，否則 analysis 會基於錯誤 assumption

- ⚠️ **Skills-learned 孤島效應** — M3 sub-agent 分析 knowledge architecture 時，可能唔知道 `skills-learned/` 係其中一個 sink。需要明確告知佢 skills-learned 的位置、數量（~50 files）、結構（frontmatter + SKILL.md），否則 analysis 會漏計呢個 sink

- ⚠️ **Auto-reply vs manual polling confusion** — sessions_spawn 的結果係自動 announce 到 requester，但主 agent 有時會重複 spawn 同一個 sub-agent（因為唔確定第一次係咪成功）。識別重複 spawn 請求，如果同一 task 已經在 queue 中，直接報告狀態而唔再 spawn
