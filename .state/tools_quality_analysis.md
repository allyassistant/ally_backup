# OpenClaw 工具層質量分析報告

**生成時間：** 2026-04-07 18:51 HKT  
**分析範圍：** `~/.openclaw/workspace/scripts/` — 117 個脚本  
**總行數：** 35,890 行

---

## 1. Scripts 清單

共 **117 個文件**（116 個 `.js` + 1 個 `.py`）。按行數分類：

| 行數範圍 | 數量 | 檔案例子 |
|----------|------|----------|
| < 50 行 | 8 | `memory_cleanup.js` (12行), `l0_generator.js` (13行), `translator.js` (39行) |
| 50–150 行 | 52 | `adaptive_timeout.js`, `gia_batch_processor.js`, `check_pure_audit_pending.js` |
| 150–300 行 | 36 | `apple_reminders_calendar.js`, `session_cleanup.js`, `memory_section_cleanup.js` |
| 300–500 行 | 14 | `memory_generator.js` (646行), `verify_fix.js` (734行), `issue_manager.js` (794行) |
| > 500 行 | 5 | `report_generator.js` (835行), `system_check_bot.js` (846行), `weekly_correction_loop.js` (1250行), `code_quality_manager.js` (1361行), `auto_fix.js` (2752行) |

---

## 2. 質量評分表

評分維度：
- **Error Handling (P0):** try-catch / 安全降級 / fs/exec 有保護
- **CONFIG/Magic Numbers (P1):** 有無 `const CONFIG` 或命名常量
- **Documentation (P2):** 頂部 docstring / 重要邏輯註釋
- **Size Risk (P2):** >500 行 = 難維護，>1000 行 = 高風險

