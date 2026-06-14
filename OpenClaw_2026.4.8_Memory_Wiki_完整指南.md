# OpenClaw 2026.4.8 Memory/Wiki 功能完整使用指南

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
9. [與現有記憶系統整合](#與現有記憶系統整合)

---

## 概述

OpenClaw 2026.4.8 引入了全新既 **Memory/Wiki** 功能套件，呢個係一個模仿人類睡眠整理記憶既機制，結合咗 Wiki 知識庫同自動 Dreaming 功能。

### 核心組件

| 組件 | 功能 | 狀態 | 位置 |
|------|------|------|------|
| `memory-wiki` | 持久化 Wiki 編譯器同 Obsidian 友好知識庫 | 需手動啟用 | Plugin |
| `memory-core` | 核心記憶搜索插件（含 Dreaming 功能） | 已啟用 | Core |
| `memory-lancedb` | LanceDB 長期記憶插件 | 需手動啟用 | Plugin |

### 與現有系統既關係

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw 記憶系統架構                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   現有系統 (Auto Dreaming)          新功能 (Memory/Wiki)         │
│   ─────────────────────────         ─────────────────────       │
│                                                                 │
│   L0 Abstract (200字)               Wiki Vault                   │
│   L1 Overview (600字)               Compiled Digest              │
│   L2 Daily (原始)                   Claims/Evidence              │
│   Patterns (分析)                   Freshness Search             │
│                                     REM Preview                  │
│                                                                 │
│   引擎層 (Engine) ←────────────→    存儲層 (Storage)              │
│   - 發現、整理、分析                - 結構化存儲                  │
│   - pattern_analysis                - 三級驗證                   │
│   - cross_session                   - TTL/Decay                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## memory-wiki Plugin 使用方法

### 1. 啟用 Plugin

```bash
# 啟用 memory-wiki 插件
openclaw plugins enable memory-wiki

# 重啟 gateway 以應用變更
openclaw gateway restart

# 檢查狀態
openclaw plugins list | grep memory-wiki
```

### 2. 初始化 Wiki Vault

```bash
# 初始化 wiki vault（會創建 .openclaw-wiki/ 目錄）
openclaw wiki init

# 檢查 vault 狀態
openclaw wiki status

# 輸出範例：
# Vault Status: initialized
# Path: ./.openclaw-wiki
# Mode: isolated
# Pages: 0
# Claims: 0
```

### 3. Vault 模式選擇

memory-wiki 支援三種 vault 模式：

| 模式 | 說明 | 使用場景 |
|------|------|----------|
| `isolated` | 完全隔離既 wiki 存儲 | 預設推薦，最安全 |
| `bridge` | 讀取公開記憶工件同事件 | 與 memory-core 整合，推薦 |
| `unsafe-local` | 實驗性本地路徑訪問 | 需明確啟用，有風險 |

**配置範例（~/.openclaw/config.json）：**

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
# ===== 編譯同構建 =====
# 編譯 wiki vault（生成 digest 同索引）
openclaw wiki compile

# 完整編譯（清除緩存後重新編譯）
openclaw wiki compile --full

# ===== 內容攝取 =====
# 從文件攝取內容到 wiki
openclaw wiki ingest --inputPath ./notes.md --title "My Notes"

# 從 URL 攝取（需啟用 allowUrlIngest）
openclaw wiki ingest --url https://example.com/doc --title "External Doc"

# ===== 搜索 =====
# wiki 本地搜索
openclaw wiki search "關鍵字" --backend local --corpus wiki

# 聯合搜索（wiki + memory）
openclaw wiki search "deployment" --corpus all

# ===== 讀取同修改 =====
# 讀取特定頁面
openclaw wiki get --lookup "page-path"

# 應用變更（創建 synthesis）
openclaw wiki apply --op create_synthesis --title "New Synthesis"

# 更新 claim 元數據
openclaw wiki apply --op update_metadata \
  --lookup "router-config" \
  --claims '[{"text":"VLAN requires subnet","confidence":0.92}]'

# ===== 品質檢查 =====
# 執行 lint 檢查
openclaw wiki lint

# 輸出包含：
# - Missing Evidence（缺少證據既 claims）
# - Contested Claims（有爭議既 claims）
# - Stale Claims（陳舊既 claims）
```

### 5. Obsidian 整合

```bash
# 檢查 Obsidian CLI 狀態
openclaw wiki obsidian status

# 在 Obsidian 中搜索
openclaw wiki obsidian search --query "router configuration"

# 在 Obsidian 中開啟特定頁面
openclaw wiki obsidian open --path "router-config"

# 執行 Obsidian 命令
openclaw wiki obsidian command --id "app:open-settings"

# 開啟 Daily Note
openclaw wiki obsidian daily
```

---

## dreams.md 結構與用途

### 1. 什麼係 Dreaming？

Dreaming 係 OpenClaw 模仿人類睡眠時整理記憶既機制，會自動喺後台整理對話記憶並建立共享知識庫。

**三個階段：**

| 階段 | 頻率 | 功能 | 對應人類睡眠 |
|------|------|------|-------------|
| **Light** | 每 6 小時 | 去重複、整理短期記憶 | 輕度睡眠 |
| **REM** | 每週 | 模式識別、產生候選真理 | 快速眼動 |
| **Deep** | 每日 | 將高價值記憶寫入 MEMORY.md | 深度睡眠 |

### 2. dreams.md 文件結構

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
- Candidate Truth: "VLAN configuration requires explicit subnet definition"

### Pattern 2: Error Handling Pattern
- Occurrences: 8 times
- Confidence: 0.92
- Related queries: "try-catch", "error templates"
- Candidate Truth: "All async functions need try-catch wrapper"

## Deep Phase Promotions
### Promoted to MEMORY.md
1. **Router VLAN Configuration** (score: 0.91)
   - Evidence: 3 recalls, 4 unique queries
   - Source: 2026-04-05-session.md
   - Claim: VLAN requires explicit subnet definition
   
2. **Error Template Pattern** (score: 0.88)
   - Evidence: 5 recalls, 3 unique queries
   - Source: 2026-04-06-session.md
   - Claim: Async functions require error handling

## Open Questions
- How to handle nested error callbacks?
- Best practice for timeout configuration?

## Contradictions Detected
- Timeout value: 30s vs 60s (see router.md vs production.md)
```

### 3. 配置 Dreaming

```bash
# 查看 dreaming 狀態
/dreaming status

# 啟用 dreaming
/dreaming on

# 關閉 dreaming
/dreaming off

# 手動觸發 light phase
/dreaming light

# 手動觸發 rem phase
/dreaming rem
```

**完整配置範例：**

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
              "separateReports": true,
              "path": "memory/dreaming"
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

### 4. 關鍵參數說明

| 參數 | 默認值 | 說明 |
|------|--------|------|
| `light.lookbackDays` | 2 | Light phase 回顧幾多日 |
| `light.dedupeSimilarity` | 0.9 | 去重複相似度門檻 |
| `rem.minPatternStrength` | 0.75 | REM 模式識別最小強度 |
| `deep.minScore` | 0.8 | Deep phase 推廣最小分數 |
| `deep.minRecallCount` | 3 | 最少回憶次數 |
| `deep.recencyHalfLifeDays` | 14 | 時間衰減半衰期 |

---

## REM Preview Tooling 用法

### 1. rem-harness 命令

**用途：** 預覽 REM 反思結果同候選真理，**唔會寫入任何文件**

```bash
# 基本用法 - 預覽當前 REM 結果
openclaw memory rem-harness

# JSON 輸出（方便程式處理）
openclaw memory rem-harness --json

# 包含已推廣既候選（預設會排除）
openclaw memory rem-harness --include-promoted

# 指定特定 agent
openclaw memory rem-harness --agent my-agent

# 限制輸出數量
openclaw memory rem-harness --limit 5
```

**輸出範例：**

```json
{
  "reflections": [
    {
      "pattern": "Router Configuration",
      "occurrences": 5,
      "confidence": 0.85,
      "sources": ["2026-04-05.md", "2026-04-06.md", "2026-04-07.md"],
      "candidateTruth": "VLAN configuration requires explicit subnet definition",
      "relatedQueries": ["router vlan", "network config", "subnet setup"]
    },
    {
      "pattern": "Error Handling",
      "occurrences": 8,
      "confidence": 0.92,
      "sources": ["2026-04-04.md", "2026-04-06.md"],
      "candidateTruth": "All async functions need try-catch wrapper",
      "relatedQueries": ["try-catch", "error templates", "async error"]
    }
  ],
  "deepPromotions": [
    {
      "key": "router-vlan-config",
      "score": 0.91,
      "recallCount": 5,
      "uniqueQueries": 4,
      "snippet": "Router VLAN configuration best practices...",
      "wouldPromote": true,
      "reason": "Meets all criteria"
    },
    {
      "key": "error-handling-async",
      "score": 0.88,
      "recallCount": 8,
      "uniqueQueries": 3,
      "snippet": "Error handling patterns for async functions...",
      "wouldPromote": true,
      "reason": "High confidence and recall count"
    }
  ],
  "timestamp": "2026-04-08T08:00:00Z",
  "totalPatterns": 12,
  "promotableCandidates": 2
}
```

### 2. promote-explain 命令

**用途：** 解釋特定推廣候選既分數計算細節

```bash
# 基本用法
openclaw memory promote-explain "router vlan"

# JSON 輸出
openclaw memory promote-explain "router vlan" --json

# 包含已推廣既候選
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
    "sourcePath": "memory/2026-04-05.md",
    "extractedAt": "2026-04-08T06:00:00Z"
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
    "actualUniqueQueries": 4,
    "recencyScore": 0.95
  },
  "wouldPromote": true,
  "reason": "Meets all promotion criteria",
  "suggestedAction": "Add to MEMORY.md under Technical Patterns"
}
```

### 3. 標準記憶推廣命令

```bash
# 查看推廣候選（唔會寫入）
openclaw memory promote --limit 10

# 模擬推廣（顯示會做咩，但唔會寫入）
openclaw memory promote --dry-run

# 應用推廣（寫入 MEMORY.md）
openclaw memory promote --apply

# 自定義門檻後應用
openclaw memory promote \
  --min-score 0.85 \
  --min-recall-count 5 \
  --apply
```

### 4. 使用流程建議

```bash
# Step 1: 先預覽 REM 結果
openclaw memory rem-harness --json > /tmp/rem_preview.json

# Step 2: 檢查特定候選詳情
openclaw memory promote-explain "router vlan"

# Step 3: 確認無誤後應用
openclaw memory promote --apply

# Step 4: 驗證結果
cat memory/dreaming/DREAMS.md
cat MEMORY.md | grep -A 5 "Router VLAN"
```

---

## Freshness-Weighted Search

### 1. Freshness 等級定義

| 等級 | 說明 | 時間範圍 | 顏色標記 |
|------|------|----------|----------|
| `fresh` | 新鮮 | < 7 日 | 🟢 綠色 |
| `aging` | 老化 | 7-30 日 | 🟡 黃色 |
| `stale` | 陳舊 | > 30 日 | 🔴 紅色 |
| `unknown` | 未知 | 無時間戳 | ⚪ 灰色 |

### 2. Freshness 計算邏輯

```javascript
// 基於以下時間戳計算 freshness
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

**計算規則：**
1. 優先使用 claim 既 `updatedAt`
2. 其次使用最新 evidence 既 `updatedAt`
3. 最後使用 page 既 `updatedAt`
4. 計算距離今日既日數

### 3. 搜索時既 Freshness 加權

```bash
# wiki 搜索（自動應用 freshness 加權）
openclaw wiki search "deployment" --corpus wiki

# memory 搜索（支援 freshness 過濾）
openclaw memory search "deployment"

# 只搜索新鮮內容
openclaw wiki search "deployment" --freshness fresh

# 搜索所有內容但按 freshness 排序
openclaw wiki search "deployment" --corpus all --sort freshness

# 排除陳舊內容
openclaw wiki search "deployment" --exclude-stale
```

### 4. Freshness 排序優先級

喺 compiled digest 中，claims 按以下優先級排序：

1. **Confidence**（置信度）- 最高優先
2. **Freshness**（新鮮度）- 次優先  
3. **Alphabetical**（字母順序）- 最後

```javascript
// 排序邏輯
claims.sort((a, b) => {
  // 1. 置信度（高到低）
  if (b.confidence !== a.confidence) {
    return b.confidence - a.confidence;
  }
  // 2. 新鮮度（新到舊）
  const freshnessOrder = { fresh: 3, aging: 2, stale: 1, unknown: 0 };
  if (freshnessOrder[b.freshnessLevel] !== freshnessOrder[a.freshnessLevel]) {
    return freshnessOrder[b.freshnessLevel] - freshnessOrder[a.freshnessLevel];
  }
  // 3. 字母順序
  return a.text.localeCompare(b.text);
});
```

---

## 結構化 Claim/Evidence 使用方式

### 1. Claim 結構定義

```typescript
interface WikiClaim {
  id?: string;              // 唯一標識符（可選）
  text: string;             // 聲稱內容（必填）
  status?: string;          // 狀態：supported|contested|refuted|superseded
  confidence?: number;      // 置信度：0-1
  freshnessLevel?: string;  // 新鮮度：fresh|aging|stale
  evidence: WikiClaimEvidence[];
  updatedAt?: string;       // ISO 8601 時間戳
  tags?: string[];          // 標籤
}

interface WikiClaimEvidence {
  source: string;           // 來源路徑（必填）
  quote?: string;           // 引用內容
  updatedAt?: string;       // 時間戳
  context?: string;         // 上下文說明
}
```

### 2. Markdown 中既 Claim 表示

```markdown
# Router Configuration Guide

## Claims

- [claim::router-vlan-required] VLAN configuration requires explicit subnet definition
  - status: supported
  - confidence: 0.92
  - freshness: fresh
  - tags: [network, vlan, router]
  - evidence:
    - source: memory/2026-04-05.md
      quote: "When configuring VLANs, always define the subnet explicitly"
      updatedAt: 2026-04-05T14:00:00Z
    - source: docs/network-guide.md
      quote: "VLAN without subnet definition causes routing issues"
      updatedAt: 2026-03-20T10:00:00Z

- [claim::router-timeout-default] Default timeout is 30 seconds
  - status: contested
  - confidence: 0.65
  - freshness: aging
  - tags: [config, timeout]
  - evidence:
    - source: memory/2026-03-20.md
      quote: "Timeout should be 30s"
      updatedAt: 2026-03-20T10:00:00Z
    - source: memory/2026-04-01.md
      quote: "Changed timeout to 60s for production"
      updatedAt: 2026-04-01T16:00:00Z

## Contradictions

- [contradiction::timeout] Conflicting timeout values reported (30s vs 60s)
  - severity: medium
  - related: [router-timeout-default]
  - suggestedResolution: "Verify production vs development settings"

## Open Questions

- [question::timeout-high-latency] What is the recommended timeout for high-latency networks?
  - priority: low
  - context: Current docs don't cover WAN scenarios
```

### 3. 使用 CLI 創建 Claim

```bash
# 創建 synthesis 頁面並添加 claim
openclaw wiki apply --op create_synthesis \
  --title "Router Configuration Best Practices" \
  --body "## Summary

VLAN configuration requires careful planning." \
  --claims '[{
    "text": "VLAN requires explicit subnet",
    "confidence": 0.92,
    "evidence": [
      {"source": "memory/2026-04-05.md", "quote": "Always define subnet"}
    ]
  }]'

