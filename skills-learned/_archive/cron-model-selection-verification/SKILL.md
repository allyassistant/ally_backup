---
name: cron-model-selection-verification
description: 驗證 cron job 實際使用的模型 vs 配置的模型，診斷 fallback 觸發原因，並通過手動重跑確認 provider 健康狀態
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-11T02:05:07.617Z
---

## Workflow

1. **列出現有 cron 配置**
   用 `cron list` 取出所有 cron jobs，篩選懷疑有問題的目標 job。記錄其 `model`、`timeout`、`fallback` 配置。

2. **識別 script 內部 LLM 依賴**
   讀取 cron job 的 `script` 指向的 `.js` 文件。搜索 `execSync` / `execFileSync` 內的 LLM call pattern（如 `generateSync`, `llm.*Sync`, `openai.*`, `deepseek.*`）。
   - 若 script 內部有 LLM call → 該 job 是 Type B（script-level LLM）
   - 若 script 純 Node.js 邏輯 → 該 job 是 Type A（thin executor，cron 層只有一次 agentTurn LLM call）

3. **診斷 timeout 根源**
   檢查 cron run 歷史的 error pattern：
   - `model-call-started` timeout → 網絡延遲或 provider 429 rate limit
   - `connection-refused` → API endpoint 不通
   - `model-not-found` → 模型名稱拼寫錯誤或 provider 端已下架
   若是 `model-call-started` + deepseek/minimax → 考慮 Ollama 本地模型作替代

4. **評估 Ollama 本地模型可行性**
   檢查本地環境：
   ```bash
   ollama list
   # 確認 qwen2.5:3b 或其他本地模型已下載並運行中
   curl -s http://localhost:11434/api/generate -d '{"model":"qwen2.5:3b","prompt":"test","stream":false}' | jq -r '.done'
   ```
   若本地模型穩定運行 → 這是比 cloud fallback 更可靠的 recovery path。

5. **執行模型遷移**
   用 `cron update <id> --model ollama/qwen2.5:3b --timeout 30 --toolsAllow exec` 更新 cron 配置。
   對於需要 safety net 的 job，保留 `--fallback <cloud-model>`。

6. **驗證配置正確性**
   用 `cron get <id>` 確認：
   - `model` 已更新為 ollama/xxx
   - `timeout` 已調整（30s 足夠純 exec task）
   - `toolsAllow` 已限制（防止意外的 LLM tool 調用）

7. **Smoke test 本地模型適用性**
   直接用 `ollama run qwen2.5:3b` 測試一條 raw prompt（exec task），確認模型理解 `exec` tool 意圖。

---

## Pitfalls

- **Cloud provider 早晨高峰 timeout**：07:00-08:00 HKT 是 deepseek/minimax 高負載時段，30s timeout 完全不夠。根本解法是 Ollama 本地模型，否則要不斷 increase timeout 到 120s+ 並配置多層 fallback。

- **Script 內部 LLM vs Cron 層 LLM 混淆**：即使 script 是 pure Node.js，cron 本身的 `agentTurn` 仍會觸發一次 LLM call（默認 deepseek）。要同時檢查 cron config 和 script 內部兩個層面。

- **Tool Allow 未限制導致非預期 LLM call**：遷移到 Ollama 後，若 `toolsAllow` 仍是 `["*"]`（全部工具），cron 可能嘗試使用其他需要 LLM 的工具（如 `read` 會因讀取大檔案而觸發 LLM 分析）。明確限制 `["exec"]` 可以確保只有 script 本身的 exec tool 被調用。

- **Cron 配置了但 data source 不存在**：若 cron 依賴的 input file（如 `.skill_matcher_metrics.jsonl`）從未存在過，cron 會每日跑但永遠 output "No data yet"。在部署前應驗證 data source 是否已存在且有歷史數據。

- **Fallback chain 變成死循環**：若 primary 和 fallback 都指向同一個 provider（deepseek），timeout 時會不斷在兩者之間重試。確保 fallback 指向不同 provider（如 M2.7 MiniMax）以打破死循環。

- **模型名稱 drift**：Ollama 模型名稱格式是 `ollama/<model-name>`，與 cloud provider 格式不同。確認 cron config 中的 model field 使用正確前綴（如 `ollama/qwen2.5:3b` 而非 `qwen2.5:3b`）。
