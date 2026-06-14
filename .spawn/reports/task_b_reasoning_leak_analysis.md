# Task B Report: Reasoning / Thinking 內容洩漏去 Discord 訊息

## 1. Root Cause (確認)

**Primary Cause: MiniMax M3 model 透過 `api: "anthropic-messages"` 通訊時，會將 reasoning content 直接 emit 喺 `text` channel（block type `"text"`）而唔係獨立嘅 `thinking` channel。OpenClaw 嘅 sanitization pipeline 完全 assume reasoning 會以 XML tags 或獨立 block type 出現，所以 plain-prose reasoning text 走漏。**

### 關鍵 OpenClaw source location

| 檔案 | 行數 | 角色 |
|------|------|------|
| `assistant-visible-text-BWx-tg5g.js` | L130-145 | Pipeline config — 只 strip XML tags，冇 prose detector |
| 同上 | L168-202 (`stripReasoningTagsFromText`) | 只 match XML tags，唔識 plain prose |
| `reply-delivery-DweXpcnn.js` | L57-79 | `stripDiscordInternalTraceLines` 只 match line prefix pattern |
| `reasoning-sanitizer-BA49xp2a.js` | L11-18 | 只喺 opencode-go/Kimi provider path 啟用；MiniMax 唔行呢個 path |
| `provider-stream-Crs84j2E.js` | L104 | `supportsReasoningContentReplay` — 只有 `xiaomi-native` 先開；MiniMax (`custom`) 唔開 |
| 同上 | L815-870 | content_block_delta 處理 — MiniMax 落到 standard text_delta path，純當 text 處理 |
| `extensions/minimax/provider-catalog-DL476GN2.js` | L43-58 | MiniMax 用 `api: "anthropic-messages"`，但 baseUrl custom endpoint |
| `anthropic-BEgJnt4r.js` | L668-690 | convertContentBlocks — missing-signature thinking 會 fall back 變 `type: "text"` |

### Confirm 嘅 leak path

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

### 真實洩漏證據（session log confirmed）

Session `c6a0b73d-609e-4407-9e97-480379ea828a` 嘅 trajectory 紀錄中至少有 15+ 個 reasoning-leak text block，包括 Josh 投訴嘅「概覽數字 stale」相關 reasoning。Session `ca58858f` 有 41 個 reasoning-leak text blocks。

## 2. Solution 提案

### 方案 A (🟡 Standard)：Ally-side reasoning-text detector
→ 寫 `scripts/minimax_text_leak_detector.js`，喺 reply pipeline insert detector
→ 保留 thinking capability，filter reasoning-as-text
→ Scope: Ally workspace only

### 方案 B (🟡 Standard)：MiniMax-specific reasoning stripper
→ 寫 script scan text block detect reasoning patterns
→ 用 plugin/hook 插入 reply 路徑
→ Scope: Ally workspace only

### 方案 C (🔶 Pipeline)：Upstream fix
→ Submit issue/PR 去 OpenClaw 加 prose-based reasoning detector
→ 影響所有 provider，最乾淨
→ Scope: 需 OpenClaw core 改動

### 方案 D (🟢 Express, quickest)：Disable thinking level for minimax
→ 改 `spawn_config.js` / `route_model.yaml` 一個配置
→ 犧牲 reasoning quality 但最快見效

## 3. Recommendation

**短期：方案 D** — 最快 mitigation，一行 config 改動
**中期：方案 A** — 保持 reasoning 能力但 filter leak
**長期：方案 B/C** — upstream fix
