#!/usr/bin/env bash
# Bake every game car into the Unity project as its own assets: a prefab
# per car under unity/Assets/Resources/Cars/<id>/, with the hood, rear
# window, rear wing and tyres as prefabs of their own, and the meshes,
# materials and textures they use (NightRacer.CarsEditor.CarAssetBaker).
#
#   tools/unity/bake-cars.sh                      # all 17
#   tools/unity/bake-cars.sh --only black-demon   # one
#
# Reads the GLBs the web build exports (press/renders/glb/, made by
# `npm run dev` + `npm run cars:export`). Needs Unity 6 (6000.0) from the
# Hub, signed in once. The same bake runs from the menu Night Racer ▸ Bake
# Cars to Assets with the project open. The game loads baked cars first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="$ROOT/unity"
LOG="$ROOT/unity/Logs/bake-cars.log"
only=()
while [ $# -gt 0 ]; do
  case "$1" in
    --only) only=(-only "$2"); shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
UNITY="${UNITY_EDITOR:-}"
if [ -z "$UNITY" ]; then
  for c in /Applications/Unity/Hub/Editor/6000.*/Unity.app/Contents/MacOS/Unity \
           "$HOME"/Unity/Hub/Editor/6000.*/Editor/Unity \
           "/c/Program Files/Unity/Hub/Editor/"6000.*/Editor/Unity.exe; do
    [ -x "$c" ] && UNITY="$c"
  done
fi
if [ -z "$UNITY" ]; then
  echo "No Unity 6 editor found. Install 6000.0 LTS with Unity Hub, or set UNITY_EDITOR=/path/to/Unity." >&2
  exit 1
fi
if ! ls "$ROOT"/press/renders/glb/*.glb >/dev/null 2>&1; then
  echo "No car GLBs in press/renders/glb. Export them first: npm run dev (one terminal), then npm run cars:export." >&2
  exit 1
fi
mkdir -p "$(dirname "$LOG")"
echo "Unity: $UNITY"
echo "Log:   $LOG"
set +e
"$UNITY" -batchmode -projectPath "$PROJECT" -logFile "$LOG" \
  -executeMethod NightRacer.CarsEditor.CarAssetBaker.BakeBatch "${only[@]}"
status=$?
set -e
grep '\[bake\]' "$LOG" || true
[ $status -ne 0 ] && echo "Unity exited with $status; see $LOG" >&2
exit $status
