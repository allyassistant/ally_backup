---
id: 161
title: FakeMaidenMaker文章實作 — Skill Description Audit + Activation Control
status: archive
priority: P1
created: 2026-06-14
due: 2026-06-21
updated: 2026-06-19
progress: 0/6
---

## F - Facts（事實）

### 源頭
- 2026-06-14 02:17 Josh 要求 M3 深入分析 @FakeMaidenMaker「如何写出工业级 Skill」文章
- M3 因 Token Plan limit 失敗，改 direct analysis
- Analysis 完成已寫入 Obsidian + memory + #🧑🏻‍💻編程
- 2026-06-14 02:38 Josh: 「開#161」

### 背景
文章提出 Anthropic ecosystem 嘅 skill best practices，其中同我哋系統直接相關嘅 improvement 分為 3 phases。呢個 issue 追蹤 Phase 1（<1 星期可完成）。

### 核心文章框架
- **三段 description 公式**：`[做咩] + [幾時用] + [關鍵能力]`，第三人稱，≤1024 chars
- **Activation control**：`disable-model-invocation: true` 關閉自動觸發
- **Allowed-tools**：每 skill 只給最小權限
- **Progressive disclosure**：三級 loading（description → SKILL.md → references/）
- **Model allocation**：複雜→強 model，簡單→平 model
- **6 層測試 loop**：執行→觸發→數據→評分→基線→迭代

### Source
- X 文章：https://x.com/fakemaidenmaker/status/2051111166416396713（267K views）
- Obsidian note：`Knowledge/Concepts/FakeMaidenMaker-如何写出工业级Skill`
- Full analysis：記憶 2026-06-14 section「FakeMaidenMaker Article Deep Analysis」

## D - Decisions（決定）

### ✅ 已做決定
- [2026-06-14] **Phase 1 Description Audit + Activation Control** — 呢個星期完成
- [2026-06-14] **Allowed-tools + Progressive Disclosure** — Phase 2，下個 sprint（已記錄 analysis 但呢個 issue scope 限 Phase 1）

### ⏳ 待做決定
- [ ] Description audit 改咗之後，邊幾條要重新 trigger test？（至少 41 條全部要）
- [ ] 除咗 6 個自動判別嘅 `manual` skills，有冇其他都要手動？
- [ ] #158 嘅 Phase 3 completion 同呢個 phase 1 關係點協調？（同時做定先後？）

## Q - Questions（未解決）

### ❓ 核心問題
1. **OpenClaw skill frontmatter 支援咩 custom fields？** — `activation` 呢個 field 係咪要另外 create，定已經有 schema？
2. **Allowed-tools 係咪 OpenClaw native support 定要先 research？** — 影響 Phase 2 priority
3. **Description audit 要 Josh 帮手 review 嗎？** — AI-generated rewrites 一定要人 final sign-off

### 🔍 追問
- Description audit script 應該出 report 定直接建議改动？
- Activation classification 嘅 trigger keywords list 要唔要 expansion？
- 如果 skill 被 mark 咗 `manual`，點樣叫佢？（skill_workshop / slash command？）

## Progress

### Phase 1 — 呢個 sprint（<1 星期）

- [ ] 1/6 — `scripts/skill_description_auditor.js`：scan 41 skills，check 3-criteria（做咩/幾時用/第三人稱），output audit report
- [ ] 2/6 — Batch update descriptions（先 top 10 最高頻 skills，再擴展全部）
- [ ] 3/6 — Skill activation classification：`skill_reviewer_bot.js` 加 `activation: auto|manual` metadata
  - manual candidates：`openclaw-managed-upgrade`, `cross-machine-deployment`, `model-migration-workflow`, `systemevent-main-session-isolation`, `cron-migration`, `cron-config-audit`
- [ ] 4/6 — `validate_skill_file.js` 加 Appendix C checklist items（XML 尖括號檢測、trigger phrase existence check）
- [ ] 5/6 — `#161` 完成後 update `#158` cross-reference
- [ ] 6/6 — 寫 `scripts/skill_activation_tester.js` verify manual skills 唔會被 auto-trigger

### Phase 2（下個 sprint，記錄用）
- [ ] Allowed-tools OpenClaw schema confirm + deploy to 6-8 critical skills
- [ ] Progressive disclosure for top 5 longest skills
- [ ] Trigger tester v1（`scripts/skill_trigger_tester.js`）

### Phase 3（長線）
- [ ] 6 層 full testing loop（baseline comparison）
- [ ] Model hint system（`preferred_model` → spawn_config.js）
- [ ] Skill catalog scoring

## Closing Criteria

```
✅ PASS: 41 descriptions audited + 6 manual skills classified + validator extended
🟡 PARTIAL: 20+ descriptions done + 6 manual classified → extend 7 日
🟠 NEEDS MORE: <20 descriptions or manual classification not done
🔴 REGRESSION: Description changes caused incorrect trigger behavior
```

## Rollback Plan
- Description changes：`git checkout HEAD~1 -- ~/.openclaw/skills/` + `skill_workshop update`
- Activation changes：`skill_reviewer_bot.js` revert + `git revert <sha>`
- Validator changes：`git checkout HEAD~1 -- scripts/validate_skill_file.js`
- 觸發條件：Continuous 3 days of increased junk rate or zero trigger rate

## Cross-references
- **#158** Skill Reviewer vs Anthropic Skill Creator（related testing loop improvement）
- **#150** Skill Junk Rate Tracker（quality evaluation metric）
- **#160** Kimi WebBridge POC（unrelated, but same day）
- Obsidian note：`Knowledge/Concepts/FakeMaidenMaker-如何写出工业级Skill`
- Memory：2026-06-14「FakeMaidenMaker Article Deep Analysis」
