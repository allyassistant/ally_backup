# error_tracker.js 上下游整合分析報告

**生成時間：** 2026-04-07 23:08 HKT
**分析目標：** error_tracker.js 重構後（Template-Engine + Async）上下游兼容性檢查

---

## 1. 直接呼叫 error_tracker.js 的 Scripts

### ✅ issue_manager.js — 整合方式：execFileSync

| 項目 | 內容 |
|------|------|
| **調用點** | `cmdComplete()` 和 `cmdConvertToError()` 函數 |
| **整合方式** | `execFileSync(process.execPath, [scriptPath, 'add', ...])` |
| **呼叫參數** | `add --title <title> --problem <problem>` |
| **錯誤處理** | try-catch 包圍，失敗時 log 但不影響主流程 |
| **評估** | ✅ 正常 — 直接 CLI 呼叫，接口穩定 |

```javascript
// issue_manager.js:512-517
const scriptPath = path.join(__dirname, 'error_tracker.js');
const problem = issue.content?.slice(0, 200) || issue.title;
execFileSync(process.execPath, [scriptPath, 'add', '--title', issue.title, '--problem', problem], { encoding: 'utf-8' });
```

---

## 2. 直接讀取 memory/errors.json 的 Scripts

### ✅ auto_fix.js — 整合方式：直接讀取 JSON

| 項目 | 內容 |
|------|------|
| **位置** | `scripts/auto_fix.js` |
| **讀取路徑** | `ERRORS_JSON` (來自 `lib/config.js` → `memory/errors.json`) |
| **用途** | 掃描未解決錯誤 → 觸發 Auto-Audit |
| **讀取方式** | `fs.readFileSync(ERRORS_JSON)` + JSON.parse |
| **Error Handling** | try-catch + existsSync 檢查 |
| **評估** | ✅ 正常 — 讀取 `schema.openclaw.errors.v1` 格式，兼容 |

**重點：** auto_fix.js 使用 `data.errors` 陣列格式，與 error_tracker.js 輸出完全一致。

---

### ✅ system_check_bot.js — 整合方式：直接讀取 JSON

| 項目 | 內容 |
|------|------|
| **位置** | `scripts/system_check_bot.js:357-375` |
| **讀取路徑** | `path.join(MEMORY_DIR, 'errors.json')` |
| **用途** | Discord 系統狀態報告顯示 active errors |
| **讀取方式** | `fs.readFileSync` + `data.errors.filter(e => e.resolved !== true)` |
| **評估** | ✅ 正常 — 兼容新 schema |

```javascript
const data = JSON.parse(fs.readFileSync(errorsFile, 'utf8'));
const errorsList = Array.isArray(data.errors) ? data.errors : [];
const active = errorsList.filter(e => e.resolved !== true);
```

---

### ✅ weekly_correction_loop.js — 整合方式：直接讀取 JSON

| 項目 | 內容 |
|------|------|
| **位置** | `scripts/weekly_correction_loop.js:122-148` |
| **讀取路徑** | `memory/errors.json` |
| **用途** | 每週日 02:00 分析錯誤模式 → 生成 AGENTS.md 規則 |
| **Error Handling** | try-catch + isEmpty 檢查 |
| **評估** | ✅ 正常 |

---

### ✅ memory_sanitizer.js — 整合方式：直接寫入 JSON

| 項目 | 內容 |
|------|------|
| **位置** | `scripts/memory_sanitizer.js:188-244` |
| **寫入路徑** | `path.join(MEMORY_DIR, 'errors.json')` |
| **用途** | 隔離污染的記憶時順便記 error |
| **評估** | ⚠️ 注意 — 係直接 fs.writeFileSync，唔係經 error_tracker |

---

## 3. 讀取其他 errors.json 的 Scripts

### ⚠️ verify_fix.js — `.state/errors.json` (不同位置!)

| 項目 | 內容 |
|------|------|
| **位置** | `scripts/verify_fix.js:23` |
| **讀取路徑** | `.state/errors.json` (NOT memory/errors.json!) |
| **用途** | 驗證 24 小時前未驗證的修復，確認同類錯誤有冇再出現 |
| **評估** | ✅ 安全隔離 — 完全係另一個檔案，唔關 error_tracker.js 事 |

