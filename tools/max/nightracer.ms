/*
  Night Racer tools for 3ds Max: the loader.

  Scripting > Run Script... > this file.

    3ds Max 2023 and later   the Night Racer dock panel (tools/max/nightracer/,
                             Python): Open, Save; Check with the game's own
                             tests; a drift heatmap; fixes; Export and Export all;
                             and Render: a car's render pack, or every car's, in
                             Arnold.
    3ds Max 2020-2022        the classic panel (nightracer_classic.ms): Open,
                             a box-only Check, Export.

  It also adds a "Night Racer" main menu and a "Night Racer" macro category
  (Customize > Hotkey Editor / toolbars), and remembers where it lives in the
  INI. The macros reload the tools themselves after a restart, so a toolbar
  button or hotkey bound to one keeps working. The menu: 2020-2024 keep it
  (menuMan, saved with the UI); 2025+ build menus at startup, so use
  "Install at startup" (in the menu) to have it back every launch without the
  panel opening.

  The functions live in nightracer_lib.ms.
*/

global NR_ROOT
global NR_QUIET  -- set true by the startup script: register, do not open the panel

(
  -- getSourceFileName() is undefined when this is pasted or evaluated in the
  -- Listener; then the INI's remembered folder is used.
  local src = getSourceFileName()
  local here = if src != undefined and src != "" then getFilenamePath src else undefined
  if here != undefined and doesFileExist (here + "nightracer_lib.ms") do NR_ROOT = here
  if NR_ROOT == undefined or NR_ROOT == "" do NR_ROOT = getINISetting (getMAXIniFile()) "NightRacer" "root"
  if NR_ROOT == "" or NR_ROOT == undefined or not (doesFileExist (NR_ROOT + "nightracer_lib.ms")) then
  (
    messageBox "Night Racer: cannot find the tools/max folder. Run nightracer.ms from where it lives." title:"Night Racer"
    NR_ROOT = undefined
  )
  else
  (
    setINISetting (getMAXIniFile()) "NightRacer" "root" NR_ROOT
    fileIn (NR_ROOT + "nightracer_lib.ms")
  )
)

-- Each macro finds its function at run time (globalVars), and reloads the
-- library if a restart has taken it away: macroScripts are compiled from
-- their saved copy at startup, where an undeclared name would be a local.
macroScript NR_Panel category:"Night Racer" buttonText:"Night Racer panel" tooltip:"Night Racer: open the panel"
(
  local f = if globalVars.isGlobal #NR_panel_open then globalVars.get #NR_panel_open
  if f == undefined do
  (
    local r = getINISetting (getMAXIniFile()) "NightRacer" "root"
    if r != "" and doesFileExist (r + "nightracer_lib.ms") do fileIn (r + "nightracer_lib.ms")
    f = if globalVars.isGlobal #NR_panel_open then globalVars.get #NR_panel_open
  )
  if f != undefined then f()
  else messageBox "Night Racer: run tools/max/nightracer.ms once (Scripting > Run Script)." title:"Night Racer"
)

macroScript NR_Open category:"Night Racer" buttonText:"Open style..." tooltip:"Night Racer: open a car style"
(
  local f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  if f == undefined do
  (
    local r = getINISetting (getMAXIniFile()) "NightRacer" "root"
    if r != "" and doesFileExist (r + "nightracer_lib.ms") do fileIn (r + "nightracer_lib.ms")
    f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  )
  if f != undefined then f "open"
  else messageBox "Night Racer: run tools/max/nightracer.ms once (Scripting > Run Script)." title:"Night Racer"
)

macroScript NR_Check category:"Night Racer" buttonText:"Check" tooltip:"Night Racer: the game's checks"
(
  local f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  if f == undefined do
  (
    local r = getINISetting (getMAXIniFile()) "NightRacer" "root"
    if r != "" and doesFileExist (r + "nightracer_lib.ms") do fileIn (r + "nightracer_lib.ms")
    f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  )
  if f != undefined then f "check"
  else messageBox "Night Racer: run tools/max/nightracer.ms once (Scripting > Run Script)." title:"Night Racer"
)

macroScript NR_Heatmap category:"Night Racer" buttonText:"Heatmap" tooltip:"Night Racer: drift heatmap"
(
  local f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  if f == undefined do
  (
    local r = getINISetting (getMAXIniFile()) "NightRacer" "root"
    if r != "" and doesFileExist (r + "nightracer_lib.ms") do fileIn (r + "nightracer_lib.ms")
    f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  )
  if f != undefined then f "heatmap"
  else messageBox "Night Racer: run tools/max/nightracer.ms once (Scripting > Run Script)." title:"Night Racer"
)

macroScript NR_Snap category:"Night Racer" buttonText:"Snap verts to Envelope" tooltip:"Night Racer: snap selected verts to the Envelope"
(
  local f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  if f == undefined do
  (
    local r = getINISetting (getMAXIniFile()) "NightRacer" "root"
    if r != "" and doesFileExist (r + "nightracer_lib.ms") do fileIn (r + "nightracer_lib.ms")
    f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  )
  if f != undefined then f "snap"
  else messageBox "Night Racer: run tools/max/nightracer.ms once (Scripting > Run Script)." title:"Night Racer"
)

