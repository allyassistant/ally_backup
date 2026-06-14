---
id: 099
title: OpenClaw + Hermes Agent 整合方案
status: archive
priority: P2
created: 2026-04-09
due: 2026-05-10
updated: 2026-05-29
progress: 0/5
---

## 目的

研究點樣將 Hermes Agent 嘅自我學習能力整合到 OpenClaw 系統，實現 feedback loop：
- Hermes 自我學習 → 生成 SKILL.md → OpenClaw 自動使用

## 背景資料

### PDF 來源
- 日期：2026-04-09
- 來源：83 sources 整合分析

### 關鍵結論
1. **OpenClaw 可控制 Hermes？** ✅ 可以 via routing
2. **OpenClaw 可用 Hermes 學習能力？** ✅ 間接通過 shared SKILL.md
3. **最佳架構？** OpenClaw 協調 + Hermes 專家

## 技術分析

### Hermes 內置遷移工具
```bash
hermes claw migrate
```
會遷移：SOUL.md、MEMORY.md、workspace files、config → YAML、credentials

### 共享 Skill 格式
兩者都用同一個標準 SKILL.md：
```yaml
---
name: skill-name
description: When to trigger this skill
---

# Workflow
## Trigger Keywords
## Process steps...
```

### Hermes 自我學習曲線（官方提供）
- 第1次：耗時 25 tool calls
- 第10次：耗時 8 tool calls
- 第30次：完全自動化，耗時 2 tool calls

## 整合方案

### Option A: Shared Filesystem（推薦）
```
Hermes generates SKILL.md
        ↓
Saves to ~/.openclaw/hermes-generated-skills/
        ↓
OpenClaw 現有 skill scanner 自動讀取
        ↓
下次 similar task 就用到呢個 skill
```

**優點：** 最簡單，唔需要新 protocol
**缺點：** Hermes 尚未安裝

### Option B: MCP Connection
```
OpenClaw (MCP Client) ←→ Hermes (MCP Server)
         ↓                    ↓
   Delegates tasks    Responds with skill/SKILL.md
```

**優點：** 雙向實時溝通
**缺點：** 需要 Hermes 实现 MCP stdio protocol

### Option C: OGP Federation
- 太複雜，暫時唔建議

## 與人格蒸餾 (#087) 嘅關係

Hermes + 人格蒸餾 係相輔相成：
- **Hermes** = 自動生成 skill（自我學習）
- **人格蒸餾** = 從對話/資料中提煉人格
- **結合：** Hermes 可以協助人格蒸餾流程自動化

詳見 Issue #087 - 研究並實現個人人格蒸餾系統

## 現有系統分析

### OpenClaw Skill System
| Component | Location |
|-----------|----------|
| User Skills | `~/.openclaw/skills/` |
| Built-in Skills | `/opt/homebrew/lib/node_modules/openclaw/skills/` |
| Skill Loader | 自動掃描多個目錄 |

### 我們現有可以改進的領域
| 任務 | 現有方案 | Hermes 能幫手？ |
|------|----------|----------------|
| 重複性複雜任務 | Cron/Scripts | ✅ 自我學習優化 |
| Stock 分析 | Scripts | ✅ 越做越快 |
| 股票/金融分析 | N/A | ✅ 專家模式 |

## 問需要決定

- [ ] Hermes 安裝喺邊？（同一部 Mac？另一部機？VPS？）
- [ ] Hermes 專攻咩範疇？（股票分析？編程？其他？）
- [ ] 運行方式？（長期 daemon 定 on-demand sub-agent？）

## 實作階段

| Phase | Action | Complexity |
|-------|--------|------------|
| 1 | 安裝 Hermes agent | Medium |
| 2 | 建立 shared skill dir: `~/.openclaw/hermes-generated-skills/` | Low |
| 3 | 設定 OpenClaw 掃描新目錄 | Low |
| 4 | 測試 Feedback Loop | Medium |
| 5 | 應用到實際任務 | Medium |

## 結論

**Hermes 整合價值：**
- 如果你有大量重複性複雜任務，值得做
- 如果係為咗「幫我記得嘢」，現有 Memory Dreaming 已經足夠
- 長期目標：OpenClaw 協調 + Hermes 專家

**建議：**
1. 先試 Hermes standalone
2. 確認佢自我學習工作正常
3. 再設定 feedback loop

## Links
- Hermes官網：hermes-agent.nousresearch.com
- OGP：trilogyai.substack.com
