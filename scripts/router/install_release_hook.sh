#!/bin/bash
#
# install_release_hook.sh
#
# Installs the releaseId post-commit git hook. Each commit automatically
# becomes a release event so future router decision divergence can be
# bisected via releaseId.
#
# Behavior:
#   - Copies scripts/router/hooks/post-commit → .git/hooks/post-commit
#   - Backs up any existing post-commit to .git/hooks/post-commit.ally-backup
#   - chmod +x the installed hook
#
# Idempotent: re-running on an already-installed hook is a no-op for files
# that already match. Path: scripts/router/hooks/post-commit.

set -euo pipefail

# Honor --help / help without installing.
for arg in "$@"; do
  case "$arg" in
    --help|-h|help)
      cat <<'EOF'
install_release_hook.sh

Copies scripts/router/hooks/post-commit to .git/hooks/post-commit and
chmod +x. Backs up any pre-existing post-commit to
.git/hooks/post-commit.ally-backup (only if content differs and no
backup exists yet).

USAGE:
  bash scripts/router/install_release_hook.sh
EOF
      exit 0
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SRC="$SCRIPT_DIR/hooks/post-commit"
HOOK_DST=".git/hooks/post-commit"

if [ ! -f "$HOOK_SRC" ]; then
  echo "[release_hook] source hook not found: $HOOK_SRC" >&2
  exit 1
fi

if [ -f "$HOOK_DST" ] && ! cmp -s "$HOOK_SRC" "$HOOK_DST"; then
  if [ ! -f "$HOOK_DST.ally-backup" ]; then
    echo "[release_hook] backing up existing $HOOK_DST → $HOOK_DST.ally-backup" >&2
    cp "$HOOK_DST" "$HOOK_DST.ally-backup"
  fi
fi

cp "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST"
echo "[release_hook] Installed post-commit hook → $HOOK_DST"
echo "[release_hook] Source: $HOOK_SRC"
