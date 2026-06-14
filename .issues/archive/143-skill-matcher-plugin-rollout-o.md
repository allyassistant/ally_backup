---
id: 143
title: skill-matcher plugin rollout observation (7-day read-only phase)
status: archive
priority: P2
created: 2026-06-09
due: 2026-06-16
updated: 2026-06-11
progress: 0/7
---

## F - Facts（事實）

### 現況
skill-matcher plugin (v1.0.2) 已 deploy 喺 read-only phase（2026-06-09 ~15:02 HKT），只 logging 唔 inject。

### 數據/證據
| 項目 | 值 |
|------|-----|
| Plugin Version | 1.0.2 |
| Current Phase | read-only |
| Deploy Time | 2026-06-09 ~15:02 HKT |
| Threshold | 0.15 (default) |
| RespectPin | true (skip pinned skills) |
| Disabled Channels | #🤖一般 (1473343330170572904), #⚙️系統 (1473376125584670872) |
| Max Tokens | 3000 |
| Metrics Cron | skill_matcher_metrics.js (daily 07:00 HKT → #⚙️系統, cron ID: f0e6f7c8) |
| User Decision | Collect more data before promoting |

### Read-only Success Criteria（最低門檻先 promote）
衡量標準（全部通過先入下一階段）：
1. **No crashes**: 100+ consecutive user messages without plugin error in gateway.log
2. **Match coverage**: ≥1 real skill match logged per day（confirmed by grep）
3. **Zero false positive on noise**: 冇 match 到 greetings（hi/hello/thanks）/ system commands（/status）
4. **Metrics file 正常增長**: `.skill_matcher_metrics.jsonl` 每日有新 entries

### Rollback Plan
| Scenario | Action | Command |
|----------|--------|--------|
| Plugin crash | Disable plugin | `config.patch` skill-matcher → enabled: false → restart gateway |
| False positive flood | Immediate rollback to read-only | `config.patch` → phase: read-only |
| Token cost spike | Lower maxTokens or raise threshold | `config.patch` → maxTokens: 1000 or threshold: 0.3 |
| LLM misled by wrong skill | Add to excludedSkills | `config.patch` → excludedSkills: ["skill-name"] |
| Unrecoverable | Full plugin remove | Delete openclaw.plugin.json entry → restart gateway |

**⚠️ SystemEvent 教訓**: 2026-06-09 skill_reviewer cron 曾經被 migrate 去 systemEvent mode（3ms runs, 冇 execution）。對 plugin rollout 嘅啟示：read-only phase 唔好 skip，任何 phase promotion 之前必須有足夠 observation data。見 memory/2026-06-09.md §systemEvent Root Cause Analysis。

## D - Decisions（決定）

### ✅ 已做決定
- [2026-06-09] Phase: read-only (Day 0-3)—只 logging，產 metrics JSONL，唔 inject
- [2026-06-09] Josh 決定收集多幾日 data 先 promote

### ⏳ 待做決定
- [Due 2026-06-12] Promote to conservative phase? (Day 4-7) — 檢查 read-only criteria 全部通過先 promote
- [Due 2026-06-16] Review conservative metrics + threshold adjustment for tuned phase
- [Due 2026-06-16] Final review: promote to full production?

## Q - Questions（未解決）

### ❓ 核心問題
1. threshold 0.15 係咪太保守 / 太寬？（要等 data）
2. #💬翻譯 channel 需唔需要加入 disabled channels？
3. 需唔需要每日 metrics digest push 去 #⚙️系統？
4. `maxTokens: 3000` 對複雜技能（e.g. agents-best-practices ~2000 tokens）夠唔夠？

### 🔍 追問
- 如果 threshold 太高（miss match），用戶體驗會點？ → 要手動 call skill
- 如果 threshold 太低（false positive），會唔會 inject 錯 skill？ → 可能誤導 LLM workflow
- read-only phase 有冇真正 capture 到 daily conversation patterns？
- Metrics 收集目標：read-only 期間要累積幾多 match events 先叫「夠 data」？→ 建議 baseline: ≥20 match logs + ≥3 日 data

## Progress
- [ ] Day 0 (06/09): Deploy read-only phase ✅
- [ ] Day 1-3 (06/09-06/11): Gather metrics — check gateway.log ≥100 messages, ≥1 match/day, 0 false positives on noise
- [ ] Day 4 (06/12): Review metrics, decide: promote to conservative or extend read-only?
- [ ] Verify metrics cron running (skill_matcher_metrics.js, daily 07:00 HKT, cron ID: f0e6f7c8)
- [ ] Check first metrics report from cron
- [ ] Day 5-8 (06/12-06/15): Conservative phase (if promoted) — observe injection behavior, false positive rate
- [ ] Day 9 (06/16): Final review — tuned threshold or full production?

## Notes
- skill-matcher plugin path: ~/.openclaw/extensions/skill-matcher/
- DESIGN.md 有完整 rollout plan (Phase 3a-3d)
- 同 skill-learner plugin (priority 5) 共享 before_prompt_build hook，skill-matcher 係 priority 10
