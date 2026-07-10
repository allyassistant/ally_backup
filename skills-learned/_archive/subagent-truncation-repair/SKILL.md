---
name: subagent-truncation-repair
description: 修復被截斷（truncated）嘅 skill file — 識別截斷訊號、派 sub-agent 補完內容、通過 validation gate
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-08T12:01:12.068Z
---

## Workflow

1. **識別截斷訊號**
   - 經典訊號：`Script 結構：`、`## Pitfalls` 缺失、`generatedAt` 停在舊時間
   - 徵狀：file size 異常小（<1500B）、step N 以 colon `：` 結尾、steps 5+ 完全缺失
   - 確診：read 個 file 確認長度 + 內容

2. **派 M3 Sub-agent 修復**
   - Spawn depth 1/1 sub-agent（M3 thinking-high）
   - Task：
     a. 讀取被截斷嘅 SKILL.md
     b. 識別截斷位置（colon / 句末 / 步驟缺失）
     c. 補完截斷嘅 step（N），替換 dangling colon 為完整 template/code block
     d. 補完缺失嘅 steps（N+1, N+2...）
     e. 加入 `## Pitfalls` section（≥5 items）
     f. 更新 `generatedAt` 為 current ISO timestamp
   - `result auto-announce` to requester，唔 busy-poll

3. **驗證修復結果**
   - File size ≥3000B
   - 執行 `node scripts/validate_skill_file.js <path>` → exit 0
   - 確認 `## Pitfalls` 存在於 `## Workflow` 之後（順序：Workflow → Pitfalls）

4. **如 validation fail**
   - 讀取 error output
   - 直接 edit 修復常見問題（frontmatter、size、wikilinks）
   - 重新執行 validation

## Pitfalls

- **唔好 overwrite 原有 steps 1-3** — sub-agent 讀取後要原封不動保留已完成嘅步驟，只修補截斷位置之後嘅內容
- **避免二次截斷** — 補完時要確保每個 step 有實質內容，唔好喺 colon 後留空；template block 要完整（shebang → help → parseArgs → main → .catch）
- **generatedAt 要更新** — 如果唔更新，validation 可能 fail；且 agent 會以為係舊 skill
- **Pitfalls 位置** — 必須喺 `## Workflow` 之後，唔係之前；順序錯誤 validation 會 fail
- **Truncation detector 要 scan 整個 file** — 有啲截斷唔喺句末，而係喺 step 中間（`fs`、`path` 呢類關鍵詞被 cut）；要睇行尾係咪完整句子
