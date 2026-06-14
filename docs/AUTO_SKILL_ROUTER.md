# Auto-Skill Router 使用指南

## 🎯 概述

Auto-Skill Router 是一個智能系統，可以：
1. **自動檢測**用戶消息的意圖
2. **匹配相關 Skills**
3. **自動載入 Skills**
4. **執行任務**

## 📁 文件結構

```
scripts/
├── skills_manager.js      # Skills 註冊和管理
├── auto_skill_router.js  # 自動路由系統
└── skills/               # Skills 文件夾
    ├── excel_ai_formula.js
    └── productivity_automation.js
```

## 🚀 使用方式

### 1. 基本用法

```javascript
const { handleUserRequest } = require('./scripts/auto_skill_router');

const result = await handleUserRequest("幫我計呢粒 diamond 幾多錢");

console.log(result.loadedSkills);  // ['diamond_valuation']
console.log(result.response);      // 自動生成的回覆
```

### 2. 快速檢測

```javascript
const { quickDetect } = require('./scripts/auto_skill_router');

const types = quickDetect("幫我 generate excel formula for growth");
// types: ['excel', 'task']
```

### 3. 主動建議

```javascript
const { proactiveSuggestion } = require('./scripts/auto_skill_router');

const suggestion = proactiveSuggestion("呢粒石頭咩價錢");
// 自動建議相關 Skills
```

## 📋 已註冊的 Skills

| Category | Skills |
|----------|--------|
| **Business** | Diamond Valuation, Stock Management, Quotation Generator |
| **Productivity** | Excel AI Formula, Productivity Automation |
| **Research** | Perplexity Search, Web Search |
| **Utility** | File Processor, Data Analyzer |
| **Knowledge** | Memory Manager, Learning Processor |
| **Notification** | WhatsApp Notification, Reminder Manager |
| **Monitoring** | Health Monitor, Token Monitor |

## 💡 工作流程

```
💬 用戶發送消息
        ↓
🔍 Intent Analysis (分析意圖)
        ↓
🎯 Match Skills (匹配 Skills)
        ↓
📦 Load Skills (自動載入)
        ↓
⚡ Execute (執行)
        ↓
✅ 返回結果
```

## 🧪 測試結果

```
💬 "幫我計呢粒 diamond 幾多錢"
   → Keywords: diamond, 計
   → Skill: Diamond Valuation
   → Confidence: 20%

💬 "generate excel formula for growth"
   → Keywords: excel, formula
   → Skill: Excel AI Formula Generator
   → Confidence: 20%

💬 "schedule meeting with client"
   → Keywords: schedule
   → Skill: Productivity Automation
   → Confidence: 10%

💬 "search latest trends"
   → Keywords: search
   → Skill: Perplexity Search
   → Confidence: 50%
```

## 🎓 如何添加新 Skill

### Step 1: 創建 Skill 文件

```javascript
// skills/my_new_skill.js

const SKILL_INFO = {
  name: "My New Skill",
  version: "1.0.0",
  keywords: ["keyword1", "keyword2"],
  intents: ["intent1", "intent2"],
  description: "Skill 描述"
};

function mySkillFunction(input) {
  // 處理邏輯
  return { result: "..." };
}

module.exports = {
  skill: SKILL_INFO,
  mySkillFunction
};
```

### Step 2: 註冊到 Skills Manager

```javascript
// 在 skills_manager.js 中添加：

my_new_skill: {
  file: "skills/my_new_skill.js",
  name: "My New Skill",
  version: "1.0.0",
  keywords: ["keyword1", "keyword2"],
  intents: ["intent1", "intent2"],
  description: "Skill 描述",
  category: "utility"
}
```

### Step 3: 自動被使用

下次用戶消息包含你的 keywords 時，系統會自動：
1. 檢測到匹配
2. 載入 Skill
3. 執行任務

## 🔧 系統需求

- Node.js
- OpenClaw (已有)
- Skills 文件 (.js)

## 📈 未來擴展

- [ ] 添加機器學習意圖檢測
- [ ] 多語言支援
- [ ] 技能組合執行
- [ ] 使用歷史學習

---

*創建日期: 2026-02-15*
