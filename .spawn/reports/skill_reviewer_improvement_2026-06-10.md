# Skill Reviewer 改進方案（修正版 v2）
*日期：2026-06-10 | 分析：sub-agent | Junk rate：16/49 (33%)*
*修正要點：5 處 (size threshold、structural gate、catalog、one-time detection、priorities)*

---

## 問題 Root Cause

經 source code + 16 個 junk skills + 1 個遺漏（`m3-root-cause-analysis`）嘅 analysis，5 個 systemic issues：

### RC-1：LLM Output Truncation（M2.5 max_tokens 限制）
Batch mode 嘅 LLM prompt 太長，output space 唔夠：
- `multi-phase-subagent-orchestration`（760B）：code block 開頭就斷
- `cron-context-overflow-recovery`（583B）：workflow 完全缺失
- `cron-job-testing`（577B）：Step 1 開頭就斷
- `subagent-model-override`（1291B）：`sessions_spawn({` code block 結尾
- `m3-root-cause-analysis`（1025B）：validation 報 `Workflow ends with colon ... likely truncated`

**呢啲全部 validation 已經 fail**，但檔案留喺 `skills-learned/` 等 curator。

### RC-2：Batch Mode 沒有 Pre-write Validation Gate
`skill_reviewer_bot.js` 嘅 `writeSkillFiles()` 係 **write → validate**（reactive）：
- 檔案已寫入 disk
- Validation fail 只係唔 create symlink
- 爛 skill 留喺 `skills-learned/` 等下次 curator

Batch mode 嘅 LLM 冇 `exec` tools，**無法 self-validate** 喺 output 前。

### RC-3：Composite Heuristic 解決咗 Size 問題，但 Completeness 漏咗
`validate_skill_file.js` 經歷 200w→800B 嘅 false-positive 教訓，現時用 composite heuristic（≥2/3 signals）：
- `STUB_FILE_SIZE_MIN = 800` ✓
- `STUB_WORKFLOW_STEPS_MIN = 3` ✓
- `STUB_WORD_COUNT_MIN = 30` ✓

呢個**解決咗 5 個 thin skills 嘅 false-positive**（`cron-thin-executor-migration` 133w、`ai-hot-push-workflow` 169w、`subagent-code-tuning-workflow` 215w 全部 OK）。

**但漏咗 completeness check**：
- File 結尾有無句號？
- 所有 `## section` 有無 content？
- Code block 全部 closed？（`subagent-model-override` 有 1 個 unclosed）

### RC-4：Catalog 有，但 enforcement 太弱
`skill_reviewer.js` `buildSkillCatalog()` 產生 markdown table，但 prompt 只係 softer guidance：
- 冇 **forced output line**（「overlap_check: PASS/FAIL」）
- 冇 **parse & enforce** hook
- LLM 可以「睇咗就算」然後 CREATE 重複

### RC-5：Curator 被動 + Niche Detection 冇 mechanism
`weekly_correction_loop.js` Phase 1b mini-curator：
- 30 分鐘先跑一次
- 只 verify frontmatter
- 冇 quarantine、冇 Discord alert
- 冇 niche/one-time 識別

`skill-reviewer-draft-cleanup`、`heartbeat-maintenance`、`skill-automation-analysis` 呢類 one-time skills 冇 mechanism 識別，全部留喺 library。

---

## 改進方案（5 個維度，v2 修正）

### A. 預防層 (Prevention)
**問題**：LLM 生成 skill 前冇 systematic check，導致重複 + niche + truncation
**建議**：

#### A.1 Prompt 加「Forced Overlap Check」Output
喺 `skill_reviewer.js` `REVIEW_INSTRUCTIONS` 嘅 `Self-audit checklist` 加：

```
#### Pre-Creation Check（必須 output，否則 reject）

For each candidate skill, output ONE line:
  overlap_check: <PASS|FAIL (matches: skill-a, skill-b)>
  trigger_frequency: <weekly|monthly|quarterly|one-time>
  reasoning: <一句中文，講呢個 skill 點解值得以 class-level 形式存在>

LLM 必須 output 呢 3 行。Bot parser 會讀取：
  - overlap_check=FAIL + trigger_frequency=one-time → 跳過唔寫
  - trigger_frequency=one-time → quarantine（即使 LLM 寫咗）
```

