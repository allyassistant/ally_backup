---
name: main-session-execution-loop-recovery
description: 當主 session 無法執行用戶任務而只係不斷回 HEARTBEAT_OK 時，診斷並恢復正常執行流程。
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2025-12-05T12:00:00.000Z
---

## Workflow

1. **Detect the loop** — 連續 2+ 次收到 HEARTBEAT_OK 而冇任何實質回覆，即係進入 heartbeat loop
2. **中斷自動心跳** — 停止依賴系統自動心跳，直接輸出用戶要求嘅任務結果
3. **清理內部狀態** — 清除任何殘留嘅 execution queue 或 pending state
4. **重試用戶任務** — 用簡潔、聚焦嘅方式重新執行原本任務
5. **驗證恢復** — 確認下一個回覆包含實質內容，唔再係 HEARTBEAT_OK

## Pitfalls

- ⚠️ 唔斷重試 HEARTBEAT_OK — 如果你繼續跟隨同一個 Thought/Action 模式，你只係會重複同一個 loop，唔會有進展
- ⚠️ 假設系統正常 — HEARTBEAT_OK 係系統告訴你「我仲運作緊」，但唔代表佢喺做你想要嘅嘢
- ⚠️ 忽略用戶急切嘅需求 — 當用戶明確要求一個任務，而你只係不斷回 heartbeat，佢會覺得你冇回應
