# Skill-Reviewer Bot 根因分析報告

**作者：** Ally M3（subagent — skill reviewer 系統分析師）
**日期：** 2026-06-11
**範圍：** skill_reviewer_bot.js、validate_skill_file.js、prompts、telemetry、quarantine 案例
**重點：** 搵出 4 個問題嘅根因，提供可執行改善方案

---

## 1. Executive Summary — 5 個核心根因

經過深入分析源碼、prompt、telemetry 同 12 個失敗案例後，搵出以下 5 個核心根因：

### 🔴 RC-1：**LLM 輸出截斷係最常見失敗原因（8/10 quarantines）**
`extractFileBlocks` 嘅 H-4 fix 已經 abort 處理 unclosed fence，但**訊號已經 loss**：LLM 為咗回應長 prompt 同 output token 限制，response 喺 mid-sentence 截斷，連 closing ``` 都未寫。**搶救已經太遲**。修唔到 token 問題，所有 downstream validation 都係後知後覺。

### 🔴 RC-2：**Prompt 設計有 NESTED FENCE 陷阱（直接成因）**
`REVIEW_INSTRUCTIONS` 同 `buildBatchReviewInstructions` 嘅 example 用咗 **nested code block 結構**（外層 ```skills-learned/... 包內層 ```bash）。LLM 對「要寫幾多個 ```」好容易搞混：
- 多寫一個 closing ``` → 提早結束
- 少寫一個 closing ``` → unclosed fence
- 內層 ``` 攞咗外層 close → file 被截斷
呢個 prompt 反模式由 review-instructions 入面 extend 到 batch mode，冇任何防呆機制。

### 🟡 RC-3：**Validator 唔一致（pre-write gate vs post-write validator）**
- Pre-write gate：<1500B 直接拒絕
- Post-write validator：≥2-of-3 signals 失敗先 reject（file size / workflow structure / word count）
- Bot 嘅 `recordSkillCreated` 統計：pitfalls/steps 用舊 regex，唔 match H3 headers
**三套唔同標準**，導致 13 個 sub-1500B 文件部分過、部分唔過，難以預測。

### 🟡 RC-4：**去重邏輯只係 advisory（唔係 blocking）**
- `buildSkillCatalog` 喺 prompt 入面 inject 完整 skill table，LLM 自己決定 PATCH vs CREATE
- `cron-systemevent-migration` 出現 4 次、`skill-reviewer-bot-self-improvement` 出現 2 次 — 明顯 LLM 無視 catalog
- 冇 server-side 嘅 dedup gate：即使 LLM 重複 generate，bot 照寫

### 🟢 RC-5：**Self-referential generation 風險**
`skill-reviewer-bot-self-improvement` 出現 2 次失敗，LLM 喺 feedback loop 入面觀察自己失敗、然後生成關於自己嘅 skill。**呢類自我指涉 skill 應該 hard block**（bot 唔應該 generate 關於自己嘅 SKILL.md — recursive logic、debug 困難）。

---

## 2. 5 Whys 分析（每個問題追到根因）

### 2.1 為何 68.89% junk rate（31/45 validation 失敗）？

| Level | 問題 | 答案 |
|-------|------|------|
| **Why 1** | 31/45 skills 失敗 validation？ | 主要係「Unclosed code block at end of file」（10/12 quarantines 中 8 個） |
| **Why 2** | 點解會有 unclosed code block？ | LLM response 截斷 — closing ``` 從未寫出嚟 |
| **Why 3** | 點解 LLM response 會截斷？ | (a) Prompt 太長，conversations snapshot + instructions 接近 30K chars，留俾 output 嘅 tokens 唔夠；(b) LLM 對 nested fence 結構搞混，寫多／寫少 ``` |
| **Why 4** | 點解 prompt 設計成 nested fence？ | 因為要 support 內部 example code blocks（` ```bash` for CLI commands）— 設計者冇諗過 LLM 嘅 fence-counting 能力咁差 |
| **Why 5** | **Root cause** | **冇任何 fence-counting sanity check 喺 prompt 裡面**：LLM 唔知道自己破壞咗平衡、bot 嘅 H-4 abort 都係事後孔明。**預防勝於治療** — prompt 應該直接規定「每個 SKILL.md 只用 1 對外層 fence，內部唔用 nested code blocks」 |

