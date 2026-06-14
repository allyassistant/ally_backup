# AI 技術學習筆記 - 2026-02-12

## 1. 多步推理 (Multi-step Reasoning)

### ReAct 框架 (Reasoning + Acting)
- **核心概念**: 交替進行思考 (Thought) 同行動 (Action)
- **流程**: Thought → Action → Observation → 重複直到完成
- **格式**:
  ```
  Thought: [推理步驟]
  Action: [工具名稱]
  Action Input: [輸入]
  Observation: [結果]
  ```

### Chain-of-Thought (CoT)
- 將問題分解為順序子步驟
- 顯式推理痕跡: "Step 1: ... Step 2: ..."

### 實現工具
- **LangChain.js**: 工具整合、提示鏈接
- **mastra.ai**: JS-native 追蹤、成本監控
- **OpenAI Function Calling**: 結構化輸出

---

## 2. 更好嘅記憶系統

### RAG (Retrieval-Augmented Generation) 實現

#### 組件
| 組件 | 功能 | JavaScript 工具 |
|------|------|----------------|
| **嵌入模型** | 文字轉向量 | OpenAI, Ollama, Anthropic |
| **向量數據庫** | 語義搜索 | MongoDB Atlas, Chroma, Pinecone |
| **檢索** | 相似度匹配 | top-k 召回 |
| **生成** | 結合上下文回應 | LLM + RAG 提示 |

#### 代碼示例
```javascript
// MongoDB-RAG 混合搜索
const results = await rag.search('AI topics', {
  filter: { 'metadata.source': 'tech-docs' },
  maxResults: 5
});

// Llama Stack RAG 查詢
const rawRagResults = await client.toolRuntime.ragTool.query({
  content: question,
  vector_db_ids: [vector_db_id],
});
const ragResults = rawRagResults.content.map(item => item.text);
const prompt = `<question>${question}</question><context>${ragResults.join('')}</context>`;
```

### 記憶類型
| 記憶類型 | 描述 | 例子 |
|---------|------|------|
| **短期記憶** | 當前對話上下文 | 最近 10 條消息 |
| **長期記憶** | 持久化存儲 | MEMORY.md |
| **向量記憶** | 語義搜索 | 相似查詢召回 |
| **情境記憶** | 時間/地點關聯 | "上次珠寶展..." |

---

## 3. 多模態處理

### 實現方案

#### OpenAI Vision API
```javascript
// GPT-4o 圖片分析
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Extract diamond data from this GIA certificate' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,...' } }
    ]
  }]
});
```

#### Tesseract.js (本地 OCR)
```javascript
const Tesseract = require('tesseract.js');
const result = await Tesseract.recognize('gia_certificate.jpg', 'eng');
console.log(result.data.text);
```

#### Whisper 語音
```javascript
const transcription = await openai.audio.transcriptions.create({
  file: fs.createReadStream('audio.mp3'),
  model: 'whisper-1'
});
```

### 應用場景
| 場景 | 流程 |
|------|------|
| GIA 證書 OCR | 圖片上傳 → OCR → 提取資料 → 查價格 |
| 語音指令 | 語音 → 文字 → 意圖識別 → 執行 |
| 圖片搜索 | 上傳鑽石相 → 相似度匹配 → 推薦 |

---

## 4. Agent 編排 (Multi-agent)

### 框架比較
| 框架 | 語言 | 特點 | 適用場景 |
|------|------|------|---------|
| **CrewAI** | Python | 角色導向、結構化流程 | 企業級、確定性任務 |
| **AutoGen** | Python | 對話式、動態協調 | 研究、編碼助手 |
| **自研** | Node.js | 輕量、靈活 | 簡單多 Agent |

### Node.js 實現方案
由於 CrewAI/AutoGen 係 Python-native，Node.js 項目可用：

#### 方案 1: API 封裝
```javascript
// Node.js Express 調用 Python CrewAI
app.post('/diamond-analysis', async (req, res) => {
  const result = await fetch('http://python-agent-service:8000/analyze', {
    method: 'POST',
    body: JSON.stringify(req.body)
  });
  res.json(await result.json());
});
```

#### 方案 2: 自研輕量 Orchestrator
```javascript
class AgentOrchestrator {
  constructor() {
    this.agents = {
      diamond: new DiamondAgent(),
      excel: new ExcelAgent(),
      comm: new CommunicationAgent()
    };
  }
  
  async execute(task) {
    // 分析任務類型
    const agentType = this.classifyTask(task);
    // 委派畀對應 Agent
    return await this.agents[agentType].process(task);
  }
}
```

### 架構示例
```
User Request
    ↓
Orchestrator (Node.js)
    ↓
┌─────────────┬─────────────┬─────────────┐
│  Diamond    │    Excel    │    Comm     │
│   Agent     │    Agent    │    Agent    │
│  (分析鑽石)  │  (生成報表)  │  (發送通知)  │
└─────────────┴─────────────┴─────────────┘
    ↓
Combined Response
```

---

## 下一步實踐

### 短期 (1-2 週)
1. [ ] 實現簡單 ReAct 循環
2. [ ] 改進記憶搜索 (語義匹配)
3. [ ] GIA 證書 OCR 整合

### 中期 (1 個月)
1. [ ] 向量記憶系統
2. [ ] 多 Agent 原型
3. [ ] 自動化工作流

### 長期 (3 個月)
1. [ ] 完整 Multi-agent 系統
2. [ ] 自適應學習
3. [ ] 預測性建議

---

*學習開始: 2026-02-12*
*來源: Perplexity AI Research*
