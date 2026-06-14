---
name: openclaw-compaction-investigation
description: 診斷 OpenClaw compaction 行為，包括 NO_REPLY→👍 自動轉換、threshold 計算、memory flush 觸發時機，以及 session handover 異常回覆
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-09T15:32:56.557Z
---

## Workflow

1. **確認是否 compaction 事件**
   - 查找 `🧹 Compacting context...` → `✅ Compacted X→Y tokens` injection sequence
   - 或查找 `✅ Compacted` 無 injection 前綴 = OpenClaw systemEvent compaction
   - 對比 timestamp 確認係預期觸發還是非預期 early compaction

2. **分析 trigger 原因**
   - `preflightCompaction()` 觸發條件：
     - Token count threshold: `contextWindow - 20K reserve - 4K buffer`
     - 或 transcript bytes > 2MB
   - 讀取 `~/.openclaw/workspace/memory/memory.json` 確認 flush 後 token count
   - 檢查 cron job 是否在 memory flush 期間觸發（會干擾 bootstrap 順序）

3. **檢查 Memory Flush 行為**
   - Flush prompt 指示：「If nothing to store, reply with NO_REPLY」
   - 預期輸出：`NO_REPLY` 或 memory content + `## 唔使再做` section
   - ⚠️ 如果 LLM 輸出 `👍` 而非 `NO_REPLY`：這是 OpenClaw 的自動轉換行為，非 bug

4. **驗證 NO_REPLY → 👍 轉換鏈**
   - 當 LLM 返回 `NO_REPLY`（無 memory content）時：
   - OpenClaw 自動插入 👍 emoji 回覆，模擬 user 確認
   - 這保証 session 有回覆，避免 agentTurn session 陷入空回覆迴圈
   - Source: `agent-runner.runtime-CCReftdY.js` 內的 compact response sanitization

5. **追蹤 Bootstrap Rehydration**
   - Compaction 後下一個 session 會執行 `cross_session_bootstrap.js`
   - 讀取 `~/.openclaw/workspace/memory/day-YYYY-MM-DD.log` 確認 memory flush 已寫入
   - Bootstrap 順序：SOUL.md → AGENTS.md → Memory → Session History → Prompt
   - Trust Labels 層級：Trust→Calibrated→Provisional→Minimal

6. **識別原生 vs 自家添加**
   - 🟢 **原生**：Trigger、compact:before hook、compaction-notifier injection、memory-flush prompt、NO_REPLY 轉換、Bootstrap runtime
   - 🟡 **混合**：Memory flush（原生 logic + 自家 AGENTS.md prompt 格式）、Bootstrap trigger（原生 + 自家 handoff format）
   - 🔵 **自家**：AGENTS.md §🧠 Compaction Contract（5 sections）、cross_session_bootstrap.js（自定義 bootstrap script）、Rehydration checklist

7. **確認 Handoff Format 完整性**
   - 預期 section：`## 上一個 Session 狀態`、`## 進行中嘅工作`、`## 環境狀態`、`## 唔使再做`
   - 如果 Rehydration Step 6 缺少 Do-Not-Redo section，bootstrap 會無法完成確認
   - 修復：手動加入 `## 唔使再做` section 到 handoff format

8. **驗證 Compaction 結果**
   - 檢查新 session 的 token count 是否降至 target threshold 以下
   - 確認 day log 有正確寫入
   - 如有異常，回溯 step 1-7 檢查哪個環節失敗

---

## Pitfalls

- **Truncated output from rate limit**：當 LLM response 被 rate limit 截斷時，skill draft 會斷尾（以冒號結束）。修復：清理 broken draft，手動刪除 `skills-learned/openclaw-compaction-investigation/` 目錄
- **👍 而非 NO_REPLY 的困惑**：用戶可能認為 👍 是 LLM 的正常回覆。實際是 OpenClaw 的自動轉換行為，無需修復
- **Early compaction during memory flush**：如果 cron job 在 memory flush 期間觸發，會干擾 bootstrap 順序。檢查 cron schedule 是否與 memory flush 重疊
- **Hybrid component 識別錯誤**：cross_session_bootstrap.js 看似自家 script，但 bootstrap trigger logic 是原生 OpenClaw。勿誤判為純自家組件
- **Session handover 回覆異常**：如果 compaction 後下一個 session 沒有正確 rehydrate，檢查 day log 是否存在、bootstrap script 是否正常執行

---

## Native vs Custom Distribution（2026-06-09 findings）

| Step | Component | Origin |
|------|-----------|--------|
| 1 | Trigger (preflightCompaction) | 🟢 原生 |
| 2 | compact:before hook | 🟢 原生 |
| 3 | compaction-notifier injection | 🟢 原生 |
| 4 | Memory flush logic | 🟢 原生 |
| 4 | Flush prompt format | 🔵 自家 (AGENTS.md) |
| 5 | Bootstrap trigger | 🟡 混合 |
| 5 | Bootstrap script (cross_session_bootstrap.js) | 🔵 自家 |
| 5 | Handoff format (5 sections) | 🔵 自家 (AGENTS.md §🧠) |
| 5 | Trust Labels (Trust/Calibrated/Provisional/Minimal) | 🔵 自家 (AGENTS.md) |
| 6 | Rehydration checklist | 🔵 自家 (AGENTS.md §⑤) |
| 7 | NO_REPLY → 👍 auto-conversion | 🟢 原生 |

**分佈總結**：原生 5項、混合 1項、自家 5項。自家添加集中在 AGENTS.md §🧠 Compaction Contract（定義 handoff format、trust labels、rehydration checklist）和 cross_session_bootstrap.js（bootstrap execution）。
