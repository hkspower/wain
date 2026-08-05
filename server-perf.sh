#!/usr/bin/env bash
# Sporta — server performance probe.
#
# Run from your own machine (Claude's sandbox cannot reach the live host):
#
#   chmod +x server-perf.sh
#   ./server-perf.sh                          # against www.sporta.com.kw
#   ./server-perf.sh https://other.example    # any other origin
#
# WHY THIS EXISTS
# A single "TTFB 1.5s" tells you something is slow and nothing about what. The
# homepage is a STATIC file — no PHP, no database — so a slow first byte there
# is DNS, TCP, TLS or the server itself, and those four want very different
# fixes. curl already measures each phase; this just asks it to.
#
# It is read-only: GETs and one HEAD per asset. Nothing is written, no
# credentials are used, and it cannot trip fail2ban (that guards FTP/SSH auth,
# not HTTPS).
#
# Exit code is always 0 — a report, not a gate.

SITE="${1:-https://www.sporta.com.kw}"
SAMPLES="${SAMPLES:-5}"

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

# ---- Reachability gate ----------------------------------------------------
# Same rule as scan-server-response.sh: if the host never answered, every
# number below would be a fiction. Refuse rather than report zeros.
probe="$(curl -sS -o /dev/null -w '%{http_code}' -m 20 "$SITE/" 2>/dev/null)"
[ -n "$probe" ] || probe=000
if [ "$probe" = 000 ]; then
  printf '\n\033[31m✖ Cannot reach %s — DNS, TLS or the server.\033[0m\n' "$SITE"
  printf '  Nothing below would mean anything, so nothing was measured.\n\n'
  exit 0
fi

printf '\n==========================================================================\n'
printf 'SERVER PERFORMANCE — %s\n' "$SITE"
printf '==========================================================================\n'

# ---------------------------------------------------------------- phase split
# The whole point. Each phase is CUMULATIVE in curl's output, so the time spent
# IN a phase is that phase minus the one before it:
#
#   namelookup                        DNS
#   connect     - namelookup          TCP handshake (round trip to datacenter)
#   appconnect  - connect             TLS handshake
#   starttransfer - appconnect        SERVER THINK TIME  <-- the interesting one
#   total       - starttransfer       download
#
# A big namelookup is a DNS problem. A big connect is distance/routing. A big
# appconnect is TLS config. A big starttransfer on a STATIC file is the server
# being busy — shared-hosting contention, or no cache in front of it.
bold "Where the time goes (${SAMPLES} samples, cold-ish)"
printf '  %-6s %9s %9s %9s %9s %9s %9s\n' "run" "dns" "tcp" "tls" "server" "download" "TOTAL"

tot_dns=0; tot_tcp=0; tot_tls=0; tot_srv=0; tot_dl=0; tot_all=0
for i in $(seq 1 "$SAMPLES"); do
  # Cache-buster so an edge cache cannot answer for the origin.
  read -r nl cn ac st tt <<<"$(curl -sS -o /dev/null \
    -w '%{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total}' \
    -H 'Cache-Control: no-cache' -m 30 "$SITE/?_perf=$i$$" 2>/dev/null)"
  [ -n "$tt" ] || continue
  # awk does the subtraction; bash cannot do floating point.
  read -r dns tcp tls srv dl <<<"$(awk -v nl="$nl" -v cn="$cn" -v ac="$ac" -v st="$st" -v tt="$tt" \
    'BEGIN{printf "%.3f %.3f %.3f %.3f %.3f", nl, cn-nl, (ac>0?ac-cn:0), st-(ac>0?ac:cn), tt-st}')"
  printf '  %-6s %8ss %8ss %8ss %8ss %8ss %8ss\n' "$i" "$dns" "$tcp" "$tls" "$srv" "$dl" "$tt"
  tot_dns=$(awk -v a="$tot_dns" -v b="$dns" 'BEGIN{print a+b}')
  tot_tcp=$(awk -v a="$tot_tcp" -v b="$tcp" 'BEGIN{print a+b}')
  tot_tls=$(awk -v a="$tot_tls" -v b="$tls" 'BEGIN{print a+b}')
  tot_srv=$(awk -v a="$tot_srv" -v b="$srv" 'BEGIN{print a+b}')
  tot_dl=$(awk  -v a="$tot_dl"  -v b="$dl"  'BEGIN{print a+b}')
  tot_all=$(awk -v a="$tot_all" -v b="$tt"  'BEGIN{print a+b}')
