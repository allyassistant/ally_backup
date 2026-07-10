---
id: 178
title: Self-healing-loop: 7-day observation + Coverage Extension (Option 1) tuning
status: archive
priority: P2
created: 2026-06-22
due: 2026-06-24
updated: 2026-07-04
progress: 0/0
---

## F - Facts

### 7-day Telemetry (Jun 17-21)

| Event | Count | Note |
|-------|-------|------|
| verify_ok | 72 | 26% pass rate（包含 23 個 false positive） |
| verify_fail | 200 | 88 個 magic numbers + 29 個 verify_edit.js isFile bug |
| enqueue | 64 | |
| fixes_applied | 7 | 5/7 係 gia_cert cohort |
| spawn_ok | 3 | M3 path |
| spawn_err | 6 | **全部係 SDK `allowModelOverride` permission bug**，唔係 overload |
| spawn_fallback | 5 | 跌落 deepseek |
| skip_session_cap | 175 | 集中 Jun 17-18，Jun 20-21 = 0 |
| fixes_no_progress | 1 | fs-sync-trycatch rule 唔識加 try-catch |
| audit_just_written_critical | 5 | Jun 21 trend 值得 monitor |

### 真問題
- **Coverage gap，唔係 reliability**
- 88/200 verify_fail 係 magic numbers — 冇 rule 覆蓋
- 29/200 係 verify_edit.js 內部 false signal（isFile bug）
- 真正 attempted-fix success rate = 7/15 = **47%**

### 來源 Sub-agent 分析
- M3 sub-agent #1 (shl_tune_analysis): identify 11% misleading denominator
- M3 sub-agent #2 (shl_root_cause_analysis): reframe 「low fix rate」 → 「coverage gap」
- 兩個 sub-agent 都 recommend Option 1 (Coverage Extension)

## D - Decisions

### ✅ 已知 / 確認
- 2026-06-22: 短期唔改 SHL 任何 config，繼續 observation
- 2026-06-22: Magic number fix 走 deterministic rule，唔過 LLM
- 2026-06-22: M3 path 暫時 dead code（fixer-prompt.md 70 lines 冇人 call）

### ⏳ 待定（6/24 review）
- [ ] 決定 Option 1 rule list 嘅 scope（5 個 patterns？8 個？）
- [ ] 決定 `verifyNoiseFilter` config（filter 29 個 isFile false signal）
- [ ] 評估係咪需要 raise `perFileBudget` 2 → 3
- [ ] Audit 5 個 `audit_just_written_critical` 嘅 source

### ⏳ 待定（Post 6/24）
- [ ] Option 2 (Two-Tier LLM fallback) — 只在 Option 1 驗證後先考慮
- [ ] Long-term: terminate plugin 定 commit 1-2 週做 Option 1

## Q - Questions

### 核心問題
1. **6/24 review 標準：**
   - Attempt rate ≥ 20%？（現時 1.6%）
   - Cap-saturation daily ≤ 5/day？（現時 ✅ 0 post-6/20）
   - Success when attempted ≥ 80%？（現時 64%）
2. **Option 1 scope 點定？** 5 個 patterns 夠唔夠？定要做 8 個？
3. **Magic numbers 88 個分佈**：集中幾個 file 定散落？影響 scope 估算
4. **Coverage Extension 嘅 over-fix risk**：deterministic rules 點 avoid over-apply？

### 追問
- 5 個 `audit_just_written_critical` 嘅 file 類型？critical = 邊類 P0 violation？
- `fs-sync-trycatch` rule 失敗嘅 root cause？rule 寫法錯定係 context 唔夠？
- `fixer-prompt.md` 70 lines 嘅 content 仲有冇用？應該 delete 定 archive？

## Progress

### Observation Phase (Jun 17-24)
- [x] Day 1-3 (Jun 17-19): Plugin self-correcting 完成，cap-skip 跌到 0
- [x] Day 4-5 (Jun 20-21): 觀察 trend，5 audit_just_written_critical 喺 Jun 21 出現
- [x] Jun 22: M3 sub-agent 分析（tune + root cause）— 兩 round 完成
- [ ] Day 6-7 (Jun 22-23): 繼續 collect data
- [ ] Day 7 (Jun 24): Review + decide Option 1 scope

### Post-Review (TBD)
- [ ] 6/24 Review meeting with Josh
- [ ] Option 1 design spec（if approved）
- [ ] Implementation（1-2 週 estimated）
- [ ] Validate fix rate improvement

## Closing Criteria (Day 7 / 6/24)

```
✅ PASS: 7d data 確認 Coverage gap 係真兇 → commit Option 1
🟡 PARTIAL: 7d data mixed → 延 3 日再 review
🔴 REGRESSION: spawn_err > 3/day OR fixes_no_progress > 1/day → 即時 freeze plugin
```

## Rollback Plan

- **Plugin disable**: `gateway config.patch plugins.entries.self-healing-loop.enabled=false` — 30 秒
- **Config revert**: git checkout 改 config 前嘅 version
- **Trigger**: 出現 P0 regression、spawn_err surge、或 silent data loss

## Notes

### Sub-agent References
- Session #1: `agent:main:subagent:8eceeaf7-c4e5-42c7-bba1-2bce7559ccf0` (tune analysis)
- Session #2: `agent:main:subagent:c35223c3-a6df-403f-96b7-918cae90c8e2` (root cause)
- 兩 round output 喺對話 log

### Cross-references
- #168 (archived): Self-healing-loop fix-syntax 7-day observation
- #164-167 (archived): SHL 過往 4 個 fix cycles
- 配置文件: `extensions/self-healing-loop/openclaw.plugin.json`
- Telemetry: `.self_healing_loop.jsonl`

### Open Thread
Josh 6/24 之前想：
1. 等多 2 日 data
2. 然後 6/24 review
3. 決定 Option 1 嘅 scope 同 budget
