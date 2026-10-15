#!/usr/bin/env bash
# Still renders of every car from the game's own Unity project (unity/),
# drawn with the game's own car code (unity/Assets/Editor/Studio). Run from
# anywhere in the repo:
#
#   tools/unity/render-cars.sh                               # both sets, all 17
#   tools/unity/render-cars.sh --mode studio --only black-demon
#   tools/unity/render-cars.sh --mode street --force
#
# Sets:  studio  press/unity/<id>.png               the Blender studio, in URP
#        street  press/unity/street/<id>-<shot>.png  hero, side, rear on the
#                                                   game's night Gulf Road
#
# Options: --mode studio|street|both  --only id[,id]  --force  --out DIR
#          --width N  --height N  --supersample 1|2|4  --msaa N
#          --light-scale F  --exposure EV  --flip-nose  --no-mirror   (studio)
#          --street-s M  --lane N  --street-exposure EV               (street)
#
# Needs the Unity editor unity/ProjectSettings/ProjectVersion.txt names
# (Unity Hub), signed in once (a free Personal licence is enough). Set
# UNITY_EDITOR to the editor binary if it is not in a default Hub folder.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="$ROOT/unity"
OUT="$ROOT/press/unity"
cd "$ROOT"

pass=()
only=""
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) pass+=(-mode "$2"); shift 2 ;;
    --only) pass+=(-only "$2"); only="$2"; shift 2 ;;
    --force) pass+=(-force); shift ;;
    --out)
      case "$2" in /*) OUT="$2" ;; *) OUT="$ROOT/$2" ;; esac
      pass+=(-out "$OUT"); shift 2 ;;
    --width) pass+=(-width "$2"); shift 2 ;;
    --height) pass+=(-height "$2"); shift 2 ;;
    --supersample) pass+=(-supersample "$2"); shift 2 ;;
    --msaa) pass+=(-msaa "$2"); shift 2 ;;
    --light-scale) pass+=(-lightScale "$2"); shift 2 ;;
    --exposure) pass+=(-exposure "$2"); shift 2 ;;
    --flip-nose) pass+=(-flipNose); shift ;;
    --no-mirror) pass+=(-noMirror); shift ;;
    --street-s) pass+=(-streetS "$2"); shift 2 ;;
    --lane) pass+=(-lane "$2"); shift 2 ;;
    --street-exposure) pass+=(-streetExposure "$2"); shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# The editor: UNITY_EDITOR, else the project's own version from a default
# Hub folder, else any 6000.0 there (find-unity.sh, shared with bake-cars.sh).
. "$ROOT/tools/unity/find-unity.sh"
UNITY="$(find_unity)"
if [ -z "$UNITY" ] || [ ! -x "$UNITY" ]; then
  echo "No Unity $want editor found. Install it with Unity Hub, or set UNITY_EDITOR=/path/to/Unity." >&2
  exit 1
fi

# The cars. CarLibrary loads a car baked into unity/Assets/Resources/Cars,
# else its GLB from unity/Assets/StreamingAssets/Cars or press/renders/glb.
# A car with none of those comes out of the running game first.
has_car() {
  [ -f "$PROJECT/Assets/Resources/Cars/$1/$1.prefab" ] ||
    [ -f "$PROJECT/Assets/StreamingAssets/Cars/$1.glb" ] ||
    [ -f "press/renders/glb/$1.glb" ]
}
missing=""
ids="${only//,/ }"
if [ -z "$ids" ] && [ -f press/renders/cars.json ]; then
  ids="$(node -e 'for (const c of require("./press/renders/cars.json")) console.log(c.id)')"
fi
if [ -n "$ids" ]; then
  for id in $ids; do has_car "$id" || missing="${missing:+$missing,}$id"; done
elif ! ls "$PROJECT"/Assets/Resources/Cars/*/*.prefab "$PROJECT"/Assets/StreamingAssets/Cars/*.glb \
          press/renders/glb/*.glb >/dev/null 2>&1; then
  missing=all
fi
if [ -n "$missing" ]; then
  echo "No car to load for: $missing. Exporting from the game (tools/shots/export-cars.mjs)…"
  if ! curl -s -o /dev/null --max-time 5 http://localhost:3000/; then
    cat >&2 <<'EOF'
The export drives the running game, and nothing answers on http://localhost:3000.
Start it in another terminal and run this again:
  npm run dev
The export also needs a Chromium-family browser. It finds Chrome, Chromium or
Edge in /Applications and Playwright's own builds; anywhere else, point at it:
  CHROME_PATH="/Applications/Google Chrome.app" tools/unity/render-cars.sh ...
EOF
    exit 1
  fi
  if [ "$missing" = all ]; then node tools/shots/export-cars.mjs
  else node tools/shots/export-cars.mjs --only "$missing"; fi
fi

mkdir -p "$OUT"
LOG="$OUT/unity.log"
echo "Unity: $UNITY"
echo "Log:   $LOG"
# -quit: the render is synchronous; CarStudio.Run exits itself with 1 on a
# failed car (2 on bad arguments). No -nographics: it renders on the GPU.
set +e
"$UNITY" -batchmode -quit -projectPath "$PROJECT" -logFile "$LOG" \
  -executeMethod NightRacer.Studio.CarStudio.Run ${pass[@]+"${pass[@]}"}
status=$?
set -e
grep '\[render\]' "$LOG" || true
if [ $status -ne 0 ]; then
  echo "Unity exited with $status; see $LOG" >&2
  grep -E 'error CS|Exception|another Unity instance|licen[cs]e' "$LOG" | head -20 >&2 || true
fi

# Contact sheets (tools/shots/render-sheet.mjs reads <dir>/<id>.png; the
# street sheet is the hero shots, linked under their ids).
if ls "$OUT"/*.png >/dev/null 2>&1; then
  node tools/shots/render-sheet.mjs "$OUT" "$OUT/contact-sheet.jpg" || echo "studio contact sheet failed" >&2
fi
if ls "$OUT"/street/*-hero.png >/dev/null 2>&1; then
  sheet="$(mktemp -d)"
  for f in "$OUT"/street/*-hero.png; do
    b="$(basename "$f")"
    ln -s "$f" "$sheet/${b%-hero.png}.png"
  done
  node tools/shots/render-sheet.mjs "$sheet" "$OUT/street/contact-sheet.jpg" || echo "street contact sheet failed" >&2
  rm -rf "$sheet"
fi
exit $status
