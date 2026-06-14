# llm_judge.js — LLM-as-a-Judge Pipeline

生成 Domain Expert Role Prompt，透過 spawn MiniMax sub-agent 執行 judge。
唔直接 call model — 避免 isolated session 問題。

## 點解唔直接用 model？

- **Ollama（qwen2.5:3b）** — 模型太細粒，跟唔到結構化格式輸出
- **Ollama（qwen3:14b）** — 未 pull，而且大模型 loading 慢
- **行 exec 內 call API** — 喺 isolated session 環境下容易 timeout/hang

**解決方案：** 用 `llm_judge.js` 做 prompt generator，然後 spawn MiniMax sub-agent 執行。
MiniMax 嘅輸出可以用 `ExpertPromptBuilder.parse()` 自動解析。

## 支援的 Expert Roles

| Role | Prompt | 用途 |
|------|--------|------|
| `gemologist` | 資深 GIA 寶石學家 | 評估鑽石評級報告 |
| `trainer` | 虛擬助理訓練師 | 評估對話/總結質素 |
| `engineer` | 資深工程師 | 評估代碼質素 |
| `accountant` | 專業會計師 | 評估數字準確性 |
| `customer-service` | 客戶服務經理 | 評估語氣 |

## 評分標準

### Script Type Presets（標準化維度）

| --type | 用途 | Expert | Dimensions |
|--------|------|--------|------------|
| `content` | AI 摘要/日記/報告 | trainer | completeness, accuracy, usefulness |
| `log` | Cron logs / 系統輸出 | engineer | clarity, completeness, actionability |
| `tech` | 代碼 artifact / 文檔 | engineer | accuracy, structure, usefulness |
| `communication` | Discord/Signal 回覆 | customer-service | tone, clarity, completeness |
| `diamond` | 鑽石評級報告 | gemologist | accuracy, completeness, fairness |
| `generic` | 其他（fallback） | trainer | completeness, accuracy, clarity |

### Verdict Threshold（客觀門檻）

Score = 所有 dimension 既平均值。Verdict 唔再靠 LLM 主觀判斷，改用 threshold：

| Score | Verdict | 意義 |
|-------|---------|------|
| avg >= 7 | ✅ ACCEPT | 質素合格 |
| avg >= 4 && < 7 | 🔄 REVISE | 需要改進 |
| avg < 4 | ❌ REJECT | 重大問題 |

## 使用方式

### 1️⃣ 生成 judge prompt（CLI）

```bash
# 用 --type 自動 set expert+dims（推薦）
node llm_judge.js gen-prompt \
  --type log \
  --content "Cron job output..." \
  --target daily_maintenance.js

# 直接俾 content
node llm_judge.js gen-prompt \
  --content "要評估既內容" \
  --expert trainer

# 從檔案讀取
node llm_judge.js gen-prompt \
  --file output.md \
  --expert gemologist \
  --dimensions "accuracy,completeness"

# 從 stdin
cat summary.md | node llm_judge.js gen-prompt --stdin --expert engineer

# 指定 target 方便 tracking
node llm_judge.js gen-prompt \
  --content "內容" \
  --expert trainer \
  --target daily_summary_bot.js
```

### 2️⃣ Spawn MiniMax sub-agent

```
sessions_spawn({
  model: "minimax-portal/MiniMax-M2.7",
  task: `[copy prompt from step 1]`
})
```

> 💡 M2.5 更快（~7s），M3 更準（~60s）。Judge 建議 M3，日常快速 check 可用 M2.5。

### 3️⃣ 用 API 模式（直接在 code 用）

```javascript
const { generateJudgePrompt, ExpertPromptBuilder, EvalRecordKeeper } = require('./llm_judge.js');

// Step 1: Generate prompt
const prompt = generateJudgePrompt(
  '要評估既 daily summary',
  'trainer',
  ['completeness', 'clarity', 'tone']
);

// Step 2: Spawn MiniMax sub-agent with this prompt
// (minimax-portal/MiniMax-M2.7 做 judge)

// Step 3: Parse MiniMax response
const result = ExpertPromptBuilder.parse(miniMaxResponse);
console.log(result.verdict);     // ACCEPT / REVISE / REJECT
console.log(result.dimensions);  // { completeness: { score: 8, reason: "..." } }

// Step 4: Save to history
const keeper = new EvalRecordKeeper();
keeper.save(result);
```

### 4️⃣ 睇歷史 / 統計

```bash
# 最近 10 條 judge 記錄
node llm_judge.js history

# 全部 stats
node llm_judge.js stats

# JSON 輸出
node llm_judge.js history --limit 20 --json
```

## 輸出格式

```json
{
  "target": "daily_summary_bot.js",
  "expert_role": "trainer",
  "judge_model": "minimax-portal/MiniMax-M2.7 (via sub-agent)",
  "generator_model": "deepseek/deepseek-v4-flash",
  "dimensions": {
    "completeness": { "score": 8, "reason": "內容完整" },
    "clarity": { "score": 7, "reason": "結構清晰" }
  },
  "average_score": 7.5,
  "strengths": ["結構好", "語氣恰當"],
  "weaknesses": ["缺少行動項目"],
  "verdict": "REVISE",
  "reasoning": "...raw response...",
  "timestamp": "2026-05-08 10:45:00 HKT"
}
```

## Verdict 定義

| Verdict | 意義 |
|---------|------|
| ACCEPT | 內容可以接受 |
| REVISE | 需要少量修改 |
| REJECT | 需要重大修改/重新生成 |

## 歷史記錄

- 位置: `memory/evals/history.json`
- 保留最近 100 條
- 按 verdict / expert role / dimension 統計平均分

## 設計原則

1. **Judge 模型同 Generator 模型必須不同** — 避開 self-judge
2. **Domain Expert Role Prompting** — 激活領域知識
3. **唔直接 call model** — 透過 spawn sub-agent 執行，避免 timeout
4. **try-catch 包圍所有外部調用** — 穩定性
5. **結構化輸出** — 方便自動化

---

*Created: 2026-05-08 | Mode: MiniMax sub-agent only*
