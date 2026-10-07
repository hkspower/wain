#!/usr/bin/env bash
# The catalogue's cars in real Unreal Engine 5, from a Mac.
#
#   unreal/Showcase/run.sh probe                  # what this editor exposes; nothing is made
#   unreal/Showcase/run.sh export [ids]           # the cars' GLBs, out of the running web build
#   unreal/Showcase/run.sh build [id|all]         # import each car, build its studio, sequences, presets
#   unreal/Showcase/run.sh preview <id> [shot]    # 960x540 in a minute or two: is the light right?
#   unreal/Showcase/run.sh render [id|all] [hero|side|rear|turntable] [--4k]
#   unreal/Showcase/run.sh night <city|coast> [id]  # the game's own corniche at night (default car: black-demon)
#   unreal/Showcase/run.sh sheet                  # a 4-wide contact sheet of every car's hero
#   unreal/Showcase/run.sh compare                # Blender and Unreal side by side, with the brightness gap
#   unreal/Showcase/run.sh encode                 # turntable.mp4s, JPEG copies of the stills
#   unreal/Showcase/run.sh report [id|all]        # what build recorded
#
# Fleet renders are 2560x1440, the size the Blender renders are made at,
# so a car and its Cycles twin compare pixel for pixel; --4k is the
# Black Demon's 3840x2160 with 32 temporal samples.
#
# Every run writes a log to press/unreal/logs/. When a step fails, that
# log is what to send back with the report.
#
# Needs Unreal Engine 5.8 with its C++ toolchain (unreal/README.md), the
# project built once (opening GulfRoadNights.uproject in the editor and
# accepting the rebuild does it, and builds the car paint), node for
# export/sheet/compare, and for `encode`, ffmpeg (brew install ffmpeg).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PROJECT="$REPO/unreal/GulfRoadNights.uproject"
OUT="$REPO/press/unreal"
CARS_JSON="$REPO/press/renders/cars.json"
SHOWCASE="/Game/GRN/Showcase"
mkdir -p "$OUT/logs"

say() { printf '%-9s %s\n' "$1" "$2"; }
die() { printf 'run.sh: %s\n' "$*" >&2; exit 1; }

# ---- the catalogue ---------------------------------------------------
all_ids() {
  node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    console.log((Array.isArray(d)?d:d.cars).map(c=>c.id).join(" "))' "$CARS_JSON"
}
ids_for() {  # all | one id | a,b,c -> space-separated ids, each checked
  local want="${1:-all}" known id
  known=" $(all_ids) "
  if [ "$want" = "all" ]; then echo "${known# }" | sed 's/ $//'; return; fi
  for id in ${want//,/ }; do
    case "$known" in *" $id "*) ;; *) die "no car called $id (the catalogue has:${known% })";; esac
  done
  echo "${want//,/ }"
}
slug_of() { echo "${1//-/_}"; }

# ---- the engine, the way mac/connect.sh finds it ---------------------
WANT_VER="$(sed -n 's/.*"EngineAssociation"[^"]*"\([^"]*\)".*/\1/p' "$PROJECT")"
find_engine() {
  UE="${UE_ROOT:-}"
  if [ -z "$UE" ]; then
    for c in "/Users/Shared/Epic Games/UE_${WANT_VER}" "/Applications/Epic Games/UE_${WANT_VER}" "$HOME/UnrealEngine"; do
      [ -d "$c" ] && UE="$c" && break
    done
  fi
  [ -n "$UE" ] || die "no Unreal ${WANT_VER} in the usual places — set UE_ROOT=/path/to/UE_${WANT_VER}"
  UE_CMD="$UE/Engine/Binaries/Mac/UnrealEditor-Cmd"
  [ -x "$UE_CMD" ] || UE_CMD="$UE/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor-Cmd"
  [ -x "$UE_CMD" ] || UE_CMD="$UE/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor"
  [ -x "$UE_CMD" ] || die "no UnrealEditor-Cmd under $UE/Engine/Binaries/Mac"
  say engine "$UE_CMD"
  say project "$PROJECT"
}

# The Python plugin reads UE_PYTHONPATH and runs init_unreal.py from each
# folder on it: that is how the night executor comes to exist.
export UE_PYTHONPATH="$HERE${UE_PYTHONPATH:+:$UE_PYTHONPATH}"

COMMON=(-stdout -FullStdOutLogOutput -unattended -nosplash -NoLoadingScreen)
stamp() { date +%Y%m%d-%H%M%S; }

editor_py() {  # run grn_showcase.py <args> inside the editor, then quit
  local args="$*"; local log="$OUT/logs/${1}-$(stamp).log"
  say log "$log"
  "$UE_CMD" "$PROJECT" -ExecutePythonScript="$HERE/grn_showcase.py $args" "${COMMON[@]}" 2>&1 | tee "$log" \
    | grep -E "\[showcase\]|LogPython|Error|error:" || true
  say done "$args (full log: $log)"
}

mrq() {  # map sequence preset resx resy label
  local map="$1" seq="$2" preset="$3" rx="$4" ry="$5" label="$6"
  local log="$OUT/logs/$label-$(stamp).log"
  say log "$log"
  "$UE_CMD" "$PROJECT" "$map" -game \
    -MoviePipelineConfig="$preset" -LevelSequence="$seq" \
    -windowed -ResX="$rx" -ResY="$ry" -log -notexturestreaming "${COMMON[@]}" 2>&1 | tee "$log" \
    | grep -E "LogMovieRenderPipeline|Finished|wrote|Error|Fatal" || true
  say done "$label (full log: $log)"
}

