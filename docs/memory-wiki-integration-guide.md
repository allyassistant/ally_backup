# Memory-Wiki 整合方案 - OpenClaw HA 系統

*版本：2026.4.8 | Ally 專用 | Bliss Offline Mode*

---

## 1. 系統整合概覽

### 1.1 現有系統架構

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      OpenClaw HA 記憶系統架構                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   現有系統 (L0/L1/L2)              Memory-Wiki 系統                        │
│   ───────────────────              ────────────────                       │
│                                                                         │
│   L2 Daily (原始對話) ─────┐                                            │
│                            ├──→ Bridge Import ──→ Wiki Vault            │
│   L1 Overview (600字) ─────┤         ↓                                 │
│                            │    Claims & Evidence                       │
│   L0 Abstract (200字) ─────┘         ↓                                 │
│                               Compiled Digest                            │
│   Patterns (分析) ───────────→  Contradictions                           │
│                                         ↓                              │
│   Errors (錯誤追蹤) ─────────→  Error Claims                             │
│                                         ↓                              │
│                                   MEMORY.md (整合)                       │
│                                                                         │
│   Issues (.issues/) ─────────→  Issue Claims                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 整合價值

| 功能 | 現有系統 | + Memory-Wiki | 效果 |
|------|----------|---------------|------|
| 知識檢索 | 關鍵字搜索 | Freshness 加權 + Confidence 排序 | 更準確 |
| 矛盾檢測 | 人工檢查 | 自動 Contradiction Detection | 更及時 |
| 知識驗證 | 無 | Claim/Evidence 結構 | 可追溯 |
| 跨 Session | Bootstrap 恢復 | Compiled Digest 預加載 | 更快速 |

---

## 2. 詳細整合 Workflow

### 2.1 每日 Workflow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   03:00     │───→│   04:00     │───→│   06:00     │───→│   23:59     │
│  Dreaming   │    │  Wiki       │    │  L1         │    │  Daily      │
│  REM Phase  │    │  Compile    │    │  Generate   │    │  Report     │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
       │                  │                  │                  │
       ▼                  ▼                  ▼                  ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Pattern     │    │ Update      │    │ Ingest to   │    │ Send to     │
│ Extraction  │    │ Digest      │    │ Wiki        │    │ Discord     │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

### 2.2 Session 啟動 Workflow

```
Session Start
     │
     ▼
┌─────────────────┐
│ 1. Read SOUL.md │
│ 2. Read USER.md │
│ 3. Read MEMORY  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     No
│ Wiki Digest     │────────→ 正常啟動
│ Available?      │
└────────┬────────┘
         │ Yes
         ▼
┌─────────────────┐
│ Load Digest     │
│ agent-digest.json
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Extract Key     │
│ Claims (Top 10) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Inject to       │
│ Context         │
└─────────────────┘
```

### 2.3 Issue 整合 Workflow

```
Issue Created/Updated
         │
         ▼
┌─────────────────┐
│ Extract Claims  │
│ from Issue      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Create Wiki     │
│ Page (if major) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Add Claims:     │
│ - Problem       │
│ - Solution      │
│ - Prevention    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Compile &       │
│ Update Digest   │
└─────────────────┘
```

### 2.4 Error 整合 Workflow

```
Error Detected
      │
      ▼
┌─────────────────┐
│ Log to          │
│ errors.json     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Pattern Match   │
│ Existing?       │
└────────┬────────┘
    Yes /    \ No
       ▼      ▼
┌─────────┐  ┌─────────────────┐
│ Update  │  │ Create Error    │
│ Count   │  │ Claim in Wiki   │
└─────────┘  └────────┬────────┘
                      │
                      ▼
             ┌─────────────────┐
             │ If Severity ≥ 3 │
             │ Create Issue    │
             └─────────────────┘
```

---

## 3. 建議配置 (Config JSON)

### 3.1 主要配置檔案

**`~/.openclaw/config.json`**

