#!/usr/bin/env bash
# Sporta — Mac-side check.
#
# Run this in Terminal on your Mac. It tests everything the deploy path needs
# and says, in plain language, what works and what does not.
#
#   bash ~/Downloads/sporta-mac-check.sh
#
# Safe to run: nothing is installed, uploaded or deleted, and it never asks for
# or stores a password. The one thing it does write is the server's host key
# into ~/.ssh/known_hosts on first connect (StrictHostKeyChecking=accept-new),
# which is what any normal ssh login would do.
#
# The SSH probe deliberately uses BatchMode, so it can never send a wrong
# password — your account already had 24 failed attempts logged, and adding to
# that risks a lockout.

HOST=46.202.158.211
PORT=65002
USER_=u130124229
SITE=https://www.sporta.com.kw

bold=$(printf '\033[1m'); dim=$(printf '\033[2m'); off=$(printf '\033[0m')
grn=$(printf '\033[32m'); red=$(printf '\033[31m'); yel=$(printf '\033[33m')
cyn=$(printf '\033[36m')
pass=0; fail=0; offby=0
ok()   { printf "  ${grn}OK${off}    %-34s %s\n" "$1" "${2:-}"; pass=$((pass+1)); }
bad()  { printf "  ${red}FAIL${off}  %-34s %s\n" "$1" "${2:-}"; fail=$((fail+1)); }
# Deliberately switched off is not broken. Counting it as a failure would push
# someone to re-enable something they turned off for a good reason.
skip() { printf "  ${cyn}OFF${off}   %-34s %s\n" "$1" "${2:-}"; offby=$((offby+1)); }
note() { printf "        ${dim}%s${off}\n" "$1"; }
hdr()  { printf "\n${bold}%s${off}\n" "$1"; }

printf "${bold}Sporta — Mac check${off}\n"
printf "${dim}%s${off}\n" "$(date)"

# ---------------------------------------------------------------- your Mac
hdr "Your Mac"
ok "Terminal" "working — you are reading this"
printf "  ${grn}OK${off}    %-34s %s\n" "macOS" "$(sw_vers -productVersion 2>/dev/null || uname -sr)"
printf "  ${grn}OK${off}    %-34s %s\n" "shell" "$SHELL"

if command -v node >/dev/null 2>&1; then
  v=$(node -v); major=$(printf '%s' "$v" | sed 's/^v//' | cut -d. -f1)
  if [ "$major" -ge 22 ] 2>/dev/null; then ok "Node.js" "$v"
  else bad "Node.js" "$v — too old"; note "Vite 8 needs Node 22.12+. Install Node 24 LTS from nodejs.org."; fi
else
  bad "Node.js" "not installed"
  note "Only needed for 'npm run publish'. The upload-the-zip route does not need it."
fi
command -v npm >/dev/null 2>&1 && ok "npm" "$(npm -v)" || bad "npm" "not installed"
command -v git >/dev/null 2>&1 && ok "git" "$(git --version | awk '{print $3}')" || bad "git" "not installed"

# ------------------------------------------------------------ the project
hdr "The Sporta project on this Mac"
# SPORTA_DIR FIRST, because the setup script honours it and this did not — a
# checkout somewhere other than $HOME was reported "not found" while the very
# script that had just cloned it was calling this one. Then the checkout this
# file is sitting in, then a search of $HOME.
found=""
[ -n "${SPORTA_DIR:-}" ] && [ -d "$SPORTA_DIR/sporta-web" ] && found="$SPORTA_DIR/sporta-web"
if [ -z "$found" ]; then
  self="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)"
  [ -n "$self" ] && [ -f "$self/package.json" ] && found="$self"
fi
[ -z "$found" ] && found=$(find "$HOME" -maxdepth 5 -type d -name sporta-web -not -path "*/node_modules/*" 2>/dev/null | head -1)
if [ -n "$found" ]; then
  ok "project folder" "$found"
  [ -f "$found/.env.deploy" ] && ok ".env.deploy (FTPS credentials)" "present" || {
    note ".env.deploy is missing — only 'npm run publish' needs it."
    note "Not needed if you use the zip + File Manager route."; }
else
  bad "project folder" "not found under $HOME"
  note "That is why 'npm run publish' gave ENOENT — npm must run inside it."
  note "Use the zip route instead, or clone the repo first."
fi

# -------------------------------------------------------------- the site
hdr "Your website"
ip=$(dig +short www.sporta.com.kw 2>/dev/null | tail -1)
[ -z "$ip" ] && ip=$(nslookup www.sporta.com.kw 2>/dev/null | awk '/^Address: /{print $2}' | tail -1)
[ -n "$ip" ] && ok "DNS" "www.sporta.com.kw -> $ip" || bad "DNS" "does not resolve"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/" 2>/dev/null)
case "$code" in
  200) ok "site responds" "HTTP 200" ;;
  000) bad "site responds" "no answer"; note "Not uploaded yet, or DNS/TLS not ready." ;;
  *)   bad "site responds" "HTTP $code" ;;
esac

