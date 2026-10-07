#!/usr/bin/env bash
# The Black Demon in real Unreal Engine 5, from a Mac.
#
#   unreal/Showcase/run.sh probe              # what this editor exposes; nothing is made
#   unreal/Showcase/run.sh build              # import the car, build the studio, sequences, presets
#   unreal/Showcase/run.sh preview hero       # 960x540, quick — tune the look on this
#   unreal/Showcase/run.sh render hero        # 3840x2160 still (also: side, rear, all)
#   unreal/Showcase/run.sh render turntable   # 240 frames, 1920x1080, 24 fps
#   unreal/Showcase/run.sh night city         # the game's own Gulf Road at night (also: coast)
#   unreal/Showcase/run.sh encode             # turntable.mp4 and JPEG copies of the stills
#
# Every run writes a log to press/unreal/black-demon/logs/. When a step
# fails, that log is what to send back with the report.
#
# Needs Unreal Engine 5.8 with its C++ toolchain (unreal/README.md), the
# project built once (opening GulfRoadNights.uproject in the editor and
# accepting the rebuild does it, and builds the car paint), and for
# `encode`, ffmpeg (brew install ffmpeg).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PROJECT="$REPO/unreal/GulfRoadNights.uproject"
OUT="$REPO/press/unreal/black-demon"
STUDIO_MAP="/Game/GRN/Showcase/BlackDemonStudio"
SEQ="/Game/GRN/Showcase/Sequences"
MRQ="/Game/GRN/Showcase/MRQ"
mkdir -p "$OUT/logs"

say() { printf '%-9s %s\n' "$1" "$2"; }
die() { printf 'run.sh: %s\n' "$*" >&2; exit 1; }

# ---- the engine, the way mac/connect.sh finds it ---------------------
WANT_VER="$(sed -n 's/.*"EngineAssociation"[^"]*"\([^"]*\)".*/\1/p' "$PROJECT")"
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

# The Python plugin reads UE_PYTHONPATH and runs init_unreal.py from each
# folder on it: that is how the night executor comes to exist.
export UE_PYTHONPATH="$HERE${UE_PYTHONPATH:+:$UE_PYTHONPATH}"

COMMON=(-stdout -FullStdOutLogOutput -unattended -nosplash -NoLoadingScreen)
stamp() { date +%Y%m%d-%H%M%S; }

editor_py() {  # run grn_showcase.py <cmd> inside the editor, then quit
  local cmd="$1"; local log="$OUT/logs/$cmd-$(stamp).log"
  say log "$log"
  "$UE_CMD" "$PROJECT" -ExecutePythonScript="$HERE/grn_showcase.py $cmd" "${COMMON[@]}" 2>&1 | tee "$log" | grep -E "\[showcase\]|LogPython|Error|error:|Warning: \[showcase\]" || true
  say done "$cmd (full log: $log)"
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

cmd="${1:-probe}"; shift || true
case "$cmd" in
  probe|build|report)
    editor_py "$cmd" ;;
  preview)
    shot="${1:-hero}"
    mrq "$STUDIO_MAP" "$SEQ/LS_$shot" "$MRQ/MRQ_preview" 960 540 "preview-$shot" ;;
  render)
    what="${1:-all}"
    case "$what" in
      all) for s in hero side rear; do mrq "$STUDIO_MAP" "$SEQ/LS_$s" "$MRQ/MRQ_still4k" 1280 720 "still-$s"; done
           mrq "$STUDIO_MAP" "$SEQ/LS_turntable" "$MRQ/MRQ_turntable1080" 1280 720 "turntable" ;;
      hero|side|rear) mrq "$STUDIO_MAP" "$SEQ/LS_$what" "$MRQ/MRQ_still4k" 1280 720 "still-$what" ;;
      turntable) mrq "$STUDIO_MAP" "$SEQ/LS_turntable" "$MRQ/MRQ_turntable1080" 1280 720 "turntable" ;;
      *) die "render what? hero, side, rear, turntable or all" ;;
    esac ;;
  night)
    shot="${1:-city}"
    log="$OUT/logs/night-$shot-$(stamp).log"
    say log "$log"
    "$UE_CMD" "$PROJECT" /Engine/Maps/Entry -game \
      -MoviePipelineLocalExecutorClass=/Script/MovieRenderPipelineCore.MoviePipelinePythonHostExecutor \
      -ExecutorPythonClass=/Engine/PythonTypes.GRNNightExecutor \
      -GRNNight="$shot" -ExecCmds="py import grn_night" \
      -windowed -ResX=1920 -ResY=1080 -log -notexturestreaming "${COMMON[@]}" 2>&1 | tee "$log" \
      | grep -E "\[night\]|GRNShowcase|LogMovieRenderPipeline|Error|Fatal" || true
    say done "night $shot (full log: $log)" ;;
  encode)
    command -v ffmpeg >/dev/null || die "ffmpeg is needed: brew install ffmpeg"
    if ls "$OUT"/turntable/*.png >/dev/null 2>&1; then
      ffmpeg -y -framerate 24 -pattern_type glob -i "$OUT/turntable/*.png" -c:v libx264 -pix_fmt yuv420p -crf 17 \
        -movflags +faststart "$OUT/turntable.mp4" && say wrote "$OUT/turntable.mp4"
    else
      say skip "no turntable frames yet"
    fi
    for p in "$OUT"/stills/*.png "$OUT"/night/*.png; do
      [ -f "$p" ] || continue
      j="${p%.png}.jpg"; ffmpeg -y -loglevel error -i "$p" -q:v 2 "$j" && say wrote "$j"
    done ;;
  *)
    die "unknown command $cmd — probe, build, report, preview, render, night, encode" ;;
esac
