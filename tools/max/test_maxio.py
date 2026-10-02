#!/usr/bin/env python3
"""Smoke-test tools/max/nightracer/maxio.py without 3ds Max.

    python3 tools/max/test_maxio.py [press/max/car-hatch.fbx]

A stand-in `pymxs` holds a scene built from the real FBX (read through
Blender, which sees it as Max does: z up, nose -y), with the scene in
CENTIMETRES on purpose so the unit handling is exercised. Then maxio's
check(), replace_with_envelope(), recentre(), turn_outward() and
export_for_game() run against it. What this cannot reach is real Max
behaviour (FBX import settings, modifiers, Qt): that is your first run.
"""
import json, os, sys, types

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
fbx = next((a for a in sys.argv[1:] if a.endswith(".fbx")), "press/max/car-hatch.fbx")
CM = 100.0  # scene units per metre: the fake scene is in centimetres


class P3:
    def __init__(self, x, y, z):
        self.x, self.y, self.z = float(x), float(y), float(z)


class Layer:
    def __init__(self, name):
        self.name, self.isFrozen, self.isHidden = name, False, False

    def addNode(self, n):
        n.layer = self


class Mesh:
    def __init__(self, verts, faces):
        self.verts, self.faces = verts, faces


class Node:
    def __init__(self, name, parent=None, mesh=None, geometry=True):
        self.name, self.parent, self.mesh_ = name, parent, mesh
        self.geometry = geometry
        self.layer = Layer("0")
        self.position = P3(0, 0, 0)
        self.wirecolor = self.material = None
        self.baseObject = "Editable_Poly"

    @property
    def mesh(self):
        return self.mesh_

    @property
    def min(self):
        return P3(min(v.x for v in self.mesh_.verts) + self.position.x, 0, 0)

    @property
    def max(self):
        return P3(max(v.x for v in self.mesh_.verts) + self.position.x, 0, 0)


scene = {"objects": [], "props": {}, "selection": [], "exported": None}


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=fbx)
    made = {}
    def depth(o):
        d = 0
        while o.parent:
            o, d = o.parent, d + 1
        return d
    order = sorted(bpy.data.objects, key=depth)  # parents first
    for o in order:
        mesh = None
        if o.type == "MESH":
            me = o.to_mesh()
            me.calc_loop_triangles()
            mw = o.matrix_world
            verts = [P3(*(mw @ v.co) * CM) for v in me.vertices]
            faces = [P3(*(i + 1 for i in t.vertices)) for t in me.loop_triangles]
            mesh = Mesh(verts, faces)
            o.to_mesh_clear()
        n = Node(o.name.split(".")[0], made.get(o.parent.name) if o.parent else None, mesh, o.type == "MESH")
        made[o.name] = n
        scene["objects"].append(n)


class RT(types.SimpleNamespace):
    def __getattr__(self, k):  # anything not modelled is a no-op
        return lambda *a, **kw: None


rt = RT()
rt.GeometryClass, rt.Targetobject, rt.Editable_Poly = "GeometryClass", "Targetobject", "Editable_Poly"
rt.Name = lambda s: "#" + s
rt.Point3 = P3
rt.Color = lambda r, g, b: (r, g, b)
rt.units = types.SimpleNamespace(decodeValue=lambda s: CM, DisplayType=None, MetricType=None, SystemType=None, SystemScale=None)
rt.objects = scene["objects"]
rt.superClassOf = lambda n: "GeometryClass" if n.geometry else "helper"
rt.classOf = lambda n: n if isinstance(n, str) else "Editable_Mesh"
rt.snapshotAsMesh = lambda n: Mesh([P3(v.x + n.position.x, v.y + n.position.y, v.z + n.position.z) for v in n.mesh_.verts], n.mesh_.faces)
rt.getNumVerts = lambda m: len(m.verts)
rt.getNumFaces = lambda m: len(m.faces)
rt.getVert = lambda m, i: m.verts[i - 1]
rt.getFace = lambda m, i: m.faces[i - 1]
rt.delete = lambda n: scene["objects"].remove(n) if isinstance(n, Node) else None
layers = {}
rt.LayerManager = types.SimpleNamespace(getLayerFromName=lambda name: layers.get(name),
                                        newLayerFromName=lambda name: layers.setdefault(name, Layer(name)))