macroScript NR_Symmetric category:"Night Racer" buttonText:"Make symmetric" tooltip:"Night Racer: make the selected shell symmetric"
(
  local f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  if f == undefined do
  (
    local r = getINISetting (getMAXIniFile()) "NightRacer" "root"
    if r != "" and doesFileExist (r + "nightracer_lib.ms") do fileIn (r + "nightracer_lib.ms")
    f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  )
  if f != undefined then f "symmetric"
  else messageBox "Night Racer: run tools/max/nightracer.ms once (Scripting > Run Script)." title:"Night Racer"
)

macroScript NR_Export category:"Night Racer" buttonText:"Export for game" tooltip:"Night Racer: export Body, Canopy, Roof for the game"
(
  local f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  if f == undefined do
  (
    local r = getINISetting (getMAXIniFile()) "NightRacer" "root"
    if r != "" and doesFileExist (r + "nightracer_lib.ms") do fileIn (r + "nightracer_lib.ms")
    f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  )
  if f != undefined then f "export"
  else messageBox "Night Racer: run tools/max/nightracer.ms once (Scripting > Run Script)." title:"Night Racer"
)

macroScript NR_ExportAll category:"Night Racer" buttonText:"Export all..." tooltip:"Night Racer: export every car-*.max in a folder"
(
  local f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  if f == undefined do
  (
    local r = getINISetting (getMAXIniFile()) "NightRacer" "root"
    if r != "" and doesFileExist (r + "nightracer_lib.ms") do fileIn (r + "nightracer_lib.ms")
    f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  )
  if f != undefined then f "exportall"
  else messageBox "Night Racer: run tools/max/nightracer.ms once (Scripting > Run Script)." title:"Night Racer"
)

macroScript NR_RenderPack category:"Night Racer" buttonText:"Open render pack..." tooltip:"Night Racer: build the Arnold studio from a render pack"
(
  local f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  if f == undefined do
  (
    local r = getINISetting (getMAXIniFile()) "NightRacer" "root"
    if r != "" and doesFileExist (r + "nightracer_lib.ms") do fileIn (r + "nightracer_lib.ms")
    f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  )
  if f != undefined then f "renderpack"
  else messageBox "Night Racer: run tools/max/nightracer.ms once (Scripting > Run Script)." title:"Night Racer"
)

macroScript NR_RenderStills category:"Night Racer" buttonText:"Render stills" tooltip:"Night Racer: render hero, side and rear"
(
  local f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  if f == undefined do
  (
    local r = getINISetting (getMAXIniFile()) "NightRacer" "root"
    if r != "" and doesFileExist (r + "nightracer_lib.ms") do fileIn (r + "nightracer_lib.ms")
    f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  )
  if f != undefined then f "renderstills"
  else messageBox "Night Racer: run tools/max/nightracer.ms once (Scripting > Run Script)." title:"Night Racer"
)

macroScript NR_RenderTurntable category:"Night Racer" buttonText:"Render turntable" tooltip:"Night Racer: render the turntable frames"
(
  local f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  if f == undefined do
  (
    local r = getINISetting (getMAXIniFile()) "NightRacer" "root"
    if r != "" and doesFileExist (r + "nightracer_lib.ms") do fileIn (r + "nightracer_lib.ms")
    f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  )
  if f != undefined then f "renderturntable"
  else messageBox "Night Racer: run tools/max/nightracer.ms once (Scripting > Run Script)." title:"Night Racer"
)

macroScript NR_RenderAll category:"Night Racer" buttonText:"Render all cars..." tooltip:"Night Racer: render every car's pack"
(
  local f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  if f == undefined do
  (
    local r = getINISetting (getMAXIniFile()) "NightRacer" "root"
    if r != "" and doesFileExist (r + "nightracer_lib.ms") do fileIn (r + "nightracer_lib.ms")
    f = if globalVars.isGlobal #NR_action then globalVars.get #NR_action
  )
  if f != undefined then f "renderall"
  else messageBox "Night Racer: run tools/max/nightracer.ms once (Scripting > Run Script)." title:"Night Racer"
)

macroScript NR_Install category:"Night Racer" buttonText:"Install at startup" tooltip:"Night Racer: load the menu at every start"
(
  local f = if globalVars.isGlobal #NR_install then globalVars.get #NR_install
  if f == undefined do
  (
    local r = getINISetting (getMAXIniFile()) "NightRacer" "root"
    if r != "" and doesFileExist (r + "nightracer_lib.ms") do fileIn (r + "nightracer_lib.ms")
    f = if globalVars.isGlobal #NR_install then globalVars.get #NR_install
  )
  if f != undefined then f()
  else messageBox "Night Racer: run tools/max/nightracer.ms once (Scripting > Run Script)." title:"Night Racer"
)

if NR_ROOT != undefined do
(
  try (NR_menus()) catch (format "Night Racer: could not add the menu: %\n" (getCurrentException()))
  if NR_QUIET != true do NR_panel_open()
)