```json
{
  "version": "2026.4.8",
  "agent": {
    "name": "Ally",
    "role": "conversation-specialist",
    "ha_mode": "primary"
  },
  "plugins": {
    "entries": {
      "memory-core": {
        "enabled": true,
        "config": {
          "storage": {
            "basePath": "~/.openclaw/workspace/memory"
          },
          "dreaming": {
            "enabled": true,
            "frequency": "0 3 * * *",
            "timezone": "Asia/Hong_Kong",
            "verboseLogging": true,
            "storage": {
              "mode": "both",
              "separateReports": true,
              "path": "~/.openclaw/workspace/memory/dreaming"
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
        "enabled": true,
        "config": {
          "vaultMode": "bridge",
          "vault": {
            "path": "~/.openclaw/workspace/.openclaw-wiki",
            "renderMode": "obsidian"
          },
          "bridge": {
            "enabled": true,
            "readMemoryArtifacts": true,
            "indexDreamReports": true,
            "indexDailyNotes": true,
            "indexErrors": true,
            "indexIssues": true,
            "paths": {
              "l0Abstracts": "~/.openclaw/workspace/memory/l0-abstract",
              "l1Overviews": "~/.openclaw/workspace/memory/l1-overview",
              "dreaming": "~/.openclaw/workspace/memory/dreaming",
              "errors": "~/.openclaw/workspace/memory/errors.json",
              "issues": "~/.openclaw/workspace/.issues",
              "patterns": "~/.openclaw/workspace/memory/patterns"
            }
          },
          "ingest": {
            "autoCompile": true,
            "maxConcurrentJobs": 4,
            "defaultFreshness": "fresh"
          },
          "context": {
            "includeCompiledDigestPrompt": true,
            "digestMaxClaims": 10,
            "digestMaxPages": 4,
            "digestMinConfidence": 0.75
          },
          "obsidian": {
            "enabled": true,
            "useOfficialCli": false,
            "openAfterWrites": false
          },
          "claims": {
            "autoExtract": true,
            "minConfidence": 0.7,
            "requireEvidence": true,
            "defaultStatus": "supported"
          }
        }
      },
      "memory-lancedb": {
        "enabled": false,
        "config": {
          "path": "~/.openclaw/workspace/memory/lancedb"
        }
      }
    }
  },
  "integration": {
    "discord": {
      "enabled": true,
      "channelId": "${DISCORD_CHANNEL_ID}",
      "webhookUrl": "${DISCORD_WEBHOOK_URL}"
    },
    "crossSession": {
      "enabled": true,
      "bootstrapScript": "~/.openclaw/workspace/scripts/cross_session_bootstrap.js",
      "useWikiDigest": true
    }
  }
}
```

### 3.2 環境變數配置

**`~/.openclaw/.env`**

```bash
# Discord Integration
DISCORD_CHANNEL_ID=your_channel_id
DISCORD_WEBHOOK_URL=your_webhook_url

# Wiki Configuration
WIKI_VAULT_PATH=~/.openclaw/workspace/.openclaw-wiki
WIKI_AUTO_COMPILE=true

# Dreaming Configuration
DREAMING_ENABLED=true
DREAMING_TIMEZONE=Asia/Hong_Kong

# HA Configuration
HA_NODE_ID=ally-mac-a
HA_PARTNER_NODE=bliss-mac-b
HA_FAILOVER_ENABLED=true
```

---

## 4. Session Reset 後處理流程

### 4.1 正常啟動序列

