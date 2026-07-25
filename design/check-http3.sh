#!/usr/bin/env bash
# Check which HTTP version www.almuhallab-code.com actually negotiates.
# Run this from your own machine — protocol support comes from the server,
# so it can only be observed from outside.
set -u
HOST="${1:-www.almuhallab-code.com}"
URL="https://$HOST/"

echo "checking $URL"
echo

# ---- 1. Is HTTP/3 advertised? -------------------------------------------
# A server that speaks h3 advertises it in Alt-Svc on its HTTP/1.1 or /2 reply.
ALT=$(curl -sSI --max-time 15 "$URL" 2>/dev/null | tr -d '\r' | grep -i '^alt-svc:' || true)
if [ -n "$ALT" ]; then
  echo "advertised : $ALT"
  echo "$ALT" | grep -qi 'h3' && echo "             -> h3 is advertised" \
                              || echo "             -> Alt-Svc present but no h3"
else
  echo "advertised : no Alt-Svc header (server is not offering HTTP/3)"
fi
echo

# ---- 2. What does it actually negotiate? --------------------------------
NEG=$(curl -sS -o /dev/null -w '%{http_version}' --max-time 15 "$URL" 2>/dev/null || echo "?")
echo "negotiated : HTTP/$NEG  (default connection)"

if curl --http3 -V >/dev/null 2>&1 || curl -V | grep -q HTTP3; then
  H3=$(curl -sS --http3-only -o /dev/null -w '%{http_version}' --max-time 15 "$URL" 2>/dev/null || echo "failed")
  if [ "$H3" = "3" ]; then
    echo "forced h3  : HTTP/3 connection succeeded ✓"
  else
    echo "forced h3  : could not establish HTTP/3 ($H3)"
  fi
else
  echo "forced h3  : this curl has no HTTP/3 support — install curl with"
  echo "             ngtcp2/quiche, or test in Chrome DevTools → Network →"
  echo "             right-click the columns → enable 'Protocol' (shows h3)."
fi
echo

# ---- 3. Is UDP/443 even reachable? --------------------------------------
# HTTP/3 rides QUIC over UDP. Some networks silently drop UDP/443.
if command -v nc >/dev/null 2>&1; then
  nc -z -u -w 3 "$HOST" 443 >/dev/null 2>&1 \
    && echo "udp/443    : reachable" \
    || echo "udp/443    : no response (may be filtered — HTTP/3 cannot work)"
fi

cat <<'NOTE'

If h3 is not advertised, turn it on at the server — the site files are
protocol-agnostic and need no change:

  Hostinger   hPanel -> Advanced -> Server / LiteSpeed: enable QUIC (HTTP/3)
  Cloudflare  put the domain behind Cloudflare (free), Speed -> Optimization
              -> enable HTTP/3 (with QUIC). Easiest guaranteed route.
  Own server  see design/http3/ for ready nginx and Caddy configs.
NOTE
