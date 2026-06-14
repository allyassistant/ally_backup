# 
"Hermes Agent 的 Anthropic provider 的 base URL 被硬編碼了..."

坑三：Custom endp

> 來源：🎓學習 Channel | 13/4/2026 下午12:49:08 | [原始訊息](https://discord.com/channels/1378455195360952420/1473382857949970515/1493110770547036213)

## 標籤

- #知識庫 #technical

## 摘要

```
"Hermes Agent 的 Anthropic provider 的 base URL 被硬編碼了..."
```
**坑三：Custom endpoint 走了錯誤的協議**

• 如果中轉服務走 Anthropic 原生協議，必須用 Anthropic provider，唔好用 OpenAI 兼容模式

───

④ Gateway 啟動姿勢（WSL 用戶必睇）

```
| 方式                   | 適用場景                      |
| -------------------- | ------------------------- |
| hermes gateway start | 依賴 systemd，WSL 不穩定，容易斷線 ❌ |
| hermes gateway run   | 前台直接運行，WSL 更穩定 ✅          |
```

## 分類詳情

| 項目 | 值 |
|------|-----|
| Category | technical |
| Confidence | 100.0% |
| Source | learning |
| Priority | P0 |

## Claims

- ```
- "Hermes Agent 的 Anthropic provider 的 base URL 被硬編碼了..."
- ```
- **坑三：Custom endpoint 走了錯誤的協議**
- • 如果中轉服務走 Anthropic 原生協議，必須用 Anthropic provider，唔好用 OpenAI 兼容模式
- ───
- ④ Gateway 啟動姿勢（WSL 用戶必睇）
- ```
- | 方式                   | 適用場景                      |
- | -------------------- | ------------------------- |
- | hermes gateway start | 依賴 systemd，WSL 不穩定，容易斷線 ❌ |
- | hermes gateway run   | 前台直接運行，WSL 更穩定 ✅          |
- ```

---

*自動攝入 | 2026-04-26 | Knowledge Base Ingester v2.4*