```bash
#!/bin/bash
# ~/.openclaw/workspace/scripts/session_startup.sh
# Session 啟動腳本 - 整合 Memory-Wiki

set -e

echo "🚀 OpenClaw Session Startup (Ally)"
echo "=================================="
echo ""

# 1. 基礎檔案檢查
echo "📋 Step 1: 檢查基礎檔案..."
if [ ! -f "~/.openclaw/workspace/SOUL.md" ]; then
    echo "⚠️  Warning: SOUL.md not found"
fi
if [ ! -f "~/.openclaw/workspace/USER.md" ]; then
    echo "⚠️  Warning: USER.md not found"
fi
if [ ! -f "~/.openclaw/workspace/MEMORY.md" ]; then
    echo "⚠️  Warning: MEMORY.md not found"
fi
echo "✅ 基礎檔案檢查完成"
echo ""

# 2. 檢查 Wiki Vault 狀態
echo "📋 Step 2: 檢查 Wiki Vault..."
if [ -d "~/.openclaw/workspace/.openclaw-wiki" ]; then
    echo "✅ Wiki Vault 已初始化"
    
    # 檢查 Digest
    if [ -f "~/.openclaw/workspace/.openclaw-wiki/cache/agent-digest.json" ]; then
        DIGEST_AGE=$(stat -c %Y ~/.openclaw/workspace/.openclaw-wiki/cache/agent-digest.json)
        NOW=$(date +%s)
        AGE_HOURS=$(( (NOW - DIGEST_AGE) / 3600 ))
        echo "📊 Digest 年齡: ${AGE_HOURS} 小時"
        
        if [ $AGE_HOURS -gt 24 ]; then
            echo "⚠️  Digest 過期，建議重新編譯"
        fi
    else
        echo "⚠️  Digest 不存在，需要編譯"
    fi
else
    echo "⚠️  Wiki Vault 未初始化"
    echo "📝 建議運行: openclaw wiki init"
fi
echo ""

# 3. 檢查 Bliss 狀態 (HA)
echo "📋 Step 3: 檢查 HA 狀態..."
~/.openclaw/workspace/scripts/failover_detector.sh
echo ""

# 4. 載入 Cross-Session Context
echo "📋 Step 4: 載入 Cross-Session Context..."
if [ -f "~/.openclaw/workspace/scripts/cross_session_bootstrap.js" ]; then
    node ~/.openclaw/workspace/scripts/cross_session_bootstrap.js
    echo "✅ Cross-Session Context 載入完成"
else
    echo "⚠️  Bootstrap script not found"
fi
echo ""

# 5. 載入 Wiki Digest (如果啟用)
echo "📋 Step 5: 載入 Wiki Digest..."
DIGEST_FILE="~/.openclaw/workspace/.openclaw-wiki/cache/agent-digest.json"
if [ -f "$DIGEST_FILE" ]; then
    echo "📊 Wiki Digest 統計:"
    echo "   Total Claims: $(cat $DIGEST_FILE | jq -r '.claimCount // 0')"
    echo "   Fresh Claims: $(cat $DIGEST_FILE | jq -r '.statistics.freshClaims // 0')"
    echo "   Contested: $(cat $DIGEST_FILE | jq -r '.statistics.contestedClaims // 0')"
    echo ""
    echo "🔑 Top Claims (Auto-Injected):"
    cat $DIGEST_FILE | jq -r '.pages[0:2] | .[] | "\n📄 \(.title)\n   Top Claims:" + (.topClaims[0:2] | map("\n   • \(.text) (\(.confidence))") | join(""))'
    echo ""
fi
echo ""

echo "=================================="
echo "✅ Session Startup 完成"
echo ""
echo "💡 可用命令:"
echo "   openclaw wiki status    - 查看 Wiki 狀態"
echo "   openclaw wiki search    - 搜索 Wiki"
echo "   openclaw memory rem-harness - 預覽 REM"
echo ""
```

### 4.2 Session Reset 後自動恢復

當 Session Reset 發生時，Memory-Wiki 提供以下恢復機制：

| 恢復來源 | 內容 | 優先級 |
|----------|------|--------|
| `MEMORY.md` | 長期記憶、重要資訊 | P0 |
| Wiki Digest | Compiled claims, patterns | P1 |
| Cross-Session | 近期對話主題 | P2 |
| L0/L1/L2 | 詳細歷史記錄 | P3 |

**恢復流程：**

```
Session Reset Detected
         │
         ▼
┌─────────────────┐
│ 1. Read MEMORY  │
│    (Critical)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 2. Load Digest  │
│    (Quick Context)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3. Check Issues │
│    (Active)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 4. Load Recent  │
│    Patterns     │
└─────────────────┘
```

---

## 5. Crontab 設定建議

### 5.1 完整 Crontab 配置

