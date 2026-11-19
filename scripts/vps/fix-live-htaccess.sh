#!/usr/bin/env bash
# The owner's .htaccess on www.wainkw.com: add JavaScript and JSON compression,
# and remove X-Powered-By. Nothing above the new block is touched. Run from a
# container with /docker/apache and the Docker socket mounted, the same way as
# update-endpoints.sh:
#
#   bash fix-live-htaccess.sh               # look only: show what would change
#   CONFIRM=yes bash fix-live-htaccess.sh   # back up, append, rebuild, check
#
# The image is built from public_html/, so the change reaches the site only
# after a rebuild of the wain container alone. After it, the live site is
# checked; if any check fails the backup is put back, the container is rebuilt
# again, and the script exits non-zero. The backup stays in
# storage/htaccess-backups/htaccess.<stamp>.
set -eu
SITE=${SITE:-/docker/apache/sites/wainkw.com}
COMPOSE=${COMPOSE:-/docker/apache/docker-compose.yml}
F="$SITE/public_html/.htaccess"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
MARK="# 19 November: JavaScript and JSON compression"
die() { echo "STOP: $*" >&2; exit 1; }

[ -f "$F" ] || die "$F not found"
[ -f "$SITE/Dockerfile" ] || die "$SITE/Dockerfile not found"
grep -q "^COPY public_html/ " "$SITE/Dockerfile" || die "the Dockerfile no longer copies public_html/"

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
cat >"$WORK/block" <<BLOCK
$MARK.
# text/javascript is what Apache 2.4.58 and later call .js; application/javascript
# is what older Apache and LiteSpeed call it. A list naming only one stops
# compressing JavaScript the day the host changes, so both are named.
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/javascript application/javascript application/json application/xml
</IfModule>
# PHP adds X-Powered-By with its version to every answer, and no visitor needs it.
<IfModule mod_headers.c>
  Header always unset X-Powered-By
  Header unset X-Powered-By
</IfModule>
BLOCK

echo "== live .htaccess: $(wc -c <"$F") bytes, sha256 $(sha256sum "$F" | cut -c1-16)"
ALREADY=no
grep -qF "$MARK" "$F" && ALREADY=yes
echo "== compression and header lines in the file now:"
grep -nE 'OutputFilterByType|X-Powered-By|mod_deflate|mod_headers' "$F" | cut -c1-160 || echo "   (none)"
echo "== block to append:"
sed 's/^/   /' "$WORK/block"

# A rebuild copies ALL of public_html/ into the image. Refuse if the folder holds
# anything the running site does not serve (the endpoints excepted: their own
# script has already replaced them).
running=$(docker ps -q -f label=com.docker.compose.project=apache -f label=com.docker.compose.service=wain | head -1)
[ -n "$running" ] || die "no running wain container to compare the folder with"
skip='^[0-9a-f]+  \./api/(wain|media)\.php$'
docker exec "$running" sh -c 'cd /var/www/html && find . -type f -exec sha256sum {} + 2>/dev/null' \
  | grep -Ev "$skip" | sort -k2 >"$WORK/image.sums"
(cd "$SITE/public_html" && find . -type f -exec sha256sum {} +) | grep -Ev "$skip" | sort -k2 >"$WORK/folder.sums"
if ! cmp -s "$WORK/image.sums" "$WORK/folder.sums"; then
  changed=$(diff "$WORK/image.sums" "$WORK/folder.sums" | grep -E '^[<>]' | awk '{print $3}' | sort -u)
  echo "== public_html/ differs from the running site in $(printf '%s\n' "$changed" | grep -c .) file(s):"
  printf '%s\n' "$changed" | head -40
  die "a rebuild would publish those too"
fi
echo "== public_html/ matches the running site apart from the API files"

if [ "$ALREADY" = yes ]; then echo "== the block is already in the file; nothing to do"; exit 0; fi
if [ "${CONFIRM:-}" != "yes" ]; then
  echo; echo "Looked only. Read the above, then: CONFIRM=yes bash $0"; exit 0
fi

mkdir -p "$SITE/storage/htaccess-backups"; chmod 700 "$SITE/storage/htaccess-backups"
BAK="$SITE/storage/htaccess-backups/htaccess.$STAMP"
cp -p "$F" "$BAK"; chmod 600 "$BAK"
cmp -s "$F" "$BAK" || die "the backup does not match the live file"
echo "== backup: storage/htaccess-backups/htaccess.$STAMP"

rebuild() {
  image=$(docker compose -f "$COMPOSE" config --images wain 2>/dev/null | head -1)
  image=${image:-apache-wain}
  docker build -q -t "$image" "$SITE" >/dev/null
  docker compose -f "$COMPOSE" up -d --no-deps --force-recreate wain >/dev/null
  W=$(docker ps -q -f label=com.docker.compose.project=apache -f label=com.docker.compose.service=wain | head -1)
  i=0
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$W")" = healthy ] || [ $i -ge 30 ]; do i=$((i + 1)); sleep 3; done
  echo "== wain health: $(docker inspect -f '{{.State.Health.Status}}' "$W")"
}

printf '\n' >>"$F"; cat "$WORK/block" >>"$F"
echo "== appended the block to the live file"
rebuild

fail=0
check() { # check "<what>" <command...>
  what=$1; shift
  if "$@"; then echo "   ok: $what"; else echo "   FAIL: $what"; fail=$((fail + 1)); fi
}
page=$(curl -sS -m 30 -o /dev/null -w '%{http_code}' https://www.wainkw.com/explore/ || echo 000)
check "/explore/ answers 200 (got $page)" [ "$page" = 200 ]
check "the block is in the image" sh -c "docker exec '$W' grep -qF '$MARK' /var/www/html/.htaccess"
check "sw.js is gzipped for a browser that accepts it" sh -c \
  "curl -sS -m 30 -o /dev/null -D - -H 'Accept-Encoding: gzip' https://www.wainkw.com/sw.js | tr -d '\r' | grep -qi '^content-encoding: gzip'"
check "/data/places.json is gzipped for a browser that accepts it" sh -c \
  "curl -sS -m 30 -o /dev/null -D - -H 'Accept-Encoding: gzip' https://www.wainkw.com/data/places.json | tr -d '\r' | grep -qi '^content-encoding: gzip'"
# A negative check must first prove the request succeeded: a failed curl leaves
# nothing to grep, and "nothing found" would pass.
check "/explore/ carries no X-Powered-By" sh -c \
  "h=\$(curl -sS -m 30 -o /dev/null -D - https://www.wainkw.com/explore/) && ! printf '%s' \"\$h\" | tr -d '\r' | grep -qi '^x-powered-by'"
check "the API still answers its ping" sh -c \
  "curl -sS -m 30 'https://www.wainkw.com/api/wain.php?a=ping' | grep -Eq '\"ok\": ?true'"

if [ "$fail" -eq 0 ]; then
  echo "== live site checks passed: $fail failed"
  echo "Undo: cp -p storage/htaccess-backups/htaccess.$STAMP public_html/.htaccess, then rebuild wain."
  exit 0
fi
echo "== $fail check(s) failed: putting the backup back and rebuilding"
cp -p "$BAK" "$F"
cmp -s "$F" "$BAK" || { echo "RESTORE FAILED: the live file differs from the backup"; exit 2; }
rebuild
echo "== restored from storage/htaccess-backups/htaccess.$STAMP and rebuilt"
exit 1
