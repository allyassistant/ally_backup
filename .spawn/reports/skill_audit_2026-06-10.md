# Skills 實用度報告
*日期：2026-06-10 | 分析：skill_reviewer_bot | 總共：49 個 skills*

---

## 🟢 即刻可用 (Ready) — 推薦使用

### 1. `cron-thin-executor-migration`
- **用途**：將脆弱的 agentTurn cron jobs 遷移到 thin executor script，消除 LLM dependency
- **觸發場景**：Cron job 出現 `LLM request failed` / `Provider unavailable`、或需要將 cron 改為穩健模式
- **使用時間**：每個 job 約 15–20 min（backup → write script → update cron → monitor 7 days）
- **依賴**：`openclaw cron get|update|run`、Node.js built-in modules（`https`/`fs`/`path`）
- **注意**：Script 必須用 `execFileSync`（唔係 `execSync`）、state file 要 atomic write、backup 保留 7 日

### 2. `cron-model-selection-verification`
- **用途**：驗證 cron job 實際用了邊個 model，診斷意外 fallback trigger 的 root cause
- **觸發場景**：懷疑 provider health 問題、手動/自動 run 之間 model行為不一致、Provider 被指責但未有實證
- **使用時間**：10–15 min 完整調查（session jsonl trace + manual run + timing correlation）
- **依賴**：`openclaw cron run`、session JSONL files、gateway logs
- **注意**：Cron run output 顯示 FINAL model（唔係 initial），必須讀 session jsonl 先知完整 fallback chain；`"auto fails, manual succeeds"`係 scheduler cache問題，唔係 model 問題

### 3. `openclaw-config-schema-debugging`
- **用途**：繞過 OpenClaw JSON schema `additionalProperties: false` 限制，實現無法加 config 的功能
- **觸發場景**：加新 config field 後 `openclaw doctor` 自動 strip 咗個 field、gateway restart fail silently
- **使用時間**：5–10 min 確診 + 決定 workaround（env var 最快）、dist file patch 需要 restart
- **依賴**：`openclaw config.schema.lookup`、gateway logs
- **注意**：`openclaw doctor` 會 aggressive strip unknown fields；dist file patch 需要 full restart（唔係 SIGUSR1 hot reload）；`process.env` bypass schema 但要 gateway restart 先生效

### 4. `route-enforcer-plugin-debugging`
- **用途**：修復 route-enforcer hook 攔截 explicit `model=` 參數的問題，讓 sub-agent 使用指定 model
- **觸發場景**：Spawn明確指定 `model=deepseek-v4-pro` 但 sub-agent 用了 MiniMax-M2.7；特定 prompt keyword 固定被 override
- **使用時間**：5 min patch（加 guard condition） + 1 min restart + 5 min validation
- **依賴**：`~/.openclaw/extensions/route-enforcer/index.mjs`、`openclaw gateway restart`
- **注意**：Plugin-level changes 需要 full gateway restart；Cron jobs 走 system cron context，唔受 route-enforcer 影響

### 5. `parallel-subagent-implementation`
- **用途**：批量 spawn 多個 sub-agents 同時做 multi-track 改動，配合 batch-chaining 控制依賴鏈
- **觸發場景**：需要同時改多個不相關的 files、不同 phases 的代碼、或 analysis + fix 並行執行
- **使用時間**：每 batch 5–10 min setup + sub-agent 執行時間；長項目建議 batch 之間做 memory flush
- **依賴**：`sessions_spawn`、`sessions_yield`、磁盤 report 檔案（audit report → implementer path）
- **注意**：同一 file 不能同時被兩個 sub-agent 改；batch-chaining 確保 Phase N fix 完成後先再做 Phase N+1；Sub-agent 完成後必須 `exec ls` 驗證檔案真係寫到 disk