```bash
# ~/.openclaw/workspace/.crontab
# OpenClaw Memory-Wiki 整合系統 Cron Jobs
# 運行環境: Ally (Mac A) - Bliss Offline Mode

# ============================================================================
# 每分鐘 - HA Heartbeat
# ============================================================================
* * * * * ~/.openclaw/workspace/scripts/heartbeat.sh >> ~/.openclaw/workspace/logs/heartbeat.log 2>&1

# ============================================================================
# 每 3 分鐘 - Failover Detection
# ============================================================================
*/3 * * * * ~/.openclaw/workspace/scripts/failover_detector.sh >> ~/.openclaw/workspace/logs/failover.log 2>&1

# ============================================================================
# 每日 03:00 - Dreaming REM Phase
# 提取模式、生成候選真理
# ============================================================================
0 3 * * * cd ~/.openclaw/workspace && /usr/local/bin/openclaw memory rem-harness --json > memory/dreaming/rem-preview.json 2>&1

# ============================================================================
# 每日 04:00 - Wiki Compile
# 編譯 Wiki Vault，更新 Digest
# ============================================================================
0 4 * * * cd ~/.openclaw/workspace && /usr/local/bin/openclaw wiki compile >> logs/wiki-compile.log 2>&1

# ============================================================================
# 每日 04:30 - Bridge Import
# 從 L0/L1/L2 導入到 Wiki
# ============================================================================
30 4 * * * cd ~/.openclaw/workspace && /usr/local/bin/openclaw wiki bridge import >> logs/wiki-bridge.log 2>&1

# ============================================================================
# 每日 05:00 - Wiki Lint
# 品質檢查、矛盾檢測
# ============================================================================
0 5 * * * cd ~/.openclaw/workspace && /usr/local/bin/openclaw wiki lint > logs/wiki-lint-$(date +\%Y\%m\%d).log 2>&1

# ============================================================================
# 每日 05:30 - Error Pattern Analysis
# 分析錯誤模式，更新 Error Claims
# ============================================================================
30 5 * * * cd ~/.openclaw/workspace && node scripts/error_pattern_analyzer.js >> logs/error-analysis.log 2>&1

# ============================================================================
# 每日 06:00 - L1 Generator (Bliss Offline 時 Ally 接管)
# ============================================================================
0 6 * * * cd ~/.openclaw/workspace && ~/.openclaw/workspace/scripts/l1_generator.sh >> logs/l1-generator.log 2>&1

# ============================================================================
# 每日 23:59 - Daily Report
# 發送每日摘要到 Discord
# ============================================================================
59 23 * * * cd ~/.openclaw/workspace && node scripts/daily_report.js >> logs/daily-report.log 2>&1

# ============================================================================
# 每週日 03:00 - 完整備份 (原有)
# ============================================================================
0 3 * * 0 ~/.openclaw/workspace/scripts/openclaw_guard.sh auto >> ~/.openclaw/workspace/memory/backup.log 2>&1

# ============================================================================
# 每週日 06:00 - Weekly Wiki Review
# 生成每週 Wiki 報告
# ============================================================================
0 6 * * 0 cd ~/.openclaw/workspace && node scripts/weekly_wiki_report.js >> logs/weekly-report.log 2>&1

# ============================================================================
# 每月 1 日 04:00 - Monthly Archive
# 歸檔舊 Claims
# ============================================================================
0 4 1 * * cd ~/.openclaw/workspace && /usr/local/bin/openclaw wiki apply --op archive_stale >> logs/wiki-archive.log 2>&1
```

### 5.2 Cron Job 說明

| 時間 | 任務 | 目的 | Bliss Offline 處理 |
|------|------|------|-------------------|
| * * * * | Heartbeat | HA 狀態同步 | Ally 執行 |
| */3 * * * | Failover Check | 檢測 Bliss 狀態 | Ally 執行 |
| 03:00 | Dreaming REM | 模式提取 | Ally 接管 |
| 04:00 | Wiki Compile | 編譯 Digest | Ally 執行 |
| 04:30 | Bridge Import | 導入記憶 | Ally 執行 |
| 05:00 | Wiki Lint | 品質檢查 | Ally 執行 |
| 05:30 | Error Analysis | 錯誤分析 | Ally 執行 |
| 06:00 | L1 Generator | 生成 L1 | Ally 接管 |
| 23:59 | Daily Report | 每日報告 | Ally 執行 |

### 5.3 啟用 Crontab

```bash
# 安裝 crontab
crontab ~/.openclaw/workspace/.crontab

# 驗證安裝
crontab -l

# 查看運行日誌
tail -f ~/.openclaw/workspace/logs/wiki-compile.log
tail -f ~/.openclaw/workspace/logs/wiki-lint-*.log
```

---

## 6. 實用命令範例

### 6.1 Wiki 管理命令

