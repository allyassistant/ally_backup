# TOOLS.md - 工具使用指南 (Ally - 主力對話)

*具體嘅工具用法、指令、參數參考。*
*版本：Ally (主力) | HA Mode: SSH Direct*

---

## HA 協調工具 (Ally 專用)

```bash
# Heartbeat - 每分鐘寫入
~/.openclaw/workspace/scripts/heartbeat.sh

# Failover Detector - 每 1 分鐘 check 對方
~/.openclaw/workspace/scripts/failover_detector.sh

# 直接檢查 Bliss 狀態
cat ~/.openclaw/workspace/ha-state/bliss/heartbeat.json
```

檔案位置：`~/.openclaw/workspace/ha-state/`（ally/ + bliss/）
分工詳情見 SOUL.md

---

## Issue 管理

```bash
node scripts/issue_manager.js create "標題" --priority P1 --due 2026-02-25
node scripts/issue_manager.js list [active|archive]
node scripts/issue_manager.js complete 001
node scripts/issue_manager.js progress 001 --step 2/5
```

自動跟進：`node scripts/issue_auto_followup.js all|remind|check|auto`

---

## Error 追蹤

```bash
node scripts/error_tracker.js scan|list|search "keyword"
```

---

## Weekly Correction Loop

```bash
node scripts/code_quality_manager.js scan   # 掃描
node scripts/code_quality_manager.js verify  # Kimi 驗證
node scripts/code_quality_manager.js repair  # 自動修復
node scripts/auto_fix.js impact <script-name>
node scripts/auto_fix.js deploy-check
```

---

## Unified Search（跨來源搜尋）

```bash
node scripts/unified_search.js "你的問題" [--top 5] [--sources wiki,memory] [--raw] [--trace]
```

搜尋來源：Wiki (vector)、L1/L0 (semantic)、Memory (keyword)、Config (直接)、Issues (keyword)

---

## 記憶管理

```bash
node scripts/memory_temporal_search.js "keyword"   # 時間搜尋
node scripts/memory_cleanup.js --dry-run            # 預覽清理
node scripts/memory_archiver.js --dry-run           # 預覽歸檔
node scripts/memory_generator.js                    # 生成 L0/L1 摘要
```

---

## Discord 操作

### 頻道列表
| Channel ID | 名稱 | 用途 |
|------------|------|------|
| 1473343330170572904 | 🤖一般 | 閒聊 |
| 1473376125584670872 | ⚙️系統 | 系統訊息 (Mac B 通常處理) |
| 1473383064565710929 | 💼工作 | 工作相關 |
| 1473384999003619500 | 🧑🏻‍💻編程 | 編程討論 |

### 注意
- 普通用戶訊息上限 2,000 字符，Nitro 4,000（OpenClaw 自動分段）
- Streaming: Kimi ✅ MiniMax ❌

---

## 瀏覽器使用

**每次用完必須立即 Close！**

X.com 連結必須用 browser tool（web_fetch 會俾 X.com 擋 403）：

```javascript
browser action=open profile="openclaw" targetUrl="https://x.com/..."
browser action=snapshot targetId="<id>"
browser action=stop targetId="<id>"   // ← 一定要 close！
```

X link 從 Discord 收到時：分析完 → `message action=send` 主動發回 Discord channel

---

## Kimi Code CLI

**必須 spawn sub-agent 再 run，唔可以直接喺 main session 用。**

```bash
~/.local/bin/kimi -p "任務描述" -w ~/.openclaw/workspace/scripts --print
node scripts/kimi_cli_runner.js "任務描述" [--timeout 2700] [--model minimax/MiniMax-M3]

# -m 可省略，default model 係 kimi-code/kimi-for-coding (Kimi-k2.6)
# 如需指定 model: -m kimi-k2p5
```

---

## OpenCode

```bash
echo '任務' | opencode run --model deepseek/deepseek-v4-flash --dir ~/.openclaw/workspace/scripts
```
必須指定 `--dir`（write permission 限制）

---

## 模型使用

| 模型 | 正確格式 | 常見錯誤 |
|------|----------|----------|
| MiniMax Sub-agent | `minimax-portal/MiniMax-M3` | `MiniMax-M3`、`minimax` |
| DeepSeek Flash | `deepseek/deepseek-v4-flash` | — |
| Kimi | `kimi-code/kimi-for-coding` (default) / `kimi-k2p5` | Default 係 Kimi-k2.6; `-m kimi-k2p5` 轉 k2p5 |
| Qwen3 本地 | `ollama/qwen3:14b` | — |
| Qwen2.5 本地 | `ollama/qwen2.5:3b` | — |

