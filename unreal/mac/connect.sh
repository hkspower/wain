#!/usr/bin/env bash
# Connect this Unreal project to the web build, on a Mac.
#
#   unreal/mac/connect.sh              check the link and generate the Xcode project
#   unreal/mac/connect.sh --check      check only, generate nothing
#   unreal/mac/connect.sh --url http://192.168.1.20:3000
#
# WHY A SCRIPT AND NOT A PARAGRAPH
#
# GRNApi is built to fall back: if it cannot reach the server it logs a
# warning and plays on with the tables baked into GRNTypes.h. So a Mac
# that cannot reach the server does not fail — it plays a slightly older
# game, silently. Everything below is an attempt to find that out BEFORE
# Unreal has a chance to swallow it, in the order the things actually go
# wrong:
#
#   1. Is the engine even installed, and where.
#   2. Can this Mac reach the server at all — curl says so in plain text.
#   3. Does the payload agree with what the connector expects.
#   4. Then, and only then, generate the Xcode project.
#
# Written for bash 3.2, which is what macOS ships. No arrays of arrays,
# no ${var,,}, nothing from bash 4.
set -u

URL="${GRN_API:-http://localhost:3000}"
HUB="${GRN_HUB:-http://localhost:8787}"
CHECK_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --hub) HUB="$2"; shift 2 ;;
    --check) CHECK_ONLY=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
URL="${URL%/}"
HUB="${HUB%/}"

HERE="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$HERE/GulfRoadNights.uproject"
fail=0
say() { printf '  %-12s %s\n' "$1" "$2"; }
bad() { printf '  %-12s %s\n' "$1" "$2"; fail=$((fail + 1)); }

echo "Night Racer — Unreal connector, macOS"
echo

# ---- 0. This is a Mac ------------------------------------------------
if [ "$(uname -s)" != "Darwin" ]; then
  say "platform" "$(uname -s), not macOS — the checks below still work, the Xcode step does not"
else
  say "platform" "macOS $(sw_vers -productVersion 2>/dev/null) on $(uname -m)"
fi

[ -f "$PROJECT" ] || { bad "project" "no GulfRoadNights.uproject at $PROJECT"; exit 1; }
say "project" "$PROJECT"

# ---- 1. Where is the engine -----------------------------------------
#
# UnrealBuildTool lives at a different path in every install, and the
# common failure is not "it is missing" but "there are two and you are
# using the other one". So this reports the path it found rather than
# just succeeding.
WANT_VER="$(sed -n 's/.*"EngineAssociation"[^"]*"\([^"]*\)".*/\1/p' "$PROJECT")"
UE=""
for candidate in \
  "/Users/Shared/Epic Games/UE_${WANT_VER}" \
  "/Applications/Epic Games/UE_${WANT_VER}" \
  "$HOME/UnrealEngine" ; do
  [ -d "$candidate" ] && UE="$candidate" && break
done
if [ -z "$UE" ]; then
  bad "engine" "no Unreal ${WANT_VER} found in the usual places — set UE_ROOT and re-run"
  [ -n "${UE_ROOT:-}" ] && UE="$UE_ROOT" && fail=$((fail - 1)) && say "engine" "using UE_ROOT=$UE"
else
  say "engine" "$UE  (project asks for ${WANT_VER})"
fi

# ---- 2. Can this machine reach the server ----------------------------
#
# The whole point. curl is not subject to App Transport Security and
# Unreal is, so a green line here and a red GRN.Api.Status in the game
# means ATS — see unreal/Build/Mac/Resources/Info-ATS.plist.
CODE="$(curl -s -o /tmp/grn-gamedata.$$ -w '%{http_code}' -m 10 "$URL/api/grn/v1/gamedata" 2>/dev/null)"
if [ "$CODE" = "200" ]; then
  BYTES=$(wc -c < /tmp/grn-gamedata.$$ | tr -d ' ')
  say "data api" "$URL answered 200, ${BYTES} bytes"
else
  bad "data api" "$URL answered '${CODE:-nothing}' — start it with: npm run dev"
fi

HUBCODE="$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$HUB/api/v1/leaderboard" 2>/dev/null)"
if [ "$HUBCODE" = "200" ]; then
  say "hub" "$HUB answered 200"
else
  say "hub" "$HUB is not answering — laps and cloud careers will be off, the game still runs"
fi

# ---- 3. Does the payload agree with the connector --------------------
#
# Delegated, because the comparison lives in one place and this is not
# it. Needs node; if the Mac has not got the repo's node_modules that is
# fine, the check has no dependencies.
if [ "$CODE" = "200" ] && command -v node >/dev/null 2>&1; then
  if node "$HERE/../scripts/check-unreal-connector.mjs" --url "$URL" --hub "$HUB" >/tmp/grn-conn.$$ 2>&1; then
    say "contract" "the connector's fields and version match this server"
  else
    bad "contract" "the payload does not match what GRNApi expects:"
    sed 's/^/               /' /tmp/grn-conn.$$ | tail -12
  fi
  rm -f /tmp/grn-conn.$$
elif [ "$CODE" = "200" ]; then
  say "contract" "skipped — no node on PATH; run: npm run check:connector -- --url $URL"
fi
rm -f /tmp/grn-gamedata.$$

# ---- 4. The Xcode project -------------------------------------------
if [ "$CHECK_ONLY" = "1" ]; then
  echo
  echo "  --check given, stopping before the Xcode step."
elif [ "$(uname -s)" = "Darwin" ] && [ -n "$UE" ]; then
  GPF="$UE/Engine/Build/BatchFiles/Mac/GenerateProjectFiles.sh"
  if [ -x "$GPF" ]; then
    echo
    echo "  generating the Xcode project…"
    "$GPF" -project="$PROJECT" -game -rocket -progress || bad "xcode" "GenerateProjectFiles failed"
  else
    bad "xcode" "no GenerateProjectFiles.sh at $GPF"
  fi
fi

echo
if [ "$fail" -gt 0 ]; then
  echo "  $fail problem(s). The game will still RUN with any of these — it falls back to"
  echo "  the tables baked into GRNTypes.h and says so. Ask it which it used with:"
  echo "      GRN.Api.Status        (Unreal console; the tilde key opens it in PIE)"
  exit 1
fi
echo "  The connector can reach $URL and agrees with it."
echo "  Open GulfRoadNights.xcworkspace, or run the editor with:"
echo "      -grnapi=$URL -grnhub=$HUB"
