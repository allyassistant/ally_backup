---
id: 125
title: 2026-06-03 系統全面檢修：AGENTS.md重構 + Kimi Deep Research + Channel Topics
status: archive
priority: P1
created: 2026-06-04
due: 2026-06-11
updated: 2026-06-07
progress: 0/0
---

## F - Facts（事實）

### 今日改動總覽（2026-06-03 13:00 → 2026-06-04 01:44 HKT，~12小時）

#### 新創建文件
- `skills/kimi-deep-research/SKILL.md`（164 lines）
- `.spawn/structured_spawn.template`（46 lines）
- Obsidian notes ×3（Diamond Market, De Beers/Alrosa, McKinsey Prompt）
- Wiki syntheses ×2（Diamond Market, De Beers/Alrosa）
- 系統審計報告 `.state/system_audit_report_2026-06-03.md`

#### AGENTS.md 改動（最終 466 lines）
- Routing System: 移除 `/tmp/routing` file check → 統一 system prompt label check
- Reply Rules: table header `| 情況（觸發：Josh） | 反應（Ally嘅行動）|` + sessions_yield 條件化
- Sub-agent Response: absolute `❌ 唔好 yield` → `✅ 先覆...之後可 yield`
- Spawn Failure Recovery: timeout 拆 3 scenarios（running / error / >30s）
- SPAWN label: 加 CODE vs SPAWN cross-reference
- CODE label: 加 CODE vs SPAWN cross-reference
- Pipeline Tier: 加 tie-breaker rule + Done step 定義
- Stop and Ask: 改為「獨立於 Pipeline Tier」
- SOP Index: Kimi SOP 縮短為 key flow + 詳見 skill
- Compaction: Do-Not-Redo 加入 Extended section + 淘汰優先級
- Session end: handoff 必做 + `.cross_session_context.md` 係 source of truth
- Session start: proactive alerting + cron fail ≥3 次 escalation
- Search rules: 直覺判斷留低
- Output rules: 「既」禁止作為「嘅」替代品
- 「既」用詞修正：3 處（line 77, 156, 306）
- Templates list: 加 inline structure summary
- X Link 例外：分開「進度回覆」vs「最終分析結果」
- Last Updated 移除

#### HEARTBEAT.md 改動
- 版本更新：2026-05-19 → 2026-06-03
- Job count：18 → 21
- Memory Dreaming 壓縮（disabled job description 收細）
- Numbering fix：triplicate #12 修復

#### Channel Topics 改動
- #🧑🏻‍💻編程：角色扮演 instruction → activity context hints
- #🤖一般：同上 format（使用者已手動更新）
- #💼工作：同上 format（使用者已手動更新）
- #⚙️系統：同上 format（使用者已手動更新）
- #💬翻譯：同上 format（使用者已手動更新）
- #📕日記：同上 format（使用者已手動更新）

### 外部 Review 次數
- TypeScript 審計 ×1
- Josh 審計 ×2
- MiniMax sub-agent review ×3
- Kimi CLI audit ×3
- 最終自我審計 ×1
- 總計 ~30 個 fix iterations

### 實測驗證
- Kimi Deep Research：成功做鑽石 market research（8 phases, ~3 min ✅）
- De Beers/Alrosa：成功但 11 phases timeout（40+ min ❌ → prompt scope fix）
- Anomaly Monitor：06:30 timeout → 18:30 ✅ ok（transient issue）
- MiniMax spawn：多次成功（AGENTS.md review, template critique）
- `structured_spawn.template`：經過 3 輪 critique，P0 issues 全部 fix

## D - Decisions（決定）

### ✅ 已做決定
- 2026-06-03：建立 `skills/kimi-deep-research/SKILL.md`，記錄 Deep Research 使用方式 + pricing reality
- 2026-06-03：建立 `.spawn/structured_spawn.template`（5-phase: Discover→Plan→Implement→Verify→Report）
- 2026-06-03：AGENTS.md 移除 Phase System（與 Pipeline Flow 重疊）
- 2026-06-03：AGENTS.md 移除 Plan for the Plan（context handoff cost 太高）
- 2026-06-03：移除 non-Josh user rule（sender_id 可靠識別你一個人）
- 2026-06-03：移除 Last Updated date（唔好寫死日期）
- 2026-06-03：Channel topics 改為 activity context hint format（唔係 tone instructions）
- 2026-06-03：Research results 直接 write_to_obsidian + wiki_apply（唔經 cron pipeline）
- 2026-06-03：Cron job prompts 唔改（audit 建議 update 但 scope 控制）
- 2026-06-03：sessions_yield 條件化（先覆後 yield，唔係 absolute ban）

### ⏳ 留待下次討論
- HEARTBEAT.md 4 undocumented templates（critic/research/spec_writer/validator）— 由 `ls .spawn/` discover
- Security 規範擴充（Shell Injection + API Keys — 可補 P0/P1/P2）
- Spawn model fallback（MiniMax unavailable 時用邊個？）
- Compaction Trigger Conditions（~50 messages heuristic — 冇 script 實作）

## Q - Questions（未解決）

### ❓ 核心問題
1. Kimi Deep Research 同 spawn MiniMax 既 decision boundary 仲清唔清晰？— 已落 SKILL.md，但實際用時可能仍有模糊
2. AGENTS.md 466 lines 係咪已經係 optimal size？定應該開始拆去 docs/？
3. Per-channel behavior profile 值唔值得加？— 決定唔加住，靠 metadata + context hints
4. HEARTBEAT.md `docs/content-guide.md` reference 長期有效？— 已驗證 exists

### 🔍 觀察
- 今日既改動大部分係 polish／consistency，唔係新功能
- 最大 behavioral change：sessions_yield 由 absolute ban → conditional（先覆後 yield）
- 最大架構 change：channel topics 由 tone instruction → activity context hints
- 文件 integrity：經過 3 輪 external review，contradictions 已全部 resolved

### 數據/證據

| 文件 | Size | Lines | Status |
|------|------|-------|--------|
| AGENTS.md | 22KB | 466 | ✅ Reviewed ×6 |
| HEARTBEAT.md | 12.9KB | — | ✅ Numbering fixed |
| SKILL.md | ~3KB | 164 | ✅ Tested, timeout fix |
| structured_spawn.template | ~1.5KB | 46 | ✅ Reviewed ×3 |
| code_fix.template | ~1.2KB | 37 | ✅ Unchanged |

## Progress
- [x] Kimi Deep Research skill 建立 + testing + pricing reality
- [x] .spawn/structured_spawn.template 建立 + critique ×3 + fix
- [x] AGENTS.md overall execution (Routing → Reply Rules → Spawn → Pipeline → Compaction → SOP)
- [x] AGENTS.md consistency fix ×~30 iterations
- [x] HEARTBEAT.md numbering + memory dreaming fix
- [x] Channel topics update (編程已改，其他使用者手動改)
- [x] global system audit ×1 + fix
- [x] Issue 創建

## Notes
今日係系統文件 overhaul 既一日。由 Kimi Deep Research 開始，到建立 skill、template、反複 fix AGENTS.md、update HEARTBEAT.md、reformat channel topics。每份文件都經過至少 2 輪 external review（TypeScript/Josh/MiniMax），所有 contradictions 已 resolve。AGENTS.md 由頭到尾重構一次，而家係 466 lines consistent state。
