---
id: 108
title: Bliss 分擔 Cron Jobs 方案
status: archive
priority: P2
created: 2026-05-07
due: 
updated: 2026-05-23
progress: 0/0
---

# #108 — Bliss 分擔 Cron Jobs 方案

## 目的
將部分 cron jobs 由 Ally 搬去 Bliss 行，善用閒置資源，提升 HA 系統嘅承載能力。

## 背景
- Ally (Mac mini): 主力對話，17 個 cron jobs，Disk 109GB free
- Bliss (MacBook Neo): 待機狀態，Disk 442GB free，OpenClaw 2026.5.6，只有 heartbeat/failover/weather/apple refurb

## 關鍵發現

### 需要 sync 先搬得
大部分 cron jobs 讀寫 `workspace/memory/` 或 `workspace/scripts/` 或 `workspace/.state/` 檔案。
如果直接喺 Bliss run，佢只會有 06:00 backup 嘅舊版本 data。

| Job | 需要嘅 Data | 問題 |
|-----|-----------|------|
| L0/L1 Generator (00:05/00:35) | 今日 memory files | 06:00 backup 冇今日 files |
| Daily Summary (23:59) | 今日 memory files | 同上 |
| CQM Scan (10:00/15:00/22:00) | scripts/ + .state/ | 06:00-10:00 改動唔喺 Bliss |
| Wiki Bridge/Compile/Lint/Ingest | wiki/ directory | 可 sync 但需 reverse rsync |
| Daily Maintenance (05:00) | memory/ + .state/ | 同上 |

### 唔使 sync 就搬得嘅
| Job | 狀態 |
|-----|------|
| Daily Weather (09:30) | ✅ 已經喺 Bliss |
| Apple Refurbished (每30min) | ✅ 已經喺 Bliss |
| 純 Discord API call | 冇依賴 workspace files |

## 方案比較

### 方案 A：每日 backup 加密啲（推薦起步）
將 06:00 一次嘅 backup，加密到**每 6 小時一次**（06:00 / 12:00 / 18:00 / 00:00）

| Pro | Con |
|-----|-----|
| 簡單，改 crontab 就得 | 最多 6 小時 lag |
| 唔影響而家既 workflow | 唔適合 real-time 任務 |

### 方案 B：Pre-run sync（精準但複雜）
每個搬去 Bliss 既 job 前 5 分鐘 rsync 需要既 folder

| Pro | Con |
|-----|-----|
| 最新 data | 要逐個 job 改 crontab |
| 唔洗額外 backup bandwidth | 每個 job 多加一個 dependency |

### 方案 C：分階段遷移

**Phase 1（而家）：** Daily backup ✅（已 set）
**Phase 2（下一步）：** Backup 加密率 + 搬 CQM Scan / 其他獨立任務
**Phase 3（之後）：** Reverse sync（Bliss → Ally）+ 搬 L0/L1/Wiki

## 技術分析

### 要搬走既 Job 清單

| Job | Time | Sync 需要 | 複雜度 |
|-----|------|----------|--------|
| CQM Scan | 10/15/22:00 | scripts/ + .state/ | 低 |
| Daily Summary | 23:59 | memory/（今日 files） | 中 |
| L0 Generator | 00:05 | memory/（昨日 files） | 中 |
| L1 Generator | 00:35 | memory/（昨日 files） | 中 |
| Wiki Pipeline | 00:40-01:00 | wiki/ directory | 中高 |
| Daily Maintenance | 05:00 | memory/ + .state/ | 中 |
| Weekly Parallel | Mon/Sun 10:00 | scripts/ + .issues/ | 中 |
| Weekly Correction | Sun 11:00 | AGENTS.md + memory/ | 高 |

### Reverse Sync（Bliss → Ally）
如果 Bliss 寫咗結果（如 L0/L1 .md files、.state/results），需要 sync 返去 Ally 先得。
可以簡單用 `rsync -avz bliss@IP:/path/ ~/path/` 喺每朝 backup cron 前 run。

## 待決定事項

- [ ] **選方案 A、B 定 C？**
- [ ] **第一個搬邊個 job？** CQM Scan（最簡單）定 Daily Summary（最有價值）？
- [ ] **要唔要 reverse sync？** 還是俾兩邊各自 maintain 各自既 copy？
- [ ] **Sync 頻率？** 6 小時、3 小時、定 pre-run 先 sync？

## Links
- HEARTBEAT.md — 所有 cron jobs 總覽
- `scripts/backup_to_bliss.sh` — 現有 backup script
- `ha-state/` — HA 狀態檔案
