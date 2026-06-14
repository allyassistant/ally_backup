# Skill Library 庫存策略分析報告

> **日期：** 2026-06-11  
> **分析師：** Ally (subagent, M3 Pro)  
> **數據來源：** skills/ + skills-learned/ + .skill_junk_rate.jsonl + .skill_created.jsonl + L2 memory  

---

## 📊 Executive Summary

1. **47 個 active skills，但質量參差** — 68.89% junk rate（最近 7 日 31/45 新 skills 驗證失敗）。大量 skills 係 skill-reviewer bot 自動生成，但冇足夠人手 review 就入咗 symlink。

2. **Cron/System 類 skills 嚴重膨脹** — 17 個 skills 圍繞 cron job 相關（triage、testing、migration、verification、deprecation...），功能高度重疊，可以壓縮到 4-5 個。

3. **L2 Memory 幾乎冇引用** — 只有 3-4 個 skills 喺 memory 出現過（各自 3 次），其餘 38 個從未被引用。Skills 存在但冇 usage evidence。

4. **4 個 skill 已有 thin executor 實現**，佢哋係最有價值嘅（cron-health-triage、anomaly-proactive-push、error-auto-issue、daily-synthesis），其他大多數 skills 係一次性 reference material，冇 script 支撐。

5. **即刻可做嘅 quick wins：** 隔離 20 個 obsolete legacy JS files、清理 9 個 quarantined skills、修復 4 個 stub skills、merge 12 個 cron 類 skills 成 3-4 個。

---

## 🗂️ Skill 盤點表

### 圖例
- ✅ **KEEP** — 有實際價值，保留
- 🔄 **AUTOMATE** — 適合 cron-ify
- ⚠️ **REVIEW** — 需要 Josh 決定
- ❌ **QUARANTINE** — 無價值，建議移除
- 🔀 **MERGE** — 同其他 skill 重疊，建議合併

### A. Built-in/Bundled Skills（非 _learned_）

| # | Skill | 大小 | 類別 | 評分 | 決策 | 評語 |
|---|-------|------|------|------|------|------|
| 1 | **agents-best-practices** | 209L / 13.9KB | Design | 🟢 5/5 | ✅ KEEP | OpenClaw 原生捆綁，agent architecture 權威 reference。高質量。 |
| 2 | **kimi-deep-research** | 165L / 6.4KB | Research | 🟢 5/5 | ✅ KEEP | SOP 已整合，有 pre-flight checklist + pricing detail。實用。 |
| 3 | **x-link-analysis** | 175L / 4.3KB | Web Research | 🟢 4/5 | ✅ KEEP | X link 分析 workflow 完整，包含 Obsidian write + Discord send。常用。 |
| 4 | **tools-reference** | 187L / 7.2KB | Reference | 🟡 3/5 | ⚠️ REVIEW | 同 TOOLS.md 內容 50%+ 重疊。內容部分 outdated（reference `browser_navigate` 而非 `browser`）。建議合併入 TOOLS.md 或大幅更新。 |

### B. JS Skills（直接放喺 skills/ 嘅舊格式）

| # | Skill | 大小 | 類別 | 評分 | 決策 | 評語 |
|---|-------|------|------|------|------|------|
| 5 | **diamond_valuation.js** | ~20L / 602B | Business | 🟡 2/5 | ⚠️ REVIEW | Stub class：只得 placeholder message + example，冇實際 valuation logic。自 4 月以嚟未更新。AGENTS.md 完全冇引用。如果實際需要 diamond 估價，應該做 proper implementation，否則 quarantine。 |
| 6 | **quotation_generator.js** | ~30L / 1.0KB | Business | 🟡 2/5 | ⚠️ REVIEW | 同 diamond_valuation 一樣係 stub。generateQuote() 同 createInvoice() 都係 return message string，冇實際 quote logic。 |

### C. _learned_ Skills — Cron/System Operations（12 個）

