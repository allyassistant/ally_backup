---
name: loop-engineering-phase1-2026-06-11
description: Phase 1 實作藍圖 — Termination Manifest quality criteria + Token Budget spec + Observability plan
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-11T12:01:06.312Z
---

# Loop Engineering Phase 1 — 實作藍圖
**Author:** M3 sub-agent (SPAWN_QUALITY) + M2.7 parent session
**Date:** 2026-06-11
**Scope:** 1.1 Termination Manifest + 1.2 Token Budget + 1.3 Observability

---

## 1.1 Termination Manifest — 質量標準定義

### D1：點為之行完（完成信號）

3 個必須同時滿足的信號：
1. **File Exists** — cron 預期 output 嘅 file/artifact 存在
2. **Size > 0** — file唔係空嘅
3. **Log Pattern Matches** — cron log 入面有預期嘅成功 pattern

### D2：點為之達到質量標準（6 項 quality checks）

| Check | Trigger Condition | Action on Fail |
|-------|------------------|----------------|
| Length Check | output length < min_chars | retry 或 degrade |
| Structure Check | output 缺少預期 sections（e.g. `# Summary`） | retry 或 skip |
| Judge Check | LLM judge prompt 判定 quality < threshold | retry 或 flag |
| Sanity Check | output 包含已知 junk patterns（"12345", "HEARTBEAT_OK" 等） | discard + retry |
| Cross-Ref Check | output 內容與 input/context 矛盾 | flag + alert |
| Idempotency Check | 連續兩次 output 完全相同 | flag + skip |

### D3：失敗點 handle（4-tier quality system）

| Tier | Condition | Action |
|------|-----------|--------|
| T1: SUCCESS | D1 ✓ + D2 all pass | 正常完成 |
| T2: PARTIAL | D1 ✓ + D2 有1-2項 fail | retry 1次，仍fail則log warning |
| T3: DEGRADED | D1 ✓ + D2 超過2項 fail | alert Discord，紀錄但不block |
| T4: FAILED | D1 失敗（file missing/empty） | kill cron，alert critical，考慮 auto-degrade |

### 4-tier recovery system

| Tier | Recovery Action |
|------|----------------|
| R1: Self-heal | retry 同 args |
| R2: Rollback | restore 上次成功 state |
| R3: Degrade | fallback to simpler model / skip step |
| R4: Kill | terminate + alert |

---

## 1.2 Token Budget — 每個 LLM cron 嘅上限

### 5 個 LLM crons（需要 token budget）：

| Cron | Frequency | 建議 Budget（per run） | Warning Threshold |
|------|-----------|------------------------|-----------------|
| Skill Reviewer | 48x/day | input: 20K, output: 15K, total: 35K | >25K total |
| KB Ingest | 6x/day | input: 15K, output: 10K, total: 25K | >20K total |
| L0 (systemEvent) | ~20x/day | input: 5K, output: 3K, total: 8K | >6K total |
| L1 (cron-health-triage) | 24x/day | input: 10K, output: 5K, total: 15K | >12K total |
| Daily Synthesis | 1x/day | input: 30K, output: 20K, total: 50K | >40K total |

### 21 個 non-LLM crons：
light spec（max_runtime_sec, kill_switch）唔需要 token budget。

---

## 1.3 Observability

### Token 用量 Log 格式
```json
{
  "cron_id": "skill-reviewer",
  "run_id": "2026-06-11T11-33-47",
  "model": "MiniMax-M2.7",
  "tokens": { "input": 18420, "output": 8340, "total": 26760 },
  "duration_ms": 12400,
  "status": "success",
  "quality_tier": "T1"
}
```

### Daily Report Pipeline
- 每小時：cron-health-triage 寫 summary to memory/errors.json
- 每日 22:00：error-auto-issue 掃描並建 P1 issues
- 每日：daily-synthesis 合成 learnings + Discord #📚推播

---

## Implementation Priority

1. **Immediate（1-2 weeks）**: 將 token_budget + termination_manifest 寫入每個 LLM cron 嘅 config
2. **Short-term（1 month）**: Observability log pipeline + Discord alert hook
3. **Medium-term（Phase 2）**: 自動 token budget adjustment（根據 rolling average）