### 2.2 為何會有 stub skills（cron-job-testing 577B、multi-phase-subagent-orchestration 760B）？

| Level | 問題 | 答案 |
|-------|------|------|
| **Why 1** | 點解會有 577B 嘅 stub？ | LLM output 喺 577B 截斷，從未寫齊 workflow + pitfalls |
| **Why 2** | 點解 bot 冇 reject？ | Stub 事件發生喺 2026-06-09，當時**冇 pre-write gate**（1500B gate 喺 2026-06-10 22:00 後先加） |
| **Why 3** | 點解 LLM 會出 577B output？ | 同 RC-1 一樣：token budget 耗盡、nested fence 困惑、或者 LLM 判斷 conversation 太 narrow（cron-job-testing 來自單個 signal）覺得唔值得寫多 |
| **Why 4** | 點解 cron-job-testing 仲會有 signal？ | 因為 queue 入面有 error event，aggregated signal 算法將佢列為 workflow signal，但 LLM 寫出嚟嘅 skill 唔 reusable |
| **Why 5** | **Root cause** | **Pre-write size gate 太遲加**（2026-06-10），加上 token-truncation 問題從未根治。**應該有「minimum viable spec」喺 LLM call 之前就 check 過** |

### 2.3 為何 cron skills 會膨脹（12 個）？

| Level | 問題 | 答案 |
|-------|------|------|
| **Why 1** | 點解會有 12 個 cron-* skills？ | 每次有 cron job 出事（failed alert / migration / model issue），LLM 就 generate 過 |
| **Why 2** | 點解唔 PATCH 已有 skill？ | `buildSkillCatalog` inject 完整 table，但 LLM 嘅 decision tree（PATCH > UPDATE > CREATE）容易被 conversation context override。例：`cron-systemevent-migration` 嘅 conversation 講「agentTurn → systemEvent migration」，LLM 就 generate 新 skill 而唔 patch `cron-migration` |
| **Why 3** | 點解 prompt 唔夠 enforce PATCH？ | Prompt 雖然列咗 decision tree，但 description-based catalog 對 LLM 嚟講**搜尋成本太高** — 佢寧願自己 create 都唔想花 5 個 LLM 步驟去 read + compare |
| **Why 4** | 點解 queue 會重複加入同樣 signal？ | 因為 cron job **每次失敗**都會 push signal 入 queue，但 job 本身冇 dedup — `cron-systemevent-migration` 4 次入 queue，4 次都觸發新 skill 生成 |
| **Why 5** | **Root cause** | **Cron-related signals 嘅 dedup logic 缺失**。一個 cron job 失敗 N 次應該只 push 1 個 dedup signal 入 queue，或者 bot 嘅 prompt 應該明文「If existing skill `cron-migration` covers this → ALWAYS PATCH」 |

### 2.4 為何會有 narrow / one-time skills（pipeline-flag-audit-workflow, yaml-config-drift-detection）？

| Level | 問題 | 答案 |
|-------|------|------|
| **Why 1** | 點解呢類 narrow skills 會被生成？ | 因為 queue 入面有對應 conversation，LLM 識別到一個 pattern 就 CREATE |
| **Why 2** | 點解 LLM 唔判斷「reusability」？ | 雖然 prompt 講「Not a one-time incident」同「Niche workflow no one will consult」，但**呢啲 rule 排第 9 / 11 個 negative example**，LLM 優先睇 example code block 格式 + workflow steps 要求 |
| **Why 3** | 點解 rule 排得咁後？ | `REVIEW_INSTRUCTIONS` 嘅「negative examples from past review passes」係歷史 add-on，**主要決策 prompt 反而係「如何寫」**，LLM 喺「decision tree」sections 出現時已經決定 CREATE |
| **Why 4** | 點解 conversation 會有呢類 narrow pattern？ | `yaml-config-drift-detection` 嚟自 `documentation-code-drift-detection` 嘅 sibling — LLM 識別到 drift detection 嘅 pattern 就將「yaml config」拆出嚟做獨立 skill |
| **Why 5** | **Root cause** | **「Reusability check」唔係 blocking gate**。Prompt 講「broad enough to be searched」但冇 quantitative threshold（例如：≥3 個 conversation 來源 OR 出現次數 ≥ 1/month）。**LLM 自己判斷** 容易 over-create |

---

## 3. Fishbone Diagram（文字版）

