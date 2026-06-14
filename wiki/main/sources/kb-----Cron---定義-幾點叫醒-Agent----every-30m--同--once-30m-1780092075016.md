---
pageType: source
id: source.article-1780092075064
title: - Cron：定義「幾點叫醒 Agent」— every 30m 同 once 30m 好大分別
sourceType: discord
sourceUrl: https://discord.com/channels/1378455195360952420/1473382857949970515/1505633761318932510
ingestedAt: 2026-05-29T22:01:15.064Z
updatedAt: 2026-05-29T22:01:15.064Z
status: active
tags: [technical, ingested]
---

# - Cron：定義「幾點叫醒 Agent」— every 30m 同 once 30m 好大分別

> 原始訊息：🎓學習 Channel | [link](https://discord.com/channels/1378455195360952420/1473382857949970515/1505633761318932510)

- **Cron**：定義「幾點叫醒 Agent」— `every 30m` 同 `once 30m` 好大分別
- **Heartbeat**：每次醒來做咩，靠 HEARTBEAT.md 文件引導
- **狀態文件**：用 filesystem 承載連續性，唔用聊天記錄

**3. HEARTBEAT.md 係交接班卡片**

每次被 cron 喚醒後嘅行動清單：
```
1. 讀取連續工作規則（continuity_policy.md）
2. 讀取當前狀態（current-state.md）
3. 讀取任務隊列（task-queue.md）
4. 檢查是否存在阻塞
5. 推進一個實際工作單元（唔可以只 output 計劃）
6. 更新狀態文件
7. 寫運行日誌
```

---

*自動攝入 | 2026-05-29 | Knowledge Base Ingester v2.4*
