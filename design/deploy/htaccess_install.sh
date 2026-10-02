#!/bin/bash
# Install the repo's .htaccess on Hostinger from one pinned commit — the step
# hostinger_deploy.sh deliberately never takes. Run by a one-shot cron:
#
#   bash htaccess_install.sh <commit-sha>
#
# The live file is copied ABOVE the web root first, the new one must be
# non-empty and still carry the password rule for the internal tools, and the
# swap is one mv. Logs to .deploy-log.txt from inside (Hostinger's cron
# discards a command's own output).
set -euo pipefail
SHA="${1:?usage: htaccess_install.sh <commit-sha>}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "not a full commit sha: $SHA"; exit 2; }
SITE="${DEPLOY_HOME:-/home/u130124229}/domains/almuhallab-code.com"
WEB="$SITE/public_html"
MARK="${DEPLOY_HOME:-/home/u130124229}/.almuhallab-htaccess-$SHA"
exec >>"$WEB/.deploy-log.txt" 2>&1
echo "=== $(date -u) htaccess $SHA"
[[ -e "$MARK" ]] && { echo "already installed — nothing to do"; exit 0; }
NEW="$(mktemp)"
trap 'rm -f "$NEW"' EXIT
URL="https://raw.githubusercontent.com/hkspower/wain/$SHA/almuhallab/.htaccess"
curl -fsSL "$URL" -o "$NEW" 2>/dev/null || wget -q -O "$NEW" "$URL"
[[ -s "$NEW" ]] || { echo "FETCH FAILED"; exit 3; }
grep -q 'AuthType Basic' "$NEW" || { echo "REFUSED: no password rule for the internal tools"; exit 4; }
BAK="$SITE/htaccess-before-$SHA-$(date -u +%Y%m%dT%H%M%SZ)"
cp "$WEB/.htaccess" "$BAK"
cp "$NEW" "$WEB/.htaccess.tmp" && mv "$WEB/.htaccess.tmp" "$WEB/.htaccess"
touch "$MARK"
echo "installed .htaccess from $SHA ($(wc -c <"$WEB/.htaccess") bytes); previous copy: $BAK"
echo "DONE"