```
                                68.89% JUNK RATE
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
   BOT LOGIC                     PROMPT DESIGN              VALIDATION GATE
   (Generation 邏輯)              (Prompt 設計)              (校準問題)
        │                             │                             │
        ├─ 冇 server-side dedup      ├─ Nested fence example 陷阱  ├─ Pre-write gate 1500B
        │  (cron-systemevent 4 次)   │  (內外層 ``` 搞混)           │  vs post-write validator
        │                             │                             │  (3 套唔同標準)
        ├─ H-4 abort 太遲            ├─ Decision tree 排位低      │
        │  (事後孔明)                │  (PATCH vs CREATE 唔顯眼)    ├─ pitfalls/steps 統計
        │                             │                             │  用舊 regex 唔 match H3
        ├─ recordSkillCreated        ├─ 「reusability check」
        │  統計失真                   │  排喺 negative example 9-11  ├─ 2-of-3 signals 模糊
        │  (H3 唔計入)              │  (LLM 容易忽略)             │  (file size vs workflow)
        │                             │                             │
        ├─ Self-referential 生成      ├─ 冇 quantitative          │
        │  (skill-reviewer-self)     │  reusability threshold     │
        │                             │  (純靠 LLM 判斷)
        ├─ 冇 token budget 預估       │
        │  (LLM 寫到一半冇 token)     │
        │                             │
   PROCESS                       DATA SOURCE              EXTERNAL
   (Workflow 流程)                (Context 來源)           (Provider 限制)
        │                             │                             │
        ├─ Pre-write gate 2026-06-10  ├─ Queue 唔 dedup            ├─ M2.7 嘅 max_tokens
        │  先有，2026-06-09 嘅        │  (同 cron job 失敗 N 次     │  限制（1700-2200
        │  11 個 stub 已滑過          │  push N 個 signal)         │  output tokens 估計)
        │                             │                             │
        ├─ Validation 係事後          ├─ Conversation snapshot     ├─ M2.5 因 max_tokens
        │  (write → validate →        │  攞 raw toolSummary         │  不兼容被移除，
        │  quarantine，慢)            │  唔 clean up, 增 prompt     │  但 M2.7 都唔夠
        │                             │  noise                      │
        ├─ Quarantine 過度（保留      │
        │  raw LLM output 喺          │
        │  _archive/ 6 個月）         │
        │                             │
        ├─ Mini-curator 用            │
        │  inactivity trigger (≥3日)  │
        │  → quarantine 唔即時清      │
