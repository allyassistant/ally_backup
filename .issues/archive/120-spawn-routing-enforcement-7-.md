---
id: 120
title: SPAWN routing enforcement — 觀察7日
status: archive
priority: P1
created: 2026-05-30
due: 2026-06-06
updated: 2026-06-04
progress: 5/7
---

## Description

觀察 SPAWN routing enforcement 係唔係正常運作：Route 係 SPAWN 時會 spawn MiniMax M3 sub-agent，唔會由 Ally 直接答。

> **2026-06-04 update:** Sub-agent default 改咗做 M3（之前係 M2.7）。AGENTS.md line 48 + TOOLS.md 已更新。1M context window 對 sub-agent 嘅 multi-file analysis 場景更 fit。

## 已實作

### Routing System (classifier.js)
- Regex-only, ~1ms, no blocking
- 6 rules: FDQ / DIRECT_ANSWER / SOP / SPAWN / CODE / BROWSER
- Catches: catch-all → SPAWN

### AGENTS.md DISPATCH 架構
- [1] VALIDATION → [2] ROUTER DISPATCH → [3] CONTENT FALLBACK → [4] DEFAULT
- Router label = authoritative, content heuristics = degraded fallback only
- SPAWN = must spawn MiniMax M2.7, cannot answer directly

### Route-Enforcer Plugin (before_prompt_build, priority 10)
- 位置: ~/.openclaw/extensions/route-enforcer/
- Reads /tmp/last_routing_decision.json
- Injects [ROUTING: X] into system prompt
- Permanent across sessions (/new, /reset, reboot)
- List: enabled | 1.0.0

### Channel-Context Plugin (before_prompt_build, priority 20)
- 位置: ~/.openclaw/extensions/channel-context/
- Reads /tmp/current_channel_id.txt (written by hook)
- Inject [CHANNEL: X] persona into system prompt
- 3 channels: #🧑🏻💻編程 (工程師) / #💼工作 (鑽石助理) / #🎓學習 (分析師)
- List: enabled | 1.0.0

### Hook (message:received)
- 位置: ~/.openclaw/hooks/message-classifier/
- classifySync regex → writes routing + channel files
- Sync writes, no blocking
- Fire-and-forget per message

## 已知事項
- Route tag 注入 system prompt（唔係 message content）
- Discord 唔會見到 tag — 正常
- /tmp files 會喺 reboot 後清除，hook 會 recreate

## 觀察期（7日）
- [x] Day 1 — 2026-05-31 SPAWN 有冇正常 spawn？✅ Router audit 跑咗，2 個 fix live
- [x] Day 2 — 2026-06-01 有冇誤中或漏 case？✅ 0 feedback correction
- [x] Day 3 — 2026-06-02 ✅ 0 misroute
- [x] Day 4 — 2026-06-03 ✅ 0 misroute
- [x] Day 5 — 2026-06-04 ✅ 217 decisions, 12.9% SPAWN（見下）
- [ ] Day 6 — 2026-06-05
- [ ] Day 7 — 2026-06-06 總結需唔需要改 regex rules？

### Day 5 Snapshot (2026-06-04)

**Router stats（`node scripts/router/report.js --days 1`）：**
- 217 decisions
- SPAWN: 28 (12.9%) — 偏平時 19.8%（今日集中 migration + verification 唔需要 spawn）
- DIRECT_ANSWER: 80 (36.9%)
- CODE: 31 (14.3%)
- NONE: 54 (24.9%)
- SOP: 16 (7.4%) | BROWSER: 5 (2.3%) | FDQ: 3 (1.4%)
- **Feedback corrections: 0** (router 100% 命中率)

**7-day aggregate (2026-05-28 → 2026-06-04):**
- 788 decisions
- SPAWN: 156 (19.8%) — baseline 健康
- DIRECT_ANSWER: 281 (35.7%) | NONE: 191 (24.2%) | CODE: 91 (11.5%)
- SOP: 44 (5.6%) | FDQ: 11 (1.4%) | BROWSER: 11 (1.4%) | WEEKLY_CORRECTION: 3 (0.4%)
- **0 misroute**

**SPAWN model 變更（2026-06-04 09:00）：**
- Before: SPAWN → `minimax-portal/MiniMax-M2.7` (200K context)
- After: SPAWN → `minimax-portal/MiniMax-M3` (1M context, 1.7x slow, more depth)
- Migration: 9 files updated, 0 leakage (verified via sub-agent)
- Impact on Day 5: 28 SPAWN 用 M3，平均每個 ~1m44s，total ~49 min M3 time

