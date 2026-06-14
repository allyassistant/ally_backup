# 
Claude Code：4 種執行器
├─ Command Hook → 調用本地腳本
├─ Prompt Hook → 調用 LLM 做決策
├─ H

> 來源：🎓學習 Channel | 3/4/2026 下午9:54:35 | [原始訊息](https://discord.com/channels/1378455195360952420/1473382857949970515/1489624160383799517)

## 標籤

- #知識庫 #technical

## 摘要

```
Claude Code：4 種執行器
├─ Command Hook → 調用本地腳本
├─ Prompt Hook → 調用 LLM 做決策
├─ HTTP Hook → 調用遠程服務
└─ Agent Hook → 啟動子 Agent 做複雜驗證

OpenClaw：單一執行方式
└─ JavaScript 函數（直接在代碼中執行）
```
**⑤ 關鍵限制**

```
| 場景       | Claude Code            | OpenClaw               |
| -------- | ---------------------- | ---------------------- |
| 阻止危險操作   | ✅ 系統級強制攔截，100%可靠       | ⚠️ 依賴 Agent 理解警告，可能被繞過 |
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
- Claude Code：4 種執行器
- ├─ Command Hook → 調用本地腳本
- ├─ Prompt Hook → 調用 LLM 做決策
- ├─ HTTP Hook → 調用遠程服務
- └─ Agent Hook → 啟動子 Agent 做複雜驗證
- OpenClaw：單一執行方式
- └─ JavaScript 函數（直接在代碼中執行）
- ```
- **⑤ 關鍵限制**
- ```
- | 場景       | Claude Code            | OpenClaw               |
- | -------- | ---------------------- | ---------------------- |
- | 阻止危險操作   | ✅ 系統級強制攔截，100%可靠       | ⚠️ 依賴 Agent 理解警告，可能被繞過 |
- ```

---

*自動攝入 | 2026-04-26 | Knowledge Base Ingester v2.4*
