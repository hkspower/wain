#!/bin/bash
# Deploy almuhallab/ to almuhallab-code.com on Hostinger, from one pinned commit.
#
#   bash hostinger_deploy.sh <commit-sha>
#
# Run ON the Hostinger account (a one-shot cron job fetches and runs it), because
# the web root is not reachable from where the site is built. It is written to
# be safe on a web root that holds far more than this repo:
#
#   * it copies files IN, one by one — it never empties a directory and never
#     touches a path this repo does not ship. discs/, the n8n proxy blueprints,
#     salon-queue, mcp-admin, the landing-page folders and anything else on the
#     server are left exactly as they are. The ONE exception is below: the Wain
#     build that was extracted here by mistake, removed only on proof;
#   * it never ships .htaccess. The server's copy is replaced by hand, as a
#     deliberate step (the repo copy is v3, a superset of the live file);
#   * before anything is replaced or removed, it is archived OUTSIDE the web
#     root, so a bad run is one tar command back;
#   * it runs once per commit: a marker file makes a second firing a no-op;
#   * it logs to .deploy-log.txt in the web root FROM INSIDE: Hostinger's cron
#     appends its own >/dev/null to every command, so a redirect written in the
#     cron line opens the file and then loses every byte. .htaccess denies
#     dotfiles, so the log is readable through the file API and never served.
set -euo pipefail

SHA="${1:?usage: hostinger_deploy.sh <commit-sha>}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "not a full commit sha: $SHA"; exit 2; }

HOME_DIR="${DEPLOY_HOME:-/home/u130124229}"   # overridable only so it can be tested off-server
SITE_DIR="$HOME_DIR/domains/almuhallab-code.com"
WEB="$SITE_DIR/public_html"
MARK="$HOME_DIR/.almuhallab-deployed-$SHA"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$SITE_DIR/backup-before-$SHA-$STAMP.tar.gz"
WAIN_BACKUP="$SITE_DIR/wain-removed-$STAMP.tar.gz"

[[ -d "$WEB" ]] || { echo "no web root at $WEB"; exit 3; }
exec >>"$WEB/.deploy-log.txt" 2>&1
echo "=== $(date -u) deploy $SHA"

if [[ -e "$MARK" ]]; then echo "already deployed $SHA — nothing to do"; exit 0; fi

# curl failed silently in this host's cron on 2026-09-28 while wget, used by
# the account's other jobs, works — so try both, and say which one fetched.
fetch() {
  if command -v curl >/dev/null 2>&1 && curl -fsSL "$1" -o "$2"; then echo "fetched with curl: $1"; return 0; fi
  if command -v wget >/dev/null 2>&1 && wget -q -O "$2" "$1" && [[ -s "$2" ]]; then echo "fetched with wget: $1"; return 0; fi
  echo "FETCH FAILED: $1"; return 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch "https://codeload.github.com/hkspower/wain/tar.gz/$SHA" "$TMP/src.tgz"
mkdir "$TMP/x"
tar xzf "$TMP/src.tgz" -C "$TMP/x" "wain-$SHA/almuhallab"
SRC="$TMP/x/wain-$SHA/almuhallab"

# refuse to deploy something that is not the site
for must in index.html nokhatha.html nizam.html sw.js favicon.svg fonts/cairo-400.woff2; do
  [[ -f "$SRC/$must" ]] || { echo "archive is missing $must — refusing to deploy"; exit 4; }
done

# ── The Wain build extracted into this web root (seen 2026-09-28) ──
# A FIXED list, never derived from what is on disk, and acted on only when
# build.json proves the Wain app is what put it there. Everything removed is
# archived first. Wain's overwrites of index.html, 404.html, sw.js, robots.txt,
# sitemap.xml, manifest.webmanifest and icon.svg are not removed — the site's
# own copies replace them below, with their own backup.
WAIN=(_next places og about search explore queue orders privacy 404 admin add brand
      og.jpg apple-icon.png build.json index.txt)
if [[ -f "$WEB/build.json" ]] && grep -q '"name": *"wain"' "$WEB/build.json"; then
  PRESENT=()
  for p in "${WAIN[@]}"; do [[ -e "$WEB/$p" ]] && PRESENT+=("$p"); done
  tar czf "$WAIN_BACKUP" -C "$WEB" "${PRESENT[@]}"
  echo "archived ${#PRESENT[@]} Wain paths to $WAIN_BACKUP"
  for p in "${PRESENT[@]}"; do rm -rf -- "${WEB:?}/$p"; done
  echo "removed: ${PRESENT[*]}"
else
  echo "no Wain build.json in the web root — nothing of Wain's removed"
fi

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
echo "DONE"
