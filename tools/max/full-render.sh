#!/usr/bin/env bash
# Every car, start to finish, on this machine: fresh GLBs out of the
# running game, a render pack per car, the pack rendered in Cycles at its
# full size, graded, and published where git keeps renders.
#
#   npm run dev                       # in another shell: export boots the game
#   tools/max/full-render.sh          # everything; resumable, run it again after a stop
#   tools/max/full-render.sh --stills # no turntables
#   TT_SCALE=1 tools/max/full-render.sh   # turntables at the pack's full 1920x1080 (four times the time)
#
# This is the Cycles stand-in for the 3ds Max batch (tools/max/render_all.py
# runs the same packs through Arnold on a machine that has Max). The two
# produce the same folders, graded the same way by finish_render.py, so a
# Max render and this one are compared like for like.
#
# Steps, each resumable:
#   1 export    node tools/shots/export-cars.mjs       every car, 10-15 min
#   2 pack      render_pack.py --car all                a minute a car
#   3 stills    preview_render.py, 2560x1440 @ 128 spp  a few minutes a shot, three a car
#   4 turntable preview_render.py, 120 frames           half size by default: about half an hour a car
#   5 finish    finish_render.py --publish              ACES PNGs, sheets, MP4s -> press/renders/max/
# A still or frame already rendered since its pack was made is not rendered
# again, so a stopped run picks up where it was. Logs: press/max/render/full-render.log.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
cd "$REPO"
ROOT=press/max/render
STILLS_ONLY=0
for a in "$@"; do case "$a" in --stills) STILLS_ONLY=1 ;; *) echo "full-render.sh: unknown option $a" >&2; exit 2 ;; esac; done
SAMPLES="${SAMPLES:-128}"
TT_SAMPLES="${TT_SAMPLES:-32}"
TT_SCALE="${TT_SCALE:-0.5}"
PUBLISH="${PUBLISH:-press/renders/max}"
mkdir -p "$ROOT"
LOG="$ROOT/full-render.log"
say() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LOG"; }
step() {  # name, command...
  local name="$1"; shift
  say "== $name"
  if "$@" >> "$LOG" 2>&1; then say "   $name done"; else say "   $name FAILED (exit $?) — see $LOG"; return 1; fi
}

say "full render: samples $SAMPLES, turntables $([ "$STILLS_ONLY" = 1 ] && echo off || echo "x$TT_SCALE @ $TT_SAMPLES spp"), publish -> $PUBLISH"
if ! curl -s -o /dev/null --max-time 5 http://localhost:3000/race; then
  say "the web build is not running: in another shell, from $REPO, run  npm run dev"; exit 1
fi
step "export GLBs" node tools/shots/export-cars.mjs || exit 1
step "render packs" python3 tools/max/render_pack.py --car all || exit 1
step "stills" python3 tools/max/preview_render.py "$ROOT" --samples "$SAMPLES" --scale 1 --skip-existing || true
if [ "$STILLS_ONLY" != 1 ]; then
  step "turntables" python3 tools/max/preview_render.py "$ROOT" --shots "" --turntable \
    --tt-scale "$TT_SCALE" --tt-samples "$TT_SAMPLES" --skip-existing || true
fi
step "finish" python3 tools/max/finish_render.py "$ROOT" --from preview --publish "$PUBLISH" || exit 1
say "done -> $PUBLISH"
