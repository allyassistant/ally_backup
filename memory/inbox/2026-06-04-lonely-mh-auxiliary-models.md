---
title: "Lonely — Hermes Agent 辅助模型 (Auxiliary Models) 入门指南"
date: 2026-06-04
author: Lonely (@Lonely__MH)
source: "https://x.com/lonely__mh/status/2062368928148701584"
platform: X
category: AI
tags: [agent, model-routing, cost-optimization, hermes, auxiliary-model]
type: reference
---

# Hermes Agent 辅助模型 (Auxiliary Models) 入门指南

> 7,853 views · 18 replies · 9 reposts · 40 likes · 27 bookmarks (Lonely @Lonely__MH, 2026-06-04)
> 系列續篇（前作 5/15 文章 102K views）

## 核心 Thesis

**"該省省，該花花"** — 唔係所有 task 都要 main model。「邊緣任務」（上下文壓縮、截圖分析、網頁摘要、標題生成）可以交俾 Flash 等小模型，主模型只做 deep reasoning。

呢個概念**直接對應 #120 觀察期嘅 M3 vs Flash 問題** — 而家 Josh 喺度諗 main agent 應該用 M3 定 Flash，呢篇文章提供咗第三條路：**混用**（Main + Auxiliary）。

## 11 個 Auxiliary Tasks 完整分類

### 必配 (Must Configure)
- **Vision** — 圖片理解、UI 截圖、錯誤識別
  - 用：`google/gemini-2.5-flash`（cheap + fast + multimodal）
  - 主模型唔支援多模態（DeepSeek 類）就**必須配**，否則 silent fail

### 高頻輕量任務 (High-freq lightweight)
- **Compression** — 上下文壓縮（會話接近 context window 時自動觸發）
  - 用：DeepSeek v4 / Xiaomi MiMo-v2.5-Pro（cheap，效果 OK）
  - **呢個對應我哋嘅 compaction flushThreshold**：Hermes 用 auxiliary model 壓，main model 唔使參與
- **Title Gen** — 會話標題自動生成
  - 任何 Flash 都夠
- **Web Extract** — 網頁正文提取、清理噪音、摘要
  - 用：Grok 4.3（X Premium 訂閱，page noise 處理最強）
  - **直接相關**到我哋用 `browser` tool 嘅 X link 分析 SOP
- **Profile Describer** — Profile 描述生成
  - 用：MiMo / DeepSeek

### 低頻但高影響 (Low-freq high-impact)
- **Triage Specifier** — 任務分診、判斷類型、揀 tool、揀 sub-agent
  - 用：GPT-5.5 / Claude Opus（**強推理**，因為錯咗後面全部錯）
  - **直接對應我哋嘅 Router system**！Hermes 嘅 Triage = 我哋嘅 route classifier
- **Kanban Decomposer** — 拆任務、生成依賴、分配 worker
  - 強模型（拆得太粗/太碎都壞事）
  - 對應我哋嘅 **Pipeline Flow** (Research → Map → Pin → Chip Loop → Validate → Fix Gaps → Review → Done)
- **Curator** — Skill 維護（過時、重複、歸檔）
  - 強模型（影響 long-term skill 資產）
  - 對應我哋嘅 `weekly_correction_loop.js`

### 預設 auto
- **Approval** — 風險判斷（high risk 建議人工）
- **MCP** — MCP tool 路由（先 auto 觀察）

## 3 個配置理由

1. **成本控制** — Compression/Title Gen 等任務唔需要 reasoning 強嘅 model，Token 差價以倍數計
2. **響應速度** — 旗艦 model 慢，後台任務塞 queue 會拖慢主對話
3. **能力匹配** — Vision 需要 multimodal（DeepSeek 唔得）、某些任務需要 reasoning（Triage 唔可以慳）

## 兜底機制 (Fallback)

> **Hermes 自帶兜底**：萬一 auxiliary model 出問題或額度耗盡（例如 HTTP 402），自動切換到備用模型或主模型，流程不會中斷。

**呢個對我哋極重要：**
- 我哋 M3 設定咗 `fallbacks: [deepseek-v4-flash, deepseek-v4-pro]`（已做）
- Hermes 嘅 auxiliary-level fallback 更加細緻：每個 auxiliary task **獨立** fallback chain

## 11 個任務的 Model 推薦速查

| Task | 推薦 Model | 理由 |
|------|-----------|------|
| Vision | `google/gemini-2.5-flash` | 必需，multimodal + cheap |
| Compression | `deepseek-v4` / `mimo-v2.5-pro` | cheap，效果 OK |
| Title Gen | 任何 Flash | 輕量到不行 |
| Web Extract | `grok-4.3`（X Premium） | page noise 處理強 |
| Profile Describer | `mimo` / `deepseek` | 描述類小模型夠 |
| **Triage Specifier** | `gpt-5.5` / `claude-opus` | **強推理** |
| **Kanban Decomposer** | 強模型 | 拆解錯全盤崩 |
| **Curator** | 強模型 | long-term skill 質素 |
| Approval | `mimo` / `deepseek` / auto | smart mode 輕量分類 |
| MCP | auto | 先觀察 |
| (第 11 個 truncated) | — | — |

## 對我哋嘅啟發

### 1. **直接影響 #120 Day 14 決策**
- 而家嘅 binary 選擇（M3 vs Flash）應該變成 **tiered decision**：
  - 預設 main = M3（深度推理）
  - **加 fallback policy**（已部分有）
  - **未來考慮**：加 auxiliary layer 處理特定任務（Compression / Vision / Triage）

### 2. **對應 AGENTS.md 既有架構**
- Hermes 嘅 Auxiliary Model = 我哋嘅 model config 仲未做嘅「per-task model」
- 我哋而家 SPAWN 全部用 M3 → 可以參考 Hermes 做法：
  - 短 task（Compression / Title Gen）→ Flash
  - 長 task（Triage / Kanban）→ M3

### 3. **Vision 強制配**
- 我哋而家 SPAWN sub-agent 用 M3（支援 multimodal），所以 Vision 唔係痛點
- 但如果**將來** flash-only sub-agent 開始多，要記得 Vision 必須配 multimodal model

### 4. **Fallback 機制可以加強**
- 而家 `agents.defaults.models` 有 1 個 main + 2 個 fallback
- 可以學 Hermes 做 **per-route fallback**（即係 SPAWN route 死咗，唔好跌去 main model，自動跌去另一個 sub-agent model）

## 啟發

呢篇文章直接解決咗我哋 #120 嘅 M3 vs Flash 二元困境。**答案唔係揀邊個，而係混用**：
- M3 = main agent（深度推理、複雜任務、triage、kanban）
- Flash = auxiliary（小任務、compression、quick lookups）
- 兩者配 fallback chain

呢個 insight 應該喺 #120 觀察期結束前 update 落 Day 14 template 嘅 recommendation section。

## Cross-links

- [[M3 1M Context 1.0實證]]
- [[M2.7→M3 Migration Audit Trail]]
- [[#120 SPAWN routing enforcement 觀察]]
- [[Hermes Agent Auxiliary Models Architecture]]
- [[OpenClaw model catalog 2026.6.1]]

## Source

- [X 文章原文](https://x.com/lonely__mh/status/2062368928148701584)
- [Hermes 官方配置文檔](https://hermes-agent.nousresearch.com/docs/user-guide/configuring-models)
- 作者前作（102K views）：[5/15 文章](https://x.com/Lonely__MH/status/2055156505796866407)
- 作者 Grok 接入教程：[5/17 文章](https://x.com/Lonely__MH/status/2055897167878033658)
