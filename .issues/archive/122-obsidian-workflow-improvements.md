---
id: 122
title: Obsidian workflow improvements — insights from X articles trilogy (CyrilXBT / NeilXbt / 0x小师妹)
status: archive
priority: P2
created: 2026-05-31
due: 2026-06-08
updated: 2026-06-01
progress: 6/6
---

## F — Facts（現狀）

目前 Obsidian 寫入流程：
- `write_to_obsidian.js` — 每次 analysis 後寫 Knowledge note（Category + Tags + Links）
- Cross-linking 用手動 `--links` 參數
- Summary/analysis 散落 Discord、Wiki、Memory 各處
- 冇 Output repository、冇定期 synthesis、冇 usage tracking
- 有 SOP Index（SOUL.md）但冇「AI 自動調用」機制

### 三篇文形成完整 Trilogy

| 篇 | Focus | 核心問題 | 答案 |
|---|-------|---------|------|
| **CyrilXBT** | Output-oriented | Notes 點樣變成作品？ | Output folder + Capture conventions |
| **NeilXbt** | Learning-oriented | Notes 點樣幫你學習？ | Knowledge graph + Active recall + Spaced rep |
| **0x小师妹** | System-oriented | Notes 點樣自己運作？ | 4-folder closed loop + Skill library + Automation |

### 現有 vault 對應 0x小师妹 4-folder 結構

| 0x小师妹 Folder | 我地既對應 | 狀態 |
|----------------|-----------|------|
| A: 原料庫 | `memory/`（原始 L2 logs）+ 未寫入 wiki 既 raw captures | ⚠️ 有但鬆散 |
| B: 概念庫 | Obsidian `Knowledge/` + wiki pages | ✅ 有結構 |
| C: Skill 庫 | SOUL.md SOP Index（人讀）→ 缺 AI-readable 版 | ❌ 未系統化 |
| D: 輸出庫 | Discord replies + email drafts + analysis summaries | ❌ 散落各處 |

Loop 要 close 既話，A/B 已有但需要定義清楚 boundary，C/D 係主要 gap。

---

## D — Decisions（決定）[Updated per MiniMax M2.7 review]

要跟進改善（按實行順序排列，唔係 priority order）：

| # | 改善項目 | Priority | Effort | Impact | 改動 Notes |
|---|---------|----------|--------|--------|-----------|
| 1 | **Output folder** — analysis 產出集中存放 | 🟢 P0 | 低 | 高 | 優先做 |
| 2 | **Capture Conventions** — write_to_obsidian.js 加 params | 🟢 P0 | 低 | 中 | ⬆️ 由 P1 升上嚟，dependency chain 前排 |
| 3 | **Connection Surface** — 每週自動 connection suggestion | 🟡 P1 | 中 | 高 | 需 vault note count > 50 先有效（readiness gate）|
| 4 | **Synthesis + Closed Loop** — 雙週綜合 session | 🟠 P2 | 中 | 中 | 🔀 由 item 5+6 merge 而成 |
| 5 | **Skill Library** — 將 SOP 變成 AI-readable docs | 🟠 P2 | 低 | 中 | ⬇️ 由 P0 降級；寫 template 易，整 execution engine 係另一回事 |
| 6 | **Usage Tracking** — contribution count loop | 🔴 P3 | 中 | 低 | 等以上成熟先做 |

### 詳細說明

#### 1. Output folder（P0）
- `write_to_obsidian.js` 每次 analysis 後，除咗寫 Knowledge note，順手 save 一份去 `03-Output/YYYY-MM/YYYY-MM-DD-[type]-[slug].md`
  - `[type]` = x-link / email / synthesis / idea
  - `[slug]` = 短標題 key，eg `obsidian-knowledge-graph`
- Output = analysis summary、synthesis、discord replies 等「作品」
- 格式：精簡版，frontmatter 只有 title/date/source/tags/type，body 係原本 Discord summary 既內容
- **Dup handling:** 同一天同 source → append `-2`, `-3`
- **Acceptance criteria:** 下次 analysis 完 Obsidian 會多個 `03-Output/` file，內容唔重複 Knowledge note
- **現有資料處理：** 新既先跟新流程，唔 batch migrate

#### 2. Capture Conventions（P0）⬆️ 由 P1 升上嚟
喺 `write_to_obsidian.js` 加 3 個 optional params，對應 CyrilXBT 既三種 capture：

```bash
# Connection Capture — 咩令呢篇值得 capture
--connection "呢篇講既 knowledge graph 概念同我地 SOUL.md 既 Thinking Partner 相通"

# Question Capture — 呢篇 trigger 咩問題
--question "我地既 wiki 可唔可以用 mastery score 做 retention priority？"

# Application Capture — 呢篇可以點用
--application "Skill Library 概念可以直接 apply 去現有 SOP Index"
```

