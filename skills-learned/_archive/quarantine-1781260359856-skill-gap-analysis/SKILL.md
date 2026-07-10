---
name: skill-gap-analysis
description: 系統性分析 skills-learned/ library，識別覆蓋缺口並生成優先級建議
status: draft
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-12T10:31:11.738Z
---

## Workflow

1. **收集 library 現況**
   執行以下指令收集完整 inventory：
   ```bash
   # Active skills (symlinked)
   ls -la skills-learned/ | grep ^l | awk '{print $NF}'
   
   # All skill directories (including archived/quarantined)
   find skills-learned/ -maxdepth 1 -type d | while read d; do
     [ -f "$d/SKILL.md" ] && echo "=== $(basename $d) ===" && head -5 "$d/SKILL.md"
   done
   
   # Cron jobs count
   grep -c "type.*cron" ~/.openclaw/workspace/HEARTBEAT.md 2>/dev/null || echo "0"
   
   # Scripts count
   find ~/.openclaw/workspace/scripts/ -type f \( -name "*.js" -o -name "*.sh" \) | wc -l
   ```

2. **建立覆蓋範圍維度矩陣**
   定義要檢查的維度類別：
   - **Cron reliability** — config audit, health triage, migration, troubleshooting
   - **Skill self-curation** — automation analysis, curation patterns, validation, gap analysis
   - **Sub-agent orchestration** — spawning, result retrieval, reliability, side-effect containment
   - **System maintenance** — heartbeat, proactive alerts, error auto-issue
   - **External integration** — article analysis, email processing, cross-machine deployment
   - **Quality assurance** — code review, QA verification, loop engineering

3. **逐一維度評估狀態**
   對每個類別評估：
   - ✅ Full coverage — 主要 scenario 有對應 skill
   - 🟡 Partial — 有 cover 但缺 edge case 或步驟不完整
   - ❌ Gap — 該類別完全冇 skill
   - 🔵 Quarantined — 有 skill 但被隔離（分析原因）

4. **識別 Function-level 缺口**
   在已有覆蓋的類別中，檢查是否缺少明顯功能：
   - 同一 cluster 內有冇 missing function？
   - 現有 skills 之間有冇重複/可以合併？
   - 有冇 one-time incident skills 應該 archive？

5. **計算 Gap Severity Score**
   每個缺口評分：
   ```javascript
   // 頻率分 (1-3)
   frequency = recurring ? 3 : occasional ? 2 : 1
   
   // 複雜度分 (1-3)
   complexity = multi_component ? 3 : single_step ? 1 : 2
   
   // 影響分 (1-3)
   impact = system_critical ? 3 : workflow_slowdown ? 2 : minor ? 1
   
   severityScore = frequency * complexity * impact
   ```

6. **生成 Gap Analysis Report**
   寫入報告到 `~/.openclaw/workspace/.spawn/reports/skill_library_gap_analysis_<date>.md`：
   ```markdown
   # Skill Library Gap Analysis
   
   ## Inventory Summary
   - Total skills: X active + Y archived + Z quarantined
   
   ## Coverage Matrix
   | Category | Status | Count | Severity |
   
   ## Function Gaps
   ### Missing Functions in Existing Categories
   ### Redundant/Archived Candidates
   
   ## Prioritized Suggestions
   1. [HIGH] <skill-name>: <description> — estimated effort
   2. [MED] <skill-name>: <description>
   ```

7. **更新 HEARTBEAT.md 的 Skills Learned 表**
   在 HEARTBEAT.md 添加/更新 gap analysis entry：
