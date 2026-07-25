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
pass=0; fail=0
ok()   { printf "  ${grn}OK${off}    %-34s %s\n" "$1" "${2:-}"; pass=$((pass+1)); }
bad()  { printf "  ${red}FAIL${off}  %-34s %s\n" "$1" "${2:-}"; fail=$((fail+1)); }
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
  note "Only needed for 'npm run deploy'. The upload-the-zip route does not need it."
fi
command -v npm >/dev/null 2>&1 && ok "npm" "$(npm -v)" || bad "npm" "not installed"
command -v git >/dev/null 2>&1 && ok "git" "$(git --version | awk '{print $3}')" || bad "git" "not installed"

# ------------------------------------------------------------ the project
hdr "The Sporta project on this Mac"
found=$(find "$HOME" -maxdepth 5 -type d -name sporta-web -not -path "*/node_modules/*" 2>/dev/null | head -1)
if [ -n "$found" ]; then
  ok "project folder" "$found"
  [ -f "$found/.env" ] && ok ".env (Supabase keys)" "present" || {
    bad ".env (Supabase keys)" "missing"
    note "Without it a local build ships a store whose checkout refuses every order."
    note "Not needed if you use the zip + config.js route."; }
else
  bad "project folder" "not found under $HOME"
  note "That is why 'npm run deploy' gave ENOENT — npm must run inside it."
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
  if curl -s --max-time 12 "$SITE/config.js" 2>/dev/null | grep -q 'YOUR-PROJECT'; then
    bad "config.js edited" "still has the placeholders"
    note "Open public_html/config.js in File Manager and paste your Supabase URL + anon key."
  else
    ok "config.js edited" "real values present"
  fi
fi

# ------------------------------------------------------------------- ssh
hdr "SSH to Hostinger ($HOST:$PORT)"
port_open() {
  nc -z -G 5 "$1" "$2" >/dev/null 2>&1 && return 0
  nc -z -w 5 "$1" "$2" >/dev/null 2>&1 && return 0
  return 1
}
if port_open "$HOST" "$PORT"; then
  ok "port $PORT reachable" "the server is listening"

  # BatchMode: never prompts, so this cannot add to the failed-password count.
  out=$(ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new \
            -p "$PORT" "$USER_@$HOST" 'echo SHELL_OK; echo "$SHELL"' 2>&1)
  if printf '%s' "$out" | grep -q SHELL_OK; then
    ok "SSH key login" "works"
    if printf '%s' "$out" | grep -q nologin; then
      bad "interactive shell" "/sbin/nologin"
      note "Turn SSH on in hPanel -> Advanced -> SSH Access."
    else
      ok "interactive shell" "$(printf '%s' "$out" | tail -1)"
    fi
  elif printf '%s' "$out" | grep -qi 'permission denied'; then
    ok "SSH service answering" "auth required (no key installed yet)"
    note "Expected if you log in with a password. To stop typing it:"
    note "  ssh-keygen -t ed25519 && ssh-copy-id -p $PORT $USER_@$HOST"
    note "NOT run here on purpose — a wrong password adds to the failed-login count."
  else
    bad "SSH" "$(printf '%s' "$out" | head -1)"
  fi
else
  bad "port $PORT" "unreachable"
  note "Your network may block it, or SSH is off in hPanel. SFTP uses the same port."
fi

# ---------------------------------------------------------------- verdict
hdr "Summary"
printf "  %d passed, %d failed\n\n" "$pass" "$fail"
if [ "$fail" -eq 0 ]; then
  printf "  ${grn}Everything checked out.${off}\n"
else
  printf "  ${yel}Nothing above blocks going live by the zip route.${off}\n"
  printf "  Upload public_html/, edit config.js, run the 5 SQL files,\n"
  printf "  then open %s/go-live.html\n" "$SITE"
fi
