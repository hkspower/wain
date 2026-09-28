#!/bin/bash
# Deploy almuhallab/ to almuhallab-code.com on Hostinger, from one pinned commit.
#
#   bash hostinger_deploy.sh <commit-sha>
#
# Run ON the Hostinger account (a one-shot cron job fetches and runs it), because
# the web root is not reachable from where the site is built. It is written to
# be safe on a web root that holds far more than this repo:
#
#   * it copies files IN, one by one — it never deletes, never empties a
#     directory, never touches a path this repo does not ship. discs/, the
#     n8n proxy blueprints, salon-queue, mcp-admin, the landing-page folders
#     and anything else on the server are left exactly as they are;
#   * it never ships .htaccess. The live one is hand-maintained and carries the
#     Basic Auth on admin/nizam/editor/mcp-admin and the block on *-proxy.json;
#     the repo's copy knows none of that and would silently undo both;
#   * before anything is replaced, every file it is about to overwrite is
#     archived OUTSIDE the web root, so a bad deploy is one tar command back;
#   * it runs once per commit: a marker file makes a second firing a no-op.
set -euo pipefail

SHA="${1:?usage: hostinger_deploy.sh <commit-sha>}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "not a full commit sha: $SHA"; exit 2; }

HOME_DIR="${DEPLOY_HOME:-/home/u130124229}"   # overridable only so it can be tested off-server
SITE_DIR="$HOME_DIR/domains/almuhallab-code.com"
WEB="$SITE_DIR/public_html"
MARK="$HOME_DIR/.almuhallab-deployed-$SHA"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$SITE_DIR/backup-before-$SHA-$STAMP.tar.gz"

if [[ -e "$MARK" ]]; then echo "already deployed $SHA — nothing to do"; exit 0; fi
[[ -d "$WEB" ]] || { echo "no web root at $WEB"; exit 3; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "https://codeload.github.com/hkspower/wain/tar.gz/$SHA" -o "$TMP/src.tgz"
mkdir "$TMP/x"
tar xzf "$TMP/src.tgz" -C "$TMP/x" "wain-$SHA/almuhallab"
SRC="$TMP/x/wain-$SHA/almuhallab"

# refuse to deploy something that is not the site
for must in index.html nokhatha.html nizam.html sw.js favicon.svg fonts/cairo-400.woff2; do
  [[ -f "$SRC/$must" ]] || { echo "archive is missing $must — refusing to deploy"; exit 4; }
done

cd "$SRC"
mapfile -t FILES < <(find . -type f ! -name .htaccess | sed 's|^\./||' | sort)
echo "shipping ${#FILES[@]} files from $SHA (.htaccess excluded)"

# back up whatever of those already exists on the server
EXISTING=()
for f in "${FILES[@]}"; do [[ -e "$WEB/$f" ]] && EXISTING+=("$f"); done
if (( ${#EXISTING[@]} )); then
  tar czf "$BACKUP" -C "$WEB" "${EXISTING[@]}"
  echo "backed up ${#EXISTING[@]} live files to $BACKUP"
fi

for f in "${FILES[@]}"; do
  mkdir -p "$WEB/$(dirname "$f")"
  cp -f "$SRC/$f" "$WEB/$f"
done

touch "$MARK"
echo "deployed $SHA: ${#FILES[@]} files written, $((${#FILES[@]} - ${#EXISTING[@]})) new, ${#EXISTING[@]} replaced"
echo "roll back: tar xzf $BACKUP -C $WEB"
