---
name: error-auto-issue
description: "Scan errors nightly and create P1 issues for repeating patterns. Use when: scans run, patterns repeat, executor lacks LLM. Key capabilities: error scanning, repeat detection, P1 issue creation."
status: active
source: p0-skill-audit-2026-06-09
provenance: agent
generatedAt: 2026-06-09T01:30:00.000Z
---

# error-auto-issue

每日 22:00 自動掃描 `~/.openclaw/workspace/memory/errors.json`，**重複錯誤 pattern 自動建 issue**。Thin executor — 完全冇 LLM，依賴 deterministic pattern matching + `issue_manager.js create` 嘅 fixed signature。

> 解決嘅問題：人手 review `memory/errors.json` 搵 recurring patterns 太花時間（20-30 min/次），根本唔會做。Recurring errors 容易 missed fix，惡化成更大的 incident。
> 一個 skill 行 1-2 秒，自動將 7 日內 ≥3 次嘅 pattern 變成 P1 issue 連 sample trace，迫 human review。

---

## Trigger

- **Schedule**: 自動 — 每日 22:00 (`0 22 * * *`, Asia/Hong_Kong)
- **手動**: `node scripts/error_auto_issue.js`
- **Test**: `node scripts/error_auto_issue.js --dry-run --json` 預覽，唔 create、唔 update state
- **Tuning**:
  - `--threshold 5` 將 repeat threshold 由 3 調高到 5（減少 noise）
  - `--lookback 14` 將 lookback 由 7 日延到 14 日（catch slower patterns）

---

## Inputs

- **Errors file**: `~/.openclaw/workspace/memory/errors.json`
  - Schema: `{ "schema": "openclaw.errors.v1", "errors": [...] }`
  - 每個 error: `{ id, date, timestamp, type, severity, title, problem, source, tags, count, resolved }`
  - 寫入者: `scripts/error_tracker.js`（cron 自動）
  - **Missing file = clean exit 0**（冇 errors = 冇嘢做）
- **State file**: `~/.openclaw/workspace/.error_auto_issue_state.json`
  - 結構: `{ "issuedPatterns": ["<key1>", "<key2>", ...] }`（FIFO 500）
  - Key = `type::normalizedProblem`（lowercase + collapse whitespace + strip hashes）
- **環境變量**:
  - `ERROR_ISSUE_CHANNEL`（optional，default `#⚙️系統` = `1473376125584670872`）

---

## Outputs

- **P1 issues** in `.issues/active/`
  - Title: `[FIX] Recurring error: <Type> (×<count> in 7d)`
  - Priority: `P1`, Due: 7 日後
  - Body sections:
    - `## Summary` — count + lookback
    - `## Pattern Details` — type、problem、severity
    - `## First/Last Seen` — HKT timestamps
    - `## Sample Traces` — 最多 3 條 sample lines
    - `## Recommended Action` — `[blank — human decides]`
- **Discord push** to `#⚙️系統`（每個 issue 一個 message）
- **State file** updated with 新 issued patterns

---

## Workflow

1. **Load errors file**
   - 讀 `memory/errors.json`，missing → clean exit 0
   - `JSON.parse` 失敗 → exit 1

2. **Filter & aggregate** (last `LOOKBACK_DAYS = 7`):
   - 跳過 `resolved === true` 嘅 errors
   - Group by `normalizePattern(e) = type + '::' + problem.toLowerCase().replace(/\s+/g, ' ').replace(/[0-9a-f]{8,}/gi, '<hash>')`
   - Hash stripping 確保 dedup 不會被 instance ID / session ID 干擾
   - 保留每 group 嘅 first/last timestamp + 最多 3 sample lines

3. **Find candidates** (count ≥ `REPEAT_THRESHOLD = 3` AND not in state):
   - 過濾 `g.samples.length >= 3` AND `!seen.has(key)`
   - Sort by count desc（most severe first）

4. **For each candidate**:
   - Build title: `[FIX] Recurring error: <Type> (×<count> in 7d)` (max 200 chars, sanitize quotes)
   - Build body: full trace template (Summary / Details / First-Last / Samples / Recommendation)
   - Run `node scripts/issue_manager.js create "<title>" --priority P1 --due YYYY-MM-DD`
   - Parse issue ID from output (`Issue created: <id>`)
   - Find file in `.issues/active/<id>-*.md`
   - **Patch the file** with full body (replace default `## Description\n\n## Progress...`)
   - Push Discord notification

5. **Save state** (atomic write, FIFO 500):
   ```json
   { "issuedPatterns": ["<key1>", ...] }
   ```

6. **Exit 0** (clean or all created) / **Exit 1** (errors file corrupt, issue_manager fail)