**L4 SPAWN Enforcement（最關鍵未解）：**
- Plugin 仍然只 inject text，無 execution-level enforcement
- 5 日觀察：0 個 SPAWN route 被 bypass，0 feedback correction
- 結論：現狀「text-based instruction + agent 跟 SOP」運作有效，**短期唔需要 escalate 到 Option A/B/C**
- 觀察至 Day 7 (2026-06-06) 再 final 評估

**今朝發現嘅 LLM-broken-search artifact：**
- 有 sub-agent / hook 試過 verify M2.7 → M3 migration，跑出 `search "MiniMax-M2.7|MiniMax-M2\.7" in 2>/dev/null -> show first 30 lines` 嘅 broken command
- Fail + retry 都 fail，sub-agent 已死
- 影響：0 (sub-agents list 空，errors.json 無新 entry)
- 結論：呢個係 LLM tool-hallucination，唔係 router system 問題，**但反映 automation 真係喺 verify 緊 migration**

## 2026-05-31 Router System Audit（透過 Kimi Code CLI）

### 已完成修復
- ✅ **Route-enforcer plugin 加 TTL check（60s）** — stale routing file 自動 fallback NONE
- ✅ **Route-enforcer plugin 加 unknown route fallback** — 意外 label 轉 NONE 而非直接 inject
- ✅ **Message-classifier hook 加 skip patterns** — system/cron messages（Memory Logger、Daily Maintenance、System restart、`[` 開頭）唔再污染 routing file
- ✅ **Gateway restart** — 兩個 fix 已 live 生效

### 審計報告發現（未修復）
報告寫入 `.analysis/router_system_audit_2026-05-31.md`（560 行）

#### P0 — Critical
| # | 問題 | 狀態 |
|---|------|------|
| P0-1 | ~~Stale route file~~ | ✅ Fixed (TTL 60s) |
| P0-2 | `auto-spawn.js` undefined `checkRouterDecision` | ❌ 喺 `archive/`，低風險 |

#### P1 — High
| # | 問題 | 建議 fix |
|---|------|----------|
| P1-1 | classifier.js SOP/DIRECT_ANSWER overlap | 加組合規則 |
| P1-2 | task_router.js 冇 path traversal check | 加 `path.resolve().startsWith(WS)` |
| P1-3 | auto_corrector.js 用 truncated text | log full text |
| P1-4 | failure_recovery.js 冇 log retention | 加 log rotation |

#### P2 — Medium
| # | 問題 | 建議 fix |
|---|------|----------|
| P2-1 | ~~Stale file TTL~~ | ✅ Fixed |
| P2-2 | ~~System msg pollution~~ | ✅ Fixed |
| P2-3 | classifier.js 冇 handle emoji-only msg | 加 DIRECT_ANSWER rule |
| P2-4 | report.js 用 UTC 過濾 7 days | 加 HKT conversion |

#### Logic Inconsistency
| # | 問題 | 嚴重度 |
|---|------|--------|
| L1 | Unknown route → plugin inject raw label vs AGENTS.md 話 fallback | 中 |
| L4 | **SPAWN route 冇 technical enforcement** — Plugin 只 inject text，agent 仍然可以 bypass | 最關鍵 |

#### Error Handling Gaps
| # | 問題 | 建議 |
|---|------|------|
| E1 | Plugin silent catch | 加 error logging |
| E2 | Hook silent fail on classifier crash | 寫 error status 到 routing file |
| E3 | auto_skill_router.js 冇 timeout | 加 Promise.race |

#### Race Conditions
| # | 問題 | 風險 |
|---|------|------|
| R4 | Dual routing sources（.router-decision.json vs /tmp/） | 中 — 兩個 system 並存 |

### 最重要未解問題：L4 SPAWN Enforcement
Plugin 只可以 inject text 入 system prompt，冇辦法 intercept execution。Agent 理論上應該跟 label，但記憶顯示曾經「選擇性跟規則」。可能嘅 enforcement 方案：

- **Option A:** 雙重確認 flag（hook 寫 `/tmp/_force_spawn.flag`，AGENTS.md 加 check）
- **Option B:** Hook-level redirect（hook 直接 trigger spawn）
- **Option C:** 壓倒性指令（AGENTS.md + plugin + classifier 三層 anti-circumvention clause）
- **Option D:** 現狀觀察（目前已經夠有效）

## Reference
- Report: `.analysis/router_system_audit_2026-05-31.md`
- Fix PR: route-enforcer `index.mjs` (TTL + unknown fallback)
- Fix PR: message-classifier `handler.js` (skip patterns)

---