**配合 `skill_reviewer_bot.js` parsing**：parse LLM output，攔截唔符合條件嘅 skill blocks。

#### A.2 維持 markdown Catalog，加 explicit instruction
**唔好改 catalog format**（markdown table 對 LLM 反而 token-efficient）。改為加 forced instruction：

```
For each candidate skill name, scan the catalog table above:
  - 任何 substring match → overlap_check: FAIL
  - 同義詞 match（如 "test" vs "testing"、"debug" vs "troubleshoot"）→ overlap_check: FAIL
  - 完全冇 match → overlap_check: PASS
```

#### A.3 Token Budget Hint
喺 prompt 結尾加：
```
⚠️ 提示：output space 有限。如不確定 truncat 邊個 skill，
寧可只完成第一個 skill 嘅完整 SKILL.md，都唔好開多個未完成嘅。
```

**實作 effort**：Low（改 `skill_reviewer.js` string constants + `skill_reviewer_bot.js` parser）
**預期 impact**：重複率 → 接近 0；niche skills 識別率 100%；truncation rate 減 50%（hint 唔係 guarantee）
**優先級**：**P1**（v1 寫 P0，**降級**：prompt change 係 soft enforcement，唔係 structural gate）

---

### B. 內容層 (Quality Gates)
**問題**：Truncation、thin content、niche detection 缺
**建議**：

#### B.1 加 Completeness Check 到 `validate_skill_file.js`
維持現有 composite heuristic（800B/3 steps/30 words），**唔好加 size threshold**（會打爛 thin skills）。加 completeness gate：

```javascript
// 5. Completeness check — file 結尾必須有 sentence-final punctuation
const lastChar = content.trimEnd().slice(-1);
if (!/[.!?。)\]】」』]$/.test(content.trimEnd())) {
  errors.push(`File ends with "${lastChar}" — likely truncated, needs sentence-final punctuation`);
}

// 6. All ## sections have content
const emptyHeaders = content.match(/^##\s+[^\n]+\n\s*\n##\s+/gm);
if (emptyHeaders) {
  errors.push(`${emptyHeaders.length} section headers have no content`);
}
```

#### B.2 加 Pitfall Quality Gate
```javascript
// 7. Each pitfall must be ≥20 chars (real content, not "小心" stub)
const pitfallMatches = pitfallsBody.match(/^- (?:⚠️?\s*)?\S.*/gm) || [];
const thinPitfalls = pitfallMatches.filter(p => p.length < 20);
if (thinPitfalls.length > 0) {
  errors.push(`${thinPitfalls.length} pitfall items are <20 chars (likely stubs)`);
}
```

#### B.3 Trigger Frequency Structural Gate
**配合 A.1**，喺 frontmatter 加 required field：
```yaml
---
name: my-skill
trigger_frequency: weekly|monthly|quarterly|one-time
---
```

`validate_skill_file.js` 加 check：
```javascript
// 8. Trigger frequency frontmatter field required
const tfMatch = content.match(/^trigger_frequency:\s*(.+)$/m);
if (!tfMatch) {
  errors.push('Missing required frontmatter field: trigger_frequency');
} else if (tfMatch[1].trim() === 'one-time') {
  errors.push('trigger_frequency=one-time → skill not allowed in library');
}
```

**重要：呢個係 structural enforcement，唔係 prompt aspiration。**

#### B.4 One-Time Content Detection（**唔好用 keyword**）
v1 建議嘅 `['heartbeat', 'cleanup', 'maintenance']` keyword 會 false-positive（`heartbeat-maintenance` 係 recurring，`skill-reviewer-draft-cleanup` 係 recurring）。改為**content-based detection**：

```javascript
// 9. Content-based one-time detection
const oneTimePatterns = [
  /after this (issue|bug|task) is (fixed|resolved|done)/i,
  /一次性[的]?\s*(清理|修補|工作|任務)/,
  /this was a one-?off (fix|incident|cleanup)/i,
  /one-time (cleanup|fix|task)/i,
  /no longer (needed|required) after/i,
];
const isOneTimeContent = oneTimePatterns.some(p => p.test(body));
if (isOneTimeContent) {
  errors.push('Content indicates one-time task — not a recurring skill');
}
```

