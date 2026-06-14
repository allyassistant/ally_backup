# 待跟進：Enhance Kimi Auto Audit

## 背景
- 2026-03-29 進行左 Ally 全面系統審計
- 兩輪 Kimi 審計完成後用黎加強 Kimi Auto Audit

## 可以加入的功能（睇審計結果再決定）
1. Scripts 語法檢查 (node --check, bash -n)
2. Cron jobs 審計 (crontab -l, 檢查 script exists)
3. Heartbeat / Failover 審計
4. Security 檢查 (hardcoded secrets, dangerous commands)
5. Integration 檢查 (cron 引用既 scripts 是否存在)
6. File permissions 檢查

## ⚠️ 已知 Intentionally Ignored 項目（請勿視為問題）

### 1. Bot Scripts 直接讀取 Discord Token
**誤解：** 以為係 security/design issue

**實際原因：**
- OpenClaw message tool 一開始有機會出錯
- 直接讀取 token + 用 curl/fetch 係 intentional workaround
- 呢個係保險機制，確保 Discord 通知能發送

**結論：** ❌唔需要修復，係 intentional workaround

### 2. NODE_ID 判斷方式不統一
**誤解：** 以為 heartbeat.sh vs failover_detector.sh 邏輯不一致係 bug

**實際原因：**
- `heartbeat.sh`: 用環境變量 `${NODE_ID:-ally}`
- `failover_detector.sh`: 用 hostname check 作為 fallback (安全網)
- 兩者都有 intention — hostname check 係 safety net

**結論：** ❌唔需要修復，係 intentional safety net design

## 待跟進
- 等 audit-ally-round1 & round2 完成
- 根據結果決定加咩進 Kimi Auto Audit
