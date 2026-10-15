# Sourced by render-cars.sh and bake-cars.sh: find the Unity editor for the
# project in $PROJECT. UNITY_EDITOR wins; otherwise the exact version the
# project names (ProjectSettings/ProjectVersion.txt) from a default Hub
# folder, then any 6000.0 patch there. Never a later minor (6000.1+): batch
# mode upgrades a project without asking, and URP is pinned to the editor.
want="$(sed -n 's/^m_EditorVersion: *//p' "$PROJECT/ProjectSettings/ProjectVersion.txt")"
find_unity() {
  if [ -n "${UNITY_EDITOR:-}" ]; then echo "$UNITY_EDITOR"; return; fi
  local c v found=""
  for v in "$want" "6000.0.*"; do
    for c in \
      /Applications/Unity/Hub/Editor/$v/Unity.app/Contents/MacOS/Unity \
      "$HOME"/Applications/Unity/Hub/Editor/$v/Unity.app/Contents/MacOS/Unity \
      "$HOME"/Unity/Hub/Editor/$v/Editor/Unity \
      "/c/Program Files/Unity/Hub/Editor/"$v/Editor/Unity.exe \
      "/mnt/c/Program Files/Unity/Hub/Editor/"$v/Editor/Unity.exe; do
      [ -x "$c" ] && found="$c"
    done
    if [ -n "$found" ]; then echo "$found"; return; fi
  done
}
