---
id: 168
title: Self-healing-loop fix-syntax 7-day observation
status: archive
priority: P2
created: 2026-06-17
due: 2026-06-24
updated: 2026-06-22
progress: 2/5
---

## F - Facts（事實）
> 確定已知的事實、數據、現狀

### 現況
Self-healing-loop plugin 已全部修復，現以 `fix-syntax` mode 運行：
- 自動 detect syntax errors + P0 violations
- 自動 spawn M3 fixer sub-agent 修復
- 修復後 send notification 去 #⚙️系統（廣東話格式，包 residual P1/P2）
- Fixer internal SOP: 2 retry max per file

### 修復記錄（已 closed）
- #164: Root cause — ESM require() + conversation gate
- #165: spawnFixer SDK contract — task→message, split provider/model
- #166: apply_patch path extraction
- #167: 4 P1 issues (regex coverage, fixer-prompt, mode gate, sessionKey)
- Plus: --quiet bug, ANSI parsing, subagent.allowModelOverride, notification feature

### Config
- mode: fix-syntax
- perFileBudget: 1
- sessionFixerCap: 1
- provider: minimax-portal/MiniMax-M3 → deepseek/deepseek-v4-pro (fallback)
- notifications: #⚙️系統 channel (1473376125584670872)

## D - Decisions（決定）

### ✅ 已做決定
- 2026-06-17: 維持 fix-syntax mode，唔升 fix-all（P1/P2 auto-fix 風險太高）
- 2026-06-17: 唔加 plugin-level 2nd fix pass（fixer internal 已有 2 retry）
- 2026-06-17: Notification 發去 #⚙️系統（廣東話 + residual P1/P2 list）

### ⏳ 待做決定
- 2026-06-24: 睇 7-day telemetry，決定：
  a) 繼續 fix-syntax（如果一切正常）
  b) 加 new mode fix-magic-numbers（if P1 residual rate high）
  c) 升 fix-all（唔建議）

## Q - Questions（未解決）

### ❓ 核心問題
1. Fixer success rate 夠唔夠高？（target > 90%）
2. False positive rate（verify_fail but no actual error）？
3. Fixer 引入新 bug 嘅頻率？
4. P1/P2 residual rate 有幾高？需唔需要新 mode？

### 🔍 追問
- M3 primary success rate vs fallback rate？
- Average fix time per file？
- 邊類 syntax error 最常見？

## Progress
- [x] Plugin 全修復 (2026-06-17)
- [x] End-to-end verified (2026-06-17)
- [x] Notification feature added (2026-06-17)
- [x] verify_edit.js .mjs/.cjs support (2026-06-17)
- [ ] 7-day observation ongoing (due 2026-06-24)
- [ ] Review telemetry 2026-06-24
- [ ] Decide next steps

## Notes
- Telemetry: ~/.openclaw/workspace/.self_healing_loop.jsonl
- Plugin: extensions/self-healing-loop/index.mjs (535 lines)
- Fixer prompt: extensions/self-healing-loop/fixer-prompt.md (70 lines)
- verify_edit.js: 335 lines (now supports .mjs/.cjs)

## Architecture Drift Note (2026-06-21)

Round 5 M3 audit found: Issue body still describes pre-2026-06-20 M3 sub-agent
architecture with provider chain (minimax-portal/MiniMax-M3 → deepseek-v4-pro).
Actual code since 2026-06-20 runs **Alt A deterministic LOW_RISK_RULES** path
(via `scripts/lib/rules/low-risk.js` + createRequire).

Evidence:
- `.self_healing_loop.jsonl` last `spawn_*` event: 2026-06-19 (5 days before transition)
- `index.mjs` `actualModel='deterministic:low_risk_rules'`
- `readFixerPrompt()` and `fixer-prompt.md` (70 lines) are now **DEAD CODE**
- 4/4 fix attempts since transition succeeded (100%)

Decision needed (Josh): close #168 + open new issue tracking Alt A specifically,
OR keep #168 with this drift note.

## Notes
