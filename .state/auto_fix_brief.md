# Auto-Audit Brief
📅 2026-05-30, 15:01:49 HKT

## 📊 概覽
- 掃描檔案: 19
- 有問題檔案: 9
- Low-risk 已修復: 0/5
- High-risk 待確認: 8
- 未解決錯誤: 20
- 重複錯誤: 0
- 系統審計問題: 132

## ⚠️ High-Risk 問題
### HR-001 — scripts/knowledge_ingester.js
- **問題:** 檔案寫入缺少 atomic write 保護
- **嚴重性:** medium
- **詳情:** L441: fs.writeFileSync(memoryPath, existing + entry);
    L443: fs.writeFileSync(memoryPath, header + entry);
- **建議:** 重要檔案寫入應使用 atomic write（先寫 .tmp 再 rename）防止 crash 時據據損壞
- **行號:** 441, 443

### HR-002 — scripts/mail_monitor.js
- **問題:** 重複 loadState/saveState 定義
- **嚴重性:** high
- **詳情:** L20: 本地定義 loadState，應使用 lib/state.js
    L24: 本地定義 saveState，應使用 lib/state.js
- **建議:** 刪除本地定義，改為 require('./lib/state')
- **行號:** 20, 24

### HR-003 — scripts/memory_generator.js
- **問題:** 條件分支中返回值不一致
- **嚴重性:** high
- **詳情:** L342: isNoiseLine() — if block 內 return true (L340 亦有 return true，語義可能不一致)
    L343: isNoiseLine() — if block 內 return true (L340 亦有 return true，語義可能不一致)
    L344: isNoiseLine() — if block 內 return true (L340 亦有 return true，語義可能不一致)
    L346: isNoiseLine() — if block 內 return true (L340 亦有 return true，語義可能不一致)
    L347: isNoiseLine() — if block 內 return true (L340 亦有 return true，語義可能不一致)
    L349: isNoiseLine() — if block 內 return true (L340 亦有 return true，語義可能不一致)
    L351: isNoiseLine() — if block 內 return true (L340 亦有 return true，語義可能不一致)
    L352: isNoiseLine() — if block 內 return true (L340 亦有 return true，語義可能不一致)
    L353: isNoiseLine() — if block 內 return true (L340 亦有 return true，語義可能不一致)
    L356: isNoiseLine() — if block 內 return true (L340 亦有 return true，語義可能不一致)
    L358: isNoiseLine() — if block 內 return true (L340 亦有 return true，語義可能不一致)
- **建議:** 確保不同條件分支的返回值能區分「成功」與「跳過」，建議返回 { success, skipped, reason } 或用不同值
- **行號:** 342, 343, 344, 346, 347, 349, 351, 352, 353, 356

### HR-004 — scripts/write_to_obsidian.js
- **問題:** 檔案寫入缺少 atomic write 保護
- **嚴重性:** medium
- **詳情:** L189: fs.writeFileSync(filepath, noteContent);
- **建議:** 重要檔案寫入應使用 atomic write（先寫 .tmp 再 rename）防止 crash 時據據損壞
- **行號:** 189

### HR-005 — scripts/gia_grading_logic_extractor.js
- **問題:** 檔案寫入缺少 atomic write 保護
- **嚴重性:** medium
- **詳情:** L250: fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
- **建議:** 重要檔案寫入應使用 atomic write（先寫 .tmp 再 rename）防止 crash 時據據損壞
- **行號:** 250

### HR-006 — scripts/gia_cert_analyzer_v17.2.0.js
- **問題:** 檔案過大
- **嚴重性:** medium
- **詳情:** 286KB - 跳過詳細分析
- **建議:** 考慮拆分檔案

### HR-007 — scripts/log_to_daily_memory.js
- **問題:** 檔案寫入缺少 atomic write 保護
- **嚴重性:** medium
- **詳情:** L96: fs.writeFileSync(dayFile, header);
- **建議:** 重要檔案寫入應使用 atomic write（先寫 .tmp 再 rename）防止 crash 時據據損壞
- **行號:** 96

