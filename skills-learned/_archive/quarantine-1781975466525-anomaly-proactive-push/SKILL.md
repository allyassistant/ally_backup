---
name: anomaly-proactive-push
description: "Scan alert files and push anomalies to Discord with auto-degradation. Use when: scans trigger, alerts appear, cron impact grows. Key capabilities: alert scanning, Discord push, cron mitigation."
status: quarantined
source: p0-skill-audit-2026-06-09
provenance: agent
generatedAt: 2026-06-09T01:30:00.000Z
---

# anomaly-proactive-push

每 30 分鐘自動讀取 `~/.openclaw/workspace/.proactive_alerts.json`（由 `pattern_proactive_trigger.js` 寫入），將**新出現**嘅 `warning` / `critical` 異常 push 去 Discord `#⚙️系統`。Thin executor — critical path 完全冇 LLM，依賴 deterministic JSON file 嘅 severity 欄位。

> 解決嘅問題：`pattern_proactive_trigger` 已經有 baseline-aware detection，但**冇人睇 output**。呢個 skill 將 alerts 變成主動 notification。
> Optional `--auto-degrade` 仲可以喺 critical alert 涉及特定 cron 時自動 disable，避免 cascading failure。

---

## Trigger

- **Schedule**: 自動 — 每 30 分鐘 (`*/30 * * * *`, Asia/Hong_Kong)
- **手動**: `node scripts/anomaly_proactive_push.js`
- **Test**: `node scripts/anomaly_proactive_push.js --dry-run --json` 預覽，唔 send、唔 update state

---

## Inputs

- **Alerts file**: `~/.openclaw/workspace/.proactive_alerts.json`
  - Schema: `{ "alerts": [...], "generated_at": "...", "summary": {...} }`
  - 每個 alert: `{ type, severity, message, suggestion, data: { error_type, count, last_seen, project_name, issue_id, cron, ... } }`
  - 寫入者: `scripts/pattern_proactive_trigger.js`（每日跑）
  - **Missing file = clean exit 0**（冇 alerts = 冇嘢 push，唔算 error）
- **State file**: `~/.openclaw/workspace/.anomaly_push_state.json`
  - 結構: `{ "pushedSignatures": ["<sig1>", "<sig2>", ...] }`（FIFO 500 entries）
  - Signature = `type::message::JSON.stringify(data, sortedKeys)` — 確保 alert 內容有變先再 push
- **環境變量**:
  - `ANOMALY_CHANNEL`（optional，default `#⚙️系統` = `1473376125584670872`）

---

## Outputs

- **Discord push** to `#⚙️系統`（**每個新 alert 一個獨立 message**）:
  - Header: `🚨 **Anomaly Detected** — <HKT timestamp>`
  - Severity: `🔴 CRITICAL` 或 `🟡 WARNING`
  - 3-4 行 structured detail: type、error_type 或 project、detail、last_seen
  - Footer: `**Recommendation:** <suggestion text>`
- **State file** updated with 新 pushed 嘅 signatures
- **Optional auto-degrade** (with `--auto-degrade` flag):
  - 對 `critical` alert: 如果 `data.cron` 有具體 cron name → `openclaw cron disable <id>`
  - 用嚟預防 cascading failure（例如某個 cron 連環 fail 拖累成個 system）

---

## Workflow

1. **Load alerts file**
   - 讀 `.proactive_alerts.json`，missing → clean exit 0
   - `JSON.parse` 失敗 → exit 1（file corrupt 要 fix）

2. **Compute signatures & filter**
   - 每個 alert 計算 `alertSignature(a) = type + '::' + message + '::' + JSON.stringify(data, sortedKeys)`
   - Filter: `isActionable(a) && !seen.has(sig)`:
     - `isActionable`: `severity ∈ {warning, critical}`（**skip `info`**，避免 spam `new_error_pattern` detection）
     - `!seen`: 已經 push 過嘅 alert 唔重 push

3. **For each new alert**:
   - Format message（見 Discord 格式 section）
   - `openclaw message send --channel discord --target channel:<id> -m <text>`
   - On success: 將 signature 加去 `seen` set
   - **Critical + `--auto-degrade`**: 試 `data.cron` → `openclaw cron disable <id>`

4. **Save state** (atomic write, FIFO 500):
   ```json
   { "pushedSignatures": ["<sig1>", "<sig2>", ...] }
   ```

5. **Exit 0** (clean or pushed) / **Exit 1** (alerts file corrupt, push failed completely)

---

## Pitfalls

