#!/usr/bin/env python3
"""One car shell file back from 3ds Max: FBX in, game GLB out.

    python3 tools/max/import_from_max.py --in car-gtr.fbx --out /tmp/car-gtr.glb

Run by tools/max/import.mjs, which gates the result before it ships;
running this alone writes a GLB and judges nothing.

Keeps exactly the meshes named Body, Canopy and Roof (any case; the
Envelope_ and Ctx_ copies are ignored), bakes every transform and
modifier, and writes them the way tools/blender/build_assets.py does:
glTF Y up, nose +Z, metres, no materials, no UVs. Normals are Max's own
(smoothing groups come through as split normals); a shell whose faces
point inward overall (a mirror, a negative scale) is turned outward,
because the game draws shells single-sided.

Units are checked rather than trusted: FBX carries a unit scale, but a
scene exported in inches or with automatic conversion off lands at the
wrong size. The body must come out between 3 and 6.5 m long; a file
that is exactly 100x, 1/100x, 2.54x or 1/2.54x away from that is
rescaled with a warning, and anything else is refused.
"""
import argparse, json, os, sys

import bpy
import bmesh  # after bpy: the module form of Blender only provides it once bpy is loaded
from mathutils import Matrix

ap = argparse.ArgumentParser()
ap.add_argument("--in", dest="src", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--report", help="write a JSON summary here")
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

SLOTS = ("Body", "Canopy", "Roof")


def fail(msg):
    print(f"import: {msg}", file=sys.stderr)
    sys.exit(2)


def signed_volume(me):
    v = 0.0
    me.calc_loop_triangles()
    for t in me.loop_triangles:
        a, b, c = (me.vertices[i].co for i in t.vertices)
        v += a.dot(b.cross(c)) / 6.0
    return v


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if not os.path.exists(args.src):
        fail(f"no such file {args.src}")
    bpy.ops.import_scene.fbx(filepath=args.src, use_custom_normals=True, automatic_bone_orientation=False)

    found = {}
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        key = o.name.split(".")[0].strip()
        for slot in SLOTS:
            if key.lower() == slot.lower():
                if slot in found:
                    fail(f"two meshes are named {slot} ({found[slot].name}, {o.name}); the game keeps one")
                found[slot] = o
    missing = [s for s in SLOTS if s not in found]
    if missing:
        names = sorted(o.name for o in bpy.data.objects if o.type == "MESH")[:20]
        fail(f"no mesh named {', '.join(missing)} in {os.path.basename(args.src)}; meshes seen: {', '.join(names)}")

    # Bake: modifiers, then the full world transform, into each mesh.
    deps = bpy.context.evaluated_depsgraph_get()
    shells = []
    for slot in SLOTS:
        o = found[slot]
        me = bpy.data.meshes.new_from_object(o.evaluated_get(deps), preserve_all_data_layers=True, depsgraph=deps)
        me.transform(o.matrix_world)
        if o.matrix_world.determinant() < 0:
            me.flip_normals()
        new = bpy.data.objects.new(slot, me)
        new.data.name = slot
        shells.append(new)
    for o in list(bpy.data.objects):
        if o not in shells:
            bpy.data.objects.remove(o)
    for o in shells:
        bpy.context.scene.collection.objects.link(o)
    # The originals held these names until just now; claim them back, or
    # the exporter writes Body.001 and the game finds no Body.
    for o, slot in zip(shells, SLOTS):
        o.name = slot
        o.data.name = slot

    # Units, by the body's length (Blender frame: the car runs along Y).
    body = shells[0]
    xs = [v.co.x for v in body.data.vertices]
    ys = [v.co.y for v in body.data.vertices]
    length, width = max(ys) - min(ys), max(xs) - min(xs)
    if width > length:
        fail(f"the body is wider ({width:.2f}) than it is long ({length:.2f}): turned 90 degrees? "
             "The nose must face Max's Front view (-Y), as it arrived")
    scale = 1.0
    if not 3.0 <= length <= 6.5:
        for k in (0.01, 100.0, 0.0254, 1 / 0.0254, 0.1, 10.0):
            if 3.0 <= length * k <= 6.5:
                scale = k
                break
        else:
            fail(f"the body is {length:.3f} units long; expected 3-6.5 m. Check the FBX export units (metres)")
        print(f"import: WARNING the file came in {1 / scale:g}x the size; rescaled by {scale:g} "
              "(set FBX export units to metres to stop this)")
        for o in shells:
            o.data.transform(Matrix.Scale(scale, 4))

    # Outward, as a whole. Per-face recalculation would fight Max's
    # smoothing; a shell that is inside-out as a whole is one flip.
    flipped = []
    for o in shells:
        if signed_volume(o.data) < 0:
            o.data.flip_normals()
            flipped.append(o.name)
    if flipped:
        print(f"import: {', '.join(flipped)} came in inside-out; turned outward")

    # Triangles, the way the game draws them.
    tris = {}
    for o in shells:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.to_mesh(o.data)
        bm.free()
        tris[o.name] = len(o.data.polygons)

    for o in bpy.context.scene.objects:
        o.select_set(o in shells)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_materials="NONE",
        export_yup=True,
        export_texcoords=False,
        export_normals=True,
    )
    summary = {"tris": sum(tris.values()), "parts": sorted(tris), "perPart": tris,
               "lengthM": round(length * scale, 3), "rescaled": scale, "flipped": flipped,
               "kb": round(os.path.getsize(args.out) / 1024, 1)}
    if args.report:
        with open(args.report, "w") as f:
            json.dump(summary, f, indent=2)
    print(f"import: {os.path.basename(args.out)}  {summary['kb']:.0f} KB  {summary['tris']} tris  "
          f"length {summary['lengthM']} m")


main()
