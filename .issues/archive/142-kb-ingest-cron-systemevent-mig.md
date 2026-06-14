---
id: 142
title: KB Ingest cron: systemEvent migration + macOS crontab backup
status: archive
priority: P1
created: 2026-06-09
due: 2026-06-14
updated: 2026-06-10
progress: 0/0
---

## F - Facts（事實）

### 觸發事件
- **2026-06-09** KB Ingest cron `9ebd92c9-c19e-47e8-a43f-3c940ecfdede` 連續 2 日 fail with "LLM request failed"（deepseek-v4-flash provider 不穩定）
- 6m21s 後 timeout 死，每次 fail 都消耗 token 無回報

### Cron 演變歷史
| 階段 | 狀態 | 日期 |
|------|------|------|
| v1.0 (deepseek-v4-flash) | ✅ 正常 | ~05/2026 起 |
| v1.1 (deepseek 開始 fail) | ❌ 連續 2 日 LLM request failed | 06/07-06/08 |
| v2.0 (緊急 fix: swap model) | ✅ Last run ok, 51s | 06/09 ~11:48 |
| v3.0 (systemEvent migration) | ✅ Manual trigger ok, 3.2s | 06/09 11:49 |
| **v3.4 (current)** | ✅ **Production ready** | **06/09 11:55** |

### 現時配置（v3.4）
```yaml
jobId: 9ebd92c9-c19e-47e8-a43f-3c940ecfdede
schedule: 25 6 * * * (06:25 HKT daily)
sessionTarget: main
payload.kind: systemEvent
payload.text: "📚 KB Ingest cron: Run `node .../knowledge_ingester.js --discord-channel 1473376125584670872 --quiet`. Script handles its own Discord delivery."
delivery.mode: none  # script 自 notify
wakeMode: now
```

### Script 改動一覽
| Flag / Function | 描述 |
|-----------------|------|
| `--discord-channel <id>` | Script 自己 Discord notify |
| `sendDiscordMessage()` | `execFileSync` + args array（零 shell injection）|
| `--log-file <path>` | Append mode log，預設 `/tmp/kb_ingest.log` |
| Granular exit codes | 0=成功，1=error，2=config/usage，3=有 error 但部分成功 |

### 驗證結果
| Test | Status |
|------|--------|
| `node --check` | ✅ syntax OK |
| `verify_edit.js` | ✅ 17 個 pre-existing issues，0 個新 violation |
| `--help` | ✅ 顯示新 flags + exit codes |
| `--dry-run --discord-channel 123 --no-llm --limit 1 --quiet` | ✅ exit 0, log 寫入, Discord content 顯示 |
| 唔傳 `--discord-channel` | ✅ 唔送、唔 error（default off）|
| End-to-end dry-run 100 messages | ✅ exit 0, 0 errors, Discord content 正確 |

### M3 Audit Verdict
✅ **Ready for production**。唯一發現（non-blocker）：no-messages path 用 implicit return 而非 explicit `process.exit(0)`，行為正確但唔夠明確。

---

## D - Decisions（決定）

### ✅ 已做決定

**Decision 1: 採用 systemEvent migration（2026-06-09）**
- 原因：保持 thin executor 路線，避免 LLM cold start + token overhead
- sessionTarget = main：使用 main session LLM (deepseek-v4-flash) 而非 isolated agentTurn
- delivery.mode = none：script 自 handle Discord notify
- 預期好處：3.2 秒完成（vs 51 秒前），零 LLM overhead，cron agent 不再是 fail point

**Decision 2: Script 加 `--discord-channel` + `sendDiscordMessage()`（2026-06-09）**
- 跟 daily_synthesis.js pattern（同樣 thin executor migration）
- `execFileSync` + args array，避免 shell injection
- default off：唔傳 flag 唔 send，唔影響其他 use case

**Decision 3: 保留 Layer 2 (script 內 LLM 分類 + keyword fallback)**
- Layer 1 (cron agent LLM) 被移除
- Layer 2 (script 內部) 保留 — 呢個係 core intelligence
- Keyword fallback 確保即使 Layer 2 LLM fail 都有基本功能

**Decision 4: macOS crontab (Plan B) 留作 backup，未即時採用**
- 原因：systemEvent 先測試幾日（預計 06/09 - 06/12）
- 如果 systemEvent 出現新問題（例如 main session 唔醒、context 不夠），立即 fallback 去 crontab

### ⏳ 待做決定

**Decision 5 (TBD): systemEvent vs macOS crontab 定案**
- 觀察期：2026-06-09 至 2026-06-12（3 日）
- 06-14 跟進時決定
- 判斷準則：
  - systemEvent 連續 3 日都 ok → 維持 systemEvent（simple、main session 即時執行）
  - systemEvent 出現 ≥1 次 fail（main session 唔醒、context overflow、wake race） → 切去 macOS crontab
  - 兩個都失敗 → 考慮改 schedule（例如改 06:35 避開其他 cron）

