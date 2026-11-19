#!/bin/sh
# Read-only check of www.wainkw.com's PHP endpoints after update-endpoints.sh.
# Changes nothing except what `migrate` does (it only adds missing tables) and
# the rows `selftest` writes and deletes again. Run where Docker is reachable.
W=$(docker ps -q -f label=com.docker.compose.project=apache -f label=com.docker.compose.service=wain | head -1)
[ -n "$W" ] || { echo "STOP: no running wain container"; exit 1; }
for m in version migrate selftest; do
  echo "== wain.php $m"; docker exec "$W" php /var/www/html/api/wain.php "$m"; echo
done
echo "== media.php version"; docker exec "$W" php /var/www/html/api/media.php version; echo
echo "== backups left in the image: $(docker exec "$W" sh -c 'ls /var/www/html/api/ | grep -c "\.bak-"')"
echo "== ping"; curl -sS "https://www.wainkw.com/api/wain.php?a=ping"; echo
for f in wain.php media.php; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://www.wainkw.com/api/$f.bak-20261119T092313Z")
  echo "== a backup of $f over the web: HTTP $code"
done
echo "== / headers"; curl -sSI https://www.wainkw.com/ | grep -iE '^(HTTP|content-security-policy|x-frame-options)'
