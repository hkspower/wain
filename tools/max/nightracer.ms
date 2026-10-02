/*
  Night Racer car shells in 3ds Max.

  Scripting > Run Script... > this file. It opens the "Night Racer" panel:

    Open style...     pick press/max/car-<style>.fbx (npm run max:export).
                      Sets the scene to metres, imports it, and sorts it onto
                      three layers:
                        NR_Edit      Body, Canopy, Roof - model these.
                        NR_Envelope  frozen, see-through: the game's own shell.
                        NR_Context   frozen: the whole car as the game builds
                                     it (lamps, trim, wheels), for reference.
    Check             names, triangle counts, and how far each shell's box has
                      moved from its Envelope, in mm. The game drops a shell
                      more than 10 mm off (src/game/models.ts); this is the
                      quick look, and npm run max:import is the real gate.
    Export for game   writes ONLY Body, Canopy and Roof to
                      <folder of the opened file>\to-game\car-<style>.fbx,
                      in metres, triangulated, with smoothing groups and the
                      modifier stack applied. Then, in the repo:
                        npm run max:import -- <that to-game folder>

  Rules the game holds you to:
    - names: exactly one Body, one Canopy, one Roof (the Canopy is all the glass);
    - frame: metres, Z up, nose toward the Front view, centred on X = 0 - as
      it arrived; move the shells, not the frame;
    - symmetric across X = 0 (the Symmetry modifier is the easy way);
    - closed and facing outward: the game draws them single-sided.
*/

global NR_style = undefined
global NR_dir = undefined
global NR_SLOTS = #("Body", "Canopy", "Roof")
global NR_TOL_MM = 10.0
global NR_panel

fn NR_metres =
(
  units.DisplayType = #metric
  units.MetricType = #meters
  units.SystemType = #meters
  units.SystemScale = 1.0
)

fn NR_rootName o =
(
  local r = o
  while r.parent != undefined do r = r.parent
  r.name
)

fn NR_layer name frozen =
(
  local l = LayerManager.getLayerFromName name
  if l == undefined do l = LayerManager.newLayerFromName name
  l.isFrozen = frozen
  l
)

/* The one shell of a slot on the Edit layer (or undefined), and how many there are. */
fn NR_shells slot =
(
  local hits = for o in objects where (matchPattern o.name pattern:slot ignoreCase:true) and (NR_rootName o == "NR_Edit" or o.parent == undefined) and (superClassOf o == GeometryClass) collect o
  hits
)

fn NR_envelope slot =
(
  getNodeByName ("Envelope_" + slot)
)

fn NR_open symmetry:false =
(
  local f = getOpenFileName caption:"Night Racer: open a car style" types:"Night Racer FBX (car-*.fbx)|car-*.fbx|FBX (*.fbx)|*.fbx"
  if f == undefined do return false
  if not (checkForSave()) do return false
  resetMaxFile #noPrompt
  NR_metres()
  FBXImporterSetParam "ResetImport"
  FBXImporterSetParam "Mode" #create
  FBXImporterSetParam "ScaleConversion" true
  FBXImporterSetParam "ConvertUnit" "m"
  FBXImporterSetParam "SmoothingGroups" true
  FBXImporterSetParam "Cameras" false
  FBXImporterSetParam "Lights" false
  FBXImporterSetParam "Animation" false
  importFile f #noPrompt using:FBXIMP

  local base = getFilenameFile f
  NR_style = if matchPattern base pattern:"car-*" then substring base 5 -1 else base
  NR_dir = getFilenamePath f

  local lEdit = NR_layer "NR_Edit" false
  local lEnv = NR_layer "NR_Envelope" true
  local lCtx = NR_layer "NR_Context" true
  for o in objects do
  (
    case (NR_rootName o) of
    (
      "NR_Edit": lEdit.addNode o
      "NR_Envelope": (lEnv.addNode o; o.xray = true; o.renderable = false)
      "NR_Context": (lCtx.addNode o; o.renderable = false)
    )
  )
  if symmetry do
    for slot in NR_SLOTS do
      for o in (NR_shells slot) do addModifier o (Symmetry())
  max zoomext sel all
  format "Night Racer: opened % (style %)\n" f NR_style
  true
)