**Decision 6 (TBD): macOS crontab entry 細節（如果採用 Plan B）**
- Cron 表達式：`25 6 * * *`
- Command: `node /Users/ally/.openclaw/workspace/scripts/knowledge_ingester.js --discord-channel 1473376125584670872 --quiet --log-file /tmp/kb_ingest.log`
- 環境：需要 `$HOME` 而非 hardcode，因為 cron environment limited
- 預備中：完整 migration runbook 已 draft（待 execute）

---

## Q - Questions（未解決）

### ❓ 核心問題

**Q1: systemEvent 喺 main session 醒唔醒？**
- 測試點：06/10 06:25 HKT 第一個 scheduled run
- 預期：main session 收到 systemEvent → 執行 exec command → 完成
- 風險：main session 長期 idle 可能 wake 慢 / context 被清 / 唔識 run 指令
- **驗證方法**：06/10 早上 check #⚙️系統 channel 有冇 script 嘅結果通知

**Q2: 06:25 嗰一刻 main session context 狀態？**
- 同時間有 Knowledge Bootstrap cron (06:30) — 唔會撞
- 06:25 之前冇其他 systemEvent job
- 風險：低，但 main session 06:25 可能 idle 咗好耐

**Q3: System event 會唔會同 main session 正常 user message race？**
- 06:25 凌晨 Josh 通常瞓咗
- 風險：低

### 🔍 追問

- 如果 systemEvent wake 成功但 Ally 冇即時 exec 點算？（例如 context 已清）
  - Answer: 預備嘅 Plan B (macOS crontab) 完全避開呢個問題
- 如果 script 內 Layer 2 LLM (知識分類) 又 fail 點算？
  - Answer: 已經有 keyword fallback，雖然 quality 較低但唔會完全 fail
- 06/14 跟進時，systemEvent 同 macOS crontab 點比較？
  - systemEvent: simple、易 manage、依賴 main session
  - crontab: 完全獨立、零依賴、但要維護 crontab entry
  - 決定性因素：reliability

---

## Progress

- [x] 2026-06-09 ~11:48 緊急 fix: swap model deepseek → MiniMax-M2.7
- [x] 2026-06-09 ~11:49 systemEvent migration
- [x] 2026-06-09 11:55 M3 完成 knowledge_ingester.js v3.4 改動
- [x] 2026-06-09 11:58 M3 audit 完成，verdict: ready for production
- [ ] **2026-06-10 06:25 HKT** 第一次 scheduled run with systemEvent — 觀察
- [ ] **2026-06-11 06:25 HKT** 第二次 scheduled run — 觀察
- [ ] **2026-06-12 06:25 HKT** 第三次 scheduled run — 觀察
- [ ] **2026-06-14** 跟進 + 決定 systemEvent 定 macOS crontab

---

## Notes

### 觀察點（每日 check）
- [ ] #⚙️系統 channel 有冇收到 script 嘅結果通知
- [ ] `/tmp/kb_ingest.log` 最後一行有冇 `✅ KB Ingest completed`
- [ ] Cron state `lastRunStatus` 有冇 `ok`
- [ ] Main session wake latency（從 systemEvent 到 exec command）

### Plan B 預備 runbook（待 execute）

如果決定切去 macOS crontab，執行步驟：

```bash
# 1. Disable OpenClaw cron
openclaw cron update 9ebd92c9-c19e-47e8-a43f-3c940ecfdede --enabled false

# 2. Add macOS crontab entry
crontab -e
# 加入呢行：
# 25 6 * * * cd $HOME/.openclaw/workspace && /usr/local/bin/node scripts/knowledge_ingester.js --discord-channel 1473376125584670872 --quiet --log-file /tmp/kb_ingest.log >> /tmp/kb_ingest_cron.log 2>&1

# 3. Verify crontab
crontab -l | grep knowledge_ingester

# 4. Test
node /Users/ally/.openclaw/workspace/scripts/knowledge_ingester.js --discord-channel 1473376125584670872 --quiet --dry-run
```

### 相關文件
- `scripts/knowledge_ingester.js` v3.4
- Cron job: `9ebd92c9-c19e-47e8-a43f-3c940ecfdede`
- Pattern reference: `scripts/daily_synthesis.js` (similar thin executor migration)
- Reference: `scripts/mail_monitor.js` (proven crontab pattern)

### Quick stats
- Token savings: ~25K/day (eliminating agentTurn LLM cold start)
- Reliability improvement: 0 LLM cold start → 0 cold start failure mode
- Speed: 51s → 3.2s (cron inject) + script runtime
- Dependencies reduced: 1 (cron agent LLM) → 0
