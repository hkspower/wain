#!/usr/bin/env python3
"""Smoke-test tools/max/nightracer/render.py without 3ds Max.

    python3 tools/max/test_render.py [press/max/render/black-demon]

A stand-in pymxs records what render.py builds from the real render pack:
every material rebuilt (plain and inside a Multimaterial), five quad lights
and a skydome, the cameras placed where studio.json says and aimed at its
aim point, the floor, the render calls and their paths, and a turntable
that turns once. Real Arnold, real FBX import and MAXtoA's own parameter
names are not here: that is the first run in Max.
"""
import json, math, os, sys, types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
pack = next((a for a in sys.argv[1:] if not a.startswith("--")), "press/max/render/black-demon")
spec = json.load(open(os.path.join(pack, "studio.json")))
mats = json.load(open(os.path.join(pack, "materials.json")))


class Obj:
    """Any Max object: takes any property, remembers what was set."""
    PROPS = None  # None = has every property

    def __init__(self, cls, **kw):
        self.cls = cls
        self.__dict__.update(kw)
        self.set = {}

    def __setattr__(self, k, v):
        object.__setattr__(self, k, v)
        if k not in ("cls", "set") and hasattr(self, "set"):
            self.set[k] = v


class P3(tuple):
    def __new__(cls, *v):
        return tuple.__new__(cls, v)

    x = property(lambda s: s[0])
    y = property(lambda s: s[1])
    z = property(lambda s: s[2])


scene = {"objects": [], "renders": [], "saved": [], "rot": []}
# Names the code must NOT rely on (the review found them absent in MAXtoA /
# Physical Material): the mock rejects them so a regression shows up here.
NO_PROPS = {"Arnold_Light": {"shape", "lightShape", "cameraVisibility", "camera"},
            "PhysicalMaterial": {"coat_weight"}}


def make(cls):
    def ctor(*a, **kw):
        o = Obj(cls, **kw)
        if cls in ("Arnold_Light", "Plane", "Freecamera", "Dummy"):
            o.parent = None
            o.material = None
            o.handle = len(scene["objects"]) + 1000
            scene["objects"].append(o)
        if cls == "Bitmaptexture":
            o.coords = Obj("coords")
        return o
    return ctor


rt = types.SimpleNamespace()
for c in ("PhysicalMaterial", "Bitmaptexture", "Normal_Bump", "Arnold_Light", "Plane", "Freecamera", "Dummy",
          "Free_Area", "Arnold"):
    setattr(rt, c, make(c))
rt.Multimaterial = "Multimaterial"
rt.Point3 = P3
rt.Matrix3 = lambda a, b, c, d: (a, b, c, d)
rt.Color = lambda r, g, b: (r, g, b)
rt.EulerAngles = lambda x, y, z: (x, y, z)
rt.Name = lambda s: "#" + s
rt.classOf = lambda o: getattr(o, "cls", type(o).__name__)
rt.isProperty = lambda o, n: n not in NO_PROPS.get(getattr(o, "cls", ""), set())
rt.maxVersion = lambda: [27000]
rt.IDisplayGamma = types.SimpleNamespace(colorCorrectionMode="gamma")   # 2023's default: must NOT re-encode
rt.ColorPipelineMgr = types.SimpleNamespace(mode="#OCIO_Default")       # 2025+'s default: must switch to gamma
rt.openBitMap = lambda path, **kw: Obj("Bitmap", filename=path, **kw)
rt.renderers = types.SimpleNamespace(current=None)
rt.SceneExposureControl = types.SimpleNamespace(exposureControl="x")
rt.units = types.SimpleNamespace(decodeValue=lambda s: 1.0)
rt.resetMaxFile = lambda *a: scene["objects"].clear()
rt.FBXImporterSetParam = lambda *a: None
rt.FBXIMP = "fbx"
rt.objects = scene["objects"]


def import_file(path, *a, **kw):
    """The car as Max would import it: some nodes with one material, one with
    a Multimaterial holding several."""
    names = sorted(mats)
    for i, n in enumerate(names[:30]):
        o = Obj("Editable_Mesh", name="mesh%d" % i, parent=None, handle=i + 1)
        o.material = Obj("Standard", name=n)
        scene["objects"].append(o)
    multi = Obj("Multimaterial", name="multi")
    multi.subs = [Obj("Standard", name=n) for n in names[30:]] + [Obj("Standard", name="not-in-json")]
    o = Obj("Editable_Mesh", name="meshMulti", parent=None, handle=99)
    o.material = multi
    scene["objects"].append(o)


def import_ok(path, *a, **kw):
    import_file(path)
    return True


