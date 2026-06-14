# 完整設置指令

Ollama (Fast + Primary):


brew install ollama
ollama pull gemma4

> 來源：🎓學習 Channel | 16/4/2026 下午8:08:14 | [原始訊息](https://discord.com/channels/1378455195360952420/1473382857949970515/1494308436668584106)

## 標籤

- #知識庫 #technical

## 摘要

完整設置指令

**Ollama (Fast + Primary):**

```
brew install ollama
ollama pull gemma4:e2b  # Fast tier
ollama pull gemma4:e4b   # Primary tier
```
**llama.cpp (Heavy 35B):**

```
llama-server \
  --model Qwen3.5-35B-A3B-UD-IQ3_XXS.gguf \
  --port 8081 --ctx-size 16384 \
  --n-gpu-layers 0 --mmap \
```

## 分類詳情

| 項目 | 值 |
|------|-----|
| Category | technical |
| Confidence | 100.0% |
| Source | learning |
| Priority | P0 |

## Claims

- 完整設置指令
- **Ollama (Fast + Primary):**
- ```
- brew install ollama
- ollama pull gemma4:e2b  # Fast tier
- ollama pull gemma4:e4b   # Primary tier
- ```
- **llama.cpp (Heavy 35B):**
- ```
- llama-server \
-   --model Qwen3.5-35B-A3B-UD-IQ3_XXS.gguf \
-   --port 8081 --ctx-size 16384 \
-   --n-gpu-layers 0 --mmap \
- ```

---

*自動攝入 | 2026-04-26 | Knowledge Base Ingester v2.4*
