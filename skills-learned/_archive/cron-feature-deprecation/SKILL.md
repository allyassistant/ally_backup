---
name: cron-feature-deprecation
description: 系統性移除 cron 或 script 功能的工作流程——當下游分析顯示零價值或 cron 本身因複雜度導致 context overflow 時，執行四層改動並驗證
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-11T03:15:00.000Z
---

## Workflow

> 觸發條件（滿足任一即啟動）：
> - 下游分析顯示功能零價值（usage = 0, user feedback = negative, output not consumed）
> - Cron job 本身因複雜度導致 context overflow，無法在 main session 內完成分析
> - Plugin 在 main session 殘留訊息（💓/👍），干擾正常運作

### 核心流程

1. **收集現況**
   - 找出 cron job name（從 `~/.openclaw/workspace/.skill_review_queue.jsonl` 或 gateway status）
   - 確認 config path：`~/.openclaw/openclaw.json` → `cron.entries.<name>`
   - 確認 plugin path（如有）：`~/.openclaw/extensions/<plugin-name>/`

2. **第一層：停用 Cron Job**
   ```bash
   openclaw cron disable <cron-name>
   # 或手動：openclaw.json → cron.entries.<name>.enabled: false
   ```
   - 驗證：`openclaw cron status` 確認 status = disabled

3. **第二層：停用 Plugin（如有）**
   ```bash
   # 臨時停用（config level）
   openclaw config set plugins.entries.<plugin-name>.enabled false
   openclaw gateway restart
   ```
   - 若要徹底移除（見第三層）

4. **第三層：徹底清理**
   - 判斷用戶意圖（disabled vs deleted）：
     - **disabled**：`enabled: false` 即可，保留 folder + config entry
     - **deleted**：
       ```bash
       rm -rf ~/.openclaw/extensions/<plugin-name>/
       # 從 openclaw.json 移除 plugins.entries.<plugin-name> 整個 entry
       openclaw gateway restart
       ```
   - 驗證：`~/.openclaw/extensions/<plugin-name>/` 不存在，`openclaw.json` 無殘留 entry

5. **第四層：關閉相關 Issue**
   - 查找相關 issue（`ls ~/.openclaw/workspace/issues/` 或 GitHub）
   - Archive 或 close issue，註明 deprecation 原因 + 日期

6. **驗證完整性**
   - `openclaw gateway status` — 無殘留 💓/👍 heartbeat 訊息
   - `openclaw cron list` — cron job 不在 active list
   - Discord #⚙️系統（如有監控）— 無 error 告警

### Context Overflow 觸發時的特別處理

當 cron job 因為太複雜（多個 sub-agent、多層 call chain）導致 `Context overflow: prompt too large for the model (precheck)` 時：

- 這本身就是 deprecation 信號——cron job 複雜度已超出系統承載能力
- 立即執行 4-layer cleanup，毋須完整分析其內部邏輯
- 記錄 lesson：「複雜度導致無法自我診斷的 cron job = 技術債務，應降級或移除」

---

## Pitfalls

- **千祈唔好假設 disabled = deleted** — 必須明確問用戶想要哪種 level
- **Config 改完記得 gateway restart** — 否則 plugin 變更不生效
- **Archive issue 唔等於 delete** — 留着歷史記錄，方便日後 review
- **Context overflow 時唔好嘗試深入分析** — 直接判定 deprecation，省時省 context
- **刪除 folder 前確認無其他 cron job 依賴** — `grep -r "<plugin-name>" ~/.openclaw/workspace/scripts/`

---

## Provenance

- 2026-06-11：Skill Matcher plugin 清理觸發——cron job + plugin + folder + issue 全套移除
- Signal：context overflow on cron analysis = complexity debt → immediate deprecation
