#!/usr/bin/env python3
"""The panel's path, with Blender standing in for 3ds Max.

    python3 tools/max/test_fbx.py [press/max] [--styles hatch,super]

Opens each press/max/car-<style>.fbx the way the panel sees it (z up, nose
-y), takes the Edit and Target shells by their parent group, converts them
to the game frame and runs core.judge with car-<style>.nr.json. Then does
the panel's "Replace with Envelope" on every slot the game rejects and
judges again. Fails if a shipped-good slot is judged bad, or a replaced
slot still fails.
"""
import json, os, sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from nightracer import core  # noqa: E402

args = [a for a in sys.argv[1:] if not a.startswith("--")]
folder = args[0] if args else "press/max"
styles = None
if "--styles" in sys.argv:
    styles = sys.argv[sys.argv.index("--styles") + 1].split(",")


def mesh_of(o):
    deps = bpy.context.evaluated_depsgraph_get()
    me = o.evaluated_get(deps).to_mesh()
    me.calc_loop_triangles()
    mw = o.matrix_world
    pos = []
    for v in me.vertices:
        p = mw @ v.co
        pos += [p.x, p.y, p.z]
    tri = [i for t in me.loop_triangles for i in t.vertices]
    o.evaluated_get(deps).to_mesh_clear()
    return core.to_game(pos), tri


def root(o):
    while o.parent:
        o = o.parent
    return o.name


fails = []
for f in sorted(os.listdir(folder)):
    if not (f.startswith("car-") and f.endswith(".fbx")):
        continue
    style = f[4:-4]
    if styles and style not in styles:
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(folder, f))
    info = json.load(open(os.path.join(folder, f"car-{style}.nr.json")))
    groups = {"NR_Edit": {}, "NR_Target": {}, "NR_Envelope": {}}
    for o in bpy.data.objects:
        if o.type != "MESH" or root(o) not in groups:
            continue
        name = o.name.split(".")[0].lower()
        for pre in ("target_", "envelope_"):
            if name.startswith(pre):
                name = name[len(pre):]
        groups[root(o)][name] = mesh_of(o)
    v = core.judge(groups["NR_Edit"], groups["NR_Target"], info)
    for slot, r in v.items():
        shipped_ok = info["slots"][slot].get("shipped", {}).get("ok", True)
        print(f"{style:7} {slot:6} box {r['box'] * 1000:5.1f} mm  skin "
              f"{'--' if r.get('skin') is None else '%.1f' % (r['skin'] * 1000):>5}  mirror {r['mirror']['share'] * 100:5.1f}%  "
              f"open {r['mirror']['open']}  {'inside-out ' if r['insideOut'] else ''}{'ok' if r['ok'] else 'REJECTED'}")
        if r["ok"] != shipped_ok:
            fails.append(f"{style} {slot}: panel says {r['ok']}, the game says {shipped_ok} for the shipped file")
        if not r["ok"]:
            ep, et = groups["NR_Envelope"][slot]
            fixed = core.judge({slot: (ep, core.symmetrize(ep, et))}, groups["NR_Target"], info)[slot]
            print(f"{'':7} {slot:6} -> replaced with Envelope, symmetrized: box {fixed['box'] * 1000:.1f} mm, skin "
                  f"{'--' if fixed.get('skin') is None else '%.1f' % (fixed['skin'] * 1000)} mm, "
                  f"mirror {fixed['mirror']['share'] * 100:.1f}%  {'ok' if fixed['gameOk'] else 'STILL REJECTED'}")
            if not fixed["gameOk"]:
                fails.append(f"{style} {slot}: replacing with the Envelope does not pass")

if fails:
    print("\n" + "\n".join("  - " + x for x in fails))
    sys.exit(1)
print("\nthe panel's judgement, read through FBX, matches the game; the Envelope fix passes")