done

bold "Average, and what owns the delay"
avg() { awk -v t="$1" -v n="$SAMPLES" 'BEGIN{printf "%.3f", t/n}'; }
a_dns=$(avg "$tot_dns"); a_tcp=$(avg "$tot_tcp"); a_tls=$(avg "$tot_tls")
a_srv=$(avg "$tot_srv"); a_dl=$(avg "$tot_dl");  a_all=$(avg "$tot_all")
printf '  DNS        %ss\n' "$a_dns"
printf '  TCP        %ss\n' "$a_tcp"
printf '  TLS        %ss\n' "$a_tls"
printf '  SERVER     %ss   <-- think time on a STATIC file\n' "$a_srv"
printf '  download   %ss\n' "$a_dl"
printf '  TOTAL      %ss\n' "$a_all"

# Name the culprit rather than leaving five numbers on screen.
#
# The largest phase is only worth naming if the request was actually SLOW.
# Picking the biggest slice unconditionally reported "SERVER owns it (0.002s)"
# against a local server answering in two milliseconds — a red cross on a
# perfect result. A verdict that cries wolf on a fast host is one nobody reads
# on a slow one, so the threshold comes first and the blame second.
bold "Verdict"
GOOD_TOTAL=0.30   # a first byte inside 300ms needs no explanation
if awk -v t="$a_all" -v g="$GOOD_TOTAL" 'BEGIN{exit !(t <= g)}'; then
  ok "${a_all}s total — nothing here needs fixing."
  awk -v p="$a_srv" 'BEGIN{ if(p>0.15) print "  (server think time is the largest slice, but it is small in absolute terms.)" }'
  phase=NONE
else
biggest="$(awk -v d="$a_dns" -v t="$a_tcp" -v l="$a_tls" -v s="$a_srv" -v w="$a_dl" 'BEGIN{
  m=d; n="DNS";
  if(t>m){m=t;n="TCP"} if(l>m){m=l;n="TLS"} if(s>m){m=s;n="SERVER"} if(w>m){m=w;n="DOWNLOAD"}
  print n" "m}')"
set -- $biggest
phase="$1"; secs="$2"
case "$phase" in
  DNS)      warn "DNS owns it (${secs}s) — slow resolver or no DNS caching. Try a different resolver; consider Cloudflare DNS for the domain." ;;
  TCP)      warn "TCP owns it (${secs}s) — physical distance/routing to the datacenter. A CDN in front is the only real fix." ;;
  TLS)      warn "TLS owns it (${secs}s) — handshake cost. Check TLS 1.3 and session resumption are on; HTTP/3 helps here." ;;
  SERVER)   bad  "SERVER owns it (${secs}s) — the host took this long to hand back a STATIC file. That is not your code: it is shared-hosting CPU contention, no LiteSpeed/LSCache in front, or an underpowered plan." ;;
  DOWNLOAD) warn "DOWNLOAD owns it (${secs}s) — bandwidth or payload size." ;;
esac
awk -v s="$a_srv" 'BEGIN{ if(s>0.6) print "  (>0.6s of static think time is the single biggest win available.)" }'
fi

