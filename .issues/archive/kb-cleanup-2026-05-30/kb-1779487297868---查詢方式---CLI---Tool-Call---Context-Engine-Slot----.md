---
id: kb-1779487297868
title: "| 查詢方式 | CLI / Tool Call | Context Engine Slot | | 適用場景 | 新"
status: active
priority: P3
created: 2026-05-22
---

# Issue: | 查詢方式 | CLI / Tool Call | Context Engine Slot | | 適用場景 | 新

## 基本資訊

- **ID:** kb-1779487297868
- **來源:**  🎓學習 Channel
- **創建日期:** 2026-05-22
- **分類:** decision
- **狀態:** Active

## 目的

自動從學習 Channel 分類出的決策事項

## 背景資料

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

## 推理

技術關鍵詞匹配 x2 | 決策關鍵詞匹配 x3 | 來源: learning | 分類: decision

## 連結

- Discord: https://discord.com/channels/1378455195360952420/1473382857949970515/1505633637746343997

---

*自動創建 | 2026-05-22 | Knowledge Base Ingester v2.4*
