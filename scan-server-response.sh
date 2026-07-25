#!/usr/bin/env bash
# Sporta — server response scanner.
#
# Run this from your own machine (Mac Terminal) against the LIVE site to see
# exactly what www.sporta.com.kw returns. Claude's sandbox cannot reach the
# live host (egress policy blocks it), so this is the check to run yourself
# after each deploy.
#
#   chmod +x scan-server-response.sh
#   ./scan-server-response.sh
#   ./scan-server-response.sh https://staging.example.com   # any other host
#
# Exit code is 0 always — this is a report, not a gate.

SITE="${1:-https://www.sporta.com.kw}"
HOST="$(printf '%s' "$SITE" | sed -E 's#^https?://##; s#/.*##')"
BARE="$(printf '%s' "$HOST" | sed 's/^www\.//')"

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

HDRS="$(curl -sS -o /dev/null -D - -A 'Mozilla/5.0' "$SITE/" 2>/dev/null | tr -d '\r')"

bold "1. Reachability & protocol"
code="$(curl -sS -o /dev/null -w '%{http_code}' "$SITE/")"
ver="$(curl -sS -o /dev/null -w '%{http_version}' "$SITE/")"
tls="$(curl -sSI "$SITE/" -w '%{ssl_verify_result}' -o /dev/null 2>/dev/null)"
[ "$code" = 200 ] && ok "GET / -> $code (HTTP/$ver)" || bad "GET / -> $code"
[ "$tls" = 0 ] && ok "TLS certificate verifies" || bad "TLS verify result: $tls"

bold "2. Redirects — every variant should reach the canonical URL in ONE hop"
for u in "http://$BARE/shop" "http://$HOST/shop" "https://$BARE/shop"; do
  n="$(curl -sS -o /dev/null -w '%{num_redirects}' -L "$u")"
  fin="$(curl -sS -o /dev/null -w '%{url_effective}' -L "$u")"
  if [ "$n" -le 1 ]; then ok "$u -> $n hop(s) -> $fin"
  else bad "$u -> $n hops (redirect chain) -> $fin"; fi
done

bold "3. Security headers"
check() {
  if printf '%s' "$HDRS" | grep -qi "^$1:"; then
    ok "$1: $(printf '%s' "$HDRS" | grep -i "^$1:" | head -1 | cut -c1-96)"
  else bad "$1 MISSING"; fi
}
check Strict-Transport-Security
check Content-Security-Policy
check X-Content-Type-Options
check X-Frame-Options
check Referrer-Policy
check Permissions-Policy
check Cross-Origin-Opener-Policy

bold "4. Information disclosure"
srv="$(printf '%s' "$HDRS" | grep -i '^server:' | head -1)"
if printf '%s' "$srv" | grep -qE '[0-9]+\.[0-9]+'; then
  warn "$srv  (exposes version — ask Hostinger for 'ServerTokens Prod')"
else ok "${srv:-Server header absent}"; fi
if printf '%s' "$HDRS" | grep -qi '^x-powered-by:'; then
  bad "$(printf '%s' "$HDRS" | grep -i '^x-powered-by:' | head -1)  (should be unset)"
else ok "X-Powered-By not exposed"; fi

bold "5. Compression & caching"
enc="$(curl -sS -o /dev/null -D - -H 'Accept-Encoding: gzip, br' "$SITE/" | tr -d '\r' | grep -i '^content-encoding:')"
[ -n "$enc" ] && ok "HTML ${enc}" || bad "HTML is NOT compressed"
hc="$(printf '%s' "$HDRS" | grep -i '^cache-control:' | head -1)"
if printf '%s' "$hc" | grep -qi 'no-cache\|no-store\|max-age=0'; then
  ok "HTML $hc"
else bad "HTML $hc  (HTML must revalidate or deploys won't reach visitors)"; fi

bold "6. 404 handling (a made-up URL must NOT answer 200)"
for path in /this-page-does-not-exist-12345 /shop/nope-9876; do
  c="$(curl -sS -o /dev/null -w '%{http_code}' "$SITE$path")"
  [ "$c" = 404 ] && ok "$path -> 404" || bad "$path -> $c  (soft 404: wastes crawl budget)"
done

bold "7. Sensitive paths (all should be 403 or 404 — never 200)"
for path in /.git/config /.env /.htaccess /package.json /config.php /.DS_Store /knet/config.php; do
  c="$(curl -sS -o /dev/null -w '%{http_code}' "$SITE$path")"
  if [ "$c" = 200 ]; then bad "$path -> 200  ***EXPOSED***"
  else ok "$path -> $c"; fi
done

bold "8. SEO endpoints"
for path in /robots.txt /sitemap.xml /llms.txt; do
  c="$(curl -sS -o /dev/null -w '%{http_code}' "$SITE$path")"
  [ "$c" = 200 ] && ok "$path -> 200" || bad "$path -> $c"
done

bold "9. Response time (5 samples, total seconds)"
for i in 1 2 3 4 5; do
  printf '  %s\n' "$(curl -sS -o /dev/null -w 'connect=%{time_connect}s  ttfb=%{time_starttransfer}s  total=%{time_total}s' "$SITE/")"
done

printf '\nDone. Anything marked \033[31m✗\033[0m is worth fixing.\n'
