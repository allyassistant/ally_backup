# Issue #121 — Weekly Correction Loop: 由被動通知變主動修復

## 背景

`weekly_correction_loop.js`（Sunday 11:00）產出 `correction_suggestions.json`，然後被 `cross_session_bootstrap.js` 讀取並注入 `.cross_session_context.md`，session start 時顯示：

```
🟡 18 次手動 override — classifier 可能需要調整
```

但呢條 stat 唔 actionable — 我睇到但唔會採取任何行動，zero behavior change。

## 而家嘅 chain

```
weekly_correction_loop.js (Sunday 11:00)
    ↓ 產出薄 stat
correction_suggestions.json [「18 次 manual override」]
    ↓ cross_session_bootstrap.js 被動 inject
.cross_session_context.md → session start → 我睇到 → 「哦」
```

## 問題

1. Source data 太薄 — 得一條 stat，冇 actionable plan
2. 冇跨 session 追蹤 — 唔知邊條 suggestion 跟進咗
3. 冇 auto-remediation — 淨係 notify 唔 spawn fix
4. 同 `.cross_session_context.md` inject 機制綁死，但 correction loop 係 weekly task 唔係 session start task

## 建議方向

- `weekly_correction_loop.js` 產出更完整嘅 suggestion（附 actionable fix）
- 加 threshold trigger：override > N → auto spawn correction agent
- 跨 session 追蹤 suggestion 狀態（pending / resolved / dismissed）
- Correction suggestions 可以直接寫入 context 而唔經 cross_session_bootstrap.js

## Priority

P3 — 今日其他改動優先（Stop and Ask, Enforcement Chain, MEMORY.md cleanup, verify_edit, spawn parallel logic）

## 相關檔案

- `scripts/weekly_correction_loop.js`
- `memory/correction_suggestions.json`
- `scripts/cross_session_bootstrap.js`（correction reading part）
- `.cross_session_context.md`

Created: 2026-05-31