| # | Skill | 大小 | Script? | 評分 | 決策 | 評語 |
|---|-------|------|---------|------|------|------|
| 7 | **cron-health-triage** | 135L / 6.7KB | ✅ `cron_health_triage.js` (789L) | 🟢 5/5 | ✅ KEEP + AUTOMATE | **最佳範例。** 有完整 thin executor、Discord push、告警 dedup、6h cooldown。已在 cron 運行。 |
| 8 | **anomaly-proactive-push** | 149L / 7.7KB | ✅ `anomaly_proactive_push.js` | 🟢 5/5 | ✅ KEEP + AUTOMATE | 同樣高質量，30min cycle + auto-degrade option。完整 pitfalls + idempotency。已在 cron 運行。 |
| 9 | **error-auto-issue** | 161L / 8.1KB | ✅ `error_auto_issue.js` | 🟢 5/5 | ✅ KEEP + AUTOMATE | 高質量 thin executor。22:00 自動 scan errors.json → P1 issue。8 個 pitfalls 記錄。已在 cron 運行。 |
| 10 | **cron-thin-executor-migration** | 123L / 6.8KB | ❌ | 🟢 4/5 | ✅ KEEP | 重要嘅一次性 reference（Type B→Type A migration）。已完成 migration 嘅話可 archive。 |
| 11 | **cron-systemevent-migration** | 68L / 3.7KB | ❌ | 🟡 3/5 | 🔀 MERGE | 同 #10 功能高度重疊，都係 migration workflow。可合併入 cron-thin-executor-migration 做 sub-section。 |
| 12 | **cron-agent-llm-failure-mitigation** | 51L / 3.7KB | ❌ | 🟡 3/5 | 🔀 MERGE | 診斷 LLM failure in cron — 但 cron-health-triage 已經 handle failure detection。可整合做 troubleshooting appendix。 |
| 13 | **cron-failure-investigation** | 30L / 2.4KB | ❌ | 🟡 3/5 | 🔀 MERGE | 同上，cron failure investigation workflow。可合併。 |
| 14 | **cron-model-selection-verification** | 63L / 3.7KB | ❌ | 🟡 3/5 | 🔀 MERGE | 驗證 cron model vs config。係 cron-health-triage 可以 cover 嘅 subset。 |
| 15 | **cron-script-model-config-audit** | 59L / 3.7KB | ❌ | 🟡 3/5 | 🔀 MERGE | 同 #14 幾乎一樣 — 都係 audit cron model config。合併。 |
| 16 | **cron-feature-deprecation** | 71L / 3.8KB | ❌ | 🟡 2/5 | 🔀 MERGE | 一次性 workflow（deprecate 冇用嘅 cron）。做過一次之後就冇再用。可歸入 cron-thin-executor-migration 嘅附錄。 |
| 17 | **cron-job-testing** | **16L / 577B** | ❌ | 🔴 1/5 | ❌ QUARANTINE | **Stub.** SKILL.md 內容被截斷，只有 incomplete workflow step 1。16 行 code，577 bytes — 同一個 template 嘅前 30 行。永久 incomplete。 |
| 18 | **llm-call-execfile-migration** | 208L / 10.4KB | ❌ | 🟢 4/5 | ✅ KEEP | 最大嘅 _learned_ skill。內容詳盡，係一次性 migration reference。L2 memory 引用 3 次。完成 migration 後可 archive。 |

### D. _learned_ Skills — Agent/Sub-agent Workflow（10 個）

