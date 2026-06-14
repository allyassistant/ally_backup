# 🧠 Unified AI Audit Engine - Architecture V2

*Design Document for OpenClaw Native Implementation*
*Version: 1.0 | Date: 2026-04-06*

---

## 📋 Executive Summary

### Problem Statement
Current system has:
1. **Multiple overlapping systems** — pure_ai_audit + auto_fix + code_quality_manager
2. **High false positive rate** — Local scanner rules too broad, no AI verification
3. **No self-learning** — Same false positives repeat forever
4. **Fragmented workflow** — scan → verify → fix requires multiple runs

### Proposed Solution
**Unified AI Audit Engine** — Single pipeline that:
1. Uses Local Scanner for fast broad discovery
2. Uses AI (Kimi) for intelligent verification
3. Stores learned patterns to avoid repeat false positives
4. Auto-fixes high-confidence issues, escalates low-confidence ones

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    🧠 Unified AI Audit Engine                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  PHASE 1: DISCOVER (Fast, Broad)                               │   │
│  │  LocalScanner + PatternMatcher                                  │   │
│  │  • Fast file scanning (<5 seconds)                               │   │
│  │  • Generates candidate issues (high recall)                      │   │
│  │  • Output: candidates.json                                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  PHASE 2: VERIFY (AI First Pass)                                │   │
│  │  Kimi Sub-Agent (Batch Verification)                             │   │
│  │  • Single API call for ALL candidates                             │   │
│  │  • Returns: { verified: true/false, confidence: 0-100, reason } │   │
│  │  • Token efficient (batch instead of per-issue)                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  PHASE 3: LEARN (Pattern Knowledge Base)                        │   │
│  │  Memory + Pattern Store                                          │   │
│  │  • Records false_positive patterns (learn)                        │   │
│  │  • Records true_positive patterns (reinforce)                     │   │
│  │  • Auto-updates scanner rules (self-improvement)                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  PHASE 4: FIX (Auto-Repair)                                     │   │
│  │  Kimi Code CLI (Conditional)                                     │   │
│  │  • confidence >= 90%: Auto-fix                                   │   │
│  │  • confidence 70-90%: Request human approval                      │   │
│  │  • confidence < 70%: Skip + log to pattern store                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔑 Core Design Principles (OpenClaw Native)

### 1. Token Efficiency — Batch Everything
**Problem:** Per-issue AI calls are expensive and slow
**Solution:** Batch ALL candidates into single verification call

```javascript
// ❌ Before: Per-issue calls (expensive)
for (const issue of candidates) {
  await ai.verify(issue); // 100 issues = 100 API calls
}

// ✅ After: Single batch call (efficient)
const batchResult = await ai.verifyBatch(candidates);
// 100 issues = 1 API call (~80% cost reduction)
```

### 2. Self-Learning — Never Same Mistake Twice
**Problem:** Same false positives repeat forever
**Solution:** Pattern Knowledge Base with feedback loop

```javascript
// After each fix, record feedback
{
  "pattern": "const { execSync } = require(...)",
  "type": "false_positive",
  "rule": "execSync_missing_trycatch",
  "count": 27,
  "learned": "2026-04-06",
  "auto_skip": true  // Next scan will skip this pattern
}
```

### 3. Confidence Scoring — Risk-Adjusted Reporting
**Problem:** All issues treated equally, no sense of certainty
**Solution:** Confidence-based triage

| Confidence | Action | Human Notification |
|------------|--------|-------------------|
| >= 90% | Auto-fix | No |
| 70-90% | Auto-fix + notify | Yes (summary) |
| 50-70% | Flag for review | Yes (detailed) |
| < 50% | Skip + learn | No |

### 4. Single Pipeline — No Fragmentation
**Problem:** scan → verify → fix requires separate runs
**Solution:** One command, one workflow

```bash
# Before: Multiple steps
node pure_ai_audit.js && node auto_fix.js && node system_check_bot.js

# After: Single pipeline
node unified_audit.js audit --fix  # scan + verify + fix in one go
```

---

## 📁 Data Flow

### Phase 1: DISCOVER
```
scripts/*.js
      ↓ [File Discovery]
.candidates.json          ← Raw scanner output
{
  "candidates": [
    { "file": "x.js", "line": 10, "rule": "execSync_missing_trycatch" },
    { "file": "y.js", "line": 20, "rule": "magic_numbers" }
  ],
  "total": 47,
  "scanTime": "2026-04-06T10:00:00Z"
}
```

### Phase 2: VERIFY
```
.candidates.json
      ↓ [Kimi Batch Verification]
.verified.json            ← AI-filtered output
{
  "verified": [
    { "file": "x.js", "line": 10, "rule": "...", "confidence": 95 },
    { "file": "z.js", "line": 30, "rule": "...", "confidence": 85 }
  ],
  "rejected": [
    { "file": "y.js", "line": 20, "rule": "magic_numbers", "reason": "style_only" }
  ],
  "totalVerified": 2,
  "totalRejected": 45,
  "verifyTime": "2026-04-06T10:01:00Z"
}
```

