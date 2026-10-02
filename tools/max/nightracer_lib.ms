/*
  Night Racer tools for 3ds Max: the library.

  The functions the loader (nightracer.ms), the menu and the macros share.
  fileIn'd by the loader, and by any Night Racer macro that finds them
  missing: macroScripts outlive the session that defined them (Max keeps a
  copy in UI\usermacros), the functions they call do not, so after a
  restart a macro reloads this file from the folder remembered in the INI
  ([NightRacer] root=) and carries on.
*/

global NR_ROOT
global NR_QUIET   -- true: register menus and macros, do not open the panel
-- Defined by nightracer_classic.ms (3ds Max 2020-2022), which is fileIn'd at
-- run time. Declared here so the functions below compile these names as
-- globals, not as implicit locals that stay undefined.
global NR_panel, NR_open, NR_check, NR_export

if NR_ROOT == undefined or NR_ROOT == "" do NR_ROOT = getINISetting (getMAXIniFile()) "NightRacer" "root"
if NR_ROOT == "" do NR_ROOT = undefined

-- macro name, menu label
global NR_MENU_ITEMS = #( \
  #("NR_Panel", "Night Racer panel"), #("NR_Open", "Open style..."), #("NR_Check", "Check"), \
  #("NR_Heatmap", "Heatmap"), #("NR_Snap", "Snap verts to Envelope"), #("NR_Symmetric", "Make symmetric"), \
  #("NR_Export", "Export for game"), #("NR_ExportAll", "Export all..."), \
  #("NR_RenderPack", "Open render pack..."), #("NR_RenderStills", "Render stills"), \
  #("NR_RenderTurntable", "Render turntable"), #("NR_RenderAll", "Render all cars..."), \
  #("NR_Install", "Install at startup"))

fn NR_maxYear = (maxVersion())[1] / 1000 - 2 + 2000   -- 25000 -> 2023, 27000 -> 2025, 28000 -> 2026
fn NR_hasPython = NR_maxYear() >= 2023

fn NR_py code =
(
  -- Python reads the folder from the MAXScript global itself, so no
  -- character in the path (an apostrophe, a backslash) is ever pasted
  -- into Python source.
  python.Execute ("import sys\nfrom pymxs import runtime as _rt\n_p = str(_rt.NR_ROOT).replace(chr(92), '/')\nif _p not in sys.path: sys.path.insert(0, _p)\n" + code)
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
    sub.CreateAction ("a3c1e5d0-4b7f-4f0e-9a52-7b1d2c3e4f" + (formattedPrint (50 + i) format:"02d")) 647394 (it[1] + "`Night Racer") title:it[2]
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
    for it in NR_MENU_ITEMS do
    (
      local a = menuMan.createActionItem it[1] "Night Racer"
      if a != undefined do
      (
        a.setTitle it[2]
        a.setUseCustomTitle true
        m.addItem a -1
      )
    )
    local bar = menuMan.getMainMenuBar()
    bar.addItem (menuMan.createSubMenuItem "Night Racer" m) (bar.numItems() + 1)
    menuMan.updateMenuBar()
  )
)