### 6. `systemevent-main-session-isolation`
- **用途**：診斷並修復 systemEvent cron 在 main session 產生 💓/👍 殘留訊息的問題
- **觸發場景**：Discord 出現無意義 💓/👍 訊息、cron job 的 output 未預期送到 Discord channel
- **使用時間**：診斷 5 min + 每個 job isolated session 測試 5–10 min + config update 2 min
- **依賴**：`openclaw cron get`、isolated session
- **注意**：即使 cron command 冇 LLM，systemEvent 仍會 inject main session 俾 model processing；`delivery.mode: "none"` 必須配合 `isolated` session 先有效；KB Ingest 等長時間 job 要預留足夠 timeout

### 7. `cron-script-model-config-audit`
- **用途**：審計 cron job 和它內部 script 的 model config 是否一致，避免 fallback chain 衝突和死循環
- **觸發場景**：Cron 用 MiniMax-M3 但 script 內部用 DeepSeek；懷疑 fallback chain 中某個 model 有 max_tokens 限制
- **使用時間**：每個 job 約 10 min（grep model config + compare table + 修復）
- **依賴**：`grep -n 'MODEL\|fallback\|model:'`、cron config
- **注意**：Cron config 的 model 只控制 agentTurn session，script 內部 `openclaw infer` 有自己 model config；MiniMax M2.5 的 max_tokens=196608 限制係 non-retryable error

### 8. `llm-call-execfile-migration`
- **用途**：將 Node.js script 中的 `execSync` shell-string LLM 調用遷移到安全的 `execFileSync` + args array
- **觸發場景**：Script 有 shell injection vulnerability、需要在 thin executor cron job 中安全地調用 LLM
- **使用時間**：每個 call site 約 10–15 min（identify + migrate + validate）；thin executor validation 額外 5 min
- **依賴**：`node --check`、validation script、cron job end-to-end test
- **注意**：`execFileSync` args 係直接 passed to execve，冇 shell interpretation；所有 paths 必須 validate 否則 relative path 會走錯；Thin executor cron jobs 可能有 hidden `execSync` calls（check dependencies）

### 9. `cron-health-triage`
- **用途**：每小時自動 scan 所有 cron jobs 健康狀態，只在有異常時 push Discord `#⚙️系統`
- **觸發場景**：Cron job fail 但冇人知、26+ 個 jobs 人手 check 太花時間（10–15 min/次）
- **使用時間**：0（自動 cron）| 1–2 秒 dry-run test
- **依賴**：`openclaw cron list --json --all`、`openclaw message send`、state file
- **注意**：Thin executor 完全冇 LLM；`consecutiveErrors` 唔等如 `lastStatus`（要睇 classified status）；`STALE_THRESHOLD_HOURS = 26` 對 monthly jobs 唔適用

### 10. `anomaly-proactive-push`
- **用途**：每30 分鐘讀 `.proactive_alerts.json`，將新 warning/critical 異常主動 push Discord `#⚙️系統`
- **觸發場景**：`pattern_proactive_trigger` 寫咗 alerts 但冇人睇；需要主動通知 critical system anomalies
- **使用時間**：0（自動 cron）| 2 秒 dry-run test
- **依賴**：`.proactive_alerts.json`、`openclaw message send`、state file
- **注意**：Thin executor 完全冇 LLM；`--auto-degrade` 必須 explicit opt-in；Skip `severity=info`（避免 spam）；`data.cron` 必須由 source script 填入，大部分現有 alerts冇呢個 field

### 11. `error-auto-issue`
- **用途**：每日 22:00 自動 scan `memory/errors.json`，將 7 日內重複 ≥3 次的 error pattern 建 P1 issue
- **觸發場景**：Recurring errors 被忽略直至惡化；人手 review errors.json 太花時間（20–30 min/次）
- **使用時間**：0（自動 cron）| 2 秒 dry-run test；`--threshold 5` 可降低 noise
- **依賴**：`memory/errors.json`、`issue_manager.js create`、state file
- **注意**：Thin executor 完全冇 LLM；`issue_manager.js create` 冇 `--body` flag，必須事後 patch file；P1 priority 慎用，`--threshold 5` 適合 production

