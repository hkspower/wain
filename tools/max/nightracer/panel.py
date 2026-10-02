"""The Night Racer dock panel for 3ds Max 2023 and later.

Opened by tools/max/nightracer.ms (or its menu / macros). One dock, five
sections: File, Check, Heatmap, Fix, Export. Settings live in QSettings
("NightRacer", "MaxTools"): the work folder, Symmetry-on-open, the heatmap
thresholds, and where the dock was.
"""
import math
import os
import traceback

try:  # 3ds Max 2025+
    from PySide6 import QtCore, QtGui, QtWidgets
except ImportError:  # 2023-2024
    from PySide2 import QtCore, QtGui, QtWidgets

import pymxs
from pymxs import runtime as rt

from . import maxio, render

GAME_TOL_MM = 10.0
_dock = None


def _mm(v):
    return "--" if v is None or (isinstance(v, float) and math.isnan(v)) else "%.1f" % (v * 1000.0)


class Panel(QtWidgets.QWidget):
    COLS = ("Slot", "Box mm", "Skin mm", "Mirror %", "Open", "Facing", "Tris", "Verdict")

    def __init__(self, parent=None):
        super().__init__(parent)
        self.settings = QtCore.QSettings("NightRacer", "MaxTools")
        lay = QtWidgets.QVBoxLayout(self)
        lay.setContentsMargins(6, 6, 6, 6)

        self.style_label = QtWidgets.QLabel("No style open")
        self.style_label.setStyleSheet("font-weight: bold;")
        lay.addWidget(self.style_label)

        # File
        box = QtWidgets.QGroupBox("File")
        g = QtWidgets.QGridLayout(box)
        self.sym = QtWidgets.QCheckBox("Symmetry modifier on open")
        self.sym.setChecked(self.settings.value("symmetry", False, type=bool))
        self.sym.toggled.connect(lambda v: self.settings.setValue("symmetry", v))
        g.addWidget(self.sym, 0, 0, 1, 2)
        g.addWidget(self._btn("Open style...", self.on_open), 1, 0)
        g.addWidget(self._btn("Save work", self.on_save), 1, 1)
        lay.addWidget(box)

        # Check
        box = QtWidgets.QGroupBox("Check (the game's own tests)")
        v = QtWidgets.QVBoxLayout(box)
        v.addWidget(self._btn("Check", self.on_check))
        self.table = QtWidgets.QTableWidget(3, len(self.COLS))
        self.table.setHorizontalHeaderLabels(self.COLS)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QtWidgets.QAbstractItemView.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(QtWidgets.QHeaderView.ResizeToContents)
        self.table.setMinimumHeight(110)
        v.addWidget(self.table)
        self.notes = QtWidgets.QLabel("")
        self.notes.setWordWrap(True)
        v.addWidget(self.notes)
        lay.addWidget(box)

        # Heatmap
        box = QtWidgets.QGroupBox("Heatmap (crowned distance to the game's shell)")
        g = QtWidgets.QGridLayout(box)
        self.green = QtWidgets.QDoubleSpinBox()
        self.red = QtWidgets.QDoubleSpinBox()
        for w, key, d in ((self.green, "green", 5.0), (self.red, "red", 10.0)):
            w.setRange(0.5, 50.0)
            w.setSuffix(" mm")
            w.setValue(self.settings.value(key, d, type=float))
            w.valueChanged.connect(lambda val, k=key: self.settings.setValue(k, val))
        g.addWidget(QtWidgets.QLabel("green under"), 0, 0)
        g.addWidget(self.green, 0, 1)
        g.addWidget(QtWidgets.QLabel("red over"), 1, 0)
        g.addWidget(self.red, 1, 1)
        g.addWidget(self._btn("Build heatmap", self.on_heat), 2, 0)
        self.heat_toggle = self._btn("Show heatmap", self.on_heat_toggle)
        g.addWidget(self.heat_toggle, 2, 1)
        lay.addWidget(box)

        # Fix
        box = QtWidgets.QGroupBox("Fix")
        g = QtWidgets.QGridLayout(box)
        g.addWidget(self._btn("Snap selected verts to Envelope", self.on_snap), 0, 0, 1, 2)
        g.addWidget(self._btn("Make symmetric", self.on_sym), 1, 0)
        g.addWidget(self._btn("Recentre on X = 0", self.on_centre), 1, 1)
        g.addWidget(self._btn("Turn outward", self.on_outward), 2, 0)
        self.replace_slot = QtWidgets.QComboBox()
        self.replace_slot.addItems(maxio.SLOTS)
        self.replace_slot.setCurrentText("Canopy")
        g.addWidget(self.replace_slot, 3, 0)
        g.addWidget(self._btn("Replace with Envelope", self.on_replace), 3, 1)
        lay.addWidget(box)

        # Export
        box = QtWidgets.QGroupBox("Export")
        g = QtWidgets.QGridLayout(box)
        g.addWidget(self._btn("Export for game", self.on_export), 0, 0)
        g.addWidget(self._btn("Export all .max in folder...", self.on_export_all), 0, 1)
        lay.addWidget(box)

        # Render (Arnold)
        box = QtWidgets.QGroupBox("Render (Arnold, the studio set)")
        g = QtWidgets.QGridLayout(box)
        g.addWidget(self._btn("Open render pack...", self.on_open_pack), 0, 0, 1, 2)
        self.shot_boxes = {}
        row = QtWidgets.QHBoxLayout()
        for name in ("hero", "side", "rear"):
            cb = QtWidgets.QCheckBox(name)
            cb.setChecked(self.settings.value("shot_" + name, True, type=bool))
            cb.toggled.connect(lambda v, n=name: self.settings.setValue("shot_" + n, v))
            self.shot_boxes[name] = cb
            row.addWidget(cb)
        g.addLayout(row, 1, 0, 1, 2)
        self.res = QtWidgets.QComboBox()
        self.res.addItems(["Full (pack size)", "Half (test)"])
        self.res.setCurrentIndex(self.settings.value("res", 0, type=int))
        self.res.currentIndexChanged.connect(lambda i: self.settings.setValue("res", i))
        g.addWidget(self.res, 2, 0)
        self.aa = QtWidgets.QSpinBox()
        self.aa.setRange(1, 12)
        self.aa.setPrefix("AA ")
        self.aa.setValue(self.settings.value("aa", 6, type=int))
        self.aa.valueChanged.connect(lambda v: self.settings.setValue("aa", v))
        g.addWidget(self.aa, 2, 1)
        self.light_scale = QtWidgets.QDoubleSpinBox()
        self.light_scale.setRange(0.05, 20.0)
        self.light_scale.setSingleStep(0.1)
        self.light_scale.setPrefix("lights x")
        self.light_scale.setValue(self.settings.value("light_scale", 1.0, type=float))
        self.light_scale.valueChanged.connect(lambda v: self.settings.setValue("light_scale", v))
        g.addWidget(self.light_scale, 3, 0)
        self.frames = QtWidgets.QSpinBox()
        self.frames.setRange(1, 720)
        self.frames.setSuffix(" frames")
        self.frames.setValue(self.settings.value("frames", 120, type=int))
        self.frames.valueChanged.connect(lambda v: self.settings.setValue("frames", v))
        g.addWidget(self.frames, 3, 1)
        g.addWidget(self._btn("Render stills", self.on_render_stills), 4, 0)
        g.addWidget(self._btn("Render turntable", self.on_render_turntable), 4, 1)
        g.addWidget(self._btn("Show render log", self.on_render_log), 5, 0, 1, 2)
        lay.addWidget(box)
        self.scene = None
        lay.addStretch(1)
        self.refresh_style()

    # ------------------------------------------------------------ helpers
    def _btn(self, text, fn):
        b = QtWidgets.QPushButton(text)
        b.clicked.connect(lambda: self._run(fn))
        return b

    def _run(self, fn):
        QtWidgets.QApplication.setOverrideCursor(QtCore.Qt.WaitCursor)
        try:
            fn()
        except Exception as e:  # show it, and keep the panel alive
            traceback.print_exc()
            QtWidgets.QMessageBox.warning(self, "Night Racer", str(e))
        finally:
            QtWidgets.QApplication.restoreOverrideCursor()
            self.refresh_style()

    def _info(self, text):
        QtWidgets.QMessageBox.information(self, "Night Racer", text)

    def refresh_style(self):
        if getattr(self, "scene", None) is not None:
            spec = self.scene["spec"]
            self.style_label.setText("Render pack: %s" % spec.get("name", spec["car"]))
            return
        style = maxio.file_prop("nr_style")
        data = "" if maxio.style_info() else "  (no style data: re-open the FBX)"
        self.style_label.setText(("Style: %s" % style + data) if style else "No style open")

    def _progress(self, what, i, n):
        rt.progressUpdate(100.0 * i / max(1, n))

    # ------------------------------------------------------------ actions
    def on_open(self):
        start = self.settings.value("folder", "", type=str)
        path, _ = QtWidgets.QFileDialog.getOpenFileName(self, "Open a car style", start,
                                                        "Night Racer FBX (car-*.fbx);;FBX (*.fbx)")
        if not path:
            return
        if not rt.checkForSave():
            return
        self.settings.setValue("folder", os.path.dirname(path))
        self.scene = None
        style, has = maxio.open_style(path, self.sym.isChecked())
        if not has:
            self._info("Opened %s, but car-%s.nr.json was not beside it: the checks need it. "
                       "Copy it next to the FBX (npm run max:export writes both) and open again." % (style, style))

    def on_save(self):
        self._info("Saved %s" % maxio.save_work())

    def on_check(self):
        res = maxio.check()
        notes = []
        for row, slot in enumerate(("body", "canopy", "roof")):
            v = res[slot]
            m = v.get("mirror", {})
            cells = [slot.capitalize(), _mm(v.get("box")), _mm(v.get("skin")),
                     "%.1f" % (m.get("share", 0) * 100) if m else "--", str(m.get("open", "--")),
                     "inside-out" if v.get("insideOut") else "out", str(v.get("tris", "--")),
                     "ok" if v.get("gameOk") else "REJECTED"]
            for col, text in enumerate(cells):
                it = QtWidgets.QTableWidgetItem(text)
                bad = ((col == 1 and v.get("box") is not None and v["box"] * 1000 > GAME_TOL_MM)
                       or (col == 2 and v.get("skin") is not None and v["skin"] * 1000 > GAME_TOL_MM)
                       or (col == 3 and m and m.get("share", 1) < 0.995)
                       or (col == 4 and m and m.get("open", 0) > 0)
                       or (col == 5 and v.get("insideOut"))
                       or (col == 7 and not v.get("gameOk")))
                it.setForeground(QtGui.QColor("#e04040") if bad else QtGui.QColor("#40b060"))
                self.table.setItem(row, col, it)
            if not v.get("ok", True):
                where = (" (worst at the %s)" % v["face"][0]) if v.get("face") and (v.get("box") or 0) > 0.01 else ""
                notes.append("%s: %s%s%s" % (slot.capitalize(), v.get("reason"), where,
                                             "; already rejected in the game today, see Fix > Replace with Envelope"
                                             if v.get("alreadyRejected") else ""))
            if m and not m.get("ok", True):
                notes.append("%s: not symmetric (%.1f%% twins, %d open edges): Fix > Make symmetric."
                             % (slot.capitalize(), m["share"] * 100, m["open"]))
            if v.get("overBudget"):
                notes.append("%s: over 1.5x the shipped triangle count; every car on the road pays for it." % slot.capitalize())
        self.notes.setText("\n".join(notes) if notes else "Everything passes the game's tests. Export for game.")

    def on_heat(self):
        rt.progressStart("Night Racer heatmap")
        try:
            made = maxio.heatmap(self.green.value(), self.red.value(), self._progress)
        finally:
            rt.progressEnd()
        self.heat_toggle.setText("Show shells")
        self._info("Heatmap on NR_Heatmap.\n" + "\n".join("%s: worst %s mm" % (s, _mm(w)) for s, w in made))

    def on_heat_toggle(self):
        on = self.heat_toggle.text() == "Show heatmap"
        maxio.show_heatmap(on)
        self.heat_toggle.setText("Show shells" if on else "Show heatmap")

    def on_snap(self):
        n, worst = maxio.snap_selected_verts()
        self._info("Snapped %d vertices to the Envelope (furthest moved %s mm)." % (n, _mm(worst)))

    def on_sym(self):
        maxio.make_symmetric()

    def on_centre(self):
        moved = maxio.recentre()
        self._info("Moved %.1f mm onto X = 0." % (moved * 1000))

    def on_outward(self):
        f = maxio.turn_outward()
        self._info(("Turned outward: " + ", ".join(f)) if f else "Every shell already faces outward.")

    def on_replace(self):
        slot = self.replace_slot.currentText()
        if QtWidgets.QMessageBox.question(self, "Night Racer",
                                          "Replace %s with the fresh loft (Envelope)? Your edits to %s are lost "
                                          "(Undo works)." % (slot, slot)) != QtWidgets.QMessageBox.Yes:
            return
        with pymxs.undo(True, "Night Racer: replace %s" % slot):
            maxio.replace_with_envelope(slot)
        self.on_check()

    def on_export(self):
        res = maxio.check()
        bad = [s for s, v in res.items() if not v.get("gameOk")]
        if bad and QtWidgets.QMessageBox.question(
                self, "Night Racer", "The game would reject: %s.\nExport anyway? (npm run max:import will refuse "
                "it unless it was already rejected.)" % ", ".join(bad)) != QtWidgets.QMessageBox.Yes:
            return
        out = maxio.export_for_game()
        self._info("Wrote\n%s\n\nIn the repo:\n  npm run max:import -- \"%s\"" % (out, os.path.dirname(out)))

    def on_export_all(self):
        folder = QtWidgets.QFileDialog.getExistingDirectory(self, "Folder of car-*.max files",
                                                            self.settings.value("folder", "", type=str))
        if not folder or not rt.checkForSave():
            return
        rt.progressStart("Night Racer: export all")
        try:
            done = maxio.export_all(folder, self._progress)
        finally:
            rt.progressEnd()
        self._info("\n".join("%s -> %s" % d for d in done) or "No car-*.max files in that folder.")


    # ------------------------------------------------------------ render
    def on_open_pack(self):
        start = self.settings.value("pack_folder", "", type=str)
        folder = QtWidgets.QFileDialog.getExistingDirectory(self, "Render pack (folder with studio.json)", start)
        if not folder:
            return
        if not os.path.exists(os.path.join(folder, "studio.json")):
            raise RuntimeError("No studio.json in that folder. Make a pack with npm run max:render-pack.")
        if not rt.checkForSave():
            return
        self.settings.setValue("pack_folder", folder)
        self.scene = render.open_pack(folder, self.light_scale.value())
        spec = self.scene["spec"]
        self._info("Studio built for %s.\n\n%s" % (spec.get("name"), "\n".join(render.LOG[-8:])))

    def _need_scene(self):
        if self.scene is None:
            raise RuntimeError("Open a render pack first.")
        return self.scene

    def _scale(self, w, h):
        return (w // 2, h // 2) if self.res.currentIndex() == 1 else (w, h)

    def on_render_stills(self):
        sc = self._need_scene()
        shots = [n for n, cb in self.shot_boxes.items() if cb.isChecked()]
        if not shots:
            raise RuntimeError("Tick at least one shot.")
        st = sc["spec"]["stills"]
        w, h = self._scale(st["width"], st["height"])
        rt.progressStart("Night Racer: render stills")
        try:
            done = render.render_stills(sc, shots, w, h, self.aa.value(), self._progress)
        finally:
            rt.progressEnd()
        out = os.path.dirname(done[0])
        self._info("Rendered %d still(s) to\n%s\n\nGrade them like the Blender set (ACES):\n"
                   "  npm run max:finish -- \"%s\"" % (len(done), out, out))

    def on_render_turntable(self):
        sc = self._need_scene()
        tt = sc["spec"]["turntable"]
        w, h = self._scale(tt["width"], tt["height"])
        rt.progressStart("Night Racer: render turntable")
        try:
            out = render.render_turntable(sc, self.frames.value(), w, h, max(1, self.aa.value() - 2), self._progress)
        finally:
            rt.progressEnd()
        self._info("Rendered %d frames to\n%s\n\nMake the MP4 (and grade the frames):\n"
                   "  npm run max:finish -- \"%s\"" % (self.frames.value(), out, os.path.dirname(out)))

    def on_render_log(self):
        self._info("\n".join(render.LOG) or "Nothing logged yet.")


def show():
    """Open (or raise) the dock, where it was last time."""
    global _dock
    import qtmax
    main = qtmax.GetQMaxMainWindow()
    if _dock is not None:
        try:
            _dock.show()
            _dock.raise_()
            return _dock
        except RuntimeError:  # the C++ side was deleted with the old window
            _dock = None
    _dock = QtWidgets.QDockWidget("Night Racer", main)
    _dock.setObjectName("NightRacerDock")  # lets Max remember where it was docked
    _dock.setWidget(Panel())
    _dock.setAllowedAreas(QtCore.Qt.LeftDockWidgetArea | QtCore.Qt.RightDockWidgetArea)
    main.addDockWidget(QtCore.Qt.RightDockWidgetArea, _dock)
    _dock.show()
    return _dock


def action(name):
    """Entry point for the macroScripts: run one panel action, panel or not."""
    p = show().widget()
    fn = {"open": p.on_open, "check": p.on_check, "heatmap": p.on_heat, "export": p.on_export,
          "exportall": p.on_export_all, "snap": p.on_snap, "symmetric": p.on_sym, "recentre": p.on_centre,
          "outward": p.on_outward, "replace": p.on_replace, "save": p.on_save,
          "renderpack": p.on_open_pack, "renderstills": p.on_render_stills,
          "renderturntable": p.on_render_turntable}.get(name)
    if fn:
        p._run(fn)