### ⚠️ MiniMax API
禁止直接調用 API key。必須通過 OpenClaw 內置整合（月費已包）。

---

## Stock List 工具

```bash
node scripts/stock_merge_pro.js input.xlsx    # 合併多 sheets，輸出專業 Excel
node scripts/stock_updater.js [file_path]     # 更新庫存，追蹤已售
```

| 腳本 | 用途 | 輸出 |
|------|------|------|
| **stock_merge_pro.js** | 合併多 sheets、整合多來源 | 專業格式 Excel |
| **stock_updater.js** | 每日庫存更新、追蹤已售 | JSON + Excel |

---

## Obsidian Direct Write Tool

```bash
cat analysis.md | node scripts/write_to_obsidian.js \
  --title "Note Title" \
  --category "AI|Business|Tech|Concept|Diamond|Project|Daily|Inbox" \
  --type "observation|reaction|pattern|question|number|reference" \
  --tags "topic-tag,purpose-tag" \
  --links "[[Related Note]]" \
  --source "X post / email / discussion"
```

Category options: AI, Business, Tech, Concept, Diamond, Project, Daily, Inbox
Note type: observation, reaction, pattern, question, number, reference（唔 sure default reference）
Tags: 最少 1 topic + 1 purpose

**注意：** body 內容唔好以 `# Title` 開頭（script 會自動加）。

### 📝 寫入品質標準

每次寫 Obsidian note 後檢查：

**① 跨 Note 連結** — 呢篇同邊啲現有 notes 有關？有關就加 `[[Note Title]]`。

**② Tags 策略** — 最少 1 topic + 1 purpose：
| 類型 | 用途 | 例子 |
|------|------|------|
| Topic | 主題分類 | `obsidian`, `ai`, `diamond`, `stock` |
| Purpose | 用途標記 | `analysis`, `insight`, `workflow`, `reference` |

**③ Insight Feedback** — note 最後加 `## 啟發` section，記錄呢篇文嘅實際用處。

**④ Inbox Flow** — 未消化內容先用 category `Inbox`，之後再分類完善。

---

## Apple Mail 工具

### 自動監控 (`mail_monitor.js`)
每分鐘 check 新 email → 廣東話總結 → Discord #💼工作（由 crontab 管理）

### 手動工具 (`mail_tool.js`)

```bash
# 閱讀/搜尋
node scripts/mail_tool.js list --count 10
node scripts/mail_tool.js search "Rapaport" --count 5
node scripts/mail_tool.js read 1
node scripts/mail_tool.js folders
node scripts/mail_tool.js accounts

# 附件
node scripts/mail_tool.js attachments 1
node scripts/mail_tool.js download 1 --dir ~/Desktop

# 寫/覆/轉寄（draft mode 唔加 --send）
node scripts/mail_tool.js compose --to "x@x.com" --subject "Quote" --body "Thank you" [--send]
node scripts/mail_tool.js reply 3 --body "Thanks" [--send]
node scripts/mail_tool.js forward 3 --to "partner@x.com" --body "FYI" [--send]
```

**注意：** 自動加 signature (Joshua Chan / D.N. Group)。Folder 名跟 Mac 語言。

---

## 跨 Session 分析引擎

```bash
node scripts/cross_session_bootstrap.js --quiet     # 🔸 regenerate .cross_session_context.md（session 恢復用）
node scripts/cross_session_context.js               # 🔹 display patterns/ 分析摘要（唯讀，唔改 file）
node scripts/pattern_resolver.js --error "X" --resolve "Y"  # 標記已解決
node scripts/pattern_proactive_trigger.js           # 主動提醒
```

---

## Spawn Config — Smart Router 整合

