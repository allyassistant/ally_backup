# QW-1 ~ QW-5 實施記錄

**日期：** 2026-06-11
**基於：** `skill-reviewer-root-cause-analysis-2026-06-11.md`
**預期效果：** junk rate 由 68% 降到 20-30%

---

## 修改範圍

| 檔案 | 改動 | 涉及 QW |
|------|------|---------|
| `scripts/skill_reviewer.js` | +QW-1 hard block、QW-4 fence rule、QW-5 decision tree 移到首位、batch mode strip regex 改窄 | QW-1, QW-4, QW-5 |
| `scripts/skill_reviewer_bot.js` | +QW-2 self-ref filter、QW-3 unified pre-write gate | QW-2, QW-3 |
| `scripts/validate_skill_file.js` | +export `validateSkillContent()`、guard `main()` 唔好 auto-run | QW-3 (support) |

---

## QW-1: Self-Referential Hard Block (5 min)

**改動位置：** `skill_reviewer.js` line 316 (after decision tree)

**Before:** 冇 self-referential block，LLM 會自己 generate 關於自己嘅 skill

**After:**
```
### ⛔ HARD BLOCK — Read Before Proceeding (QW-1)

**DO NOT generate or create any skill that:**
- References itself, the skill-reviewer, the curator, the validator, or any internal automation
  (File names containing: `skill-reviewer`, `curator`, `self-improvement`, `bot-self`)
- Describes a one-time task, single-conversation incident, or niche workflow with no reuse
- Modifies `scripts/skill_reviewer*.js`, `scripts/validate_skill_file.js`, ...
```

**預期影響：** -3% junk rate（避免 `skill-reviewer-bot-self-improvement` 出現）

---

## QW-2: Pre-write Self-Referential Filter (15 min)

**改動位置：** `skill_reviewer_bot.js` line 365 (`writeSkillFiles`)

**Before:** 冇 server-side self-ref filter，LLM prompt 嘅 self-referential block 可能被忽略

**After:**
```js
// ── QW-2 fix: pre-write self-referential filter ──
var selfRefPattern = /(skill-reviewer|curator|self-improvement|bot-self|skill-validation-failure-cleanup)/i;
if (selfRefPattern.test(block.filePath)) {
  err('Refusing self-referential skill: ' + block.filePath);
  recordSkillCreated({...reason:'self-referential block (QW-2)'});
  log('SKIP self-ref: ' + block.filePath);
  continue;
}
```

**預期影響：** -3% junk rate

**測試：**
- `skills-learned/skill-reviewer-x/SKILL.md` → BLOCKED ✅
- `skills-learned/cron-job-testing/SKILL.md` → allowed ✅

---

## QW-3: Unified Pre-write Gate (30 min)

**改動位置：** `skill_reviewer_bot.js` line 376 + `validate_skill_file.js`

**Before:** 兩套唔同標準
- Pre-write: 淨 check `bytes < 1500`
- Post-write validator: check `≥2-of-3 signals` (size / workflow / word count)

**After:** 兩套共用同一個 function
- `validate_skill_file.js` 抽 `validateSkillContent(content)` 出嚟
- `bot.js` import 之後喺 write 之前 call 同一個 function
- 結果：consistency guaranteed

**預期影響：** -5% junk rate

**測試：**
- Stub content（79B + 1 step + 5 words）→ BLOCKED ✅
- Good content（valid workflow + pitfalls）→ PASS ✅
- 大但冇 workflow → BLOCKED (validator composite check) ✅

---

## QW-4: Fence Counting Rule (10 min)

**改動位置：** `skill_reviewer.js` line 326

**Before:** 個 example 用外層 ``` 包內層 ```bash 嘅 nested 結構，LLM 對 fence counting 完全搞混

**After:**
```
### ⚠️ CRITICAL: Fence Counting Rule (QW-4)

1. **Each SKILL.md uses exactly ONE outer pair of triple-backtick fences** (the wrapper the bot expects).
2. **Inside the SKILL.md, use 4-backtick fences (` ```` `) for any example code blocks** — bash, JSON, snippets.
3. **NEVER nest a triple-backtick block inside another triple-backtick block.**
4. **Always end with a JSON summary block** (` ```json `) at the very end of your response.

**Example of CORRECT structure:** [4-backtick fence with proper internal nesting]
**Example of WRONG (will cause truncation):** [shows the old broken pattern]
```

**預期影響：** -20% junk rate（最大嘅 improvement！）

---

## QW-5: Decision Tree 移到首位 (5 min)

**改動位置：** `skill_reviewer.js` line 303

**Before:** Decision tree (PATCH > CREATE) 喺 prompt 較後嘅位置，LLM 已經決定 CREATE 先見到

**After:**
```
### ⛛ DECISION TREE — PATCH > UPDATE > CREATE (FIRST — QW-5)

1. **Does an existing skill in `skills-learned/` already cover this?**
2. **If yes → PATCH (add steps/pitfalls) or UPDATE (rewrite sections)**
3. **If NO existing skill covers it AND reusability is clear (≥3 future use cases) → CREATE**
4. **If NO existing skill covers it AND use case is narrow/one-time → output `SKIP: <reason>`**

The default is **PATCH**. CREATE is the LAST resort.
```

**預期影響：** -8% junk rate

---

## 連同 Batch Mode 修復

Batch mode (`buildBatchReviewInstructions`) 之前嘅 strip regex 會掃走 QW-1/4/5 sections，update 之後只 strip `### Target shape` 至 `### Support file architecture`，保留晒所有 QW 段喺 prompt 頂部。

---

## 累計預期

| 來源 | 改善 |
|------|------|
| QW-1 | -3% |
| QW-2 | -3% |
| QW-3 | -5% |
| QW-4 | **-20%** |
| QW-5 | -8% |
| **總計** | **68% → ~29%** |

---

## 驗證

### Syntax
```
$ node --check scripts/skill_reviewer.js && echo OK
$ node --check scripts/skill_reviewer_bot.js && echo OK
$ node --check scripts/validate_skill_file.js && echo OK
```

### Functional Tests
- Stub 779B + 1 step → BLOCKED ✅
- Self-ref `skill-reviewer-x` → BLOCKED ✅
- Good content → PASS ✅
- Real existing skill validation → works ✅

### Commit
`bcf253c fix(skill-reviewer): QW-1..QW-5 quality improvements`

---

## 7 日後追蹤 metrics

Monitor `.skill_junk_rate.jsonl`：
- Expected: 7-day junk rate from 68.89% → ≤30%
- Expected: zero self-referential creations
- Expected: zero stub events (<1500B passing pre-write gate)

如果 7 日後 junk rate 仲高過 30%，考慮執行其餘方案：
- 方案 2 (Cron signals dedup) — -10%
- 方案 5 (Reusability threshold) — -10%
- 方案 6 (Token budget pre-flight) — -5%