fn NR_check =
(
  local lines = #()
  local bad = 0
  for slot in NR_SLOTS do
  (
    local hits = NR_shells slot
    if hits.count != 1 then
    (
      append lines (slot + ": " + (hits.count as string) + " meshes with this name - the game needs exactly one")
      bad += 1
    )
    else
    (
      local o = hits[1]
      local tris = (snapshotAsMesh o).numfaces
      local env = NR_envelope slot
      local msg = slot + ": " + (tris as string) + " tris"
      if env != undefined then
      (
        local etris = (snapshotAsMesh env).numfaces
        if tris > etris * 1.5 do msg += " (over 1.5x the shipped " + (etris as string) + "; heavier for every car on the road)"
        local d = amax #(abs (o.min.x - env.min.x), abs (o.max.x - env.max.x), abs (o.min.y - env.min.y), \
                        abs (o.max.y - env.max.y), abs (o.min.z - env.min.z), abs (o.max.z - env.max.z))
        local mm = d * 1000.0   -- system units are metres (Open style sets them)
        msg += ", box " + (formattedPrint mm format:".1f") + " mm off the Envelope"
        if mm > NR_TOL_MM do (msg += "  <-- OVER 10 mm: the game will drop this shell"; bad += 1)
      )
      else msg += " (no Envelope to compare with)"
      if abs (o.center.x - (if env != undefined then env.center.x else 0.0)) > 0.002 do
        msg += "  [off the centreline: keep it symmetric across X = 0]"
      append lines msg
    )
  )
  local text = ""
  for l in lines do text += l + "\n"
  text += if bad == 0 then "\nBox check passes. npm run max:import runs the full gate (skin, symmetry, glass)." \
                      else "\n" + (bad as string) + " problem(s)."
  format "Night Racer check:\n%\n" text
  messageBox text title:"Night Racer: check"
  bad == 0
)

fn NR_export =
(
  if units.SystemType != #meters do NR_metres()
  try (if NR_panel.etStyle.text != "" do NR_style = NR_panel.etStyle.text) catch ()
  if NR_style == undefined or NR_style == "" do
  (
    messageBox "Type the body style (gtr, sedan, ...) in the panel first." title:"Night Racer"
    return false
  )
  local pick = #()
  for slot in NR_SLOTS do
  (
    local hits = NR_shells slot
    if hits.count != 1 do (messageBox ("Need exactly one " + slot + " (found " + (hits.count as string) + ").") title:"Night Racer"; return false)
    append pick hits[1]
  )
  local dir = (if NR_dir != undefined then NR_dir else (getDir #export) + "\\") + "to-game"
  makeDir dir all:true
  local out = dir + "\\car-" + NR_style + ".fbx"

  FBXExporterSetParam "ResetExport"
  FBXExporterSetParam "Animation" false
  FBXExporterSetParam "BakeAnimation" false
  FBXExporterSetParam "Cameras" false
  FBXExporterSetParam "Lights" false
  FBXExporterSetParam "EmbedTextures" false
  FBXExporterSetParam "SmoothingGroups" true
  FBXExporterSetParam "Triangulate" true
  FBXExporterSetParam "Shape" false
  FBXExporterSetParam "Skin" false
  FBXExporterSetParam "ScaleFactor" 1.0
  FBXExporterSetParam "ConvertUnit" "m"
  FBXExporterSetParam "UpAxis" "Y"
  FBXExporterSetParam "ASCII" false

  local was = selection as array
  select pick
  exportFile out #noPrompt selectedOnly:true using:FBXEXP
  if was.count > 0 then select was else clearSelection()
  format "Night Racer: wrote %\n" out
  messageBox ("Wrote\n" + out + "\n\nIn the repo:\n  npm run max:import -- \"" + dir + "\"") title:"Night Racer: export"
  true
)

macroScript NR_Open category:"Night Racer" buttonText:"NR Open" tooltip:"Night Racer: open a car style" (NR_open())
macroScript NR_Check category:"Night Racer" buttonText:"NR Check" tooltip:"Night Racer: check the shells" (NR_check())
macroScript NR_Export category:"Night Racer" buttonText:"NR Export" tooltip:"Night Racer: export Body, Canopy, Roof for the game" (NR_export())

try (destroyDialog NR_panel) catch ()
rollout NR_panel "Night Racer" width:210
(
  checkbox cbSym "Add Symmetry modifier on open" checked:false
  edittext etStyle "Style:" text:(if NR_style == undefined then "" else NR_style)
  button bOpen "Open style..." width:180
  button bCheck "Check" width:180
  button bExport "Export for game" width:180
  label lb1 "Envelope/Context are frozen refs."
  label lb2 "Model Body, Canopy, Roof only."
  on bOpen pressed do (if NR_open symmetry:cbSym.checked do etStyle.text = NR_style)
  on bCheck pressed do NR_check()
  on bExport pressed do NR_export()
)
createDialog NR_panel
