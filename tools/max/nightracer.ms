/*
  Night Racer tools for 3ds Max: the loader.

  Scripting > Run Script... > this file.

    3ds Max 2023 and later   the Night Racer dock panel (tools/max/nightracer/,
                             Python): Open, Save; Check with the game's own
                             tests; a drift heatmap; fixes; Export and Export all;
                             and Render: a car's render pack in Arnold.
    3ds Max 2020-2022        the classic panel (nightracer_classic.ms): Open,
                             a box-only Check, Export.

  It also adds a "Night Racer" main menu and a "Night Racer" macro category
  (Customize > Hotkey Editor / toolbars), and remembers where it lives, so
  the menu and macros keep working after a restart. "Install at startup"
  (in the menu) makes Max load the menu on every launch without opening the
  panel.

  Menus: 2025 and later use the new menu system (#cuiRegisterMenus); 2020-2024
  use menuMan. Either way it is one "Night Racer" entry on the main menu bar.
*/

global NR_ROOT
global NR_QUIET  -- set true by the startup script: register, do not open the panel

(
  local here = getFilenamePath (getSourceFileName())
  if here != undefined and doesFileExist (here + "nightracer") do NR_ROOT = here
  if NR_ROOT == undefined do NR_ROOT = getINISetting (getMAXIniFile()) "NightRacer" "root"
  if NR_ROOT == "" or NR_ROOT == undefined do
  (
    messageBox "Night Racer: cannot find the tools/max folder. Run this file from where it lives." title:"Night Racer"
    NR_ROOT = undefined
  )
  if NR_ROOT != undefined do setINISetting (getMAXIniFile()) "NightRacer" "root" NR_ROOT
)

fn NR_maxYear = (maxVersion())[1] / 1000 - 2 + 2000   -- 25000 -> 2023, 27000 -> 2025
fn NR_hasPython = NR_maxYear() >= 2023

fn NR_py code =
(
  -- Puts tools/max on sys.path once, then runs `code`.
  local root = substitutestring NR_ROOT "\\" "/"
  python.Execute ("import sys\nif r'" + root + "' not in sys.path: sys.path.insert(0, r'" + root + "')\n" + code)
)

fn NR_panel_open =
(
  if NR_ROOT == undefined do return false
  if NR_hasPython() then
    NR_py "import importlib, nightracer.core, nightracer.maxio, nightracer.render, nightracer.panel as P\nfor m in (nightracer.core, nightracer.maxio, nightracer.render, P): importlib.reload(m)\nP.show()"
  else
  (
    fileIn (NR_ROOT + "nightracer_classic.ms")
    createDialog NR_panel
  )
  true
)

fn NR_action name =
(
  if NR_ROOT == undefined do return false
  if NR_hasPython() then
    NR_py ("import nightracer.panel as P\nP.action('" + name + "')")
  else
  (
    if NR_panel == undefined do fileIn (NR_ROOT + "nightracer_classic.ms")
    case name of
    (
      "open": NR_open()
      "check": NR_check()
      "export": NR_export()
      default: messageBox "This needs 3ds Max 2023 or later (the Python panel)." title:"Night Racer"
    )
  )
)

