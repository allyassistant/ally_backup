---
id: 172
title: Wiki Daily Ingest: 觀察新 script 效能
status: archive
priority: P3
created: 2026-06-19
due: 2026-06-26
updated: 2026-07-04
progress: 0/7
---

<!--
  Issue type: observation
  — 觀察 wiki_daily_ingest.js (direct write) vs 舊 wiki_ingest_helper.mjs (CLI + fallback)
  — 7-day window：睇下有冇需要轉返舊
-->

## F - Facts（事實）

### 現況
- 2026-06-19 01:00：新 script `scripts/wiki_daily_ingest.js` 首次 deploy
- 取代舊 `wiki_ingest_helper.mjs` CLI-first + fallback 流程
- 改變：3 exec commands → 1 exec command | CLI spawn → direct write only | 自動 L0/L1 fallback（今日→昨日）
- 舊 script 仍然存在（`wiki_ingest_helper.mjs`），冇 delete，可隨時還原

### 新舊對比

| 項目 | 舊 (wiki_ingest_helper.mjs) | 新 (wiki_daily_ingest.js) |
|------|-----------------------------|---------------------------|
| CLI subprocess | ✅ `openclaw wiki ingest` 先，fail 先 fallback | ❌ 冇 CLI，直接 write |
| Exec commands | 3（MEMORY + L0 + L1） | 1（batch all） |
| L0/L1 fallback | ❌ 冇（要 cron payload 自己 fallback） | ✅ 自動（今日冇→昨日） |
| Dry-run | ❌ 冇 | ✅ `--dry-run` |
| Atomic write | ❌ `writeFileSync` | ✅ `writeFileSync + tmp.${pid} + renameSync` |
| Timeout | 300s（CLI hang） | 唔需要（冇 CLI） |

### 風險
- 新 script 直接寫 `wiki/sources/` — 如果 file format / content 同 `openclaw wiki ingest` 唔一致，compile 會 fail
- 冇咗 `openclaw wiki ingest` 嘅 model call enrichment（不過舊 script fallback 都冇，所以冇 regression）

## D - Decisions（決定）

### ✅ 已做決定
- 2026-06-19 決定：用 `wiki_daily_ingest.js` 取代 `wiki_ingest_helper.mjs` 做每日 01:00 cron
- 舊 script 保留（唔 delete），還原只需要改 cron payload

### ⏳ 待做決定
- 7 日觀察後決定 keep / revert / refine

## Q - Questions（未解決）

### ❓ 核心問題
1. **direct write 嘅 content 係唔係同 CLI ingest 完全相容？** — 兩者都係寫 `.md` 去 `wiki/sources/`，理論上一樣，但 `openclaw wiki ingest` 可能有 parsing/side effect
2. **L0/L1 嘅 format 適唔適合直接做 wiki source？** — 原本係 summary format，wiki source 預期係 reference/documentation format
3. **仲有冇邊個 call `wiki_ingest_helper.mjs`？** — 如果只有 cron 用，就乾淨 cutover。如果有其他 caller 仲用佢，要確認唔 break
4. **新 script 行一次幾耐？** — 舊 ~3 min（主要係 CLI timeout overhead），新預計 < 1s（純 fs）

### 🔍 追問
- CLI ingest 除咗 write source，仲有冇做其他 side effect？（model enrichment？metadata inject？）
- 如果新 script 寫入嘅 wiki source 唔齊 metadata，compile 會點？

## Progress
- [ ] Day 1 (6/19): check `tail -20` wiki sources 有冇正常寫入
- [ ] Day 2 (6/20): check `openclaw wiki lint` 有冇新 errors
- [ ] Day 3 (6/21): verify L0/L1 content 適合 direct source format
- [ ] Day 4-6 (6/22-24): monitor compile/log for anomalies
- [ ] Day 7 (6/25): 決策 — keep / revert / refine
- [ ] Rollback plan: update cron payload → `wiki_ingest_helper.mjs` 即可
- [ ] Close / post-outcome

## Notes
- 舊 script: `scripts/wiki_ingest_helper.mjs`（保留，唔 delete）
- 新 script: `scripts/wiki_daily_ingest.js`（created 2026-06-19）
- Cron ID: `ce52ebfe-27f2-4fba-bce2-e5f2000dd47a`
- 關聯 issue: #159 (KB Ingest), #162 (Pipeline Master)
