# 🔧 安裝方式

35B 模型：


brew install llama.cpp
pip3 install rich ddgs huggingf

> 來源：🎓學習 Channel | 26/3/2026 下午1:28:50 | [原始訊息](https://discord.com/channels/1378455195360952420/1473382857949970515/1486597782365016135)

## 標籤

- #知識庫 #technical

## 摘要

🔧 安裝方式

**35B 模型：**

```
brew install llama.cpp
pip3 install rich ddgs huggingface-hub

# 下載 35B 模型 (10.6 GB)
python3 -c "from huggingface_hub import hf_hub_download; hf_hub_download('unsloth/Qwen3.5-35B-A3B-GGUF', 'Qwen3.5-35B-A3B-UD-IQ2_M.gguf', local_dir='$HOME/models/')"

# 啟動服務
llama-server --model ~/models/Qwen3.5-35B-A3B-UD-IQ2_M.gguf --port 8000 ...
```
───

📁 項目文件

## 分類詳情

| 項目 | 值 |
|------|-----|
| Category | technical |
| Confidence | 100.0% |
| Source | learning |
| Priority | P0 |

## Claims

- 🔧 安裝方式
- **35B 模型：**
- ```
- brew install llama.cpp
- pip3 install rich ddgs huggingface-hub
- # 下載 35B 模型 (10.6 GB)
- python3 -c "from huggingface_hub import hf_hub_download; hf_hub_download('unsloth/Qwen3.5-35B-A3B-GGUF', 'Qwen3.5-35B-A3B-UD-IQ2_M.gguf', local_dir='$HOME/models/')"
- # 啟動服務
- llama-server --model ~/models/Qwen3.5-35B-A3B-UD-IQ2_M.gguf --port 8000 ...
- ```
- ───
- 📁 項目文件

---

*自動攝入 | 2026-04-26 | Knowledge Base Ingester v2.4*