### 12. `cron-agent-llm-failure-mitigation`
- **用途**：診斷並修復 cron agentTurn job 的 LLM request failures，區分 provider outage 和 rate limit collision
- **觸發場景**：Cron job timeout、429/5xx errors、consecutiveErrors 持續增加
- **使用時間**：10–15 min 確診 + 5 min config update + 下一個 cycle 驗證
- **依賴**：`openclaw gateway history`、`openclaw cron get`
- **注意**：Config update 之後舊 retry 仍用舊 config；Same-model fallback dead loop 要避免；`consecutiveErrors` reset 只係下次成功之後，唔係 config update 即時

### 13. `cron-failure-investigation`
- **用途**：系統性調查 cron job failure alert — 建 timeline、診斷 model/fallback、認清 root cause、向用戶報告
- **觸發場景**：收到 cron failure alert、`consecutiveErrors ≥ 3`、LLM call fail
- **使用時間**：15–20 min 完整 investigation（timeline + manual re-run + root cause classification）
- **依賴**：`openclaw gateway status`、cron history、script source code
- **注意**：Provider-side failure 唔等如 script bug；Cron session 本身唔支援 LLM call（Layer 2 LLM 喺 script 內部）；某些 script 的 LLM fallback 返回 `null` 係預期行為

### 14. `cron-systemevent-migration`
- **用途**：將 cron jobs 從 systemEvent+main session 遷移到 agentTurn+isolated，batch 追蹤進度
- **觸發場景**：需要消除 main session 💓/👍 殘留、大量 cron jobs 需要 migration、跨 session 協調
- **使用時間**：每 batch 3 個 jobs 約 20–30 min（包括 isolated session 測試）
- **依賴**：`openclaw cron get|update|run`、`.issues/active/` tracking issue
- **注意**：唔好一次過遷移超過 3 個 jobs；唔好漏 HEARTBEAT.md；唔好靠記憶，每次 session 都要更新 issue

### 15. `subagent-sideeffect-containment`
- **用途**：設計 shared utilities 的安全 defaults，防止 sub-agents 意外觸發 Discord/檔案 write 等 side effects
- **觸發場景**：Sub-agent 觸發了唔預期的 notification、shared state file 被 corrupt、utility 被多重 caller 調用
- **使用時間**：10 min trace call graph + 10 min 加 opt-in flag + 5 min verify all callers
- **依賴**：`grep -rn` 全 codebase search、cron job payloads
- **注意**：Opt-in flag (`--notify`) 係唯一穩健方案，opt-out flag (`--no-X`) 遲早有人漏傳；Shared utility 改 default 後 cron jobs 要 verify 仍然正常

### 16. `multi-session-resumption`
- **用途**：用戶問「記唔記得我地做到邊到」時，從 issues + memory + history 重建 context，輸出 compact status
- **觸發場景**：Session expiry / context timeout 後繼續工作、跨 session 做 complex project
- **使用時間**：5 min rehydration（讀 issue file + session history + live state spot-check）
- **依賴**：`issues/<id>.md`（canonical）、`memory_search`、`sessions_history`
- **注意**：`issues/` 係 canonical，唔係 memory；Status 必須係 actionable（讲明 blocking state）；Cron/automation項目要 verify live system state，唔係净係睇 issue file

### 17. `cron-feature-deprecation`
- **用途**：系統性移除 cron 或 script 功能（零下游消費者）——四層同步改動 + 驗證
- **觸發場景**：用戶問「呢個功能仲有冇用？」、功能冇人用但仍然 push Discord
- **使用時間**：10 min analysis + 5 min approval + 15 min 四層改動 + 10 min verification
- **依賴**：`openclaw cron list --json`、Discord channel history、script source
- **注意**：移除 cron command 的 `--discord-channel` flag 唔夠，script 的 `DEFAULT_DISCORD_CHANNEL` 要同步改為 `''`；Cron announce ≠ script push（系統行為唔受 script 改動影響）

