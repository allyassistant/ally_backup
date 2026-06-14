# OpenClaw 知識庫系統 (NotebookLM 風格)

## 系統架構圖

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw Gateway                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐      │
│  │   Input      │   │   Process    │   │   Output     │      │
│  │   Layer      │   │   Layer      │   │   Layer      │      │
│  └──────────────┘   └──────────────┘   └──────────────┘      │
│         │                  │                  │                 │
│  ┌──────┴──────┐   ┌──────┴──────┐   ┌──────┴──────┐        │
│  │ Sitemap     │   │ Crawler     │   │ Q&A         │        │
│  │ Fetcher     │──▶│ Engine      │──▶│ Generator   │        │
│  └─────────────┘   └─────────────┘   └─────────────┘        │
│         │                  │                  │                 │
│  ┌──────┴──────┐   ┌──────┴──────┐   ┌──────┴──────┐        │
│  │ URL         │   │ Dedupe      │   │ Audio        │        │
│  │ Queue       │   │ Cleaner     │   │ (TTS)        │        │
│  └─────────────┘   └─────────────┘   └─────────────┘        │
│         │                  │                  │                 │
└─────────│──────────────────│──────────────────│─────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
    [Web Sites]      [SQLite DB]        [User Output]
    [Sitemaps]      [Vector Index]      [Q&A/Audio/Notes]
```

---

## 第一部分：自動抓取系統

### 1.1 Sitemap 抓取模組

```javascript
// scripts/sitemap_fetcher.js
const fs = require('fs');
const path = require('path');

class SitemapFetcher {
  constructor(config) {
    this.targetUrl = config.targetUrl;      // e.g., 'https://docs.openclaw.ai'
    this.concurrent = config.concurrent || 3;
    this.delay = config.delay || 1000;      // ms between requests
  }

  async fetch() {
    // 1. 嘗試 fetch sitemap.xml
    const sitemapUrls = [
      `${this.targetUrl}/sitemap.xml`,
      `${this.targetUrl}/sitemap-index.xml`
    ];

    for (const url of sitemapUrls) {
      const response = await fetch(url);
      if (response.ok) {
        return this.parseSitemap(await response.text());
      }
    }

    // 2. 如果冇 sitemap，用 crawl alternative
    return await this.crawlAlternative();
  }

  parseSitemap(xml) {
    const urls = [];
    const urlMatches = xml.matchAll(/<loc>(.*?)<\/loc>/g);
    for (const match of urlMatches) {
      urls.push(match[1]);
    }
    return urls;
  }

  async crawlAlternative() {
    // 從首頁開始，逐步抓取所有連結
    // 使用 BFS (Breadth-First Search)
  }
}

module.exports = SitemapFetcher;
```

### 1.2 內容過濾規則

```javascript
// config/content_filters.js
module.exports = {
  // 要抓取既 URL patterns
  include: [
    /docs\//,           // 文檔頁面
    /blog\//,           // 博客文章
    /guide\//,          // 指南
    /tutorial\//,       // 教程
    /reference\//,      // 參考文檔
  ],

  // 跳過既 URL patterns
  exclude: [
    /\/tag\//,          // 標籤頁面
    /\/category\//,     // 分類頁面
    /\/page\/\d+/,      // 分頁
    /\/author\//,       // 作者頁面
    /\.pdf$/,           # PDF (另外處理)
    /\/api\//,          # API endpoints
    /\/admin/,          # Admin 頁面
  ],

  // 文件類型優先級
  priority: {
    '.md': 10,           // Markdown - 最高優先
    '.html': 8,          # HTML
    '.txt': 6,           # Text
  },

  // 最大深度
  maxDepth: 5,

  // 每個 domain 最大 URL 數
  maxUrlsPerDomain: 1000,
};
```

---

## 第二部分：內容處理流程

### 2.1 數據清洗模組

```javascript
// scripts/content_cleaner.js
class ContentCleaner {
  clean(html) {
    return {
      // 移除 script, style, nav, footer, header
      content: this.removeNoise(html),
      // 提取 title
      title: this.extractTitle(html),
      // 提取 meta description
      description: this.extractMeta(html, 'description'),
      // 提取發布日期
      date: this.extractDate(html),
      // 提取作者
      author: this.extractAuthor(html),
    };
  }

  removeNoise(html) {
    // 使用 DOM parser 移除：
    // - <script>, <style>, <nav>, <footer>, <header>
    // - 廣告 elements
    // - 社交分享 buttons
    // - 訂閱 forms
    // 保留主要內容 (<main>, <article>, <content>)
  }

