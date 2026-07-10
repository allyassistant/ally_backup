#!/usr/bin/env bash
# fix-digest.sh — Weekly digest of self-healing-loop activity
#
# Reads ~/.openclaw/workspace/.self_healing_loop.jsonl (NDJSON), filters
# events in a date window, and emits a Markdown digest to
# ~/.openclaw/workspace/.fix_summaries/digest-<YYYY-MM-DD>.md
#
# Usage:
#   bash scripts/fix-digest.sh                       # past 7 days, print + write file
#   bash scripts/fix-digest.sh --since 2026-06-13T00:00:00Z
#   bash scripts/fix-digest.sh --discord             # also push to #⚙️系統 channel
#   bash scripts/fix-digest.sh --json                # emit JSON summary instead of MD
#
# Requires: jq 1.6+, bash 4+

set -uo pipefail
# Note: deliberately NOT using `set -e`. Sandbox shell (`darwin` restricted)
# has weird interactions between `set -e` and `pipefail` on empty-result
# `find | wc -l` pipelines (silently exits after assignment). Errors are
# handled explicitly at each pipeline via `|| echo "0"` or fallback logic.

TELEMETRY="${HOME}/.openclaw/workspace/.self_healing_loop.jsonl"
SNAPSHOT_DIR="${HOME}/.openclaw/workspace/.fix_snapshots"
OUTPUT_DIR="${HOME}/.openclaw/workspace/.fix_summaries"

# Defaults: past 7 days, ending now (UTC)
SINCE_ISO=$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u --date="7 days ago" +%Y-%m-%dT%H:%M:%SZ)
UNTIL_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PUSH_DISCORD=0
OUTPUT_FORMAT="markdown"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --since)        SINCE_ISO="$2"; shift 2 ;;
    --until)        UNTIL_ISO="$2"; shift 2 ;;
    --discord)      PUSH_DISCORD=1; shift ;;
    --json)         OUTPUT_FORMAT="json"; shift ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -f "$TELEMETRY" ]]; then
  echo "Telemetry file not found: $TELEMETRY" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (brew install jq)" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
TODAY=$(date -u +%Y-%m-%d)
OUTPUT_FILE="${OUTPUT_DIR}/digest-${TODAY}.md"