**實作 effort**：Med（改 `validate_skill_file.js` + 3 個 new gates）
**預期 impact**：Truncation rate 減 80%（completeness check）；niche skills 識別率 100%（content-based）
**優先級**：**P0**（structural enforcement，最有效嘅 gate）

---

### C. 同步層 (Library Awareness)
**問題**：Catalog 有但 enforcement 太弱
**建議**：

#### C.1 維持 markdown table，唔好改 JSON
**v1 建議改 JSON 係錯嘅**。理由：
- Markdown table 係 LLM 嘅 native format，token-efficient
- LLM 唔會主動 call JSON.parse，JSON format 唔會提高 matching 率
- 真正問題係 **enforcement**，唔係 format

**改為**：C.1 (v2) — 維持 markdown table，但加 **forced output line**（A.1）同 **synonym matching**（A.2）。

#### C.2 自動 build "Topic Clusters"
喺 `skill_reviewer.js` `buildSkillCatalog()` 後加：
```javascript
// 自動偵測 topic clusters
function buildTopicClusters() {
  const clusters = {
    'cron': ['cron-thin-executor-migration', 'cron-health-triage', ...],
    'subagent': ['subagent-sideeffect-containment', 'subagent-truncation-repair', ...],
    'skill-curation': ['skill-curation-pattern', 'skill-quality-verification', ...],
  };
  // 用 keyword matching 自動建 clusters
  // 然後喺 prompt inject："Below are existing topic clusters. If your candidate skill
  // falls in any cluster → PATCH the cluster, not CREATE new."
}
```

呢個**比 JSON 改動細**，但 enforcement 更強。

**實作 effort**：Med（加 topic cluster logic + prompt section）
**預期 impact**：重複率 → 接近 0；topic 內 patch rate +30%
**優先級**：P1

---

### D. 驗證層 (Post-Generation Validation)
**問題**：`writeSkillFiles()` 係 reactive，爛 skill 已寫入先驗
**建議**：

#### D.1 改 `writeSkillFiles()` order：validate → write
`skill_reviewer_bot.js` line ~200：
```javascript
// 改前：
fs.writeFileSync(absPath, block.content + '\n', 'utf8');
const validatorOut = require('child_process').execFileSync('node', [...]);
if (validationPassed) { /* symlink */ }

// 改後：
// 1. 先 write to temp file
const tmpPath = absPath + '.tmp';
fs.writeFileSync(tmpPath, block.content, 'utf8');
// 2. validate
try {
  execFileSync('node', [path.join(WS, 'scripts/validate_skill_file.js'), tmpPath], ...);
  // 3. validate pass → rename temp to final
  fs.renameSync(tmpPath, absPath);
  /* symlink */
} catch (e) {
  // 4. validate fail → quarantine temp
  fs.renameSync(tmpPath, quarantinePath);
  err(`Quarantined: ${block.filePath}`);
}
```

**重要**：用 temp file + rename，**atomic write**。如果 validate fail，temp file 自動去 quarantine，**絕不污染 `skills-learned/`**。

#### D.2 加 max_tokens buffer 到 LLM call
`skill_reviewer_bot.js` line ~260 嘅 `execFileSync('openclaw', [...])` 加：
```javascript
'--max-tokens', '8000',  // 預留 buffer 比 M2.5 嘅 196608 limit
```

唔係解決 truncation 嘅根本方法，但提供更大 output space 畀 LLM。

#### D.3 加 Niche Skill Pre-screen（content-based）
Bot 喺 parse LLM output 後、validate 前加：
```javascript
// Pre-screen for niche/one-time skills
const body = content.replace(/^---[\s\S]*?---\n/, '').trim();
if (containsOneTimePattern(body)) {
  quarantineSkill(absPath, 'content indicates one-time task');
  continue;
}
```

**實作 effort**：Med（重構 writeSkillFiles + 加 niche pre-screen）
**預期 impact**：爛 skill 完全唔寫入 disk，junk rate 可減至<5%
**優先級**：**P0**

