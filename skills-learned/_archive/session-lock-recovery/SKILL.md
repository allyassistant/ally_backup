---
name: session-lock-recovery
description: 診斷並修復 OpenClaw gateway session lock timeout 問題 — 識別長期持有 lock 嘅 gateway PID、定位 session、清除 lock file、驗證恢復
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-08T15:03:05.100Z
---

## Workflow

1. **解析錯誤訊息** — 從 error log 提取：
   - `pid=<N>` — lock holder PID
   - `ageMs=<N>` — lock 持有時間（毫秒）
   - `timeout=<N>ms` — timeout 閾值
   - `session file locked` 之後的路徑 → session ID

2. **驗證 PID 狀態** — 確認 lock holder process 是否仍存活：
