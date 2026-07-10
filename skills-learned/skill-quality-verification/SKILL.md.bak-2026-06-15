---
name: skill-quality-verification
description: Workflow for building and tuning composite skill-quality heuristics that catch stubs without killing useful thin skills.
status: active
source: skill-reviewer
provenance: agent
generatedAt: 2026-06-08T11:33:31.494Z
---

## Workflow

1. **Identify false positives** — Run existing validator against known-good thin skills. Flag any that fail validation but are genuinely useful.

2. **Audit the failing skills** — For each false-positive, measure: file size (B), body word count, workflow step count, step density (words/step). Look for distinguishing patterns that separate stubs from useful thin skills.

3. **Design composite signals** — Replace single-threshold checks with 2–3 independent signals. Example signals:
   - File size < N bytes
   - Body word count < N words
   - Workflow steps < N steps
   - Step ends mid-sentence (colon truncation)
   - Step bullet density < N words/step

4. **Set AND/OR logic** — Choose how signals combine:
   - All-of-N: all signals must trigger (strict, more false-positive risk)
   - At-least-N-of-M: ≥2 of 3 triggers (balanced)

5. **Test against corpus** — Run prototype against:
   - Known good thin skills (should pass)
   - Known stubs (should fail)
   - All active skills (should have high pass rate, e.g., 23/24)

6. **Iterate and validate** — Adjust thresholds based on corpus results. Re-run until no good skills are killed and all synthetic stubs are caught.

7. **Implement in code** — Replace single-threshold logic with composite check. Maintain backward compatibility flags.

## Pitfalls

- **Single-threshold tunnel vision**: `<200 words` looks simple but kills useful 63-word workflows. Always composite.
- **Ignoring truncation signals**: Skills ending mid-step ("Script 結構：") are real bugs, not thin content. Catch via regex: step text ends with `：` or `:` without continuation.
- **No corpus validation**: Always test against both positive (good) and negative (stub) samples before shipping.
- **Over-tuning**: A heuristic that passes 26/26 skills is suspicious — it may be too lenient. Aim for 23–25/24 + catch all synthetic stubs.

## Reference: Composite Heuristic Template