```bash
# 初始化 Wiki Vault
openclaw wiki init

# 查看狀態
openclaw wiki status

# 編譯 Wiki
openclaw wiki compile

# 完整編譯（清除緩存）
openclaw wiki compile --full

# 品質檢查
openclaw wiki lint

# 搜索
openclaw wiki search "router configuration"
openclaw wiki search "error handling" --corpus all

# 攝取文件
openclaw wiki ingest --inputPath ./docs/api.md --title "API Documentation"

# 讀取頁面
openclaw wiki get --lookup "router-config"

# Bridge 導入
openclaw wiki bridge import
```

### 6.2 Memory 管理命令

```bash
# 預覽 REM 結果
openclaw memory rem-harness
openclaw memory rem-harness --json

# 解釋推廣候選
openclaw memory promote-explain "router vlan"

# 應用推廣
openclaw memory promote --apply

# 搜索記憶
openclaw memory search "deployment"

# Dreaming 控制
/dreaming status
/dreaming on
/dreaming light
/dreaming rem
```

### 6.3 整合腳本範例

**`scripts/wiki_issue_sync.js`** - Issue 同步到 Wiki

```javascript
#!/usr/bin/env node
/**
 * Issue → Wiki Sync Script
 * 將 active issues 同步到 Wiki Claims
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ISSUES_DIR = path.join(process.env.HOME, '.openclaw/workspace/.issues/active');
const WIKI_VAULT = path.join(process.env.HOME, '.openclaw/workspace/.openclaw-wiki');

function syncIssuesToWiki() {
  console.log('🔄 Syncing Issues to Wiki...\n');
  
  const issues = fs.readdirSync(ISSUES_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const content = fs.readFileSync(path.join(ISSUES_DIR, f), 'utf8');
      const title = content.match(/^#\s+(.+)$/m)?.[1] || f;
      const problem = content.match(/##\s*Problem\s*\n+(.+?)(?=\n##|$)/s)?.[1]?.trim();
      const solution = content.match(/##\s*Solution\s*\n+(.+?)(?=\n##|$)/s)?.[1]?.trim();
      
      return { file: f, title, problem, solution };
    });
  
  console.log(`Found ${issues.length} active issues\n`);
  
  // 為每個 Issue 創建 Wiki Page
  issues.forEach(issue => {
    const pageName = `issue-${issue.file.replace('.md', '')}`;
    const pagePath = path.join(WIKI_VAULT, 'issues', `${pageName}.md`);
    
    const content = `# ${issue.title}

## Claims

- [claim::${pageName}-problem] ${issue.problem || 'Problem statement'}
  - status: supported
  - confidence: 0.85
  - freshness: fresh
  - evidence:
    - source: .issues/active/${issue.file}
      quote: "Issue tracked in active issues"

${issue.solution ? `- [claim::${pageName}-solution] ${issue.solution}
  - status: supported
  - confidence: 0.80
  - freshness: fresh` : ''}

## Metadata

- source: ${issue.file}
- synced_at: ${new Date().toISOString()}
- type: issue
`;
    
    fs.mkdirSync(path.dirname(pagePath), { recursive: true });
    fs.writeFileSync(pagePath, content);
    console.log(`✅ Synced: ${issue.title}`);
  });
  
  // 重新編譯
  console.log('\n🔨 Recompiling Wiki...');
  try {
    execSync('openclaw wiki compile', { stdio: 'inherit' });
    console.log('✅ Compile complete');
  } catch (e) {
    console.error('❌ Compile failed:', e.message);
  }
}

syncIssuesToWiki();
```

**`scripts/error_wiki_sync.js`** - Error 同步到 Wiki

```javascript
#!/usr/bin/env node
/**
 * Error → Wiki Sync Script
 * 將 errors.json 中的錯誤同步到 Wiki
 */

const fs = require('fs');
const path = require('path');

const ERRORS_FILE = path.join(process.env.HOME, '.openclaw/workspace/memory/errors.json');
const WIKI_VAULT = path.join(process.env.HOME, '.openclaw/workspace/.openclaw-wiki');

function syncErrorsToWiki() {
  console.log('🔄 Syncing Errors to Wiki...\n');
  
  const errorsData = JSON.parse(fs.readFileSync(ERRORS_FILE, 'utf8'));
  const unresolvedErrors = errorsData.errors.filter(e => !e.resolved);
  
  console.log(`Found ${unresolvedErrors.length} unresolved errors\n`);
  
  // 按類型分組
  const byType = {};
  unresolvedErrors.forEach(e => {
    byType[e.type] = byType[e.type] || [];
    byType[e.type].push(e);
  });
  
  // 創建 Error Pattern Page
  const pagePath = path.join(WIKI_VAULT, 'errors', 'error-patterns.md');
  
  let content = `# Error Patterns

