# 
├─ message：消息生命周期（核心，received/transcribed/preprocessed/sent）
├─ session：會話生命

> 來源：🎓學習 Channel | 3/4/2026 下午9:54:35 | [原始訊息](https://discord.com/channels/1378455195360952420/1473382857949970515/1489624158206689330)

## 標籤

- #知識庫 #technical

## 摘要

```
├─ message：消息生命周期（核心，received/transcribed/preprocessed/sent）
├─ session：會話生命周期（compact:before/after）
├─ agent：Agent 生命周期（bootstrap）
└─ gateway：網關生命周期（gateway:startup）
```
**③ 安全模型**

```
|    | Claude Code                     | OpenClaw                      |
| --- | ------------------------------- | ----------------------------- |
| 假設 | Hook 可能係惡意                      | Hook 係本地可信代碼                  |
| 防護 | 零信任 + 多層防護（SSRF、CRLF、URL白名單、超時） | 邊界防護（路徑校驗、workspace-relative） |
| 適用 | 企業環境、多租戶、雲部署                    | 本地開發、單用戶                      |
```
**④ 執行方式對比**

## 分類詳情

| 項目 | 值 |
|------|-----|
| Category | technical |
| Confidence | 100.0% |
| Source | learning |
| Priority | P0 |

## Claims

- ```
- ├─ message：消息生命周期（核心，received/transcribed/preprocessed/sent）
- ├─ session：會話生命周期（compact:before/after）
- ├─ agent：Agent 生命周期（bootstrap）
- └─ gateway：網關生命周期（gateway:startup）
- ```
- **③ 安全模型**
- ```
- |    | Claude Code                     | OpenClaw                      |
- | --- | ------------------------------- | ----------------------------- |
- | 假設 | Hook 可能係惡意                      | Hook 係本地可信代碼                  |
- | 防護 | 零信任 + 多層防護（SSRF、CRLF、URL白名單、超時） | 邊界防護（路徑校驗、workspace-relative） |
- | 適用 | 企業環境、多租戶、雲部署                    | 本地開發、單用戶                      |
- ```
- **④ 執行方式對比**

---

*自動攝入 | 2026-04-26 | Knowledge Base Ingester v2.4*
