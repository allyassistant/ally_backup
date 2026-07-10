---
name: skill-reviewer-draft-cleanup
description: 清理 Skill Reviewer 產生嘅 broken draft skill 目錄同 stale symlinks 的工作流程
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T13:31:08.513Z
---

## Workflow

1. **識別 broken draft 目錄** — 掃描 `skills-learned/` 下所有目錄，檢查：
   - `SKILL.md` 是否缺失（目錄存在但無主文件）
   - `SKILL.md` 是否包含未閉合 code block（``` 無對應結尾）
   - `SKILL.md` 是否 file size < 1500 bytes（符合品質驗證失敗條件）
   - 目錄是否存在超過 24 小時但無 symlink 指向 active skills

2. **識別 stale symlinks** — 掃描 `skills/_learned_*` 所有 symlink，檢查：
   - 目標檔案是否存在（`fs.existsSync` 或 `readlink -f`）
   - 目標目錄是否存在（`skills-learned/<name>/`)
   - 如果目標不存在，標記為 stale symlink

3. **驗證 draft 是否需要保留** — 對每個 broken draft，檢查：
   - 是否有 active symlink 指向它（如有則修復而非刪除）
   - 是否包含有價值的內容可以 rescue（如部分 workflow 步驟）
   - 如包含部分內容，extract content 到 Obsidian 再刪除目錄

4. **執行清理** — 對確認可刪除的 broken draft：
   - `rm -rf skills-learned/<name>/`
   - 同步檢查 `skills/_learned_<name>` 並刪除 stale symlink
   - 記錄清理內容到操作日誌

5. **驗證清理結果** — 確認：
   - `skills-learned/` 只剩 active 或 waitlisted 技能目錄
   - 所有 `_learned_` symlink 都指向有效目標
   - `ls -la skills/_learned_* | wc -l` 等於 `ls -d skills-learned/*/ | wc -l`
   - 清理完成後運行 `openclaw skills` 確認無錯誤

6. **預防性維護** — 設定定時檢查（如 cron job 或每 30min Skill Reviewer run 前後）：
   - 檢查 `skills-learned/` 是否有超過 1 日未清理的 broken draft
   - 檢查 symlink 一致性
   - 如發現異常，觸發自動清理或通知用戶

## 識別 broken draft 嘅信號

- **未閉合 code block**：`SKILL.md` 包含 ``` 但無對應結尾 ```` — 最常見原因係 token 用完導致截斷
- **file size 過細**：< 1500 bytes（低於品質驗證下限）
- **缺少 frontmatter**：無 `---` 包圍的元數據區塊
- **frontmatter 不完整**：缺少 `name`、`description`、`status` 等必需欄位
- **draft 無 symlink**：目錄存在超過 24小時但 `skills/` 下無對應 `_learned_` symlink

## 注意事項

- **token 用完導致截斷**：Conversation 1 顯示 MiniMax-M2.7 Token Plan Starter 3M/3M 用完會導致技能創建被截斷 — 檢查 `.openclaw/credentials` 或 `openclaw provider info` 確認 provider token plan 狀態
- **Skill Reviewer 唔會自我清理**：Skill Reviewer 只寫 file + symlink，唔會刪除自己以前產生嘅 broken draft — 需要獨立嘅 cleanup 流程
- **semlink 留係 one-way**：delete draft 目錄唔會自動刪除 symlink，要手動檢查 `skills/_learned_*`
- **rescue 優先於刪除**：如果 broken draft 包含有用嘅 workflow 步驟（即使 code block 未閉合），先 extract content 再刪除

## Pitfalls

- **不要刪除有 active symlink 的目錄**：用 `readlink skills/_learned_<name>` 驗證目標路徑再刪除
- **symlink 路徑可能指向舊版**：如果 skills-learned 目錄被重建（如 git reset），symlink 會指向不存在的 inode — 需要同時清理
- **不要假設所有目錄都是 skill**：`skills-learned/` 可能包含 `.gitkeep` 或其他非 skill 文件
- **token plan 重置時間因 provider 而異**：MiniMax 係每晚 11PM HKT，其他 provider（OpenAI、Claude）可能按訂閱週期重置
- **清理前先通知用戶**：如果目錄超過 1MB 或多於 5 個檔案，先由 sub-agent 分析內容再決定是否保留
