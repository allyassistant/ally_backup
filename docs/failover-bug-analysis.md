# Failover Detector — Bug Analysis

## Bug 1: Race condition on node recovery (false "peer offline")
**File:** `scripts/failover_detector.sh`

當節點恢復上線時:
1. `heartbeat.sh` 寫入 fresh heartbeat ✅
2. `failover_detector.sh` 緊接運行
3. SSH 到 peer 可能仲未得（network stack 未完全啟動）
4. CURRENT_STATUS = "offline"
5. LAST_STATUS = "online" (disk persisted from before crash)
6. ❌ **發送錯誤的「⚠️ [peer] 已離線」通知**
7. 下一分鐘：SSH 成功 → 發送「✅ [peer] 已番上線」
8. **1分鐘內發出兩個錯誤通知**

**Root cause:** 腳本唔知自己剛恢復，用「我而家可以 SSH 到 peer 嗎？」做唯一判斷，忽略咗「我啱啱先著返」呢個事實。

## Bug 2: Missing self-recovery grace period (2分鐘太短)
**File:** `scripts/failover_detector.sh`

腳本有 self-check：
```bash
if [ $MY_DIFF -gt $((OFFLINE_THRESHOLD * 60)) ]; then
    exit 0  # 自己斷線，skip
fi
```

但只係 binary check（fresh vs stale）。如果自己啱啱先著返（heartbeat 得 1-2 秒新鮮），就立即開始檢查 peer，冇任何 grace period。

**需要嘅：** 追蹤自己 heartbeat 嘅 history。如果前一次係 stale 而家係 fresh → 代表自己剛恢復 → 等 2 分鐘 grace period 先開始檢查 peer。

## Bug 3: last_status_* 跨 crash 殘留，掩蓋狀態轉變
**File:** `scripts/failover_detector.sh:32`

```bash
LAST_STATUS_FILE="$HOME/.openclaw/workspace/ha-state/last_status_${PEER_ID}"
```

當 Ally crash 後恢復：
- Local `last_status_bliss` 仲係「online」（crash 前嘅狀態）
- 但其實 Bliss 可能啱啱先 send 咗「Ally offline」通知
- Ally 恢復後檢查 Bliss：online → LAST_STATUS 都係「online」→ **冇狀態變化 → 冇通知**
- 結果：Bliss 端 send 咗「Ally offline + back online」，但 Ally 端 silence
- 雖然呢個唔直接造成假通知，但令兩邊狀態唔一致，debug 困難

**Fix:** 恢復後應 reset `last_status_*` 或加入 boot timestamp 驗證。

## Bug 4: Uni-directional network blip 導致 spam
**Scenario:** 網絡短暫單向故障（Ally→Bliss 唔通，但 Bliss→Ally 通）

- Ally failover_detector: SSH 到 Bliss 失敗 → CURRENT="offline" → send ⚠️
- Bliss failover_detector: SSH 到 Ally 成功 → CURRENT="online" → 冇通知
- 1分鐘後網絡恢復：Ally send ✅ back online
- **Bliss 成件事都冇事，但 Ally send 咗兩個假通知**

**Fix:** 加入 debounce — 唔好一次檢查到 offline 就通知。連續 2 次檢查都 offline 先 send。

## 總結

| Bug | 影響 | 修復難度 |
|-----|------|----------|
| #1 Race condition on recovery | False ⚠️通知 | 低 — grace period |
| #2 冇 self-recovery grace | 連帶 Bug #1 觸發 | 低 — 追蹤自身 heartbeat |
| #3 last_status 跨 crash 殘留 | 狀態不一致 | 低 — boot timestamp |
| #4 Uni-directional blip spam | False 通知 | 低 — debounce (2 consecutive checks) |

全部修復 < 50 lines code。