rt.importFile = import_ok
rt.nrSubCount = lambda m: len(m.subs)
rt.nrGetSub = lambda m, i: m.subs[i - 1]
rt.nrSetSub = lambda m, i, s: m.subs.__setitem__(i - 1, s)
rt.execute = lambda s: None
rt.backgroundColor = None


def render(camera=None, outputwidth=0, outputheight=0, outputfile="", **kw):
    if not kw.get("outputHDRbitmap"):
        scene.setdefault("ldr", []).append(outputfile)
    scene["renders"].append((camera.name, outputwidth, outputheight, outputfile,
                             next(o for o in scene["objects"] if o.name == "NR_Turntable").rotation))
    return Obj("Bitmap")


rt.render = render
rt.save = lambda bm: scene["saved"].append(bm.filename)
rt.close = lambda bm: None
pymxs = types.ModuleType("pymxs")
pymxs.runtime = rt
sys.modules["pymxs"] = pymxs

from nightracer import maxio, render as R  # noqa: E402

maxio.metres = lambda: None
fails = []
sc = R.open_pack(pack, light_scale=1.0)

# Materials: every json name in the scene became a Physical Material.
plain = [o.material for o in scene["objects"] if o.cls == "Editable_Mesh" and o.name != "meshMulti"]
multi = next(o for o in scene["objects"] if o.name == "meshMulti").material.subs
built = [m for m in plain + multi if m.cls == "PhysicalMaterial"]
if len(built) != len(mats):
    fails.append(f"materials: {len(built)} Physical Materials for {len(mats)} in materials.json")
if multi[-1].cls != "Standard":
    fails.append("a material not in materials.json was replaced")
paint = next(m for m in built if m.name == "paint")
if paint.set.get("coating") != mats["paint"]["coat"]:
    fails.append(f"paint coat: {paint.set}")
glass = next(m for m in built if m.name == "glass")
if abs(glass.set.get("transparency", 0) - (1 - mats["glass"]["alpha"])) > 1e-6 or not glass.set.get("thin_walled"):
    fails.append(f"glass: {glass.set}")
lamp = next(m for m in built if m.name == "headlamp-core")
if abs(lamp.set.get("emit_luminance", 0) - 1500 * mats["headlamp-core"]["emission_strength"]) > 1e-6:
    fails.append(f"headlamp: {lamp.set}")
decal = next(m for m in built if m.name == "decal")
if "cutout_map" not in decal.set or "base_color_map" not in decal.set:
    fails.append(f"decal maps: {sorted(decal.set)}")

# Colour: the scene is put in Gamma Workflow, and swatches are written as
# the linear numbers (paint base 0.003347 -> 0.853 of 255, not 11).
if str(rt.ColorPipelineMgr.mode).lstrip("#").lower() != "gamma":
    fails.append(f"colour pipeline left at {rt.ColorPipelineMgr.mode}")
if abs(paint.set["base_color"][0] - mats["paint"]["base"][0] * 255) > 1e-6:
    fails.append(f"paint base colour {paint.set['base_color']} is not the linear value")
if paint.set.get("coat_affect_color") != 0.0 or paint.set.get("coat_affect_roughness") != 0.0:
    fails.append("coat still darkens/roughens the base")
tyre = next((m for m in built if m.name == "tire"), None)
if tyre is not None:
    nm = tyre.set.get("bump_map").set.get("normal_map")
    if nm is None or getattr(nm, "bitmap", None) is None or nm.bitmap.gamma != 1.0:
        fails.append("tyre normal map not loaded raw (gamma 1.0)")

# Lights: five quads, a skydome; positions and aim.
lights = [o for o in scene["objects"] if o.cls == "Arnold_Light"]
quads = [l for l in lights if l.set.get("shapeType") == 3]
sky = [l for l in lights if l.set.get("shapeType") == 6]
for l in lights:
    if l.set.get("lightShapeVisible") is not False:
        fails.append(f"{l.name} is visible to the camera")
    if "camera" in l.set:
        fails.append(f"{l.name}: set a 'camera' property the mock says does not exist")
for l in quads:
    if l.set.get("normalize") is not False:
        fails.append(f"{l.name}: normalize must be off (intensity is already per area)")
if len(quads) != 5 or len(sky) != 1:
    fails.append(f"lights: {len(quads)} quads, {len(sky)} skydomes")


def axis_check(node, loc, aim):
    x, y, z, p = node.transform
    if max(abs(a - b) for a, b in zip(p, loc)) > 1e-9:
        return f"{node.name} at {p}, expected {loc}"
    d = [a - b for a, b in zip(aim, loc)]
    n = math.sqrt(sum(v * v for v in d))
    d = [v / n for v in d]
    if sum(-zz * dd for zz, dd in zip(z, d)) < 0.9999:
        return f"{node.name} does not look at its target"
    if abs(sum(a * b for a, b in zip(x, z))) > 1e-9 or abs(sum(a * b for a, b in zip(y, z))) > 1e-9:
        return f"{node.name} axes not orthogonal"
    return None


