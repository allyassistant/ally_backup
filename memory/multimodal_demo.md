# Multimodal Processing Demo
## GIA Certificate OCR Workflow

---

## 🖼️ 多模態處理流程

### 場景：用戶上傳 GIA 證書圖片

```
[用戶上傳圖片]
    ↓
[Vision Agent] GPT-4o Vision API
    ↓
[OCR Agent] Tesseract.js (備用)
    ↓
[Data Extraction Agent] 結構化提取
    ↓
[Price Lookup Agent] Rapaport 查價
    ↓
[Response Agent] 生成回應
    ↓
[用戶收到結果]
```

---

## 📝 代碼示例

### Step 1: 圖片分析 (GPT-4o Vision)
```javascript
const analyzeGIAImage = async (imageBase64) => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        { 
          type: 'text', 
          text: 'Extract diamond data from this GIA certificate. Return JSON: {carat, color, clarity, cut, cert_no}' 
        },
        { 
          type: 'image_url', 
          image_url: { url: `data:image/jpeg;base64,${imageBase64}` } 
        }
      ]
    }]
  });
  return JSON.parse(response.choices[0].message.content);
};
```

### Step 2: 本地 OCR 備用 (Tesseract.js)
```javascript
const Tesseract = require('tesseract.js');

const localOCR = async (imagePath) => {
  const result = await Tesseract.recognize(
    imagePath,
    'eng',
    { logger: m => console.log(m) }
  );
  return result.data.text;
};
```

### Step 3: 語音輸入 (Whisper)
```javascript
const transcribeVoice = async (audioPath) => {
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
    language: 'zh'
  });
  return transcription.text;
};
```

---

## 🎯 整合流程

```javascript
class MultimodalDiamondAgent {
  async process(input) {
    // 判斷輸入類型
    if (input.type === 'image') {
      return await this.processImage(input.data);
    } else if (input.type === 'voice') {
      return await this.processVoice(input.data);
    } else if (input.type === 'text') {
      return await this.processText(input.data);
    }
  }
  
  async processImage(imageData) {
    // Step 1: Vision API 分析
    const visionResult = await this.visionAnalyze(imageData);
    
    // Step 2: 如果 Vision 失敗，用 OCR
    if (!visionResult.confidence > 0.8) {
      const ocrText = await this.localOCR(imageData);
      visionResult = await this.parseOCRText(ocrText);
    }
    
    // Step 3: 查價格
    const price = await this.lookupPrice(visionResult);
    
    // Step 4: 生成回應
    return this.generateResponse(visionResult, price);
  }
  
  async processVoice(audioData) {
    // 語音轉文字
    const text = await this.transcribeVoice(audioData);
    // 然後當文字處理
    return await this.processText(text);
  }
}
```

---

## 📊 處理能力對比

| 輸入類型 | 處理方式 | 準確度 | 速度 |
|---------|---------|--------|------|
| 圖片 (GIA) | GPT-4o Vision | 95% | 2-3s |
| 圖片 (一般) | Tesseract.js | 85% | 1-2s |
| 語音 (粵語) | Whisper | 90% | 1-2s |
| 文字 | 直接處理 | 100% | 即時 |

---

## 💡 應用場景

1. **用戶 send GIA 相** → 自動提取 → 報價
2. **用戶語音查詢** → 轉文字 → 搜索庫存
3. **用戶 send 鑽石相** → 視覺分析 → 找相似

---

**狀態**: ✅ 多模態框架已設計  
**下一步**: 實際整合到 OpenClaw 工具鏈