  deduplicate(urls, contentMap) {
    // 1. URL 級別去重 (path 最後 slash 既)
    // 2. 內容級別去重 (simhash 或 md5)
    // 3. 翻譯版本檢測 (中英文同時存在)
  }
}
```

### 2.2 分塊 (Chunking) 策略

```javascript
// scripts/chunker.js
class Chunker {
  constructor(config = {}) {
    this.maxTokens = config.maxTokens || 400;
    this.overlap = config.overlap || 80;
    this.preserveStructure = config.preserveStructure || true;
  }

  chunk(content) {
    // 策略：
    // 1. 先按結構 (h1, h2, h3) 分割
    // 2. 每個區塊如果太大，再按段落分割
    // 3. 重疊 overlap 既 tokens 保持連貫性

    return chunks;
  }

  // 輸出格式：
  // {
  //   id: "doc1-chunk-001",
  //   content: "...",
  //   tokens: 350,
  //   heading: "主要標題",
  //   path: ["# 主要標題", "## 小節"],
  // }
}
```

---

## 第三部分：存儲架構

### 3.1 SQLite 數據庫設計

```sql
-- knowledge_base.db

-- 源文檔表
CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  title TEXT,
  description TEXT,
  author TEXT,
  published_at DATETIME,
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  content_hash TEXT,
  content TEXT,           -- 清洗後既原文
  word_count INTEGER,
  language TEXT,
  domain TEXT,
  status TEXT DEFAULT 'pending',  -- pending, indexed, error
  error_message TEXT
);

-- 分塊表
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES sources(id),
  chunk_index INTEGER,
  content TEXT,
  heading TEXT,
  path TEXT,              -- JSON array of headings
  tokens INTEGER,
  embedding BLOB,         -- vector embedding
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 標籤/分類表
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE source_tags (
  source_id TEXT REFERENCES sources(id),
  tag_id INTEGER REFERENCES tags(id),
  PRIMARY KEY (source_id, tag_id)
);

-- 搜索歷史 (可選)
CREATE TABLE search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT,
  results_count INTEGER,
  searched_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_sources_domain ON sources(domain);
CREATE INDEX idx_sources_status ON sources(status);
CREATE INDEX idx_chunks_source ON chunks(source_id);
CREATE VIRTUAL TABLE chunks_fts USING fts5(content, content=chunks, content_rowid=rowid);
```

### 3.2 向量搜索

```javascript
// scripts/vector_store.js
class VectorStore {
  constructor() {
    // 使用 sqlite-vec 或 node-llama-cpp
    this.dimension = 1024;  // OpenAI text-embedding-3-small
  }

  async embed(text) {
    // 調用 embedding API
    // OpenAI: text-embedding-3-small
    // 或本地: Ollama, LM Studio
  }

  async addChunk(chunk) {
    const embedding = await this.embed(chunk.content);
    await db.query(
      'INSERT INTO chunks (id, source_id, ..., embedding) VALUES (?, ?, ..., ?)',
      [chunk.id, chunk.source_id, ..., embedding]
    );
  }

