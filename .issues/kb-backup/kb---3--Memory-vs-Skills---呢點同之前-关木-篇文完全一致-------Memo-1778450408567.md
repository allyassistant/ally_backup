# Issue: 3. Memory vs Skills   呢點同之前 关木 篇文完全一致：  •   Memory   = fac

## 基本資訊

- **ID:** kb-1778450408567
- **來源:**  🎓學習 Channel
- **創建日期:** 2026-05-10
- **分類:** decision
- **狀態:** Active

## 目的

自動從學習 Channel 分類出的決策事項

## 背景資料

**3. Memory vs Skills**
呢點同之前 关木 篇文完全一致：

• **Memory** = facts（user prefers uv, machine is a DGX Spark）→ what is true?
• **Skills** = procedures（how to benchmark vLLM, how to deploy）→ how do we do this again?

"If a workflow takes 5+ steps and you'll repeat it, save it as a skill. That's how the agent compounds: not by having one infinite chat, but by accumulating reusable procedures."

**4. 問 artifacts，唔好問 markdown 牆**
Agent 而家可以產出 spec、plan、code review、research report、diagram、dashboard。300 行 markdown plan 理論上有用，但你唔會仔細睇。叫 agent 產 HTML artifact：有 table、color、layout、SVG diagram、tabs、collapsible sections。

"Markdown is good for writing. HTML is better when the agent needs to show you a system."

**5. 關鍵區分：長 session 會腐爛**
唔係因為模型變蠢，係因為 context 愈來愈嘈。舊假設 linger，大 tool output 堆疊，有用既嘢被埋沒。Hermes 有 `/compress` — 唔止慳 token，係保持 working memory 乾淨。作者話呢個係最被低估既習慣。

3️⃣ 全部 15 個 tips 快速一覽

## 推理

技術關鍵詞匹配 x2 | 趨勢關鍵詞匹配 x2 | 決策關鍵詞匹配 x5 | 來源: learning | 分類: decision

## 連結

- Discord: https://discord.com/channels/1378455195360952420/1473382857949970515/1503024440710008947

---

*自動創建 | 2026-05-10 | Knowledge Base Ingester v2.4*
