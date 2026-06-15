---
name: cron-health-triage
description: "Scan cron jobs hourly and push anomalies to Discord. Use when: hourly scans run, status needs classifying, anomalies appear. Key capabilities: cron scanning, health classification, Discord push."
status: active
source: p0-skill-audit-2026-06-09
provenance: agent
generatedAt: 2026-06-09T01:30:00.000Z
---

# cron-health-triage

每小時自動掃描所有 26+ 個 OpenClaw cron jobs，分類健康狀態 (ok / warning / error / stale)，**只有當有異常**先推 Discord #⚙️系統。Thin executor — critical path 完全冇 LLM，依賴 `openclaw cron list --json` 嘅 deterministic output。

> 解決嘅問題：人手 check 26 個 cron jobs 嘅健康狀態太花時間（10-15 min/次），根本唔會做。
> 一個 skill 行 1-2 秒，自動 alert + 6h cooldown 避免 spam。

---

## Trigger

- **Schedule**: 自動 — 每小時 (`0 * * * *`, Asia/Hong_Kong)
- **手動**: `node scripts/cron_health_triage.js` 即時跑一次
- **Dry run**: `node scripts/cron_health_triage.js --dry-run`（唔 send Discord、唔 update state）

---

## Inputs

- `openclaw cron list --json --all` 嘅 JSON output
  - 攞到每個 job 嘅 `state.lastStatus`, `state.consecutiveErrors`, `state.lastRunAtMs`, `state.lastError`
- 本地 state file: `~/.openclaw/workspace/.cron_health_triage_state.json`
  - 記住每個 job 上次 push 嘅 status + timestamp
- 環境變量：
  - `CRON_TRIAGE_CHANNEL`（optional，default `#⚙️系統` = `1473376125584670872`）

---

## Outputs

- **Discord push** to `#⚙️系統`（**只有當有非 ok job** + 狀態有變 OR 距離上次 push ≥ 6h）：
  - Header: `🩺 **Cron Health Triage** — <HKT timestamp>`
  - Counts: `🟢 N ok | 🟡 N warning | 🔴 N error | ⚪ N stale`
  - 三個分類 list: 紅 (error)、灰 (stale)、黃 (warning)，每行 job name + reason
  - Footer: `<N> jobs scanned`
- **State file** always updated: 每個 job 嘅 current `status` + `lastPushedAt`
- **Stdout** (always): summary log line + 任何 non-ok job 嘅 detail

---

## Workflow

1. **Fetch cron jobs**
   - `openclaw cron list --json --all --timeout 30000` → parse JSON
   - 攞 `data.jobs[]`，每個 job 有 `id`、`name`、`enabled`、`state.{lastStatus, lastRunAtMs, consecutiveErrors, lastError}`

2. **Classify each job** (4 個 state machine):
   - `ok` — lastStatus = `ok`，< 26h since last run
   - `stale` — lastRun 超過 `STALE_THRESHOLD_HOURS = 26`（covers daily jobs missed a day）
   - `error` — `consecutiveErrors ≥ 1` OR `lastStatus ∈ {error, failed, timeout}`
   - `warning` — `lastStatus ∈ {warning, skipped, partial}`

3. **Diff vs state** (`hasChanges` + `shouldForcePush`):
   - `changed = true` if any job 嘅 `status` 同上次 push 唔同（**包括新 job**）
   - `forced = true` if 距離上次 push 已 ≥ `PUSH_COOLDOWN_HOURS = 6` 小時
   - `shouldPush = (nonOk.length > 0) AND (changed OR forced)`
   - **Suppress rule**: 全部 jobs 都係 ok → 唔 push（避免 spam healthy state）

4. **Push to Discord** (if `shouldPush`):
   - Format: counts header + 3 categorized list (error/stale/warning) + footer
   - `openclaw message send --channel discord --to <channel-id> -m <text>`
   - **State file 仍然 update** 即使 push 失敗 — 避免 retry storm

