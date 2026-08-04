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

# ---- Reachability gate ----------------------------------------------------
# Every "this path must NOT return 200" check below is written as
# `if [ "$c" = 200 ]; then bad; else ok; fi` — which means an unreachable host
# makes ALL of them pass. Run this against a site that is down, or with a typo
# in the hostname, and it printed a full page of green ticks saying nothing was
# exposed. That is the most dangerous way for a security scanner to be wrong, so
# it now refuses to run at all rather than reassure you about a host it never
# contacted.
# `|| echo 000` would APPEND to curl's own "000" and give "000000", so the
# fallback is applied only when curl printed nothing at all.
probe="$(curl -sS -o /dev/null -w '%{http_code}' -m 15 "$SITE/" 2>/dev/null)"
[ -n "$probe" ] || probe=000
if [ "$probe" = 000 ]; then
  printf '\n\033[31m✖ Cannot reach %s at all — DNS, TLS or the server.\033[0m\n' "$SITE"
  printf '  Nothing below would mean anything, so nothing was checked.\n'
  printf '  curl says:\n'
  curl -sS -o /dev/null "$SITE/" 2>&1 | sed 's/^/    /'
  exit 1
fi

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

# Every rule in public/.htaccess, checked on the thing it actually applies to.
# The Cache-Control block used to live inside <IfModule mod_expires.c> even
# though mod_headers is what emits it — with mod_expires off, EVERY one of these
# came back empty. Empty is the failure to watch for here, not a wrong number.
hashed="$(curl -sS "$SITE/" | grep -oE '/assets/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.js' | head -1)"
check_cc() { # path, grep pattern, description
  local cc
  cc="$(curl -sS -o /dev/null -D - "$SITE$1" | tr -d '\r' | grep -i '^cache-control:' | head -1)"
  if [ -z "$cc" ]; then bad "$1 has NO Cache-Control  ($3)"
  elif printf '%s' "$cc" | grep -qi "$2"; then ok "$1 $cc"
  else bad "$1 $cc  (expected $3)"; fi
}
[ -n "$hashed" ] && check_cc "$hashed" 'immutable' 'immutable — the filename is content-hashed' \
  || warn "could not find a hashed asset in the HTML to check"
check_cc /logo.png       'max-age=2592000' '30 days — fixed name, so never immutable'
check_cc /sitemap.xml    'max-age='        'a max-age, so caches stop guessing'
check_cc /robots.txt     'max-age='        'a max-age, so caches stop guessing'
check_cc /config.js      'no-cache\|no-store' 'no-cache — it is edited in place on the server'
check_cc /knet/pay.php   'no-store'        'no-store — payment responses are never cached'

bold "6. Cookies (the site should set none; any that appear must be hardened)"
sc="$(printf '%s' "$HDRS" | grep -i '^set-cookie:')"
if [ -z "$sc" ]; then ok "no cookies set on / — nothing to consent to"
else
  printf '%s\n' "$sc" | while IFS= read -r line; do
    miss=""
    printf '%s' "$line" | grep -qi ';[[:space:]]*secure'     || miss="$miss Secure"
    printf '%s' "$line" | grep -qi ';[[:space:]]*samesite='  || miss="$miss SameSite"
    if [ -z "$miss" ]; then ok "$line"
    else bad "$line  (missing:$miss)"; fi
  done
fi

bold "7. 404 handling (a made-up URL must NOT answer 200)"
for path in /this-page-does-not-exist-12345 /shop/nope-9876; do
  c="$(curl -sS -o /dev/null -w '%{http_code}' "$SITE$path")"
  [ "$c" = 404 ] && ok "$path -> 404" || bad "$path -> $c  (soft 404: wastes crawl budget)"
done

bold "8. Sensitive paths (all should be 403 or 404 — never 200)"
# Every path here has either been found in this account's live web root or is
# the shape of one that was. See SERVER-LAYOUT.md.
for path in /.git/config /.env /.htaccess /package.json /config.php /.DS_Store \
            /knet/config.php /pay/config.php /pay/cbk.php /pay/.cbk_token.json \
            /knet.log /knet-payments.log /sporta-dist.zip /sporta-deploy.php \
            /deploy.config.json /.deploy-manifest.json /README-knet.md; do
  c="$(curl -sS -o /dev/null -w '%{http_code}' "$SITE$path" 2>/dev/null)"; [ -n "$c" ] || c=000
  if [ "$c" = 200 ]; then bad "$path -> 200  ***EXPOSED***"
  elif [ "$c" = 000 ]; then warn "$path -> could not connect (NOT a pass)"
  else ok "$path -> $c"; fi
done