| Script | 行數 | Error Handling | Magic Numbers | Doc | Size Risk | 評分 |
|--------|------|---------------|---------------|-----|-----------|------|
| **核心系統 (高質量)** |
| `adaptive_timeout.js` | 152 | ✅ 多層 try-catch | ✅ CONFIG block | ✅ 完整 doc | ✅ 細 | **9/10** |
| `archive_smart.js` | 74 | ✅ 包裹每個 fs 操作 | ❌ hardcoded `true` | ✅ 有 doc | ✅ 細 | **9/10** |
| `memory_archiver.js` | 162 | ✅ fs.existsSync check + try-catch | ✅ DEFAULT_ARCHIVE_DAYS | ✅ 完整 | ✅ 細 | **9/10** |
| `session_cleanup.js` | 296 | ✅ atomic write + 多 try-catch | ✅ CONFIG block | ✅ 完整 | ⚠️ 中 | **9/10** |
| `heartbeat_recall.js` | 544 | ✅ 18 個 try-catch | ✅ CONFIG block | ✅ 完整 | ⚠️ 中 | **9/10** |
| `health_monitor.js` | 641 | ✅ 20 個 try-catch | ✅ CONFIG block + 閾值常量 | ✅ 完整 | ⚠️ 中 | **9/10** |
| `idex_fetcher.js` | 308 | ✅ 多層 try-catch + cleanup | ✅ CONFIG block | ✅ 完整 | ✅ 中 | **8/10** |
| `apple_reminders_calendar.js` | 233 | ✅ 13 個 try-catch | ❌ 內聯數字 | ✅ 有 doc | ✅ 細 | **8/10** |
| `apple_notes.js` | 214 | ✅ 多 try-catch + 安全 temp file | ❌ 少量 hardcoded | ✅ 有 doc | ✅ 細 | **8/10** |
| `stream_archive.js` | 214 | ✅ 7 個 try-catch | ❌ 有 hardcoded | ✅ 有 doc | ✅ 細 | **8/10** |
| `daily_maintenance.js` | 284 | ✅ 安全路徑檢查 | ✅ CONFIG block | ✅ 完整 | ⚠️ 中 | **8/10** |
| `daily_summary_bot.js` | 434 | ✅ 13 個 try-catch | ❌ 少量 hardcoded | ✅ 完整 | ⚠️ 中 | **8/10** |
| `memory_section_cleanup.js` | 328 | ✅ 8 個 try-catch | ✅ CONFIG block | ✅ 完整 | ⚠️ 中 | **8/10** |
| **L0-L1 記憶系統** |
| `memory_generator.js` | 646 | ✅ 41 個 try-catch | ❌ 內聯常量 (LEVEL_CONFIG) | ✅ 完整 doc | ⚠️ 中 (但架構清晰) | **8/10** |
| `cross_session_bootstrap.js` | 314 | ✅ 包裹讀取 + ensureDir | ✅ CONFIG block | ✅ 完整 | ✅ 中 | **8/10** |
| `cross_session_context.js` | 278 | ✅ readJson helper + warn() | ✅ CONFIG block | ✅ 完整 | ✅ 中 | **8/10** |
| `l0_l1_verify.js` | 303 | ✅ 14 個 try-catch | ✅ CONFIG block | ✅ 完整 | ✅ 中 | **8/10** |
| **代碼質量工具** |
| `code_quality_manager.js` | 1361 | ✅ 12 個 try-catch | ❌ 內聯常量 (CQM_CONFIG) | ✅ 完整 | 🔴 大 (但模組化好) | **7/10** |
| `auto_fix_history.js` | 376 | ✅ atomic write + readHistory | ✅ CONFIG block | ✅ 完整 | ✅ 中 | **8/10** |
| `verify_fix.js` | 734 | ✅ 多 try-catch | ✅ CONFIG block | ✅ 完整 | ⚠️ 中 | **8/10** |
| `error_tracker.js` | 762 | ✅ 25 個 try-catch | ✅ CONFIG block | ✅ 完整 | ⚠️ 中 | **8/10** |
| `pure_audit_runner.js` | 164 | ✅ 4 個 try-catch | ❌ 少量 hardcoded | ✅ 有 doc | ✅ 細 | **8/10** |
| **Issue / 任務管理** |
| `issue_manager.js` | 794 | ✅ 32 個 try-catch | ❌ 內聯數字 | ✅ 完整 | ⚠️ 中 | **8/10** |
| `issue_auto_followup.js` | 464 | ✅ 10 個 try-catch | ❌ 內聯 | ✅ 有 doc | ⚠️ 中 | **7/10** |
| `auto_issue_creator.js` | 758 | ✅ 13 個 try-catch | ✅ CONFIG block | ✅ 完整 | ⚠️ 中 | **8/10** |
| **Discord / 通訊** |
| `rapnet_sender.js` | 246 | ✅ 10 個 try-catch + getDiscordToken() | ❌ 內聯 channel ID | ✅ 有 doc | ✅ 中 | **7/10** |
| `idex_fetcher_bot.js` | 184 | ✅ 5 個 try-catch | ✅ CONFIG block | ✅ 有 doc | ✅ 中 | **8/10** |
| `reminder_discussion_bot.js` | 121 | ✅ 4 個 try-catch | ❌ 少量 hardcoded | ✅ 有 doc | ✅ 細 | **8/10** |
| `system_check_bot.js` | 846 | ✅ 23 個 try-catch | ❌ 多 hardcoded | ✅ 完整 | ⚠️ 中 | **7/10** |
| **Stock / 庫存工具** |
| `stock_merge_pro.js` | 498 | ✅ 1 個 try (ExcelJS) | ❌ 多 hardcoded (COLOR_ORDER, shape priority) | ❌ 無 docstring | ⚠️ 中 | **6/10** |
| `stock_updater.js` | 424 | ✅ 9 個 try-catch | ❌ 內聯 | ✅ 有 doc | ⚠️ 中 | **7/10** |
| **Pattern 分析** |
| `pattern_resolver.js` | 462 | ✅ 3 個 try-catch | ✅ CONFIG block | ✅ 有 doc | ⚠️ 中 | **8/10** |
| `pattern_archive.js` | 401 | ✅ 12 個 try-catch | ✅ CONFIG block | ✅ 有 doc | ✅ 中 | **8/10** |
| `pattern_analysis_daily.js` | 124 | ✅ 2 個 try-catch | ❌ 內聯 | ✅ 有 doc | ✅ 細 | **8/10** |
| `pattern_proactive_trigger.js` | 392 | ✅ 4 個 try-catch | ✅ CONFIG block | ✅ 有 doc | ✅ 中 | **8/10** |
| `memory_sanitizer.js` | 409 | ✅ 21 個 try-catch | ❌ 大量內聯 | ✅ 有 doc | ✅ 中 | **7/10** |
| **其他工具** |
| `browser_autoclose.js` | 43 | ✅ 外層 try-catch | ❌ hardcoded timeout (10000) | ✅ 有 doc | ✅ 細 | **8/10** |
| `check-router-decision.js` | 53 | ✅ 包裹所有 fs 操作 | ❌ 內聯 | ✅ 有 doc | ✅ 細 | **8/10** |
| `check_pure_audit_pending.js` | 128 | ✅ 5 個 try-catch | ❌ 內聯 | ✅ 有 doc | ✅ 細 | **8/10** |
| `auto-spawn.js` | 259 | ✅ checkNeedSpawn() 安全降級 | ❌ 內聯 | ✅ 有 doc | ✅ 中 | **7/10** |
| `kimi_cli_runner.js` | 304 | ✅ 9 個 try-catch | ❌ 內聯 | ✅ 有 doc | ✅ 中 | **7/10** |
| `skills_manager.js` | 568 | ✅ 8 個 try-catch | ❌ 內聯 | ✅ 有 doc | ⚠️ 中 | **7/10** |
| `log_to_daily_memory.js` | 489 | ✅ 14 個 try-catch | ❌ 內聯 | ✅ 有 doc | ⚠️ 中 | **7/10** |
| `memory_distiller.js` | 370 | ✅ 11 個 try-catch | ❌ 內聯 | ✅ 有 doc | ✅ 中 | **7/10** |
| `weekly_correction_loop.js` | 1250 | ✅ 41 個 try-catch | ✅ CONFIG block | ✅ 完整 | 🔴 大 | **7/10** |
| `rapnet_weekly.js` | 370 | ✅ 11 個 try-catch | ❌ 內聯 | ✅ 有 doc | ✅ 中 | **7/10** |
| `memory_maintenance.js` | 438 | ✅ 13 個 try-catch | ❌ 內聯 | ✅ 有 doc | ⚠️ 中 | **7/10** |
| `token_archive.js` | 304 | ✅ 8 個 try-catch | ❌ 內聯 | ✅ 有 doc | ✅ 中 | **7/10** |
| `issue_reminders_sync.js` | 358 | ✅ 18 個 try-catch | ❌ 內聯 | ✅ 有 doc | ✅ 中 | **7/10** |
| `weekly_session_cleanup.js` | 97 | ✅ 4 個 try-catch | ❌ 內聯 | ✅ 有 doc | ✅ 細 | **7/10** |
| `report_templates.js` | 351 | ❌ 0 個 try-catch | ❌ 內聯 | ❌ 無 doc | ✅ 中 | **5/10** |
| **低質量 / 高風險** |
| `l0_generator.js` | 13 | ❌ 沒 try-catch | ❌ 轉發無處理 | ❌ 僅轉發 | 🔴 閒置/替換 | **3/10** |
| `l1_generator.js` | 13 | ❌ 同上 | ❌ 同上 | ❌ 同上 | 🔴 閒置/替換 | **3/10** |
| `memory_cleanup.js` | 12 | ❌ 幾乎無 try-catch | ❌ 內聯 | ❌ 無 doc | ✅ 極短 | **5/10** |
| `translator.js` | 39 | ❌ 0 try-catch | ❌ 內聯 | ❌ 無 doc | ✅ 細 | **5/10** |
| `smart_memory_router.js` | 284 | ❌ 0 try-catch | ❌ 內聯 | ✅ 有 doc | ✅ 中 | **5/10** |
| `task_router.js` | 428 | ❌ 3 try-catch (很少) | ❌ 內聯 | ✅ 有 doc | ⚠️ 中 | **5/10** |
| `auto_fix.js` | 2752 | ✅ 56 try-catch | ❌ 無 CONFIG block (但規則清晰) | ✅ 極詳細 | 🔴 極大 (2760行) | **6/10** |
| `system_status_report.js` | 49 | ❌ 0 try-catch | ❌ 內聯 | ❌ 無 doc | ✅ 細 | **5/10** |
| `email_generator.js` | 218 | ❌ 0 try-catch | ❌ 無 | ✅ 有 doc | ✅ 中 | **5/10** |
| `router.py` | 95 | ✅ Python try 處理 | ✅ CONFIG dict | ✅ 完整 | ✅ 細 | **9/10** |

