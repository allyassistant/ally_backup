---
name: skills-audit-workflow
description: "Full operational cycle for skill-reviewer agent: reading queue, interpreting signals, applying decision tree, dispatching batch sub-agents, verifying state, cleaning memory. Use when: skill-reviewer cron triggers, new bugs found in skill pipeline, full audit cycle needed. Key capabilities: queue reading with decision tree logic, parallel M3 sub-agent dispatch, state verification and cleanup."
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T02:07:00.000Z
---

## Workflow

> 適用於：Skill Reviewer (skill_reviewer_bot.js) 定期審計、新 bug 發現後的完整修復循環

### Phase 1 — Audit Scope Definition

1. 讀取 `.skill_review_queue.jsonl` 確認 queue 狀態
2. 讀取 `skills-learned/` 目錄，確認現有 skill 數量及狀態
3. 檢查 `skills/` (system skills) 是否已覆蓋相同領域，避免重複

### Phase 2 — 多軌並行 M3 審計

4. **Spawn 兩個平行 M3 sub-agent** 做分頭審計：
   - **M3-1**: 審計 `skill_reviewer_bot.js` + `skill_reviewer.js` 原始碼，列出所有潛在 bug（分 P0/P1/P2/P3）
   - **M3-2**: 審計 `skills-learned/` 所有生成 skills，檢查新 skills 質素（描述長度、pitfalls 數量、frontmatter 完整性）
5. 等待兩個 M3 完成 (`sessions_yield`)
6. 合併兩個審計報告，識別重疊及新發現

### Phase 3 — 優先級排序

7. 對 bug 按以下準則分級：
   - **P0**: 數據完整性問題（symlink 缺失、cleanup 失敗）或影響安全/隱私
   - **P1**: 可靠性問題（retry 缺失、error handling 不當）
   - **P2**: 邏輯問題（regex 不完整、邊界條件漏掉）
   - **P3**: 描述質量、archive 需求

### Phase 4 — 修復派發（M3 子代理執行）

8. 根據 bug 優先級，spawn 對應的 M3 sub-agent 執行修復
9. **每個修復完成後，主代理必須獨立驗證**（見 Phase 5）

### Phase 5 — 獨立驗證（關鍵步驟）

> ⚠️ M3 sub-agent 的修復可能存在 false positive。必須獨立 spot-check 才能確認修復有效。

10. **Regex/數值型 bug**：寫獨立驗證 script，窮舉所有 skill 樣本，對比 old vs new 行為
    - 例如 B1 pitfalls regex：對全部 28 個 skill 跑 old regex vs new regex，列出 mismatch 項目
    - 如果 mismatch > 0，修復未完成，需要回 Phase 4
11. **檔案操作型 bug**：驗證 script + 語法檢查 (`node --check`)
12. **Symlink 型 bug**：列出現有 symlinks，確認數量匹配 active skills
13. **Archive 型**：確認 skill 移入 `_archive/` 且無殘留引用

### Phase 6 — 完整 Re-audit

14. 完成所有 P0+P1 修復後，spawn M3 重新審計一次（確認修復無引入新 bug）
15. Re-audit 結果如發現新問題，追加到 Phase 3，重新執行修復循環

### Phase 7 — 清理及記憶

16. 更新 `memory/` 中當日工作記錄
17. 如發現系統性改进点，更新 `skills-audit-workflow` 本身（PATCH）

---

## Pitfalls

### ⚠️ M3 Fix False Positive（最常見問題）
M3 sub-agent 報告已修復後，結果可能是 partial fix 或 regression。必須自己跑驗證 script 確認，不能只靠 M3 声称的"verified"。常見模式：regex 替換看似正確但仍有邊界 case 漏掉（見 B1 案例）。

### ⚠️ Pitfalls Regex 多格式陷阱
Pitfalls 有兩種格式：`- **bold**` 和 `- ⚠️ **bold**`。正則表達式必須同時接受兩種。初期修復只處理 `- **` 格式，導致 4 個 skill 的 pitfalls 被計為 0。驗證方法：對全部 skill 跑 old vs new regex，比對每個 skill 的 count。

### ⚠️ B5 Cleanup Race Condition
`cleanup = true` 如果在 `writeSkillFiles()` 內部拋異常時設置，則 finally block 內的 cleanup 不會執行，導致 queue entry 永久殘留。正確做法：`cleanup = true` 必須在 `writeSkillFiles()` 調用之前就設置。

### ⚠️ B10 Retro-symlink 問題
Bot 從某個時間點才開始創建 `_learned_` symlink，但此前生成的 skills 全部 invisible to main agent。發現方法：比對 `ls skills/_learned_*` 數量 vs `ls skills-learned/` active skills 數量。任何差距都需要一次性 retro-symlink。

### ⚠️ B3 Retry 鏈不完整
Retry 只處理 429 rate limit，但不處理 5xx 服務端錯誤、ETIMEDOUT、ECONNRESET、ENOTFOUND、EAI_AGAIN。這些在網絡波動時會直接 fail 而不是 fallback。必須在 retry condition 加入所有這些錯誤碼。

### ⚠️ 重複同樣 Prompt 即信號
用戶連續多次輸入完全相同的 "Spawn M3 檢查 X" prompt = 需要建立 skill 的信號。不可忽視這個模式，每次都手動執行只是臨時 solution。

---

## Edge Cases

### Regex Backtracking
`(?:-|⚠️|⚠)` 這類 alternation 在某些 regex engine 中會因 backtracking 失敗。改用 character class 或 line-anchored 模式更穩健：`^- (?:⚠️?\s*)?\*\*`

### 多層 M3 嵌套驗證
當 M3-1 的修復由 M3-2 重新審計時發現不完整，進入第三輪修復 = 正常現象，不代表失敗。這個循環可能需要 2-3 次才能穩定。

### Archive 操作的副作用
Archive skill 時要同步清理 `_learned_` symlink，並確認 archive 後 active skills count 與 symlinks count 仍然一致。
