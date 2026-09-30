#!/usr/bin/env bash
# Studio renders of every car in Unity: the Unity twin of
# tools/blender/render_cars.py. Run from anywhere in the repo:
#
#   tools/unity/render-cars.sh                          # all 17, 2560x1440
#   tools/unity/render-cars.sh --only black-demon       # one, for a look
#   tools/unity/render-cars.sh --force --light-scale 0.8
#
# Options: --only id[,id]  --force  --width N  --height N  --supersample N
#          --light-scale F  --exposure EV  --flip-nose  --no-mirror
#
# Needs Unity 6 (6000.0 LTS) installed through the Hub and signed in once
# (a free Personal license is enough). Set UNITY_EDITOR to the editor
# binary if it is not in a default Hub location. Writes press/unity/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="$ROOT/tools/unity/NightRacerStudio"
OUT="$ROOT/press/unity"
cd "$ROOT"

pass=()
while [ $# -gt 0 ]; do
  case "$1" in
    --only) pass+=(-only "$2"); shift 2 ;;
    --force) pass+=(-force); shift ;;
    --width) pass+=(-width "$2"); shift 2 ;;
    --height) pass+=(-height "$2"); shift 2 ;;
    --supersample) pass+=(-supersample "$2"); shift 2 ;;
    --light-scale) pass+=(-lightScale "$2"); shift 2 ;;
    --exposure) pass+=(-exposure "$2"); shift 2 ;;
    --flip-nose) pass+=(-flipNose); shift ;;
    --no-mirror) pass+=(-noMirror); shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

find_unity() {
  if [ -n "${UNITY_EDITOR:-}" ]; then echo "$UNITY_EDITOR"; return; fi
  local c
  for c in \
    /Applications/Unity/Hub/Editor/6000.*/Unity.app/Contents/MacOS/Unity \
    "$HOME"/Unity/Hub/Editor/6000.*/Editor/Unity \
    "/c/Program Files/Unity/Hub/Editor/"6000.*/Editor/Unity.exe \
    "/mnt/c/Program Files/Unity/Hub/Editor/"6000.*/Editor/Unity.exe; do
    [ -x "$c" ] && UNITY="$c"
  done
  echo "${UNITY:-}"
}
UNITY="$(find_unity)"
if [ -z "$UNITY" ]; then
  echo "No Unity 6 editor found. Install 6000.0 LTS with Unity Hub, or set UNITY_EDITOR=/path/to/Unity." >&2
  exit 1
fi

# The cars, out of the game, if they are not there yet.
if [ ! -f press/renders/cars.json ] || ! ls press/renders/glb/*.glb >/dev/null 2>&1; then
  echo "Exporting the cars from the game first (tools/shots/export-cars.mjs)…"
  node tools/shots/export-cars.mjs
fi

mkdir -p "$OUT"
echo "Unity: $UNITY"
echo "Log:   $OUT/unity.log"
# No -quit: loading is async and RenderCars exits the editor itself.
# No -nographics: it renders on the GPU.
set +e
"$UNITY" -batchmode -projectPath "$PROJECT" -logFile "$OUT/unity.log" \
  -executeMethod NightRacer.RenderCars.Run "${pass[@]}"
status=$?
set -e
grep '\[render\]' "$OUT/unity.log" || true
if [ $status -ne 0 ]; then
  echo "Unity exited with $status; see $OUT/unity.log" >&2
fi

if ls "$OUT"/*.png >/dev/null 2>&1; then
  node tools/shots/render-sheet.mjs "$OUT" "$OUT/contact-sheet.jpg"
fi
exit $status