| # | Skill | 大小 | Script? | 評分 | 決策 | 評語 |
|---|-------|------|---------|------|------|------|
| 19 | **parallel-subagent-implementation** | 84L / 8.3KB | ❌ | 🟢 5/5 | ✅ KEEP | 高質量 multi-track sub-agent workflow。有 batch-chaining、audit-implement pairing、post-implementation QA。好 practical。 |
| 20 | **subagent-sideeffect-containment** | 73L / 5.3KB | ❌ | 🟢 4/5 | ✅ KEEP | Pattern for safe defaults + opt-in side effects。實用嘅架構 pattern。 |
| 21 | **subagent-qa-verification-workflow** | 34L / 3.4KB | ❌ | 🟡 3/5 | ⚠️ REVIEW | M3 subagent for multi-bug QA — 概念好但 34 行偏薄。可考慮 merge 入 parallel-subagent-implementation。 |
| 22 | **intent-based-spawn-model-selection** | 39L / 3.2KB | ❌ | 🟡 3/5 | ⚠️ REVIEW | M2.7 vs M3 intent gate。已整合入 AGENTS.md Spawn Intent Gate section。Skill file 成為 duplicate。 |
| 23 | **subagent-code-tuning-workflow** | 38L / 2.3KB | ❌ | 🟡 2/5 | 🔀 MERGE | Surgical code edit via subagent — 同 #19 (parallel-subagent-implementation) 重疊。可合併。 |
| 24 | **multi-phase-subagent-orchestration** | **25L / 760B** | ❌ | 🔴 1/5 | ❌ QUARANTINE | **Stub.** 得 25 行，只得兩個 incomplete steps。validation failed 過一次（2026-06-09）。 |
| 25 | **subagent-model-override** | 35L / 1.3KB | ❌ | 🟡 2/5 | ⚠️ REVIEW | Status 係 "draft"（唯一一個 draft）。內容簡單（點 override spawn model）。可能唔需要獨立 skill。 |
| 26 | **subagent-truncation-repair** | 44L / 2.2KB | ❌ | 🟡 2/5 | ⚠️ REVIEW | 修復 truncated skill file — meta-skill（skill 修復 skill）。用過一次就唔再用。 |
| 27 | **multi-session-resumption** | 61L / 5.4KB | ❌ | 🟡 3/5 | ✅ KEEP | Resume multi-session work。實用 workflow。 |
| 28 | **aliveness-noise-reduction** | 24L / 2.0KB | ❌ | 🟡 3/5 | ⚠️ REVIEW | 辨識 heartbeat ping — 好 narrow 嘅 use case。24 行偏薄但內容完整。可考慮 merge 入 general reply rules。 |

### E. _learned_ Skills — Code/Tech Ops（7 個）

| # | Skill | 大小 | Script? | 評分 | 決策 | 評語 |
|---|-------|------|---------|------|------|------|
| 29 | **system-code-debug-triage** | 58L / 3.2KB | ❌ | 🟡 3/5 | ✅ KEEP | Verify → fix → defense → review。通用 debug workflow。 |
| 30 | **code-review-checklist** | 34L / 2.8KB | ❌ | 🟡 3/5 | ✅ KEEP | Audit newly-created skill files。同 skills-audit-workflow 有少少重疊但 scope 唔同。 |
| 31 | **model-migration-workflow** | 46L / 2.1KB | ❌ | 🟡 2/5 | 🔀 MERGE | 遷移 model references — 同 cron-model-selection-verification 功能相關。可合併。 |
| 32 | **cross-machine-deployment** | 73L / 3.5KB | ❌ | 🟡 3/5 | ✅ KEEP | SSH deploy + sync verification。實用嘅 cross-machine workflow。 |
| 33 | **route-enforcer-plugin-debugging** | 185L / 8.6KB | ❌ | 🟢 4/5 | ✅ KEEP | 第二大 _learned_ skill。詳盡嘅 plugin debugging guide。 |
| 34 | **openclaw-config-schema-debugging** | 87L / 6.5KB | ❌ | 🟢 4/5 | ✅ KEEP | OpenClaw config schema debug workflow。詳盡。 |
| 35 | **openclaw-compaction-investigation** | 84L / 4.9KB | ❌ | 🟢 4/5 | ✅ KEEP | Compaction behavior 診斷。詳盡。 |
| 36 | **openclaw-no-reply-chain-debugging** | 76L / 3.6KB | ❌ | 🟡 3/5 | ⚠️ REVIEW | NO_REPLY silent delivery 診斷 — 好 specific，同 #35 有相關性。 |
| 37 | **concurrent-session-rate-limit-avoidance** | 46L / 2.5KB | ❌ | 🟡 3/5 | ⚠️ REVIEW | Rate limit collision 診斷。有用但 narrow。 |

### F. _learned_ Skills — Skill Management（5 個）