if [ "$code" = "200" ]; then
  for f in /config.js /go-live.html /knet/pay.php /sitemap.xml; do
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "$SITE$f" 2>/dev/null)
    if [ "$f" = "/knet/pay.php" ]; then
      # 400/404 here is CORRECT: no trackid was supplied, so pay.php refuses.
      if [ "$c" = "404" ] || [ "$c" = "400" ]; then
        ok "uploaded: $f" "HTTP $c (refusing, as it should)"
      else
        bad "uploaded: $f" "HTTP $c"
      fi
    elif [ "$c" = "200" ]; then
      ok "uploaded: $f" "HTTP $c"
    else
      bad "uploaded: $f" "HTTP $c"
    fi
  done
  if curl -s --max-time 12 "$SITE/api/api.php?r=products" 2>/dev/null | grep -q '"products"'; then
    ok "backend answering" "/api/api.php serves the catalogue"
  else
    bad "backend answering" "/api/api.php did not return a catalogue"
    note "Upload public_html/api/, create api/config.php, and import the SQL in phpMyAdmin."
  fi
fi

# ------------------------------------------------------------------- ftps
# SSH is off permanently, by the owner's choice, so this no longer probes it —
# a check that always fails teaches you to ignore the report. FTP is a separate
# Hostinger service and is what `npm run publish` actually uses.
# Resolve a hostname using whatever this machine actually has. The first version
# called host and nslookup and treated "command not found" as "no such
# hostname" — so on a box without them it confidently reported a perfectly good
# server as non-existent. If nothing can resolve, say so rather than guess.
#   0 = resolves    1 = no such name    2 = nothing here can tell
resolves() {
  if command -v dscacheutil >/dev/null 2>&1; then          # macOS, always present
    dscacheutil -q host -a name "$1" 2>/dev/null | grep -q ip_address
    return $?
  fi
  if command -v host     >/dev/null 2>&1; then host "$1"     >/dev/null 2>&1; return $?; fi
  if command -v dig      >/dev/null 2>&1; then [ -n "$(dig +short "$1" 2>/dev/null)" ]; return $?; fi
  if command -v nslookup >/dev/null 2>&1; then nslookup "$1" >/dev/null 2>&1; return $?; fi
  # getent exits 2 for "key not found", which would be read below as "cannot
  # check" and hide a genuinely wrong hostname. Collapse it to a plain 1.
  if command -v getent >/dev/null 2>&1; then
    getent hosts "$1" >/dev/null 2>&1 && return 0 || return 1
  fi
  return 2
}

port_open() {
  nc -z -G 5 "$1" "$2" >/dev/null 2>&1 && return 0
  nc -z -w 5 "$1" "$2" >/dev/null 2>&1 && return 0
  return 1
}

# SSH is off permanently, by the owner's choice, so this no longer probes it —
# a check that always fails teaches you to ignore the whole report. FTP is a
# separate Hostinger service and is what `npm run publish` actually uses.
hdr "FTPS upload path"
ftp_host="${FTP_HOST:-}"
ftp_port="${FTP_PORT:-21}"
if [ -z "$ftp_host" ]; then
  skip "FTP host" "not set"
  note "Read it from hPanel -> Files -> FTP Accounts, then:"
  note "  cd sporta-web && npm run ftp:doctor -- --write"
  note "Do NOT guess it: it is srv1814.hstgr.io. ftp.sporta.com.kw resolves but"
  note "its TLS certificate is for another name, so FTPS refuses it."
else
  resolves "$ftp_host"
  case $? in
    2) skip "DNS for $ftp_host" "nothing on this machine can resolve names — cannot check" ;;
    1) bad  "$ftp_host" "no DNS record — wrong hostname"
       note "Copy the hostname from hPanel exactly; do not guess it." ;;
    0) ok "$ftp_host" "resolves"
       if port_open "$ftp_host" "$ftp_port"; then
         ok "FTP port $ftp_port" "reachable — npm run publish can upload"
       else
         bad "FTP port $ftp_port on $ftp_host" "not answering"
         note "If every host you try is refused, your own network may block outbound FTP."
         note "A phone hotspot is the quickest way to tell."
       fi ;;
  esac
fi

# ---------------------------------------------------------------- verdict
hdr "Summary"
printf "  %d passed, %d failed, %d off by choice\n\n" "$pass" "$fail" "$offby"
if [ "$fail" -eq 0 ]; then
  printf "  ${grn}Nothing is broken.${off}\n\n"
else
  printf "  ${yel}%d item(s) above need attention.${off}\n\n" "$fail"
fi
printf "  Going live needs no terminal and no SSH:\n"
printf "    1. upload public_html/ in File Manager\n"
printf "    2. create api/config.php from api/config.example.php  (the 4 MySQL values)\n"
printf "    3. import api/install.mysql.sql in phpMyAdmin — ONE file, and that is\n"
# It said "ONE file" and then listed migrations to run after it, which is a
# contradiction the reader has to resolve by guessing. Verified from empty this
# session: a database created by importing only install.mysql.sql has all
# fourteen tables and takes a real order. The separate migrations still ship,
# for re-running one on purpose; they are not part of a normal install.
printf "       the whole database step. It carries every migration and the seed,\n"
printf "       in order, and is safe to re-run over an existing shop.\n"
printf "    4. create knet/config.php and pay/config.php from their examples\n"
printf "    5. add the cron jobs: cron-fulfilment.php (5 min), cron-stock.php (15 min)\n"
printf "    6. open %s/api/preflight.php — it names whatever is still wrong,\n" "$SITE"
printf "       one step at a time. Delete it when the page is green.\n"
