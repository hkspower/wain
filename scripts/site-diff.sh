#!/usr/bin/env bash
# Is the live site the same build as the copy in this repo?
#
#   bash site-diff.sh                        # against www.sporta.com.kw
#   bash site-diff.sh http://127.0.0.1:4300  # against the local sandbox
#
# It fetches every fetchable file of the site and compares its sha256 against
# site-manifest.txt, which scripts/make-site-manifest.sh writes from the copy
# this repo holds (the 20 August go-live package plus the fixes made since).
# Needs curl and shasum/sha256sum — nothing else, so it runs on a bare Mac.
#
# HOW TO READ THE RESULT. Three findings mean three different things:
#
#   same       byte-identical. For /assets/ this is near-proof of the same
#              build: the filenames are content hashes.
#   DIFFERS    the live file exists but is not this one. This script knows the
#              two sides differ; it cannot know which is newer.
#   MISSING    live answered 404 (or an error) for a file this repo carries.
#              For a newly fingerprinted asset that means "not deployed yet",
#              which is expected until the fix zip is uploaded.
#
# PHP and .htaccess cannot be compared by fetching — the one executes and the
# other is never served — so .htaccess is checked by its OBSERVABLE effects at
# the end: the security headers it sends and the category-tile bridge it
# rewrites.
set -u
BASE="${1:-https://www.sporta.com.kw}"
BASE="${BASE%/}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="$HERE/site-manifest.txt"

if command -v sha256sum >/dev/null 2>&1; then SHA=sha256sum; else SHA="shasum -a 256"; fi
[ -f "$MANIFEST" ] || { echo "no $MANIFEST — run make-site-manifest.sh first"; exit 2; }

same=0; diff=0; miss=0; fails=0
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

while read -r want path; do
  [ -z "${path:-}" ] && continue
  code=$(curl -s -o "$tmp" -w '%{http_code}' -m 30 "$BASE/$path")
  if [ "$code" != "200" ]; then
    miss=$((miss+1)); echo "MISSING  $path ($code)"; continue
  fi
  got=$($SHA "$tmp" | cut -d' ' -f1)
  if [ "$got" = "$want" ]; then
    same=$((same+1))
  else
    diff=$((diff+1)); echo "DIFFERS  $path"
  fi
done < "$MANIFEST"

echo
echo "$same identical, $diff differing, $miss missing (of $((same+diff+miss)))"

# ---- .htaccess, by its effects ------------------------------------------
echo
case "$BASE" in
  https://*)
    hdr=$(curl -sI -m 20 "$BASE/")
    for want in strict-transport-security x-content-type-options content-security-policy; do
      if echo "$hdr" | grep -qi "^$want:"; then echo "ok    .htaccess effect: $want is sent"
      else fails=$((fails+1)); echo "FAIL  .htaccess effect: $want is NOT sent"; fi
    done ;;
  *) echo "--    .htaccess header effects skipped — only the real server reads it" ;;
esac
c=$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$BASE/cats/mobile/men.jpg")
if [ "$c" = "200" ]; then echo "ok    the category-tile bridge answers (/cats/mobile/men.jpg -> 200)"
else fails=$((fails+1)); echo "FAIL  /cats/mobile/men.jpg is $c — the tile bridge is not deployed"; fi

[ $((diff+miss+fails)) -eq 0 ] && { echo; echo "live matches this repo's copy"; exit 0; }
echo
echo "not identical — a MISSING fingerprinted asset usually means the latest fix zip is not uploaded yet"
exit 1
