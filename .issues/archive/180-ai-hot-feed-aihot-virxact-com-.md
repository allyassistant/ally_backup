---
id: 180
title: AI HOT feed (aihot.virxact.com) DNS 解析到 127.0.0.1，cron 連續 fail
status: archive
priority: P2
created: 2026-07-04
due: 2026-07-11
updated: 2026-07-12
progress: 0/0
---

## F - Facts（事實）

### 現況
- `scripts/ai_hot_push.js` 每日 12:00 HKT cron job `fe0d22a3-...` push 去 Discord `#AI🔥熱門` (channel 1483099702512713829)
- 最近 2 次連續 fail (2026-07-03, 2026-07-04)
- 今日 (2026-07-04) 手動 trigger 確認仍然死：`ECONNREFUSED 127.0.0.1:443`

### 數據/證據

| 項目 | 值 |
|------|-----|
| Feed URL | `https://aihot.virxact.com/feed.xml` |
| DNS 解析 | `aihot.virxact.com` → CNAME `aihot.virxact.com.volcgslb-mlt.com` → A `127.0.0.1` |
| CDN provider | Volcengine GSLB (`volcgslb-mlt.com`) |
| Cron job ID | `fe0d22a3-1440-4054-bb56-8b3f79b5d45a` |
| 上次 success | 2026-07-02 12:00 (4 messages sent) |
| Failure history | 2026-06-21, 6-22 (getaddrinfo ENOTFOUND) → 6-22 復活 → 7-03 timeout → 7-04 ECONNREFUSED |
| 過去 30 日成功率 | ~75% (約 7/30 失敗) |

### 診斷 timeline
1. **2026-06-21 至 6-22**：`getaddrinfo ENOTFOUND aihot` (DNS 完全死)
2. **2026-06-23 至 7-02**：正常返 (約 8 日連續 success)
3. **2026-07-03**：`Request timeout (20s)` (轉差)
4. **2026-07-04**：`ECONNREFUSED 127.0.0.1:443` (完全死，DNS 指返 localhost)

## D - Decisions（決定）

### ✅ 已做決定
- **2026-07-04**：Josh 指示觀察多一排，先唔郁 cron job，睇下 Volcengine 個 GSLB 會唔會自動復活

### ⏳ 待做決定
- **2026-07-11 (到期)**：若連續 7 日死，決定點處理：
  - Option A: 繼續等 (如果係 maintainer 暫時維護)
  - Option B: Disable cron job (避免噪音)
  - Option C: 搵替代 feed (e.g. HackerNews AI、TechCrunch AI tag)
  - Option D: 聯絡 aihot.virxact.com 維護者

## Q - Questions（未解決）

### ❓ 核心問題
1. aihot.virxact.com 個 backend / GSLB 設定發生咩事？
2. 係 scheduled maintenance 還是永久死？
3. 有冇 alternative AI news feed source 可以用？

### 🔍 追問（蘇格拉底反詰）
- 點解個 GSLB 會指返 127.0.0.1？係 origin server 被刪走？還是健康檢查 fail？
- 過去 30 日成功率 75% — 呢個 reliability 對「每日精選推送」用途啱唔啱？
- 如果要搵替代，Josh 偏好咩類型？純 LLM news？定 AI + tech industry 都要？

## Progress
- [x] 2026-07-04 確認 DNS 解析問題 (dig + nslookup 證實)
- [x] 2026-07-04 手動 trigger 確認 error 仍然存在
- [x] 2026-07-04 開 issue #180 追蹤
- [ ] 2026-07-05 起每日 check DNS 解析 + cron status
- [ ] 2026-07-11 (Day 7) 評估 7 日 trend，決定 next step

### Day-by-day 觀察 checklist

| Day | Date | Check command | Expected | Actual | Status |
|-----|------|--------------|----------|--------|--------|
| 1 | 2026-07-04 | `dig +short aihot.virxact.com` | real IP (非 127.0.0.1) | 127.0.0.1 | ❌ |
| 2 | 2026-07-05 | `dig +short aihot.virxact.com` | real IP | TBD | ⏳ |
| 3 | 2026-07-06 | ... | real IP | TBD | ⏳ |
| 5 | 2026-07-08 | ... | real IP | TBD | ⏳ |
| 7 | 2026-07-10 | ... | real IP | TBD | ⏳ |

**Threshold:**
- ✅ PASS: 7 日後 service 回復正常
- 🟡 PARTIAL: 7 日內有 ≥1 日 success 但仍 fail 緊
- 🟠 NEEDS MORE: 7 日全部 fail → 啟動替代方案評估
- 🔴 REGRESSION: 復活後又死過

### Closing criteria (Day 7)
```
✅ PASS: DNS 指返真實 IP AND cron 連續 3 日 success
🟡 PARTIAL: cron 間歇性 success (>50% rate over 7 days) → 延 7 日再評估
🟠 NEEDS MORE: 7 日 0 success → 啟動 Option C (搵替代 feed)
🔴 REGRESSION: 已修復但又死 → 啟動 Option D (聯絡 maintainer 或 disable)
```

### Rollback plan
- 若 Option C 啟動：還原 `scripts/ai_hot_push.js` 用舊 feed URL 不可能 (要改 source code)
- 若 Option B 啟動：`cron update <jobId> enabled=false`
- 若 Option D 啟動：先 disable job，等 maintainer 回覆再 enable

## Notes

### 對話記錄
- **2026-07-04 13:33 HKT**: Josh 通知 "AI HOT 每日12點推送" failed 2 times，問點解
- **2026-07-04 13:33-13:34**: Ally 查 cron history + dig/nslookup 確認 DNS 問題
- **2026-07-04 13:35**: Josh 叫手動 trigger 確認，Ally 確認仍死
- **2026-07-04 13:36**: Josh 決定觀察多一排，Ally 開 issue 跟進

### Cross-references
- Cron job: `fe0d22a3-1440-4054-bb56-8b3f79b5d45a`
- Script: `scripts/ai_hot_push.js` (line 26-30: FEEDS const)
- HEARTBEAT.md line 15 (#15 AI HOT 推送)
- Discord channel: 1483099702512713829 (#AI🔥熱門)
