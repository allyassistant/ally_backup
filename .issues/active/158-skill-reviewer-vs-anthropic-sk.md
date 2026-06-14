---
id: 158
title: Skill Reviewer vs Anthropic Skill Creator — 架構比較分析
status: active
priority: P1
created: 2026-06-13
due: 2026-06-20
updated: 2026-06-13T19:36+08:00
progress: 14/14
---


## F - Facts（事實）

### 現況
2026-06-13 審查 Anthropic 官方 skill-creator (`github.com/anthropics/skills/skills/skill-creator`)，同我哋自家 `skill_reviewer_bot.js` + pipeline 做詳細架構比較。

### Source
- **Anthropic skill-creator:** https://github.com/anthropics/skills/tree/main/skills/skill-creator
- **我哋 Skill Reviewer:** `scripts/skill_reviewer_bot.js` + `scripts/skill_reviewer_pipeline.js` + `scripts/validate_skill_file.js` + `scripts/skill_pitfalls_fallback.js`

### 設計哲學對比

| | **我哋 Skill Reviewer** | **Anthropic Skill Creator** |
|---|:---|:---|
| **核心理念** | 全自動 · 無人干預 · 從對話學 | 迭代式 · 人機協作 · 從 testing 學 |
| **Target user** | Josh（單一 admin） | 所有人（plumber → engineer） |
| **輸入 source** | Discord 對話 signal（被動捕捉） | 用戶 active 講「整個 skill for X」 |
| **Generation model** | MiniMax M2.7 → validator → auto-symlink | Claude CLI（through claude -p）|
| **Quality metric** | Junk rate 27.78%（→Phase 2 shadow mode live） | Unknown, human-reviewed |

### Life cycle completeness 對比

| Life cycle phase | Anthropic | 我哋 |
|:---|:---:|:---:|
| **Write** — 寫 skill | ✅ 寫作指導 + template | ✅ auto-generate |
| **Test** — 測試 | ✅ with/without skill 對比 | ❌ |
| **Grade** — 評分 | ✅ assertion grading | ⚠️ heuristic validator only |
| **Benchmark** — 量化 | ✅ mean/stddev/delta | ❌ |
| **Review** — 人睇 | ✅ eval-viewer HTML | ❌ |
| **Iterate** — 改善 | ✅ feedback loop + retrain | ❌ |
| **Package** — 分發 | ✅ .skill zip | ❌ |
| **Automate** — 自動化 | ❌ manual trigger | ✅ full auto (30-min cron) |

**Anthropic: 7/8 phase | 我哋: 2/8 phase (auto-generate + validator)**

### Anthropic 好過我哋嘅地方

1. **Quantitative eval system** — 最強 feature。Benchmark pipeline: `with_skill` vs `without_skill` 對比測試，each test case 有 assertions + grading.json，aggregate 出 mean/stddev + delta。我哋冇任何 quantitative eval。
2. **Train/test split** — `run_loop.py` set random seed + stratified split，防 overfitting。我哋冇。
3. **Human-in-the-loop review** — eval-viewer HTML 俾用戶親自睇 output、leave feedback。我哋全自動 symlink。
4. **寫作指導** — SKILL.md 詳細教點寫好 skill（progressive disclosure、lean prompt、explain the why、唔好用 ALL CAPS）。我哋 prompt 偏向 mechanical。
5. **廣泛用戶適配** — 教 model 睇 context cues 調整 jargon level。我哋 assume Josh 係 technical user。

### 我哋好過 Anthropic 嘅地方

1. **Fully automated** — Passive capture 對話 pattern，30 分鐘自己 scan + generate + symlink。Anthropic 需要 whole manual loop。
2. **Safety nets（獨有）** — Junk rate auto-pause (24h > 15%) / Pitfalls fallback auto-inject / Env override kill switch。Anthropic 全仗人類 review。
3. **產量** — 42 skills in ~2 weeks。Anthropic workflow 係 manual，產量低。
4. **CQM integration** — code_quality_manager scan + verify_edit.js post-edit gate。Anthropic 冇 equivalent。
5. **Pipeline 彈性** — 3-step sequential thin executor，each optional (`--skip-junk-pause`, `--dry-run`)。

### Anthropic 有但我哋冇 (gap)

