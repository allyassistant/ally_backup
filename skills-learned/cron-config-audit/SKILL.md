---
name: cron-config-audit
description: "Audit cron configs against script settings and detect drift. Use when: cron acts up, mismatch suspected, drift checks run. Key capabilities: cross-reference entries, detect mismatch, generate report."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-12T10:31:11.738Z
disable-model-invocation: true
activation: manual
activationReason: "bulk cron model config drift detection + modification"
---

## Workflow

1. **列舉所有 Cron Jobs**
   ```bash
   # 從 HEARTBEAT.md 讀取 cron jobs
   grep -A 2 "type.*cron" ~/.openclaw/workspace/HEARTBEAT.md | grep -E "name|model|schedule"
   
   # 或直接讀取 cron config
   cat ~/.openclaw/workspace/.cron_config.json 2>/dev/null || \
   find ~/.openclaw/workspace -name "*.cron" -o -name "cron*.json" 2>/dev/null
   ```

2. **提取 Cron Config 的 Model 配置**
   對每個 cron job，提取：
   - `model` 字段（主模型）
   - `fallbacks` 陣列（備用模型鏈）
   - `lightContext` / `contextLimit` 等上下文配置

3. **讀取 Script 內部 Model 配置**
   找到 cron job 對應的 script，檢查硬編碼的 model：
   ```bash
   # 搜索 script 中的 model 配置
   grep -rn "model.*:" scripts/ --include="*.js" | grep -v node_modules
   
   # 特別檢查 execSync/execFileSync 調用
   grep -rn "execFileSync\|execSync" scripts/ --include="*.js" -A 2
   ```

4. **比對 Config vs Script**
   比對 cron config 的 `model` vs script 內部 `model`：
   - ✅ 一致 → 無 drift
   - ❌ 不一致 → drift detected，進入診斷模式

5. **診斷 Drift 原因**
   常見 drift 原因：
   - **實驗暫改：** #153 實驗期間臨時改咗 model，實驗結束後冇 revert
   - **Migration 遺漏：** cron-migration 過程中只改了 config，script 漏咗
   - **手動干預：** 過程中直接編輯咗 config 但冇更新 script

6. **驗證 Fallback Chain**
   檢查 fallback 順序是否合理：
   ```javascript
   // 理想的 fallback：不降級到不符合品質預期的模型
   // 例如：原本用 deepseek-v4-flash（128K context）
   // fallback 到 qwen2.5:3b（僅 8K context）= 降級陷阱
   ```

7. **修復並更新**
   將 cron config 更新為正確的 model/fallback：
   ```bash
   # 更新 cron config
   openclaw cron update "<job-name>" --model <correct-model>
   
   # 或直接編輯 config file
   nano ~/.openclaw/workspace/.cron_config.json
   ```

8. **驗證 Next Run**
   觀察下次 cron 執行的健康狀態：
   - 檢查 HEARTBEAT.md 的 lastRunStatus
   - 確認冇再出現 "model-call-started" timeout

## Pitfalls

- **實驗期間 Model Drift（⚠️ 重要）：** 當 #153 等實驗性 PR 改了 cron model（如 deepseek → qwen2.5:3b），實驗結束後若冇明確 revert，config 會保持實驗值。這是最常見的 cron 行為異常原因。診斷時要先問：「最近有冇做過 model 相關的實驗或 migration？」

- **LightContext 與 Model 不匹配：** `lightContext: true` 適合小模型（如 qwen2.5:3b），但配 deepseek-v4-flash 會浪費 128K context。反之，`lightContext: false` 配小模型會導致 context overflow。

- **Same-Model Fallback Dead Loop：** 如果 main model 和 fallback model 都係同一 provider 的同一模型，rate limit 會同時觸發，造成死循環。檢查 fallback 鏈是否包含同 provider 的相同模型。

- **Script 內硬編碼覆蓋 Config：** 有些 script 內部有 `process.env.MODEL` 或 `defaultModel` 變量，優先級高於 cron config。找到這些硬編碼並同步更新。

- **Timeout vs Model 問題混淆：** "model-call-started" timeout 可能係：
  - Model 真的在調用但很慢（正常，等待或增加 timeout）
  - Model 不支持任務（更換 model）
  - Context overflow（換更大的 context model 或啟用 lightContext）
  
  先檢查是否是 context overflow（看 HEARTBEAT 的 error details），再判斷是否 drift。

- **忽略 Stale Cron：** 有些 cron job 已 archive 但 config 仍存在，浪費資源去審計。清理前先確認 cron 是否真的在使用。

- **Config Drift 檢測不完整：** 只檢查 `model` 字段，忽略 `systemPrompt`, `temperature`, `maxTokens` 等其他配置。這些也會影響 cron 行為。

- **Migration 後冇驗證：** cron-migration 技能說「已完成遷移」，但實際上 config 和 script 可能仍有 subtle inconsistency。用本技能的 Step 4 比對來驗證。
