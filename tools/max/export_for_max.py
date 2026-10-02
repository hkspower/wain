#!/usr/bin/env python3
"""The car shells, out to 3ds Max as FBX: one file per body style.

    pip install bpy
    npm run max:export                      # all nine -> press/max/car-<style>.fbx
    python3 tools/max/export_for_max.py --styles gtr,sedan

Each FBX holds three groups, as parent dummies that tools/max/nightracer.ms
turns into Max layers:

  NR_Edit      Body, Canopy, Roof: the shipped public/models/car-<style>.glb.
               These are what you model, and the only thing that comes back.
  NR_Envelope  The same three, frozen and see-through: where the game's own
               shell is. The game drops a shell that ends up more than
               10 mm from it (src/game/models.ts, shellFit).
  NR_Context   One whole catalogue car of that style as the game builds it:
               lamps, trim, wheels, driver. Only so you can see where things
               sit; it is never exported back. Comes from press/renders/glb
               (node tools/shots/export-cars.mjs); skipped if absent.

Axes and units: the shells are glTF (Y up, nose +Z, metres). Blender reads
them as Z up with the nose toward -Y, and the FBX is written the way Max
reads FBX natively (Y up in the file, centimetres, FBX_SCALE_ALL), so in
Max the car is metres-true, Z up, nose toward Max's Front view.
"""
import argparse, json, os, sys

import bpy

ap = argparse.ArgumentParser()
ap.add_argument("--models", default="public/models")
ap.add_argument("--context", default="press/renders/glb")
ap.add_argument("--cars", default="press/renders/cars.json")
ap.add_argument("--out", default="press/max")
ap.add_argument("--styles", default="sedan,zx,gtr,rx7,hatch,pony,pickup,super,suv")
ap.add_argument("--no-context", action="store_true")
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

SLOTS = ("Body", "Canopy", "Roof")


def material(name, rgba, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = rgba
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    if b:
        b.inputs["Base Color"].default_value = rgba
        b.inputs["Alpha"].default_value = alpha
        b.inputs["Roughness"].default_value = 0.35
    return m


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def dummy(name):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    return e


def parent_keep(o, p):
    mw = o.matrix_world.copy()
    o.parent = p
    o.matrix_world = mw


def context_car(style):
    if args.no_context or not os.path.exists(args.cars):
        return None
    for c in json.load(open(args.cars)):
        if c.get("style") == style:
            p = os.path.join(args.context, f"{c['id']}.glb")
            if os.path.exists(p):
                return c["id"], p
    return None


def main():
    os.makedirs(args.out, exist_ok=True)
    paint = (0.62, 0.64, 0.68, 1.0)
    glass = (0.10, 0.14, 0.18, 1.0)
    done = []
    for style in args.styles.split(","):
        src = os.path.join(args.models, f"car-{style}.glb")
        if not os.path.exists(src):
            print(f"car-{style}: no {src}; skipped")
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.unit_settings.system = "METRIC"
        bpy.context.scene.unit_settings.scale_length = 1.0

        g_edit, g_env, g_ctx = dummy("NR_Edit"), dummy("NR_Envelope"), dummy("NR_Context")
        shells = {}
        for o in import_glb(src):
            if o.type == "MESH" and o.name.split(".")[0] in SLOTS:
                shells[o.name.split(".")[0]] = o
            elif o.type != "MESH":
                bpy.data.objects.remove(o)
        missing = [s for s in SLOTS if s not in shells]
        if missing:
            print(f"car-{style}: {src} has no {', '.join(missing)}; skipped")
            continue
        for name, o in shells.items():
            o.name = name
            o.data.name = name
            o.data.materials.clear()
            o.data.materials.append(material("NR_Glass" if name == "Canopy" else "NR_Paint",
                                             glass if name == "Canopy" else paint))
            parent_keep(o, g_edit)
            env = o.copy()
            env.data = o.data.copy()
            env.name = env.data.name = f"Envelope_{name}"
            env.data.materials.clear()
            env.data.materials.append(material("NR_Envelope", (0.2, 0.8, 1.0, 1.0), 0.25))
            bpy.context.scene.collection.objects.link(env)
            parent_keep(env, g_env)

        ctx = context_car(style)
        if ctx:
            car_id, path = ctx
            datas = set()
            for o in import_glb(path):
                if o.parent is None:
                    parent_keep(o, g_ctx)
                o.name = f"Ctx_{o.name}"
                if o.data is not None:
                    datas.add(o.data)
            for d in datas:
                d.name = f"Ctx_{d.name}"
        else:
            car_id = None

        # Bounding check: the context car and the shells must share a frame.
        def bounds(objs):
            from mathutils import Vector
            pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
            return (min(p.y for p in pts), max(p.y for p in pts)) if pts else None
        body_y = bounds([shells["Body"]])
        note = f"length {body_y[1] - body_y[0]:.2f} m"
        if car_id:
            ctx_y = bounds([o for o in g_ctx.children_recursive])
            if ctx_y and abs((ctx_y[0] + ctx_y[1]) / 2 - (body_y[0] + body_y[1]) / 2) > 0.3:
                print(f"car-{style}: WARNING the context car ({car_id}) is off-centre against the shells")
            note += f", context {car_id}"

        out = os.path.join(args.out, f"car-{style}.fbx")
        bpy.ops.export_scene.fbx(
            filepath=out,
            use_selection=False,
            apply_scale_options="FBX_SCALE_ALL",
            axis_forward="-Z",
            axis_up="Y",
            object_types={"EMPTY", "MESH"},
            use_mesh_modifiers=True,
            mesh_smooth_type="FACE",
            use_tspace=False,
            add_leaf_bones=False,
            bake_anim=False,
            path_mode="COPY",
            embed_textures=True,
        )
        kb = os.path.getsize(out) / 1024
        print(f"car-{style}.fbx  {kb:.0f} KB  ({note})")
        done.append(style)
    print(f"\n{len(done)} styles -> {args.out}")


main()