# ── Aggregate stats via jq ────────────────────────────────────────────────
# Run a single jq invocation; capture to STDOUT, then `read` to destructure.
# Single-quoted jq query so bash does NOT expand $since / $until inside.
STATS=$(jq -r -s --arg since "$SINCE_ISO" --arg until "$UNTIL_ISO" '
  [.[] | select(.ts >= $since and .ts <= $until)] as $ev |
  ($ev | length) as $t |
  ([$ev[] | select(.event == "verify_fail")] | length) as $vf |
  ([$ev[] | select(.event == "fixes_applied")] | length) as $fa |
  ([$ev[] | select(.event == "skip_session_cap")] | length) as $ssc |
  ([$ev[] | select(.event == "skip_budget")] | length) as $sb |
  ([$ev[] | select(.event == "skip_skill_path")] | length) as $ssp |
  ([$ev[] | select(.event == "skip_skill_session")] | length) as $sss |
  ([$ev[] | select(.event == "verify_ok")] | length) as $vo |
  ([$ev[] | select(.event == "spawn_err")] | length) as $se |
  ([$ev[] | select(.event == "fixes_no_progress")] | length) as $fnp |
  "\($t) \($vf) \($fa) \($ssc) \($sb) \($ssp) \($sss) \($vo) \($se) \($fnp)"
' "$TELEMETRY")

read -r TOTAL VERIFY_FAIL FIXES_APPLIED SKIP_SESSION SKIP_BUDGET \
  SKILL_PATH SKILL_SESSION VERIFY_OK SPAWN_ERR FIXES_NO_PROGRESS \
  <<<"$STATS"

# Top files by verify_fail count
TOP_FILES=$(jq -r -s --arg since "$SINCE_ISO" --arg until "$UNTIL_ISO" '
  [.[] | select(.event == "verify_fail" and .ts >= $since and .ts <= $until) | .file]
  | group_by(.) | map({file: .[0], count: length})
  | sort_by(-.count) | .[0:5]
  | .[] | "  - \(.count)× `\(.file)`"
' "$TELEMETRY")

# Top rules applied
TOP_RULES=$(jq -r -s --arg since "$SINCE_ISO" --arg until "$UNTIL_ISO" '
  [.[] | select(.event == "rule_applied" and .ts >= $since and .ts <= $until) | .rule]
  | group_by(.) | map({rule: .[0], count: length})
  | sort_by(-.count) | .[0:5]
  | .[] | "  - \(.count)× `\(.rule)`"
' "$TELEMETRY")

# Top files by fixes_applied
TOP_FIXED=$(jq -r -s --arg since "$SINCE_ISO" --arg until "$UNTIL_ISO" '
  [.[] | select(.event == "fixes_applied" and .ts >= $since and .ts <= $until) | .file]
  | group_by(.) | map({file: .[0], count: length})
  | sort_by(-.count) | .[0:5]
  | .[] | "  - \(.count)× `\(.file)`"
' "$TELEMETRY")

# Snapshot inventory — direct `wc -l` (returns 0+exit 0 on empty stdin,
# which is the most stable combo in this sandbox shell).
SNAPSHOT_COUNT=$(find "$SNAPSHOT_DIR" -name "*.pre" -type f 2>/dev/null | wc -l)
# Strip leading whitespace (`wc -l` outputs "       N"); `printf "%d"` also
# normalizes empty / non-numeric to 0.
SNAPSHOT_COUNT=$(printf "%d" "$SNAPSHOT_COUNT" 2>/dev/null || echo "0")
SNAPSHOT_BYTES=$((SNAPSHOT_COUNT * 4096))  # rough size estimate (display only)

# ── Render output ──────────────────────────────────────────────────────────
if [[ "$OUTPUT_FORMAT" == "json" ]]; then
  jq -n --arg since "$SINCE_ISO" --arg until "$UNTIL_ISO" \
    --argjson total "$TOTAL" --argjson vf "$VERIFY_FAIL" \
    --argjson fa "$FIXES_APPLIED" --argjson ssc "$SKIP_SESSION" \
    --argjson sb "$SKIP_BUDGET" --argjson ssp "$SKILL_PATH" \
    --argjson sss "$SKILL_SESSION" --argjson vo "$VERIFY_OK" \
    --argjson se "$SPAWN_ERR" --argjson fnp "$FIXES_NO_PROGRESS" \
    --arg snapshots "$SNAPSHOT_COUNT" --arg snapBytes "$SNAPSHOT_BYTES" \
    '{
      period: {since: $since, until: $until},
      generated: (now | todate),
      summary: {
        total_events: $total,
        verify_fail: $vf,
        verify_ok: $vo,
        fixes_applied: $fa,
        fixes_no_progress: $fnp,
        skip_session_cap: $ssc,
        skip_budget: $sb,
        skip_skill_path: $ssp,
        skip_skill_session: $sss,
        spawn_err: $se,
        autonomy_rate_pct: (if $vf > 0 then (($fa / $vf) * 100 | round) else 0 end)
      },
      snapshots: {count: ($snapshots | tonumber), bytes: ($snapBytes | tonumber)}
    }'
  exit 0
fi

# Markdown output
{
  echo "# Self-Healing-Loop Weekly Digest"
  echo
  echo "**Period:** ${SINCE_ISO} → ${UNTIL_ISO}"
  echo "**Generated:** $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "## Summary"
  echo
  echo "| Metric | Count |"
  echo "|--------|-------|"
  echo "| Total events | ${TOTAL} |"
  echo "| \`verify_ok\` | ${VERIFY_OK} |"
  echo "| \`verify_fail\` | ${VERIFY_FAIL} |"
  echo "| \`fixes_applied\` | ${FIXES_APPLIED} |"
  echo "| \`fixes_no_progress\` | ${FIXES_NO_PROGRESS} |"
  echo "| \`skip_session_cap\` | ${SKIP_SESSION} |"
  echo "| \`skip_budget\` | ${SKIP_BUDGET} |"
  echo "| \`skip_skill_path\` | ${SKILL_PATH} |"
  echo "| \`skip_skill_session\` | ${SKILL_SESSION} |"
  echo "| \`spawn_err\` | ${SPAWN_ERR} |"

  if [[ "$VERIFY_FAIL" -gt 0 ]]; then
    AUTONOMY=$(awk "BEGIN { printf \"%.1f\", ($FIXES_APPLIED / $VERIFY_FAIL) * 100 }")
  else
    AUTONOMY="n/a"
  fi
  echo "| **Autonomy rate** | **${AUTONOMY}%** |"
  echo "| Snapshots on disk | ${SNAPSHOT_COUNT} (${SNAPSHOT_BYTES} bytes) |"
  echo
  echo "## Top files by \`verify_fail\`"
  echo
  if [[ -n "$TOP_FILES" ]]; then
    echo "$TOP_FILES"
  else
    echo "  (none — no verify_fail events in period)"
  fi
  echo
  echo "## Top files actually fixed (\`fixes_applied\`)"
  echo
  if [[ -n "$TOP_FIXED" ]]; then
    echo "$TOP_FIXED"
  else
    echo "  (none yet — see Notes below)"
  fi
  echo
  echo "## Top rules applied"
  echo
  if [[ -n "$TOP_RULES" ]]; then
    echo "$TOP_RULES"
  else
    echo "  (none yet — Alt A rules may fire without emitting \`rule_applied\` telemetry)"
  fi
  echo
  echo "## Snapshot inventory"
  echo
  echo "  - Directory: \`${SNAPSHOT_DIR}\`"
  echo "  - Files: ${SNAPSHOT_COUNT}"
  echo "  - Total size: ${SNAPSHOT_BYTES} bytes"
  if [[ "$SNAPSHOT_COUNT" -gt 100 ]]; then
    echo "  - ⚠️ High snapshot count — consider cleanup of old \`.pre\` files"
  fi
  echo
  echo "---"
  echo
  echo "**How to read this digest:**"
  echo
  echo "- \`verify_fail\` is verifier-detected issues. If 0: your edits are clean."
  echo "- \`fixes_applied\` is rule-driven successful fixes. Goal: rising."
  echo "- \`fixes_no_progress\` is rules fired but verifier still sees same errors — signal of rule/verifier mismatch."
  echo "- \`skip_session_cap\` should be low (we just raised cap 1→3)."
  echo "- \`skip_skill_path\` / \`skip_skill_session\` are Layer 2/3 gates working correctly."
  echo "- \`spawn_err\` should be 0 in current source (M3 path removed 2026-06)."
  echo
  echo "Re-run: \`bash scripts/fix-digest.sh\` · Push to Discord: add \`--discord\`"
} > "$OUTPUT_FILE"

echo "Digest written to: $OUTPUT_FILE"
echo

if [[ "$PUSH_DISCORD" == "1" ]]; then
  if command -v openclaw >/dev/null 2>&1; then
    openclaw message send --channel discord \
      --target "channel:1473376125584670872" \
      --message "$(cat "$OUTPUT_FILE")" 2>&1 | tail -3 || echo "(Discord push skipped)"
  else
    echo "(openclaw CLI not found — skipping Discord push)"
  fi
fi