# 更新現有 claim
openclaw wiki apply --op update_metadata \
  --lookup "router-config" \
  --claims '[{
    "id": "router-timeout-default",
    "status": "superseded",
    "confidence": 0.95,
    "text": "Production timeout is 60s"
  }]'
```

### 4. Claim 狀態說明

| 狀態 | 說明 | 使用場景 |
|------|------|----------|
| `supported` | 已確認 | 有足夠證據支持 |
| `contested` | 有爭議 | 證據矛盾或不充分 |
| `refuted` | 被反駁 | 有新證據否定 |
| `superseded` | 被取代 | 有更準確既新版本 |

### 5. Claim 健康檢查

```bash
# 執行 lint 檢查
openclaw wiki lint

# 輸出範例：
# === Wiki Lint Report ===
# 
# Missing Evidence:
#   - claim::router-dns (page: network.md)
# 
# Contested Claims:
#   - claim::router-timeout-default (2 conflicting sources)
# 
# Stale Claims (>30 days):
#   - claim::old-config (last updated: 2026-02-01)
#
# Suggested Actions:
#   1. Add evidence to router-dns claim
#   2. Resolve timeout contradiction
#   3. Review and update old-config
```

---

## Compiled Digest 獲取方式

### 1. 什麼係 Compiled Digest？

Compiled Digest 係 AI 可消費既摘要格式，包含：
- 高價值頁面摘要（最多 4 頁）
- Top Claims（每頁最多 2 個）
- 矛盾集群統計
- 開放問題列表

**位置：**
```
.openclaw-wiki/cache/agent-digest.json
```

### 2. 生成 Digest

```bash
# 編譯 vault（會生成/更新 digest）
openclaw wiki compile

