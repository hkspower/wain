#!/bin/sh
# Follow-up checks to scan-live.sh, read-only: GET requests to the public site
# and reads inside the wain container. No writes, no secrets printed.
set -u
H=${H:-https://www.wainkw.com}
C="curl -sS --max-time 20 -A wain-scan/1"
echo "## php error display: a malformed request"
for q in 'a[]=x' 'a=places&x[]=1' 'a=order_status&id[]=1&token[]=1' 'a=queue_status&id=%00'; do
  echo "?$q -> $($C -o /tmp/b -w '%{http_code}' -g "$H/api/wain.php?$q") $(head -c 300 /tmp/b | tr '\n' ' ')"
done
echo "## response headers of the API"
$C -D - -o /dev/null "$H/api/wain.php?a=ping" | tr -d '\r' | grep -iE '^(x-powered-by|server|cache-control|expires|content-type|access-control)'
echo "## owner endpoints (GET only, first 300 bytes)"
for p in /api/call-center-data.php /api/call-center-flow.php; do
  echo "$p -> $($C -o /tmp/b -w '%{http_code} %{content_type}' "$H$p") $(head -c 300 /tmp/b | tr '\n' ' ')"
done
echo "## dot backup in the docroot"
echo "/.htaccess.pre-csp -> $($C -o /dev/null -w '%{http_code}' "$H/.htaccess.pre-csp")"
echo "## sw.js strings that are not files"
$C "$H/sw.js" | grep -oE '"/(_next/static/|api/)"[^;]{0,80}' | head -5
echo "## the bracketed route chunk"
P=$($C "$H/sw.js" | grep -oE '"/_next/static/chunks/app/places/\[slug\]/page-[^"]+"' | tr -d '"' | head -1)
[ -n "$P" ] && echo "$P -> $($C -g -o /dev/null -w '%{http_code} %{size_download}' "$H$P")"
echo "## directory slash redirect scheme"
for p in /explore /find /shoug /places/the-avenues; do $C -o /dev/null -w "$p -> %{http_code} %{redirect_url}\n" "$H$p"; done
W=$(docker ps -q -f label=com.docker.compose.project=apache -f label=com.docker.compose.service=wain | head -1)
if [ -n "$W" ]; then
  echo "## apache config files that set AllowOverride, ServerName or headers"
  docker exec "$W" sh -c 'grep -RhnE "AllowOverride|ServerName|UseCanonical|RemoteIP|Header|DirectoryIndex|Options" /etc/apache2/conf-enabled/ /etc/apache2/sites-enabled/ 2>/dev/null | head -40'
  echo "## php.ini files"
  docker exec "$W" sh -c 'ls /usr/local/etc/php/ /usr/local/etc/php/conf.d/ 2>/dev/null | tr "\n" " "'
  echo
  echo "## owner .htaccess: compression and deny lines"
  docker exec "$W" sh -c 'grep -nE "OutputFilterByType|FilesMatch|RedirectMatch|RewriteRule|Strict-Transport|Content-Security" /var/www/html/.htaccess | cut -c1-200 | head -40'
fi
echo "EXTRA-DONE"
