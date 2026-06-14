---
id: 144
title: systemEvent→agentTurn+isolated 遷移: 消除 main session 💓/👍 殘留
status: active
priority: P1
created: 2026-06-10
due: 2026-06-15
updated: 2026-06-10
progress: 2/3
---


## F - Facts（事實）

### Trigger Source
- 凌晨 02:04 💓 殘留 — MSG ID `1513966999183691786`（#🧑🏻‍💻編程 channel）
- 追蹤確認：Daily Memory Logger（`systemEvent + main`）每隔 2h + 5min stagger 注入 main session
- 相關 skill：[[systemevent-main-session-isolation]] · [[cron-thin-executor-migration]]

### Root Cause
當 cron job 用 `systemEvent + main` 時，OpenClaw 會將 system event 注入 main session，model 自動 processing 後 output 經 reply pipeline 直出 active Discord channel，產生 💓（heartbeat indicator）/ 👍（NO_REPLY auto-reaction）殘留。

### 解決方案
將純 exec script 嘅 cron jobs 由 `systemEvent + main` 轉做 `agentTurn + isolated` thin executor：
- `sessionTarget: "isolated"`
- `payload.kind: "agentTurn"`（只係一句 command，唔係 verbose LLM prompt）
- `payload.model: "deepseek/deepseek-v4-flash"` + fallback MiniMax-M2.7
- `payload.toolsAllow: ["exec"]`
- `delivery.mode: "none"`

### 適用條件
只要 script **唔需要 main session 嘅 conversation context / channel state**，就可以 migrate。全部受影響 jobs 都只係純 exec script。

---

## D - Decisions（決定）

### ✅ Batch 1 — 已完成 (2026-06-10 ~02:10)
| # | Job | Schedule | Timeout |
|---|-----|----------|---------|
| 1 | KB Ingest | 06:25 | 600s |
| 2 | Knowledge Bootstrap | 06:30 | 60s |
| 3 | Daily Maintenance | 05:00 | 120s |
| 4 | Wiki Vectorizer | 01:20 | 120s |
| 5 | L1 Generator | 00:35 | 300s |
| 6 | L0 Generator | 00:05 | 300s |
| 7 | Wiki Lint | 00:50 | 60s |
| 8 | Wiki Compile | 00:45 | 60s |
| 9 | SYMBOLS.md | 00:41 | 120s |
| 10 | Wiki Bridge Import | 00:40 | 60s |

### ✅ Batch 2 — 已完成 (2026-06-10 ~02:35)
| # | Job | Schedule | Timeout |
|---|-----|----------|---------|
| 11 | Daily Memory Logger | 每 2h | 60s |
| 12 | Pattern Analysis | 04:00 | 120s |
| 13 | Anomaly Monitor | 06:30 / 18:30 | 60s |

### ⏳ Batch 3 — 待做
| # | Job | Schedule |
|---|-----|----------|
| 14 | System Check (CQM) | 10:00 |
| 15 | Daily Summary | 23:59 |

---

## Q - Questions（未解決）

### ❓ 核心問題
1. 5 日後（2026-06-15）檢查：有冇新 💓/👍 殘留出現？
2. System Check (CQM) 同 Daily Summary 要唔要 migrate？定係呢兩個有特別原因要留 main session？
3. Daily Summary script 會 send Discord message — isolated session `toolsAllow: ["exec"]` 夠唔夠佢 send？
4. HEARTBEAT.md 已 cleanup，有冇漏咗嘅 job？

### 🔍 驗證方法
- **Success metric：5 日零 💓/👍 殘留** 先叫 success
- 觀察 main session 未來幾日 cron 時間點有冇 💓/👍
- 重點關注：Skill Reviewer (2:00/2:30)、Daily Summary (23:59)
- 確認所有 migrated jobs next run 正常 exit 0

## Progress
- [x] Batch 1: 10 jobs migrated (00:05–06:30 range)
- [x] Batch 2: 3 jobs migrated (Daily Memory Logger, Pattern Analysis, Anomaly Monitor)
- [x] HEARTBEAT.md cleanup (623→90 lines)
- [ ] Batch 3: CQM + Daily Summary (await decision)
- [ ] 5-day verification (due 2026-06-15)
- [ ] Confirm zero 💓/👍 residuals

## Notes
- Trigger: 凌晨 2:04 出現 💓，追蹤到 Daily Memory Logger 嘅 systemEvent+main 殘留
- Skill Reviewer 已係 isolated（唔係問題來源）
- Daily Summary 23:59 理論上唔會有明顯 noise（深夜），但一致化較好
