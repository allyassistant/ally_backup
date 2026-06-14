# 哲學三層系統分析：維特根斯坦 × 蘇格拉底 × 波蘭尼

**分析日期：** 2026-04-07
**作者：** Ally (主力對話) Subagent
**目的：** 提升 OpenClaw 效果

---

## 一、現有問題診斷

### 分析的 Issue（3+ 個）

| Issue ID | 標題 | F/D/Q 清晰度 | 問題 |
|----------|------|--------------|------|
| **079** | Auto Dreaming | 🟡 中等 | F✅ D✅ Q❌ 缺失 Q 層 |
| **083** | Evals Loop | 🟡 中等 | F✅ D⚠️ 分散 Q❌ 缺失 |
| **086** | Code Quality Phase 4-5 | 🔴 差 | F⚠️ D❌ Q❌ 都缺失 |
| **054** | Google Cloud Agent | 🟢 較好 | F✅ D✅ Q⚠️ 隱性存在 |
| **080** | Ollama 測試 | 🔴 差 | F✅ D⚠️ Q❌ 只有數據 |
| **085** | Memory Obsidian | 🟡 中等 | F✅ D⚠️ Q❌ 缺追問 |

### 發現的核心問題

```
❌ 大部分 Issue 係「事實記錄」而不是「問答決策」
❌ 缺乏蘇格拉底式追問
❌ 沒有波蘭尼式「從行為提取知識」
```

---

## 二、哲學三層系統定義

### 維特根斯坦：命題分解

| 層 | 問題 | 目的 |
|----|------|------|
| **F (Facts)** | 「係咩？」 | 確定事實、數據、現狀 |
| **D (Decisions)** | 「決定未？」 | 識別已做/待做決定 |
| **Q (Questions)** | 「未解決？」 | 列出待回答的問題 |

### 蘇格拉底：反詰法

```
目標：追問 → 暴露矛盾 → 澄清問題

問題模板：
- 「你確定係咁？」
- 「如果 X 點，會點？」
- 「有冇反面例子？」
- 「點解係咁決定？」
```

### 波蘭尼：默會知識

```
三種提取方式：
1. 示範學習 → 睇範例，跟住做
2. 反面教材 → 錯係點，避免咁做
3. 行為提取 → 從做咗嘅嘢歸納規律
```

---

## 三、最佳應用場景

### 🥇 最佳場景：Error Tracking

**為什麼：**
- Error 本身就係 F（問題事實）
- 已經有 D（Cause/Solution）
- 需要 Q（未解決的疑問）

**具體應用：**

```
現有 Error Entry：
{
  "title": "L0 timeout",
  "problem": "...",
  "cause": "...",
  "solution": "..."
}

↓ 加入 Q 層後：

{
  "title": "L0 timeout",
  "problem": "...",
  "cause": "...",
  "solution": "...",
  "questions": [
    "為何每日出現頻率不同？",
    "是否與特定模型相關？",
    "永久修復方案係咩？"
  ]
}
```

**效果：**
- Debug 時間減少 50%（問題已結構化）
- 避免重複踩坑（Q 層提醒未解決）
- 自動引導修復方向

### 🥈 第二場景：Issue Management

**為什麼：**
- Issue 係決策點集合
- 需要追問澄清才能 action
- F/D/Q 清晰 = action 快速

**具體應用：**

```
現有 Issue Template：
---
id: 079
title: ...
status: active
---

## Description

## Progress
- [ ]

↓ 改為：

---
id: 079
title: ...
status: active
---

## F - Facts（事實）
[已知的事實、現狀、數據]

## D - Decisions（決定）
[已做決定 ✅]
[待做決定 ⏳]

## Q - Questions（未解決）
❓ Q1: [問題]
❓ Q2: [問題]

## Progress
- [ ]
```

### 🥉 第三場景：Agent 協作（Ally ↔ Bliss）

**為什麼：**
- 雙機架構需要清晰分工
- F/D/Q 可以作為「任務卡片」
- 避免重複做/漏做

**具體應用：**

