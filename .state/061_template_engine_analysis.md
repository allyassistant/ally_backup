# Issue #061 分析報告：Template-Engine Separation 應唔應該做

**日期：** 2026-04-07  
**分析者：** Sub-agent (Template-Engine Analysis)  
**狀態：** ✅ 完成

---

## 1. 現有 Template-Engine 架構分析

### 1.1 report_templates.js (Template Layer) ✅ 典範

| 特性 | 狀態 | 說明 |
|------|------|------|
| **職責** | ✅ 純粹 | 只負責定義數據結構，無 business logic |
| **CONFIG** | ✅ 完善 | Magic numbers 全部集中在 CONFIG object |
| **Error Handling** | ✅ 完善 | 每個 function 有 try-catch |
| **Export** | ✅ 完整 | 10 個 template functions + utilities |

**關鍵設計：**
- `createReportStructure()` 生成標準化結構
- Section-based 架構，每個 report 有固定 sections
- TEMPLATES registry 方便 lookup
- 支援 `{date}` placeholder 替換

### 1.2 report_generator.js (Generator Layer) ✅ 典範

| 特性 | 狀態 | 說明 |
|------|------|------|
| **依賴** | ✅ 正確 | 依賴 templates.js，不直接定義結構 |
| **Class 設計** | ✅ 合理 | ReportGenerator class，封裝輸出邏輯 |
| **多格式支援** | ✅ 完善 | toMarkdown(), toJSON(), toDiscordEmbed(), toTable() |
| **格式化 utilities** | ✅ 實用 | formatBytes(), formatCurrency(), formatNumber() |

**關鍵設計：**
- `populateSection()` 根據 section name 填充數據
- `formatContent()` 根據 format (markdown/json) 格式化內容
- Atomic write 用於保存 report
- Discord embed 有顏色分級

---

## 2. 其他 Systems 分析

### 2.1 error_tracker.js ⚠️ 需要分離

| 特性 | 評分 | 說明 |
|------|------|------|
| **大小** | 大 | ~450 行，職責過多 |
| **Output coupling** | 🔴 高耦合 | scan(), list(), stats() 直接格式化輸出 |
| **CONFIG** | ✅ 有 | CONFIG block 存在 |
| **Template potential** | 高 | Error report 有固定結構 (severity, date, source, count) |

**問題：**
- `list()` 和 `stats()` 直接用 `log()` 輸出，無法重定向到 Discord/Excel
- Error report 結構清晰（🔴 Critical / 🟠 Warning / 🟡 Info），適合做 template
- Auto-resolve logic 夾雜在 output logic 中

**建議：**
```javascript
// error_templates.js (新增)
const CONFIG = {
  TITLES: { ERROR_REPORT: '❌ Error Report - {date}' },
  SECTIONS: ['🔴 Critical', '🟠 Warning', '🟡 Info', '✅ Recently Resolved']
};

// error_generator.js (新增)
class ErrorReportGenerator extends ReportGenerator {
  generate(data) { /* 使用 template + 填充 error data */ }
  toDiscordEmbed() { /* 帶顏色分級的 embed */ }
}
```

### 2.2 stock_updater.js ⚠️ 需要分離

| 特性 | 評分 | 說明 |
|------|------|------|
| **大小** | 中 | ~280 行 |
| **Output coupling** | 🟡 中等 | `createFormattedExcel()` 和 data processing 混在一起 |
| **CONFIG** | 部分 | 有 CONFIG 但不完整 |
| **Template potential** | 中 | Stock report 有固定 sections (Summary, Changes, Sold) |

**問題：**
- `sortStockData()`, `addBlankRowsBetweenShapes()`, `removeDuplicates()` 夾雜 output code
- `createFormattedExcel()` 是唯一 output，但和其他 logic 混在一起
- 輸出到 Apple Notes (`createSoldStockNote()`) 是額外功能，分離有意義

**建議：**
```javascript
// stock_templates.js (新增)
const CONFIG = {
  TITLES: { STOCK_REPORT: '📊 Stock Valuation Report - {date}' },
  SECTIONS: ['📋 Summary', '📈 Shape Breakdown', '🔄 Changes', '✅ Sold Items']
};

// stock_generator.js (新增)
class StockReportGenerator {
  generate(data) { /* 使用 template */ }
  toAppleNotes() { /* 輸出到 Apple Notes */ }
  toExcel() { /* 輸出到 Excel */ }
}
```