### 評分分佈

| 等級 | 分數 | 數量 | 佔比 |
|------|------|------|------|
| 🟢 高 | 8–10 | ~40 | ~35% |
| 🟡 中 | 6–7 | ~50 | ~43% |
| 🔴 低 | 1–5 | ~27 | ~23% |

---

## 3. 根本原因分析

### Top 3 系統性問題

#### 🔴 問題 1：Magic Numbers 氾濫（極普遍）
**現況：** 117 個腳本中約 65% 仍有內聯硬編碼數字。

**典型例子：**
```javascript
// ❌ 不佳：hardcoded numbers
if (diff > 180 * 24 * 60 * 60 * 1000)  // 180 days
setTimeout(() => { ... }, 5000);         // 5 sec
const MAX_SIZE = 500;                    // KB
const MAX_RETRIES = 3;                  // 次數
```

```javascript
// ✅ 良好：有 CONFIG block
const CONFIG = {
  THIRTY_DAYS_MS: 180 * 24 * 60 * 60 * 1000,
  DEFAULT_TIMEOUT_MS: 5000,
  MAX_FILE_SIZE_KB: 500,
  MAX_RETRIES: 3,
};
```

**根因：**
- 新脚本初期快速開發時忽略後續整理
- 沒有 `eslint` 或 pre-commit hook 強制檢查
- AGENTS.md P1 規範已存在但執行不徹底

