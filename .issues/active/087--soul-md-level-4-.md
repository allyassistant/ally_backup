---
id: 087
title: 研究並實現個人人格蒸餾系統 (SOUL.md Level 4)
status: active
priority: P2
created: 2026-04-02
updated: 2026-05-23
progress: 1/5
---

## F - Facts（事實）
- SOUL.md 係我哋嘅人格定義文件
- 現有 Core Truths、FDQ System 等章節
- 「人格蒸餾」= 將隱性知識轉為明確規則

## D - Decisions（決定）
- 待定

## Q - Questions（未解決）
- Level 4 具體係咩？
- 係咪 SOUL.md 嘅升級版？
- 點衡量「人格」完整度？

## Progress
- [x] 研究人格蒸餾概念
- [ ] 設計 Level 4 架構
- [ ] 定義具體實現

## 新發現：Skill Format 分析 (2026-04-09)

### OpenClaw vs Immortal Format 對比

| 特性 | OpenClaw Format | 人格蒸餾 Format (Immortal) |
|------|-----------------|---------------------------|
| **基本結構** | `name`, `description`, `metadata` | `name`, `description`, `license`, `metadata` |
| **觸發方式** | Keywords (純文字匹配) | 多階段流程 (Phase 0-7) |
| **複雜度** | 簡單 | 非常複雜 |
| **適用場景** | 工具/指令 | 人格蒸餾/數碼分身 |

### OpenClaw Format
```yaml
---
name: skill-name
description: 觸發描述
metadata:
  openclaw:
    emoji: "📝"
    requires: { bins: ["tool"] }
---
# Workflow / Steps...
```

### Immortal/人格蒸餾 Format
```yaml
---
name: immortal-skill
description: 通用数字永生框架
metadata:
  openclaw: { requires: { bins: ["python3"]} }
  kit_version: "2"
  personas: ["self", "colleague", "mentor", ...]
---
# Phase 0-7 流程
# 分維度提取 (procedure/interaction/memory/personality)
```

### 結論
- OpenClaw ✅ 完全兼容 Immortal format
- 可以混合使用，OpenClaw 只讀 `name/description/metadata`
- 如果係蒸餾 Josh 自己 → 可以考慮用 Immortal format
- 如果係簡單工具調用 → 現有 format 夠用

## 新發現：awesome-persona-distill-skills (2026-04-09)

**來源：** https://github.com/xixu-me/awesome-persona-distill-skills

### 主要分類

| 類別 | 例子 | 用途 |
|------|------|------|
| **自我蒸餾** | 永生.skill、自己.skill、数字人生.skill | 創建自己嘅數碼分身 |
| **職場關係** | 同事.skill、老板.skill、导师.skill | 整理工作風格 |
| **公眾人物** | 马斯克.skill、乔布斯.skill、芒格.skill | 提取決策框架 |
| **親密關係** | 父母.skill、暗恋对象.skill | 紀念型陪伴 |

### 對我哋有意義嘅 Skills

#### 1. 永生.skill
- https://github.com/agenmod/immortal-skill
- 基於聊天記錄與相關資料整理多維數碼人格畫像

#### 2. 自己.skill  
- https://github.com/notdog1998/yourself-skill
- 將個人對話與記錄整理為自我蒸餾助手

#### 3. 數字人生.skill
- https://github.com/wildbyteai/digital-life
- 從個人數字痕跡中提煉結構化自我畫像

#### 4. Forge Skill
- https://github.com/YIKUAIBANZI/forge-skill
- 將自我蒸餾與他人蒸餾拆分為獨立流程

### 技術實現方式

這些 skill 都使用標準 SKILL.md 格式，與 OpenClaw/Hermes 通用：

```yaml
---
name: skill-name
description: When to trigger this skill
---

# Workflow
## Trigger Keywords
## Process steps...
```

### 與 OpenClaw/Hermes 嘅關係

1. **Hermes** = 自動生成 skill（自我學習）
2. **人格蒸餾** = 從對話/資料中提煉人格
3. **結合：** 兩者可以配合使用

## 下一步

- [ ] 深入研究 永生.skill / 自己.skill 嘅具體實現
- [ ] 評估適合我哋嘅方案
- [ ] 設計「Josh.skill」嘅可行性
- [x] 與 Hermes Issue (#099) 整合 → 已喺 #099 追蹤
- [ ] 定義具體實現

## Links
- https://github.com/xixu-me/awesome-persona-distill-skills
- https://agentskills.io
