# Task: Critique Analysis of Two Deliverables

You are a critical reviewer. Assess consistency, completeness, and gaps between the following two deliverables.

## Deliverable 1: SKILL.md (kimi-deep-research)

```markdown
---
name: kimi-deep-research
description: "Use browser-automated Kimi Deep Research (kimi.com/deep-research) for multi-source, multi-phase research tasks that need breadth + synthesis."
---

# Kimi Deep Research

為需要多 sources、多輪分析、自動 synthesis 既 research tasks 而設。Kimi 自動 handle 搜索→深入搜索→數據可視化→結構化報告，我唔使插手。

## Trigger 條件

跨 sources 綜合分析、需要 synthesis 唔係 summary、數據可視化 → **Kimi**

簡單事實查詢、要精準 control scope/depth、敏感/內部數據、要可重複輸出 → **spawn MiniMax**

## Pricing（實測 2026-06-03）

| Feature | Free (Moderato) | Paid (Allegretto+) |
|---------|----------------|-------------------|
| 深度研究 | ✅ | ✅ |
| K2.6 Agent 集群 | ❌ Blocked | ✅ |
| K2.6 Agent / 思考 | ✅ | ✅ |

> Dami-Defi 話 Agent Swarm「free unlimited」係誤導。新用戶免費 tier 用唔到。

## Pre-flight Checklist（必 check 先開始）

- [ ] 個 topic 適合 web search？（內部/敏感數據 → 唔用）
- [ ] Browser tab 有冇舊 session？（先 close 以免撞 login）
- [ ] Google account 仲 login 緊？（睇右上角 avatar）
- [ ] 係咪用 Deep Research mode？（agent-swarm 係 paid）

## Workflow

### Step 0: Validation（開 browser 前做）

快速諗一諗：
- 個 topic 有冇敏感野？→ skip
- 之前 research 過類似野？→ wiki_search 先，避免 duplicate
- 其實 spawn MiniMax 仲快？→ 如果 scope 窄，spawn

### Step 1: Prompt

```
搜索 [specific sources]、[specific domains]
輸出結構化報告，包括 [data points]
全部用繁體中文
```

**策略：**
- 指明 sources → 避免 keyword drift（「de」會出法文 preposition）
- 指定語言 → Google 帳號 default 可能出簡中/英文
- 俾 scope 約束 → Kimi 會 over-scope
- 唔好 over-prompt → Deep Research 靠自由度 iteration

### Step 2: Clarifying Questions（必經）

Kimi 幾乎一定會問。預期：

| 問題 | 最佳答法 |
|------|---------|
| 報告用途？ | 零售策略/庫存管理/投資分析 — 揀一個 |
| 類別範圍？ | 珠寶級 only / 連工業用 |
| 歷史深度？ | 由邊年開始？ |

答法：**簡潔、肯定**。Kimi 需要 scope confirmation 先 run deep research。

### Step 3: Monitor

- Phase system（「Phase 1/8」）
- Search results streaming in
- Kimi's Computer panel shows current action

Wait for all phases to complete.

### Step 4: Output Validation（寫入前做）

**Quality gate checklist：**
- [ ] Report 完成咗？（睇到「全部文件」/ 完整報告）
- [ ] 語言啱？（繁體中文 / 英文）
- [ ] Charts 生成了？（有 Python charts output）
- [ ] 關鍵數據點合理？（一眼望有冇明顯異常）
- [ ] Sources 有 cites？（唔係憑空 output）

有問題 → 重新 prompt 修正，唔好直接寫入

### Step 5: Write to Knowledge Base

**分工明確：**

```
Obsidian（完整記錄）:
write_to_obsidian.js
- category: Business 或相關類別
- type: reference
- 包含：全文核心數據 + 詳盡分析 + 啟發 section
- tags: 最少 1 topic + 1 purpose
- cross-links: 連到相關 notes

Wiki（壓縮 synthesis）:
wiki_apply create_synthesis
- body: 只 keep 核心 findings + 數據點 + 結論
- sourceIds: 連到對應 Obsidian note
- Purpose: 快速 recall，唔係完整閱讀
```

**Output file checklist：**
- [ ] `write_to_obsidian` 成功（見到 ✅）
- [ ] `wiki_apply` 成功（見到「Refreshed N index files」）
- [ ] close browser tab

## Error Handling

| Failure | Action |
|---------|--------|
| Login expired | Re-login via Google OAuth |
| Deep Research blocked (paywall) | 轉 spawn MiniMax 做 research |
| Kimi server timeout | 等一陣 retry；如果 persistent → spawn MiniMax |
| Output 明顯錯/不完備 | 唔寫入，重新 prompt 或者手動修正 |
| Report 語言錯 | 重新 prompt 要求指定語言 |

## Pitfalls

- Data accuracy：Kimi cites sources 但 niche topics 會 hallucinate。關鍵決策前 verify 原始 sources
- 國外網站限速：Rapaport PDF、Statista 等等可能爬唔到 full content
- 敏感數據：唔好經 Kimi — 去 Moonshot AI servers
- Search quality：keyword 太短會 drift，加多啲 domain-specific terms
- Clarifying questions 唔答既話：Kimi 會停喺度唔繼續
```

## Deliverable 2: AGENTS.md SOP Entry

SOP table entry（newly added）:

| SOP | 位置 | 觸發條件 |
|-----|------|---------|
| Kimi Deep Research | browser open kimi.com/deep-research → login Google → prompt → handle clarify Qs → validation → write_to_obsidian + wiki_apply → close tab | SOP：需要多 sources 綜合研究 / 數據可視化 / multi-phase auto research |

## Analysis questions

1. Do the SKILL.md and AGENTS.md SOP entry reference each other？Are they consistent？
2. The SOP entry says "write_to_obsidian + wiki_apply" but doesn't mention quality gate (Step 4 in skill). Is this a gap？
3. The SKILL.md says Trigger 條件 while AGENTS.md says 觸發條件. Different wording for same concept — is this confusing？
4. The SKILL.md mentions "Pre-flight Checklist" that isn't referenced in the SOP. Does the SOP need updating？
5. The Error Handling table has 5 failures. The SOP has none — is the SOP too brief？
6. Overall：Are these two documents complementary or contradictory？

Be critical. Give specific improvement suggestions. Write your critique in Traditional Chinese (繁體中文).
