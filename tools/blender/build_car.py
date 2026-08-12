#!/usr/bin/env python3
"""Model the Efreet RX body in Blender and export it as glTF.

Run headless — no Blender GUI, no .blend file in the repo:

    python3 tools/blender/build_car.py --out public/models/efreet-rx.glb

The shape follows src/game/cars.ts: the same FD-style side profile is
extruded to width, then solidified and subdivision-smoothed, so the mesh
that lands in the game reads like the procedural car it replaces rather
than a different vehicle. Geometry only — the game supplies paint, glass
and lighting, so the export stays a few hundred kilobytes.
"""

import argparse
import math
import os
import sys

import bpy
import bmesh

# Side profile in metres, matching rx7BodyGeo in src/game/cars.ts. X runs
# nose (+) to tail (-), Z is height off the road.
BODY_PROFILE = [
    (2.28, 0.28), (2.34, 0.48), (2.22, 0.58), (1.30, 0.70), (0.50, 0.85),
    (-1.10, 0.88), (-1.95, 0.78), (-2.20, 0.52), (-2.14, 0.28),
    (-1.82, 0.20), (1.88, 0.20),
]
CANOPY_PROFILE = [(0.80, 0.83), (0.10, 1.28), (-0.72, 1.24), (-1.68, 0.78)]

BODY_WIDTH = 1.92
CANOPY_WIDTH = 1.60


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def extrude_profile(name, profile, width, smooth_levels=2, solidify=0.0):
    """Build a closed prism from a 2-D profile, then smooth it."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    half = width / 2.0
    # Two rings of verts, one per side, joined into a closed solid
    near = [bm.verts.new((x, -half, z)) for x, z in profile]
    far = [bm.verts.new((x, half, z)) for x, z in profile]
    bm.verts.ensure_lookup_table()

    bm.faces.new(near)
    bm.faces.new(reversed(far))
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((near[i], near[j], far[j], far[i]))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    if solidify:
        mod = obj.modifiers.new("Solidify", "SOLIDIFY")
        mod.thickness = solidify

    if smooth_levels:
        # Subdivision is what turns a hard prism into the curvy FD body
        sub = obj.modifiers.new("Subdivision", "SUBSURF")
        sub.levels = smooth_levels
        sub.render_levels = smooth_levels
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shade_smooth()

    return obj


def add_wheel(name, x, y, radius=0.36, width=0.27):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=24, radius=radius, depth=width,
        location=(x, y, radius), rotation=(math.pi / 2, 0, 0),
    )
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.shade_smooth()
    return obj


def build():
    clear_scene()
    body = extrude_profile("Body", BODY_PROFILE, BODY_WIDTH, smooth_levels=2)
    canopy = extrude_profile("Canopy", CANOPY_PROFILE, CANOPY_WIDTH, smooth_levels=2)

    wheels = []
    for tag, x in (("F", 1.45), ("R", -1.45)):
        for side, y in (("L", -0.84), ("R", 0.84)):
            wheels.append(add_wheel(f"Wheel{tag}{side}", x, y))

    # The game drives on +Z with the car facing forward; Blender is
    # Z-up/-Y-forward, and the glTF exporter converts on the way out.
    return [body, canopy] + wheels


def export(path, objects):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(o in objects)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,       # bake the subdivision into the mesh
        export_materials="NONE",  # the game owns paint and glass
        export_yup=True,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="public/models/efreet-rx.glb")
    args = ap.parse_args(sys.argv[1:])

    objects = build()
    export(args.out, objects)

    # Count the *evaluated* mesh: the subdivision modifier is what the
    # exporter bakes, so counting the base cage would under-report by ~16x.
    deps = bpy.context.evaluated_depsgraph_get()
    tris = 0
    for o in objects:
        if o.type != "MESH":
            continue
        evaluated = o.evaluated_get(deps)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        tris += len(mesh.loop_triangles)
        evaluated.to_mesh_clear()
    size = os.path.getsize(args.out)
    print(f"exported {args.out}  ({size/1024:.0f} KB, ~{tris} triangles)")


if __name__ == "__main__":
    main()