| # | Skill | 大小 | Script? | 評分 | 決策 | 評語 |
|---|-------|------|---------|------|------|------|
| 38 | **skill-curation-pattern** | 81L / 8.9KB | ❌ | 🟢 4/5 | ✅ KEEP | Quality gate + upstream filtering。高質量。 |
| 39 | **skill-quality-verification** | 43L / 2.2KB | ❌ | 🟡 3/5 | 🔀 MERGE | Composite quality heuristics。同 #38 有重疊。 |
| 40 | **skill-automation-analysis** | 44L / 2.4KB | ❌ | 🟡 3/5 | ✅ KEEP | 分析 skill worth automating，計 ROI。**呢個 skill 同我而家做嘅嘢完全一樣！** |
| 41 | **skill-validation-failure-cleanup** | 63L / 4.5KB | ❌ | 🟡 3/5 | ✅ KEEP | Cleanup stale symlink + archive invalid skills。實用 maintenance。 |
| 42 | **skills-audit-workflow** | 96L / 5.1KB | ❌ | 🟢 4/5 | ✅ KEEP | Complete skill-reviewer loop: queue→signal→decision tree→batch→verify。 |
| 43 | **issue-conclusion-overturn-cleanup** | 71L / 4.6KB | ❌ | 🟡 3/5 | ⚠️ REVIEW | Overturn early conclusions。Narrow use case。 |
| 44 | **pipeline-flag-audit-workflow** | 52L / 2.9KB | ❌ | 🟡 2/5 | ⚠️ REVIEW | Audit pipeline flags — 一次性 task。完成咗可 archive。 |
| 45 | **yaml-config-drift-detection** | 50L / 2.6KB | ❌ | 🟡 2/5 | ⚠️ REVIEW | YAML vs AGENTS.md drift detection。完成 migration 後可 archive。 |

### G. _learned_ Skills — Content/Knowledge（4 個）

| # | Skill | 大小 | Script? | 評分 | 決策 | 評語 |
|---|-------|------|---------|------|------|------|
| 46 | **rapaport-email-summary** | 39L / 2.9KB | ❌ | 🟢 4/5 | ✅ KEEP | Weekly Rapaport processing。SOP 已整合。 |
| 47 | **daily-synthesis** | 53L / 3.8KB | ✅ `daily_synthesis.js` (789L) | 🟢 4/5 | ✅ KEEP + AUTOMATE | 跨系統學習合成。有 thin executor。Cron timing 已記錄。 |
| 48 | **x-article-login-wall-fallback** | 51L / 2.9KB | ❌ | 🟢 4/5 | ✅ KEEP | 6-layer fallback 獲取 X article 內容。已 integrated 入 AGENTS.md。剛創建（Jun 11）。 |
| 49 | **heartbeat-maintenance** | 43L / 2.4KB | ❌ | 🟡 3/5 | ⚠️ REVIEW | 清理 HEARTBEAT.md 同 stale artifacts。有用但 scheduled maintenance 應該 cron-ify。 |

---

## 📈 統計摘要

| 度量 | 數值 |
|------|------|
| **Active skills 總數** | 47（4 built-in + 2 JS + 41 _learned_） |
| **已實現 thin executor** | 4（cron-health-triage、anomaly-proactive-push、error-auto-issue、daily-synthesis） |
| **Stub skills（<1KB）** | 2 （cron-job-testing 577B、multi-phase-subagent-orchestration 760B） |
| **Draft status** | 1（subagent-model-override） |
| **7 日 junk rate** | **68.89%**（31/45 新 skills 驗證失敗） |
| **Quarantined skills** | ~9（喺 skills-learned/_archive/） |
| **Legacy JS files** | 20（喺 skills/_archive/，10 originals + 10 .bak） |
| **L2 memory 引用** | 幾乎為零（只有 3-4 個 skills 各自被引用 3 次） |
| **Cron job 總數** | 26 個全部 `agentTurn` kind |

---

## 🔍 發現嘅問題

### 🚨 P0 — Structural Issues

1. **68.89% junk rate is alarming.** 近 7 日嘅 auto-generated skills，31/45 驗證失敗。Skill-reviewer bot 生成大量低質量 content 然後被 symlink，污染 active skill library。

   **Evidence:** `.skill_junk_rate.jsonl` 7-day window: `total:45, passed:14, failed:31, junkRatePercent:68.89`