### 18. `openclaw-compaction-investigation`
- **用途**：診斷 OpenClaw compaction 行為——NO_REPLY→👍 自動轉換、threshold 計算、memory flush、session handover
- **觸發場景**：Compaction 後 session 狀態異常、💓/👍 殘留、memory flush 未寫入、early compaction
- **使用時間**：10–15 min 完整 trace（inject sequence + flush prompt + bootstrap + rehydration）
- **依賴**：Session JSONL、day log、`cross_session_bootstrap.js`
- **注意**：NO_REPLY→👍 係 OpenClaw 原生行為，唔係 bug；Bootstrap 順序係 SOUL→Memory→Session History→Prompt；Trust Labels 層級係自家添加部分

### 19. `concurrent-session-rate-limit-avoidance`
- **用途**：診斷並避免 main session 和 cron isolated session 同時用同一 model 導致的 rate limit collision
- **觸發場景**：Cron job consistently timeout (~300s) 同時 main session active、consecutiveErrors 但 cron output正常
- **使用時間**：10 min identify colliding model + 5 min pick alternative + 2 min update cron
- **依賴**：`openclaw cron get`、main session model
- **注意**：優先不同 provider（P1），其次不同 model family（P2），最後 delay schedule（P3）；Cron model最好 match script 內部 model（避免 double LLM call）

### 20. `subagent-code-tuning-workflow`
- **用途**：透過 subagent 有序地對 script 做 surgical 修改，配合測試 flag 驗證並 restore state
- **觸發場景**：需要改 keyword array、dedup logic、score logic 等 script 內部組件、唔想影響其他部分
- **使用時間**：每輪 ±10 行改動約 5 min sub-agent + 2 min verify + 1 min restore state
- **依賴**：`node --check`、state file restore、test flags（`--feed all`）
- **注意**：Test完必須 restore state file（`.ai_hot_seen.json`）；Scope creep 係最常見問題；Surgical scope boundary 要精確到 line numbers

### 21. `model-migration-workflow`
- **用途**：系統性遷移模型引用——router configs、cron jobs、scripts、spawn config、env vars、test files
- **觸發場景**：更換 primary model、加入新 fallback、provider 變更
- **使用時間**：10 min scan + 5 min build plan + 5 min apply + 10 min verify + monitoring
- **依賴**：Find + grep 全 codebase、`openclaw cron list`
- **注意**：只改 config 唔改 cron 會導致不一致；Model name 拼寫差異（`minimax:default` vs `MiniMax-M2.7`）係常見問題；Rate limit recovery 要 spawn sub-agent 繞過 cron 累積

### 22. `subagent-truncation-repair`
- **用途**：修復被截斷的 skill file——識別 colon truncation、派 sub-agent 補完、通過 validation gate
- **觸發場景**：Skill file 以 `：` colon 結尾、file size 異常小（<1500B）、steps N+1 完全缺失
- **使用時間**：5 min detect + 5 min spawn + 3 min validate
- **依賴**：`node scripts/validate_skill_file.js`、M3 sub-agent
- **注意**：唔好 overwrite 原有 steps 1–3；`generatedAt` 要更新；Pitfalls 必須喺 Workflow 之後，順序錯誤 validation會 fail

### 23. `daily-synthesis`
- **用途**：每日跨系統學習合成——scan L2 memory + Obsidian，highlight 新 patterns，寫 note + Discord
- **觸發場景**：每日 02:00 HKT 自動執行（cron schedule `0 2 * * *`）
- **使用時間**：0（自動 cron）| script 執行約 30–60s
- **依賴**：`memory/` L0/L1 files、Obsidian daily notes、`discord-notify`
- **注意**：**唔好** schedule喺 08:00 HKT（L0/L1 未 ready）；Script 會 clean exit 如果 L0/L1 唔存在；`--discord-channel` 必須 explicit 傳入

---

## 🟡 微調可用 (Tune-up)

### `code-review-checklist`
- **問題**：內容被截斷，Phase B/C 嘅 Phase A step4-8 完全冇晒，只剩 `---` delimiter 後殘留啲字
- **建議改動**：Restore 完整 Phase B/C workflow，包括 Phase A parallel auditor spawning、Phase B frontmatter parse、Phase C reconcile& update steps