---

### E. Curator Loop 改進
**問題**：Curator 被動 + 頻率唔夠
**建議**：

#### E.1 加 Active Quarantine
`weekly_correction_loop.js` Phase 1b mini-curator（line ~870）：
```javascript
// 改：唔只 verify frontmatter，要 validate full content
const validatorOut = execFileSync('node', [path.join(WS, 'scripts/validate_skill_file.js'), skillFile], ...);
// 如果 fail → quarantine immediately
```

#### E.2 加 Discord Alert for Quarantine
Curator quarantine 時主動通知 `#⚙️系統`：
```javascript
if (validationFailed) {
  await sendDiscordAlert(`🔴 Quarantined: ${skillName} — ${errors.join('; ')}`);
}
```

#### E.3 Niche Skill Auto-Archive（usage-based）
唔係 content-based detection，**用 usage tracking**：
- 為每個 skill 加 `consultedCount`、`lastConsulted` field（喺 `skill_metrics.json` 擴展）
- 30 日內 `consultedCount = 0` → auto-archive
- 完全繞過 keyword/content detection 嘅 false-positive 問題

**實作 effort**：Med（改 `weekly_correction_loop.js` + `skill_metrics.json` schema）
**預期 impact**：Junk rate <5%；truncation 被主動 catch
**優先級**：P1

---

## 漏咗嘅 1 個 Junk Skill

`m3-root-cause-analysis`（1025B）audit report 冇歸類成 junk，但 validation 已經 fail：
```
INVALID: Workflow ends with colon "gation to M3 sub-agent with clear brief:" — likely truncated before code block/list
```

**點解 audit 漏咗**：可能因為 status 仍係 `draft`，curator 未掃到。
**補救**：加到 archive 清單。

---

## Cron-Model-Selection-Verification Tune-up（具體步驟）

`cron-model-selection-verification` 13430B、13 個 pitfalls（**v1 寫 17，錯**），其中：
- **#11** 講 provider health caching — 過時，呢個已 fix
- **#13** 講 `MiniMax overloaded_error chronic pattern as of 2026-06-07, 111 errors` — dated
- **#7-10** 有重疊（都係講 model output vs config 嘅分別）

**Tune-up 步驟**：
1. 砍 #11（已 fix）
2. 砍 #13（dated，移到 HEARTBEAT.md 作為 historical record）
3. 合併 #7-#10 為 1 個「Model output != Config」pitfall
4. 砍後剩 9 個 pitfalls，全部保留
5. 加 trigger_frequency: weekly（呢個係 recurring task）

---

## Quick Wins（1 日，零風險）

1. **`validate_skill_file.js` 加 completeness check**（~15 行）
   - File ends with punctuation？
   - 全部 `## section` 有 content？
   - **唔好加 size threshold**（composite heuristic 已解決）

2. **`validate_skill_file.js` 加 trigger_frequency frontmatter gate**（~10 行）
   - Required field：缺 → fail
   - Value = `one-time` → fail + reason

3. **`validate_skill_file.js` 加 content-based one-time detection**（~20 行）
   - 6 個 regex patterns 偵測 one-time 描述
   - **唔好用 keyword**（`heartbeat`/`cleanup` 會 false-positive）

4. **`skill_reviewer_bot.js` 改 write order**（~30 行重構）
   - temp file → validate → rename to final OR rename to quarantine
   - 爛 skill 完全唔寫入 `skills-learned/`

5. **`skill_reviewer.js` 加 Pre-Creation Check forced output**（~20 行 string change）
   - LLM 必須 output 3 行：`overlap_check`、`trigger_frequency`、`reasoning`
   - Bot parser 攔截不符條件嘅 skill

---

## Medium-term（1 週）

1. **Topic Clusters 自動偵測**（`skill_reviewer.js` `buildSkillCatalog()`）
   - keyword matching 自動建 topic clusters
   - prompt inject clusters，要求 LLM patch 唔好 create

2. **Curator Discord Alert**（`weekly_correction_loop.js` Phase 1b）
   - quarantine 時主動 send `#⚙️系統`