# 查看狀態（顯示 digest 信息）
openclaw wiki status

# 輸出範例：
# Vault Status: compiled
# Pages: 12
# Claims: 45
# Contradictions: 2
# Digest: .openclaw-wiki/cache/agent-digest.json (updated 5 mins ago)
```

### 3. Digest 結構

```json
{
  "version": "2026.4.8",
  "generatedAt": "2026-04-08T08:00:00Z",
  "claimCount": 150,
  "pages": [
    {
      "title": "Router Configuration",
      "kind": "synthesis",
      "claimCount": 12,
      "freshnessDistribution": {
        "fresh": 8,
        "aging": 3,
        "stale": 1
      },
      "topClaims": [
        {
          "text": "VLAN requires explicit subnet",
          "confidence": 0.92,
          "freshnessLevel": "fresh",
          "status": "supported",
          "evidenceCount": 3
        },
        {
          "text": "Default timeout is 30s",
          "confidence": 0.65,
          "freshnessLevel": "aging",
          "status": "contested",
          "evidenceCount": 2
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
      "severity": "medium",
      "entries": [
        {"pagePath": "router.md", "status": "supported"},
        {"pagePath": "production.md", "status": "contested"}
      ]
    }
  ],
  "openQuestions": [
    {
      "text": "What is the recommended timeout for high-latency networks?",
      "priority": "low",
      "relatedPages": ["router.md"]
    }
  ],
  "statistics": {
    "totalPages": 12,
    "totalClaims": 150,
    "freshClaims": 89,
    "agingClaims": 45,
    "staleClaims": 16,
    "contestedClaims": 5,
    "openQuestions": 3
  }
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
            "includeCompiledDigestPrompt": true,
            "digestMaxClaims": 10,
            "digestMaxPages": 4
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

Compiled wiki currently tracks 150 claims across 12 pages.
- Fresh claims: 89
- Aging claims: 45  
- Stale claims: 16
- Contested claims: 5
- Contradiction clusters: 3
- Open questions: 3

### High-Signal Pages:

1. **Router Configuration** (synthesis, 12 claims)
   - VLAN requires explicit subnet (confidence 0.92, freshness fresh)
   - Default timeout is 30s (confidence 0.65, freshness aging, status contested)
   - Open: Timeout recommendation?
   - Contradiction: Conflicting timeout values

2. **Error Handling** (synthesis, 8 claims)
   - All async functions need try-catch (confidence 0.95, freshness fresh)
```

### 5. 直接讀取 Digest

```javascript
// Node.js 範例
const fs = require('fs');
const path = require('path');

const digestPath = path.join(process.env.HOME, '.openclaw-wiki', 'cache', 'agent-digest.json');
const digest = JSON.parse(fs.readFileSync(digestPath, 'utf8'));

console.log(`Total claims: ${digest.claimCount}`);
console.log(`Fresh claims: ${digest.statistics.freshClaims}`);
console.log(`Open questions: ${digest.openQuestions.length}`);

digest.pages.forEach(page => {
  console.log(`\n📄 ${page.title}`);
  console.log(`   Claims: ${page.claimCount}`);
  page.topClaims.forEach(claim => {
    const icon = claim.freshnessLevel === 'fresh' ? '🟢' : 
                 claim.freshnessLevel === 'aging' ? '🟡' : '🔴';
    console.log(`   ${icon} ${claim.text} (${claim.confidence})`);
  });
});
```

```python
# Python 範例
import json
from pathlib import Path

digest_path = Path.home() / ".openclaw-wiki" / "cache" / "agent-digest.json"
with open(digest_path) as f:
    digest = json.load(f)

print(f"Total claims: {digest['claimCount']}")
print(f"Contradictions: {len(digest['contradictionClusters'])}")

# 找出所有 contested claims
for page in digest['pages']:
    contested = [c for c in page['topClaims'] if c['status'] == 'contested']
    if contested:
        print(f"\n⚠️  {page['title']} has contested claims:")
        for claim in contested:
            print(f"   - {claim['text']}")
```

---

## 實際應用場景

### 場景 1：建立項目知識庫

```bash
#!/bin/bash
# setup_project_wiki.sh

echo "🚀 設置項目 Wiki..."

# 1. 啟用插件
openclaw plugins enable memory-wiki

# 2. 初始化 vault
openclaw wiki init

# 3. 攝取現有文檔
echo "📥 攝取文檔..."
openclaw wiki ingest --inputPath ./README.md --title "Project Overview"
openclaw wiki ingest --inputPath ./docs/api.md --title "API Documentation"
openclaw wiki ingest --inputPath ./docs/architecture.md --title "Architecture"

# 4. 編譯並檢查
echo "🔨 編譯 Wiki..."
openclaw wiki compile

echo "🔍 品質檢查..."
openclaw wiki lint

# 5. 搜索測試
echo "✅ 設置完成！測試搜索："
openclaw wiki search "authentication"
```

### 場景 2：會議記錄整理流程

```bash
#!/bin/bash
# meeting_workflow.sh

MEETING_FILE="$1"
MEETING_TITLE="$2"

if [ -z "$MEETING_FILE" ]; then
    echo "Usage: $0 <meeting-file.md> <title>"
    exit 1
fi

echo "📝 處理會議記錄: $MEETING_TITLE"

# 1. 攝取會議記錄
openclaw wiki ingest --inputPath "$MEETING_FILE" --title "$MEETING_TITLE"

# 2. 編譯提取 claims
echo "🔨 編譯提取 claims..."
openclaw wiki compile

# 3. 查看生成既 claims
echo "📋 提取既 claims:"
openclaw wiki get --lookup "$MEETING_TITLE"

# 4. 檢查矛盾
echo "⚠️ 檢查矛盾..."
openclaw wiki lint

# 5. 生成 digest
echo "📊 當前 Wiki 狀態:"
openclaw wiki status
```

### 場景 3：使用 Dreaming 自動整理

```bash
#!/bin/bash
# dreaming_workflow.sh

echo "🌙 Dreaming 自動整理流程"

# 1. 檢查 dreaming 狀態
openclaw memory rem-harness --json > /tmp/rem_preview.json

# 2. 分析結果
PROMOTABLE=$(cat /tmp/rem_preview.json | jq '.deepPromotions | length')
echo "找到 $PROMOTABLE 個可推廣候選"

# 3. 詳細檢查每個候選
for key in $(cat /tmp/rem_preview.json | jq -r '.deepPromotions[].key'); do
    echo "🔍 檢查: $key"
    openclaw memory promote-explain "$key" --json | jq '.scoreBreakdown'
done

# 4. 用戶確認後應用
echo "是否要應用推廣? (y/n)"
read confirm
if [ "$confirm" = "y" ]; then
    openclaw memory promote --apply
    echo "✅ 已應用推廣"
    
    # 5. 查看更新
    echo "📄 查看最新 DREAMS.md:"
    cat memory/dreaming/DREAMS.md | tail -50
else
    echo "❌ 已取消"
fi
```

### 場景 4：Obsidian 整合工作流

```bash
#!/bin/bash
# obsidian_workflow.sh

echo "🎨 Obsidian 整合工作流"

# 配置 Obsidian 模式
openclaw config set plugins.entries.memory-wiki.config.vault.renderMode obsidian
openclaw config set plugins.entries.memory-wiki.config.obsidian.enabled true
openclaw config set plugins.entries.memory-wiki.config.obsidian.openAfterWrites false

# 日常維護循環
echo "🔄 執行日常維護..."

# 匯入最新記憶
echo "📥 匯入記憶..."
openclaw wiki bridge import

# 編譯更新
echo "🔨 編譯..."
openclaw wiki compile

# 品質檢查
echo "🔍 品質檢查..."
openclaw wiki lint

# 在 Obsidian 中開啟 Daily Note
echo "📓 開啟 Daily Note..."
openclaw wiki obsidian daily

echo "✅ 完成！"
```

### 場景 5：矛盾檢測與解決

```bash
#!/bin/bash
# contradiction_resolution.sh

echo "⚠️ 矛盾檢測與解決"

# 1. 搜索可能有矛盾既資訊
echo "🔍 搜索 timeout configuration..."
openclaw wiki search "timeout configuration" --corpus all

# 2. 查看具體 claims
echo "📄 查看 timeout 相關 claims..."
openclaw wiki get --lookup "timeout"

# 3. 檢查矛盾報告
echo "⚠️ 檢查矛盾..."
openclaw wiki lint > /tmp/lint_report.txt
cat /tmp/lint_report.txt

# 4. 讀取 digest 獲取詳細矛盾信息
echo "📊 矛盾詳情:"
cat .openclaw-wiki/cache/agent-digest.json | jq '.contradictionClusters'

# 5. 更新 claim 狀態（解決矛盾後）
echo "是否更新 claim 狀態? (y/n)"
read confirm
if [ "$confirm" = "y" ]; then
    openclaw wiki apply --op update_metadata \
      --lookup "timeout-config" \
      --claims '[{
        "text": "Production timeout is 60s",
        "status": "supported",
        "confidence": 0.95
      }]'
    echo "✅ 已更新"
fi
```

### 場景 6：Freshness 審計

```bash
#!/bin/bash
# freshness_audit.sh

echo "🟢🟡🔴 Freshness 審計報告"

# 讀取 digest
DIGEST=".openclaw-wiki/cache/agent-digest.json"

echo ""
echo "=== 新鮮度分佈 ==="
cat $DIGEST | jq '.statistics | {fresh, aging, stale}'

echo ""
echo "=== 陳舊 Claims (需審閱) ==="
cat $DIGEST | jq '.pages[] | select(.freshnessDistribution.stale > 0) | {title, stale: .freshnessDistribution.stale}'

echo ""
echo "=== Aging Claims (即將過期) ==="
cat $DIGEST | jq '.pages[] | select(.freshnessDistribution.aging > 3) | {title, aging: .freshnessDistribution.aging}'

echo ""
echo "建議行動:"
echo "1. 審閱陳舊 claims，確認是否仍有效"
echo "2. 更新即將過期既重要 claims"
echo "3. 考慮歸檔或刪除無效 claims"
```

---

## 與現有記憶系統整合

### 與 L0/L1/L2 既關係

```
┌─────────────────────────────────────────────────────────────────┐
│                    整合架構圖                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   現有記憶系統                        新 Wiki 系統               │
│   ─────────────                       ─────────────             │
│                                                                 │
│   L2 Daily (原始) ─────────────┐                                 │
│                                │                                 │
│   L1 Overview (600字) ────────┼──→ Wiki Ingest ──→ Claims       │
│                                │         ↓                       │
│   L0 Abstract (200字) ─────────┘    Compiled Digest              │
│                                          ↓                       │
│   Patterns (分析) ─────────────────→ Contradictions              │
│                                          ↓                       │
│                                    MEMORY.md (整合)              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 數據流向

| 來源 | 目標 | 方式 | 頻率 |
|------|------|------|------|
| L1 Overview | Wiki | Bridge import | 每日 |
| L2 Daily | Dreaming | Pattern extraction | 每週 |
| Dreaming Reports | Wiki Claims | REM → Deep | 每週 |
| Wiki Claims | MEMORY.md | Promote --apply | 按需 |

### 推薦配置

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
            }
          }
        }
      },
      "memory-wiki": {
        "config": {
          "vaultMode": "bridge",
          "bridge": {
            "enabled": true,
            "readMemoryArtifacts": true,
            "indexDreamReports": true,
            "indexDailyNotes": true
          },
          "ingest": {
            "autoCompile": true,
            "maxConcurrentJobs": 4
          },
          "context": {
            "includeCompiledDigestPrompt": true
          }
        }
      }
    }
  },
  "cron": {
    "jobs": [
      {
        "name": "wiki-compile",
        "schedule": "0 4 * * *",
        "command": "openclaw wiki compile"
      },
      {
        "name": "wiki-lint",
        "schedule": "0 5 * * 0",
        "command": "openclaw wiki lint"
      }
    ]
  }
}
```

---

## 附錄：命令速查表

### Wiki 命令

| 命令 | 用途 |
|------|------|
| `openclaw wiki init` | 初始化 vault |
| `openclaw wiki compile` | 編譯 wiki |
| `openclaw wiki status` | 查看狀態 |
| `openclaw wiki lint` | 品質檢查 |
| `openclaw wiki search <query>` | 搜索 |
| `openclaw wiki get --lookup <path>` | 讀取頁面 |
| `openclaw wiki ingest --inputPath <file>` | 攝取文件 |
| `openclaw wiki apply --op <op>` | 應用變更 |

### Memory 命令

| 命令 | 用途 |
|------|------|
| `openclaw memory rem-harness` | 預覽 REM 結果 |
| `openclaw memory promote-explain <key>` | 解釋候選 |
| `openclaw memory promote --apply` | 應用推廣 |
| `openclaw memory search <query>` | 搜索記憶 |

### Obsidian 命令

| 命令 | 用途 |
|------|------|
| `openclaw wiki obsidian status` | 檢查狀態 |
| `openclaw wiki obsidian search` | Obsidian 搜索 |
| `openclaw wiki obsidian open` | 開啟頁面 |
| `openclaw wiki obsidian daily` | Daily Note |

### Dreaming 命令

| 命令 | 用途 |
|------|------|
| `/dreaming status` | 查看狀態 |
| `/dreaming on/off` | 啟用/停用 |
| `/dreaming light` | 手動觸發 light |
| `/dreaming rem` | 手動觸發 REM |

---

## 相關文件

- [OpenClaw Documentation](https://docs.openclaw.ai)
- [MEMORY.md](./MEMORY.md) - 項目記憶文件
- [AGENTS.md](./AGENTS.md) - Agent 行為準則
- [memory-architecture.md](./docs/memory-architecture.md) - 記憶系統架構

---

*指南生成者：Ally (OpenClaw HA)*
*最後更新：2026-04-08*
*版本：2026.4.8*