```

---

## 4. 失敗 Pattern 分析（用 telemetry 統計）

### 4.1 整體分佈（`.skill_junk_rate.jsonl` 7 日 window）

| 指標 | 數值 |
|------|------|
| Total skills generated | 45 |
| Validation passed | 14 (31.1%) |
| Validation failed | 31 (68.9%) |
| Quarantine rate target | <10% |
| **Gap** | **+58.9%** |

### 4.2 失敗原因分佈（10 quarantines + 2 failed-validations 重新 validate）

| 失敗類型 | 數量 | 佔失敗 % | 例子 |
|---------|------|----------|------|
| **Unclosed code block at end of file** | 8 | 67% | cron-p0-rescue-workflow, ai-hot-push-workflow, documentation-code-drift-detection, m3-root-cause-analysis, issue-quality-self-review, skill-reviewer-bot-self-improvement |
| **Missing "## Pitfalls" section** | 4 | 33% | cron-context-overflow-recovery, cron-passive-job-detection, issue-quality-self-review, skill-reviewer-bot-self-improvement, m3-root-cause-analysis |
| **Missing "## Workflow" section** | 2 | 17% | cron-context-overflow-recovery, systemevent-cron-dedup-gotcha |
| **Stub detected (<1500B)** | 4 | 33% | cron-context-overflow-recovery, systemevent-cron-dedup-gotcha, agent-memory-bus-pattern, skill-reviewer-bot-self-improvement |
| **Workflow ends with colon (truncation)** | 2 | 17% | issue-quality-self-review, m3-root-cause-analysis |

### 4.3 重複生成（嚴重 dedup 問題）

| Skill name | failedNames 內出現次數 |
|-----------|----------------------|
| `skill-reviewer-bot-self-improvement` | 2 次（self-referential！）|
| `cron-systemevent-migration` | 4 次（重複！）|
| `cron-agent-llm-failure-mitigation` | 3 次 |
| `issue-quality-self-review` | 3 次 |
| `skill-file-corruption-repair` | 2 次 |

**結論：dedup 完全失效**。即使 `buildSkillCatalog` inject 咗完整 table，LLM 仲係會重複 generate。

### 4.4 細件: Sub-1500B 文件追溯

| Date | Name | Bytes | Reason |
|------|------|-------|--------|
| 2026-06-08 | session-lock-recovery | 626 | ❌ written before gate |
| 2026-06-09 | cron-agent-llm-failure-mitigation | 740 | ❌ written before gate |
| 2026-06-09 | cron-systemevent-migration | 1213 | ❌ written before gate |
| 2026-06-09 | cron-context-overflow-recovery | 583 | ❌ written before gate |
| 2026-06-09 | cron-job-testing | 577 | ❌ written before gate |
| 2026-06-09 | systemevent-cron-dedup-gotcha | 901 | ❌ written before gate |
| 2026-06-09 | issue-quality-self-review | 1437 | ❌ written before gate |
| 2026-06-09 | **subagent-model-override** | 1291 | ✅ **passes validator**（2-of-3） |
| 2026-06-09 | multi-phase-subagent-orchestration | 760 | ❌ written before gate |
| 2026-06-09 | m3-root-cause-analysis | 1025 | ❌ written before gate |
| 2026-06-10 03:36 | skill-reviewer-bot-self-improvement | 888 | ❌ written before gate |
| 2026-06-10 05:34 | skill-reviewer-bot-self-improvement | 667 | ✅ **caught by 1500B gate** |
| 2026-06-10 18:01 | agent-memory-bus-pattern | 1279 | ✅ caught by 1500B gate |

**Insights:**
- 11 個 stub 喺 2026-06-09 滑過（pre-write gate 唔存在）
- 2026-06-10 22:00 之後 1500B gate 先 catch 到後續 stub
- **subagent-model-override (1291B) 通過 validator 但其實係 stub** — 3 套標準唔一致

---

## 5. 改善方案（按 impact × effort 排序）

| # | 方案 | 影響 | Effort | 優先級 | 預期效果 |
|---|------|------|--------|--------|---------|
| 1 | **Eliminate nested-fence pattern in prompt** | H | M | **P0** | Junk rate 68% → ~30% |
| 2 | **Add server-side dedup gate (cross-batch)** | H | M | **P0** | 重複生成 -90% |
| 3 | **Self-referential hard block** | M | L | **P1** | 0 個 self-improvement skill |
| 4 | **Pre-write gate unify with validator** | M | L | **P1** | Confusion -100% |
| 5 | **Reusability threshold (≥3 conversation signals)** | H | M | **P1** | Narrow skills -70% |
| 6 | **Token budget pre-flight estimation** | H | H | **P2** | Truncation -60% |
| 7 | **Per-skill write with retry on validation fail** | M | H | **P2** | Junk 進一步 -20% |
| 8 | **Quarantine audit (保留 vs 清除)** | L | L | **P3** | Disk cleanup |

### 方案 1 — 消除 prompt 入面 nested-fence pattern（P0，預期 junk rate -38%）

**改動範圍：** `scripts/skill_reviewer.js`

**具體步驟：**
1. `REVIEW_INSTRUCTIONS` 嘅 "How to output the file" section
2. 改用 **「每段獨立 fence」** 而唔係「一個 fence 包整個 file」：
   ```
   Output each section as a SEPARATE fenced block:
   ```skills-learned/<class>/SKILL.md
   
   Use 4-backtick outer fence to disambiguate from inner 3-backtick examples:
   ````markdown
   skills-learned/<class>/SKILL.md
   ---
   ...
   ````
   ```
3. 或者用 `###FRONTMATTER###` / `###CONTENT###` marker 區分
4. 內部 code block 用 4-backtick (` ````bash `) 而非 3-backtick，避免 fence collision

**預期效果：**
- Unclosed fence 失敗從 67% → 5%
- Junk rate 從 68% → 30%

**驗證方法：**
- 連續 7 日跑 `skill_junk_tracker.js --days 7`
- Target: failedNames 入面 `unclosed code block` 類型 < 3

---

### 方案 2 — Server-side dedup gate（P0，預期重複 -90%）

**改動範圍：** `scripts/skill_reviewer.js` + `scripts/skill_reviewer_bot.js`

