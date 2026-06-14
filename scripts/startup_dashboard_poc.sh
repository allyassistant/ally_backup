#!/bin/bash
# startup_dashboard_poc.sh — 試下 pull 晒啲 source 出到咩 card
# Usage: bash scripts/startup_dashboard_poc.sh

WORKSPACE="$HOME/.openclaw/workspace"
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
CYAN='\033[36m'
MAGENTA='\033[35m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║        STARTUP DASHBOARD PoC        ║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════╝${RESET}"
echo ""

# ── 1. System Status ──
echo -e "${BOLD}━━━ System Status ━━━${RESET}"

# HA pair
echo -ne "Ally:   "; cat "$WORKSPACE/ha-state/ally/heartbeat.json" 2>/dev/null | grep -o '"status":"[^"]*"' | tr -d '"' || echo "❌ no heartbeat"
echo -ne "Bliss:  "; cat "$WORKSPACE/ha-state/bliss/heartbeat.json" 2>/dev/null | grep -o '"status":"[^"]*"' | tr -d '"' || echo "❌ offline"
echo -ne "Uptime: "; uptime | sed 's/.*up //' | sed 's/,.*//' 2>/dev/null
echo -ne "Disk:   "; df -h / 2>/dev/null | tail -1 | awk '{print $3"/"$2" used ("$5")"}'
echo ""

# ── 2. Active Alerts ──
echo -e "${BOLD}━━━ Active Alerts ━━━${RESET}"
if [[ -f "$WORKSPACE/.proactive_alerts.json" ]]; then
  node -e "
    const a = require('$WORKSPACE/.proactive_alerts.json');
    a.alerts.forEach(x => {
      const sev = x.severity === 'critical' ? '🔴' : x.severity === 'warning' ? '🟡' : '🔵';
      console.log('  ' + sev + ' ' + x.message);
    });
    if (a.alerts.length === 0) console.log('  ✅ 無');
  " 2>/dev/null || echo "  ⚠️  parse error"
else
  echo "  ✅ 無"
fi
echo ""

# ── 3. Active Issues ──
echo -e "${BOLD}━━━ Active Issues ━━━${RESET}"
ISSUES=("$WORKSPACE/.issues/active/"*)
if ls "$WORKSPACE/.issues/active/"*.md 1>/dev/null 2>&1; then
  for f in "$WORKSPACE/.issues/active/"*.md; do
    name=$(basename "$f" .md)
    # 試拎 priority
    prio=$(grep -i "^priority" "$f" 2>/dev/null | head -1 | sed 's/.*: *//I')
    due=$(grep -i "^due" "$f" 2>/dev/null | head -1 | sed 's/.*: *//I')
    echo "  · $name"
    [[ -n "$prio" ]] && echo "    ⚑ $prio"
    [[ -n "$due" ]] && echo "    📅 $due"
  done
else
  echo "  ✅ 無 active issues"
fi
echo ""

# ── 4. Unfinished Business (CHANGELOG last 5) ──
echo -e "${BOLD}━━━ Recent Changes (last 5) ━━━${RESET}"
if [[ -f "$WORKSPACE/_code_changelog.md" ]]; then
  grep "^- " "$WORKSPACE/_code_changelog.md" | tail -5 | while read line; do
    echo "  $line"
  done
else
  echo "  ℹ️  _code_changelog.md 未建立"
fi
echo ""

# ── 5. Cross-Session Context (top items) ──
echo -e "${BOLD}━━━ Cross-Session Context ━━━${RESET}"
if [[ -f "$WORKSPACE/.cross_session_context.md" ]]; then
  # 拎 pending items / follow-ups
  grep -i "pending\|follow.up\|unfinished\|未完成\|未回覆\|waiting" "$WORKSPACE/.cross_session_context.md" | head -5 | while read line; do
    echo "  · $line"
  done 2>/dev/null || echo "  ✅ 無 pending items"
else
  echo "  ℹ️  無 cross-session context"
fi
echo ""

echo -e "${DIM}${CYAN}━━━━━ PoC End ━━━━━${RESET}"
echo ""