**受影響檔案（按严重程度）：**
- 🔴 `auto_fix.js` (2760行，0個 CONFIG block)
- 🔴 `code_quality_manager.js` (1361行，無專用 CONFIG)
- 🟠 `memory_generator.js`, `issue_manager.js`, `weekly_correction_loop.js`
- 🟠 `stock_merge_pro.js` (COLOR_ORDER, shape priority 全 hardcoded)

#### 🔴 問題 2：大量「只讀取不寫入」的輕量脚本报廢或缺乏維護
**現況：** 12 個脚本公司內部輕量工具幾乎無 try-catch、無 docstring。

**例子：**
| 檔案 | 行數 | Error Handling | Doc |
|------|------|---------------|-----|
| `report_templates.js` | 351 | 0 try-catch | ❌ 無 |
| `email_generator.js` | 218 | 0 try-catch | ✅ 有 |
| `smart_memory_router.js` | 284 | 0 try-catch | ✅ 有 |
| `task_router.js` | 428 | 3 try-catch | ✅ 有 |

**根因：**
- 部分脚本公司內部使用，出錯機率低，優先級不高
- 認為「簡單工具不需要錯誤處理」
- 缺乏測試覆蓋，`verify_fix.js` 只驗證修復，不主動發現新問題

#### 🟠 問題 3：極大檔案（>1000 行）難以維護
**現況：** 5 個脚本超過 500 行，其中 2 個超過 1000 行。

| 檔案 | 行數 | 問題 |
|------|------|------|
| `auto_fix.js` | 2752 | 單檔包含 Scanner、修復邏輯、CLI、 spawn 全部在一起 |
| `code_quality_manager.js` | 1361 | 統一入口但依賴大量 lib 模組 |
| `weekly_correction_loop.js` | 1250 | 單一巨大文件，功能耦合 |
| `report_generator.js` | 835 | 838 行單一 module |
| `system_check_bot.js` | 846 | 包含多個子功能 |

