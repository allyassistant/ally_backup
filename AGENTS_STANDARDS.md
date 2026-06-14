# Coding Standards & Development Guidelines

*從 AGENTS.md 拆分出來 — Coding Standards 完整版*
*Last Updated: 2026-04-02*

> ⚠️ **注意**：本檔案從 AGENTS.md 拆分出來，因為原檔案太大（21,698 bytes），導致 OpenClaw bootstrap 被截斷 23%。

---

## Coding Standards (from Pure AI Audit)

*呢個章節從 Auto-Audit (2026-03-30) + Pure AI Audit (2026-03-31) 整合，用於预防错误。*

---

## P0 - 語法與結構錯誤（必須立即避免）

### ❌ 禁止：log 函數雙重宣告
```javascript
// ❌ 錯誤 - 同一 scope 雙重宣告
const log = (...args) => { if (!_quiet) console.log(...args); };
function log(decision, message, complexity) { ... }

// ✅ 正確 - 明確區分
const _log = (...args) => { if (!_quiet) console.log(...args); };
function log(decision, message, complexity) { ... }
```

### ❌ 禁止：Async function 入面用 sync fs 操作
```javascript
// ❌ 錯誤 - 阻塞 event loop
async function main() {
  fs.writeFileSync(file, data);
}

// ✅ 正確 - 使用 promises
async function main() {
  await fs.promises.writeFile(file, data);
}
```

### ❌ 禁止：呼叫未定義的函數
- 每次重構後檢查所有函數呼叫
- 確認 helper functions 存在先引用

---

## P1 - 錯誤處理（所有危險操作必備）

### ✅ 必須：execSync / fs 操作包 try-catch
```javascript
// ✅ 正確範例
try {
  const result = execSync(command);
} catch (e) {
  console.error(`Command failed: ${e.message}`);
  return; // 或適當的 error handling
}

// ✅ 正確範例 - fs 操作
try {
  const data = fs.readFileSync(filePath, 'utf8');
} catch (e) {
  console.error(`Read failed: ${e.message}`);
  return;
}
```

### ✅ 必須：重要函數加 top-level try-catch
包含 fs/exec/crypto/require 的函數必須有 error handling wrapper。

---

## P2 - 代碼質量（建議遵循）

### ✅ 推薦：Magic numbers → CONFIG 常量
```javascript
// ❌ 錯誤 - hardcoded numbers
if (diff > 180 * 24 * 60 * 60 * 1000)

// ✅ 正確 - CONFIG 常量
const CONFIG = {
  THIRTY_DAYS_MS: 180 * 24 * 60 * 60 * 1000, // 180 days
};
if (diff > CONFIG.THIRTY_DAYS_MS)
```

### ✅ 推薦：重要檔案寫入 → Atomic Write
```javascript
// ✅ 正確範例
const tmpPath = filePath + '.tmp';
fs.writeFileSync(tmpPath, content);
fs.renameSync(tmpPath, filePath);
```

### ✅ 推薦：大量輸出的函數 → quiet 參數
```javascript
// ✅ 正確範例
function processSomething(quiet = false) {
  if (!quiet) console.log('Processing...');
  // ...
}
```

### ✅ 推薦：用 slice() 取代 substr()（已废弃）
```javascript
// ❌ 錯誤 - substr 已废弃
str.substr(2, 5)

// ✅ 正確 - 使用 slice
str.slice(2, 7)
```

---

## P3 - 維護規範

### ✅ TODO/FIXME 完成後要刪除
```javascript
// ❌ 錯誤 - 已完成但留低
// TODO: implement this
function myFunc() { ... }

// ✅ 正確 - 完成後移除標記
function myFunc() { ... }
```

### ✅ 避免重複定義（DRY）
同一功能唔好有多個實現，統一用 lib/state.js 等共享模組。

---

## 快速檢查清單（每次修改前）

- [ ] execSync / fs 操作有 try-catch？
- [ ] async function 內冇用 sync 操作？
- [ ] 冇 double log 宣告？
- [ ] Magic numbers 提升為 CONFIG？
- [ ] 重要寫入用 atomic write？
- [ ] 大量輸出函數有 quiet 參數？
- [ ] 用 slice() 而唔係 substr()？
- [ ] 完成既 TODO/FIXME 已刪除？

---

## Security 規範（安全第一）

*防止常見安全漏洞的基本規則。*

---

### 🚨 最高優先：禁止 Shell Injection

#### ❌ 嚴禁：User Input 直接放入 Shell Command
```javascript
// ❌ 危險 - Shell Injection，可被攻擊
execSync(`rm -rf ${userInput}`);

// ✅ 安全 - 驗證 + 引用
const safeName = userInput.replace(/[^a-zA-Z0-9_-]/g, '');
execSync(`rm -rf /safe/path/${safeName}`);
```

#### ❌ 嚴禁：路徑中使用未驗證的 user input
```javascript
// ❌ 危險 - Path Traversal，可讀取任意檔案
const filePath = `/data/${req.body.filename}`;

// ✅ 安全 - basename() 只取最後一部分
const safePath = path.join('/data', path.basename(req.body.filename));
```

---

### ⚠️ 謹慎：敏感資訊處理

#### ✅ 禁止：API Keys / Tokens 寫入代碼
```javascript
// ❌ 危險 - Key 暴露在代碼中
const API_KEY = 'sk-xxxxxx-xxxxx';

// ✅ 正確 - 使用環境變量
const API_KEY = process.env.OPENAI_API_KEY;
```