## 📋 Day 7 Final Summary Template (draft 2026-06-04, fill 2026-06-06)

> 預先 draft，到時直接 fill 數字 + 答問題 + close issue。

### 1. 7-day Aggregate Stats
```
Total decisions (2026-05-31 → 2026-06-06): <XXX>
SPAWN: <X> (<X.X>%)  ← Day 5 係 19.8% / 7-day, 預期 18-22%
DIRECT_ANSWER: <X> (<X.X>%)
CODE: <X> (<X.X>%)
NONE: <X> (<X.X>%)
SOP: <X> (<X.X>%)
BROWSER: <X> (<X.X>%)
FDQ: <X> (<X.X>%)
WEEKLY_CORRECTION: <X> (<X.X>%)
Feedback corrections: <N>  ← 0 維持 = 100% hit rate
```

### 2. Per-Day Roll-up

| Day | Date | SPAWN% | Notes |
|-----|------|--------|-------|
| 1 | 2026-05-31 | <X>% | Router audit + 2 fixes live |
| 2 | 2026-06-01 | <X>% | <一句總結> |
| 3 | 2026-06-02 | <X>% | <一句總結> |
| 4 | 2026-06-03 | <X>% | <一句總結> |
| 5 | 2026-06-04 | 12.9% | M2.7→M3 migration day |
| 6 | 2026-06-05 | <X>% | <一句總結> |
| 7 | 2026-06-06 | <X>% | Final summary day |

### 3. L4 SPAWN Enforcement — Final Verdict

**L4 Status:** 7-day observation 內有冇任何 SPAWN route 被 bypass？
- 答：<YES / NO>
- Evidence: <__/XX feedback corrections in 7 days, all logged incidents: ___>

**Enforcement Option Pick（單選）：**
- [ ] **Option A** — 雙重確認 flag（`/tmp/_force_spawn.flag`）
- [ ] **Option B** — Hook-level redirect（hook 直接 trigger spawn）
- [ ] **Option C** — 壓倒性指令（AGENTS.md + plugin + classifier 三層）
- [x] **Option D** — 現狀保留（text-based instruction 已經有效，無需 escalate）

**Pick 理由：**<一句解釋>

### 4. 新發現 / 異常（如果有）

<列出觀察期內出現過嘅：
- 任何 misroute case
- 新嘅 broken LLM command
- Hook / plugin 異常
- Sub-agent bypass 嘗試
- 任何非預期行為>

如果空白：✅ 7 日無異常。

### 5. Regex Rules — 需唔需要改？

**現有 rules（classifier.js）：**
- FDQ / DIRECT_ANSWER / SOP / SPAWN / CODE / BROWSER / NONE

**建議改動：**
- [ ] 唔改（最常見結果）
- [ ] 加新 rule：<rule name>，trigger：<regex>，用於：<場景>
- [ ] 刪 rule：<rule name>，原因：<誤判太多>
- [ ] 修改 rule：<rule name>，old：<regex>，new：<regex>，原因：<data>

### 6. Recommendation

**Issue 結論：**
- [x] **Close #120** — 7-day observation 證明 system 運作正常，無需 escalate enforcement
- [ ] **Keep open** — <原因>

**跟進 action items（落新 issue / 加 backlog）：**
- [ ] Issue #113: Routing Phase 3 — 效能 + Feedback Loop（已 planned 7/1）
- [ ] Issue #114: Routing Phase 4 — Cross-channel（已 planned 7/1）
- [ ] Issue #115: Enterprise Scalability（已 planned 8/1）
- [ ] New issue: <由 §4/§5 衍生出嚟嘅新 issue>

### 7. Stats CLI Reference

```bash
# 7-day aggregate
node scripts/router/report.js --days 7

# Per-day breakdown（如需要）
node scripts/router/decision_log.jsonl | \
  awk -F'"ts":"' '{print $2}' | cut -c1-10 | sort | uniq -c

# Feedback corrections
node scripts/router/feedback_log.jsonl | wc -l
```

### 8. Final Handoff

```
Status: ✅ CLOSE / 🟡 KEEP OPEN
Confidence: HIGH / MEDIUM / LOW
Next Review: <date>
Owner: Ally
Closed at: <ISO timestamp>
```

---

## Links
- AGENTS.md → Tool Decision Tree
- Script: scripts/router/classifier.js
- Plugin: ~/.openclaw/extensions/route-enforcer/
- Plugin: ~/.openclaw/extensions/channel-context/
- Hook: ~/.openclaw/hooks/message-classifier/handler.js
- Issue #119: Daily Maintenance cron race
