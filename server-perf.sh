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
#   connect     - namelookup          TCP handshake == ONE ROUND TRIP (the RTT)
#   appconnect  - connect             TLS handshake
#   starttransfer - appconnect        request out + server work + response back
#   total       - starttransfer       download
#
# THE SUBTLETY THAT MAKES OR BREAKS THIS REPORT: starttransfer-appconnect is
# NOT server think time. The request still has to fly to the server and the
# first byte fly back, so it contains one full round trip. On a 190ms link that
# is 190ms of pure travel booked as if the host were busy — and an early version
# of this script reported exactly that, blaming a server that was doing nothing.
#
# The TCP handshake is itself one round trip, so it measures the RTT directly.
# Subtracting it leaves the server's ACTUAL work:
#
#   rtt         = connect - namelookup
#   server real = (starttransfer - appconnect) - rtt
#
# A static file should land at ~0ms of real work. Anything above ~50ms is the
# server genuinely doing something — rewrite processing, PHP, or slow disk.
bold "Where the time goes (${SAMPLES} samples, new connection each)"
printf '  %-5s %8s %8s %8s %9s %9s %9s\n' "run" "dns" "tcp" "tls" "srv-real" "download" "TOTAL"

tot_dns=0; tot_tcp=0; tot_tls=0; tot_srv=0; tot_dl=0; tot_all=0
for i in $(seq 1 "$SAMPLES"); do
  # Cache-buster so an edge cache cannot answer for the origin.
  read -r nl cn ac st tt <<<"$(curl -sS -o /dev/null \
    -w '%{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total}' \
    -H 'Cache-Control: no-cache' -m 30 "$SITE/?_perf=$i$$" 2>/dev/null)"
  [ -n "$tt" ] || continue
  # awk does the subtraction; bash cannot do floating point.
  # srv is RTT-CORRECTED (see the note above) and clamped at 0 — a negative
  # would only mean the RTT estimate was noisy, never that time ran backwards.
  read -r dns tcp tls srv dl rtt <<<"$(awk -v nl="$nl" -v cn="$cn" -v ac="$ac" -v st="$st" -v tt="$tt" \
    'BEGIN{ r=cn-nl; s=st-(ac>0?ac:cn)-r; if(s<0)s=0;
            printf "%.3f %.3f %.3f %.3f %.3f %.3f", nl, cn-nl, (ac>0?ac-cn:0), s, tt-st, r}')"
  printf '  %-5s %7ss %7ss %7ss %8ss %8ss %8ss\n' "$i" "$dns" "$tcp" "$tls" "$srv" "$dl" "$tt"
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
printf '  TCP        %ss   (== your round-trip time to the origin)\n' "$a_tcp"
printf '  TLS        %ss\n' "$a_tls"
printf '  SERVER     %ss   <-- REAL work, one round trip already subtracted\n' "$a_srv"
printf '  download   %ss\n' "$a_dl"
printf '  TOTAL      %ss\n' "$a_all"
# Round trips are the hidden cost on a long link: TCP, TLS and the request
# itself are each one, before a byte of content moves.
awk -v r="$a_tcp" 'BEGIN{ if(r>0.05) printf "\n  At %.0fms RTT you pay ~%.2fs in round trips alone, before any content.\n", r*1000, r*3 }'

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
  SERVER)   bad  "SERVER owns it (${secs}s of REAL work, travel already subtracted) — on a static file that should be ~0. Suspect .htaccess rewrite processing, PHP touching the request, or slow disk." ;;
  DOWNLOAD) warn "DOWNLOAD owns it (${secs}s) — payload size. Check compression below before blaming bandwidth." ;;
esac
awk -v s="$a_srv" 'BEGIN{ if(s>0.05) printf "  (%.0fms of real work on a static file is worth chasing; ~0ms is normal.)\n", s*1000 }'
# Round trips often out-rank every single phase without owning any one of them.
awk -v r="$a_tcp" -v l="$a_tls" -v t="$a_all" 'BEGIN{ h=r+l; if(t>0 && h > t*0.4)
  printf "  \033[33m!\033[0m Handshakes (TCP+TLS) are %.0f%% of the total — HTTP/3 merges them into one, and a CDN moves them nearer.\n", h/t*100 }'
fi

# ------------------------------------------------------- what a browser gets
# Every sample above opened a FRESH connection, which is the worst case and not
# what a real visitor experiences: a browser pays the TCP+TLS handshake once and
# then reuses that connection for the HTML, the CSS, the JS and the images.
# Reporting only cold numbers overstates what the site actually feels like, so
# measure the reused case too — several URLs down one connection.
bold "With connection reuse (what a real browser gets)"
# ONE -o PER URL. curl applies -o positionally, so a single -o /dev/null covers
# only the FIRST url and the rest of the bodies land on stdout — which this
# script then parsed as if they were timings, printing "TTFB Disallow:s" a
# hundred times. Found by running it, not by reading it.
reuse="$(curl -sS -w '%{time_starttransfer} %{time_total}\n' -m 40 \
  -o /dev/null "$SITE/" \
  -o /dev/null "$SITE/robots.txt" \
  -o /dev/null "$SITE/site.webmanifest" 2>/dev/null)"
n=0
while read -r st tt; do
  [ -n "$tt" ] || continue
  n=$((n+1))
  if [ "$n" = 1 ]; then printf '  request 1 (pays the handshake)  TTFB %ss\n' "$st"
  else printf '  request %s (connection reused)   TTFB %ss\n' "$n" "$st"; fi
done <<EOF
$reuse
EOF
printf '  \033[2mThe drop from request 1 to 2 is the handshake cost a browser pays only once.\033[0m\n'

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

# Headers can be argued with; bytes cannot. Ask for the main bundle twice —
# once accepting compression, once refusing it — and compare what arrives. If
# the two sizes match, nothing was compressed no matter what any header claims.
# This matters more than it sounds: an uncompressed response can cross TCP's
# initial congestion window (~14.6kB) and buy an extra round trip on top of the
# extra bytes, so it is paid for twice.
bundle="$(curl -sS -m 20 "$SITE/" 2>/dev/null | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)"
if [ -n "$bundle" ]; then
  bold "Bytes actually on the wire (${bundle})"
  cmp_on="$(curl -sS -o /dev/null -w '%{size_download}' -H 'Accept-Encoding: br, gzip' -m 30 "$SITE$bundle" 2>/dev/null)"
  cmp_off="$(curl -sS -o /dev/null -w '%{size_download}' -H 'Accept-Encoding: identity' -m 30 "$SITE$bundle" 2>/dev/null)"
  printf '  asking for compression: %s bytes\n  refusing compression:   %s bytes\n' "$cmp_on" "$cmp_off"
  awk -v a="$cmp_on" -v b="$cmp_off" 'BEGIN{
    if (a>0 && b>0 && a < b*0.9) printf "  \033[32m✓\033[0m compressed — %.0f%% smaller on the wire\n", (1-a/b)*100;
    else if (a>0 && b>0)         print "  \033[31m✗\033[0m NOT COMPRESSED — identical byte counts. This is the cheapest fix on the list.";
  }'
fi

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