> Auto-generated from errors.json
> Updated: ${new Date().toISOString()}

## Summary

- Total Unresolved: ${unresolvedErrors.length}
- Error Types: ${Object.keys(byType).length}

## Claims

`;
  
  Object.entries(byType).forEach(([type, errors]) => {
    const claimId = `error-${type.toLowerCase().replace(/\s+/g, '-')}`;
    content += `- [claim::${claimId}] ${type} occurs ${errors.length} times
  - status: ${errors.length > 5 ? 'contested' : 'supported'}
  - confidence: ${Math.min(0.5 + errors.length * 0.05, 0.95).toFixed(2)}
  - freshness: fresh
  - tags: [error, ${type.toLowerCase().replace(/\s+/g, '-')}]
  - evidence:
${errors.slice(0, 3).map(e => `    - source: memory/errors.json
      quote: "${e.problem.substring(0, 80)}..."
      date: ${e.date}`).join('\n')}

`;
  });
  
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(pagePath, content);
  
  console.log(`✅ Synced ${Object.keys(byType).length} error types to Wiki`);
}

syncErrorsToWiki();
```

---

## 7. 預期效果

### 7.1 短期效果 (1-2 週)

| 指標 | 預期改善 |
|------|----------|
| Session 啟動時間 | Digest 預加載減少 30% |
| 知識檢索準確率 | Freshness 加權提升 20% |
| 矛盾檢測 | 自動發現 2-3 個矛盾/週 |

### 7.2 中期效果 (1 個月)

| 指標 | 預期改善 |
|------|----------|
| 錯誤預防 | 重複錯誤減少 40% |
| Issue 解決速度 | 歷史解決方案匹配減少 50% 時間 |
| 跨 Session 連貫性 | 主題連續性提升 60% |

### 7.3 長期效果 (3 個月)

| 指標 | 預期改善 |
|------|----------|
| 知識沉澱 | 自動提取 100+ claims |
| 系統穩定性 | 錯誤模式預測準確率 80% |
| 決策支持 | 歷史決策參考減少 70% 重複討論 |

---

## 8. 故障排除

### 8.1 常見問題

| 問題 | 原因 | 解決方案 |
|------|------|----------|
| Wiki compile 失敗 | 語法錯誤 | `openclaw wiki lint` 檢查 |
| Digest 過期 | 超過 24 小時 | 手動運行 `openclaw wiki compile` |
| Claims 丟失 | Evidence 缺失 | 檢查 `openclaw wiki lint` 報告 |
| Contradiction 過多 | 未解決衝突 | 手動更新 claim status |

### 8.2 緊急恢復

```bash
# 如果 Wiki 損壞，重新初始化
mv ~/.openclaw/workspace/.openclaw-wiki ~/.openclaw/workspace/.openclaw-wiki.bak
openclaw wiki init
openclaw wiki bridge import  # 從現有記憶重新導入

# 如果 Digest 損壞
rm ~/.openclaw/workspace/.openclaw-wiki/cache/agent-digest.json
openclaw wiki compile --full
```

---

## 9. 總結

Memory-Wiki 整合為 OpenClaw HA 系統帶來：

1. **結構化知識管理** - Claim/Evidence 結構確保知識可追溯
2. **自動矛盾檢測** - 及時發現知識衝突
3. **Freshness 加權** - 優先使用最新、最相關知識
4. **跨 Session 連貫性** - Digest 預加載快速恢復上下文
5. **與現有系統無縫整合** - 不影響 L0/L1/L2、Issues、Errors 運作

**下一步行動：**
1. 運行 `openclaw wiki init` 初始化 Vault
2. 更新 `~/.openclaw/config.json` 配置
3. 安裝新的 crontab
4. 運行 `openclaw wiki compile` 生成首個 Digest

---

*文件版本: 2026.4.8*
*作者: Ally (OpenClaw HA)*
*適用場景: Bliss Offline Mode*