2. **cron-job-testing SKILL.md 被截斷。** 577 bytes，16 行，內容喺 step 1 中途結束。係一個 incomplete write。

   **Evidence:** `skills-learned/cron-job-testing/SKILL.md` — "1. **收集原始狀態**..." 之後就冇咗。

3. **Stub skills are actively symlinked.** `cron-job-testing` (577B) 同 `multi-phase-subagent-orchestration` (760B) 都係 active symlink，但內容不足 1KB。

### ⚠️ P1 — Quality/Dedup Issues

4. **Cron skills 嚴重膨脹（12 個，可壓縮到 3-4 個）。**
   - cron-health-triage + anomaly-proactive-push + error-auto-issue = 核心 trio（有 script）
   - cron-thin-executor-migration + cron-systemevent-migration = migration pair（可合併）
   - cron-failure-investigation + cron-agent-llm-failure-mitigation = troubleshooting pair（可合併）
   - cron-model-selection-verification + cron-script-model-config-audit = audit pair（可合併）
   - cron-feature-deprecation = 一次性 workflow
   - cron-job-testing = stub（隔離）
   
   **建議:** Merge 成 4 個：`cron-health-monitoring`（triage+anomaly+error） / `cron-migration`（thin-executor+systemevent） / `cron-troubleshooting`（failure+llm-failure） / `cron-config-audit`（model+script）

5. **tools-reference 同 TOOLS.md 內容 50%+ 重疊。** 兩個都係 tool reference，兩個都要 maintain，必然會 drift。

   **Evidence:** TOOLS.md 已經有完整嘅 tool usage、Discord channel list、model formats。`tools-reference/SKILL.md` 嘅 table 內容有 30-40% 相同。

6. **diamond_valuation.js 同 quotation_generator.js 係 stub class。** 自 4 月以嚟未更新，AGENTS.md 完全冇引用。只係 return placeholder message，冇實際 business logic。

7. **intent-based-spawn-model-selection 已整合入 AGENTS.md。** Skill file 成為 duplicate。AGENTS.md Spawn Intent Gate section 已包含完全相同嘅 logic。

### 📝 P2 — Minor Issues

8. **subagent-model-override 係唯一一個 status=draft 嘅 skill。** 應該 upgrade 做 active 或 quarantine。

9. **skills/_archive/ 有 20 個 obsolete old-format JS skills（10 個 + 10 個 .bak）。** 全部係 Mar-Apr 2025 創建，old skill system 嘅殘留。

10. **L2 memory 幾乎冇 skill references。** 只有 llm-call-execfile-migration、error-auto-issue、cron-thin-executor-migration、cron-health-triage 各被引用 3 次。其餘 38 個 skills 從未被 memory 引用，即係佢哋嘅存在冇被系統性記錄。

---

## 🏆 Top 5 推薦 Cron-ify 嘅 Skills

以下 5 個 skills 最適合轉做 cron job，排序由最 impact 到最簡單：

### 1. 🥇 heartbeat-maintenance → weekly cron

| 項目 | 詳情 |
|------|------|
| **Schedule** | `0 3 * * 0`（每星期日 03:00 HKT） |
| **Model** | Thin executor only（唔使 LLM） |
| **Script** | `scripts/heartbeat_maintenance.js`（需新建） |
| **Tools** | `read`、`write`、`exec`（check file mtime, trim HEARTBEAT.md） |
| **Output** | Cleaned HEARTBEAT.md + Discord summary to #⚙️系統 |
| **理由** | HEARTBEAT.md cleanup 係 predictable maintenance，每周一次足夠。Thin executor 可以：scan HEARTBEAT.md 搵 >7 日 entries → trim → check `ha-state/*/current_task.json` staleness → fix → report。零 LLM cost。 |

### 2. 🥈 skill-validation-failure-cleanup → daily cron