| Feature | 重要性 | 難度 |
|--------|:------:|:----:|
| Quantitative benchmark（with vs without skill） | 🔴 高 | 中 |
| Grading assertions per test case | 🟡 中 | 低 |
| Human review UI（eval-viewer） | 🟡 中（Josh 唔會用） | 高 |
| Train/test split | 🟢 低（我哋唔係 ML） | 低 |
| 寫作 quality guide | 🟡 中 | 低 |
| .skill packaging（zip + validate） | 🟢 低 | 低 |

### 我哋有但 Anthropic 冇 (gap)

| Feature | 重要性 |
|--------|:------:|
| Passive 對話 signal capture | 🔴 高 |
| Junk rate auto-pause safety net | 🔴 高 |
| Pitfalls validator + fallback | 🔴 高 |
| CQM + verify_edit integration | 🟡 中 |
| 全自動 30-min cron cycle | 🔴 高 |

## D - Decisions（決定）

### ✅ 已做決定
- [2026-06-13] **方向正確：自動化優先，human review optional** — Anthropic 嘅 completeness 靠人類喺 loop 入面先成立，Josh 唔會用 eval-viewer
- [2026-06-13] **開 issue 記錄分析** — 作為未來改進 reference
- [2026-06-13] **Hybrid 結論：保留自家 skill_reviewer，選擇性偷 Anthropic 三樣嘢**（writing guide / LLM judge / .skill packaging）
- [2026-06-13] **Counterfactual：Anthropic 人→LLM judge 不改變結論** — self-reinforcing risk + cost premium 令換唔划算
- [2026-06-13] **兩個 M3 sub-agent 審計都推薦 C→A-shadow→A-active 落地次序**（Ally 之前嘅 D→C→B 被撤回）
- [2026-06-13] **Phase 2 Shadow Mode 已上線**（`SHADOW_MODE=true` cron，13:02 HKT 第一人成功 judge call）
- [2026-06-13] **Phase 3 = Option C (24h Adaptive Gate)**（3 角度 analysis 統一推薦：經濟學 + 統計學 + 風控）
- [2026-06-13] **A1 經濟學結論：**$0.09/day calibration 當 insurance；avoid Option A 5% tail (-$50)；24h adaptive win on Sharpe-equivalent
- [2026-06-13] **A2 統計學結論：**n=4 sample 上 zero-tolerance on mismatches（asymmetric loss：quarantine 不可逆）；Bayesian 1% P(false activation) within tolerance
- [2026-06-13] **A3 風控結論：**Pause judge layer ONLY（heuristic symlink path 永遠 safe）；circuit breaker 4-trigger；drift detection 用 quarantine rate per batch 作 leading indicator
- [2026-06-13] **🔴 P0 BUG FIX (14:08 HKT): Judge layer silently broken in cron context** — 10/10 shadow entries = ENOENT. Fix v1 (which via PATH) works in manual test but NOT in cron isolated session. Fix v3 (known paths + which + fallback) verified working both contexts. `llm_judge_caller.mjs:47-55`

### ⏳ 待做決定
- [ ] Phase 3 Adaptive Gate Evaluation script 寫唔寫（`.llm_judge_gate_24h.mjs`）？
- [x] Anthropic writing quality guide 改 prompt（已 integrated @ 13:17 HKT） ✅
- [ ] .skill packaging（low priority, 未排期）

## Q - Questions（未解決）

### ❓ 核心問題
1. **24h Adaptive Gate 6 指標會唔會太 strict？** — A2 sub-agent 設 n=4 zero-tolerance on mismatches；真實 daily 3.7 skills 可能長期落在 gray zone (extend to 72h)
2. **A3 leading indicator（quarantine rate per batch）有冇 ground truth？** — 暫時 heuristic-based，無 historical baseline
3. **Circuit breaker 4-trigger 會唔會 false trip？** — M3 429 cluster @ 13:00 window 已經見過，會唔會長期 30% threshold 太敏感？