  async search(query, topK = 10) {
    const queryEmbedding = await this.embed(query);
    // Cosine similarity search
    // 返回 topK most similar chunks
  }
}
```

---

## 第四部分：自動化流程

### 4.1 Cron 調度配置

```json
// ~/.openclaw/openclaw.json
{
  "automation": {
    "knowledgeBase": {
      "enabled": true,
      "schedules": {
        // 每日凌晨 2 點更新知識庫
        "fullSync": {
          "cron": "0 2 * * *",
          "action": "fullSync",
          "targets": ["docs.openclaw.ai", "github.com/allyassistant"]
        },
        // 每 6 小時增量更新
        "incrementalSync": {
          "cron": "0 */6 * * *",
          "action": "incrementalSync",
          "targets": ["docs.openclaw.ai"]
        },
        // 每週日清理過期內容
        "cleanup": {
          "cron": "0 3 * * 0",
          "action": "cleanup"
        }
      }
    }
  }
}
```

### 4.2 完整同步流程

```javascript
// scripts/knowledge_sync.js
async function fullSync(config) {
  const targets = config.targets;

  for (const target of targets) {
    console.log(`[Sync] Starting sync for ${target}`);

    // 1. 抓取 Sitemap
    const fetcher = new SitemapFetcher({ targetUrl: target });
    const urls = await fetcher.fetch();

    console.log(`[Sync] Found ${urls.length} URLs`);

    // 2. 過濾 URLs
    const filtered = contentFilter.filter(urls);
    console.log(`[Sync] ${filtered.length} URLs after filtering`);

    // 3. 批量抓取內容 (並發控制)
    const contents = await batchFetch(filtered, {
      concurrency: 3,
      delay: 1000
    });

    // 4. 清洗與去重
    const cleaner = new ContentCleaner();
    const cleaned = await cleaner.deduplicate(contents);

    console.log(`[Sync] ${cleaned.length} content after dedup`);

    // 5. 分塊
    const chunker = new Chunker();
    const chunks = cleaned.flatMap(c => chunker.chunk(c));

    // 6. 存入數據庫 + 生成 embedding
    const store = new VectorStore();
    for (const chunk of chunks) {
      await store.addChunk(chunk);
    }

    console.log(`[Sync] Added ${chunks.length} chunks`);
  }
}
```

---

## 第五部分：用戶介面

### 5.1 可用既輸出格式

| 格式 | 生成方式 | 用途 |
|------|---------|------|
| **Q&A** | 用戶問問題 → search → generate answer | 學習、解答 |
| **Summary** | 用 LLM 总结整個 source | 快速理解 |
| **Audio** | 用 TTS 生成音頻 | 聽覺學習 |
| **Flashcards** | 用 LLM 生成問答卡 | 記憶複習 |
| **Mind Map** | 用 LLM 提取結構化資訊 | 視覺化 |
| **Quiz** | 用 LLM 生成測驗題 | 自測 |

### 5.2 示例命令

```bash
# 添加一個知識源
openclaw knowledge add https://docs.openclaw.ai

# 查詢
openclaw knowledge query "OpenClaw 既 memory system 點運作？"

# 生成總結
openclaw knowledge summarize docs.openclaw.ai/concepts/memory

# 生成音頻 (用 TTS)
openclaw knowledge audio docs.openclaw.ai/concepts/memory --voice nova

# 生成閃卡
openclaw knowledge flashcards docs.openclaw.ai/concepts/memory

# 查看狀態
openclaw knowledge status
```

---

## 第六部分：推薦抓取既內容

### 6.1 高價值目標

| 類型 | 示例 | 價值 |
|------|------|------|
| **官方文檔** | docs.openclaw.ai | 技術準確性 100% |
| **API Docs** | platform.opencl.ai/api | 開發必備 |
| **GitHub** | github.com/openclaw/openclaw | 最新功能 |
| **Blog** | 技術博客、產品更新 | 趋势分析 |
| **論文** | ArXiv、Papers | 深度研究 |

### 6.2 優先級配置

```json
// config/knowledge_priorities.json
{
  "priorities": [
    {
      "name": "OpenClaw Official",
      "domains": ["docs.openclaw.ai", "github.com/openclaw"],
      "syncFrequency": "daily",
      "priority": 1
    },
    {
      "name": "AI/ML Research",
      "domains": ["arxiv.org", "paperswithcode.com"],
      "syncFrequency": "weekly",
      "priority": 2
    },
    {
      "name": "Tech News",
      "domains": ["techcrunch.com", "theverge.com"],
      "syncFrequency": "daily",
      "priority": 3
    }
  ]
}
```

---

## 第七部分：與現有系統既整合

### 7.1 現有能力對應

| NotebookLM 功能 | OpenClaw 實現方式 |
|---------------|------------------|
| Source 導入 | Sitemap Fetcher + Crawler |
| 問答 | memory_search + LLM |
| Audio Overview | TTS tool |
| 學習路徑 | LLM 生成結構化內容 |
| Flashcards | LLM 生成 Q&A |

### 7.2 整合現有 Scripts

可以重用既現有腳本：
- `web_fetch` - 抓取網頁
- `browser` - 動態內容抓取
- `memory_search` / `memory_get` - 檢索
- `tts` - 音頻生成

---

## 總結

呢個架構可以做到：

1. **全自動** - Cron job 定期更新，唔使人手
2. **智能過濾** - 自動去重複、清理無關內容
3. **向量搜索** - 語義搜尋，唔怕關鍵字唔啱
4. **多種輸出** - Q&A、Audio、Flashcards、Mind Map
5. **本地存儲** - 數據唔使上雲，100% 私隱

**下一步：**
- 選擇性implement 部分功能
- 先從簡單既 Sitemap Fetcher + Q&A 開始
- 之後逐步加入 Audio、Mind Map 等功能