# The old PHP site's front controller. DirectoryIndex stops it answering "/",
# but /index.php itself answered 200 with the whole old site until a 301 was
# added — a second indexable homepage, and old PHP being executed. The 301 fires
# before the handler, so the file never runs. It should still be deleted.
c="$(curl -sS -o /dev/null -w '%{http_code}' "$SITE/index.php")"
case "$c" in
  301|302) ok "/index.php -> $c (redirected, PHP never executed)" ;;
  200)     bad "/index.php -> 200  ***THE OLD SITE IS LIVE AT THIS URL***" ;;
  *)       ok "/index.php -> $c (gone — best)" ;;
esac

# …and the mobile app's endpoint must NOT have been caught by that rule.
c="$(curl -sS -o /dev/null -w '%{http_code}' "$SITE/knet/api/index.php")"
if [ "$c" = 301 ]; then bad "/knet/api/index.php -> 301  (the index.php rule is too broad)"
else ok "/knet/api/index.php -> $c  (mobile API still routed)"; fi

# A dotfile inside a folder that has its own RewriteEngine. The root's rewrite
# deny does NOT reach there — proved under Apache — so this checks the
# name-based <FilesMatch>, which does.
for path in /knet/.htaccess /pay/.htaccess /cats/.DS_Store; do
  c="$(curl -sS -o /dev/null -w '%{http_code}' "$SITE$path" 2>/dev/null)"; [ -n "$c" ] || c=000
  if [ "$c" = 200 ]; then bad "$path -> 200  ***EXPOSED*** (subdirectory deny not applying)"
  elif [ "$c" = 000 ]; then warn "$path -> could not connect (NOT a pass)"
  else ok "$path -> $c"; fi
done

bold "9. Directory listings (a folder with no index must not enumerate)"
for path in /cats/ /cats/mobile/ /fonts/ /assets/; do
  body="$(curl -sS -m 10 "$SITE$path" 2>/dev/null | head -c 400)"
  if printf '%s' "$body" | grep -qi 'index of'; then bad "$path lists its contents  ***EXPOSED***"
  elif [ -z "$body" ]; then warn "$path -> empty response (NOT a pass)"
  else ok "$path does not list"; fi
done

bold "10. SEO endpoints"
for path in /robots.txt /sitemap.xml /llms.txt; do
  c="$(curl -sS -o /dev/null -w '%{http_code}' "$SITE$path")"
  [ "$c" = 200 ] && ok "$path -> 200" || bad "$path -> $c"
done

bold "11. TLS — certificate, chain and protocol versions"
# openssl, not curl: curl tells you the handshake worked, openssl tells you
# WHAT it agreed to. Both matter — a cert that verifies today can still be
# three weeks from expiry, and a server that speaks TLS 1.0 still fails a PCI
# scan even though every browser negotiated 1.3.
if command -v openssl >/dev/null 2>&1; then
  cert="$(echo | openssl s_client -servername "$HOST" -connect "$HOST:443" 2>/dev/null | openssl x509 -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null)"
  if [ -n "$cert" ]; then
    printf '%s\n' "$cert" | sed 's/^/    /'
    end="$(printf '%s\n' "$cert" | sed -n 's/^notAfter=//p')"
    if [ -n "$end" ]; then
      ends=$(date -j -f "%b %d %T %Y %Z" "$end" +%s 2>/dev/null || date -d "$end" +%s 2>/dev/null)
      now=$(date +%s)
      if [ -n "$ends" ]; then
        days=$(( (ends - now) / 86400 ))
        if   [ "$days" -lt 0 ];  then bad "certificate EXPIRED $(( -days )) days ago"
        elif [ "$days" -lt 14 ]; then bad "certificate expires in $days days — renew now"
        elif [ "$days" -lt 30 ]; then ok "certificate expires in $days days (renewal window)"
        else ok "certificate valid for $days more days"; fi
      fi
    fi
    # The name actually has to cover the canonical host.
    if printf '%s\n' "$cert" | grep -q "DNS:$HOST"; then ok "certificate covers $HOST"
    else bad "certificate does NOT list $HOST in subjectAltName"; fi
  else
    bad "could not read the certificate with openssl"
  fi

  # Old protocols must be refused. A success here is a FAILED connection.
  for proto in tls1 tls1_1; do
    if echo | openssl s_client -"$proto" -connect "$HOST:443" >/dev/null 2>&1; then
      bad "server still accepts ${proto} — deprecated, and a PCI finding"
    else
      ok "${proto} refused"
    fi
  done
  for proto in tls1_2 tls1_3; do
    if echo | openssl s_client -"$proto" -connect "$HOST:443" >/dev/null 2>&1; then
      ok "${proto} accepted"
    else
      bad "${proto} NOT accepted — modern clients expect it"
    fi
  done
else
  printf '  openssl not installed — skipping certificate detail.\n'
fi