### `cron-context-overflow-recovery`
- **問題**：583 bytes 嚴重截斷，`##背景` 之後完全冇 workflow steps，只有冒號
- **建議改動**：補完完整 workflow（如何診斷 context overflow、fix 步驟、驗證方法）

### `cron-p0-rescue-workflow`
- **問題**：有完整 workflow structure 但缺觸發條件描述、使用時間 estimate、依賴工具清單；Step 7 "Yield + 報告" 係 convention 描述但唔係 action
- **建議改動**：加「觸發場景：一個 cron job `consecutiveErrors ≥ 3` + `lastError` 含 `LLM request failed`」；加每個 job migration 時間（約 15 min）；加 required tools

### `cron-passive-job-detection`
- **問題**：有完整 workflow structure 但被截斷（`manual run` 後半部分缺失）；缺觸發條件
- **建議改動**：補完 Step 5 手動執行之後的驗證步驟同修復建議；加「觸發場景：cron job `duration ≤ 500ms` + `consecutiveErrors: 0`」

### `openclaw-no-reply-chain-debugging`
- **問題**：內容完整且有 reference table，但缺使用時間 estimate、具體觸發條件（邊個 error message 觸發）
- **建議改動**：加「觸發場景：Bot 發送非預期 standalone message（如純 emoji）、NO_REPLY 未生效」；加使用時間（完整 trace 約 10–15 min）

### `m3-root-cause-analysis`
- **問題**：嚴重截斷，1025 bytes，Step 3 spawn sub-agent 只係開頭就斷咗；冇後續步驟、冇 pitfalls、冇 validation
- **建議改動**：補完完整 workflow（M3 sub-agent 如何做 root-cause investigation、output format、如何 apply foundational fix）

### `issue-quality-self-review`
- **問題**：完整 workflow 但被截斷（Step 5 開始未完成）；Step 1-4 有 F/D/Q framework 但缺 F/D/Q 具體示例
- **建議改動**：補完 Step 5 以後的步驟；加 5 quality gates 的具體 example checklist；Status 改 `active`（係 reusable SOP，唔係 draft）

### `skills-audit-workflow`
- **問題**：內容完整但 status=`draft`、有 17 steps 但部分 steps 描述得好 high-level（Phase 1-3 比較具體，Phase 4-7 比較 abstract）
- **建議改動**：Phase 4-7 每個 step 加 concrete sub-steps；Status 改 `active`（係 skill-reviewer bot 自己嘅 operational workflow）

### `skill-curation-pattern`
- **問題**：有完整 workflow 但缺使用時間 estimate、觸發條件（係 weekly curation loop，定係需要人手 trigger？）
- **建議改動**：加「觸發場景：每週 curation loop（Phase 1b）或人手 trigger when queue is bloated」；加使用時間（full curation pass 約 10–15 min）

### `systemevent-cron-dedup-gotcha`
- **問題**：有完整 context + gotcha 解釋 + source code reference，但缺具體 workflow steps（點樣避開 dedup）、使用時間、驗證方法
- **建議改動**：加 workflow steps（如何確認 dedup 係 root cause + alternative migration approach）；加使用時間（約 5 min diagnose + 10 min fix）

---

## 🔴 建議歸檔 (Junk)

### `skill-reviewer-draft-cleanup`
- **點解係垃圾**：內容完整且有 detailed cleanup workflow，但呢個工作太 niche（skill-reviewer bot 自己產生 broken drafts），且 workflow 已由 weekly_correction_loop.js Phase 1b 自動處理，人手再做係重複勞動
- **建議**：Archive。Skills cleanup 已經係 curator 職責，唔需要單獨 skill

### `skill-quality-verification`
- **點解係垃圾**：內容有 composite heuristic design template，但 reference template 部分被截斷（只有標題冇內容）；更適合做參考文檔，唔係可執行 workflow
- **建議**：Archive。如有需要參考 composite heuristic 設計，用 `skill-curation-pattern` 代替

