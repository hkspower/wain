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
import io
import json
import os
import re
import sys
import types
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import showcase_math as sm  # noqa: E402

PROBE_BOUNDS = ((0.0, 0.0, 0.0), (300.0, 200.0, 100.0))        # glTF (3,1,2) m -> X, Z, Y swapped, cm
def car_bounds(slug):
    """What the importer hands back for a car once the yaw is applied: its
    card length along X, nose on +X, 2 m across, 1.4 m tall."""
    card = next((c.get("lengthM") for c in sm.catalogue() if c["id"].replace("-", "_") == slug), 4.6) or 4.6
    h = card * 50.0
    return ((-h, -100.0, 0.0), (h, 100.0, 140.0))


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
        if "Probe" in self.name or "AxisProbe" in self.path:
            return Bounds(*PROBE_BOUNDS)
        slug = re.match(r"SM_(.+?)(?:_import)?$", self.name).group(1)
        return Bounds(*car_bounds(slug))

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
    u.load_asset = lambda p: StaticMesh(p) if ("/SM_" in p or "Probe" in p) else mock.MagicMock(name=p)
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


CAPTURED = {}


class Cap(io.StringIO):
    def __init__(self, path):
        super().__init__()
        self.path = str(path)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        CAPTURED[self.path] = self.getvalue()
        self.close()


def run(*argv):
    u, logs, chans = make_unreal()
    sys.modules["unreal"] = u
    sys.modules.pop("grn_showcase", None)
    os.environ["GRN_KEEP_EDITOR"] = "1"
    sys.argv = ["grn_showcase.py", *argv]
    CAPTURED.clear()
    real_open = builtins.open

    def side(path, *a, **k):
        # the reports are captured, never written; the GLBs are read for real
        if str(path).endswith(("build.json", "fleet.json")) and a and "w" in a[0]:
            return Cap(path)
        if str(path).endswith("fleet.json"):
            raise FileNotFoundError(path)
        return real_open(path, *a, **k)

    with mock.patch("builtins.open", side), mock.patch("os.makedirs"):
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

# one car, then the fleet
n0 = len(fail)
mod, u, logs, chans = run("build", "black-demon")
check(not logs["error"], "build black-demon logged errors:\n  " + "\n  ".join(logs["error"]))
check(not logs["warn"], "build black-demon warned:\n  " + "\n  ".join(logs["warn"]))
check(sum("built in" in m for m in logs["log"]) == 1, "one car should build exactly once")
check(any("yaw -90.0" in m for m in logs["log"]), f"the Y/Z-swapped probe should call for yaw -90; {[m for m in logs['log'] if 'yaw' in m]}")
check(any("paint slot 1 wears" in m for m in logs["log"]), "the paint slot called paint (index 1) was not dressed")
fleet = json.loads(CAPTURED.get(sm.FLEET_JSON, "{}") or "{}")
check(list(fleet.get("cars", {})) == ["black-demon"], f"fleet.json for one car: {list(fleet.get('cars', {}))}")
# the black demon gets a turntable: every channel keyed at 0, yaw (channel 5) also at the last frame
check(all(ch.add_key.call_count >= 1 for ch in chans), "not every transform channel was keyed at frame 0")
check(chans[5].add_key.call_count == 2, f"the yaw channel has {chans[5].add_key.call_count} keys, expected 2")
if chans[5].add_key.call_args_list:
    yaw_end = chans[5].add_key.call_args_list[-1].args[1]
    check(abs(yaw_end - 360.0) < 1e-9, f"the turntable ends at yaw {yaw_end}, expected 360")
print("build one   ok" if len(fail) == n0 else "build one   FAIL")

# the same car on a read machine: the presets take the profile and the report says so
n0 = len(fail)
mod, u, logs, chans = run("build", "black-demon", "--mac-memory-gb=8", "--mac-gpu-cores=8", "--mac-perf-cores=4", "--mac-chip=Apple M2")
check(not logs["error"], "build on an M2 logged errors:\n  " + "\n  ".join(logs["error"]))
check(any("machine: Apple M2, 8 GB" in m for m in logs["log"]), "build did not log the machine profile it was given")
check(any("MRQ_still:" in m and "2x2 tiles" in m for m in logs["log"]), f"on 8 GB the fleet still should be 2x2 tiles: {[m for m in logs['log'] if 'MRQ_still' in m]}")
check(any("MRQ_still4k:" in m and "3x3 tiles" in m for m in logs["log"]), "on 8 GB the 4K still should be 3x3 tiles")
bj = next((v for k, v in CAPTURED.items() if k.endswith("black-demon/build.json") or k.endswith("black_demon/build.json")), None)
machine = (json.loads(bj) if bj else {}).get("machine", {})
check(machine.get("memory_gb") == 8 and machine.get("pool_mb") == 2048 and machine.get("fleet", {}).get("tiles") == 2,
      f"build.json does not record the machine the presets were sized for: {machine}")
print("build m2    ok" if len(fail) == n0 else "build m2    FAIL")

n0 = len(fail)
mod, u, logs, chans = run("build", "all")
have = [c for c in sm.car_ids() if sm.glb_path(c)]
check(not logs["error"], "build all logged errors:\n  " + "\n  ".join(logs["error"]))
fleet = json.loads(CAPTURED.get(sm.FLEET_JSON, "{}") or "{}")
built = [c for c, v in fleet.get("cars", {}).items() if v["status"] == "built"]
check(sorted(built) == sorted(have), f"built {len(built)} cars, GLBs for {len(have)}")
check(len(fleet.get("cars", {})) == len(sm.car_ids()), f"fleet.json lists {len(fleet.get('cars', {}))} cars, the catalogue has {len(sm.car_ids())}")
check(all(not v.get("warnings") for v in fleet["cars"].values() if v["status"] == "built"),
      "a car built with warnings:\n  " + "\n  ".join(f"{c}: {v['warnings']}" for c, v in fleet["cars"].items() if v.get("warnings")))
n = len(have)
check(sum("built in" in m for m in logs["log"]) == n, f"expected {n} 'built in' lines")
check(sum("studio: floor, dome, car, 5 lights, 4 cameras" in m for m in logs["log"]) == n, f"expected {n} studios")
check(sum("sequence " in m for m in logs["log"]) == 4 * n + 1, f"expected {4 * n + 1} sequences (hero, side, rear, night per car, one turntable)")
check(sum("preset " in m for m in logs["log"]) == 4 * n + 1, f"expected {4 * n + 1} MRQ presets")
check(sum("nose on +X" in m for m in logs["log"]) == n, f"expected {n} cars accepted as nose-on-+X")
# the axis probe runs once per run, not once per car
check(sum("axis probe:" in m for m in logs["log"]) == 1, "the axis probe should run exactly once")
for cid in built:
    b = CAPTURED.get(os.path.join(sm.OUT_ROOT, cid, "build.json"))
    check(bool(b) and json.loads(b)["car"] == cid, f"{cid}: no build.json")
print(f"build all   {n} cars  " + ("ok" if len(fail) == n0 else "FAIL"))

n0 = len(fail)
mod, u, logs, chans = run("build", "no-such-car")
check(any("no such car" in e for e in logs["error"]), "an unknown car id should be an error, not a quiet nothing")
print("unknown id  " + ("ok" if len(fail) == n0 else "FAIL"))

mod, u, logs, chans = run("report", "all")
check(not logs["error"], f"report logged errors: {logs['error']}")

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
