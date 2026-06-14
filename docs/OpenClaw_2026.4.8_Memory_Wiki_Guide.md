# OpenClaw 2026.4.8 Memory/Wiki 功能使用指南

*版本：2026.4.8 | 生成日期：2026-04-08*

---

## 目錄

1. [概述](#概述)
2. [memory-wiki Plugin 使用方法](#memory-wiki-plugin-使用方法)
3. [dreams.md 結構與用途](#dreamsmd-結構與用途)
4. [REM Preview Tooling 用法](#rem-preview-tooling-用法)
5. [Freshness-Weighted Search](#freshness-weighted-search)
6. [結構化 Claim/Evidence 使用方式](#結構化-claimevidence-使用方式)
7. [Compiled Digest 獲取方式](#compiled-digest-獲取方式)
8. [實際應用場景](#實際應用場景)

---

## 概述

OpenClaw 2026.4.8 引入了全新的 **Memory/Wiki** 功能套件，包含以下核心組件：

| 組件 | 功能 | 狀態 |
|------|------|------|
| `memory-wiki` | 持久化 Wiki 編譯器與 Obsidian 友好知識庫 | 需手動啟用 |
| `memory-core` | 核心記憶搜索插件（含 Dreaming 功能） | 已啟用 |
| `memory-lancedb` | LanceDB 長期記憶插件 | 需手動啟用 |

---

## memory-wiki Plugin 使用方法

### 1. 啟用 Plugin

```bash
# 啟用 memory-wiki 插件
openclaw plugins enable memory-wiki

# 重啟 gateway 以應用變更
openclaw gateway restart
```

### 2. 初始化 Wiki Vault

```bash
# 初始化 wiki vault
openclaw wiki init

# 檢查狀態
openclaw wiki status
```

### 3. Vault 模式

memory-wiki 支援三種 vault 模式：

| 模式 | 說明 | 使用場景 |
|------|------|----------|
| `isolated` | 完全隔離的 wiki 存儲 | 預設推薦 |
| `bridge` | 讀取公開記憶工件和事件 | 與 memory-core 整合 |
| `unsafe-local` | 實驗性本地路徑訪問 | 需明確啟用 |

**配置範例：**
```json
{
  "plugins": {
    "entries": {
      "memory-wiki": {
        "config": {
          "vaultMode": "bridge",
          "vault": {
            "path": "./.openclaw-wiki",
            "renderMode": "obsidian"
          },
          "obsidian": {
            "enabled": true,
            "useOfficialCli": true,
            "openAfterWrites": true
          },
          "bridge": {
            "enabled": true,
            "readMemoryArtifacts": true,
            "indexDreamReports": true,
            "indexDailyNotes": true
          }
        }
      }
    }
  }
}
```

### 4. 核心 CLI 命令

```bash
# 編譯 wiki vault
openclaw wiki compile

# 匯入外部來源
openclaw wiki bridge import      # bridge 模式
openclaw wiki unsafe-local import # unsafe-local 模式

# 內容攝取
openclaw wiki ingest --inputPath ./notes.md --title "My Notes"

# 品質檢查
openclaw wiki lint

# 搜索
openclaw wiki search "關鍵字" --backend local --corpus wiki

# 讀取頁面
openclaw wiki get --lookup "page-path"

# 應用變更
openclaw wiki apply --op create_synthesis --title "New Synthesis"
```

### 5. Obsidian 整合

```bash
# 檢查 Obsidian CLI 狀態
openclaw wiki obsidian status

# Obsidian 搜索
openclaw wiki obsidian search --query "關鍵字"

# 在 Obsidian 中開啟
openclaw wiki obsidian open --path "page-path"

# 執行 Obsidian 命令
openclaw wiki obsidian command --id "command-id"

# 開啟 Daily Note
openclaw wiki obsidian daily
```

---

## dreams.md 結構與用途

### 1. 什麼是 Dreaming？

Dreaming 是 OpenClaw 模仿人類睡眠時整理記憶的機制，自動在後台整理對話記憶並建立共享知識庫。

**三個階段：**
- **Light** (輕度)：每 6 小時執行，去重複、整理短期記憶
- **REM** (快速眼動)：每週執行，模式識別、產生候選真理
- **Deep** (深度)：每日執行，將高價值記憶寫入 MEMORY.md

### 2. dreams.md 結構

```markdown
# Dream Report - 2026-04-08

## Light Phase Summary
- Processed: 150 entries
- Deduplicated: 23 similar entries
- Sources: daily, sessions, recall

## REM Phase Reflections
### Pattern 1: Router Configuration
- Occurrences: 5 times
- Confidence: 0.85
- Related queries: "router vlan", "network config"

### Pattern 2: Error Handling
- Occurrences: 8 times
- Confidence: 0.92
- Related queries: "try-catch", "error templates"

## Deep Phase Promotions
### Promoted to MEMORY.md
1. **Router VLAN Configuration** (score: 0.91)
   - Evidence: 3 recalls, 4 unique queries
   - Source: 2026-04-05-session.md
   
2. **Error Template Pattern** (score: 0.88)
   - Evidence: 5 recalls, 3 unique queries
   - Source: 2026-04-06-session.md

## Open Questions
- How to handle nested error callbacks?
- Best practice for timeout configuration?
```

### 3. 配置 dreaming

```bash
# 查看 dreaming 狀態
/dreaming status

# 啟用 dreaming
/dreaming on

# 關閉 dreaming
/dreaming off
```

**配置範例：**
```json
{
  "plugins": {
    "entries": {
      "memory-core": {
        "config": {
          "dreaming": {
            "enabled": true,
            "frequency": "0 3 * * *",
            "timezone": "Asia/Hong_Kong",
            "storage": {
              "mode": "both",
              "separateReports": true
            },
            "phases": {
              "light": {
                "enabled": true,
                "lookbackDays": 2,
                "limit": 100,
                "dedupeSimilarity": 0.9
              },
              "rem": {
                "enabled": true,
                "lookbackDays": 7,
                "limit": 10,
                "minPatternStrength": 0.75
              },
              "deep": {
                "enabled": true,
                "limit": 10,
                "minScore": 0.8,
                "minRecallCount": 3,
                "minUniqueQueries": 3,
                "recencyHalfLifeDays": 14,
                "maxAgeDays": 30
              }
            }
          }
        }
      }
    }
  }
}
```

---

## REM Preview Tooling 用法

### 1. rem-harness 命令

**用途：** 預覽 REM 反思、候選真理和深度推廣結果（不寫入檔案）

```bash
# 基本用法
openclaw memory rem-harness

# JSON 輸出
openclaw memory rem-harness --json

# 包含已推廣的候選
openclaw memory rem-harness --include-promoted

# 指定 agent
openclaw memory rem-harness --agent my-agent
```

**輸出範例：**
```json
{
  "reflections": [
    {
      "pattern": "Router Configuration",
      "occurrences": 5,
      "confidence": 0.85,
      "sources": ["2026-04-05.md", "2026-04-06.md"],
      "candidateTruth": "VLAN configuration requires explicit subnet definition"
    }
  ],
  "deepPromotions": [
    {
      "key": "router-vlan-config",
      "score": 0.91,
      "recallCount": 3,
      "uniqueQueries": 4,
      "snippet": "Router VLAN configuration best practices...",
      "wouldPromote": true
    }
  ],
  "timestamp": "2026-04-08T08:00:00Z"
}
```

### 2. promote-explain 命令

**用途：** 解釋特定推廣候選及其分數細節

```bash
# 基本用法
openclaw memory promote-explain "router vlan"

# JSON 輸出
openclaw memory promote-explain "router vlan" --json

# 包含已推廣的候選
openclaw memory promote-explain "router vlan" --include-promoted

# 指定 agent
openclaw memory promote-explain "router vlan" --agent my-agent
```

**輸出範例：**
```json
{
  "candidate": {
    "key": "router-vlan-config",
    "snippet": "Router VLAN configuration requires explicit subnet...",
    "sourcePath": "memory/2026-04-05.md"
  },
  "scoreBreakdown": {
    "baseScore": 0.85,
    "recallBonus": 0.03,
    "queryDiversityBonus": 0.03,
    "finalScore": 0.91
  },
  "criteria": {
    "minScore": 0.80,
    "minRecallCount": 3,
    "minUniqueQueries": 3,
    "actualRecallCount": 5,
    "actualUniqueQueries": 4
  },
  "wouldPromote": true,
  "reason": "Meets all promotion criteria"
}
```

### 3. 標準記憶體推廣命令

```bash
# 查看候選（不寫入）
openclaw memory promote --limit 10

# 應用推廣（寫入 MEMORY.md）
openclaw memory promote --apply

# 自定義門檻
openclaw memory promote --min-score 0.85 --min-recall-count 5 --apply
```

---

## Freshness-Weighted Search

### 1. Freshness 等級

| 等級 | 說明 | 時間範圍 |
|------|------|----------|
| `fresh` | 新鮮 | < 7 天 |
| `aging` | 老化 | 7-30 天 |
| `stale` | 陳舊 | > 30 天 |
| `unknown` | 未知 | 無時間戳 |

### 2. 搜索時的 Freshness 加權

```bash
# wiki 搜索（自動應用 freshness 加權）
openclaw wiki search "deployment" --corpus wiki

# memory 搜索
openclaw memory search "deployment"

# 聯合搜索
openclaw wiki search "deployment" --corpus all
```

### 3. Freshness 計算邏輯

```javascript
// 基於以下時間戳計算
const freshness = assessClaimFreshness({
  claim: {
    updatedAt: "2026-04-05T10:00:00Z",
    evidence: [
      { updatedAt: "2026-04-06T12:00:00Z" },
      { updatedAt: "2026-04-07T14:00:00Z" }
    ]
  },
  page: {
    updatedAt: "2026-04-08T08:00:00Z"
  },
  now: Date.now()
});

// 結果：{ level: "fresh", daysSinceTouch: 0 }
```

### 4. Freshness 排序

在 compiled digest 中，claims 按以下優先級排序：
1. **Confidence**（置信度）- 最高優先
2. **Freshness**（新鮮度）- 次優先
3. **Alphabetical**（字母順序）- 最後

---

## 結構化 Claim/Evidence 使用方式

### 1. Claim 結構

```typescript
interface WikiClaim {
  id?: string;           // 唯一標識符
  text: string;          // 聲稱內容
  status?: string;       // 狀態：supported|contested|refuted|superseded
  confidence?: number;   // 置信度：0-1
  freshnessLevel?: string; // 新鮮度：fresh|aging|stale
  evidence: WikiClaimEvidence[];
  updatedAt?: string;    // ISO 8601 時間戳
}

interface WikiClaimEvidence {
  source: string;        // 來源路徑
  quote?: string;        // 引用內容
  updatedAt?: string;    // 時間戳
}
```

### 2. Markdown 中的 Claim 表示

```markdown
# Router Configuration Guide

## Claims

- [claim::router-vlan-required] VLAN configuration requires explicit subnet definition
  - status: supported
  - confidence: 0.92
  - freshness: fresh
  - evidence:
    - source: memory/2026-04-05.md
      quote: "When configuring VLANs, always define the subnet explicitly"
    - source: docs/network-guide.md
      quote: "VLAN without subnet definition causes routing issues"

- [claim::router-timeout-default] Default timeout is 30 seconds
  - status: contested
  - confidence: 0.65
  - freshness: aging
  - evidence:
    - source: memory/2026-03-20.md
      quote: "Timeout should be 30s"
    - source: memory/2026-04-01.md
      quote: "Changed timeout to 60s for production"

## Contradictions

- [contradiction::timeout] Conflicting timeout values reported (30s vs 60s)

## Open Questions

- What is the recommended timeout for high-latency networks?
```

### 3. 使用 wiki_apply 創建 Claim

```bash
openclaw wiki apply --op create_synthesis \
  --title "Router Configuration Best Practices" \
  --body "## Summary

- [claim::vlan-subnet] VLAN requires explicit subnet
  - confidence: 0.92
  - evidence:
    - source: memory/2026-04-05.md" \
  --claims '[{"text":"VLAN requires explicit subnet","confidence":0.92}]'
```

### 4. Claim 健康檢查

```bash
# 執行 lint 檢查 claim 健康
openclaw wiki lint

# 檢查結果包含：
# - Missing Evidence（缺少證據的 claims）
# - Contested Claims（有爭議的 claims）
# - Stale Claims（陳舊的 claims）
```

---

## Compiled Digest 獲取方式

### 1. 什麼是 Compiled Digest？

Compiled Digest 是 AI 可消費的摘要格式，位於：
```
.openclaw-wiki/cache/agent-digest.json
```

包含內容：
- 高價值頁面摘要（最多 4 頁）
- Top Claims（每頁最多 2 個）
- 矛盾集群統計
- 開放問題列表

### 2. 生成 Digest

```bash
# 編譯 vault（會生成/更新 digest）
openclaw wiki compile

# 查看狀態（顯示 digest 信息）
openclaw wiki status
```

### 3. Digest 結構

```json
{
  "claimCount": 150,
  "pages": [
    {
      "title": "Router Configuration",
      "kind": "synthesis",
      "claimCount": 12,
      "topClaims": [
        {
          "text": "VLAN requires explicit subnet",
          "confidence": 0.92,
          "freshnessLevel": "fresh",
          "status": "supported"
        }
      ],
      "questions": ["Timeout recommendation?"],
      "contradictions": ["Conflicting timeout values"]
    }
  ],
  "contradictionClusters": [
    {
      "key": "timeout-config",
      "label": "Timeout Configuration",
      "entries": [
        {"pagePath": "router.md", "status": "supported"},
        {"pagePath": "production.md", "status": "contested"}
      ]
    }
  ]
}
```

### 4. 在 Prompt 中使用 Digest

啟用自動包含 digest：
```json
{
  "plugins": {
    "entries": {
      "memory-wiki": {
        "config": {
          "context": {
            "includeCompiledDigestPrompt": true
          }
        }
      }
    }
  }
}
```

啟用後，每次對話會自動附加：
```
## Compiled Wiki Snapshot
Compiled wiki currently tracks 150 claims across 4 high-signal pages.
Contradiction clusters: 3.

- Router Configuration: synthesis, 12 claims, 1 open question, 1 contradiction note
  - VLAN requires explicit subnet (confidence 0.92, freshness fresh)
  - Default timeout is 30s (confidence 0.65, freshness aging, status contested)
```

### 5. 直接讀取 Digest

```javascript
// Node.js 範例
const fs = require('fs');
const digest = JSON.parse(
  fs.readFileSync('./.openclaw-wiki/cache/agent-digest.json', 'utf8')
);

console.log(`Total claims: ${digest.claimCount}`);
digest.pages.forEach(page => {
  console.log(`- ${page.title}: ${page.claimCount} claims`);
});
```

---

## 實際應用場景

### 場景 1：建立項目知識庫

```bash
# 1. 啟用插件
openclaw plugins enable memory-wiki

# 2. 初始化 vault
openclaw wiki init

# 3. 攝取現有文檔
openclaw wiki ingest --inputPath ./README.md --title "Project Overview"
openclaw wiki ingest --inputPath ./docs/api.md --title "API Documentation"

# 4. 編譯並檢查
openclaw wiki compile
openclaw wiki lint

# 5. 搜索使用
openclaw wiki search "authentication"
```

### 場景 2：會議記錄整理

```bash
# 攝取會議記錄
openclaw wiki ingest --inputPath ./meeting-2026-04-08.md --title "Team Sync"

# 編譯提取 claims
openclaw wiki compile

# 查看生成的 claims
openclaw wiki get --lookup "Team Sync"

# 檢查是否有矛盾
openclaw wiki lint
```

### 場景 3：使用 Dreaming 自動整理

```bash
# 1. 啟用 dreaming
/dreaming on

# 2. 預覽 REM 結果
openclaw memory rem-harness --json

# 3. 解釋特定候選
openclaw memory promote-explain "error handling" --json

# 4. 應用推廣
openclaw memory promote --apply

# 5. 查看 DREAMS.md
cat memory/dreaming/DREAMS.md
```

### 場景 4：Obsidian 整合工作流

```bash
# 配置 Obsidian 模式
openclaw config set plugins.entries.memory-wiki.config.vault.renderMode obsidian
openclaw config set plugins.entries.memory-wiki.config.obsidian.enabled true

# 日常維護循環
openclaw wiki bridge import   # 匯入最新記憶
openclaw wiki compile         # 編譯更新
openclaw wiki lint            # 品質檢查

# 在 Obsidian 中開啟
openclaw wiki obsidian daily
```

### 場景 5：矛盾檢測與解決

```bash
# 1. 搜索可能有矛盾的資訊
openclaw wiki search "timeout configuration"

# 2. 查看具體 claims
openclaw wiki get --lookup "timeout"

# 3. 檢查矛盾報告
openclaw wiki lint

# 4. 更新 claim 狀態
openclaw wiki apply --op update_metadata \
  --lookup "timeout-config" \
  --claims '[{"text":"Timeout is 60s for production","status":"supported","confidence":0.95}]'
```

---

## 附錄：配置參考

### 完整配置範例

```json
{
  "plugins": {
    "entries": {
      "memory-core": {
        "config": {
          "dreaming": {
            "enabled": true,
            "frequency": "0 3 * * *",
            "timezone": "Asia/Hong_Kong",
            "verboseLogging": true,
            "storage": {
              "mode": "both",
              "separateReports": true
            },
            "phases": {
              "light": {
                "enabled": true,
                "lookbackDays": 2,
                "limit": 100,
                "dedupeSimilarity": 0.9
              },
              "rem": {
                "enabled": true,
                "lookbackDays": 7,
                "limit": 10,
                "minPatternStrength": 0.75
              },
              "deep": {
                "enabled": true,
                "limit": 10,
                "minScore": 0.8,
                "minRecallCount": 3,
                "minUniqueQueries": 3,
                "recencyHalfLifeDays": 14,
                "maxAgeDays": 30
              }
            }
          }
        }
      },
      "memory-wiki": {
        "config": {
          "vaultMode": "bridge",
          "vault": {
            "path": "./.openclaw-wiki",
            "renderMode": "obsidian"
          },
          "obsidian": {
            "enabled": true,
            "useOfficialCli": true,
            "vaultName": "MyVault",
            "openAfterWrites": false
          },
          "bridge": {
            "enabled": true,
            "readMemoryArtifacts": true,
            "indexDreamReports": true,
            "indexDailyNotes": true,
            "indexMemoryRoot": true,
            "followMemoryEvents": true
          },
          "ingest": {
            "autoCompile": true,
            "maxConcurrentJobs": 4,
            "allowUrlIngest": false
          },
          "search": {
            "backend": "local",
            "corpus": "all"
          },
          "context": {
            "includeCompiledDigestPrompt": true
          },
          "render": {
            "preserveHumanBlocks": true,
            "createBacklinks": true,
            "createDashboards": true
          }
        }
      }
    }
  }
}
```

---

## 相關文件

- [OpenClaw Documentation](https://docs.openclaw.ai)
- [MEMORY.md](../MEMORY.md) - 項目記憶文件
- [AGENTS.md](../AGENTS.md) - Agent 行為準則

---

*指南生成者：Kimi Code CLI*
*最後更新：2026-04-08*