3. **Niche Skill Auto-Archive via Usage**（`skill_metrics.json` 擴展）
   - 加 `consultedCount`、`lastConsulted` field
   - 30 日 0 consultation → auto-archive

4. **M2.5 max_tokens buffer**（`skill_reviewer_bot.js` LLM call）
   - `--max-tokens 8000`
   - 唔係根治但畀更大 output space

---

## Long-term（1 月）

1. **Semantic Similarity Check**（embedding API）
   - Vector embedding 計算 cosine similarity
   - >0.7 → 強制 PATCH

2. **Skill Usage Tracking 全自動**（`sessions_yield` 自動 log）
   - 每次 skill 載入時 log
   - 自動建 consultation rate dashboard

3. **Skill Health Score Dashboard**（新 cron `skill_quality_audit`）
   - 每小時 report validation status、truncation history
   - Discord `#⚙️系統` 推送

4. **Auto-Promote Thresholds**（`weekly_correction_loop.js`）
   - 符合所有 quality gates 嘅 draft → 自動升 active
   - Curator 只處理 flagged skills

---

## 優先執行順序（v2 修正）

```
Week 1（Quick Wins，4 個 P0 fixes）：
  1. validate_skill_file.js: completeness check（file ends with punctuation）
  2. validate_skill_file.js: trigger_frequency frontmatter gate
  3. validate_skill_file.js: content-based one-time detection
  4. skill_reviewer_bot.js: validate→write order（atomic via temp file）

Week 2（Medium-term）：
  5. skill_reviewer.js: Pre-Creation Check forced output + parser
  6. weekly_correction_loop.js: Discord alert for quarantine
  7. skill_reviewer.js: Topic Clusters 自動偵測

Week 3-4（Long-term）：
  8. skill_metrics.json: usage tracking fields
  9. semantic similarity check
  10. auto-promote thresholds
```

---

## 預期成果（v2 修正）

| 指標 | 改前 | 改後目標 |
|------|------|----------|
| Junk rate | 33%（16/49） | <5%（2-3/49） |
| Truncation rate | 10%（5/49） | <2%（1/49） |
| 重複率 | 12%（6/49） | ~0% |
| Niche/一次性 skills | 12%（6/49） | <2% |
| Validation fail rate | 27%（13/49） | <5% |
| Thin skills false-positive | 0（composite heuristic OK） | 維持 0 |

---

## 修正差異摘要（v1 → v2）

| 項目 | v1 建議 | v2 修正 | 原因 |
|------|---------|---------|------|
| STUB_FILE_SIZE_MIN | 800 → 1200 | 維持 800 | 會打爛 5 個 thin skills（composite heuristic 教訓） |
| Trigger frequency gate | Prompt aspiration | Frontmatter structural field | Aspiration 冇 enforcement，frontmatter 必填先有效 |
| Catalog format | 改 JSON | 維持 markdown | LLM 唔會 JSON.parse，markdown 反而 token-efficient |
| One-time detection | Keyword matching | Content-based regex | Keyword 會 false-positive（heartbeat/cleanup 係 recurring） |
| P0/P1 分類 | A=P0, B/D=P0 | A=P1, B/D=P0 | Prompt change 唔算 P0，structural gate 先算 |
| `m3-root-cause-analysis` | 漏咗 | 加入 archive 清單 | 1025B，validation 已 fail |
| `cron-model-selection-verification` | 17 pitfalls | 13 pitfalls | 之前計錯 |

---

## 總結（v2）

v1 嘅核心 insight（**三層失效 + 預防勝於治療**）係啱嘅，但**執行細節**有 5 處唔合理：

1. **Size threshold 唔可以盲加**（composite heuristic 嘅設計有原因）
2. **LLM prompt 嘅 gate 必須 structural**（frontmatter、atomic write、parser）
3. **Catalog format 唔係問題，enforcement 先係**
4. **One-time detection 必須 content-based**（keyword 太天真）
5. **Priorities 要分得清**（P0 = structural enforcement，P1 = prompt improvement）

修正後嘅方案：4 個 Quick Wins（全部 structural gates，零 false-positive 風險） + 1 週 medium-term + 1 月 long-term，junk rate 33% → <5%。
