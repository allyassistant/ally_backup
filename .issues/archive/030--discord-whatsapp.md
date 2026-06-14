---
id: "030"
title: "每日總結發送錯誤 - 應去 Discord 但去了 WhatsApp"
status: "completed"
priority: "P1"
created: "2026-03-08"
due: "2026-03-12"
---

# Issue 030: 每日總結發送錯誤 - 應去 Discord 但去了 WhatsApp

## 狀態
- **Priority**: P1
- **Created**: 2026-03-08
- **Due**: 2026-03-12
- **Status**: 觀察中

## 問題描述
每日總結 (Daily Summary) cron job 應發送到 Discord #📕日記，但實際發送到了 WhatsApp。

## 發現時間
- 2026-03-08 23:59 發送錯誤
- 連續 2 次發送到 WhatsApp (號碼 +852XXXXXX)
- Discord channel ID (`1473383064565710929`, `1473386222998130860`) 被誤當 WhatsApp 號碼

## 歷史參考：2月17日類似事件

### 事件概覽 (2026-02-17)
- **問題**: Token Monitor Alert 送去未知 WhatsApp 號碼 (+852XXXXXX, +852XXXXXX)
- **設定**: 全部只設定 +852XXXXXX，但實際送去其他號碼
- **調查**: 檢查所有 scripts、cron jobs、environment variables 都搵唔到源頭
- **發現**: Qwen3 cron job "Token Monitor" 喺 00:00 執行，時間吻合
- **狀態**: 之後冇再發生，原因未完全確定

### 最終推測 (2026-02-17 討論結果)
**可能係 MiniMax 直接調用 `message` tool 導致**

當時情況：
- Token 用量接近爆滿 (83%)
- MiniMax 負責生成 Token Monitor 內容
- **推測**: MiniMax 可能因為 token 壓力，錯誤地直接調用 `message` 功能
- 並且自己「創作」咗 WhatsApp 號碼 send 出去

**關鍵證據**:
- 所有 script/cron 設定都只係 +852XXXXXX
- 但實際送去 +852XXXXXX / +852XXXXXX (呢啲號碼完全冇出現過喺任何設定)
- 唯一解釋係 AI agent 自己決定咗號碼

### 與今次事件既相似之處
1. **發送渠道錯誤** - 設定 A，實際去 B
2. **OpenClaw Gateway 層問題** - 唔係 script 層面問題
3. **AI Agent 執行相關** - 都涉及 cron job 觸發 AI agent
4. **MiniMax 參與** - 兩次事件 MiniMax 都有份生成內容

## 初步分析

### 直接原因
1. Cron job `946df6df-b256-4359-a0a2-52d703df02a4` 使用 `channel: "last"`
2. Discord 發送失敗 (`cron announce delivery failed`)
3. OpenClaw fallback 機制錯誤將 Discord channel ID 當做 WhatsApp 號碼發送

### 涉及系統
- Cron job: "Daily Summary to #📕日記" (ID: 946df6df-b256-4359-a0a2-52d703df02a4)
- 目標 Channel: **#📕日記** (ID: `1473386222998130860`)
- OpenClaw Gateway fallback 機制
- WhatsApp provider

## 已採取措施
- ✅ 已修改 cron job delivery 設定：
  - `channel`: `"last"` → `"discord"`
  - `to`: 明確指定 `1473386222998130860` (**#📕日記**)
  - 新增明確指令要求發送到 Discord #📕日記

## 關鍵發現：MiniMax 再次涉及！

### 當前 Cron Job 配置 (Issue #030)
- **Job**: Daily Summary to #📕日記
- **Model**: **未指定** → 使用 **MiniMax-M2.5** (default)
- **情況**: 同 2月17日 Token Monitor 事件 **一模一樣**！

### 2月17日 vs 今次對比

| 項目 | 2月17日 | 3月8日 (今次) |
|------|---------|---------------|
| **使用 Model** | MiniMax | **MiniMax** |
| **問題** | 送去錯誤 WhatsApp 號碼 | 送去 WhatsApp (應去 Discord) |
| **現象** | 自己「創作」號碼 | Discord ID 變 WhatsApp 號碼 |
| **共同點** | **都係 MiniMax 生成內容** | **都係 MiniMax 生成內容** |

### 推測：MiniMax 直接調用 message tool
當 MiniMax 被觸發執行任務時：
1. 可能因為某種壓力/錯誤理解
2. **直接調用 `message` tool** (繞過 cron delivery 設定)
3. 自己決定發送目標 (錯誤號碼 / 錯誤渠道)

### 可能解決方案
1. **改用 Qwen3** - 本地模型，較穩定
2. **改用 `delivery.mode: "none"`** - 禁止 AI agent 發送
3. **Script 層面直接發送** - 唔經 AI agent

### 建議立即行動
✅ **已執行**: 將 Daily Summary cron job 改為使用 **Qwen3.5:9b**，避免 MiniMax 再次「自作主張」。

## 觀察計劃
- **觀察時間**: 2026-03-09 至 2026-03-12
- **檢查點**:
  - [ ] 今晚 23:59 是否正確發送到 Discord **#📕日記**
  - [ ] 會否再次 fallback 到 WhatsApp
  - [ ] Discord #📕日記 是否收到每日總結

## 後續行動

### 如果成功 (發到 Discord)
- 關閉此 Issue
- 記錄解決方案

### 如果失敗 (仍去 WhatsApp)
- 考慮改為 `delivery.mode: "none"`
- 或由 script 直接發送 (不經 announce)
- 報告 OpenClaw Gateway fallback bug

## 相關檔案
- `/Users/ally/.openclaw/workspace/scripts/daily_summary.js`
- Cron job ID: `946df6df-b256-4359-a0a2-52d703df02a4`
- Log: `~/.openclaw/logs/gateway.log`

## 備註
此問題可能影響其他使用 `announce` mode 的 cron jobs，需密切監察。