| 項目 | 詳情 |
|------|------|
| **Schedule** | `30 1 * * *`（每日 01:30 HKT） |
| **Model** | Thin executor（唔使 LLM） |
| **Script** | `scripts/skill_cleanup.js`（需新建） |
| **Tools** | `exec`（find stale symlinks、check validation、archive） |
| **Output** | Discord summary: removed N stale symlinks, archived M invalid skills |
| **理由** | 現有 junk rate 68.89%，每日自動 cleanup 可以防止 skills-learned/ 繼續膨脹。Check `symlink → target exists?`、`SKILL.md > 1500B?`、`validation passed?` → archive failed。 |

### 3. 🥉 yaml-config-drift-detection → weekly cron

| 項目 | 詳情 |
|------|------|
| **Schedule** | `0 9 * * 1`（每星期一 09:00 HKT） |
| **Model** | Thin executor |
| **Script** | `scripts/yaml_config_drift.js`（需新建，或 extend 現有） |
| **Tools** | `read`（YAML file + AGENTS.md） |
| **Output** | Discord report: detected drift between YAML config and AGENTS.md model references |
| **理由** | YAML config 同 AGENTS.md 之間嘅 model mapping drift 已發生過。Weekly check 可以自動 flag。可 extend 現有 `cross_session_bootstrap.js`。 |

### 4. 4️⃣ pipeline-flag-audit-workflow → monthly cron

| 項目 | 詳情 |
|------|------|
| **Schedule** | `0 10 1 * *`（每月 1 號 10:00 HKT） |
| **Model** | Thin executor |
| **Script** | `scripts/pipeline_flag_audit.js`（需新建） |
| **Tools** | `exec`（grep flags in pipeline scripts） |
| **Output** | Discord report: flags implemented vs actually used at runtime |
| **理由** | Pipeline flags drift 係 slow process，monthly check 就夠。完全 deterministic。 |

### 5. 5️⃣ code-review-checklist → on-demand（git hook trigger）

| 項目 | 詳情 |
|------|------|
| **Schedule** | Trigger-based（`git commit` hook），唔係 time-based |
| **Model** | Thin executor |
| **Script** | Already partially exists in CQM/git hooks |
| **Tools** | `exec`（verify frontmatter、command syntax、wikilinks、cross-references） |
| **Output** | Block commit if issues found |
| **理由** | Code-review checklist 最適合做 pre-commit hook 而唔係 cron。Git hook 可以自動 verify skill files before promoting。 |

---

## ❌ Quarantine 建議清單

以下 10 個 skills 建議立即隔離（按優先級排序）：

| # | Skill | 理由 | Evidence |
|---|-------|------|----------|
| 1 | **cron-job-testing** | Stub — SKILL.md 被截斷，577 bytes | 16 行，只完成 step 1 嘅一半 |
| 2 | **multi-phase-subagent-orchestration** | Stub — 760 bytes，validation failed | 25 行 incomplete workflow |
| 3 | **diamond_valuation.js** | Stub class，return placeholder only | 自 Apr 2025 未更新，AGENTS.md 零引用 |
| 4 | **quotation_generator.js** | Stub class，return placeholder only | 同上 |
| 5 | **cron-feature-deprecation** | 一次性 workflow，做完咗 | Deprecation 係一次性 action |
| 6 | **pipeline-flag-audit-workflow** | 一次性 task（除非 cron-ify） | Audit 係 point-in-time check |
| 7 | **yaml-config-drift-detection** | 一次性 task（除非 cron-ify） | Drift detection 完成咗 |
| 8 | **issue-conclusion-overturn-cleanup** | Narrow use case | 推翻結論係 rare event |
| 9 | **subagent-truncation-repair** | Meta-skill，自指性強 | 修復 skill 嘅 skill — 用過一次 |
| 10 | **subagent-model-override** | Draft status，內容太薄 | 35 行，只教點 override model |

> **注意：** Quarantine 係 move 去 `skills-learned/_archive/` + 移除 symlink，唔係 delete。可以 undo。

---

## 🔀 Merge 建議