---

## Pitfalls

- ⚠️ **`issue_manager.js create` 冇 `--body` flag** — 佢 hardcode default `## Description\n\n## Progress...` template。要 inject custom body，**必須**事後 patch file：先 create，再 `fs.readFileSync` 個 file，replace 個 default body，atomic write 返去。
- ⚠️ **Title 必須 sanitize 過 shell** — `safeTitle = title.replace(/"/g, "'").slice(0, 200)` 避免 shell injection 同超長 filename。如果 `type` / `problem` 有奇怪字符（emoji、HTML、SQL 嘢），`issue_manager` 嘅 filename sanitization (`replace(/[^\w]+/g, '-')`) 會 handle。
- ⚠️ **Async child_process only** — `execSync`/`execFileSync` hang (ETIMEDOUT)，同 [[cron-health-triage]] / [[anomaly-proactive-push]] 嘅 pitfall 一樣。**必須用 `spawn` async**。
- ⚠️ **`create` command 會用 create lock 排隊** — `withCreateLock` 確保多個 concurrent call 唔會撞 ID。我哋 single-thread 唔影響，但要知：如果 **手動** 同時 `node scripts/issue_manager.js create`，呢個 script 會等。
- ⚠️ **P1 priority 慎用** — 默認 P1（高優先），但如果 recurring pattern 係 transient（e.g. `Rate Limit: 429` 由 `Rate Limit: rate limit exceeded` 拆成兩個 key，可能有 false positive），會 spam P1 issues。**`--threshold 5`** 適合 production，降低 noise。
- ⚠️ **Patch step race condition** — `issue_manager.js create` 同 patch 之間有 ~50ms gap。如果期間人手改咗個 file，patch 會 overwrite。要 stable 嘅做法係 patch 用 `compare-and-swap`：不過對 cron-only 場景 risk 極低，**唔好 over-engineer**。
- ⚠️ **Sample traces 最多 3 條** — 全 dump 會令 issue file 巨大（每個 error 有 source URL、stack trace 等）。3 條 sample 足夠 human identify pattern，full dump 留喺 `errors.json`。
- ⚠️ **Hash stripping 範圍 `[0-9a-f]{8,}`** — 只 strip **8+ 位** hex，唔會 strip 短 ID（例如 `id: 087`）。如果 patterns 用短數字 ID（例如 error code `E1234`），**唔會** normalize，要留意 false negative。
- ⚠️ **Discord push 對每個 issue 一個 message** — 4 個 issues = 4 個 Discord messages。如果同日有 10+ recurring patterns 突然爆發（例如 deploy bug），會 spam。考慮加 daily 限額（e.g. max 5/day），但 v1.0 唔做。

---

## Idempotency

- **State file (pattern keys)**: 同一個 pattern 唔會建兩個 issue
- **Atomic write**: `tmp + rename` 避免 corrupt
- **FIFO cap 500**: state file 唔會無限增長
- **Test-issues cleanup**: 開發期間測試用 `rm .error_auto_issue_state.json + rm .issues/active/<test-id>*.md`，唔好留低 dev 噪音
- **Missing errors file = clean exit**: 唔算 error

---

## Verification

```bash
# 1. syntax
node --check scripts/error_auto_issue.js

# 2. dry run with JSON output
node scripts/error_auto_issue.js --dry-run --json | jq '.newPatterns'

# 3. raise threshold to see fewer results
node scripts/error_auto_issue.js --dry-run --threshold 5 --json | jq '.newPatterns'

# 4. extend lookback
node scripts/error_auto_issue.js --dry-run --lookback 14 --json | jq '.newPatterns'

# 5. real run (will create P1 issues, push to Discord)
node scripts/error_auto_issue.js

# 6. verify cron registered
openclaw cron list | grep -i 'error auto'

# 7. verify created issue content
cat .issues/active/<id>-*.md
```

---

## When NOT to use

- **Real-time error alerting** → 用 [[anomaly-proactive-push]]，30-min cycle
- **Cron failure triage** → 用 [[cron-failure-investigation]]
- **Code quality issues** → 用 `code_quality_manager.js` (唔係 error pattern)
- **Single transient error** → 唔需要 issue，繼續 monitor 7 日先決定

---

## References

- [[cron-health-triage]] — 同期運作嘅 cron health monitor
- [[anomaly-proactive-push]] — anomaly detection (warning/critical alerts)
- [[cron-failure-investigation]] — 收到 auto-issue 之後 investigate root cause
- 輸入源: `scripts/error_tracker.js` (寫 `memory/errors.json`)
- Issue creation: `scripts/issue_manager.js create` (硬限制：冇 `--body` flag，要事後 patch)
