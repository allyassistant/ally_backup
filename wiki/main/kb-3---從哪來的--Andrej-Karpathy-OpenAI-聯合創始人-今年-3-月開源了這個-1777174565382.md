# 3️⃣ 從哪來的

Andrej Karpathy（OpenAI 聯合創始人）今年 3 月開源了這個項目。

原版設計：

• Agent 只能改一個文件：t

> 來源：🎓學習 Channel | 4/4/2026 下午8:14:39 | [原始訊息](https://discord.com/channels/1378455195360952420/1473382857949970515/1489961397592002732)

## 標籤

- #知識庫 #decision

## 摘要

3️⃣ 從哪來的

Andrej Karpathy（OpenAI 聯合創始人）今年 3 月開源了這個項目。

原版設計：

• Agent 只能改一個文件：`train.py`
• 每次訓練跑固定 5 分鐘
• 用 val_bpb（驗證集 bits per byte）做指標
• 漲了就保留，跌了就回滾

**效果：** 自動發現 20 個有效優化，沒有任何人工干預。

**實例：** Shopify CEO 用同樣模式優化 Liquid 模板引擎 → 93 次自動 commit，渲染速度快 53%，記憶體省 61%。

───

## 分類詳情

| 項目 | 值 |
|------|-----|
| Category | decision |
| Confidence | 40.0% |
| Source | learning |
| Priority | P0 |

## Claims

- 3️⃣ 從哪來的
- Andrej Karpathy（OpenAI 聯合創始人）今年 3 月開源了這個項目。
- 原版設計：
- • Agent 只能改一個文件：`train.py`
- • 每次訓練跑固定 5 分鐘
- • 用 val_bpb（驗證集 bits per byte）做指標
- • 漲了就保留，跌了就回滾
- **效果：** 自動發現 20 個有效優化，沒有任何人工干預。
- **實例：** Shopify CEO 用同樣模式優化 Liquid 模板引擎 → 93 次自動 commit，渲染速度快 53%，記憶體省 61%。
- ───

---

*自動攝入 | 2026-04-26 | Knowledge Base Ingester v2.4*