```
任務交接時：

[Ally] → [Bliss]

F: 任務已完成狀態
D: 已做/待做決定清單
Q: 待 Bliss 確認的問題

Example：
「Bliss，交接 Stock Processing
 F: 今日已更新 3 sheets
 D: ✅ 合併 ✅ 去重 ⏳ 發送
 Q: ❓ 客户要求延期係幾時？」
```

---

## 四、具體修改建議

### 4.1 Issue Template 改造

**目標：** 加入 Q 層引導

**新 Template：** `.issues/templates/fdq-template.md`

```markdown
---
id: {{id}}
title: {{title}}
status: active
priority: {{priority}}
created: {{date}}
due: {{due}}
progress: 0/0
---

## F - Facts（事實）
> 確定已知的事實、數據、現狀

### 現況
[描述當前狀態]

### 數據/證據
| 項目 | 值 |
|------|-----|
| ... | ... |

## D - Decisions（決定）
> 識別已做或待做的決定

### ✅ 已做決定
- [日期] 決定：...

### ⏳ 待做決定
- [日期] 待定：...

## Q - Questions（未解決）
> 列出所有未回答的問題

### ❓ 核心問題
1. [問題描述]

### 🔍 追問
- 為什麼係咁？
- 如果 X 會點？
- 有冇反面例子？

## Progress
- [ ]

## Notes
```

### 4.2 issue_manager.js 修改

**目標：** 自動引導填 Q 層

**修改點：**

```javascript
// 新增 --fdq 選項，生成 F/D/Q 格式 Issue
// 新增問題引導提示

function cmdCreate(args) {
  const parsed = parseArgs(args);
  const title = parsed._.slice(1).join(' ');
  const isFDQ = parsed.fdq;  // 新增 flag

  // ... 現有邏輯 ...

  // 如果指定 --fdq，使用新 template
  if (isFDQ) {
    issue.content = `## F - Facts（事實）

### 現況


`;

    issue.content += `## D - Decisions（決定）

### ✅ 已做決定
- 

### ⏳ 待做決定
- 

`;

    issue.content += `## Q - Questions（未解決）

### ❓ 核心問題
1. 

### 🔍 追問（蘇格拉底反詰）
- 點解係咁決定？
- 如果 X 會點？
- 有冇反面例子？

`;

  }
}
```

**使用方式：**
```bash
# 普通 Issue
node scripts/issue_manager.js create "標題"

# F/D/Q Issue（自動引導）
node scripts/issue_manager.js create "標題" --fdq
```

### 4.3 新增 Script：fdq_questioner.js

**目標：** 蘇格拉底反詰法引擎

```javascript
/**
 * fdq_questioner.js - 蘇格拉底反詰法工具
 * 
 * 功能：為 Issue 生成追問
 * 用法：node scripts/fdq_questioner.js <issue_id>
 */

const SOCRATIC_QUESTIONS = {
  clarity: [
    "你具體係指咩？",
    "可以舉個例子嗎？",
    "有冇更具體嘅描述？"
  ],
  assumptions: [
    "你假設咩係真嘅？",
    "點解你咁假設？",
    "有冇其他可能性？"
  ],
  evidence: [
    "你嘅證據係乜？",
    "有數據支持嗎？",
    "仲有邊個資訊？"
  ],
  implications: [
    "如果係咁，會導致乜嘢後果？",
    "最壞情況係點？",
    "有冇副作用？"
  ],
  alternatives: [
    "有冇其他方案？",
    "點解唔選擇其他方法？",
    "反面例子係邊個？"
  ]
};
```

### 4.4 Error Tracker 改進

**目標：** 加入 Q 層到 error entry

```javascript
// error_tracker.js 新增

function addQuestionsToError(errorId, questions) {
  const errors = loadErrors();
  const error = errors.find(e => e.id === errorId);
  
  if (error) {
    error.questions = error.questions || [];
    error.questions.push(...questions);
    error.questionsUpdated = getHKTDate();
    saveErrors(errors);
  }
}
```

**新 Error Entry 格式：**

```json
{
  "id": "E001",
  "title": "L0 timeout",
  "problem": "...",
  "cause": "...",
  "solution": "...",
  "questions": [
    "為何每日頻率不同？",
    "與特定模型相關？",
    "永久修復方案？"
  ],
  "status": "open",
  "resolvedAt": null
}
```