bold "12. HTTP/3 (QUIC)"
# HTTP/3 is the HOST'"'"'s to enable, not something .htaccess can turn on. What a
# site controls is whether it ADVERTISES it, via the Alt-Svc header. A browser
# uses HTTP/2 on the first visit either way and only upgrades once it has seen
# that header, so "no Alt-Svc" means nobody ever gets h3, however well the
# server supports it.
altsvc="$(curl -sSI "$SITE/" | tr -d "\r" | grep -i "^alt-svc:" || true)"
if [ -n "$altsvc" ]; then
  ok "advertised: $altsvc"
else
  printf "  \033[33m•\033[0m no Alt-Svc header — the server is not advertising HTTP/3.\n"
  printf "    On Hostinger this is a hosting-side setting (LiteSpeed/QUIC or the\n"
  printf "    Cloudflare layer), not something public_html/.htaccess can switch on.\n"
fi
if curl --version | grep -q HTTP3; then
  h3="$(curl -sS --http3 -o /dev/null -w "%{http_version}" "$SITE/" 2>/dev/null || echo "failed")"
  [ "$h3" = "3" ] && ok "a real HTTP/3 request succeeded" || bad "--http3 did not negotiate h3 (got: $h3)"
else
  printf "  this curl has no HTTP/3 support, so h3 was not dialled directly.\n"
  printf "    macOS system curl usually lacks it: brew install curl, then use\n"
  printf "    /opt/homebrew/opt/curl/bin/curl --http3 %s/\n" "$SITE"
fi

bold "13. robots.txt and the sitemaps, read and checked"
robots="$(curl -sS "$SITE/robots.txt")"
# NO DATA IS NOT A PASS. Every check below counts things; if robots.txt did not
# come back, the counts are all zero and "0 of 0" reads as success. A scanner
# that goes green when it cannot see is worse than no scanner.
if [ -z "$robots" ] || ! printf '%s\n' "$robots" | grep -qi "^User-agent:"; then
  bad "robots.txt is empty or is not a robots file — nothing below could be checked"
  robots=""
fi
printf '%s\n' "$robots" | grep -qi "^Sitemap: $SITE/sitemap.xml" \
  && ok "robots.txt points at $SITE/sitemap.xml" \
  || bad "robots.txt does not declare the sitemap at the canonical origin"
[ -n "$robots" ] && for d in /backends /knet/ /pay/; do
  # Every group must carry the Disallow, not just the wildcard one: a crawler
  # obeys ONE group and does not fall back to *.
  groups="$(printf '%s\n' "$robots" | grep -ci "^User-agent:")"
  hits="$(printf '%s\n' "$robots" | grep -c "^Disallow: $d")"
  if [ "$groups" -eq 0 ]; then bad "no User-agent groups found — cannot check Disallow: $d"
  elif [ "$hits" -ge "$groups" ]; then ok "Disallow: $d present in all $groups group(s)"
  else bad "Disallow: $d in only $hits of $groups group(s) — the rest may crawl it"; fi
done
# Every <loc> in every sitemap must be on the canonical origin and answer 200.
maps="$(curl -sS "$SITE/sitemap.xml" | grep -o "<loc>[^<]*</loc>" | sed "s|</*loc>||g")"
[ -n "$maps" ] && ok "sitemap index lists $(printf '%s\n' "$maps" | wc -l | tr -d ' ') sitemap(s)" \
               || bad "sitemap index is empty or unreadable"
total=0; bad404=0; offorigin=0
for m in $maps; do
  for loc in $(curl -sS "$m" | grep -o "<loc>[^<]*</loc>" | sed "s|</*loc>||g"); do
    total=$((total+1))
    case "$loc" in "$SITE"*) ;; *) offorigin=$((offorigin+1)); printf "    off-origin: %s\n" "$loc";; esac
    c="$(curl -sS -o /dev/null -w '%{http_code}' "$loc")"
    [ "$c" = 200 ] || { bad404=$((bad404+1)); printf "    %s -> %s\n" "$loc" "$c"; }
  done
done
if [ "$total" -eq 0 ]; then
  bad "no <loc> entries were read from any sitemap — the two checks below prove nothing"
else
  [ "$offorigin" = 0 ] && ok "all $total sitemap URLs are on $SITE" || bad "$offorigin sitemap URL(s) point off-origin"
  [ "$bad404" = 0 ]    && ok "all $total sitemap URLs return 200"   || bad "$bad404 sitemap URL(s) do not return 200"
fi

bold "14. Response time (5 samples, total seconds)"
for i in 1 2 3 4 5; do
  printf '  %s\n' "$(curl -sS -o /dev/null -w 'connect=%{time_connect}s  ttfb=%{time_starttransfer}s  total=%{time_total}s' "$SITE/")"
done

printf '\nDone. Anything marked \033[31m✗\033[0m is worth fixing.\n'
