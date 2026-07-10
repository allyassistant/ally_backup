---
pageType: source
id: source.article-1783609677317
title: 搞掂咗。驗證結果：
sourceType: discord
sourceUrl: https://discord.com/channels/1378455195360952420/1473382857949970515/1509368059339473096
ingestedAt: 2026-07-09T15:07:57.317Z
updatedAt: 2026-07-09T15:07:57.317Z
status: active
tags: [technical, ingested]
---

# 搞掂咗。驗證結果：

> 原始訊息：🎓學習 Channel | [link](https://discord.com/channels/1378455195360952420/1473382857949970515/1509368059339473096)

搞掂咗。驗證結果：

**✅ `--type` 參數生效**
- Accepts: `observation`, `reaction`, `pattern`, `question`, `number`, `reference`
- Invalid type → 紅色 error + 顯示所有 valid types 同 description
- Frontmatter 自動加 `type: pattern` 行
- Tag 自動 merge（`wiki_direct` + existing + new）
- Footer 加「類型: pattern」

**Error message 有埋教學：**
```
❌ Invalid --type: "note". Valid: observation, reaction, pattern, question, number, reference

  Type descriptions:
    observation  留意到嘅嘢，未打磨（things I noticed, unpolished）
    reaction     對某事嘅 gut response（honest gut response to something）
```

---

*自動攝入 | 2026-07-09 | Knowledge Base Ingester v2.4*
