#!/bin/sh
# Read-only scan of www.wainkw.com from the VPS itself (the sandbox cannot reach
# the site). It sends HTTP requests to the public site and reads, never writes,
# inside the running wain container. It prints no secret, no file's contents
# from storage/, and no database row: only names, sizes, modes and counts.
#
# Run from a container with the Docker socket mounted (docker:cli + curl +
# openssl), e.g. `sh scan-live.sh`. Output is compact: one line per check,
# failures spelled out, long lists capped.
set -u
H=${H:-https://www.wainkw.com}
A=${A:-https://wainkw.com}
C="curl -sS --max-time 20 -A wain-scan/1"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
sec() { echo; echo "## $*"; }
# status code size type time for one URL
probe() { $C -o "$T/body" -D "$T/hdr" -w '%{http_code} %{size_download} %{content_type} %{time_total}' "$1" 2>/dev/null || echo "ERR"; }
hdr() { grep -i "^$1:" "$T/hdr" | head -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ //'; }

sec "routes"
ROUTES="/ /explore/ /search/ /find/ /salem/ /about/ /privacy/ /add/ /admin/ /orders/ /queue/ /pick/ /404/ /does-not-exist/ /places/no-such-place/ /shoug/ /hangout/ /call-center/ /call-center/room/"
for r in $ROUTES; do echo "$r $(probe "$H$r")"; done

sec "headers of /"
probe "$H/" >/dev/null
tr -d '\r' < "$T/hdr" | grep -viE '^(date|content-length|etag|age|x-hcdn-request-id):' | sed 's/^/  /'

sec "security headers per route (csp xfo nosniff referrer permissions hsts set-cookie cache-control)"
for r in / /search/ /salem/ /admin/ /api/wain.php?a=ping /og.jpg /sw.js; do
  probe "$H$r" >/dev/null
  printf '%s csp=%s xfo=%s nosniff=%s ref=%s perm=%s hsts=%s cookie=%s cc=%s\n' "$r" \
    "$( [ -n "$(hdr content-security-policy)" ] && echo y || echo NO)" "$(hdr x-frame-options)" \
    "$(hdr x-content-type-options)" "$(hdr referrer-policy)" "$( [ -n "$(hdr permissions-policy)" ] && echo y || echo NO)" \
    "$(hdr strict-transport-security)" "$(hdr set-cookie)" "$(hdr cache-control)"
done
probe "$H/" >/dev/null; echo "csp(/): $(hdr content-security-policy)"

sec "redirects (first hop)"
for u in "http://www.wainkw.com/" "http://wainkw.com/" "$A/" "$A/explore/" "$A/api/wain.php?a=ping" "$H/explore" "$H/shoug" "$H/shoug/" "$H/areas/" "$H/index.html" "$H//explore/"; do
  $C -o /dev/null -w "$u -> %{http_code} %{redirect_url}\n" "$u" 2>/dev/null || echo "$u -> ERR"
done

sec "should not be served (status)"
for p in /.htaccess /.git/config /.zzz /.env /storage/ /storage/admin.secret /wain.sqlite /wain.sqlite-wal /admin.secret /deploy.secret /db.json \
         /api/wain.php.bak-20261119T092313Z /api/media.php.bak-20261119T092313Z /server/api.php /api/tts.php /api/deploy.php \
         /api/hangouts.php /api/call-center-data.php /api/ /data/ /data/places.json /build.json /wain-1.1.0.zip /package.json /Dockerfile; do
  echo "$p $($C -o /dev/null -w '%{http_code} %{size_download}' "$H$p" 2>/dev/null || echo ERR)"
done

sec "api"
for q in "a=ping" "a=places" "a=nope" "a=gap_report" "a=whoami" "a=queue_size&place=x"; do
  echo "?$q $($C -o "$T/b" -w '%{http_code}' "$H/api/wain.php?$q" 2>/dev/null) $(head -c 220 "$T/b" | tr '\n' ' ')"
done
echo "media GET $($C -o "$T/b" -w '%{http_code}' "$H/api/media.php" 2>/dev/null) $(head -c 160 "$T/b")"
echo "OPTIONS cross-origin: $($C -o /dev/null -D - -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' "$H/api/wain.php?a=order_place" 2>/dev/null | grep -iE '^(HTTP|access-control-allow-origin)' | tr -d '\r' | tr '\n' ' ')"
echo "POST cross-origin: $($C -o "$T/b" -w '%{http_code}' -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' --data '{}' "$H/api/wain.php?a=gap_report" 2>/dev/null) $(head -c 160 "$T/b")"
echo "POST wrong admin: $($C -o "$T/b" -w '%{http_code}' -H 'X-Wain-Admin: wrong' "$H/api/wain.php?a=whoami" 2>/dev/null) $(head -c 120 "$T/b")"

sec "compression and caching"
probe "$H/" >/dev/null
CSS=$(grep -oE '/_next/static/[^"]+\.css' "$T/body" | head -1)
JS=$(grep -oE '/_next/static/chunks/[^"]+\.js' "$T/body" | head -1)
for u in / "$CSS" "$JS" /og.jpg /sw.js /manifest.webmanifest /robots.txt /sitemap.xml /icon.svg; do
  [ -n "$u" ] || continue
  $C -o /dev/null -D "$T/h2" -H 'Accept-Encoding: br, gzip' "$H$u" 2>/dev/null
  printf '%s ce=%s cc=%s type=%s\n' "$u" "$(grep -i '^content-encoding:' "$T/h2" | cut -d: -f2 | tr -d ' \r')" \
    "$(grep -i '^cache-control:' "$T/h2" | cut -d: -f2- | tr -d '\r' | sed 's/^ //')" "$(grep -i '^content-type:' "$T/h2" | cut -d: -f2- | tr -d '\r ')"
done

sec "sitemap and every page in it"
$C -o "$T/sitemap" "$H/sitemap.xml" 2>/dev/null
grep -oE '<loc>[^<]+' "$T/sitemap" | sed 's/<loc>//' > "$T/urls"
echo "urls in sitemap: $(grep -c . "$T/urls")  hosts: $(sed -E 's#https?://([^/]+)/.*#\1#' "$T/urls" | sort -u | tr '\n' ' ')"
: > "$T/pages"; bad=0
while read -r u; do
  p=$(echo "$u" | sed -E 's#https?://[^/]+##')
  r=$($C -o "$T/pg" -w '%{http_code}' "$H$p" 2>/dev/null)
  [ "$r" = 200 ] || { bad=$((bad+1)); echo "  $r $p"; }
  cat "$T/pg" >> "$T/pages"
done < "$T/urls"
echo "sitemap pages not 200: $bad"
canon=$(grep -oE '<link rel="canonical" href="[^"]+"' "$T/pages" | sed -E 's#.*href="https?://([^/]+).*#\1#' | sort | uniq -c | tr '\n' ' ')
echo "canonical hosts: $canon"
echo "pages with no <h1>: $(for r in / /explore/ /search/ /find/ /salem/ /about/ /privacy/; do $C "$H$r" 2>/dev/null | grep -q '<h1' || echo "$r"; done | tr '\n' ' ')"

sec "every same-origin asset the pages reference"
for r in / /explore/ /search/ /find/ /salem/ /about/ /privacy/ /add/ /admin/ /pick/; do $C "$H$r" 2>/dev/null >> "$T/pages"; done
grep -oE '(src|href)="/[^"#?]*' "$T/pages" | sed -E 's/^(src|href)="//' | grep -vE '^//' | sort -u > "$T/assets"
echo "unique paths referenced: $(grep -c . "$T/assets")"
miss=0
while read -r p; do
  r=$($C -o /dev/null -w '%{http_code}' "$H$p" 2>/dev/null)
  case "$r" in 200|301|308) ;; *) miss=$((miss+1)); [ $miss -le 40 ] && echo "  $r $p";; esac
done < "$T/assets"
echo "referenced but not 200/301/308: $miss"
echo "external origins referenced: $(grep -oE '(src|href)="https?://[^/"]+' "$T/pages" | sed -E 's/^(src|href)="//' | sort | uniq -c | sort -rn | head -15 | tr '\n' ' ')"

sec "service worker"
$C -o "$T/sw" "$H/sw.js" 2>/dev/null
echo "version: $(grep -oE 'VERSION *= *"[^"]+"' "$T/sw" | head -1)"
grep -oE '"/[^"]+"' "$T/sw" | tr -d '"' | sort -u > "$T/swlist"
echo "precache entries: $(grep -c . "$T/swlist")"
swbad=0
while read -r p; do r=$($C -o /dev/null -w '%{http_code}' "$H$p" 2>/dev/null); [ "$r" = 200 ] || { swbad=$((swbad+1)); [ $swbad -le 30 ] && echo "  $r $p"; }; done < "$T/swlist"
echo "precache entries not 200: $swbad"

sec "manifest and robots"
$C "$H/manifest.webmanifest" 2>/dev/null | head -c 600; echo
$C "$H/robots.txt" 2>/dev/null | sed 's/^/  /'

sec "tls"
for h in www.wainkw.com wainkw.com; do
  echo | openssl s_client -connect "$h:443" -servername "$h" 2>/dev/null | openssl x509 -noout -issuer -enddate -ext subjectAltName 2>/dev/null | tr '\n' ' '; echo " <- $h"
done

W=$(docker ps -q -f label=com.docker.compose.project=apache -f label=com.docker.compose.service=wain | head -1)
sec "inside the wain container ($W)"
if [ -n "$W" ]; then
  docker inspect -f 'image={{.Config.Image}} created={{.Created}} started={{.State.StartedAt}} health={{.State.Health.Status}} restarts={{.RestartCount}}' "$W"
  docker exec "$W" sh -c 'apache2 -v | head -1; php -v | head -1'
  echo "modules: $(docker exec "$W" apache2ctl -M 2>/dev/null | awk 'NR>1{print $1}' | sed 's/_module//' | tr '\n' ' ')"
  echo "AllowOverride for /var/www: $(docker exec "$W" sh -c 'grep -rhE "^\s*(<Directory|AllowOverride)" /etc/apache2/apache2.conf /etc/apache2/conf-enabled /etc/apache2/sites-enabled 2>/dev/null' | tr -s ' ' | tr '\n' '|')"
  echo "remoteip conf: $(docker exec "$W" sh -c 'ls /etc/apache2/mods-enabled | grep -i remoteip; grep -rh RemoteIP /etc/apache2 2>/dev/null' | tr '\n' ' ')"
  echo "php: $(docker exec "$W" php -r 'foreach (["upload_max_filesize","post_max_size","memory_limit","max_execution_time","expose_php","display_errors","allow_url_fopen","disable_functions","date.timezone","session.cookie_secure"] as $k) echo $k,"=",ini_get($k),"; ";')"
  echo "php extensions: $(docker exec "$W" php -m | tr '\n' ' ')"
  echo ".htaccess in docroot: $(docker exec "$W" sh -c 'f=/var/www/html/.htaccess; [ -f $f ] && echo "$(wc -c < $f) bytes sha256=$(sha256sum $f | cut -c1-16)" || echo none')"
  echo "other .htaccess files: $(docker exec "$W" sh -c 'find /var/www/html -name .htaccess -not -path /var/www/html/.htaccess | head -20' | tr '\n' ' ')"
  echo "docroot top level: $(docker exec "$W" sh -c 'ls -A /var/www/html | tr "\n" " "')"
  echo "docroot files: $(docker exec "$W" sh -c 'find /var/www/html -type f | wc -l') size: $(docker exec "$W" du -sh /var/www/html | cut -f1)"
  echo "php files in docroot: $(docker exec "$W" sh -c 'find /var/www/html -name "*.php" -o -name "*.phtml" | sort | tr "\n" " "')"
  echo "zip/bak/sql/env in docroot: $(docker exec "$W" sh -c 'find /var/www/html -type f \( -name "*.zip" -o -name "*.bak*" -o -name "*.sql" -o -name "*.sqlite*" -o -name ".env*" -o -name "*.key" -o -name "*.secret" \) | head -30' | tr '\n' ' ')"
  echo "storage (names, modes, sizes only):"
  docker exec "$W" sh -c 'cd /var/www/storage && ls -la; for d in */; do echo "  $d: $(find "$d" -type f | wc -l) files"; done' 2>/dev/null | sed 's/^/  /'
  echo "endpoint versions:"
  for f in wain media; do docker exec "$W" sh -c "[ -f /var/www/html/api/$f.php ] && php /var/www/html/api/$f.php version 2>/dev/null | tr -d '\n' | head -c 700" ; echo; done
  echo "wain tables (rows, read-only open): $(docker exec "$W" php -r '$f="/var/www/storage/wain.sqlite"; if(!is_file($f)){echo "no db";exit;} $d=new PDO("sqlite:$f",null,null,[PDO::SQLITE_ATTR_OPEN_FLAGS=>PDO::SQLITE_OPEN_READONLY]); foreach($d->query("select name from sqlite_master where type=\"table\" order by name") as $r){$n=$r[0]; echo $n,"=",$d->query("select count(*) from \"$n\"")->fetchColumn()," ";}' 2>&1 | head -c 400)"
  echo "apache error log tail:"
  docker logs --tail 400 "$W" 2>&1 | grep -viE '" (200|301|304|308) ' | tail -20 | sed -E 's/[0-9]{1,3}(\.[0-9]{1,3}){3}/x.x.x.x/g; s/^/  /'
  echo "recent requests by status (last 2000 log lines):"
  docker logs --tail 2000 "$W" 2>/dev/null | grep -oE '" [0-9]{3} ' | sort | uniq -c | sort -rn | tr '\n' ' '; echo
  echo "top 404 paths:"
  docker logs --tail 2000 "$W" 2>/dev/null | grep -E '" 404 ' | grep -oE '"(GET|POST|HEAD) [^ ]+' | sort | uniq -c | sort -rn | head -15 | sed 's/^/  /'
fi

sec "traefik and the wain labels"
TR=$(docker ps -q -f label=com.docker.compose.project=traefik | head -1)
[ -n "$TR" ] && echo "traefik image: $(docker inspect -f '{{.Config.Image}}' "$TR")  args: $(docker inspect -f '{{join .Args " "}}' "$TR")"
[ -n "$W" ] && docker inspect -f '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{"\n"}}{{end}}' "$W" 2>/dev/null | grep '^traefik' | grep -v 'Content-Security-Policy' | sed 's/^/  /'
echo
echo "## other projects: $(docker ps --format '{{.Label "com.docker.compose.project"}}' | sort | uniq -c | tr '\n' ' ')"
echo "SCAN-DONE"
