# health_monitor.js 整合分析報告

**檢查日期:** 2026-04-07 23:25 HKT  
**分析目標:** `scripts/health_monitor.js` (Phase 2 重構後 - Template-Engine 架構)  
**分析人:** Sub-agent

---

## 📋 Step 1: 發現的所有相關 scripts

### 1. `scripts/skills_manager.js` (行 163-177)
- **整合方式:** 技能定義 (Skills Catalog metadata)
- **引用內容:**
  ```javascript
  health_monitor: {
    file: "scripts/autoops/health_monitor.js",  // ⚠️ 注意：指向 autoops 版本
    name: "Health Monitor",
    exists: true
  }
  ```
- **評估:** ⚠️ **需注意** - 指向 `autoops/health_monitor.js`（舊版），而非新版 `scripts/health_monitor.js`

### 2. `scripts/health_generator.js`
- **整合方式:** `require()` - 作為 health_monitor 的核心模組
- **關係:** Phase 2 Template-Engine 架構的一部分
- **評估:** ✅ **正常** - 正確的內部依賴

### 3. `scripts/health_templates.js`
- **整合方式:** `require()` - health_generator 的依賴
- **關係:** Phase 2 架構的最底層模板定義
- **評估:** ✅ **正常** - 正確的內部依賴鏈

### 4. `scripts/autoops/health_monitor.js`
- **整合方式:** 獨立 script（非同一檔案）
- **用途:** Qwen3 AutoOps 舊版監控腳本
- **狀態:** 與新版 `scripts/health_monitor.js` 完全無關
- **評估:** ✅ **無風險** - 兩個獨立腳本

### 5. `scripts/system_check_bot.js`
- **整合方式:** 無直接引用 health_monitor
- **備註:** 行 462 使用 `openclaw gateway call cron.list --json`，但與 health_monitor 無關
- **評估:** ✅ **無關**

---

## 📋 Step 2: Cron Jobs 和 HEARTBEAT.md

### Crontab 檢查結果
```
❌ 沒有任何 cron job 調用 health_monitor.js
```

目前 crontab 中的 jobs:
| Job | Script |
|-----|--------|
| HA Heartbeat | heartbeat.sh |
| HA Failover | failover_detector.sh |
| Memory archiver | memory_archiver.js |
| Memory cleanup | memory_section_cleanup.js |
| Pattern Analysis | pattern_analysis_daily.js |
| Daily Memory Logger | log_to_daily_memory.js |

### HEARTBEAT.md
```
❌ 沒有引用 health_monitor
```

### README.md
```
❌ 沒有引用 health_monitor
```

---

## 📋 Step 3: Data Format 兼容性

### 輸出模式 (檢查點)

| 模式 | Flag | 輸出目標 | 評估 |
|------|------|----------|------|
| 預設 | 無 | Console stdout | ✅ |
| 靜默 | `--quiet` | Console (僅有問題時) | ✅ |
| JSON | `--json` | Console JSON | ✅ |
| Discord | `--notify` | Discord 頻道 | ✅ |

### 關鍵觀察
- Phase 2 重構**保持**了所有原有 CLI 介面
- `--json` 模式輸出保持向后兼容
- **沒有任何 script** 依賴 health_monitor 的 JSON 輸出格式
- `memory/system-health.log` 是舊版 autoops 腳本的輸出，與新版無關

---

## 📋 Step 4: 整合狀況總結

| Script | 整合方式 | 評估 | 備註 |
|--------|----------|------|------|
| skills_manager.js | 技能定義 | ⚠️ 需調整 | 指向錯誤路徑 (autoops 而非 scripts/) |
| health_generator.js | require | ✅ 正常 | Phase 2 架構核心 |
| health_templates.js | require | ✅ 正常 | Phase 2 架構核心 |
| autoops/health_monitor.js | 獨立 | ✅ 無關 | 舊版 Qwen3 AutoOps |
| system_check_bot.js | 無 | ✅ 無關 | 獨立系統檢查 |
| Crontab | 無 | ✅ 無依賴 | 獨立運行 |
| 其他 scripts | 無 | ✅ 無依賴 | 沒有直接讀取輸出 |

---

## 📋 Step 5: 發現的問題

### 🔴 問題 1: skills_manager.js 指向錯誤路徑

**檔案:** `scripts/skills_manager.js:164`  
**問題:** 技能定義指向 `scripts/autoops/health_monitor.js`，但新版的 Phase 2 重構是在 `scripts/health_monitor.js`
**影響:** 如果用戶通過 skills_manager 觸發健康檢查，會執行舊版而非新版
**建議:** 更新 `skills_manager.js` 行 164:
```javascript
// 改為
file: "scripts/health_monitor.js",
```

---

## 📋 Step 6: 建議行動

### P0 - 立即執行
1. **更新 skills_manager.js** - 修正路徑指向新版 health_monitor.js

### P1 - 建議執行
2. **清理舊版 autoops/health_monitor.js** - 考慮移至 archive/
3. **更新 README.md** - 加入新版 health_monitor.js 的使用說明

### P2 - 可選
4. **添加 cron job** (如果需要定期健康檢查):
   ```bash
   # 每日 08:00 健康檢查
   0 8 * * * node /Users/ally/.openclaw/workspace/scripts/health_monitor.js --quiet --notify
   ```

---

## 結論

**health_monitor.js Phase 2 重構後的整合狀況:**
- ✅ **架構良好** - Template-Engine 分離清晰
- ✅ **向后兼容** - CLI 介面不變
- ✅ **零下游依賴** - 沒有其他 script 依賴其輸出
- ⚠️ **一個需修復** - skills_manager.js 指向舊路徑

**總體評估:** ✅ **可以使用**，只需修正 skills_manager.js 的路徑即可。
