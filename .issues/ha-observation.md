# HA 架構觀察與決策事項

*記錄 HA 架構既觀察同有待決定既事項*
*建立日期：2026-03-12*

---

## 現時狀態

### 已經 set 好既嘢
- [x] Ally (Mac A) - 對話主力
- [x] Bliss (Mac B) - 後勤
- [x] Tailscale SSH 雙向連接
- [x] HA_CONFIG.md - 連線資料
- [x] iCloud 同步

### 需要觀察既事項
- [ ] 兩邊係咪正確咁知道自己既角色？
- [ ] 對方係咪能夠互相睇到對話？
- [ ] Cross-session messaging 工作正常？
- [ ] Failover 機制得唔得？

---

## 待決定事項

### 1. 真正價值係咩？
- [ ] Failover / 冗餘 - 確保對話永遠有人聽？
- [ ] 雙倍運算力？
- [ ] Remote repair 能力？

### 2. 要唔要 set 自動 sync？
- [ ] Cron job 讀取 Discord 訊息？
- [ ] Cross-session messaging？
- [ ] Shared inbox folder？

### 3. 後勤任務
- [ ] Bliss 要做 Stock / L1 / Memory compression？
- [ ] 定係 keep 以前既 sub-agents 模式？

### 4. 仲可以還原？
- [ ] Desktop/backup 有單機版本既 AGENTS.md/SOUL.md/IDENTITY.md

---

## 觀察日誌

### 2026-03-12
- 發現 Bliss 最初唔知道自己叫 Bliss (設定錯誤)
- 已修正 IDENTITY.md, AGENTS.md, SOUL.md
- Bliss 終於確認自己叫 Bliss

---

## 下一步行動

1. 觀察幾日 HA 運作
2. 測試 Failover (其中一方離線)
3. 決定真正既用途
4. 決定要唔要還原單機
