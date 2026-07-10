---
name: loop-engineering-implementation
description: 分析同實作 Loop Engineering patterns 嘅 workflow — Karpathy/Boris/Reddit loop taxonomies、三階段遷移、系統審計
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-11T12:01:06.312Z
---

## Workflow

1. **Scope Phase 1 範圍** — 識別最高 ROI 嘅實作目標：
   - 1.1 Termination Manifest（每個 cron 嘅完成標準 + 質量閾值）
   - 1.2 Token Budget（每個 LLM cron 嘅 input/output/total 上限）
   - 1.3 Observability（日誌 + 每日 report 接入現有 anomaly 系統）

2. **Spawn M3 做 Deep Analysis** — 當 user 明確要求深入研究（"詳細/深入/仔細" 或直接指定 M3），用 `SPAWN_QUALITY` route：
