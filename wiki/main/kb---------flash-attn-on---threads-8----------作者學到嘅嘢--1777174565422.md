# 
  --flash-attn on --threads 8

───

作者學到嘅嘢

1. mmap 係最被低估嘅技巧 —— 一個 fl

> 來源：🎓學習 Channel | 16/4/2026 下午8:08:14 | [原始訊息](https://discord.com/channels/1378455195360952420/1473382857949970515/1494308439852060812)

## 標籤

- #知識庫 #technical

## 摘要

```
  --flash-attn on --threads 8
```
───

作者學到嘅嘢

1. **mmap 係最被低估嘅技巧** —— 一個 flag，決定「不可能」定「17 tok/s」
2. **集中管理模型名** —— 三個檔案有 hardcoded model name，换模型時救咗佢
3. **Benchmark 幾重要** —— 事前測試確認速度提升但準確度輕微下降
4. **本地模型唔係 Claude** —— 唔需要佢哋係，佢哋只需要快、便宜、可靠

───

總結

「本地模型係真正嘅基礎設施，唔係玩具」

## 分類詳情

| 項目 | 值 |
|------|-----|
| Category | technical |
| Confidence | 100.0% |
| Source | learning |
| Priority | P0 |

## Claims

- ```
-   --flash-attn on --threads 8
- ```
- ───
- 作者學到嘅嘢
- 1. **mmap 係最被低估嘅技巧** —— 一個 flag，決定「不可能」定「17 tok/s」
- 2. **集中管理模型名** —— 三個檔案有 hardcoded model name，换模型時救咗佢
- 3. **Benchmark 幾重要** —— 事前測試確認速度提升但準確度輕微下降
- 4. **本地模型唔係 Claude** —— 唔需要佢哋係，佢哋只需要快、便宜、可靠
- ───
- 總結
- 「本地模型係真正嘅基礎設施，唔係玩具」

---

*自動攝入 | 2026-04-26 | Knowledge Base Ingester v2.4*
