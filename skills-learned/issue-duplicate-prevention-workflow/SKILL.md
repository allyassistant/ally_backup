---
name: issue-duplicate-prevention-workflow
description: 建立新追蹤項目前，先系統性檢查現有相關 issues，避免重複監控同一問題
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-11T04:03:00.000Z
---

## Workflow

1. **解析用戶意圖**
   - 用戶說「先檢查下有冇相關issue係觀察緊呢樣嘢，冇就新增一個詳細issue」
   - 識別目標：某個監控指標 / 觀察項目 / 需要追蹤的問題
   - 提取關鍵標籤（label）或關鍵詞（keyword）

2. **列出所有現有 issues**
   ```bash
   gh issue list --state all --limit 200
   ```
   或讀取本地追蹤文件：
   ```bash
   ls ~/.openclaw/workspace/.issues/ && cat ~/.openclaw/workspace/.issues/*.md
   ```

3. **搜尋重疊**
   - 按 label 搜：`gh issue list --label <label> --state all`
   - 按標題關鍵詞搜：`gh issue list --search "<keyword>" --state all`
   - 比對目標：同一個監控主題是否已有 open / in-progress issue

4. **決策分支**
   - **有現有相關 issue → UPDATE**
     - 讀取現有 issue 內容
     - 評估是否需要更新狀態 / 加入 checkpoint / 擴充 detail
     - 若已有完整追蹤，回复用戶「已存在 #N」，不再重複創建
   - **沒有現有相關 issue → CREATE**
     - 進入步驟 5

5. **寫入詳細 issue**
   必要欄位：
   - **Title**：`<領域>-<監控目標>-<日期>`，例如 `Skill-Reviewer-junk-rate-2026-06-11`
   - **Labels**：加上目標 label（如 `skill-reviewer`, `tracking`）
   - **Body** 包含：
     - 背景（為何需要追蹤）
     - 觀察期（開始 / 結束日期）
     - 目標指標（具體數值，如 junk rate ≤30%）
     - Day-by-day checkpoint 清單（每個 checkpoint 的具體 commands）
     - Closing criteria（成功 / 失敗的判斷標準）
     - Rollback plan（若干預後出現 regression 如何 revert）

6. **驗證 issue 完整性**
   ```bash
   gh issue view <number>
   ```
   確認：lines ≥80、sections 完整、無截斷內容

7. **回覆用戶**
   告知 issue 編號、URL、與現有 issue 的區別（如有更新舊 issue）

## Pitfalls

- **跳過 Step 2 直接創建**：未搜尋導致重複 issue，浪費追蹤資源。必須先完整列出再決策
- **搜尋關鍵詞太寬**：搜「bug」會找到 50 個無關 issue → 用 label + 標題關鍵詞組合精確定位
- **現有 issue 已 closed 但相關**：有時需 reopen 或新建一個 continuation issue，而非直接復用舊的
- **issue body 太簡短**：少於 80 行、缺少 checkpoint 清單 → 日後無法執行觀察，淪為空殼
- **創建 mode 誤判**：用 `git add` 新檔案時顯示 "create mode 100644"，不代表真的是全新檔案（可能是未被追蹤的舊檔），驗證 commit diff 確認內容正確性

## Cross-references

- `error-auto-issue` — 自動版本：每日掃描 errors.json 自動創建 issue，適用於無需人工觸發的監控
- `skill-reviewer-self-improvement-analysis` — 使用相同流程追蹤 skill-reviewer junk rate 改善成效
- `cron-health-triage` — cron 監控場景如已有相關 triage issue，應先查閱再決定是否新建

## Background

用戶（Josh）多次明確要求：「先檢查下有冇相關issue係觀察緊呢樣嘢，冇就新增一個詳細issue」。背後原因是：
- 同一個監控目標若有多個 open issues，追蹤碎片化，沒人知道哪個是最新的
- 詳細 issue 需要包含 checkpoint 清單、closing criteria、rollback plan，否則日後無法執行
- 重複創建浪費精力，且容易遺漏 cross-reference 導致修復工作各自為政

此 workflow 適用於：系統監控指標追蹤、bug fix 成效觀察、migration 進度追蹤、skill library 健康度監控等任何需要長期觀察的主題。
