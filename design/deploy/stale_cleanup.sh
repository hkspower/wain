#!/bin/bash
# Remove files the site no longer ships from the Hostinger web root — once,
# by name, after archiving them OUTSIDE the web root. Owner's word, 2026-10-03.
#
#   bash stale_cleanup.sh <commit-sha>
#
# Only the paths listed below are touched; everything else on the account
# (discs/, salon-queue, mcp-admin, the n8n blueprints, landing pages) is left
# exactly as it is. Logs to .deploy-log.txt from inside, like the deploy.
set -euo pipefail
SHA="${1:?usage: stale_cleanup.sh <commit-sha>}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "not a full commit sha: $SHA"; exit 2; }
HOME_DIR="${DEPLOY_HOME:-/home/u130124229}"
SITE="$HOME_DIR/domains/almuhallab-code.com"
WEB="$SITE/public_html"
MARK="$HOME_DIR/.almuhallab-cleanup-$SHA"
exec >>"$WEB/.deploy-log.txt" 2>&1
echo "=== $(date -u) cleanup $SHA"
[[ -e "$MARK" ]] && { echo "already cleaned — nothing to do"; exit 0; }
cd "$WEB"
STALE=(
  almuhallab-code-upload      # an old manual upload: the retired editor and the pre-rename portal
  editor.html                 # the retired in-browser code editor
  fonts/tajawal-400.woff2 fonts/tajawal-500.woff2 fonts/tajawal-700.woff2 fonts/tajawal-800.woff2
  fonts/LICENSE-Tajawal.txt
  fonts/plex-arabic-400.woff2 fonts/plex-arabic-600.woff2 fonts/plex-arabic-700.woff2
  fonts/LICENSE.txt           # IBM Plex's licence; the site's faces carry LICENSE-<face>.txt
  # retired with the dark logo theme (owner's «update all», 2026-10-07)
  fonts/reemkufi-700.woff2 fonts/sharetechmono-400.woff2
  fonts/LICENSE-ReemKufi.txt fonts/LICENSE-ShareTechMono.txt
)
PRESENT=()
for p in "${STALE[@]}"; do [[ -e "$p" ]] && PRESENT+=("$p"); done
if [[ ${#PRESENT[@]} -eq 0 ]]; then echo "nothing stale present"; touch "$MARK"; exit 0; fi
BAK="$SITE/stale-removed-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar czf "$BAK" "${PRESENT[@]}"
[[ -s "$BAK" ]] || { echo "ARCHIVE FAILED — nothing removed"; exit 3; }
rm -rf -- "${PRESENT[@]}"
touch "$MARK"
echo "archived to $BAK, then removed: ${PRESENT[*]}"
echo "restore: tar xzf $BAK -C $WEB"
echo "DONE"