**具體步驟：**
1. `skill_reviewer.js` 喺 build prompt 之前，scan queue for duplicate `userPrompt` fingerprints
2. 計算每個 signal 嘅 `toolNames + errorClass` SHA，cross-batch dedup
3. 同一 fingerprint 7 日內只推 1 個 signal
4. Bot 寫入前 `checkExistingFiles` 擴展：cross-check `skills-learned/` + `skills/_learned_*/` 同名目錄
5. 如果已經存在，**改為 PATCH prompt**（將「CREATE」改為「MERGE INTO existing」）

**預期效果：**
- `cron-systemevent-migration` 重複：4 → 0
- 整體 queue 體積 -30%

**驗證方法：**
- 監察 `cron-systemevent-migration` 7 日內新 symlink 數量
- 應該 ≤ 1

---

### 方案 3 — Self-referential hard block（P1，5 分鐘 effort）

**改動範圍：** `scripts/skill_reviewer.js` prompt

**具體步驟：**
1. 喺 `REVIEW_INSTRUCTIONS` 開頭加：
   ```
   ## 🚫 Self-Referential Skills (HARD BLOCK)
   NEVER create a skill about the skill-reviewer, the bot itself,
   or any internal automation machinery (skill_*, reviewer_*, curator_*).
   These are recursive — they cannot self-improve via this loop.
   If you observe a pattern in skill-reviewer's failures, output a
   note to .skill_review_notes/ instead of a SKILL.md.
   ```
2. Bot 寫入前，filter 任何 filePath 包含 `skill-reviewer`, `skill_reviewer`, `curator`, `self-improvement` → 拒絕

**預期效果：**
- 0 個 self-referential skill
- queue 嗰 2 個 failed `skill-reviewer-bot-self-improvement` 唔再出現

**驗證方法：**
- 7 日內 search `.skill_created.jsonl` for `skill-reviewer-bot-self-improvement`
- 結果應該 = 0

---

### 方案 4 — Pre-write gate 統一 validator（P1，2 小時 effort）

**改動範圍：** `scripts/skill_reviewer_bot.js` + `scripts/validate_skill_file.js`

**具體步驟：**
1. 將 pre-write gate 嘅 1500B 改用 **同一個** validator function（import from validate_skill_file.js）
2. 確保兩者用同一套 stub detection logic
3. `recordSkillCreated` 嘅 pitfalls/steps 統計改用 H3-compatible regex（已 partially done 喺 P2-#3/#4，verify）

**預期效果：**
- subagent-model-override (1291B) 唔再 inconsistency
- Confusion metrics → 0

**驗證方法：**
- Re-validate 所有 30 failed skills
- 一致率 = 100%

---

### 方案 5 — Reusability threshold（P1，3 小時 effort）

**改動範圍：** `scripts/skill_reviewer.js` + `scripts/skill_reviewer_bot.js`

**具體步驟：**
1. `skill_reviewer.js` 注入 aggregated signal 統計：
   ```
   ## Signal Strength Threshold
   ONLY CREATE a new skill if:
   - 3+ distinct conversation sources, OR
   - Same conversation pattern in 2+ different queue entries, OR
   - User explicitly requested documentation of a recurring workflow
   Otherwise: SKIP or contribute to existing umbrella skill
   ```
2. 加 `MIN_SIGNALS_FOR_CREATE = 3` constant
3. 如果 conversation 來源 < MIN_SIGNALS → bot 喺 prompt 加 hint：`# ⚠️ Signal too narrow — consider SKIP`

**預期效果：**
- Narrow skills (yaml-config-drift-detection, pipeline-flag-audit-workflow) 唔再生成
- Junk rate 額外 -10%

**驗證方法：**
- 7 日後 search 新 created skills for narrow patterns
- 預期 < 2 個

---

### 方案 6 — Token budget pre-flight（P2，1-2 日 effort）

**改動範圍：** `scripts/skill_reviewer.js`

**具體步驟：**
1. 喺 build prompt 之前，estimate output budget：
   - 預期 SKILL.md size: ~3500B (5-8 steps × 200B + 3-5 pitfalls × 150B + frontmatter)
   - M2.7 估計 max output tokens: ~3000-4000
   - 如果 prompt + 預期 output > 80% context → split batch