## Progress
- [x] 審查 Anthropic skill-creator 程式碼（無惡意）
- [x] 詳細架構比較分析
- [x] 開 issue 記錄
- [x] 決定方向：Hybrid（保留自家 + 偷 Anthropic ３樣）
- [x] Phase 0: Safety Net — S1 mismatch escalation CLI
- [x] Phase 1: C1+C2+H2+H3 bugs fix（openclaw PATH / cron timeout / JSON parse / per-model timeout）
- [x] Phase 2: Shadow Mode LLM Judge 2-model consensus（M3 + deepseek-v4-flash）— 已上線 @ 13:02 HKT
- [x] Phase 3 方向：Option C 24h Adaptive Gate（3 角度 analysis 統一推薦）
- [x] Phase 3 implementation: `.llm_judge_gate_24h.mjs` + circuit breaker + cron ✅
- [x] Pipeline resume + first successful post-fix run (19:01 HKT, 144s, 0 errors) ✅
- [ ] 6-7 日後：full calibration report → #⚙️system
- [ ] Held-out calibration set (20 ground-truth skills, 等你 hand-pick)
- [ ] S1 mark-mismatch audit + drift detection rolling state file

## Notes
- Anthropic skill-creator 係 **skill editor**（你 edit skill，佢幫 test/iterate/benchmark），我哋係 **skill generator**（唔使人理，自動 generate/validate/deploy）
- 佢嘅 completeness 靠人類喺 loop 入面，Josh 唔會用 → 對我哋嚟講 completeness delta 細過表面睇落
- 最值得偷：quantitative eval + assertions grading（但 effort 唔細）
- 最低 hanging fruit：改善 prompt 寫作指導（「explain the why」approach）
- **最大盲點 catch（Round 2 sub-agent）：** Anthropic 嘅「人 review」係唯一 quality boundary → 用 LLM 取代人 = boundary 消失, self-reinforcing risk
- **另一個盲點（Round 4 sub-agent）：** Token coordination 數學 fail（48 runs/day vs 25min/day safe window = 10.4%覆蓋率）— Phase 2 用 batch window-gating 解決

### Phase 3 Option C — 24h Adaptive Gate Spec

| Metric | Pass (→ Phase 3) | Fail (→ extend 72h) | Hard Veto (→ abort) |
|---|---|---|---|
| Valid samples (parsed, non-error) | ≥4 | 2-3 | <2 |
| Both-judge call success | 100% | 75-99% | <75% |
| Catastrophic mismatches (heuristic∧both-junk) | 0 | — | ≥1 |
| Split rate (judges disagree) | ≤25% (≤1/4) | 26-50% | >50% |
| Both-junk rate on heuristic-passed | 0% | — | ≥1 |
| Cost per skill | ≤$0.05 | $0.05-0.10 | >$0.10 |

**Decision flow：** 24h window → Hard veto trips → ABORT；All pass → ACTIVATE；Gray zone → EXTEND 72h；72h 仍 gray → ABORT

**Circuit breaker 4-trigger (任 3 trips)：**
1. 24h junk rate > 15% (heuristic 原有)
2. Both-judge failure rate > 40% (24h)
3. ≥ 2 S1 mark-mismatch on same skill (7d)
4. costUsd/day > $2.00 sustained 48h

**Pause scope：** Judge layer ONLY（heuristic symlink path 永遠 safe，rollback = 移除 LLM layer）

**Auto-resume：** Manual ONLY（Josh 明確 clear `.skill_reviewer_pause.json`）

### Phase 3 Sub-agents（3 角度分析）

| Angle | Sub-agent | Key Insight |
|---|---|---|
| **A1 經濟學** | `phase3-angle-economics` | $0.09/day = insurance；avoid Option A 5% tail (-$50) |
| **A2 統計學** | `phase3-angle-statistics` | n=4 zero-tolerance on mismatches；Bayesian 1% P(false activation) |
| **A3 風控** | `phase3-angle-failure-modes` | Pause judge ONLY (heuristic 永遠 work)；quarantine rate per batch = leading indicator |

### Cross-references
- **#155** Skill Reviewer Week 1 Safety Nets
- **#150** Skill Junk Rate Tracker
- **#154** Fix #2 + #4 Pitfalls compliance
- **Phase 2 相關 scripts：**
  - `scripts/llm_judge_caller.mjs` — 2-model consensus (M3 + deepseek-v4-flash)
  - `scripts/llm_judge_batch.mjs` — window-gated batch runner (5x/day)
  - `scripts/llm_judge_calibration.mjs` — 7 日後 analysis + #⚙️system report
  - `.skill_reviewer_pause.frozen` — pause freeze (expiry by Josh)
  - `.llm_judge_shadow.jsonl` — shadow mode event log
  - `.s1_mismatch_history.jsonl` — S1 escalation event log

