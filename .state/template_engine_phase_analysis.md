# Template-Engine Phase Analysis

*Generated: 2026-04-07 | Ally | Phase 3 Complete*

---

## 📊 Analysis Criteria

| 準則 | 分數 |
|------|------|
| **Output Coupling** | 高=5分（直接格式化輸出）、中=3分、低=1分 |
| **多 format 需求** | 有=5分（有明確多format需求）、中=3分、低=1分 |
| **大小** | >300行=3分、>150行=2分、<150行=1分 |
| **維護頻率** | 高=3分、中=1分、低=0分 |

**總分 ≥ 12分** → 值得做 Template-Engine
**總分 8-11分** → 以後考慮
**總分 < 8分** → 唔值得

---

## 📋 Complete Scripts Analysis

| Script | Lines | Output Coupling | 多Format | 大小 | 維護 | 總分 | 建議 |
|--------|-------|----------------|----------|------|------|------|------|
| error_generator.js | 354 | 5 | 5 | 3 | 3 | 16 | ✅ Phase 1 DONE |
| error_templates.js | 116 | 5 | 5 | 2 | 3 | 15 | ✅ Phase 1 DONE |
| health_generator.js | 372 | 5 | 5 | 3 | 3 | 16 | ✅ Phase 2 DONE |
| health_templates.js | 240 | 5 | 5 | 2 | 3 | 15 | ✅ Phase 2 DONE |
| **code_quality_manager.js** | 1361 | 5 | 5 | 3 | 3 | **16** | ✅ Phase 3 |
| weekly_correction_loop.js | 1250 | 5 | 5 | 3 | 3 | 16 | ✅ Phase 4 |
| system_check_bot.js | 846 | 5 | 5 | 3 | 3 | 16 | ✅ Phase 4 |
| daily_summary_bot.js | 434 | 5 | 3 | 2 | 3 | 13 | ✅ Phase 4 |
| memory_generator.js | 646 | 5 | 3 | 3 | 3 | 14 | ✅ Phase 4 |
| issue_manager.js | 794 | 3 | 3 | 3 | 3 | 12 | ✅ Phase 4 |
| rapnet_weekly.js | 370 | 5 | 3 | 2 | 3 | 13 | ✅ Phase 4 |
| auto_fix.js | 2752 | 3 | 3 | 3 | 2 | 11 | 🟡 以後考慮 |
| auto_issue_creator.js | 758 | 3 | 3 | 3 | 2 | 11 | 🟡 以後考慮 |
| apple_notes.js | 214 | 3 | 1 | 2 | 2 | 8 | 🟡 以後考慮 |
| apple_reminders_calendar.js | 233 | 3 | 1 | 2 | 2 | 8 | 🟡 以後考慮 |
| smart_memory_router.js | 384 | 1 | 1 | 2 | 2 | 6 | ❌ 唔值得 |
| task_router.js | 616 | 1 | 1 | 3 | 2 | 7 | ❌ 唔值得 |
| session_recovery.js | 334 | 1 | 1 | 2 | 2 | 6 | ❌ 唔值得 |
| session_cleanup.js | 296 | 1 | 1 | 2 | 1 | 5 | ❌ 唔值得 |
| stock_updater.js | 424 | 1 | 1 | 2 | 1 | 5 | ❌ 唔值得 |
| auto-spawn.js | 259 | 1 | 1 | 2 | 1 | 5 | ❌ 唔值得 |
| rapnet_sender.js | 246 | 1 | 1 | 2 | 1 | 5 | ❌ 唔值得 |
| customer360.js | 242 | 1 | 1 | 2 | 1 | 5 | ❌ 唔值得 |
| daily_maintenance.js | 284 | 1 | 1 | 2 | 1 | 5 | ❌ 唔值得 |
| contact_manager.js | 217 | 1 | 1 | 2 | 1 | 5 | ❌ 唔值得 |
| customer_analyzer.js | 139 | 1 | 1 | 1 | 1 | 4 | ❌ 唔值得 |

---

## ✅ Phase 4 候選（總分 ≥ 12分）

按優先順序排列：

| 優先 | Script | 總分 | 關鍵原因 |
|------|--------|------|----------|
| 1 | **code_quality_manager.js** | 16 | Phase 3，already started |
| 2 | **weekly_correction_loop.js** | 16 | 每週報告，大量 Discord embed |
| 3 | **system_check_bot.js** | 16 | 每日系統檢查，大量格式化輸出 |
| 4 | **memory_generator.js** | 14 | L0/L1 生成，有固定 format |
| 5 | **daily_summary_bot.js** | 13 | 每日總結，多 output targets |
| 6 | **rapnet_weekly.js** | 13 | 每週 RapNet 報告 |
| 7 | **issue_manager.js** | 12 | 任務管理，多種 output |

### Phase 4 詳細分析

#### 1. code_quality_manager.js (1361 lines)
- **Status:** Phase 3 (already started)
- **Output:** Discord embed + JSON + Markdown + CLI
- **Key patterns:** Batch verification, pattern learning, auto-repair
- **Recommendation:** Continue as Phase 3

#### 2. weekly_correction_loop.js (1250 lines)
- **Output:** Discord embed + JSON + Markdown
- **Key patterns:** Error analysis → rule generation → user confirmation → AGENTS.md update
- **Score breakdown:**
  - Output Coupling: 5 (Discord embed formatter embedded)
  - Multi-Format: 5 (Discord + JSON + Markdown + text)
  - Size: 3 (1250 lines)
  - Maintenance: 3 (weekly, high)
  - **Total: 16**
- **Recommendation:** ✅ 值得做

