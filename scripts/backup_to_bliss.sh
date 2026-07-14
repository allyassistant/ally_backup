#!/bin/bash
# ============================================
# Ally → Bliss Daily Backup
# Rsync workspace + config to Bliss (MacBook)
# Run daily via cron
# ============================================

set -euo pipefail

# Cron runs without full PATH — ensure /sbin (where md5 lives) is included.
# macOS ships md5 at /sbin/md5; without this, xargs md5 -r fails with
# "md5: command not found" (fix 2026-06-05).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/sbin:/usr/sbin:${PATH:-}"

# Config
BLISS_USER="bliss"
BACKUP_BASE="/Users/bliss/Backups/Ally"
DATE_TAG=$(date -u +%Y%m%d)
WORKSPACE="$HOME/.openclaw/workspace"
SSH_KEY="$HOME/.ssh/id_ed25519"

# Resolve Bliss IP from ha_config.json if available
BLISS_IP="[TAILSCALE_BLISS_IP]"
if [ -f "$HOME/.openclaw/workspace/ha-state/ha_config.json" ]; then
    RESOLVED=$(python3 -c "import json; d=json.load(open('$HOME/.openclaw/workspace/ha-state/ha_config.json')); print(d.get('bliss_ip',''))" 2>/dev/null)
    if [ -n "$RESOLVED" ]; then
        BLISS_IP="$RESOLVED"
    fi
fi
SSH_TARGET="${BLISS_USER}@${BLISS_IP}"

# Track start time for duration reporting
START_TIME=$(date +%s)

# Ensure remote backup dir exists
ssh -i "$SSH_KEY" -o ConnectTimeout=120 -o ServerAliveInterval=60 -o ServerAliveCountMax=5 "$SSH_TARGET" "mkdir -p \"${BACKUP_BASE}/daily/${DATE_TAG}\" \"${BACKUP_BASE}/latest\"" 2>/dev/null

echo "📦 Ally → Bliss Backup - $(date)"
echo "═══════════════════════════════════"

# ── 1. Workspace backup (exclude heavy/unnecessary dirs) ──
echo ""
echo "📁 Backing up workspace..."
rsync -avz --delete --timeout=300 \
  --link-dest="${BACKUP_BASE}/latest" \
  -e "ssh -i \"$SSH_KEY\" -o ConnectTimeout=120 -o ServerAliveInterval=60 -o ServerAliveCountMax=5" \
  "$WORKSPACE/" \
  --exclude="node_modules/" \
  --exclude="_legacy/" \
  --exclude="gia_batch/" \
  --exclude="gia-batch2/" \
  --exclude="gia_temp/" \
  --exclude="output/" \
  --exclude="rapaport-calculator/" \
  --exclude="mission-control-html/" \
  --exclude="dn_memo_app/" \
  --exclude=".git/" \
  --exclude="_state/" \
  "${SSH_TARGET}:${BACKUP_BASE}/daily/${DATE_TAG}/workspace/"

# Verify: compute local md5 checksum of workspace, compare remote.
# Use absolute paths (/sbin/md5) — cron PATH may not include /sbin.
LOCAL_MD5=$(find "$WORKSPACE" -type f \( -path "*/node_modules/*" -o -path "*/.git/*" \) -prune -o -type f -print 2>/dev/null | sort | xargs -r /sbin/md5 -r | /sbin/md5 -r)
REMOTE_MD5=$(ssh -i "$SSH_KEY" -o ConnectTimeout=120 "${SSH_TARGET}" "find \"${BACKUP_BASE}/daily/${DATE_TAG}/workspace\" -type f -print 2>/dev/null | sort | xargs -r /sbin/md5 -r | /sbin/md5 -r")
if [ "$LOCAL_MD5" = "$REMOTE_MD5" ]; then
  echo "   ✅ Workspace backed up (checksum verified)"
else
  echo "   ❌ Workspace checksum mismatch — backup may be corrupted"
  exit 1
fi

# ── 2. Config files backup (openclaw.json, etc.) ──
echo ""
echo "📁 Backing up config..."
rsync -avz \
  -e "ssh -i \"$SSH_KEY\" -o ConnectTimeout=120 -o ServerAliveInterval=60 -o ServerAliveCountMax=5" \
  "$HOME/.openclaw/openclaw.json" \
  "${SSH_TARGET}:${BACKUP_BASE}/daily/${DATE_TAG}/config/"
echo "   ✅ Config backed up"

# ── 3. Update latest symlink ──
echo ""
echo "🔗 Updating latest symlink..."
ssh -i "$SSH_KEY" -o ConnectTimeout=120 -o ServerAliveInterval=60 -o ServerAliveCountMax=5 "$SSH_TARGET" \
  "rm -f \"${BACKUP_BASE}/latest\" && ln -s \"${BACKUP_BASE}/daily/${DATE_TAG}\" \"${BACKUP_BASE}/latest\""
echo "   ✅ latest → ${DATE_TAG}"

# ── 4. Cleanup: keep last 14 daily backups ──
echo ""
echo "🧹 Cleaning old backups (keep 14 days)..."
REMOVED_COUNT=$(ssh -i "$SSH_KEY" -o ConnectTimeout=120 -o ServerAliveInterval=60 -o ServerAliveCountMax=5 "$SSH_TARGET" \
  "ls -dt \"${BACKUP_BASE}/daily/\"*/ | tail -n +15 | wc -l | tr -d ' '" 2>/dev/null)
ssh -i "$SSH_KEY" -o ConnectTimeout=120 -o ServerAliveInterval=60 -o ServerAliveCountMax=5 "$SSH_TARGET" \
  "ls -dt \"${BACKUP_BASE}/daily/\"*/ | tail -n +15 | xargs -r rm -rf" 2>/dev/null || true
TOTAL_BACKUPS=$(ssh -i "$SSH_KEY" -o ConnectTimeout=120 "$SSH_TARGET" "ls -dt \"${BACKUP_BASE}/daily/\"*/ | wc -l | tr -d ' '" 2>/dev/null)
echo "   ✅ Removed $REMOVED_COUNT of $TOTAL_BACKUPS old backups (kept 14 days)"

# ── 5. Summary ──
END_TIME=$(date +%s)
ELAPSED_SEC=$((END_TIME - START_TIME))
ELAPSED_FMT=""
if [ "$ELAPSED_SEC" -ge 3600 ]; then
  HRS=$((ELAPSED_SEC / 3600))
  MINS=$(((ELAPSED_SEC % 3600) / 60))
  SECS=$((ELAPSED_SEC % 60))
  ELAPSED_FMT="${HRS}h ${MINS}m ${SECS}s"
elif [ "$ELAPSED_SEC" -ge 60 ]; then
  MINS=$((ELAPSED_SEC / 60))
  SECS=$((ELAPSED_SEC % 60))
  ELAPSED_FMT="${MINS}m ${SECS}s"
else
  ELAPSED_FMT="${ELAPSED_SEC}s"
fi

echo ""
echo "═══════════════════════════════════"
echo "✅ Backup complete!"
echo "   Target: ${BLISS_IP}:${BACKUP_BASE}/daily/${DATE_TAG}"
echo "   Date:   ${DATE_TAG}"
echo "   Size:   $(du -sh "$WORKSPACE" 2>/dev/null | awk '{print $1}') workspace + config"
echo "   Duration: $ELAPSED_FMT"
echo "═══════════════════════════════════"