render_one() {  # id shot quality(still|still4k)
  local id="$1" shot="$2" q="$3" s; s="$(slug_of "$id")"
  local base="$SHOWCASE/$s"
  case "$shot" in
    turntable) mrq "$base/Studio" "$base/Sequences/LS_turntable" "$base/MRQ/MRQ_turntable1080" 1280 720 "$id-turntable" ;;
    hero|side|rear) mrq "$base/Studio" "$base/Sequences/LS_$shot" "$base/MRQ/MRQ_$q" 1280 720 "$id-$shot" ;;
    *) die "which shot? hero, side, rear or turntable" ;;
  esac
}

cmd="${1:-probe}"; shift || true
case "$cmd" in
  export)
    command -v node >/dev/null || die "node is needed (it is what builds the web game)"
    curl -s -o /dev/null --max-time 5 http://localhost:3000/race || \
      die "the web build is not running: in another terminal, from $REPO, run  npm run dev"
    missing=()
    for id in $(ids_for "${1:-all}"); do
      [ -f "$REPO/press/renders/glb/$id.glb" ] || missing+=("$id")
    done
    if [ ${#missing[@]} -eq 0 ]; then say export "every GLB is already in press/renders/glb/"; exit 0; fi
    only="$(IFS=,; echo "${missing[*]}")"
    say export "${#missing[@]} car(s): $only"
    (cd "$REPO" && node tools/shots/export-cars.mjs --only "$only") ;;
  probe|build|report)
    find_engine
    editor_py "$cmd" "$@" ;;
  preview)
    id="${1:?preview which car? e.g. run.sh preview black-demon hero}"; shot="${2:-hero}"
    ids_for "$id" >/dev/null; find_engine
    s="$(slug_of "$id")"
    mrq "$SHOWCASE/$s/Studio" "$SHOWCASE/$s/Sequences/LS_$shot" "$SHOWCASE/$s/MRQ/MRQ_preview" 960 540 "$id-preview-$shot" ;;
  render)
    find_engine
    q=still; shot=all; target=all
    for a in "$@"; do
      case "$a" in
        --4k) q=still4k ;;
        hero|side|rear|turntable) shot="$a" ;;
        *) target="$a" ;;
      esac
    done
    for id in $(ids_for "$target"); do
      if [ "$shot" = "all" ]; then
        for s in hero side rear; do render_one "$id" "$s" "$q"; done
        [ "$id" = "black-demon" ] && render_one "$id" turntable "$q"
      else
        render_one "$id" "$shot" "$q"
      fi
    done ;;
  night)
    find_engine
    shot="${1:-city}"; car="${2:-black-demon}"; ids_for "$car" >/dev/null
    log="$OUT/logs/$car-night-$shot-$(stamp).log"
    say log "$log"
    "$UE_CMD" "$PROJECT" /Engine/Maps/Entry -game \
      -MoviePipelineLocalExecutorClass=/Script/MovieRenderPipelineCore.MoviePipelinePythonHostExecutor \
      -ExecutorPythonClass=/Engine/PythonTypes.GRNNightExecutor \
      -GRNNight="$shot" -GRNNightCar="$car" -ExecCmds="py import grn_night" \
      -windowed -ResX=1920 -ResY=1080 -log -notexturestreaming "${COMMON[@]}" 2>&1 | tee "$log" \
      | grep -E "\[night\]|GRNShowcase|LogMovieRenderPipeline|Error|Fatal" || true
    say done "night $shot, $car (full log: $log)" ;;
  sheet)
    command -v node >/dev/null || die "node is needed"
    mkdir -p "$OUT/fleet"; n=0
    for id in $(all_ids); do
      f="$(ls "$OUT/$id"/stills/LS_hero.*.png 2>/dev/null | head -1 || true)"
      [ -n "$f" ] && cp "$f" "$OUT/fleet/$id.png" && n=$((n + 1))
    done
    [ "$n" -gt 0 ] || die "no hero stills yet — run.sh render all hero first"
    (cd "$REPO" && node tools/shots/render-sheet.mjs "press/unreal/fleet" "press/unreal/fleet/contact-sheet.jpg")
    say wrote "$OUT/fleet/contact-sheet.jpg ($n cars)" ;;
  compare)
    command -v node >/dev/null || die "node is needed"
    [ -d "$OUT/fleet" ] || die "no press/unreal/fleet yet — run.sh sheet first"
    (cd "$REPO" && node tools/shots/ue-compare.mjs) ;;
  encode)
    command -v ffmpeg >/dev/null || die "ffmpeg is needed: brew install ffmpeg"
    for d in "$OUT"/*/turntable; do
      [ -d "$d" ] || continue
      ls "$d"/*.png >/dev/null 2>&1 || continue
      ffmpeg -y -framerate 24 -pattern_type glob -i "$d/*.png" -c:v libx264 -pix_fmt yuv420p -crf 17 \
        -movflags +faststart "$(dirname "$d")/turntable.mp4" && say wrote "$(dirname "$d")/turntable.mp4"
    done
    for p in "$OUT"/*/stills/*.png "$OUT"/*/stills4k/*.png "$OUT"/*/night/*.png; do
      [ -f "$p" ] || continue
      ffmpeg -y -loglevel error -i "$p" -q:v 2 "${p%.png}.jpg" && say wrote "${p%.png}.jpg"
    done ;;
  *)
    die "unknown command $cmd — probe, export, build, preview, render, night, sheet, compare, encode, report" ;;
esac