- ⚠️ **`--target` 必須用 `channel:<id>` 格式** — `openclaw message send` 唔接受 bare ID，會 fail `Ambiguous Discord recipient`。Cron config 嘅 `delivery.to` field 都用 `channel:<id>` 格式，保持一致。
- ⚠️ **Async child_process only** — `execSync`/`execFileSync` 喺呢個 environment 會 hang (ETIMEDOUT)，同 [[cron-health-triage]] 嘅 pitfall 一樣。**必須用 `spawn` async**。
- ⚠️ **Skip `severity=info` alerts** — `pattern_proactive_trigger` 寫嘅 `new_error_pattern` defaults `severity: "info"`（e.g. "出現 2 次新 error type"）。如果唔 filter，每次 cron cycle 都會 spam。**只有 `warning`/`critical` 值得通知**。
- ⚠️ **Signature dedup 必須 include `data`** — 只用 `type + message` 做 signature 唔夠。如果 `error_type: "Cron Timeout"` 嘅 count 由 100 → 200，**應該再 push**（嚴重性升級）。將 `data` JSON.stringify 入 signature 確保內容有變先 re-push。
- ⚠️ **`--auto-degrade` 要 explicit opt-in** — 自動 disable cron 係 powerful，唔可以默認開。Cron-thin-executor-migration skill 嘅 migration 後測試期間**絕對唔可以** auto-degrade（可能 false positive disable 啱啱 migrated 嘅 cron）。
- ⚠️ **Auto-degrade 對應 `data.cron` 唔係 `error_type`** — 一個 `error_type: "Cron Timeout"` alert 唔代表知道邊個 cron timeout。`data.cron` 必須由 `pattern_proactive_trigger` 顯式填入（e.g. `anomaly_monitor` 寫 `data.cron = "weekly_correction_loop"`）。**大部分現有 alert 冇呢個 field** — auto-degrade 大多數時候 no-op。
- ⚠️ **State file FIFO cap (500) 避免無限增長** — 唔設定 cap 嘅話，半年後 state file 會有幾千個 signature，load/save 都慢。FIFO 500 = 約 1 個月 alert 歷史，足夠 dedup。
- ⚠️ **Push 失敗唔 retry** — 跟 [[cron-health-triage]] 一樣: 失敗都 update state，避免 retry storm 喺 Discord 連環 spam。下個 30-min cycle 先再有機會。

---

## Idempotency

- **State file (signatures)**: 同一個 alert 唔會 push 兩次
- **Atomic write**: `tmp + rename` 避免 corrupt
- **FIFO cap 500**: state file 唔會無限增長
- **No external side effects 除**: Discord push + state update + (optional) `cron disable`
- **Missing alerts file = clean exit**: 唔算 error，cron cycle 0 成本

---

## Verification

```bash
# 1. syntax
node --check scripts/anomaly_proactive_push.js

# 2. dry run (no Discord, no state, no auto-degrade)
node scripts/anomaly_proactive_push.js --dry-run

# 3. JSON output (for programmatic checks)
node scripts/anomaly_proactive_push.js --dry-run --json | jq '.newAlerts'

# 4. real run
node scripts/anomaly_proactive_push.js

# 5. auto-degrade test (CAREFUL: disables real cron)
node scripts/anomaly_proactive_push.js --auto-degrade --dry-run

# 6. verify cron registered
openclaw cron list | grep -i 'anomaly'
```

---

## Auto-degrade Caveats (CRITICAL)

> 啟用 `--auto-degrade` 之前，**必須**確認 alerts file 嘅 schema 同你預期一樣。
> 測試步驟:
> 1. **Read source**: 睇 `scripts/pattern_proactive_trigger.js` 確認邊個 alert 類型會有 `data.cron`
> 2. **Dry run first**: 永遠先用 `--auto-degrade --dry-run` 睇下會 disable 邊個
> 3. **One cron at a time**: 唔好喺 production 立刻 enable
> 4. **Manual re-enable**: 修好個 cron 後 `openclaw cron enable <id>`

預設 **disable**。要 enable 喺 cron command 加 `--auto-degrade` flag。

---

## References

- [[cron-health-triage]] — 同期運作嘅 cron health monitor。呢個 skill 處理 anomaly，嗰個處理 cron failure state。
- [[cron-failure-investigation]] — 收到 alert 之後，用呢個 skill investigate 邊個 cron 出咗事
- [[cron-thin-executor-migration]] — 將 LLM-based cron 改為 thin executor，減少 anomaly 出現頻率
- 輸入源: `scripts/pattern_proactive_trigger.js` (寫 `.proactive_alerts.json`)
- 參考 scripts: `scripts/ai_hot_push.js` (state file pattern)