def _mesh(vertices, faces):
    n = Node("new", None, Mesh(vertices, faces))
    scene["objects"].append(n)
    return n


rt.mesh = _mesh
rt.meshop = types.SimpleNamespace(autoSmooth=lambda *a: None)
rt.fileProperties = types.SimpleNamespace(
    findProperty=lambda kind, name: list(scene["props"]).index(name) + 1 if name in scene["props"] else 0,
    getPropertyValue=lambda kind, i: list(scene["props"].values())[i - 1],
    addProperty=lambda kind, name, value: scene["props"].__setitem__(name, value))
rt.select = lambda nodes: scene.__setitem__("selection", list(nodes))
rt.exportFile = lambda path, *a, **kw: scene.__setitem__("exported", (path, [n.name for n in scene["selection"]]))
rt.selection = scene["selection"]

pymxs = types.ModuleType("pymxs")
pymxs.runtime = rt
sys.modules["pymxs"] = pymxs

from nightracer import maxio  # noqa: E402

build_scene()
style = os.path.basename(fbx)[4:-4]
scene["props"].update(nr_style=style, nr_dir=os.path.dirname(os.path.abspath(fbx)),
                      nr_json=open(os.path.join(os.path.dirname(fbx), f"car-{style}.nr.json")).read())
fails = []


def show(title, res):
    print(title)
    for s, v in res.items():
        print(f"  {s:6} box {v.get('box', 0) * 1000:5.1f} mm  skin {'--' if v.get('skin') is None else '%.1f' % (v['skin'] * 1000)}"
              f"  mirror {v['mirror']['share'] * 100:5.1f}%  count {v['count']}  {'ok' if v['gameOk'] else 'REJECTED: ' + str(v.get('reason'))}")


res = maxio.check()
show(f"check {style} (scene in cm):", res)
info = json.loads(scene["props"]["nr_json"])
for s, v in res.items():
    if v["gameOk"] != info["slots"][s].get("shipped", {}).get("ok", True):
        fails.append(f"check: {s} disagrees with the game's verdict on the shipped file")

bad = [s for s, v in res.items() if not v["gameOk"]]
for s in bad:
    maxio.replace_with_envelope(s.capitalize())
res2 = maxio.check()
show("after Replace with Envelope:", res2)
for s in bad:
    if not res2[s]["gameOk"]:
        fails.append(f"replace: {s} still rejected")
    if res2[s]["count"] != 1:
        fails.append(f"replace: {s} count {res2[s]['count']}")

n = maxio.slot_node("NR_Edit", "Body")
n.position = P3(3.0, 0, 0)  # 3 cm off the centreline
moved = maxio.recentre(n)
if abs(moved - 0.03) > 1e-6 or abs(n.position.x) > 1e-9:
    fails.append(f"recentre: moved {moved} m, position {n.position.x}")
if maxio.turn_outward():
    fails.append("turn_outward flipped a shell that faces out")

import time  # noqa: E402
t0 = time.time()
made = maxio.heatmap(5.0, 10.0)
print("heatmap: " + ", ".join(f"{s} worst {w * 1000:.1f} mm" for s, w in made) + f"  ({time.time() - t0:.0f} s)")
# Per-vertex distance is stricter than the game's box + 25 rays: an accepted
# shell can show a local hotspot just over 10 mm. Anything near 15 is wrong.
if len(made) != 3 or any(not (w == w) or w > 0.015 for s, w in made):
    fails.append(f"heatmap worst distances look wrong for shells the game accepts: {made}")
heat_nodes = [n.name for n in scene["objects"] if n.name.startswith("NR_Heat_")]
if len(heat_nodes) != 3:
    fails.append(f"heatmap made {heat_nodes}")

out = maxio.export_for_game("/tmp/claude-maxio-test")
path, names = scene["exported"]
if sorted(names) != ["Body", "Canopy", "Roof"]:
    fails.append(f"export selected {names}")
print(f"export -> {path} {names}")

if fails:
    print("\n" + "\n".join("  - " + f for f in fails))
    sys.exit(1)
print("\nmaxio works on the scene: groups, units, checks, the Envelope fix, recentre, export selection")