### Phase 3: LEARN
```
.patterns.json             ← Self-improving knowledge base
{
  "false_positives": [
    { "pattern": "const { execSync } = require", "count": 27, "auto_skip": true },
    { "pattern": "```...execSync...", "count": 13, "auto_skip": true }
  ],
  "true_positives": [
    { "pattern": "execSync(path, args)", "count": 5, "auto_fix": true }
  ]
}
```

### Phase 4: FIX
```
.verified.json
      ↓ [Confidence Filter]
.auto_fix/                 ← Kimi Code CLI output
.fix_results.json           ← What was fixed
{
  "fixed": 2,
  "skipped": 0,
  "failed": 0,
  "details": [...]
}
```

---

## 🔧 Implementation Phases

### Phase A: Unified Scanner (Foundation)
**Goal:** Consolidate LocalScanner + pure_ai_audit into single module
**Files:**
- `lib/unified_scanner.js` — New unified scanning engine
- `lib/pattern_knowledge.js` — Pattern learning base

**Key Features:**
- Output format: `.state/audit/candidates.json`
- Pattern matching with auto-skip for known false positives
- Incremental scanning (only changed files)

### Phase B: AI Verification Layer
**Goal:** Add intelligent filtering before fixing
**Files:**
- `lib/ai_verifier.js` — Batch verification logic
- Integration with existing Kimi/MiniMax sub-agents

**Key Features:**
- Single batch API call for all candidates
- Confidence scoring per issue
- False positive learning

### Phase C: Auto-Fix Integration
**Goal:** Connect verified issues to Kimi Code CLI
**Files:**
- `lib/auto_repair.js` — Fix orchestration
- Update `system_check_bot.js` to read from new pipeline

**Key Features:**
- Conditional auto-fix based on confidence
- Human approval for uncertain issues
- Fix verification (did it actually work?)

### Phase D: Self-Learning Loop
**Goal:** Continuous improvement from fix outcomes
**Files:**
- `lib/feedback_learner.js` — Learning from results
- Update `pattern_knowledge.js` with new rules

**Key Features:**
- Record fix success/failure
- Update scanner rules automatically
- Weekly pattern review

---

## 📊 OpenClaw Integration Points

### Existing Systems to Replace/Upgrade
| Old System | New System | Notes |
|-----------|-----------|-------|
| pure_ai_audit.js | Phase A+B | Becomes `lib/ai_verifier.js` |
| auto_fix.js | Phase C | Becomes `lib/auto_repair.js` |
| audit_scanner.js | Phase A | Merged into `lib/unified_scanner.js` |
| system_check_bot.js | Read-only | Continues to display, reads new format |

### Cron Jobs
```javascript
// Daily: Full audit + fix (post-fix notification)
0 22 * * * node scripts/unified_audit.js audit --fix --post-only

// Weekly: Pattern review + rule update
0 3 * * 0 node scripts/unified_audit.js learn --prune
```

### Memory Integration
```javascript
// After each fix, update memory
{
  "date": "2026-04-06",
  "fixed_count": 5,
  "false_positives_learned": 27,
  "pattern_updates": [...]
}
```

---

## 🎯 Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| False Positive Rate | ~95% (409 magic_numbers) | < 10% |
| Human Intervention | Multiple per day | 1 per week |
| Fix Success Rate | Unknown | > 90% |
| Time to Fix | Hours (multiple runs) | Minutes (single pipeline) |

---

## ⚠️ Known Challenges

### 1. AI Verification Cost
- Batch verification still uses tokens
- Solution: Aggressive pattern learning reduces AI calls over time

### 2. Confidence Calibration
- Need to tune Kimi prompt for accurate confidence
- Solution: Start conservative (higher threshold), tune based on feedback

### 3. Code Complexity Detection
- Simple regex can't understand code semantics
- Solution: Use code context (function boundaries, imports) for smarter matching

---

## 🚀 Next Steps

1. **Phase A (Week 1):** Implement `lib/unified_scanner.js`
   - Merge LocalScanner + pure_ai_audit logic
   - Output `.state/audit/candidates.json`

2. **Phase B (Week 2):** Add AI Verification
   - Create `lib/ai_verifier.js`
   - Integrate with Kimi for batch verification

3. **Phase C (Week 3):** Auto-Fix Integration
   - Connect verified issues to Kimi Code CLI
   - Update system_check_bot.js

4. **Phase D (Week 4):** Self-Learning Loop
   - Implement feedback learning
   - Pattern auto-update

---

*Document Status: Draft v1.0*
*Author: Ally (Mac A)*
*Review: Pending Josh approval*