#### ✅ 禁止：密碼 / 私鑰 log 輸出
```javascript
// ❌ 危險 - sensitive data in logs
console.log(`Password: ${password}`);

// ✅ 安全 - 只顯示長度或部分
console.log(`Password: ${'*'.repeat(password.length)}`);
```

---

## Performance 規範（保持系統流暢）

*避免阻塞、記憶體洩漏、效能問題的基本規則。*

---

### ⚠️ 熱路徑避免大量 Sync 操作

- Cron job / 每分鐘執行的 script 唔好有大量 `fs.sync` 操作
- 用 streaming / chunking 處理大檔案（> 1MB）

### ⚠️ 避免同步阻塞

- 任何 > 100ms 的操作應該是 async
- Node.js 係單線程，blocking = 全部停頓

### ⚠️ 監控重點

| 指標 | 警告閾值 | 行動 |
|------|---------|------|
| Script 執行時間 | > 30 秒 | 調查原因 |
| Memory 使用 | > 500MB | 優化或分割 |
| 同時打開檔案數 | > 100 | 檢查 leak |

---

## Testing 規範（質量保證）

*每次修改後必須驗證功能正常。*

---

### ✅ Reviewer Pattern - 修改前必須檢查

```bash
# 修改任何 script 前，必須先運行 impact 分析
node scripts/auto_fix.js impact <script-name>

# 確認影響範圍後先進行修改
```

**觸發條件：**
- 手動修改 script
- 用 Kimi Code CLI 修改 script

**Deploy 前把關：**
```bash
# 所有修改完成後，Deploy 前運行全面審查
node scripts/auto_fix.js deploy-check
```

### ✅ 每次修改後必須驗證

```bash
# 修改任何 script 後，運行 code_quality_manager.js 檢查問題
node ~/.openclaw/workspace/scripts/code_quality_manager.js scan --quiet

# 驗證語法
node --check ~/.openclaw/workspace/scripts/<script-name>.js

# 完整流程（新架構）
node scripts/code_quality_manager.js scan && node scripts/code_quality_manager.js verify
```

### ✅ 新 Function 測試考慮

| 情況 | 檢查點 |
|------|--------|
| 正常輸入 | 預期輸出正確？ |
| 邊界情況 | 空字串、null、超大值？ |
| 錯誤輸入 | 有適當 error message？ |
| 依賴外部 | 失敗時優雅降級？ |

### ✅ 關鍵 Functions 保持可測試

- 避免 hardcode 外部依賴（用參數傳入）
- 輸入/輸出清晰分離
- Side effects 最小化

---

## Documentation 規範（代碼即文檔）

*代碼係給人睇的，要有可讀性。*

---

### ✅ 複雜邏輯要解釋「為什麼」

```javascript
// ❌ 不足 - 數字係魔法
const diff = (a - b) / 1000;

// ✅ 足夠 - 解釋意義
// 轉換為秒，1000 = milliseconds per second
const diffSeconds = (a - b) / 1000;
```

### ✅ 每個 Script 頂部要有簡介

```javascript
/**
 * Script 名稱：daily_summary.js
 * 功能：生成每日回顧，發送到 Discord
 * 依賴：memory/, discord message tool
 * Cron：每日 23:59 運行
 * 作者：Ally (2026-03-01)
 */
```

### ✅ 避免神一般的變量名

```javascript
// ❌ 難明
const d = new Date();
const x = users.filter(u => u.a > 18);

// ✅ 易讀
const now = new Date();
const adults = users.filter(user => user.age > 18);
```

---

## 完整檢查清單（修改任何 Script 前）

| 類別 | 檢查項 | 重要性 |
|------|--------|--------|
| **語法** | 冇 log 雙重宣告 | 🚨 P0 |
| **Async** | async 內冇 sync 操作 | 🚨 P0 |
| **Error** | execSync/fs 有 try-catch | 🚨 P0 |
| **Security** | 冇 Shell Injection | 🚨 P0 |
| **Security** | 敏感資訊喺 env | 🚨 P0 |
| **Config** | Magic numbers → CONFIG | ⚠️ P1 |
| **Quality** | 重要寫入用 atomic | ⚠️ P1 |
| **Quality** | 大量輸出有 quiet | ⚠️ P1 |
| **Quality** | 用 slice() 非 substr() | ⚠️ P1 |
| **Perf** | 熱路徑冇大量 sync | ⚠️ P1 |
| **Doc** | 複雜邏輯有註釋 | 📝 P2 |
| **Test** | Smoke test 通過 | 📝 P2 |
| **Maintain** | TODO/FIXME 已清理 | 📝 P3 |

---

## Prevention Rules（自動生成）

> 🛡️ **Prevention Rule** (Auto-generated from Pure AI Audit)
> - 類別: execSync_missing_trycatch
> - 發現: 3 處問題，受影響: issue_manager.js, session_cleanup.js
> - 狀態: 已在 AGENTS.md Coding Standards P0 中備案

> 🛡️ **Prevention Rule** (Auto-generated from Code Quality Manager)
> - 類別: magic_numbers
> - 發現: Batch Verification 自動識別
> - 狀態: 已在 AGENTS.md Coding Standards P1 中備案
> - Pattern Store: memory/patterns/fp_whitelist.json

---

*檔案來源：从 AGENTS.md 拆分出來 | 2026-04-23*
*用途：保持 AGENTS.md < 12,000 bytes，讓 OpenClaw bootstrap 能完整載入*