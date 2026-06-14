---
id: 073
title: 觀察 Failover Detector 整合後的穩定性
status: archive
priority: P2
created: 2026-03-29
due: 2026-04-05
updated: 2026-04-02
progress: 0/1
---

## Description

觀察 Failover Detector 整合優化後的穩定性

### 已修復問題 (2026-03-29)
1. ✅ ServerAliveInterval=30 防止 45 分鐘 TCP timeout
2. ✅ 整合 SSH + Failover 通知為一個（避免雙重通知）
3. ✅ 統一狀態判斷邏輯
4. ✅ LAST_HB_FILE 追蹤最後已知 HB timestamp
5. ✅ 清理 orphaned state files

### 觀察重點
- [ ] SSH 仲會唔會規律性斷線？（ServerAliveInterval 修復後）
- [ ] 通知係咪穩定？（冇雙重通知）
- [ ] Combined status 判斷係咪正確？
- [ ] LAST_HB 顯示係咪準確？

### 通知格式（整合後）
- **Failover**: 單一通知，顯示 SSH + HB 狀態
- **Recovery**: 單一通知，顯示恢復時間

## Notes
- 2026-03-29: 完成整合優化