### 2.3 apple_notes.js 🟢 架構可接受

| 特性 | 評分 | 說明 |
|------|------|------|
| **大小** | 小 | ~180 行 |
| **Output coupling** | 🟢 低 | 主要係純 function (createNote, markdownToAppleNotesHTML) |
| **CONFIG** | 部分 | 有 escapeAppleScript() 等 utilities |
| **Template potential** | 低 | Apple Notes output 單一用途 |

**評估：**
- `createNote()` 是純 function，容易測試
- `markdownToAppleNotesHTML()` 已經係 converter pattern
- `createDailySummary()` 夾雜少量 logic，但唔影響大局
- **結論：唔需要特別重構**

### 2.4 health_monitor.js 🟡 已有一定分離

| 特性 | 評分 | 說明 |
|------|------|------|
| **大小** | 大 | ~380 行 |
| **Output coupling** | 🟡 中等 | check*() functions 返回 raw data，但 main() 直接格式化 |
| **CONFIG** | ✅ 完善 | CONFIG object + thresholds |
| **Template potential** | 高 | Health report 有固定 sections (System, Disk, Errors, Cron, etc.) |

**現有問題：**
- `main()` 混合了 check logic 和 output formatting
- `sendDiscordSimple()` 是唯一的 output abstraction，但唔夠通用
- 每個 check function 返回 `status`, `alert`, `message`，但 `main()` 重新組合成文字

**建議：**
```javascript
// health_templates.js (新增)
const CONFIG = {
  TITLES: { HEALTH_REPORT: '🏥 System Health - {date}' },
  SECTIONS: ['🤖 Services', '💻 Resources', '📊 Errors', '⏰ Cron Jobs']
};

// health_generator.js (新增)
class HealthReportGenerator extends ReportGenerator {
  generate(report) { /* 使用 template */ }
  toStatusBoard() { /* 狀態面板 */ }
}
```

---

## 3. 好處 vs 壞處評估

### 3.1 好處 ✅

| 好處 | 適用於 | 影響 |
|------|--------|------|
| **多格式輸出** | error_tracker, health_monitor | 可以同時輸出 Discord + Excel + JSON |
| **測試性提升** | 所有重構的 scripts | Unit test templates 和 generators 分開測試 |
| **一致性** | 所有 scripts | 統一的 report 結構 |
| **可維護性** | 所有重構的 scripts | 改 output format 唔需要改 logic |
| **代碼重用** | error_generator → health_generator | 共享 base class |

### 3.2 壞處 ❌

| 壞處 | 影響 | 緩解 |
|------|------|------|
| **額外文件** | 增加 complexity | 對於小 scripts 係 overhead |
| **重構時間** | 需要投資時間 | 可以分階段做 |
| **學習曲線** | 其他 maintainers 需要理解新架構 | templates.js 已係範例 |
| **Over-engineering** | 小 scripts 可能唔值得 | 只重構有 多format 需求的 |

### 3.3 機會成本 ⚠️

**時間估算：**
| Script | 重構時間 | 預期價值 |
|--------|----------|----------|
| error_tracker.js | 2-3 小時 | 高（高頻使用） |
| health_monitor.js | 1-2 小時 | 高（定期輸出） |
| stock_updater.js | 2 小時 | 中（功能已穩定） |
| apple_notes.js | 0.5 小時 | 低（已足夠分離） |

**其他 Priorities (根據 AGENTS.md)：**
- P0: HA Failover reliability
- P1: Code quality (auto-fix, patterns)
- P2: New features

**機會成本結論：** 重構 error_tracker 和 health_monitor 符合 P1 Code quality，但唔應該犧牲 P0 HA 相關工作。

---

## 4. 實施方案

### 4.1 分階段實施

#### Phase 1: error_tracker 重構 (1-2 sessions)
```
Phase 1a: 建立 error_templates.js
Phase 1b: 建立 error_generator.js
Phase 1c: 重構 error_tracker.js 使用新架構
Phase 1d: 測試 + 驗證
```