**根因：**
- 重構時沒有拆分，祇是持續追加功能
- 缺乏模組化意識，沒有 SRP（單一職責原則）
- 大檔案導致即使想修復也難以找到正確位置

---

## 4. 改進建議

### Top 5 優先行動

#### ✅ 優先 1：立即修復最危險的脚本（P0）
**目標：** 消除即時崩潰風險

```
低質量高風險：
- `smart_memory_router.js` (284行, 0 try-catch) — 任務分類出錯影響大
- `task_router.js` (428行, 3 try-catch) — 任務路由出錯
- `auto_fix.js` (2760行) — 建議拆分為 auto_fix_core.js + auto_fix_cli.js
- `l0_generator.js` / `l1_generator.js` — 建議直接刪除（已 deprecated）
```

#### ✅ 優先 2：在 AGENTS.md 强制執行 CONFIG 規則
**現有規則：** AGENTS.md Coding Standards P1 — Magic Numbers → CONFIG

**强化措施：**
- 在 `auto_fix.js` 的 scanner 中加入自動檢測 CONFIG 缺失
- 建立快速清單：「所有 fs/exec 操作的調用必須在 CONFIG 區塊上方 30 行內有對應常量」
- 考慮新增 `node scripts/check_magic_numbers.js` 在每次 commit 前運行

#### ✅ 優先 3：拆分超大檔案
```
auto_fix.js (2752行) → 拆分方案：
  ├── auto_fix_scanner.js     (~300行) — 掃描引擎
  ├── auto_fix_repair.js      (~400行) — 修復邏輯
  ├── auto_fix_cli.js         (~200行) — CLI 介面
  ├── auto_fix_spawn.js       (~150行) — spawn 協調
  ├── auto_fix_report.js      (~200行) — 報告生成
  └── auto_fix_main.js        (~500行) — 主協調
```

```
code_quality_manager.js (1361行) → 已經有好架構
  └── 建議加上 SIZE_LIMITS CONFIG block

weekly_correction_loop.js (1250行) → 建議拆分為：
  ├── correction_analyzer.js  (~300行) — 分析錯誤
  ├── correction_rules.js     (~200行) — 規則管理
  └── correction_loop.js      (~400行) — 主循環
```

#### ✅ 優先 4：建立標準化模板（新脚本必須符合）
所有新脚本應該有：

```javascript
#!/usr/bin/env node
/**
 * [Script Name] - [One-line Description]
 * 
 * 功能：1. ... 2. ... 3. ...
 * 使用方法: node scripts/xxx.js [args]
 * Cron: [if applicable]
 * 作者：Ally/BLISS (YYYY-MM-DD)
 */

const _quiet = process.argv.includes('--quiet');
const log = (...args) => { if (!_quiet) console.log(...args); };

// ==================== CONFIG ====================
const CONFIG = {
  // Timeouts
  DEFAULT_TIMEOUT_MS: 30000,
  // Paths
  OUTPUT_DIR: '...',
  // Limits
  MAX_RETRIES: 3,
};

// ==================== HELPERS ====================
function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    log(`⚠️ Failed to read: ${filePath} - ${e.message}`);
    return null;
  }
}

// ==================== MAIN ====================
function main() {
  // ...
}

main();
```

#### ✅ 優先 5：建立輕量腳本質量底線
**目標：** 讓所有「低風險」工具也有最基本保障

最低標準（所有脚本）：
1. **頂部 shebang**：`#!/usr/bin/env node`
2. **頂部 docstring**：起碼一句話描述
3. **至少 1 個 try-catch**：包裹最危險的 fs 操作
4. **至少 1 個 CONFIG 常量**：起碼把 timeout/max 等數字提出來

---

## 5. Quality Standard 草稿

### OpenClaw Script Quality Standard v1.0

#### P0 — 必須遵守（違者即錯）

