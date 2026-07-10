---
id: 179
title: M3 advisory 51.85% m3-error failure rate - root cause investigation
status: archive
priority: P1
created: 2026-06-24
due: 2026-06-27
updated: 2026-06-24
progress: 0/0
---

## F - Facts（事實）

### 現況
- M3 advisory overlay (`scripts/skill_m3_advisory.js`) 啟用咗之後, 51.85% 嘅 M3 call 都 fail (alignment=`m3-error`)
- 對 heuristic 完全冇影響 (fail-soft design), 但 advisory signal 完全不可信
- Issue 由 2026-06-18 開始累積 (cursor 推到 2026-06-24 13:30 HKT), 135 entries total

### 數據/證據 (from `.skill_m3_advisory.jsonl`)
| 項目 | 值 |
|------|-----|
| Total entries | 135 |
| `m3-error` (verdict=error) | 70 (51.85%) |
| `m3Verdict: pass` | 50 |
| `m3Verdict: junk` | 12 |
| `m3Verdict: null` (dry-run) | 3 |
| `m3-timeout` (alignment) | 1 |
| Alignment `m3-error` | 69 |
| Alignment `disagree` | 33 |
| Alignment `cycle-m3` | 19 |
| Alignment `agree` | 10 |
| Alignment `dry-run` | 3 |

### Latency 分析 (70 個 m3-error)
| Bucket | Count | 推論 |
|--------|-------|------|
| < 100ms | 69 | **快速 fail** (唔係 timeout, 唔係慢 model) |
| 100-500ms | 0 | — |
| 500ms-5s | 0 | — |
| 5-15s | 0 | — |
| > 15s (timeout) | 1 (6/19) | Edge case |

**Critical:** 99% 嘅 error 都係 < 100ms latency. Median = 45ms. 呢個 latency 對 M3 來講唔可能 (正常 call 5-9s, 見 50 個 success records). 結論: M3 call 喺第一個 TCP/auth/response 階段已經 fail, 完全冇到 model inference.

### 候選 Root Cause
1. **`empty output`** — M3 caller return empty stdout → `callM3Judge` line 250
2. **`JSON parse failed`** — M3 返 non-JSON content (e.g. error page)
3. **`unknown` verdict** — M3 返 verdict 唔喺 {'pass', 'junk'} → line 253 maps to 'error'
4. **Connection / auth fail** — 連 M3 portal 嘅請求直接 fail

**Before 補 logging, 我哋唔知邊個係真兇.** Immediate fix done (呢個 issue 嘅 trigger).

## D - Decisions（決定）

### ✅ 已做決定
- 2026-06-24: Patch `scripts/skill_m3_advisory.js` line 588-590 — 補 `m3Error` field 入 record
  - Minimal change: 1 conditional add, 唔改 alignment logic, 唔改 heuristic verdict
  - Backward compatible: success records 唔加 field (shape stable, additive)
  - 驗證: `node --check` ✅, simulated record shape ✅
- 2026-06-24: 開呢個 P1 issue 跟進 root cause (closed by Phase 1B 收集 data)

### ⏳ 待做決定
- 2026-06-27: 觀察 ≥24h 新 `m3Error` data → category errors → confirm dominant root cause
- 2026-06-27: 決定 M3 advisory 嘅 continue/disable
  - **Option A:** Fix root cause (e.g. retry, change prompt, switch model)
  - **Option B:** Disable M3 advisory (heuristic only)
  - **Option C:** Increase timeout (only if timeout confirmed, not applicable now)

## Q - Questions（未解決）

### ❓ 核心問題
1. 點解 M3 call 喺 < 100ms fail? 係 caller 嘅 bug, model endpoint 嘅 auth, 定係 M3 provider rate limit?
2. `empty output` vs `JSON parse failed` vs `unknown` — 邊個佔多數?
3. M3 advisory 喺呢個 fail rate 下仲有冇保留嘅 value? (heuristic 同 M3 agree rate 都低)

### 🔍 追問（蘇格拉底反詰）
- 點解 51% fail 仲 keep M3 advisory? (因為 fail-soft, 唔會 break heuristic, 監察緊)
- 點解 latency 一直 < 100ms? (Caller 早期 return, 唔到 model)
- 如果 disable M3 advisory, 7-day rolling alignment 監察仲做唔做? (應該做, 失敗率本身係 signal)
- `unknown` verdict 點解唔 map to 'error' 而唔係 'unparseable'? (歷史 code 決定, 唔改)
- 5-9s 嘅 success latency 顯示 M3 係 work 嘅, 咁點解 51% 會 fail? (可能 caller 隨機 fail, 或特定 skill trigger 特定 error)

## Progress
- [x] 2026-06-24: Patch `skill_m3_advisory.js` 加 `m3Error` field
- [x] 2026-06-24: 開 P1 issue #179
- [ ] 2026-06-25: 觀察新 advisory entries, category `m3Error` values
- [ ] 2026-06-26: 寫 summary report (dominant error category, fix decision)
- [ ] 2026-06-27: 執行 chosen fix (A/B/C)

## Notes

### Cross-references
- **Parent:** #170 (M3 Advisory W2 Warning Mode) — alignment 監察本身 work, 但 fail rate 高
- **Sibling:** #171 (Recalibrate junk rate) — heuristic 嗰邊要做 calibration
- **Source data:** `.skill_m3_advisory.jsonl` (135 entries, 24KB)
- **Patch file:** `scripts/skill_m3_advisory.js` line 588-590

### Rollback plan
- `git checkout HEAD -- scripts/skill_m3_advisory.js` 1 分鐘
- 加 `m3Error` field 純 additive, rollback 唔會 break 現有 data 解析 (新 field 會被 ignore)

### Metrics sources
- Latency distribution: `cat .skill_m3_advisory.jsonl | python3 -c "..."`
- Error rate trend: `grep '"alignment":"m3-error"' .skill_m3_advisory.jsonl | wc -l`
- Per-skill error map: `cat .skill_m3_advisory.jsonl | python3 -c "import json,sys; from collections import Counter; c=Counter(); [c.update([json.loads(l).get('skill')]) for l in sys.stdin if json.loads(l).get('alignment')=='m3-error']; print(c.most_common(10))"`
