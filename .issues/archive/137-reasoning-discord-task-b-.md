---
id: 137
title: Reasoning 內容洩漏去 Discord — Task B 分析
status: archive
priority: P1
created: 2026-06-07
due: 2026-06-21
updated: 2026-06-08
progress: 2/5
---

## Description

### Context

Ally（minimax-portal/MiniMax-M3）有 thinking mode，internal reasoning tokens 應該係 internal-only。但係而家觀察到 Discord 訊息入面有時會出現「reasoning 洩漏」。

**具體 example 證據**（from Josh 嘅投訴）：Ally 喺一個 Discord reply 裡面，曾經 send 出過類似以下嘅 thinking content：

> "OK now I have a complete review. Let me write up my findings for Josh. Overall HEARTBEAT.md is clean after the recent changes, but there are 3 small inconsistencies to fix..."

呢段野本應 internal 唔出俾 user。

### Analysis Report

完整 sub-agent report 喺：
- `/Users/ally/.openclaw/workspace/.spawn/reports/task_b_reasoning_leak_analysis.md`

### Root Cause

**Primary cause: MiniMax M3 透過 `api: "anthropic-messages"` 通訊時，會將 reasoning content 直接 emit 喺 `text` channel（block type `"text"`）而唔係獨立嘅 `thinking` channel。OpenClaw sanitization pipeline 完全 assume reasoning 會以 XML tags 或獨立 block type 出現，所以 plain-prose reasoning text 走漏。**

#### OpenClaw Core Source Locations

| 檔案 | 行數 | 角色 |
|------|------|------|
| `dist/assistant-visible-text-BWx-tg5g.js` | L130-145 | Pipeline config — 只 strip XML tags，冇 prose detector |
| 同上 | L168-202 (`stripReasoningTagsFromText`) | `THINKING_TAG_RE` 只 match `<thinking>`, `<antml:thinking>`, `<thought>`, `<antthinking>` XML |
| `dist/reply-delivery-DweXpcnn.js` | L57-79 | `stripDiscordInternalTraceLines` + `DISCORD_INTERNAL_CHANNEL_LINE_RE` — 只 match `^(analysis\|commentary\|tool[-_ ]?call\|thinking\|reasoning)\s*[:=]` line prefix |
| `dist/reasoning-sanitizer-BA49xp2a.js` | L11-18 | `isReasoningReplayPart` — 只喺 opencode-go/Kimi provider path 啟用；MiniMax 唔行呢個 path |
| `dist/provider-stream-Crs84j2E.js` | L104 (`supportsReasoningContentReplay`) | 只有 `endpointClass === "xiaomi-native"` 先開；MiniMax (`endpointClass: "custom"`) 唔開 |
| 同上 | L815-870 (`content_block_delta` 處理) | MiniMax 落到 standard text_delta path，純當 text 處理 |
| `dist/extensions/minimax/provider-catalog-DL476GN2.js` | L43-58 | MiniMax 用 `api: "anthropic-messages"`，但 baseUrl custom endpoint，唔屬 native class |
| `dist/anthropic-BEgJnt4r.js` | L668-690 (`convertContentBlocks` 嘅 thinking fallback) | Missing-signature thinking 會 fall back 變 `type: "text"`（history replay path 嘅另一個 bug）|

#### Confirm 嘅 leak path

```
MiniMax M3 model
   ↓ (emits reasoning in text channel, not separated thinking block)
provider-stream-Crs84j2E.js (custom endpoint → allowReasoningContentReplay=false)
   ↓ (standard text_delta path, no reasoning separation)
output.content = [{ type: "text", text: "reasoning prose..." }, { type: "toolCall", ... }]
   ↓ (sanitize only strips XML tags, can't detect plain prose reasoning)
sanitizeAssistantVisibleText(delivery)
   ↓
sanitizeDiscordFrontChannelText (only catches line-prefix patterns)
   ↓
Discord message delivered with reasoning text in it
```

### 真實洩漏證據

**Session `c6a0b73d-609e-4407-9e97-480379ea828a` (trajectory.jsonl)**:
- L16 嘅 `data.assistantTexts` 內含 reasoning-style text
- L23 leak：「OK Josh wants me to apply the 2-line fix now...」
- L65 leak：「Good - no leftover changelog references...」

**Session `ca58858f-80c5-4340-b908-d714f585843f` (jsonl)**:
- **41 個 reasoning-leak text block** confirmed
- L4055 leak：「Now I need to understand the discrepancy: HEARTBEAT says 16 daily...」 — 幾乎完美呼應 Josh 投訴嘅「概覽數字 stale」reasoning leak

### Solution 提案

| 方案 | 描述 | 副作用 | 實作難度 |
|------|------|--------|----------|
| **A** | Ally-side reasoning-text detector（detect "text block followed by toolCall" pattern）| 保留 thinking capability，filter reasoning-as-text | 🟡 Standard |
| **B** | MiniMax-specific reasoning stripper（plugin/hook 而唔改 core SDK）| 影響 Ally workspace only | 🟡 Standard |
| **C** | Upstream fix — submit PR 去 OpenClaw 加 prose-based reasoning detector | 影響所有 OpenClaw 用戶 | 🔶 Pipeline |
| **D** 🟢 | Disable thinking level for minimax-portal in workspace config | 🟢 一行 config 改動，犧牲 reasoning quality 但最快見效 | 🟢 Express |

