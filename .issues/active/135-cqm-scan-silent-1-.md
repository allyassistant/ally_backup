---
id: 135
title: CQM scan 預設 silent — 觀察 1 週跟進
status: active
priority: P2
created: 2026-06-07
due: 2026-06-14
updated: 2026-06-07
progress: 0/4
---

## Description

### Context

2026-06-07 凌晨 01:00-01:30 HKT，#⚙️系統 短時間內出現 4 個 `🔧 系統檢查 - 2026-06-07 HH:MM` 推送，疑似 spam。經調查：

**真正 root cause：**
- 唔係 cron 自動跑，係 sub-agents 嘅 verification 步驟
- 我（Ally）喺 ca58858f session（昨晚 9:12 開始跑 16 個鐘嘅 Hermes skill architecture 嗰個）嗰陣，spawn 咗 3 個 Phase sub-agents，仲有之後嘅 Audit sub-agents
- 每個 sub-agent 嘅 verification step 跑 `node code_quality_manager.js scan --quiet`，觸發 CQM 內建嘅 system_check_bot 通知
- 4 個 sub-agents 各自 verify 一次 → 4 個 system check message spam

**先前嘅 cron schedule 改動（2026-06-07 00:50 嗰陣）已解決 cron 自動觸發問題：**
- `wakeMode: next-heartbeat` → `now`
- 加 `tz: Asia/Hong_Kong`
- 改 schedule 為 `0 10 * * *`（一日 1 次）

### 詳細分析

| Trigger | 而家 | 改動前 |
|---------|------|--------|
| Sub-agent 跑 `scan --quiet` 驗證 | ❌ send Discord（**4 個 spam**）| send Discord |
| Cron job 跑 `scan --no-system-check` | silent | silent |
| Cron job 跑 `fix` 結束 | ✅ send 1 個 | ✅ send 1 個 |
| User 跑 `scan` 想睇 Discord 通知 | silent（要 `--notify`）| send |

### CQM Call Graph
- 全 workspace 只有 `code_quality_manager.js` 透過 `execFileSync` 執行 `system_check_bot.js`（line 931）
- 冇任何其他 script、cron job、plugin 直接 call
- 寫 flag file (`system_check_called.json`) 嘅亦都係 CQM 唯一一個
- 即係：改 CQM 嘅 call gate ＝ 完全控制 `system_check_bot` 嘅觸發

### 改動（2 處 surgical fix）

**File：** `~/.openclaw/workspace/scripts/code_quality_manager.js`

**1. 加入 `--notify` flag (line 545-546)**
```javascript
{ flag: '--notify', desc: 'Send system check Discord notification after scan (opt-in, default off)' }
```

**2. scan 預設 silent (line 696-700)**
```javascript
// 2026-06-07: 預設 silent 避免 sub-agents 跑 scan 嗰陣 spam Discord;
// 要 notification 嘅 caller 必須 explicit 帶 --notify
if (parsed.options.notify && !parsed.options['no-system-check']) {
  await this.runSystemCheckBot(parsed.options.quiet);
}
```

### CQM cron job 唔受影響 evidence

Cron job 已經 explicit 帶 `--no-system-check` + 靠 `fix` 最後通知：
- `scan --no-system-check` → silent（保持）
- `fix` 內 re-scan → 已帶 `no-system-check: true`（保持）
- `fix` 最後 system_check_bot → send 1 個（保持）

Cron job 行為 100% 唔變，每次 run 仲係得 1 個 system check 通知。

### Verify

- `node --check code_quality_manager.js` → ✅ pass (no syntax error)
- `verify_edit.js` → 5 個 magic number warnings（全部 PRE-EXISTING timeout 常數，唔係今次改動引入）

## 觀察項目

1. **2026-06-07 ~ 2026-06-14 期間：**
   - 監察 #⚙️系統 有冇再出現 `🔧 系統檢查` spam
   - 預期：10:00 HKT 每日 1 次（CQM cron 正常推送）+ 任何 explicit `scan --notify` 才額外推送
   - 如有非預期推送 → 追查 root cause（可能係 race condition 嘅 `runSystemCheckBot` 60s flag file 機制喺 concurrent execution 下失效）

2. **Race condition 風險：**
   - 而家 `runSystemCheckBot` 嘅 flag file 60s dedup check 唔係 atomic
   - 多個 sub-agent 跑可能 race（但今次 fix 後，scan 已經唔再 call，根本唔會觸發 race）
   - 屬另一個獨立 ticket 範圍

3. **如果有需要：**
   - 將 `fix` 嘅 final notification 都加 `--notify` 預設 off 嘅選項（granular control）
   - 但目前無 evidence 要做

## Progress

- [x] 1. Root cause 分析（sub-agents CQM verify → system_check_bot spam）
- [x] 2. Apply 2 行 surgical fix (CQM scan 預設 silent + 加 `--notify` flag)
- [x] 3. Verify syntax + 不影響 cron job flow
- [ ] 4. 觀察 1 週（2026-06-07 ~ 2026-06-14）確認冇再 spam

## 2026-06-07 討論記錄

- fix 已 apply：2 行 code（--notify flag + scan 預設 silent）
- verify_edit.js pass（5 個 magic number warnings 係 pre-existing，唔關今次改動）
- node --check pass
- Josh 睇咗表示 OK（冇要求改動）
- HEARTBEAT changelog section 已刪
- HEARTBEAT 概覽數字 fix (15→16) + status 統一 (已修復→OK, Created→OK)
- 等 2026-06-14 返嚟檢查 #⚙️系統 有冇再出現 system check spam

## Notes

- 後續觀察重點：監察 #⚙️系統 嘅 🔧 系統檢查 message count
- 如果發現 race condition 重現，獨立 ticket 修 `runSystemCheckBot` flag file 機制
- 2026-06-14 跟進時可決定：(a) 關 issue 完成 ✓ / (b) 加新 fix 處理 race / (c) 發現新 issue 開 follow-up

## Related

- 2026-06-07 同日有：HEARTBEAT.md 更新（CQM schedule 改一日 1 次，wakeMode 改 now，加 tz）
- 之前分析 session：ca58858f (昨晚 9:12 開始 16 個鐘 Hermes skill architecture 嗰個)