### `subagent-model-override`
- **點解係垃圾**：740 bytes，極度截斷，只係 `## Context` + `## Workflow` 開頭（2 steps）；核心內容喺第一個 code block 就斷咗
- **建議**：Archive。`model=` override 語法喺 AGENTS.md 同 TOOLS.md 已有記錄，呢個 skill 冇新增資訊

### `skill-file-corruption-repair`
- **點解係垃圾**：內容完整且有 repair workflow，但呢個問題（unclosed code block、truncation）已經由 `subagent-truncation-repair` + `skill-reviewer-draft-cleanup` 處理，不需要人手 skill
- **建議**：Archive。自動化已經覆蓋

### `pipeline-flag-audit-workflow`
- **點解係垃圾**：內容完整，但太過特定於 pipeline cron 的 flag audit，且 skill_reviewer_bot.js 本身係一次性 tool，唔係持續運作嘅 pipeline；呢個 workflow 實際只會用一次
- **建議**：Archive。相關 flag audit 結果可以寫入 HEARTBEAT.md 作為 reference

### `skill-automation-analysis`
- **點解係垃圾**：內容完整（ROI calculation + M3 sub-agent analysis），但呢個 workflow 係一次性分析工具，唔係重複使用的 skill；所有 analysis 結果已經體現在 HEARTBEAT.md
- **建議**：Archive。automation decision 已經做完，呢個 skill 冇持續 value

### `rapaport-email-summary`
- **點解係垃圾**：內容完整且高質量，但太過 domain-specific（Rapaport diamond pricing），除 Josh 之外任何人用唔到；呢個 skill 只係鞏固現有 workflow，唔係系統運作必要組成
- **建議**：Archive 但保留具體 workflow 作為參考。如果 `mail_monitor.js` 已經處理，唔需要單獨 skill

### `multi-phase-subagent-orchestration`
- **點解係垃圾**：760 bytes 嚴重截斷，Phase 1-2 完全冇晒，只有 `## Workflow` 標題 + 開頭 step；`parallel-subagent-implementation` 已經完整涵蓋呢個 topic
- **建議**：Archive。`parallel-subagent-implementation` 係更完整嘅替代品

### `issue-conclusion-overturn-cleanup`
- **點解係垃圾**：內容完整且高質量，但觸發頻率極低（需要「結論被推翻」呢種情况），且 `issues/` 管理已經有 SOP；呢個 skill 係低頻參考工具
- **建議**：Archive，價值喺 memory 而唔係 skill library

### `cron-context-overflow-recovery`
- **點解係垃圾**：583 bytes 冇任何 workflow，唔係 partial 係完全缺失；呢個 topic 嘅實際處理邏輯可能已經喺其他地方（`cron-thin-executor-migration` 或 `cron-systemevent-migration`）
- **建議**：Archive 如果無法補完

### `heartbeat-maintenance`
- **點解係垃圾**：Draft status，但有完整 7-step workflow + pitfalls + references；問題係呢個 task 係一次性 cleanup，唔係重複執行嘅 skill；HEARTBEAT.md trim 完成之後唔需要再做
- **建議**：Archive，完成 HEARTBEAT trim 之後

### `cron-job-testing`
- **點解係垃圾**：577 bytes 極度截斷，只有 workflow Step 1 開頭；`cron-health-triage` + `cron-model-selection-verification` 已經覆蓋大部分 testing scenarios
- **建議**：Archive。`cron-health-triage` 做健康檢查、`cron-model-selection-verification` 做 model verification，呢個 skill 冇新增覆蓋

### `systemevent-cron-dedup-gotcha`
- **點解係垃圾**：雖然有完整 gotcha 解釋，但 skill_reviewer_bot.js 本身已用 `agentTurn`（唔受 dedup 影響），呢個 gotcha 只係 migration 時需要注意，且問題已喺 `cron-systemevent-migration` 涵蓋
- **建議**：Archive。`cron-systemevent-migration` 已足夠處理呢個 gotcha