**Frontmatter output:**
```yaml
---
capture_connection: "..."
capture_question: "..."
capture_application: "..."
---
```

點解係 P0：write_to_obsidian.js 係 connection surface、synthesis 等其他功能既基礎工具。改一次，後面全部受惠。

**Acceptance criteria:** 三個 params 可行、frontmatter 正確寫入、唔影響現有 workflow（optional 唔 fill 都得）。

#### 3. Connection Surface（P1）
每週 scan 新加既 notes，自動搵 non-obvious connections。具體 prompt 跟 NeilXBT 原文：

```
每週分析 prompt：
Read all permanent notes created or modified in the last 7 days.
For each new note, scan the entire vault for existing notes that share a meaningful connection.

Meaningful connections include:
- The same underlying principle applied in different domains
- Contradictory claims worth examining together
- One note providing evidence for or against a claim in another
- A pattern that appears across multiple notes that no individual note names explicitly

For each connection found: name both notes, describe the connection, explain why connecting them makes both more useful.
Only surface non-obvious connections.
```

**Readiness gate:** vault 要有 50+ Knowledge notes 先開始行，否則 meaningful connections 太少浪費用。
**Implementation：** spawn sub-agent 每週一次，LLM-based，optimize 後先考慮 hybrid。
**Acceptance criteria:** 每週出一份 connection report，有至少 2 個 non-trivial connections。

#### 4. Synthesis + Closed Loop（P2）🔀 由 item 5+6 merge 而成
NeilXbt 既 Synthesis Session（14日一次 pattern analysis）同 0x小师妹 既 Closed Loop（30日一次 re-ingest）本質都係跨 notes 分析。合併做一個 bi-weekly session：

```
Bi-weekly prompt（每兩週 spawn）：
PART A — SYNTHESIS（NeilXbt Module 5）
1. PATTERN IDENTIFICATION — Read across all notes. What patterns emerge not stated in any individual note?
2. THE DEEPEST CONNECTION — Single most important relationship tying most concepts together
3. PREDICTIVE TEST — Generate 3 novel scenarios; ask user to predict, then evaluate
4. GAP ANALYSIS — 3 most important concepts not yet studied
5. SYNTHESIS DOCUMENT — 400-600 word integrated understanding → save to 05-Synthesis/

PART B — CLOSED LOOP（0x小师妹 re-ingest）
6. Scan 03-Output/ older than 30 days:
   - Any insights not in Knowledge/ or wiki?
   - Cross-output patterns suggesting a new concept?
   - Most/least referenced outputs?
7. OUTPUT:
   - New concept suggestions
   - Cross-output pattern summary
   - Archive recommendations
```

**Acceptance criteria:** 每兩週出一份 synthesis document + re-ingest report。

#### 5. Skill Library（P2）⬇️ 由 P0 降級
以 documentation 為主，唔係 system change。將 SOP 寫成 AI-readable format。

**Template format（建議）:**
```markdown
---
skill: x-link-analysis
version: 1
trigger: "收到 X.com 連結時自動執行"
input: "X post URL"
output: "Obsidian note + Discord summary"
dependencies: [browser, write_to_obsidian, message]
scope: 
  - "只處理 X.com links"
  - "唔處理非公開帳戶內容"
---
## 流程
1. browser open → snapshot → extract content
2. 分析核心論點、3-5 key points
3. write_to_obsidian（Knowledge note + Output note）
4. browser close
5. message send to Discord channel

## 質量標準
- Summary 300-800字廣東話 bullet
- Obsidian note 500-1500字，有 [[cross-links]]
- 一定要 close tab

## 常見錯誤
- X.com 擋 web_fetch → 必須用 browser
- Article page redirect 去 login → 用原 tweet URL snapshot
```

**Skills 放 `04-Skills/` folder。**

點解唔係 P0：寫 template 好簡單（30分鐘），但「AI 自動調用呢啲 skills」係另一回事 — 需要 execution engine parsing frontmatter + 條件觸發。個 engine 未 scope 既時候，呢個 item 主要係 documentation effort。

**優先順序：** x-link-analysis → email-sop → daily-processing → connection-surface
**Acceptance criteria:** 寫好第一個 skill（x-link-analysis），frontmatter 完整，AI 可以讀得明、人有得跟住做。

#### 6. Usage Tracking（P3）
長期 project。等以上成熟先做。

**初步設計：**
- Notes 加 frontmatter field `contributions: 0`
- 每次用到就 +1
- 每月 usage report + auto-archive 規則

---

### 實行順序（Updated）

```
① Output folder（P0, 低 effort）
    ↓ 提供 output 存放位置
② Capture Conventions（P0, 低 effort）
    ↓ write_to_obsidian.js 一次搞掂兩個改動
③ Connection Surface（P1）
    ↓ readiness: vault > 50 notes
    ↓ 需要 Capture Conventions 既 context 先有用
④ Synthesis + Closed Loop（P2）
    ↓ 需要 Connection Surface 既 cross-links
⑤ Skill Library（P2）
    ↓ 獨立，任何時候做得
⑥ Usage Tracking（P3）
    ↓ 等 system 穩定先
```

