#!/bin/sh
# Move the rollback copies update-endpoints.sh wrote into public_html/api/ on
# 19 November (its first run) into storage/endpoint-backups/, then rebuild the
# wain image so they leave the served site. Run as root on the VPS, or from a
# container with /docker/apache and the Docker socket mounted.
#
# Touches only api/*.bak-* files. The site's own release-*/ and
# public_html.rollback-*/ folders are not this script's.
set -eu
SITE=/docker/apache/sites/wainkw.com
COMPOSE=/docker/apache/docker-compose.yml
DEST="$SITE/storage/endpoint-backups"

mkdir -p "$DEST"; chmod 700 "$DEST"
moved=0
for f in "$SITE"/public_html/api/*.bak-*; do
  [ -f "$f" ] || continue
  base=$(basename "$f")                       # wain.php.bak-20261119T092313Z
  name=${base%%.bak-*}; stamp=${base##*.bak-}
  mv "$f" "$DEST/$name.$stamp"
  echo "== moved $base -> storage/endpoint-backups/$name.$stamp"
  moved=$((moved + 1))
done
[ "$moved" -gt 0 ] || { echo "== no backups in public_html/api/; nothing to rebuild"; exit 0; }
ls -l "$DEST"

image=$(docker compose -f "$COMPOSE" config --images wain 2>/dev/null | head -1)
image=${image:-apache-wain}
docker build -q -t "$image" "$SITE"
docker compose -f "$COMPOSE" up -d --no-deps --force-recreate wain

# Wait for the healthcheck before asking through Traefik, which answers 404
# while a container is still starting.
W=$(docker ps -q -f label=com.docker.compose.project=apache -f label=com.docker.compose.service=wain | head -1)
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$W")" = healthy ] || [ $i -ge 30 ]; do i=$((i + 1)); sleep 3; done
echo "== wain health: $(docker inspect -f '{{.State.Health.Status}}' "$W")"
echo "== backups left in the image: $(docker exec "$W" sh -c 'ls /var/www/html/api/ | grep -c "\.bak-"' || true)"
echo "== wain.php running: $(docker exec "$W" php /var/www/html/api/wain.php version | grep '"running"')"
echo "== ping: $(curl -sS 'https://www.wainkw.com/api/wain.php?a=ping')"