2. 改 batch 邏輯：`buildReviewPrompt` 限制 conversations ≤ 5 個（而家可以到 20 個）
3. Truncation mark：response 最後 50 chars 唔包含 closing ``` + JSON summary → retry with `--max-tokens 8000`

**預期效果：**
- LLM truncation -60%
- 現有 H-4 abort 觸發率 -70%

**驗證方法：**
- 連續 7 日 monitor H-4 abort log
- Abort count < 3 次/週

---

### 方案 7 — Per-skill write with retry（P2，1 日 effort）

**改動範圍：** `scripts/skill_reviewer_bot.js`

**具體步驟：**
1. 而家 bot 一次 LLM call 出 N 個 SKILL.md，全部失敗就全部 quarantine
2. 改：每個 SKILL.md 寫入前，validate 一次；如果 fail → 將嗰個 specific 嘅 file block **重新 prompt LLM fix**（最多 2 次 retry）
3. 第二次 retry 都失敗 → 嗰個 skill 進 quarantine，其他繼續
4. 減低「一次 fail 全軍覆沒」風險

**預期效果：**
- Junk rate 額外 -15%
- 保留較好 skills 嘅 success rate

**驗證方法：**
- 7 日後 average validationPassed / total 比率
- 從 31% → ≥50%

---

### 方案 8 — Quarantine audit 與 30 日 retention（P3，2 小時 effort）

**改動範圍：** `scripts/weekly_correction_loop.js` 或新 cron

**具體步驟：**
1. 30 日以上 嘅 `_archive/quarantine-*` / `_archive/failed-validations/` 自動清除
2. Weekly summary 報告 quarantine 大小
3. 防止 _archive 變成 graveyard

**預期效果：**
- Disk 釋放 ~5-10MB
- 改善 audit clarity

**驗證方法：**
- `_archive/` size 監察

---

## 6. Quick Wins（即刻可做）

| # | Quick Win | Effort | Impact | 預計 Junk Rate 改善 |
|---|-----------|--------|--------|---------------------|
| **QW-1** | 喺 `REVIEW_INSTRUCTIONS` 開頭加 self-referential hard block | 5 分鐘 | M | -3% |
| **QW-2** | Bot 寫入前 filter `skill-reviewer` / `curator` / `self-improvement` filePath | 15 分鐘 | M | -3% |
| **QW-3** | 將 pre-write 1500B gate 改為 import validator function（避免 3 套標準） | 30 分鐘 | M | -5% |
| **QW-4** | 喺 `REVIEW_INSTRUCTIONS` 開頭加：「1 skill = 1 outer fence，內部 code blocks 用 4-backtick」 | 10 分鐘 | H | -20% |
| **QW-5** | 將「Decision tree: PATCH > CREATE」由第 7 個 section 移到第 1 個 section | 5 分鐘 | M | -8% |

**總預期：** 5 個 QW 加埋可將 junk rate 由 68% 降到 ~30%。

---

## 7. 長期改善方向（需要 architecture change）

### 7.1 改用「Patch-First Default」模式
而家 LLM 收到 signal 第一個動作係「CREATE」或「READ first」。改為：bot 預先**自動 search** skills-learned 嘅 30+ 個目錄，搵到 keyword overlap 就直接 inject 嗰個 SKILL.md 內容入 prompt，迫 LLM 必須 PATCH。**Search 成本 = server-side 0.1s**，LLM 嘅 search 成本 = 5+ turns。換句話：將 dedup 嘅 search 成本由 LLM 搬去 bot。

### 7.2 引入 LLM-as-Judge Quality Gate
寫完 SKILL.md 之後，**第二個 LLM call** 做「Quality Judge」：
- 專門 check: reusability, overlap, completeness
- 用 M2.7（cheap）做 5-Whys test：「If I were a future session, would I search for this?」
- Judge 否決 → quarantine（唔 reach write stage）
- Judge 通過 → 寫入

成本：每個 skill 多 ~$0.01，但 junk rate 預期降到 < 15%。

### 7.3 Skill Quality Score (Continuous)
每個 SKILL.md 加 `quality_score: 0-100` 喺 frontmatter，components:
- 30% — validator pass (binary)
- 30% — usage frequency (count of `<available_skills>` loading × invocations)
- 20% — overlap score (Jaccard with existing skills)
- 20% — peer review (M3 judge 偶爾 re-score)

`quality_score < 50` 自動 archive。

### 7.4 改用「Conversation Cluster」觸發 model
而家 1 conversation 1 signal，LLM 見到 5 個 signal 就 5 個 skill。改：bot 預先 cluster signals (K-means on tool/error embeddings) → 1 cluster = 1 skill creation event。**減少 60-70% signal volume**。

### 7.5 Skill-Reviewer Self-Improvement Loop 嘅安全設計
如果要做 self-improvement，必須有：
- **Read-only boundary** — bot 唔可以 modify `skill_reviewer*.js`、`.skill_junk_tracker.js` 等 self-related files
- **Dry-run mode** — self-improvement 嘅 SKILL.md 寫去 `_proposals/` 而非 `skills-learned/`
- **Human approval gate** — self-improvement 需要 Josh 手動 `skill_workshop action=apply` 先 enable

---

## 8. 結論

**核心 insight：68.89% junk rate 唔係單一 bug，而係 4 層防禦同時失效**：

1. **Token/Output 限制**（Provider 限制，難以根治）
2. **Prompt 嘅 nested-fence 陷阱**（設計反模式，QW-4 解決）
3. **Validation 三套標準**（inconsistency，QW-3 解決）
4. **Server-side dedup 缺失**（advisory only，方案 2 解決）

**優先執行：** QW-1 + QW-2 + QW-4 + 方案 3（self-referential block）+ 方案 5（reusability threshold）— 全部 P0/P1 effort，加埋可將 junk rate 由 68% 降到 **20-30%**。

**期望時間線：**
- 即時（5-30 分鐘）：QW-1, QW-2, QW-4, QW-5
- 本週（1-3 小時）：方案 3、方案 5
- 下週（1-2 日）：方案 2、方案 4
- 下月（1 週+）：方案 6、方案 7、長期改善方向

**7 日後預期 metrics：**
- Junk rate: 68% → 20-30%
- Cron skill 重複: 4 → 0
- Self-referential: 2 → 0
- Validation inconsistency: 11 → 0

---

## 附錄 A — Source Code 引用

| 文件 | 行數 | 關鍵問題 |
|------|------|---------|
| `scripts/skill_reviewer.js` | 847 | REVIEW_INSTRUCTIONS 嘅 nested-fence example、buildSkillCatalog 只係 advisory |
| `scripts/skill_reviewer_bot.js` | 480+ | H-4 abort 太遲、recordSkillCreated regex 唔 match H3、self-referential 唔 block |
| `scripts/validate_skill_file.js` | 145+ | 2-of-3 signals 模糊、pre-write gate 唔共用 |
| `scripts/weekly_correction_loop.js` | 1657 | Inactivity trigger 3 日延遲 |
| `scripts/skill_junk_tracker.js` | 141 | 每日計算 metric 寫 `.skill_junk_rate.jsonl` |

## 附錄 B — Telemetry 引用

| 文件 | 用途 | 記錄期 |
|------|------|--------|
| `.skill_created.jsonl` | 54 個 events，22 passed / 32 failed | 2026-06-08 至 2026-06-11 |
| `.skill_junk_rate.jsonl` | 4 個 daily snapshots | 2026-06-10 |
| `.skill_review_queue.jsonl` | 6 entries pending | 2026-06-11 11:27 |
| `.skill_metrics.json` | 100 reviewer_runs, 1 curator_run | 2026-06-09 至 2026-06-11 |

## 附錄 C — 失敗案例清單

| Case | Bytes | Root Cause | Quarantine Location |
|------|-------|------------|---------------------|
| m3-root-cause-analysis | 1025 | Truncation mid-Step-3 (token limit) | quarantine-2026-06-10/ |
| issue-quality-self-review | 1437 | Truncation mid-Step-5 | quarantine-2026-06-10/ |
| cron-p0-rescue-workflow | ? | Unclosed fence (1 fence in file) | quarantine-2026-06-10/ |
| cron-systemevent-migration (×4) | mixed | Repeat generation, no dedup | quarantine-2026-06-10/ |
| cron-job-testing | 577 | Pre-gate era, LLM 寫到一半停 | skills-learned/_archive/cron-job-testing/ |
| multi-phase-subagent-orchestration | 760 | Pre-gate era, LLM 25 行停 | skills-learned/_archive/multi-phase-subagent-orchestration/ |
| skill-reviewer-bot-self-improvement | 888/667 | Self-referential + truncation | quarantine-2026-06-10/ + pre-write gate catch |

---

**End of Report**