for L in spec["lights"]:
    node = next(l for l in quads if l.name == "NR_" + L["name"])
    tgt = (L["loc"][0], L["loc"][1], L["loc"][2] - 1) if L.get("down") else L["target"]
    e = axis_check(node, L["loc"], tgt)
    if e:
        fails.append("light: " + e)
    want = L["energy"] / (math.pi * L["size"] * L["size_y"])
    if abs(node.set["intensity"] - want) > 1e-9 or abs(node.set["quadX"] - L["size"]) > 1e-9:
        fails.append(f"light {L['name']}: intensity {node.set['intensity']} vs {want}")
for name, s in spec["stills"]["shots"].items():
    e = axis_check(sc["cams"][name], s["loc"], s["aim"])
    if e:
        fails.append("camera: " + e)
    if abs(sc["cams"][name].set["fov"] - spec["hfov_deg"]) > 1e-9:
        fails.append("camera fov")

R.render_stills(sc, ("hero", "side", "rear"), 1280, 720)
R.render_turntable(sc, frames=6, width=480, height=270)
paths = [r[3] for r in scene["renders"]]
want_paths = [os.path.join(pack, "out", f"{s}.exr") for s in ("hero", "side", "rear")] + \
    [os.path.join(pack, "out", "turntable", "%04d.exr" % i) for i in range(1, 7)]
if paths != want_paths:
    fails.append(f"render paths: {paths}")
rots = [r[4][2] for r in scene["renders"][3:]]
step = 360.0 / spec["turntable"]["frames"]
if any(abs(r - i * step) > 1e-9 for i, r in enumerate(rots)):
    fails.append(f"turntable rotation {rots}")
if len(scene["saved"]) != 3:
    fails.append(f"quick PNGs {scene['saved']}")
if scene.get("ldr"):
    fails.append(f"rendered without a float buffer (EXR clipped at 1.0): {scene['ldr'][:2]}")

# A failed FBX import is an error, not an empty studio rendered as "ok".
rt.importFile = lambda *a, **kw: False
try:
    R.open_pack(pack)
    fails.append("open_pack carried on after a failed FBX import")
except RuntimeError as e:
    print("failed import ->", e)
rt.importFile = import_ok

# render_all: three packs, one already rendered (skipped), one broken (logged,
# the batch goes on), one rendered.
import shutil, tempfile  # noqa: E402
root = tempfile.mkdtemp(prefix="packs-")
for car in ("done-car", "broken-car", "fresh-car"):
    os.makedirs(os.path.join(root, car))
    shutil.copy(os.path.join(pack, "studio.json"), os.path.join(root, car))
    shutil.copy(os.path.join(pack, "materials.json"), os.path.join(root, car))
    open(os.path.join(root, car, spec["fbx"]), "w").close()   # the stand-in import never reads it
os.makedirs(os.path.join(root, "done-car", "out"))
for shot in ("hero", "side", "rear"):
    open(os.path.join(root, "done-car", "out", shot + ".exr"), "w").close()
os.makedirs(os.path.join(root, "done-car", "out", "turntable"))
open(os.path.join(root, "done-car", "out", "turntable", "0003.exr"), "w").close()  # done = stills + last frame
with open(os.path.join(root, "broken-car", "studio.json"), "w") as f:
    f.write("{ not json")
json.dump({"cars": [{"id": c} for c in ("done-car", "broken-car", "fresh-car")]}, open(os.path.join(root, "packs.json"), "w"))
n_before = len(scene["renders"])
rep = R.render_all(root, ("hero", "side", "rear"), turntable=True, frames=3, half=True)
status = {r["id"]: r["status"] for r in rep}
print("render_all:", status)
if not status["done-car"].startswith("skipped") or not status["broken-car"].startswith("FAILED") \
        or status["fresh-car"] != "ok":
    fails.append(f"render_all statuses {status}")
fresh = scene["renders"][n_before:]
if len(fresh) != 6 or fresh[0][1:3] != (spec["stills"]["width"] // 2, spec["stills"]["height"] // 2):
    fails.append(f"render_all renders {[(r[0], r[1], r[2]) for r in fresh]}")
if not os.path.exists(os.path.join(root, "render-all.json")):
    fails.append("render_all wrote no render-all.json")

print(f"materials {len(built)}, quad lights {len(quads)}, skydome {len(sky)}, cameras {len(sc['cams'])}, "
      f"renders {len(scene['renders'])}")
print("render log:\n  " + "\n  ".join(R.LOG))
if fails:
    print("\n" + "\n".join("  - " + f for f in fails))
    sys.exit(1)
print("\nrender.py builds the pack's studio as specified")
