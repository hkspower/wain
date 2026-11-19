#!/usr/bin/env bash
# Put this repository's api/wain.php and api/media.php into www.wainkw.com on the
# VPS, and rebuild only the `wain` container. Run as root on the VPS (hPanel →
# VPS → Browser terminal):
#
#   bash update-endpoints.sh            # look only: back up nothing, change nothing
#   CONFIRM=yes bash update-endpoints.sh  # replace, rebuild, check
#
# Why a script: the PHP files are baked into the `apache-wain` image (only
# storage/ is mounted), so copying a file changes nothing until the image is
# rebuilt, and the project's other four sites must not be rebuilt with it.
# docs/vps.md, «Getting the PHP endpoints onto the running site».
#
# It stops, changing nothing, when:
#   - the site folder, its Dockerfile or the live file cannot be found;
#   - a downloaded file does not match the sha256 below;
#   - the Dockerfile does not copy public_html/ (the only folder replaced);
#   - storage/admin.secret is shorter than 32 characters (the new endpoint
#     would lock the board: 503 admin_weak). Fix it first, docs/admin-setup.md.
# The live files differ from every committed version (read 2 November), so the
# look-only run prints the diff. Read it before CONFIRM=yes: a change you do not
# recognise is lost by the replace (the backup keeps it).
set -euo pipefail

SITE=${SITE:-/docker/apache/sites/wainkw.com}
COMPOSE=${COMPOSE:-/docker/apache/docker-compose.yml}
REF=50a52ba4faf029b7f33427d9c889ec0fca17da34
RAW=https://raw.githubusercontent.com/hkspower/wain/$REF/scripts/publish
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

# repository file | name on the server | sha256 at $REF
FILES=(
  "wain-api.php|wain.php|2930b633bd16b8feca5236b23480d603ab05fbb7dbccbbbd444a7b0e03024c42"
  "media-endpoint.php|media.php|2f3fafe29dad4c117ef8f148a0120542dec67b5de2023b1f1b33c305dff5ca02"
)

die() { echo "STOP: $*" >&2; exit 1; }

[ -d "$SITE" ] || die "$SITE not found"
[ -f "$SITE/Dockerfile" ] || die "$SITE/Dockerfile not found"
grep -q "^COPY public_html/ " "$SITE/Dockerfile" || die "the Dockerfile no longer copies public_html/; read it before replacing anything"
[ -f "$COMPOSE" ] || die "$COMPOSE not found"
echo "== Dockerfile"; cat "$SITE/Dockerfile"; echo

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

declare -A TARGET
for row in "${FILES[@]}"; do
  IFS='|' read -r src name sum <<<"$row"
  # The Dockerfile copies public_html/ alone; the folder also holds dozens of
  # release-*/ and public_html.rollback-*/ copies (read 19 November), which
  # never reach the image and must not be touched.
  live="$SITE/public_html/api/$name"
  if [ ! -f "$live" ]; then
    echo "== $name: not in $SITE/public_html/api — skipped (installing it is a separate decision)"; continue
  fi
  curl -fsS -o "$WORK/$name" "$RAW/$src" || die "could not download $src"
  echo "$sum  $WORK/$name" | sha256sum -c --quiet - || die "$src does not match its sha256"
  TARGET[$name]=$live
  echo "== $name: $live ($(wc -c <"$live") bytes, $(sha256sum "$live" | cut -c1-16)) → $(wc -c <"$WORK/$name") bytes"
  diff -u "$live" "$WORK/$name" | head -400 || true
  echo
done
[ "${#TARGET[@]}" -gt 0 ] || die "nothing to replace"

secret="$SITE/storage/admin.secret"
if [ -f "$secret" ]; then
  chars=$(php -r 'echo preg_match_all("/./us", trim(file_get_contents($argv[1])));' "$secret" 2>/dev/null \
    || docker compose -f "$COMPOSE" exec -T wain php -r 'echo preg_match_all("/./us", trim(file_get_contents("/var/www/storage/admin.secret")));')
  echo "== admin.secret: $chars characters"
  [ "$chars" -ge 32 ] || die "admin.secret is under 32 characters; the new wain.php would lock /admin"
else
  echo "== admin.secret: missing (the board stays locked as it is now: admin_unset)"
fi

if [ "${CONFIRM:-}" != "yes" ]; then
  echo; echo "Looked only. Read the diff above, then: CONFIRM=yes bash $0"; exit 0
fi

for name in "${!TARGET[@]}"; do
  live=${TARGET[$name]}
  cp -p "$live" "$live.bak-$STAMP"
  install -m "$(stat -c %a "$live")" "$WORK/$name" "$live"
  echo "== replaced $live (backup $live.bak-$STAMP)"
done

# Only wain: build its image under the name the compose file uses, then
# recreate that one container. Never the project-wide `up --build`.
image=$(docker compose -f "$COMPOSE" config --images wain 2>/dev/null | head -1)
image=${image:-apache-wain}
docker build -t "$image" "$SITE"
docker compose -f "$COMPOSE" up -d --no-deps --force-recreate wain

api=$(docker compose -f "$COMPOSE" exec -T wain sh -c 'find / -xdev -path "*/api/wain.php" 2>/dev/null | head -1')
echo "== in the container: $api"
docker compose -f "$COMPOSE" exec -T wain php "$api" version
docker compose -f "$COMPOSE" exec -T wain php "$api" migrate
docker compose -f "$COMPOSE" exec -T wain php "$api" selftest
echo "== ping"; curl -fsS https://www.wainkw.com/api/wain.php?a=ping; echo
echo
echo "Undo: copy each *.bak-$STAMP back over its file, then rerun the two docker lines above."