| Merge Group | Skills to merge | Target name |
|-------------|----------------|-------------|
| **Cron Health Suite** | cron-health-triage + anomaly-proactive-push + error-auto-issue | `cron-health-monitoring`（呢 3 個已有 script，可 keep separate 但 refer 同一個 parent skill） |
| **Cron Migration** | cron-thin-executor-migration + cron-systemevent-migration + cron-feature-deprecation | `cron-migration` |
| **Cron Troubleshooting** | cron-failure-investigation + cron-agent-llm-failure-mitigation | `cron-troubleshooting` |
| **Cron Config Audit** | cron-model-selection-verification + cron-script-model-config-audit | `cron-config-audit` |
| **Subagent QA** | subagent-qa-verification-workflow → merge into parallel-subagent-implementation | Append as "Phase: Post-Implementation QA" section |
| **Skill Quality** | skill-quality-verification → merge into skill-curation-pattern | Append as "Quality Heuristics" section |
| **Tools Ref** | tools-reference content → merge into TOOLS.md | Single source of truth |

---

## 🚀 Quick Wins（即刻可做）

1. **隔離 20 個 legacy JS files 喺 `skills/_archive/`。** 全部係 old-format skills（Mar-Apr 2025），已有 `.bak` copies。Move 去 `skills/_archive/_legacy/` subfolder 或直接 delete `.bak` files。

2. **移除 `cron-job-testing` symlink。** 佢係一個永久 incomplete stub。即刻 unhook：
   ```bash
   rm /Users/ally/.openclaw/workspace/skills/_learned_cron-job-testing
   ```

3. **處理 junk rate 68.89%。** `skills-learned/` 入面有大量 validation-failed skills（冇 symlink 但 files 存在）。可以：
   ```bash
   # List all non-symlinked skills
   for d in /Users/ally/.openclaw/workspace/skills-learned/*/; do
     name=$(basename "$d")
     [ "$name" = "_archive" ] && continue
     [ "$name" = ".backups" ] && continue
     [ -L "/Users/ally/.openclaw/workspace/skills/_learned_$name" ] && continue
     echo "ORPHAN: $name"
   done
   ```
   然後 archive 佢哋。

4. **Upgrade `subagent-model-override` status.** 由 "draft" → "active" 或 quarantine。唔好留 draft skills 喺 active symlink pool。

5. **Archive `cron-feature-deprecation`。** 已完成嘅一次性 workflow，留喺 active 只會 clutter。

---

## 📋 下一步建議（Action Items for Josh）

| Priority | Action | Effort | Impact |
|----------|--------|--------|--------|
| 🔴 P0 | **Fix 68.89% junk rate.** Audit skill-reviewer bot output gate。可能需要 raise validation threshold（min bytes、min workflow steps） | Medium | High |
| 🔴 P0 | **隔離 2 個 stub skills + 2 個 stub JS skills** | Low（5 min） | Low |
| 🟡 P1 | **Merge 12 cron skills → 4**（見 merge table） | Medium（30 min） | High |
| 🟡 P1 | **Merge tools-reference → TOOLS.md** 或更新 tools-reference | Low（15 min） | Medium |
| 🟡 P1 | **Cron-ify top 3 skills**（heartbeat-maintenance、skill-validation-failure-cleanup、yaml-config-drift-detection） | Medium（1-2 hr） | High |
| 🟢 P2 | **Move _archive/ legacy JS files** 去 subfolder cleanup | Low（5 min） | Low |
| 🟢 P2 | **Decide on diamond_valuation + quotation_generator** — implement or quarantine | Medium | Medium |
| 🟢 P2 | **Archive completed one-time skills**（cron-feature-deprecation、pipeline-flag-audit、yaml-config-drift-detection、issue-conclusion-overturn-cleanup） | Low（5 min） | Low |
| 📝 P3 | **Add skill usage telemetry** — track which skills are actually loaded/used | High（new feature） | High |

---

## 📎 Appendix: Full Skill Inventory（Sorted by Size）

