#!/usr/bin/env python3
"""npm run test:showcase — grn_showcase.py's control flow, without an engine.

A stand-in `unreal` module: every class and function answers, a static
mesh is a small object with the bounds the real importer would give (the
axis probe comes back with Y and Z swapped and x100, as Unreal's glTF
path does; the car comes back 4.66 m along X once the yaw is applied),
and the paint slot is called paint. Then `build` runs end to end.

What this catches: a misspelled name, a wrong argument count, a branch
that never ran, an exception path. What it cannot catch: whether the
real engine's classes and properties are called what this code calls
them — that is `run.sh probe` on the Mac.
"""
import builtins
import importlib
import os
import sys
import types
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import showcase_math as sm  # noqa: E402

PROBE_BOUNDS = ((0.0, 0.0, 0.0), (300.0, 200.0, 100.0))        # glTF (3,1,2) m -> X, Z, Y swapped, cm
CAR_BOUNDS = ((-233.0, -103.0, 0.0), (233.0, 103.0, 148.0))      # 4.66 x 2.06 x 1.48 m, nose on +X


class V:
    def __init__(self, x, y, z):
        self.x, self.y, self.z = x, y, z

    def length(self):
        return (self.x ** 2 + self.y ** 2 + self.z ** 2) ** 0.5


class Bounds:
    def __init__(self, mn, mx):
        self.origin = V(*[(a + b) / 2 for a, b in zip(mn, mx)])
        self.box_extent = V(*[(b - a) / 2 for a, b in zip(mn, mx)])


class Slot:
    def __init__(self, name):
        self.name = name

    def get_editor_property(self, k):
        return {"material_slot_name": self.name, "material_interface": mock.MagicMock()}[k]


class StaticMesh:
    def __init__(self, path):
        self.path = path
        self.name = path.rsplit("/", 1)[-1]
        self.materials = {}

    def get_bounds(self):
        return Bounds(*(PROBE_BOUNDS if "Probe" in self.name else CAR_BOUNDS))

    def get_path_name(self):
        return self.path

    def get_name(self):
        return self.name

    def get_editor_property(self, k):
        assert k == "static_materials", k
        return [Slot("glass"), Slot("paint"), Slot("tire")]

    def set_material(self, i, m):
        self.materials[i] = m


class Task:
    def __init__(self):
        self.p = {}

    def set_editor_property(self, k, v):
        self.p[k] = v

    def get_editor_property(self, k):
        assert k == "imported_object_paths"
        return [f"{self.p['destination_path']}/{self.p['destination_name']}"]


def make_unreal():
    u = mock.MagicMock(name="unreal")
    logs = {"log": [], "warn": [], "error": []}
    u.log = lambda m: logs["log"].append(str(m))
    u.log_warning = lambda m: logs["warn"].append(str(m))
    u.log_error = lambda m: logs["error"].append(str(m))
    u.StaticMesh = StaticMesh
    u.AssetImportTask = Task
    u.load_asset = lambda p: StaticMesh(p) if ("SM_" in p or "Probe" in p) else mock.MagicMock(name=p)
    # a transform section hands back nine real channels so the turntable keys are exercised
    chans = [mock.MagicMock(name=f"ch{i}") for i in range(9)]
    u.MovieScene3DTransformTrack = "MovieScene3DTransformTrack"
    section = mock.MagicMock(name="section")
    section.get_all_channels.return_value = chans
    track = mock.MagicMock(name="track")
    track.add_section.return_value = section
    binding = mock.MagicMock(name="binding")
    binding.add_track.return_value = track
    seq = mock.MagicMock(name="sequence")
    seq.add_possessable.return_value = binding
    u.AssetToolsHelpers.get_asset_tools.return_value.create_asset.return_value = seq
    return u, logs, chans


def run(cmd):
    u, logs, chans = make_unreal()
    sys.modules["unreal"] = u
    sys.modules.pop("grn_showcase", None)
    os.environ["GRN_KEEP_EDITOR"] = "1"
    sys.argv = ["grn_showcase.py", cmd]
    # the real GLB must still be readable; only the report's write is faked
    real_open = builtins.open

    def side(path, *a, **k):
        if str(path).endswith("build.json") and a and "w" in a[0]:
            return mo.return_value
        return real_open(path, *a, **k)

    with mock.patch("builtins.open", mock.mock_open()) as mo, mock.patch("os.makedirs"):
        mo.side_effect = side
        mod = importlib.import_module("grn_showcase")
    return mod, u, logs, chans


fail = []


def check(c, m):
    if not c:
        fail.append(m)


mod, u, logs, chans = run("probe")
check(any("probe:" in m for m in logs["log"]), "probe did not reach its verdict")
check(not logs["error"], f"probe logged errors: {logs['error']}")
print("probe       ok" if not fail else "probe       FAIL")

n0 = len(fail)
mod, u, logs, chans = run("build")
check(not logs["error"], f"build logged errors:\n  " + "\n  ".join(logs["error"]))
check(any("build done" in m for m in logs["log"]), "build did not finish")
check(any("yaw -90.0" in m for m in logs["log"]), f"the Y/Z-swapped probe should call for yaw -90; log: {[m for m in logs['log'] if 'yaw' in m]}")
check(any("nose on +X" in m for m in logs["log"]), "the imported car was not accepted as nose-on-+X")
check(any("paint slot 1 wears" in m for m in logs["log"]), "the paint slot called paint (index 1) was not dressed")
check(any("studio: floor, dome, car, 5 lights, 4 cameras" in m for m in logs["log"]), "the studio did not get 5 lights and 4 cameras")
check(sum("sequence " in m for m in logs["log"]) == 5, "expected 5 sequences (hero, side, rear, turntable, night)")
check(sum("preset " in m for m in logs["log"]) == 4, "expected 4 MRQ presets")
# turntable keys: every channel keyed at 0, yaw (channel 5) also at the last frame
check(all(ch.add_key.call_count >= 1 for ch in chans), "not every transform channel was keyed at frame 0")
check(chans[5].add_key.call_count == 2, f"the yaw channel has {chans[5].add_key.call_count} keys, expected 2")
if chans[5].add_key.call_args_list:
    yaw_end = chans[5].add_key.call_args_list[-1].args[1]
    check(abs(yaw_end - 360.0) < 1e-9, f"the turntable ends at yaw {yaw_end}, expected 360")
check(not logs["warn"], "build warned where the stand-in should have answered everything:\n  " + "\n  ".join(logs["warn"]))
print("build       ok" if len(fail) == n0 else "build       FAIL")

# the night executor and the start-up hook at least import against the stand-in
n0 = len(fail)
sys.modules["unreal"].SystemLibrary.get_command_line.return_value = "-game -GRNNight=city"
for name in ("grn_night", "init_unreal"):
    sys.modules.pop(name, None)
    try:
        importlib.import_module(name)
    except Exception as e:  # noqa: BLE001
        fail.append(f"{name} does not import: {e}")
print("night       ok" if len(fail) == n0 else "night       FAIL")

if fail:
    print("\nFAIL\n  " + "\n  ".join(fail))
    sys.exit(1)
print("\nok")
