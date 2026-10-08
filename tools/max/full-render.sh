#!/usr/bin/env bash
# Every car, start to finish, on this machine: fresh GLBs out of the
# running game, a render pack per car, the pack rendered in Cycles at its
# full size, graded, and published where git keeps renders.
#
#   npm run dev                       # in another shell: export boots the game
#   npm run max:full                  # everything
#   npm run max:full -- --resume      # after a stop: no export, no re-pack, carry on rendering
#   npm run max:full -- --stills      # no turntables
#   TT_SCALE=1 npm run max:full       # turntables at the pack's full 1920x1080 (four times the time)
#
# This is the Cycles stand-in for the 3ds Max batch (tools/max/render_all.py
# runs the same packs through Arnold on a machine that has Max). The two
# produce the same folders, graded the same way by finish_render.py, so a
# Max render and this one are compared like for like.
#
# Steps:
#   1 export    node tools/shots/export-cars.mjs       every car, 10-15 min
#   2 pack      render_pack.py --car all                a minute a car; a pack whose numbers did not change keeps its date
#   3 stills    preview_render.py, 2560x1440 @ 128 spp  15-50 min a car, three stills
#   4 turntable preview_render.py, 120 frames           half size by default: about half an hour a car
#   5 finish    finish_render.py --publish              graded JPGs, sheets, MP4s, manifest -> press/renders/max/
#
# What is and is not resumed. A still or frame counts as done only if it
# is newer than its pack, so a car whose GLB changed is rendered again and
# one that did not is not — --resume just skips the export and the
# packing (a quarter of an hour) for a run that stopped. A car that fails
# to export or pack is reported and the others go on; a render step that
# dies (not one car failing — the renderer stopping) ends the run before
# finish, so nothing half-made is published. Log: press/max/render/full-render.log.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
cd "$REPO"
ROOT=press/max/render
STILLS_ONLY=0; RESUME=0
for a in "$@"; do
  case "$a" in
    --stills) STILLS_ONLY=1 ;;
    --resume) RESUME=1 ;;
    *) echo "full-render.sh: unknown option $a (--stills, --resume)" >&2; exit 2 ;;
  esac
done
SAMPLES="${SAMPLES:-128}"
TT_SAMPLES="${TT_SAMPLES:-32}"
TT_SCALE="${TT_SCALE:-0.5}"
PUBLISH="${PUBLISH:-press/renders/max}"
mkdir -p "$ROOT"
LOG="$ROOT/full-render.log"
FAILED=()
say() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LOG"; }
step() {  # name, command... -> the command's exit code; the log has its output
  local name="$1"; shift
  say "== $name"
  "$@" >> "$LOG" 2>&1
  local code=$?
  if [ $code -eq 0 ]; then say "   $name done"; else say "   $name exit $code — see $LOG"; fi
  return $code
}

say "full render: samples $SAMPLES, turntables $([ "$STILLS_ONLY" = 1 ] && echo off || echo "x$TT_SCALE @ $TT_SAMPLES spp"), publish -> $PUBLISH$([ "$RESUME" = 1 ] && echo ', resuming (no export, no re-pack)')"
if [ "$RESUME" = 1 ]; then
  [ -f "$ROOT/packs.json" ] || { say "nothing to resume: no $ROOT/packs.json — run without --resume first"; exit 1; }
else
  # A cold `next dev` compiles /race on its first request, which can take
  # a minute or two; the export itself waits up to ten.
  if ! curl -s -o /dev/null --max-time 180 http://localhost:3000/race; then
    say "the web build is not running: in another shell, from $REPO, run  npm run dev"; exit 1
  fi
  # Both tools write every car they can and exit 1 if any car failed; the
  # fleet goes on with the cars that worked, and the end of the run says so.
  step "export GLBs" node tools/shots/export-cars.mjs || FAILED+=("export (some cars; see the log)")
  ls "$REPO"/press/renders/glb/*.glb >/dev/null 2>&1 || { say "no GLB came out of the export — stopping"; exit 1; }
  step "render packs" python3 tools/max/render_pack.py --car all || FAILED+=("pack (some cars; see the log)")
  [ -f "$ROOT/packs.json" ] || { say "no packs.json came out of the packing — stopping"; exit 1; }
fi
# The renderer stopping (not a car failing: preview_render.py carries on
# past a bad car and still exits 0) is the end of the run: a set finished
# from whatever was left on disk is not a set.
step "stills" python3 tools/max/preview_render.py "$ROOT" --samples "$SAMPLES" --scale 1 --skip-existing \
  || { say "the stills step died — not finishing; fix and run again with --resume"; exit 1; }
if [ "$STILLS_ONLY" != 1 ]; then
  step "turntables" python3 tools/max/preview_render.py "$ROOT" --shots "" --turntable \
    --tt-scale "$TT_SCALE" --tt-samples "$TT_SAMPLES" --skip-existing \
    || { say "the turntable step died — not finishing; fix and run again with --resume"; exit 1; }
fi
step "finish" python3 tools/max/finish_render.py "$ROOT" --from preview --publish "$PUBLISH" || exit 1
if [ ${#FAILED[@]} -gt 0 ]; then
  say "done -> $PUBLISH, but not every car: ${FAILED[*]}"
  exit 1
fi
say "done -> $PUBLISH"