### HR-008 — scripts/generate_symbols.js
- **問題:** 檔案寫入缺少 atomic write 保護
- **嚴重性:** medium
- **詳情:** L800: fs.writeFileSync(outputPath, md, 'utf8');
- **建議:** 重要檔案寫入應使用 atomic write（先寫 .tmp 再 rename）防止 crash 時據據損壞
- **行號:** 800

## 🔧 系統審計
### JS 語法錯誤
- scripts/fix_broken_notes_final.js: /Users/ally/.openclaw/workspace/scripts/fix_broken_notes_final.js:22
  } catch (e) {
  ^
### 硬編碼路徑 (1 處)
- scripts/backup_to_bliss.sh:13 — 改用 $HOME
### Cron 引用缺失腳本 (2 個)
- /.openclaw/workspace/scripts/failover_detector.sh
- /mail_monitor.js
### 懸空引用 (18 個)
- scripts/_legacy/audit_scanner.js:19 → auto-spawn.js
- scripts/_legacy/audit_scanner.js:20 → auto_issue_creator.js
- scripts/_legacy/audit_scanner.js:22 → check-router-decision.js
- scripts/_legacy/audit_scanner.js:30 → gia_batch_processor.js
- scripts/_legacy/audit_scanner.js:39 → l0_generator.js
- scripts/_legacy/audit_scanner.js:39 → l1_generator.js
- scripts/_legacy/audit_scanner.js:63 → smart_memory_router.js
- scripts/_legacy/pure_ai_audit.js:25 → config.js
- scripts/_legacy/pure_ai_audit.js:35 → pure_ai_audit_v2.js
- scripts/generate_symbols.js:285 → discord_bot.js
### Module Not Found (1 個)
- scripts/_legacy/pure_ai_audit.js:25 → require('./lib/config')
### Missing Helper (96 處)
- scripts/churn_predictor.js:97 → getRecommendedAction()
- scripts/churn_predictor.js:119 → getAllAtRiskProfiles()
- scripts/code_quality_manager.js:360 → getIssues()
- scripts/code_quality_manager.js:449 → getSummary()
- scripts/code_quality_manager.js:522 → getCacheStats()
- scripts/code_quality_manager.js:629 → parseArgs()
- scripts/customer360.js:21 → buildProfile()
- scripts/customer360.js:177 → getProfile()
- scripts/customer360.js:208 → getAllProfiles()
- scripts/customer_analyzer.js:63 → getCaratRange()
### Sync in Async (9 處)
- scripts/closed_loop_v11_runner.js:150 — execSync in runIntegrationTest()
- scripts/daily_maintenance.js:141 — mkdirSync in moveBakFilesToBackup()
- scripts/daily_summary_bot.js:47 — readFileSync in getDiscordToken()
- scripts/gia_cert_analyzer.js:6057 — readFileSync in sendToDiscord()
- scripts/gia_cert_analyzer.js:6276 — readFileSync in describeImageWithMinimaxVLM()
- scripts/issue_manager.js:297 — mkdirSync in withCreateLock()
- scripts/rapnet_ai_summary.js:28 — readFileSync in main()
- scripts/rapnet_sender.js:181 — readFileSync in main()
- scripts/wiki_vectorizer.js:75 — mkdirSync in getDB()

## 🔬 Error Pattern Analysis
📉 **MiniMax Error** — 5 次 (0 未解決)
  根本原因: 未知錯誤類型 — 需要進一步調查
  建議: 檢查 error log 中的完整錯誤訊息，手動分析根本原因
  需人手: 是

📉 **Kimi Error** — 5 次 (0 未解決)
  根本原因: 未知錯誤類型 — 需要進一步調查
  建議: 檢查 error log 中的完整錯誤訊息，手動分析根本原因
  需人手: 是

📉 **Rate Limit** — 16 次 (9 未解決)
  根本原因: API 調用頻率超過限制（429 Too Many Requests），常見於密集 cron job 或 burst 請求
  建議: 增加請求間隔、實現 exponential backoff、或減少 cron 頻率
  需人手: 否

📉 **File Not Found** — 4 次 (0 未解決)
  根本原因: ENOENT — 引用嘅檔案路徑不存在，可能係路徑 hardcode 錯誤或檔案被刪除
  建議: 確認路徑正確，用 process.env.HOME 代替 hardcoded 路徑；如有需要重新生成缺失檔案
  需人手: 是

📉 **Discord Error** — 5 次 (0 未解決)
  根本原因: Discord 訊息傳送失敗，通常係暫時性網絡問題或 bot token 過期
  建議: 等待後重試；檢查 Discord bot status 同 token 有效性
  需人手: 否

📉 **File Error** — 3 次 (0 未解決)
  根本原因: 未知錯誤類型 — 需要進一步調查
  建議: 檢查 error log 中的完整錯誤訊息，手動分析根本原因
  需人手: 是

📉 **Auth Error** — 4 次 (0 未解決)
  根本原因: 未知錯誤類型 — 需要進一步調查
  建議: 檢查 error log 中的完整錯誤訊息，手動分析根本原因
  需人手: 是

📉 **Cron Timeout** — 3 次 (1 未解決)
  根本原因: 未知錯誤類型 — 需要進一步調查
  建議: 檢查 error log 中的完整錯誤訊息，手動分析根本原因
  需人手: 是

📉 **Ollama Error** — 2 次 (0 未解決)
  根本原因: Ollama 本地模型服務錯誤，可能係 API key 無效（401）、服務未啟動、或模型未下載
  建議: 檢查 `ollama list` 確認模型存在；重啟 `ollama serve`；驗證 API key
  需人手: 是

📉 **Timeout Error** — 7 次 (6 未解決)
  根本原因: 未知錯誤類型 — 需要進一步調查
  建議: 檢查 error log 中的完整錯誤訊息，手動分析根本原因
  需人手: 是

📉 **API Aborted** — 2 次 (0 未解決)
  根本原因: 未知錯誤類型 — 需要進一步調查
  建議: 檢查 error log 中的完整錯誤訊息，手動分析根本原因
  需人手: 是

📉 **DNS Error** — 3 次 (3 未解決)
  根本原因: 未知錯誤類型 — 需要進一步調查
  建議: 檢查 error log 中的完整錯誤訊息，手動分析根本原因
  需人手: 是

📉 **WhatsApp Error** — 3 次 (0 未解決)
  根本原因: 未知錯誤類型 — 需要進一步調查
  建議: 檢查 error log 中的完整錯誤訊息，手動分析根本原因
  需人手: 是

📉 **Manual** — 1 次 (1 未解決)
  根本原因: 未知錯誤類型 — 需要進一步調查
  建議: 檢查 error log 中的完整錯誤訊息，手動分析根本原因
  需人手: 是

## ✅ 已自動修復 (Low-Risk)
- **scripts/mail_monitor.js**: 🔎 Magic Number → Named Const（安全版）: 4 個可提取 const 的 magic numbers（出現 2+ 次）
- **scripts/weekly_correction_loop.js**: 🔎 Magic Number → Named Const（安全版）: 2 個可提取 const 的 magic numbers（出現 2+ 次）
- **scripts/memory_generator.js**: 🔎 Magic Number → Named Const（安全版）: 3 個可提取 const 的 magic numbers（出現 2+ 次）
- **scripts/log_to_daily_memory.js**: 🔎 Magic Number → Named Const（安全版）: 8 個可提取 const 的 magic numbers（出現 2+ 次）
- **scripts/generate_symbols.js**: 🔎 Magic Number → Named Const（安全版）: 3 個可提取 const 的 magic numbers（出現 2+ 次）