建議開波順序：**1 → 2 → 3 → 4 → 5 → 6**
*Output folder 同 Capture Conventions 可以同步做（都係改 write_to_obsidian.js）*

---

## Q — Questions（未解決）

1. **現有 vault 既 A（原料庫）同 B（概念庫）boundary 要正式定義？** 定 keep 現狀（memory/ = A, Knowledge/ = B）？
2. **Synthesis + Closed Loop 係 spawn sub-agent 定 isolated cron？** Spawn 可以指定 model，cron 可以自動排程
3. **Skill Library 需唔需要 execution engine roadmap？** 定淨係做 documentation layer？
4. **Usage Tracking 值得而家 start logging 定等以上做完先？** Logging 早做好過遲，但 effort 唔細
5. **Connection Surface readiness gate > 50 notes — 而家 Obsidian 有幾多條？** 要 check

## 2026-06-01 — 觀察期（7日）

### 完成狀態

| Item | 檔案 | Status |
|------|------|--------|
| 1. Output folder | `write_to_obsidian.js` → `03-Output/YYYY-MM/` | ✅ |
| 2. Capture Conventions | `--connection / --question / --application` params | ✅ |
| 3. Connection Surface | `connection_surface.js` + Sun 09:00 cron | ✅ |
| 4. Synthesis + Closed Loop | `synthesis_closed_loop.js` → `05-Synthesis/` | ✅ |
| 5. Skill Library | `04-Skills/x-link-analysis.md` | ✅ |
| 6. Usage Tracking | `usage_tracker.js` scan + report | ✅ |

**Bug fixes applied:** `noteBody` unused（connection_surface）、cumulative count（usage_tracker）、`--content ""` fallback（write_to_obsidian）、CRON_RECENT_WINDOW_MS protection（session_cleanup）

### 觀察項目

- [ ] Day 1 — 06-01 (Mon) write_to_obsidian 正常運作？
- [ ] Day 2 — 06-02 (Tue) 03-Output/ 有冇產生 output？
- [ ] Day 3 — 06-03 (Wed) Connection Surface dry run 正常？
- [ ] Day 4 — 06-04 (Thu) capture fields 有冇正確寫入 frontmatter？
- [ ] Day 5 — 06-05 (Fri) usage tracker report 數字合理？
- [ ] Day 6 — 06-06 (Sat) 有冇發現 regression？
- [ ] Day 7 — **06-07 (Sun) Connection Surface 第一次自動 run** → 決定是否需要調整

### 已知風險
- Connection Surface 第一次 cron run（06-07 Sun 09:00）係最關鍵 test — 睇下 isolated session + sub-agent LLM analysis 係咪正常 flow
- 如果有 regression，rollback writes 係最安全（只係多咗 03-Output/ files，唔影響現有 Knowledge/）

---

## Progress

- [ ] **Output folder** — modify write_to_obsidian.js to save analysis to 03-Output/
- [ ] **Capture Conventions** — add --connection / --question / --application params
- [ ] **Connection Surface** — add weekly connection_surface.js script（gate: 50+ notes）
- [ ] **Synthesis + Closed Loop** — bi-weekly combined session
- [ ] **Skill Library** — design template + convert 1st SOP → skill
- [ ] **Usage Tracking** — contribution logging system

---

## Notes

### 相關 files
- `scripts/write_to_obsidian.js` — #1 + #2 改動目標
- `.issues/active/118-daily-synthesis-system-l2-logg.md` — 可能有 overlap
- `SOUL.md` — SOP Index
- `AGENTS.md` — Session end: create issue 最低標準

### Review history
- **2026-05-31 v1:** 初版，5 items + 殼
- **2026-05-31 v2:** 補細節 + acceptance criteria + dependency
- **2026-05-31 v3（呢版）:** 按 MiniMax M2.7 review update：priority 重排、readiness gate、merge 4+5、命名規範、4-folder mapping

### MiniMax M2.7 review 重點
1. ⬆️ Capture Conventions P0（dependency chain 前排）
2. ⬇️ Skill Library P2（documentation effort，scope 未完整）
3. 🔀 Synthesis + Closed Loop merge（避免重疊）
4. 🚧 Connection Surface readiness gate（50+ notes）
5. 📛 Output naming `[type]-[slug]` 代替 `[source]`
6. 🗺️ 4-folder mapping 到現有 vault

### Links
- Obsidian: [[How to Build an Obsidian System That Turns Notes Into Actionable Output]]
- Obsidian: [[How to Use Obsidian and Claude to Learn Any Subject Twice as Fast by Building a Knowledge Graph]]
- Obsidian: [[10 分钟搭一套 AI 自生长知识库：Obsidian + Codex]]
