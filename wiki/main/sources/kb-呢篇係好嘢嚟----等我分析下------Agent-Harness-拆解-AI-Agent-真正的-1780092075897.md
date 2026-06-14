---
pageType: source
id: source.article-1780092075946
title: 呢篇係好嘢嚟 🤓 等我分析下：
sourceType: discord
sourceUrl: https://discord.com/channels/1378455195360952420/1473382857949970515/1507003660154966127
ingestedAt: 2026-05-29T22:01:15.946Z
updatedAt: 2026-05-29T22:01:15.946Z
status: active
tags: [decision, ingested]
---

# 呢篇係好嘢嚟 🤓 等我分析下：

> 原始訊息：🎓學習 Channel | [link](https://discord.com/channels/1378455195360952420/1473382857949970515/1507003660154966127)

呢篇係好嘢嚟 🤓 等我分析下：

**《Agent Harness 拆解：AI Agent 真正的工程底座》by 土豆本豆 (@Potatoloogs)**

**五大要點：**

**1️⃣ Agent Harness 係乜？**
就係包裹喺 LLM 外面嘅完整軟件基礎設施，包括 orchestration loop、tools、memory、context management、state persistence、error handling、guardrails。作者引用 LangChain 一句：「If you're not the model, you're the harness.」

**2️⃣ 用電腦系統做類比**
Beren Millidge 2023 年嘅精彩類比：裸 LLM = CPU（冇 RAM、冇硬碟、冇 I/O、冇 OS）。Context window = RAM（快但有限），外部 DB = 硬碟（大但慢），Tool = driver，Harness = 操作系統。我哋根本係重新發明馮紐曼架構。

**3️⃣ 圍繞模型嘅三層工程**
Prompt Engineering → Context Engineering → Harness Engineering。Harness 唔係包喺 prompt 外面嘅一層殼，而係令自主 agent 行為成為可能嘅完整系統。

**4️⃣ 生產級 Harness 嘅 12 個組件**
Orchestration Loop > Tools > Memory > Context Management > Prompt Construction > Output Parsing > State Management > Error Handling > Guardrails > Verification Loops > Subagent Orchestration > 仲有第 12 個（篇幅太長截斷咗）。其中 Error Handling 講得好：10 步流程每步 99% 成功率 → 端到端得 ~90.4%。

---

*自動攝入 | 2026-05-29 | Knowledge Base Ingester v2.4*
