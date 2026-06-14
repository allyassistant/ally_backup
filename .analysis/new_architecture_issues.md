# Code Quality Manager - Issues List

**Generated**: 2026-04-05
**Source**: Kimi Code CLI Audit

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 2 |
| Medium | 5 |
| Low | 3 |
| **Total** | **12** |

---

## Issues List

### Critical Issues

#### CQM-001: LocalScanner 使用 basename 導致路徑信息丟失
- **Location**: `lib/auditOrchestrator.js:97,120`
- **Rule**: `path_basename_data_loss`
- **Category**: reliability
- **Description**: LocalScanner 在創建 Issue 時使用 `path.basename(file)`，導致不同目錄下同名的文件無法區分，issue 合併時會出現誤判。
- **Impact**: 不同目錄的同名文件問題會被錯誤合併
- **Fix**: 改用 `path.relative(process.cwd(), file)` 或完整路徑
- **AutoFixable**: No

#### CQM-002: Issue 合併 key 使用 basename 導致碰撞
- **Location**: `lib/auditOrchestrator.js:362`
- **Rule**: `merge_key_collision`
- **Category**: reliability
- **Description**: `merge()` 函數使用 `${file}:${line}:${rule}` 作為去重 key，但 file 已是 basename。
- **Impact**: 同名文件的不同問題會被錯誤去重
- **Fix**: 使用完整路徑或相對路徑作為 key 的一部分
- **AutoFixable**: No

---

### High Issues

#### CQM-003: scanDirectory 未處理 null 輸入
- **Location**: `lib/fileDiscovery.js:134`
- **Rule**: `null_input_handling`
- **Category**: reliability
- **Description**: 當傳入 null 或 undefined 時，函數會拋出異常而非優雅處理。
- **Impact**: API 使用不當時會崩潰
- **Fix**: 添加參數驗證
- **AutoFixable**: Yes

#### CQM-004: runAudit 中無效 issue 被靜默忽略
- **Location**: `code_quality_manager.js:265`
- **Rule**: `silent_error_swallowing`
- **Category**: reliability
- **Description**: try-catch 塊為空，無效 issue 的錯誤信息丟失。
- **Impact**: 調試困難，無法追蹤問題
- **Fix**: 添加日誌或錯誤收集
- **AutoFixable**: Yes

---

### Medium Issues

#### CQM-005: 無文件大小限制讀取
- **Location**: `lib/fileDiscovery.js:106`
- **Rule**: `unbounded_file_read`
- **Category**: performance
- **Description**: computeHash 和 scanDirectory 無限制地讀取文件內容。
- **Impact**: 大文件可能導致記憶體問題
- **Fix**: 添加 `MAX_FILE_SIZE` 限制
- **AutoFixable**: Yes

#### CQM-006: atomicWriteSync tmp 文件清理不完整
- **Location**: `lib/config.js:53`
- **Rule**: `tmp_file_cleanup`
- **Category**: security
- **Description**: 雖有 try-catch 清理，但在某些極端情況下可能殘留。
- **Impact**: 可能累積 tmp 文件
- **Fix**: 使用同步清理或 `process.on('exit')`
- **AutoFixable**: Yes

#### CQM-007: Magic number 規則過於嚴格
- **Location**: `lib/auditOrchestrator.js:111`
- **Rule**: `overzealous_magic_number`
- **Category**: style
- **Description**: 將年份（如 2026）誤判為 magic number。
- **Impact**: 產生大量無意義的 low severity issues
- **Fix**: 添加白名單（年份、常見端口等）
- **AutoFixable**: Yes

#### CQM-008: severityOrder 定義重複
- **Location**: `lib/auditOrchestrator.js:370`
- **Rule**: `duplicate_severity_order`
- **Category**: maintainability
- **Description**: 第 370 行和 382 行有相同的 severityOrder 定義。
- **Impact**: 維護困難，可能不一致
- **Fix**: 提取為常量或共享函數
- **AutoFixable**: Yes

#### CQM-009: SARIF 生成邏輯重複
- **Location**: `issueAggregator.js:464`, `code_quality_manager.js:152`
- **Rule**: `duplicate_sarif_generation`
- **Category**: maintainability
- **Description**: issueAggregator.js 和 code_quality_manager.js 都有 SARIF 生成。
- **Impact**: 代碼重複，維護困難
- **Fix**: 統一到單一模組
- **AutoFixable**: No

---

### Low Issues

#### CQM-010: 缺少路徑遍歷檢查
- **Location**: `lib/fileDiscovery.js:134`
- **Rule**: `path_traversal_check`
- **Category**: security
- **Description**: 未驗證掃描路徑是否包含 `../` 等跳轉。
- **Impact**: 理論上可能訪問預期外目錄
- **Fix**: 使用 `path.resolve` 和驗證
- **AutoFixable**: Yes

#### CQM-011: CLI main 函數重複實現文件掃描
- **Location**: `lib/auditOrchestrator.js:471`
- **Rule**: `duplicate_scan_logic`
- **Category**: reliability
- **Description**: main 函數中的 scanDir 與 FileDiscovery 功能重複。
- **Impact**: 代碼重複
- **Fix**: 使用 FileDiscovery 類別
- **AutoFixable**: Yes

#### CQM-012: 假設所有文件為 UTF-8
- **Location**: `lib/fileDiscovery.js:153`
- **Rule**: `encoding_assumption`
- **Category**: style
- **Description**: 讀取文件時未處理編碼問題。
- **Impact**: 二進制文件可能導致問題
- **Fix**: 添加編碼檢測或錯誤處理
- **AutoFixable**: Yes

---

## Priority Fix Order

### Phase 1: Immediate (Critical)
1. CQM-001: Fix basename usage
2. CQM-002: Fix merge key collision

### Phase 2: Short-term (High)
3. CQM-003: Add null input validation
4. CQM-004: Add error logging

### Phase 3: Medium-term (Medium)
5. CQM-005: Add file size limit
6. CQM-006: Improve tmp cleanup
7. CQM-007: Add magic number whitelist
8. CQM-008: Deduplicate severityOrder
9. CQM-009: Unify SARIF generation

### Phase 4: Long-term (Low)
10. CQM-010: Add path traversal check
11. CQM-011: Use FileDiscovery in CLI
12. CQM-012: Add encoding detection