| Size (bytes) | Lines | Skill | Status |
|-------------|-------|-------|--------|
| 13946 | 209 | agents-best-practices | ✅ KEEP |
| 10450 | 208 | llm-call-execfile-migration | ✅ KEEP |
| 8897 | 81 | skill-curation-pattern | ✅ KEEP |
| 8647 | 185 | route-enforcer-plugin-debugging | ✅ KEEP |
| 8278 | 84 | parallel-subagent-implementation | ✅ KEEP |
| 8118 | 161 | error-auto-issue | ✅ KEEP + cron |
| 7722 | 149 | anomaly-proactive-push | ✅ KEEP + cron |
| 7164 | 187 | tools-reference | ⚠️ REVIEW |
| 6753 | 123 | cron-thin-executor-migration | ✅ KEEP |
| 6707 | 135 | cron-health-triage | ✅ KEEP + cron |
| 6526 | 87 | openclaw-config-schema-debugging | ✅ KEEP |
| 6430 | 165 | kimi-deep-research | ✅ KEEP |
| 5390 | 61 | multi-session-resumption | ✅ KEEP |
| 5267 | 73 | subagent-sideeffect-containment | ✅ KEEP |
| 5055 | 96 | skills-audit-workflow | ✅ KEEP |
| 4874 | 84 | openclaw-compaction-investigation | ✅ KEEP |
| 4574 | 71 | issue-conclusion-overturn-cleanup | ⚠️ REVIEW |
| 4461 | 63 | skill-validation-failure-cleanup | ✅ KEEP |
| 4292 | 175 | x-link-analysis | ✅ KEEP |
| 3819 | 53 | daily-synthesis | ✅ KEEP + cron |
| 3807 | 71 | cron-feature-deprecation | 🔀 MERGE |
| 3782 | 68 | systemevent-main-session-isolation | ✅ KEEP |
| 3744 | 63 | cron-model-selection-verification | 🔀 MERGE |
| 3694 | 68 | cron-systemevent-migration | 🔀 MERGE |
| 3672 | 59 | cron-script-model-config-audit | 🔀 MERGE |
| 3668 | 51 | cron-agent-llm-failure-mitigation | 🔀 MERGE |
| 3617 | 76 | openclaw-no-reply-chain-debugging | ⚠️ REVIEW |
| 3477 | 73 | cross-machine-deployment | ✅ KEEP |
| 3417 | 34 | subagent-qa-verification-workflow | ⚠️ REVIEW |
| 3195 | 39 | intent-based-spawn-model-selection | ⚠️ REVIEW |
| 3183 | 58 | system-code-debug-triage | ✅ KEEP |
| 2919 | 51 | x-article-login-wall-fallback | ✅ KEEP |
| 2868 | 39 | rapaport-email-summary | ✅ KEEP |
| 2866 | 52 | pipeline-flag-audit-workflow | ⚠️ REVIEW |
| 2799 | 34 | code-review-checklist | ✅ KEEP |
| 2577 | 50 | yaml-config-drift-detection | ⚠️ REVIEW |
| 2528 | 46 | concurrent-session-rate-limit-avoidance | ⚠️ REVIEW |
| 2393 | 44 | skill-automation-analysis | ✅ KEEP |
| 2380 | 43 | heartbeat-maintenance | ⚠️ REVIEW |
| 2373 | 30 | cron-failure-investigation | 🔀 MERGE |
| 2340 | 38 | subagent-code-tuning-workflow | 🔀 MERGE |
| 2219 | 43 | skill-quality-verification | 🔀 MERGE |
| 2151 | 44 | subagent-truncation-repair | ⚠️ REVIEW |
| 2119 | 46 | model-migration-workflow | 🔀 MERGE |
| 1967 | 24 | aliveness-noise-reduction | ⚠️ REVIEW |
| 1291 | 35 | subagent-model-override | ⚠️ REVIEW |
| 1037 | 30 | quotation_generator.js | ❌ QUARANTINE |
| **760** | **25** | **multi-phase-subagent-orchestration** | **❌ QUARANTINE** |
| 602 | 20 | diamond_valuation.js | ❌ QUARANTINE |
| **577** | **16** | **cron-job-testing** | **❌ QUARANTINE** |

---

> **Report generated at:** 2026-06-11 11:15 HKT  
> **Next review suggested:** 2026-07-11（或 merge/cron-ify 完成後即時 review）  
> **Total analysis time:** ~10 min  
> **Skills analyzed:** 47 active + 9 quarantined + 20 archived = 76 total
