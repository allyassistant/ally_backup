---
name: rapaport-email-summary
description: 從 Rapaport 電郵提取價格信號、市場評論、行業新聞和 RAPI 趨勢，並用廣東話產生簡潔總結
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-13T19:31:05.000Z
---

## Workflow

1. **擷取電郵關鍵內容** — 從電郵標題和正文提取：價格變動（有冇變化）、RAPI 指數（各 carat 類別百分比）、市場新聞（展會、品牌、庫存）、特別報導（interview、analysis）、行業趨勢信號。

2. **按 carat 類別組織 RAPI 數據** — 將 0.30ct、0.50ct、1ct、3ct 等變化整理成清晰列表。注意：positive percentage = 價格上升（需求增加/庫存減少），negative = 價格下跌。

3. **識別市場趨勢敘事** — 連結 RAPI 變化與新聞內容（例如：「小鑽價格上升」對應「庫存下降 + 品牌趁低吸納」），形成完整市場 picture。

4. **用廣東話撰寫 2-3 句總結（≤100 字）** — 先講價格變動，再講市場趨勢，最後係特別亮點。句式要口語化廣東話（唔好書面語）。

5. **格式範例輸出**：