fn NR_install =
(
  local f = (getDir #userStartupScripts) + "\\nightracer_startup.ms"
  local s = createFile f
  -- Built by concatenation: MAXScript's format has no escape for a literal %.
  local body = "-- Night Racer: registers the menu and macros at startup (written by nightracer.ms)\n" + \
               "global NR_QUIET = true\n" + \
               "try (fileIn @\"" + NR_ROOT + "nightracer.ms\") catch (print (getCurrentException()))\n" + \
               "NR_QUIET = false\n"
  format "%" body to:s
  close s
  messageBox ("Night Racer will load its menu at every start:\n" + f) title:"Night Racer"
)

macroScript NR_Panel category:"Night Racer" buttonText:"Night Racer" tooltip:"Night Racer: open the panel" (NR_panel_open())
macroScript NR_Open category:"Night Racer" buttonText:"NR Open" tooltip:"Night Racer: open a car style" (NR_action "open")
macroScript NR_Check category:"Night Racer" buttonText:"NR Check" tooltip:"Night Racer: the game's checks" (NR_action "check")
macroScript NR_Heatmap category:"Night Racer" buttonText:"NR Heatmap" tooltip:"Night Racer: drift heatmap" (NR_action "heatmap")
macroScript NR_Snap category:"Night Racer" buttonText:"NR Snap" tooltip:"Night Racer: snap selected verts to the Envelope" (NR_action "snap")
macroScript NR_Symmetric category:"Night Racer" buttonText:"NR Symmetric" tooltip:"Night Racer: make the selected shell symmetric" (NR_action "symmetric")
macroScript NR_Export category:"Night Racer" buttonText:"NR Export" tooltip:"Night Racer: export Body, Canopy, Roof for the game" (NR_action "export")
macroScript NR_ExportAll category:"Night Racer" buttonText:"NR Export all" tooltip:"Night Racer: export every car-*.max in a folder" (NR_action "exportall")
macroScript NR_RenderPack category:"Night Racer" buttonText:"NR Render pack" tooltip:"Night Racer: build the Arnold studio from a render pack" (NR_action "renderpack")
macroScript NR_RenderStills category:"Night Racer" buttonText:"NR Render stills" tooltip:"Night Racer: render hero, side and rear" (NR_action "renderstills")
macroScript NR_RenderTurntable category:"Night Racer" buttonText:"NR Turntable" tooltip:"Night Racer: render the turntable frames" (NR_action "renderturntable")
macroScript NR_Install category:"Night Racer" buttonText:"NR Install at startup" tooltip:"Night Racer: load the menu at every start" (NR_install())

-- ---------------------------------------------------------------- menus
global NR_MENU_ITEMS = #( \
  #("NR_Panel", "Night Racer panel"), #("NR_Open", "Open style..."), #("NR_Check", "Check"), \
  #("NR_Heatmap", "Heatmap"), #("NR_Snap", "Snap verts to Envelope"), #("NR_Symmetric", "Make symmetric"), \
  #("NR_Export", "Export for game"), #("NR_ExportAll", "Export all..."), \
  #("NR_RenderPack", "Open render pack..."), #("NR_RenderStills", "Render stills"), \
  #("NR_RenderTurntable", "Render turntable"), #("NR_Install", "Install at startup"))

-- 2025+: the new menu system builds menus from #cuiRegisterMenus callbacks.
fn NR_registerMenus =
(
  local mgr = callbacks.notificationParam()
  local bar = mgr.mainMenuBar
  local sub = bar.CreateSubMenu "a3c1e5d0-4b7f-4f0e-9a52-7b1d2c3e4f50" "Night Racer"
  local i = 0
  for it in NR_MENU_ITEMS do
  (
    i += 1
    -- 647394 is the macroScript action table; the id is "macro`category".
    sub.CreateAction ("a3c1e5d0-4b7f-4f0e-9a52-7b1d2c3e4f" + (formattedPrint (50 + i) format:"02d")) 647394 (it[1] + "`Night Racer")
  )
)

fn NR_menus =
(
  if NR_maxYear() >= 2025 then
  (
    callbacks.removeScripts id:#NightRacerMenus
    callbacks.addScript #cuiRegisterMenus NR_registerMenus id:#NightRacerMenus
    -- Rebuild now, so the menu appears in this session too.
    try
    (
      local mm = maxOps.GetICuiMenuMgr()
      mm.LoadConfiguration (mm.GetCurrentConfiguration())
    )
    catch (format "Night Racer: the menu appears after a restart (%)\n" (getCurrentException()))
  )
  else
  (
    local old = menuMan.findMenu "Night Racer"
    if old != undefined do menuMan.unRegisterMenu old
    local m = menuMan.createMenu "Night Racer"
    for it in NR_MENU_ITEMS do m.addItem (menuMan.createActionItem it[1] "Night Racer") -1
    local bar = menuMan.getMainMenuBar()
    bar.addItem (menuMan.createSubMenuItem "Night Racer" m) (bar.numItems() + 1)
    menuMan.updateMenuBar()
  )
)

if NR_ROOT != undefined do
(
  try (NR_menus()) catch (format "Night Racer: could not add the menu: %\n" (getCurrentException()))
  if NR_QUIET != true do NR_panel_open()
)
