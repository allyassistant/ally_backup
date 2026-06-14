---
pageType: source
id: source.article-1780092074920
title: | 查詢方式 | CLI / Tool Call | Context Engine Slot |
sourceType: discord
sourceUrl: https://discord.com/channels/1378455195360952420/1473382857949970515/1505633637746343997
ingestedAt: 2026-05-29T22:01:14.920Z
updatedAt: 2026-05-29T22:01:14.920Z
status: active
tags: [decision, ingested]
---

# | 查詢方式 | CLI / Tool Call | Context Engine Slot |

> 原始訊息：🎓學習 Channel | [link](https://discord.com/channels/1378455195360952420/1473382857949970515/1505633637746343997)

| 查詢方式 | CLI / Tool Call | Context Engine Slot |
| 適用場景 | 新 Agent 接手舊客戶 / 跨日任務 | 長對話 > 50 輪 / 回溯舊訊息 |

**5. 5 層診斷框架 — Agent 忘記時逐層檢查**

① Capture（事實有無入到系統？）
② Lossless（對話有無被壓縮食咗？）
③ GBrain（跨對話可唔可以 query？）
④ Ranking（正確事實有無排到頂？）
⑤ Task（當前任務有無比 Agent 理解點解呢個事實重要？）

> 好多 bug 其實喺第 3 或第 4 層，唔係頭兩層。

---

### 3️⃣ 同我地系統的直接關係

---

*自動攝入 | 2026-05-29 | Knowledge Base Ingester v2.4*