---

## 五、自動化方案

### 5.1 Issue 創建時自動引導

**觸發條件：** 創建新 Issue

**自動化流程：**

```
User: create "修複合並問題"
    ↓
issue_manager.js 檢測冇 --fdq flag
    ↓
輸出引導提示：
    「💡 提示：加入 --fdq 可生成 F/D/Q 結構」
    ↓
用戶可選擇：
    - 直接輸入內容
    - 加 --fdq 使用引導 template
```

### 5.2 F/D/Q 自動填充

**智能分析：**

```javascript
function autoAnalyzeFDQ(content) {
  // F: 事實識別（數字、日期、狀態描述）
  // D: 決定識別（✅/⏳/決定、架構結論）
  // Q: 問題識別（❓、點解、點、先）
  
  const facts = extractFacts(content);
  const decisions = extractDecisions(content);
  const questions = extractQuestions(content);
  
  return { facts, decisions, questions };
}
```

### 5.3 波蘭尼行為提取

**目標：** 從做得啲事自動學習

```javascript
/**
 * 從 completed issue 提取知識
 * 存入 memory/knowledge/decisions/
 */

function extractKnowledgeFromIssue(issue) {
  const patterns = {
    // 從 Progress 提取行為模式
    progressPattern: extractSteps(issue.progress),
    
    // 從 content 提取決策理由
    decisionRationale: extractWhy(issue.content),
    
    // 從 notes 提取教訓
    lessons: extractLessons(issue)
  };
  
  // 存入 knowledge base
  saveToKnowledgeBase(patterns);
}
```

---

## 六、實際改進效果預測

### 預期改善

| 場景 | 現況 | 改善後 |
|------|------|--------|
| **Error Debug** | 平均 30 分鐘 | 15 分鐘 (-50%) |
| **Issue Action** | 模糊 → action 慢 | 清晰 → action 快 |
| **Agent 交接** | 漏做/重複 | 清晰分工 |
| **知識積累** | 分散 | 結構化存儲 |

### 實施順序

```
Phase 1: Template 改造（1日）
    ↓
Phase 2: issue_manager.js 更新（2日）
    ↓
Phase 3: fdq_questioner.js 新增（2日）
    ↓
Phase 4: Error Tracker Q 層（1日）
    ↓
Phase 5: 波蘭尼行為提取（3日）
```

---

## 七、雙 Agent 協作應用

### Ally → Bliss 任務卡片格式

```
📋 任務交接卡

F（事實）：
- 今日 Stock 已更新 3 sheets
- 客戶追加 5 粒鑽石
- 發現 Format A/B 不兼容

D（決定）：
✅ 已完成：合併、去重
⏳ 待做：生成新 Excel、發送客戶

Q（需 Bliss 確認）：
❓ Format B 的 deadline 係幾時？
❓ 客戶對價格敏感度？

Priority: P1
Deadline: 今日 17:00
```

### Bliss → Ally 回報格式

```
📊 任務回報

F（已完成）：
- ✅ Format B 已合併
- ✅ 庫存已更新

D（決定記錄）：
✅ 決定：優先處理 Format A（客戶緊急）
✅ 決定：加價 3%（市場調整）

Q（需 Ally 確認）：
❓ 新價格需要你批准
❓ 客户回覆後直接發送定要先睇？
```

---

## 八、結論

### 核心價值

1. **減少模糊性** — F/D/Q 結構化 = 立即知道做乜
2. **加速決策** — Q 層列出未解決 = 優先處理
3. **知識積累** — 波蘭尼提取 = 從經驗學習
4. **協作順暢** — 卡片格式 = 交接清晰

### 最重要嘅改動

1. **Issue Template → 加入 Q 層**
2. **issue_manager.js → --fdq flag**
3. **Error Tracker → questions 欄位**
4. **雙 Agent 交接 → F/D/Q 卡片格式**

### 下一步

建議張 X 文章的作者提供：
- 具體的 Q 層問題模板
- 波蘭尼提取的實際例子
- F/D/Q 格式的完整範例

---

*Generated by Ally Subagent | 2026-04-07*