```bash
# 拎 spawn config（每次 spawn 前必行）
node scripts/spawn_config.js --route SPAWN --task "分析 report"
# Output: {"model":"minimax-portal/MiniMax-M3","thinking":"adaptive","provider":"minimax-portal","decisionId":"..."}

# 完整 spawn 流程（3 步）：
# 1️⃣ exec spawn_config
cfg=$(node scripts/spawn_config.js --route SPAWN --task "分析")
# 2️⃣ parse JSON
model=$(echo $cfg | python3 -c "import sys,json; print(json.load(sys.stdin)['model'])")
thinking=$(echo $cfg | python3 -c "import sys,json; j=json.load(sys.stdin); print(j['thinking'] or '')")
# 3️⃣ sessions_spawn
# sessions_spawn model=$model thinking=$thinking task="..."

# Route → 對應 config 一覽
# SPAWN = MiniMax M3 + thinking:adaptive
# SOP   = MiniMax M3 + thinking:adaptive
# CODE  = MiniMax M3 + thinking:adaptive
# FDQ   = deepseek-v4-flash + thinking:high
# 其他  = deepseek-v4-flash + 唔開 thinking
```

**integration workflow（from AGENTS.md Spawn 原則）：**

```
1. exec spawn_config.js --route <ROUTE> --task "<簡短描述>"
2. Parse output: model + thinking
3. sessions_spawn model=<model> thinking=<thinking> task="<full task>
4. 先覆用戶一句「分析緊...」
5. sessions_yield 等 completion
```

**注意：** spawn_config 食 `route_model.yaml`，如果 minimax-portal health check fail，會自動 fallback 去 deepseek-v4-flash。唔使手動改 config。

## 通用工具規則

- **Tool Retry**：失敗最多 3 次，間隔 2 秒
- **符號導航**：`node scripts/get_symbol_info.js <symbol> --peek`（每日 00:41 自動生成 SYMBOLS.md）
- **時間驗證**：`date -r <timestamp>`（HKT = UTC+8）
- **Script 編寫**：macOS/Linux 兼容（gtimeout vs timeout, date -v vs date -d）、用 `$HOME` 代替 hardcode username

---

## Routing System CLI

```bash
node scripts/router/decision_logger.js --text "msg" --route ROUTE --channel discord
node scripts/router/report.js --days 7
node scripts/router/feedback_collector.js --wrong FDQ --correct SPAWN --reason "..."
node scripts/router/auto_corrector.js --since 24
node scripts/router/rule_adjuster.js --days 7
node scripts/router/email_router.js --subject "..." --verbose
node scripts/router/failure_recovery.js --stats
```

Route 清單：`FDQ` / `DIRECT_ANSWER` / `SOP` / `SPAWN` / `CODE` / `BROWSER`

---

## SSH 設定

| 機器 | Username | IP |
|------|----------|-----|
| Ally (Mac A) | `ally` | [TAILSCALE_ALLY_IP] |
| Bliss (Mac B) | `bliss` | [TAILSCALE_BLISS_IP] |

```bash
ssh bliss@[TAILSCALE_BLISS_IP] 'cat ~/.openclaw/workspace/ha-state/bliss/heartbeat.json'
```
> SSH 內用 `~` 而唔係 `$HOME`（避免 expansion 做 local path）

---

## GitHub Backup（ally_backup）

**Remote：** `git@github.com:allyassistant/ally_backup.git`
**Branch：** `master`
**SSH Key：** `~/.ssh/id_ed25519`（已註冊喺 allyassistant GitHub account）

### 基本操作

```bash
# Push（全自動 daily backup 用呢個）
cd ~/.openclaw/workspace
git add -A
git commit -m "auto: daily backup $(date +%F)"
git push origin master

# Force push（**只用喺 history rewrite 後**，e.g. filter-repo、git rm --cached）
git push origin master --force

# Pull（建議加上 --rebase 避免踩 conflict）
git pull origin master --rebase

# Check status
git status
git remote -v
```

### Auto-push Cron

- **Job name：** `auto-push-ally-backup`（Gateway cron，唔依賴 session）
- **時間：** 每日 23:30 HKT
- **Disable：** `openclaw cron remove auto-push-ally-backup`

### 已知不上線的檔案（.gitignore 已攔截）

| 目錄/檔案 | 原因 |
|-----------|------|
| `memory/` | 每日 session logs（私人） |
| `ha-state/` | HA heartbeat state |
| `.issues/archive/kb-cleanup-2026-05-30/` | 舊 KB cleanup archive |
| `.analysis/` | 一次性分析輸出 |
| `.fix_snapshots/` | CQM fix snapshots |
| `.kimi*` | Kimi CLI task artifacts |
| `*.log` | 運行日誌 |

**注意：** 如果新加敏感檔案要手動加入 `.gitignore`，唔好依赖呢個 list。
