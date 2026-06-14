---
pageType: source
id: source.article-1780092075258
title: - 🟡 task-queue.md / run-state.md 概念上分散咗唔同檔案，可以考慮統一
sourceType: discord
sourceUrl: https://discord.com/channels/1378455195360952420/1473382857949970515/1505633771469410444
ingestedAt: 2026-05-29T22:01:15.258Z
updatedAt: 2026-05-29T22:01:15.258Z
status: active
tags: [decision, ingested]
---

# - 🟡 task-queue.md / run-state.md 概念上分散咗唔同檔案，可以考慮統一

> 原始訊息：🎓學習 Channel | [link](https://discord.com/channels/1378455195360952420/1473382857949970515/1505633771469410444)

- 🟡 task-queue.md / run-state.md 概念上分散咗唔同檔案，可以考慮統一

---

### 4️⃣ 總結

> 長期工作的秘密，不是讓 Agent 一口氣跑更久，而是讓它每次醒來都知道自己是誰、在哪、要接著做什麼。

Bridge Wang 呢篇文講嘅架構同我地已經行緊嘅幾乎一樣，但佢提出嘅 `continuity_policy.md` 同 `run-state.md` 係我地仲未正式化嘅部分。可以考慮加一個 `memory/run-state.md` 記錄每輪 cron 的接力訊息，特別係讓 cron job 的 isolated session 可以更精準恢復上下文。

---

*自動攝入 | 2026-05-29 | Knowledge Base Ingester v2.4*
