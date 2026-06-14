---
id: 110
title: 企業 RAG 落地方案
status: active
priority: P2
created: 2026-05-17
---

# 企業 RAG 落地方案 - 從輕量級到大型企業四種 Implementation Plan

**Status:** active | **Priority:** P2 | **Due:** 無期限

---

## 目的

拆解點樣由零到一落地企業 RAG，按公司規模提供四個具體技術方案。唔係理論，係實際要做咩、用咩、注意咩。

## 背景

參考 @ma_zhenyuan 嘅 X thread「不做中转，不卖课，如何用 AI 月入 10万」，深入分析 enterprise RAG 嘅實際落地策略。

原文連結：https://x.com/ma_zhenyuan/status/2054024665652396142

## 技術分析

### 方案一：輕量級 RAG（適合 50-200 人公司）

**目標：** 快速驗證價值，成本 <$500/月，2-3 週上線

**Tech Stack：**
- Ingestion：自寫 Node.js/Python script 讀 Notion/Confluence/本地檔案
- Chunking：LangChain RecursiveCharacterTextSplitter（按段落 + 標題）
- Embedding：OpenAI text-embedding-3-small（$0.02/1M tokens）
- Vector DB：Supabase pgvector（免費 tier 夠用，500MB 向量）
- LLM：Claude / GPT-4o-mini

**實際要寫的 code：**
1. 一個 cron job 每夜 sync 文檔改動（用 Notion API / Confluence REST API）
2. Chunking 時保留 metadata（文檔標題、路徑、頁碼）
3. 查詢時行 hybrid search（vector + keyword BM25）
4. 答案一定要附來源連結

**常犯錯誤：**
- 直接用 sliding window 切 PDF → 跨頁斷句，答案錯
- 冇做 Rerank → Top-5 命中率得 30-40%
- 唔保留 metadata → AI 答「根據文檔顯示」但 user 睇唔到邊份

**成本估算：** ~$80-130/月

---

### 方案二：中型企業 RAG（200-1000 人）

**目標：** 多來源整合，繁體中文支援，Tier-2 accuracy

**Tech Stack：**
- Ingestion：自建 ETL pipeline（Python + Celery）
- Chunking：按文件類型寫 parser（python-pptx, PyMuPDF, openpyxl）
- Embedding：bge-large-zh-v1.5（自部署, 免費, 1024維）
- Vector DB：Milvus（自部署 或 Zilliz Cloud $200/月）
- Rerank：BAAI/bge-reranker-v2-m3（免費, 本地部署）
- LLM：DeepSeek-V3 / Qwen3-14B（自部署 或 API）
- Search：Elasticsearch（做 keyword fallback + hybrid）

**Chunking 實際方案（要寫 library 級別）：**
- PDF：PyMuPDF 提取文字+座標 → font size detect 標題層級 → hierarchy-aware chunking → 跨頁 merge
- Excel：openpyxl 讀取值+欄位名 → 每行轉 natural language sentence → 保留 sheet 名+表頭名
- 程式碼：tree-sitter AST 分析 function 邊界 → 每個 function = 1 chunk

**Rerank 一定要有：** 冇 rerank 嘅 RAG 係半成品

Benchmark 數據：
```
純 vector search Top-5: 42% accuracy
+ BM25 keyword: 55%
+ Rerank cross-encoder: 78%
+ Query rewriting: 83%
```

**成本估算：** ~$500-1500/月 | Dev time: 4-6 週

---

### 方案三：大型企業 RAG（1000+ 人，多部門）

**目標：** 99% 準確率，多語言，合規，審計追蹤

**Tech Stack：**
- Ingestion：Airbyte/Fivetran（結構化）+ 自建 pipeline（非結構化）
- Chunking：用 LLM 做 semantic chunking（唔用 heuristic）
- Embedding：微調 domain-specific embedding model
- Vector DB：Pinecone / Qdrant（horizontal scaling）
- Rerank：自訓練 domain-specific reranker
- LLM：混合路線——通用用 API，敏感用自部署
- Monitoring：LangSmith / LangFuse（trace each query）
- Security：VPC 部署，RBAC，audit log

**同中型的關鍵差異：**

1. **Semantic Chunking（唔係 rule-based）**
   用 LLM 判斷段落邊界，唔靠 regex / 字數。準確率高但慢。

2. **Multi-hop Retrieval**
   Agentic RAG，用 ReAct pattern 做 iterative retrieval。
   例：用戶問「上季同今季對比」，需要先檢索上季財務報告，再檢索今季，合併後做對比分析。

3. **Feedback Loop（最重要）**
   ```
   User query → RAG → Answer → User feedback → Log failure → Adjust → A/B test → Deploy
   ```
   冇 feedback loop 嘅 RAG 只會越來越差。

4. **Multi-modal Enterprise**
   - 合約掃描（OCR → 向量化 → 問答）
   - 組織架構圖（用多模態模型理解）
   - 白板/流程圖（圖片描述 → 向量化）

**成本估算：** ~$3000+/月 | Dev time: 8-12 週 MVP

---

### 方案四（最簡單起步）：用現成平台

| 產品 | 適合 | $ |
|------|------|---|
| Dify.ai | 中小型，快速 prototyping | 開源免費 / Cloud $59/月 |
| RAGFlow | 企業級中文 RAG，PDF 處理好 | 開源免費 |
| AnythingLLM | 個人/小團隊，一鍵部署 | 開源免費 |
| Verba (Weaviate) | 中大型，Weaviate 生態 | 開源免費 |

**注意：** 平台永遠解決唔晒 edge case，適合 POC 唔適合 production。

---

## 總結建議

| 場景 | 推薦方案 | Timeline | 預算 |
|------|---------|----------|------|
| <200 人公司 | 方案一 + 一個禮拜 MVP | 2-3 週 | $100/月 |
| 200-1000 人公司 | 方案二，先 POC 後 rollout | 4-6 週 | $500-1500/月 |
| 1000+ 人，合規要求高 | 方案三，分階段上 | 8-12 週 MVP | $3000+/月 |
| 想快出 value 唔想煩 infra | 方案四 Dify/RAGFlow | 1-2 週 | $0-59/月 |

## 最 common 的死法

1. 花 2 個月建完美 pipeline → 用戶已經唔等得，放棄用
2. 唔做 feedback collection → 永遠唔知錯邊度
3. 用 general chunking 處理 PDF → 問「上季 sales」答唔出
4. 冇 rerank → 準確率卡喺 50%，用戶覺得「不如自己 Google」

要快、要準、要 loop，缺一不可。

## Links

- X thread: https://x.com/ma_zhenyuan/status/2054024665652396142
- Discord 討論: #🧑🏻‍💻編程 channel

---

*Created: 2026-05-17 | Author: Ally*