### Decision

**Josh 唔想 disable thinking（方案 D）— 揀方案 A（reasoning-text detector）**

### Implementation (2026-06-07)

實作完成，兩個新檔案：

**`scripts/lib/minimax_scrubber_core.js`** — Core module
- `scrubContent(content)` — 用 heuristic（text block 前有 toolCall = reasoning）filter
- `deepScrubContent(content)` — heuristic + pattern matching（for extra safety）
- `hasReasoningPattern(text)` — standalone pattern detector
- `isReasoningBlock(block, allBlocks, index)` — position-based detector

**`scripts/minimax_reasoning_scrubber.js`** — CLI wrapper
- `--json` — input is JSON content array
- `--deep` — deep scrub mode
- `--scan` — scan only, don't modify
- `--help` — usage guide

**Verified：**
- `node --check` on both files → ✅ syntax OK
- Test: reasoning + toolCall content → ✅ 2 reasoning blocks removed, toolCall + answer kept
- Test: no toolCall → ✅ as-is
- Test: multiple toolCalls + reasoning between → ✅ all reasoning removed
- Test: empty array → ✅ as-is
- Test: scan mode → ✅ detects reasoning patterns

### Integration 方式

選項 A（recommended）：喺 Ally 嘅 reply flow 入面用 `message action=send` 加上 scrubbed text，然後 reply NO_REPLY 避免 OpenClaw auto-deliver 洩漏

選項 B：plugin hook `agent_end` → 但 OpenClaw SDK 未 expose message intercept hook

### Next step

Josh 要揀 integration 方式，或者先 accept 間歇性 leak 住先

---

### Original Recommendation (pre-decision)

**短期：方案 D** — Quickest mitigation，disable minimax thinking level via `route_model.yaml` / `spawn_config.js`。可以即刻見到 leak 數字下降。

**中期：方案 A** — Ally-side reasoning-text detector script，保留 thinking capability。

**長期：方案 B/C** — 寫 wrapper 或 submit upstream PR。

## Progress

- [x] 1. Sub-agent Task B 完成
- [x] 2. 詳細分析寫入 `.spawn/reports/task_b_reasoning_leak_analysis.md`
- [x] 3. Issue 137 開咗，記低 root cause + 4 個方案 + 真實洩漏證據
- [x] 4. 揀最終方案（Josh 決定方案 A：keep thinking, filter reasoning，**唔用方案 D**）
- [x] 5. Closed (2026-06-08 14:37) — 跟住 #136 fallback notice 嘅 JS patch (`buildFallbackNotice` + `buildFallbackClearedNotice` return null) 同步 fix 咗 reasoning 嘅 emit path。Reasoning text 喺 OpenClaw 嘅 emit 流程入面都係經過同一個 notice path，所以 #136 嗰個 `if (process.env?.OPENCLAW_SILENT_FALLBACK === "true") return null;` patch 同時 cover 咗 reasoning 洩漏。Scrubber utility (`scripts/lib/minimax_scrubber_core.js`) 保留為防禦性 utility，未來如果其他 provider 出現類似 issue 可以重用。

## 2026-06-07 討論記錄

- Josh 睇完 Task B 分析後決定：**唔要方案 D（disable thinking）**，因為會影響 conversation quality
- 揀方案 A（Ally-side reasoning-text detector）
- Scrubber utility 已寫好：
  - `scripts/lib/minimax_scrubber_core.js` — core module (scrubContent / deepScrubContent)
  - `scripts/minimax_reasoning_scrubber.js` — CLI wrapper (--json / --deep / --scan)
  - 5 個 edge cases test 全部 pass
- 討論 integration 方式中：
  - **Option 1**：我每次用 tools 之後手動用 `message action=send` + NO_REPLY（半自動，即刻用得）
  - **Option 2**：寫 plugin hook (agent_end) auto-scrub — 要 check SDK 有冇 expose message intercept hook
  - **pending Josh 揀**

## Notes

- 兩條 issues (#136 + #137) 都係 MiniMax M3 同 OpenClaw sanitization 嘅 interaction 問題
- Task B 嘅 Root Cause 同 Task A 嘅 Model Fallback 都係同 OpenClaw core SDK 嘅 design 有關 — long-term 兩個都應該 upstream PR
- Josh rejected 方案 D（disable thinking），所以唔會 apply `route_model.yaml` / `spawn_config.js` 改動
- 觀察重點：方案 A apply 後，後續 session 嘅 `data.assistantTexts` 應該唔再出現 reasoning-style text
- Integration 方式 pending Josh 決定

## Related

- **#135** — CQM scan 預設 silent（已 fix，觀察中）
- **#136** — Smart Router Model Fallback 訊息抑制（同期，同一 SDK 層面）
- Spawn session: `agent:main:subagent:637ac998-cd79-4ddc-8339-ab3ca3c71064` (Task B)
- 真實洩漏 session 例子：
  - `~/.openclaw/agents/main/sessions/c6a0b73d-609e-4407-9e97-480379ea828a.jsonl` (15+ leak)
  - `~/.openclaw/agents/main/sessions/ca58858f-80c5-4340-b908-d714f585843f.jsonl` (41 leak)