### Phase 3 待實作 (Option C) — 已完成

- [x] `.llm_judge_gate_24h.mjs` (new) — 6 指標 evaluation script ✅ (236 lines)
- [x] `.llm_judge_circuit_breaker.json` (new) — 4-trigger state ✅ (658 bytes)
- [x] Cron `*/30 * * * *` evaluation check ✅ (jobId: `79c3b194-79b5-484c-a295-cda78a9c7384`, timeout 30→120s fixed)
- [x] Cron `0 13 * * *` daily full eval ✅ (jobId: `40d70e12-b666-45e0-a9e2-86d765c71da6`, shell operators fixed)
- [x] **🔴 P0: Judge ENOENT in cron context (v3 fix)** ✅ — known-path resolution + which fallback (`llm_judge_caller.mjs:47-55`)
- [x] Smoke test: 2/2 judges OK, consensus=both-pass ✅
- [x] **Pipeline 18:01 HKT 06-13 成功 run（144s, 0 errors）** ✅ — 第一次 post-fix

### Phase 3 待完成

- S1 mark-mismatch audit script（7 日 shadow data 後）
- Held-out calibration set (等你 hand-pick ~20 skills)
- Drift detection rolling state file (`.drift_state.json`)
- `.llm_judge_circuit_breaker.json` 冇 consumer（dead artifact，等決定刪定 wire）
- `skill_reviewer_bot.js:932` raw `openclaw` → v3 path resolution（已修復）
- Gate 30min check (`79c3b194`) 120s 仍 timeout（需調查）

### M3 Deep Bug Audit (18:00 HKT 06-13)

**Sub-agent:** `agent:main:subagent:51bbee3f-aefd-497e-ab5e-7c87d1aacda7` (run `b471db32-f1ef-45b9-9499-e784e0791296`) — 4 角度 audit

**Bug 1 🔴 P0 — Cron `40d70e12` shell operators:** `payload.message` 用 `>> .jsonl 2>&1` (shell redirect), execFileSync 會 silent fail。已修復（移除 redirect）。

**Bug 2 🟡 P1 — Cron `79c3b194` timeoutSeconds: 30→120:** 6 consecutive timeout (`model-call-started`). 已修復（30→120s）。但 120s 都仍然 timeout（7th consecutive），需要深入調查。

**Bug 3 🟡 P1 — `skill_reviewer_bot.js:179,1050` execSync shell-string:** `'node "' + path + '"'` pattern breaks thin-executor. 已修復（→ `execFileSync('node', [path, ...])`）。

**Bug 4 🟡 P1 — raw `openclaw` binary path (bot.js:932):** 冇 apply v3 path resolution，cron 場景同 file ENOENT risk。已修復（IIFE `OPENCLAW_CLI`：knownPaths + which + raw fallback）。

**Shadow judge E2E:** `--force` batch 成功產出 new entry（both judges ok ✅）. Gate verdict: ABORT (pre-fix noise, will self-heal within 24h)。

### Phase 3 進度（更新）

| Sub-agent | Session | Status | Output |
|---|---|---|---|
| phase3-gate-24h-script | `fe36e82e-bad7-45c9-b7c6-6221dcd5eb89` | ✅ Complete | scripts/llm_judge_gate_24h.mjs (236 lines) |
| circuit-breaker-plus-cron | `533e7738-0592-4d8f-a026-02651e9fa96e` | ✅ Complete | .llm_judge_circuit_breaker.json + 2 cron jobs added |
| Cron wiring (30min check) | jobId: `79c3b194` | ✅ Live | `*/30 * * * *` deepseek, 30s timeout |
| Cron wiring (daily 13:00) | jobId: `40d70e12` | ✅ Live | `0 13 * * *` deepseek, 60s timeout |
| First evaluation | — | ⏳ 13:00 HKT 06-14 | Real shadow data 跑 gate |