#### Phase 2: health_monitor 重構 (1 session)
```
Phase 2a: 建立 health_templates.js
Phase 2b: 建立 health_generator.js
Phase 2c: 重構 health_monitor.js 使用新架構
```

#### Phase 3: stock_updater (可選，未來)
```
Phase 3a: 建立 stock_templates.js
Phase 3b: 建立 stock_generator.js
Phase 3c: 重構 stock_updater.js
```

### 4.2 優先級矩陣

| Script | 價值 | 成本 | 優先級 |
|--------|------|------|--------|
| error_tracker.js | 高 | 中 | **P1 - 立即做** |
| health_monitor.js | 高 | 低 | **P1 - Phase 2** |
| stock_updater.js | 中 | 中 | P3 - 以後做 |
| apple_notes.js | 低 | 低 | P3 - 唔好做 |

### 4.3 風險評估

| 風險 | 機率 | 影響 | 緩解 |
|------|------|------|------|
| 重構破壞現有功能 | 中 | 高 | 每個 phase 完成後測試 |
| Output format 改變影響下游 | 低 | 中 | templates.js 只影響 structure，唔影響 content |
| 過度工程 | 中 | 低 | 只重構有 多format 需求的 scripts |

### 4.4 具體步驟 (Phase 1)

**Step 1:** 創建 `scripts/error_templates.js`
```javascript
// 從 report_templates.js 複製架構
// 定義 ERROR_REPORT template
// 定義 SEVERITY_LEVELS 設定
```

**Step 2:** 創建 `scripts/error_generator.js`
```javascript
// class ErrorReportGenerator extends ReportGenerator
// 实现 populateErrorSection()
// 实现 toDiscordEmbed() 带 severity colors
```

**Step 3:** 重構 `error_tracker.js`
```javascript
// 保留 scanLogsForErrors(), scanSessionsForErrors()
// 替換 list(), stats() 使用 ErrorReportGenerator
// 保留 CLI interface
```

**Step 4:** 測試
```bash
node scripts/error_tracker.js list  # 確認輸出正常
node scripts/error_tracker.js scan  # 確認 scan 正常
```

---

## 5. 最終建議

### ✅ 結論：**係，但要分階段**

### 立即做 (Phase 1):
| Action | 原因 |
|--------|------|
| error_tracker.js | 高頻使用，需要多 format (Discord + JSON)，符合 Code Quality P1 |

### Phase 2 做 (未來 sprint):
| Action | 原因 |
|--------|------|
| health_monitor.js | 定期 Discord 輸出，分離有意義 |

### 以後做 (當有時間):
| Action | 原因 |
|--------|------|
| stock_updater.js | 功能已穩定，output 需求單一 |

### 唔好做:
| Action | 原因 |
|--------|------|
| apple_notes.js | 架構已足夠分離，重構收益低 |

### 關鍵原則:
1. **唔好為了重構而重構** — 只重構有 多format 需求 或 維護困難 的 scripts
2. **保持 templates.js 作為 reference implementation** — 新人可以直接睇呢個學習
3. **每個 phase 完成後立即測試** — 唔好累積太多變更
4. **預留 rollback 方案** — 如果重構出問題，可以快速恢復

---

## 6. 總結

| 問題 | 答案 |
|------|------|
| Template-Engine Separation 係好 design pattern 嗎？ | ✅係，report_templates.js + report_generator.js 係良好示範 |
| 所有 systems 都應該做嗎？ | ❌唔係，只有有 多format 需求 的先值得 |
| error_tracker.js 應該做嗎？ | ✅係，高價值 |
| health_monitor.js 應該做嗎？ | ✅係，值得做 |
| apple_notes.js 應該做嗎？ | ❌唔係，已足夠好 |
| 應該立即做嗎？ | ⚠️分階段，唔好一次過全部重構 |

**預期收益：** 提高 code quality、增強可測試性、統一輸出格式
**預期成本：** 3-5 小時重構時間
**Net Value：** ✅正面（如果分階段做）

---

*報告生成時間：2026-04-07 22:48 HKT*
