#!/usr/bin/env bash
# The live shop, checked with nothing but curl.
#
#   bash site-scan.sh                       # www.sporta.com.kw
#   bash site-scan.sh https://sporta.com.kw # somewhere else
#
# The full scan is scripts/site-scan.mjs, which drives a real browser and can
# therefore see rendering, console errors and layout. This one needs no Node,
# no npm and no install — it is for a Mac with a Terminal and nothing else, and
# it still covers the things that actually cost money: a leaked credential, a
# dead image on the home page, a bank dropin that answers when it should not.
#
# It only READS. No payment is submitted, nothing is posted, nothing signs in.
set -u
BASE="${1:-https://www.sporta.com.kw}"
BASE="${BASE%/}"
fails=0

say()  { printf '%-4s %s\n' "$1" "$2"; }
ok()   { say "ok" "$1"; }
bad()  { fails=$((fails+1)); say "FAIL" "$1"; }
note() { say "--" "$1"; }

code() { curl -s -o /dev/null -w '%{http_code}' -m 20 "$1"; }
body() { curl -s -m 20 "$1"; }

echo
echo "=== $BASE ==========================================="
echo

# --- it answers ---------------------------------------------------------
c=$(code "$BASE/")
[ "$c" = "200" ] && ok "the shop answers (200)" || bad "the shop answers ($c)"

# --- the apex and plain HTTP both end up at the canonical address --------
case "$BASE" in
  *//www.*)
    apex=$(echo "$BASE" | sed 's#//www\.#//#')
    loc=$(curl -s -o /dev/null -m 20 -w '%{redirect_url}' "$apex/")
    [ -n "$loc" ] && ok "the bare domain redirects ($apex -> $loc)" \
                  || bad "the bare domain does not redirect — $apex serves the shop twice"
    ;;
  *) note "apex redirect: not checked, this target has no www to drop" ;;
esac
# Only meaningful against the real domain: a local copy IS http, and asking it
# to redirect to https would be asking it to redirect to itself.
case "$BASE" in
  https://*)
    loc=$(curl -s -o /dev/null -m 20 -w '%{redirect_url}' "http://${BASE#https://}/")
    case "$loc" in
      https://*) ok "plain HTTP redirects to HTTPS ($loc)" ;;
      *)         bad "plain HTTP does NOT redirect to HTTPS (${loc:-no redirect})" ;;
    esac ;;
  *) note "http-to-https: not checked, this target is already plain http" ;;
esac

# --- nothing private is public ------------------------------------------
for pair in "/api/config.php|db_pass" "/pay/config.php|client_secret" \
            "/knet/config.php|resource_key" "/.git/config|\[core\]" "/.env|^[A-Z_]*="; do
  path="${pair%%|*}"; tell="${pair##*|}"
  out=$(body "$BASE$path")
  if echo "$out" | grep -qiE "$tell"; then bad "$path IS LEAKING"; else ok "$path gives nothing away"; fi
done

for d in /api/ /pay/ /knet/ /cats/ /hero/; do
  if body "$BASE$d" | grep -qiE "Index of|<title>Directory"; then
    bad "$d lists its files"
  else
    ok "$d does not list its files"
  fi
done

# --- the headers Apache is supposed to send -----------------------------
# APACHE SENDS THESE, NOT PHP. They live in public_html/.htaccess, and PHP's
# built-in server reads no .htaccess — so against a local copy every one of
# them reports missing and means nothing. Only a real https target can answer
# this question.
hdr=$(curl -sI -m 20 "$BASE/")
case "$BASE" in
  https://*) header_missing=bad ;;
  *) header_missing=note
     note "headers: not checked properly — .htaccess only applies on the real server" ;;
esac
for want in "strict-transport-security|HSTS" "x-content-type-options|nosniff" \
            "referrer-policy|Referrer-Policy" "content-security-policy|CSP"; do
  h="${want%%|*}"; name="${want##*|}"
  echo "$hdr" | grep -qi "^$h:" && ok "$name is set" || $header_missing "$name is missing"
done
echo "$hdr" | grep -qi '^x-powered-by:' && note "X-Powered-By is advertised: $(echo "$hdr" | grep -i '^x-powered-by:')" \
                                        || ok "X-Powered-By is not advertised"

# --- the catalogue -------------------------------------------------------
n=$(body "$BASE/api/api.php?r=products" | grep -o '"slug"' | wc -l | tr -d ' ')
[ "${n:-0}" -gt 0 ] && ok "the catalogue answers with $n products" || bad "the catalogue answered with no products"
c=$(code "$BASE/api/api.php?r=stock")
[ "$c" = "200" ] && ok "the stock endpoint answers (200)" || bad "the stock endpoint answers ($c)"

# --- the banks refuse an order that does not exist -----------------------
for pair in "/pay/pay.php|T-Pay" "/knet/pay.php|KNET"; do
  path="${pair%%|*}"; name="${pair##*|}"
  out=$(body "$BASE$path?trackid=SCANNOSUCHORDER&amount=0.100")
  c=$(code "$BASE$path?trackid=SCANNOSUCHORDER&amount=0.100")
  if echo "$out" | grep -qiE "AccessToken|<form"; then
    bad "$name built a payment for an order that does not exist ($c)"
  else
    ok "$name refuses an unknown order ($c)"
  fi
done

# --- the pictures the home page asks for ---------------------------------
# THE PLAIN NAME IS SUPPOSED TO 404 NOW, and this check had it backwards.
#
# The tile component asks for /cats/<crop>/<id>.jpg first and falls to a
# SECOND <picture> when that errors — and the second is the one carrying the
# webp sources and the `-rtl` Arabic composition. A rewrite used to bridge the
# first name onto art-<id>.jpg; it removed these 404s and, with them, webp and
# the Arabic frame. It is gone (see public_html/.htaccess), so what this must
# assert is that art-<id> is there, not that <id> is.
for id in men women accessories outlet; do
  a=$(code "$BASE/cats/mobile/art-$id.jpg")
  w=$(code "$BASE/cats/mobile/art-$id.webp")
  if [ "$a" = "200" ] && [ "$w" = "200" ]; then ok "/cats/mobile/art-$id: jpg and webp are both there"
  elif [ "$a" = "200" ]; then bad "/cats/mobile/art-$id.webp is $w — the tile falls back to the heavier jpeg"
  else bad "/cats/mobile/art-$id.jpg is $a (the tile has nothing to show)"; fi
done
# And the Arabic composition, which only the fallback path ever asks for.
for id in men; do
  r=$(code "$BASE/cats/mobile/art-$id-rtl.webp")
  if [ "$r" = "200" ]; then ok "/cats/mobile/art-$id-rtl.webp is there — Arabic gets its own frame"
  else bad "/cats/mobile/art-$id-rtl.webp is $r — Arabic falls back to the English composition"; fi
done

# --- what a crawler reads ------------------------------------------------
for pair in "/robots.txt|robots.txt" "/sitemap.xml|sitemap.xml" \
            "/favicon.ico|favicon" "/og-image.png|link-preview image"; do
  path="${pair%%|*}"; name="${pair##*|}"
  c=$(code "$BASE$path")
  [ "$c" = "200" ] && ok "$name answers (200)" || bad "$name answers ($c)"
done

# --- every page a customer can reach -------------------------------------
for page in / /shop /about /contact /track /returns /privacy /terms; do
  c=$(code "$BASE$page")
  [ "$c" = "200" ] && ok "$page serves 200" || bad "$page serves $c"
done

echo
[ "$fails" -eq 0 ] && echo "nothing failed" || echo "$fails failed"
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
