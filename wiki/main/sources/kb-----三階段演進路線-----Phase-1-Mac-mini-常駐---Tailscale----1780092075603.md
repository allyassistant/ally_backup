---
pageType: source
id: source.article-1780092075651
title: ③ 三階段演進路線
sourceType: discord
sourceUrl: https://discord.com/channels/1378455195360952420/1473382857949970515/1506328704601821304
ingestedAt: 2026-05-29T22:01:15.651Z
updatedAt: 2026-05-29T22:01:15.651Z
status: active
tags: [technical, ingested]
---

# ③ 三階段演進路線

> 原始訊息：🎓學習 Channel | [link](https://discord.com/channels/1378455195360952420/1473382857949970515/1506328704601821304)

**③ 三階段演進路線**
- Phase 1：Mac mini 常駐 + Tailscale + SSH + tmux
- Phase 2：Codex 主力化，每個 project 有 AGENTS.md，GitHub 做版本管理
- Phase 3：龍蝦降級為 Gateway，飛書/微信 → 龍蝦 → Codex exec → 回傳

**④ 安全原則**
- 唔開公網 port，全部走 Tailscale
- API Key 唔入 Git
- Codex 改 code 前先 git commit checkpoint
- SSH 只喺 Tailscale 內用

**⑤ 最終形態**
一句話總結：MacBook 係駕駛艙，Mac mini 係機房，Codex 係工程師，龍蝦係消息前台，Tailscale 係專線。

## 3️⃣ 對比我哋嘅 Setup

| 項目 | 我哋 | XChatScout |

---

*自動攝入 | 2026-05-29 | Knowledge Base Ingester v2.4*