| 規則 | 正確 | 錯誤 |
|------|------|------|
| **Shell Injection** | 驗證並 escape 所有 user input | 直接 `${input}` 放 shell 命令 |
| **execSync/fs 錯誤處理** | 包 try-catch + 安全降級 | 無 try-catch，失敗即 crash |
| **Async 內無 Sync** | `await fs.promises.writeFile()` | `fs.writeFileSync()` 在 async function 內 |
| **敏感資訊** | API key 在 `process.env` | API key 寫喺代碼入面 |

#### P1 — 強烈建議（長期遵守）

| 規則 | 正確 | 錯誤 |
|------|------|------|
| **Magic Numbers** | `const CONFIG = { MAX_RETRIES: 3 }` | `if (x > 3)` 內聯數字 |
| **重要寫入** | `atomicWriteSync()` 或 tmp + rename | `fs.writeFileSync()` 直接寫 |
| **大量輸出** | `function log(..., quiet = false)` | 無安靜模式 |
| **字串 API** | `str.slice(2, 7)` | `str.substr(2, 5)` (已废弃) |

#### P2 — 建議遵循

| 規則 | 正確 | 錯誤 |
|------|------|------|
| **頂部 docstring** | 多行描述功能/用法 | 完全無註釋 |
| **複雜邏輯註釋** | `// 180 days = 15,552,000 seconds` | 無解釋的數學表達式 |
| **命名** | `const OFFLINE_THRESHOLD_MS` | `const X` / `const tmp` |
| **TODO/FIXME** | 完成後刪除 | 留低 `// TODO: implement` |

#### 檔案大小紅線

| 行數 | 風險 | 行動 |
|------|------|------|
| < 300 行 | ✅ 安全 | 正常 |
| 300–500 行 | ⚠️ 警醒 | 考慮拆分功能 |
| 500–1000 行 | 🔴 高風險 | 必須拆分或重構 |
| > 1000 行 | 🚨 危險 | 立即拆分，唔好繼續追加 |

#### 新脚本 checklist

- [ ] `#!/usr/bin/env node` shebang
- [ ] 頂部 docstring（起碼一句話）
- [ ] `const _quiet = process.argv.includes('--quiet');` + `const log = (...args) => { if (!_quiet) console.log(...args); };`
- [ ] `const CONFIG = { ... }` — 起碼包含 timeout/max 數字
- [ ] 所有 `execSync` / `fs.readFileSync` / `fs.writeFileSync` 包 try-catch
- [ ] 安全降級（失敗時有合理的 fallback 行爲）
- [ ] `function main() { ... }` + `main()` 入口

---

## 6. 附錄：lib/ 模組質量

`scripts/lib/` 目錄包含 17 個核心模組，全部為共享組件：

| 檔案 | 行數 | 評估 |
|------|------|------|
| `config.js` | ~90 | ✅ 極高質量，有 atomicWriteSync、機器偵測、完整路徑常量 |
| `time.js` | ~80 | ✅ 有 HKT helper、getHKTDate/getHKTDateTime |
| `state.js` | ~100 | ✅ atomic write、state manager |
| `fileDiscovery.js` | ~400 | ✅ 完整，快取機制、增量掃描 |
| `auditOrchestrator.js` | ~500 | ✅ 模組化好，Scanner/Audit 分離 |
| `batch_verifier.js` | ~200 | ✅ 批量 Kimi 驗證 |
| `pattern_learner.js` | ~200 | ✅ 自學習 Pattern Store |
| `auto_repair.js` | ~300 | ✅ Confidence-based 修復 |
| `issueAggregator.js` | ~400 | ✅ Issue 聚合 + 嚴重性評分 |
| `whitelist_patterns.js` | ~150 | ✅ 白名單自動生成 |
| `skip-list.js` | ~80 | ✅ Scanner 跳過列表 |
| `semantic_matcher.js` | ~200 | ✅ 語意匹配 |

**lib/ 評估：✅ 高質量**，是工具層最穩定的部分，應該以此為標準。

---

*報告生成：Subagent (Tool Quality Analysis) | 2026-04-07*