5. **Save state** (atomic write via `tmp + rename`):
   ```json
   {
     "lastPush": "2026-06-09T09:00:00.000Z",
     "jobStatus": {
       "<jobId>": { "lastStatus": "ok|warning|error|stale", "lastPushedAt": "..." }
     }
   }
   ```

6. **Exit 0** on success / **Exit 1** on `openclaw cron list` failure

---

## Pitfalls

- ⚠️ **Async child_process only** — `execSync` / `execFileSync` / `spawnSync` 喺呢個 OpenClaw environment 會 hang (ETIMEDOUT)。**必須用 `spawn` (async) + Promise wrapper** (`runChild` helper)。Cron-thin-executor 嘅 `cron_preflight_runner.js` 用同樣 pattern。
- ⚠️ **State file 必須 atomic write** — 用 `tmp + rename` 避免讀寫 race。直接 `fs.writeFileSync(STATE_FILE, ...)` 可能 partially written，後續 cron cycle `JSON.parse` 失敗 reset state。
- ⚠️ **Stale threshold 要諗 schedule** — `STALE_THRESHOLD_HOURS = 26` 適合 daily/weekly jobs miss 1 次。**Monthly jobs** 應該 > 26 × 30。如果加 monthly cron，要喺呢度 tune threshold 或者 skip stale check for those。
- ⚠️ **`consecutiveErrors` 唔等如 `lastStatus`** — 一個 job 可能 `consecutiveErrors=0` 但 `lastStatus=error` (上 2 次 error 之後第 3 次 ok)。`hasChanges` 應該睇 **classified status**（綜合兩個 signal），唔係 `lastStatus` 直接。
- ⚠️ **Push cooldown 唔可以太低** — `PUSH_COOLDOWN_HOURS = 6` 防止 hourly cycle spam。如果 job 連續 error 10 個鐘，**只會 push 2 次** (10/6 ≈ 1.67)。如果想即時 alert critical errors，要用另一個 channel（例如 `cron-thin-executor-migration` 嘅 failure alert 機制）。
- ⚠️ **Self-reference bias** — 呢個 skill 自己 (`cron_health_triage`) 都係被 monitor 嘅 job。如果佢 fail，會 alert "self failed"。**唔好加入 suppression**，否則雞生雞問題。Test 用 `openclaw cron run <id>` debug。
- ⚠️ **`openclaw cron list` 嘅 first-run 可能慢** — gateway 第一次 call 要 bootstrap。`runChild` timeout 設 90s 應該夠，但如果 fail 持續，check `openclaw gateway status` 睇 gateway 健康。

---

## Idempotency

- **State file** = last-pushed status per job — repeated runs 只 push if (changed || forced)
- **6h cooldown** = 即使 always-changing，1 日最多 push 4 次
- **Atomic write** = 唔會 corrupt state file on crash
- **No external side effects** = 除 Discord push 同 state file，唔 touch 任何 cron config

---

## Verification

```bash
# 1. syntax
node --check scripts/cron_health_triage.js

# 2. dry run (output, no Discord, no state update)
node scripts/cron_health_triage.js --dry-run

# 3. JSON output (for programmatic checks)
node scripts/cron_health_triage.js --json --dry-run | jq '.counts'

# 4. real run (sends to Discord, updates state)
node scripts/cron_health_triage.js

# 5. verify cron registered
openclaw cron list | grep -i 'cron health'
```

---

## References

- [[cron-failure-investigation]] — 當呢個 skill alert 有 job error，用呢個 skill investigate
- [[cron-thin-executor-migration]] — 將脆弱 LLM-based cron 改為 thin executor，呢個 skill 係 thin executor pattern 嘅延伸
- [[cron-job-testing]] — 改 cron config 前用呢個 skill test
- [[anomaly-proactive-push]] — 同期運作嘅 anomaly detection，睇 `.proactive_alerts.json` 嘅 σ 異常
- 參考 scripts: `scripts/ai_hot_push.js` (state file pattern), `scripts/anomaly_monitor.js` (Discord push pattern)
