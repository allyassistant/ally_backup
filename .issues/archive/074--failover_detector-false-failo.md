---
id: 074
title: 觀察：舊版 failover_detector 是否有 false failover
status: archive
priority: P2
created: 2026-03-29
due: 2026-04-05
updated: 2026-04-02
progress: 0/2
---

## Description

觀察用舊版 failover_detector.sh 後，會否再出現 false failover 通知

### 背景
- 2026-03-29 14:09 出現 false failover（SSH transient failure 導致）
- 已還原舊版 (/Desktop/failover_detector.sh)
- 設定：failover 每 1 分鐘檢測

### 觀察重點
- [ ] 是否有 false failover 通知
- [ ] 通知頻率是否正常

### 現時狀態
- Heartbeat: 每 1 分鐘寫入 ✅
- Failover: 每 1 分鐘檢測 ✅
- 現時 Log: 所有檢測顯示 "unchanged (online)"

## Progress
- [ ] 觀察 24 小時內是否有 false failover
- [ ] 觀察 7 日內是否有規律性問題

## Notes
- 2026-03-29: 還原舊版，切換每分鐘檢測