### `system-code-debug-triage`
- **點解係垃圾**：內容完整且高質量，但呢個 workflow 係通用 debugging philosophy，唔係 specific OpenClaw skill；`systemevent-main-session-isolation` + `cron-failure-investigation` 已經係佢嘅 concrete instances
- **建議**：Archive 作為 reference document，唔係 active skill

### `cron-model-selection-verification`
- **點解係垃圾**：4900+ bytes，17 pitfall entries 太多太雜，部分已經過時（如 `MiniMax overloaded_error chronic pattern` dated 2026-06-07）；精華反而係 workflow steps 1-8
- **建議**：Tune-up——砍掉陳舊 pitfalls，精簡至 5–7 個核心 gotchas，保留主要 workflow

### `cron-feature-deprecation`
- **點解係垃圾**：呢個係唯一爭議——workflow 完整且 high quality，但觸發頻率極低（功能 deprecation 唔係日常操作）
- **建議**：降為 Tune-up，加「觸發場景：當懷疑某個 cron/script 功能冇下游消費者時先考慮」

---

## 總結

| 指標 | 數量 |
|------|------|
| **總共 skills** | **49 個** |
| 🟢 **Ready（即刻可用）** | **23 個** |
| 🟡 **Tune-up（有 value 但需微調）** | **10 個** |
| 🔴 **Junk（建議 archive）** | **16 個** |

---

### **Top 3 推薦（強烈 reasoning）**

| # | Skill | 理由 |
|---|-------|------|
| **🥇 1** | `cron-thin-executor-migration` | **系統穩定性核心**。將 LLM-dependent cron 轉為 deterministic script，消除 `LLM request failed` / `Provider unavailable` 問題。Thin executor 完全冇 LLM，係最高回報嘅 migration。每個受影響 cron 從「可能 fail」變成「基本唔會 fail」。 |
| **🥈 2** | `cron-model-selection-verification` | **診斷正確性關鍵工具**。呢個系統最常見嘅誤區係「auto runs 用 deepseek、直接就係咁」，但 session jsonl 揭示真實情况係 initial model = MiniMax-M3、model_change → deepseek-v4-flash（overloaded_error）。冇呢個 skill，會不斷錯誤地 blame cron config 而忽略 provider health。 |
| **🥉 3** | `route-enforcer-plugin-debugging` | **Sub-agent model isolation 必備**。Route-enforcer hook 會攔截所有 explicit `model=` 參數，導致 sub-agent 用錯 model。最常見嘅錯誤係「明明指定了 deepseek-v4-pro，但 sub-agent 用了 MiniMax-M2.7」。呢個 patch（加 guard condition）令 explicit model parameter 生效，杜絕左呢個長期混淆。 |

---

### **Top Tune-up 優先順序**

| 優先 | Skill | 原因 |
|------|-------|------|
| P1 | `cron-context-overflow-recovery` | 完全缺失（583 bytes），但呢個係真實會發生嘅問題（agentTurn session 累積 history 超 token limit） |
| P2 | `subagent-model-override` | 740 bytes 完全冇內容，但呢個 topic（如何指定 sub-agent model）係高頻操作需求 |
| P3 | `cron-job-testing` | 577 bytes 完全冇內容，但 `cron-health-triage` 只係 monitor，`cron-job-testing` 係 actively testing cron behavior，兩者互補 |

---

### **Archive 快速清單**

以下 16 個建議 archive：
`skill-reviewer-draft-cleanup`, `skill-quality-verification`, `subagent-model-override`, `skill-file-corruption-repair`, `pipeline-flag-audit-workflow`, `skill-automation-analysis`, `rapaport-email-summary`, `multi-phase-subagent-orchestration`, `issue-conclusion-overturn-cleanup`, `cron-context-overflow-recovery`, `heartbeat-maintenance`, `cron-job-testing`, `systemevent-cron-dedup-gotcha`, `system-code-debug-triage`, `cron-feature-deprecation`（降為 tune-up）, `cron-model-selection-verification`（tune-up，精簡後重新上線）