# ------------------------------------------------------------------ warm/cold
# If the second hit is much faster, something in front IS caching. If it is the
# same, nothing is — which on a static file is the finding.
bold "Cold vs warm (same URL twice)"
c1="$(curl -sS -o /dev/null -w '%{time_starttransfer}' -m 30 "$SITE/?_cold=$$" 2>/dev/null)"
c2="$(curl -sS -o /dev/null -w '%{time_starttransfer}' -m 30 "$SITE/?_cold=$$" 2>/dev/null)"
printf '  first  %ss\n  second %ss\n' "$c1" "$c2"
awk -v a="$c1" -v b="$c2" 'BEGIN{
  if (a>0 && b < a*0.6) print "  \033[32m✓\033[0m the second hit is much faster — something in front is caching";
  else print "  \033[33m!\033[0m no real speed-up — nothing is caching this in front of the origin";
}'

# --------------------------------------------------------------- capabilities
# The two that decide whether the host is serving at its best, and neither is
# set in .htaccess — both are hPanel/server toggles.
bold "Is the host serving at full capability?"
proto="$(curl -sS -o /dev/null -w '%{http_version}' -m 20 "$SITE/" 2>/dev/null)"
case "$proto" in
  3*) ok   "HTTP/3 (QUIC) — best case" ;;
  2*) warn "HTTP/2 — working, but HTTP/3 is a hPanel/server toggle worth enabling" ;;
  *)  bad  "HTTP/$proto — no HTTP/2 or /3. Enable in hPanel; this is a server setting, not .htaccess" ;;
esac

enc="$(curl -sS -o /dev/null -D - -H 'Accept-Encoding: br, gzip' -m 20 "$SITE/" 2>/dev/null \
       | tr -d '\r' | awk -F': ' 'tolower($1)=="content-encoding"{print tolower($2)}')"
case "$enc" in
  *br*)   ok   "Brotli — best case" ;;
  *gzip*) warn "gzip only — Brotli is ~15-20% smaller. On LiteSpeed the mod_brotli block in .htaccess does NOT apply; enable compression server-side" ;;
  *)      bad  "no compression on the HTML — the single cheapest fix available" ;;
esac

srv="$(curl -sS -o /dev/null -D - -m 20 "$SITE/" 2>/dev/null | tr -d '\r' \
      | awk -F': ' 'tolower($1)=="server"{print $2}')"
printf '  server header: %s\n' "${srv:-<none>}"
case "$(printf '%s' "$srv" | tr 'A-Z' 'a-z')" in
  *litespeed*) ok "LiteSpeed — enable LSCache in hPanel if it is not already on" ;;
  *apache*)    warn "Apache — Hostinger's faster plans run LiteSpeed; worth asking why this is Apache" ;;
esac

# ----------------------------------------------------------- the API (dynamic)
# Unlike /, this one really does execute PHP and hit MySQL. Comparing it with
# the static number separates "the host is slow" from "the database is slow".
bold "Static vs dynamic (is it the host, or the database?)"
sfil="$(curl -sS -o /dev/null -w '%{time_starttransfer}' -m 30 "$SITE/robots.txt" 2>/dev/null)"
api="$(curl -sS -o /dev/null -w '%{time_starttransfer}' -m 30 "$SITE/api/api.php?r=products" 2>/dev/null)"
acode="$(curl -sS -o /dev/null -w '%{http_code}' -m 30 "$SITE/api/api.php?r=products" 2>/dev/null)"
printf '  /robots.txt (pure static)   %ss\n' "$sfil"
printf '  /api ?r=products (PHP+SQL)  %ss   [HTTP %s]\n' "$api" "$acode"
awk -v s="$sfil" -v a="$api" 'BEGIN{
  if (a>0 && s>0 && a > s*2) print "  \033[33m!\033[0m the API costs much more than a static file — PHP/MySQL is adding real time";
  else if (a>0 && s>0)       print "  \033[32m✓\033[0m the API is close to a static file — the delay is the HOST, not your queries";
}'

printf '\nDone. Read the Verdict line — that is the one worth acting on.\n\n'
exit 0