**注意：** `.state/errors.json` 係 verify_fix 自己維護的驗證狀態檔案，與 `memory/errors.json` 完全獨立。

---

### ℹ️ memory/patterns/errors.json — Archive/Patter n 用途

| 位置 | 用途 | 評估 |
|------|------|------|
| `memory/patterns/errors.json` | Pattern archive 格式（已解決的 error pattern 追蹤） | ℹ️ 獨立 schema，與 error_tracker 無直接關聯 |

---

## 4. Cron Jobs 呼叫方式

### HEARTBEAT.md 文檔

| 調用方式 | 文檔位置 | 評估 |
|----------|----------|------|
| `node scripts/error_tracker.js scan` | HEARTBEAT.md:16, 37 | ✅ 有記錄 |
| `node scripts/error_tracker.js scan --cron` | HEARTBEAT.md:37 | ✅ 有記錄 |

**注意：** 從 crontab 列表睇，目前冇直接將 error_tracker.js 加入 cron。但 HEARTBEAT.md 描述了兩種呼叫模式：
- 普通模式：`scan` — 標準輸出
- Cron 模式：`scan --cron` — 安靜輸出

---

## 5. Data Format 兼容性

### memory/errors.json Schema

```json
{
  "schema": "openclaw.errors.v1",
  "metadata": {
    "createdAt": "ISO timestamp",
    "lastUpdated": "ISO timestamp",
    "totalErrors": N
  },
  "errors": [
    {
      "id": "mnokn4694p4fz",
      "date": "YYYY-MM-DD",
      "timestamp": "ISO timestamp",
      "type": "Error Type",
      "severity": 1-3,
      "title": "Title",
      "problem": "Description",
      "source": "session:xxx",
      "tags": [],
      "count": N,
      "resolved": false
    }
  ]
}
```

**所有直接讀取 JSON 的 scripts 都兼容呢個格式。**

---

## 6. 總結評估

| Script | 整合方式 | 評估 | 備註 |
|--------|----------|------|------|
| `issue_manager.js` | execFileSync CLI | ✅ 正常 | 直接呼叫 error_tracker.js add 命令 |
| `auto_fix.js` | fs.readFileSync → errors.json | ✅ 正常 | 讀取 schema.openclaw.errors.v1 |
| `system_check_bot.js` | fs.readFileSync → errors.json | ✅ 正常 | 讀取 active errors |
| `weekly_correction_loop.js` | fs.readFileSync → errors.json | ✅ 正常 | 每週分析 |
| `memory_sanitizer.js` | fs.writeFileSync → errors.json | ⚠️ 注意 | 直接寫入，可能衝突 |
| `verify_fix.js` | fs.readFileSync → .state/errors.json | ✅ 安全 | 完全獨立檔案 |
| `HEARTBEAT.md` | 文檔說明 | ✅ 正常 | 記錄了 scan / scan --cron 兩種模式 |

---

## 7. 建議

### 🔴 高優先級

**memory_sanitizer.js 直接寫入 errors.json**
- 目前係直接 `fs.writeFileSync` 寫入，繞過 error_tracker.js
- 建議：改為呼叫 error_tracker.js add 命令，或確保 schema 完全兼容
- 風險：新架構 error_tracker.js 若改變寫入邏輯，memory_sanitizer.js 會失效

### 🟡 中優先級

**HEARTBEAT.md cron jobs 需確認實際生效**
- 目前 crontab 冇 error_tracker.js 相關 job
- 建議：確認係咪需要將 error_tracker.js scan 加入 cron（建議每 6 小時或每日 03:00）

### 🟢 低優先級

**verify_fix.js 的 `.state/errors.json`**
- 完全獨立，無需調整
- 但建議在文檔說明兩個 errors.json 的區別

---

## 8. 重構影響評估

| 改變類型 | 影響範圍 | 風險 |
|----------|----------|------|
| Template-Engine 分離 | list/stats 命令輸出不受影響 | ✅ 低 |
| Async 重構 | API 保持不變（CLI 接口） | ✅ 低 |
| 輸出格式改變 | memory/errors.json schema 不變 | ✅ 低 |
| 內部邏輯改變 | 僅 error_generator.js 和 error_tracker.js 內部 | ✅ 低 |

**結論：** 重構（Template-Engine + Async）對外接口保持穩定，所有現有整合均可正常工作。