#### 3. system_check_bot.js (846 lines)
- **Output:** Discord embed + JSON + Markdown
- **Key patterns:** Reminders + Errors + Health monitoring
- **Score breakdown:**
  - Output Coupling: 5 (Discord embed formatter embedded)
  - Multi-Format: 5 (Discord + JSON + Markdown + text)
  - Size: 3 (846 lines)
  - Maintenance: 3 (daily, high)
  - **Total: 16**
- **Recommendation:** ✅ 值得做

#### 4. memory_generator.js (646 lines)
- **Output:** Markdown files (L0/L1)
- **Key patterns:** L0 abstract + L1 overview generation
- **Score breakdown:**
  - Output Coupling: 5 (structured markdown output)
  - Multi-Format: 3 (L0 + L1 兩種 format)
  - Size: 3 (646 lines)
  - Maintenance: 3 (daily, high)
  - **Total: 14**
- **Recommendation:** ✅ 值得做

#### 5. daily_summary_bot.js (434 lines)
- **Output:** Discord embed + Apple Notes
- **Key patterns:** Daily summary + AI generation
- **Score breakdown:**
  - Output Coupling: 5 (Discord embed + Notes)
  - Multi-Format: 3 (Discord + Notes)
  - Size: 2 (434 lines)
  - Maintenance: 3 (daily, high)
  - **Total: 13**
- **Recommendation:** ✅ 值得做

#### 6. rapnet_weekly.js (370 lines)
- **Output:** Discord embed + Email
- **Key patterns:** Weekly diamond report
- **Score breakdown:**
  - Output Coupling: 5 (Discord embed)
  - Multi-Format: 3 (Discord + Email)
  - Size: 2 (370 lines)
  - Maintenance: 3 (weekly, high)
  - **Total: 13**
- **Recommendation:** ✅ 值得做

#### 7. issue_manager.js (794 lines)
- **Output:** Terminal + JSON files
- **Key patterns:** Issue creation, tracking, completion
- **Score breakdown:**
  - Output Coupling: 3 (terminal text formatting)
  - Multi-Format: 3 (list + create + show)
  - Size: 3 (794 lines)
  - Maintenance: 3 (frequently used)
  - **Total: 12**
- **Recommendation:** ✅ 值得做
- **Note:** Output coupling 稍低，但 size 大 + 多 format command

---

## 🟡 以後考慮（總分 8-11分）

| Script | 總分 | 原因 |
|--------|------|------|
| **auto_fix.js** | 11 | 太大(2752行)，但 output coupling 低，主要係 internal logic |
| **auto_issue_creator.js** | 11 | 大(758行)，output coupling 中 |
| **apple_notes.js** | 8 | 中等大小，單一 format |
| **apple_reminders_calendar.js** | 8 | 中等大小，單一 format |

### 以後考慮分析

#### auto_fix.js (2752 lines)
- **Issue:** 最大 script，但 output coupling 低
- **核心：** 主要係 internal logic (fix, deploy, impact analysis)
- **Output：** 主要係 terminal text，JSON 係其次
- **Decision:** 值得做，但需要大量重構工作

#### auto_issue_creator.js (758 lines)
- **Issue:** 大，但 output coupling 中
- **核心：** 自動創建 issue
- **Decision:** 可以考慮，但優先級低過 Phase 4

---

## ❌ 唔值得做（總分 < 8分）

| Script | 總分 | 原因 |
|--------|------|------|
| smart_memory_router.js | 6 | 主要 internal routing，output 係 files |
| task_router.js | 7 | 主要 internal routing |
| session_recovery.js | 6 | terminal output，single format |
| session_cleanup.js | 5 | terminal output，single format |
| stock_updater.js | 5 | Excel/JSON，single target |
| auto-spawn.js | 5 | terminal output，single format |
| rapnet_sender.js | 5 | 網絡發送，single target |
| customer360.js | 5 | terminal output，single format |
| daily_maintenance.js | 5 | terminal output，single format |
| contact_manager.js | 5 | terminal output，single format |
| customer_analyzer.js | 4 | 太小(<150行)，single format |

### 唔值得做原因分析

呢啲 scripts 嘅共同問題：
1. **Output Coupling 低** - 主要係 terminal text，無需 template engine
2. **Single Format** - 唔需要多 format 輸出
3. **Internal Logic** - 主要係 routing/computation，output 係副作用

---

## 📝 建議執行順序

### Phase 3（進行中）
1. **code_quality_manager.js** - 正在重構

### Phase 4（建議順序）
1. **weekly_correction_loop.js** - 1250行，每週報告，高價值
2. **system_check_bot.js** - 846行，每日報告，高價值
3. **memory_generator.js** - 646行，L0/L1 生成
4. **daily_summary_bot.js** - 434行，每日總結
5. **rapnet_weekly.js** - 370行，每週報告
6. **issue_manager.js** - 794行，任務管理

### 以後考慮
- auto_fix.js（需要大量工作）
- auto_issue_creator.js

---

## 📊 統計摘要

| Category | Count |
|----------|-------|
| **Phase 1 DONE** | 2 (error_generator, error_templates) |
| **Phase 2 DONE** | 2 (health_generator, health_templates) |
| **Phase 3 IN PROGRESS** | 1 (code_quality_manager) |
| **Phase 4 Candidates** | 7 |
| **以後考慮** | 4 |
| **唔值得做** | 11 |
| **Total** | 27 |

---

## 🎯 關鍵洞察

1. **高價值 candidates：** weekly_correction_loop + system_check_bot + memory_generator 呢三個加埋有 2760 行，全部係 high maintenance、高 output coupling
2. **Template Engine 適用場景：** Discord embed 多 format 輸出係最佳候選
3. **唔值得做嘅 pattern：** 主要 internal logic、single terminal output、simple data files

---

*Last Updated: 2026-04-07 | Ally*
