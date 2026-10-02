#!/usr/bin/env python3
"""The car shells, out to 3ds Max as FBX: one file per body style.

    pip install bpy
    npm run max:export                      # all nine -> press/max/car-<style>.fbx
    python3 tools/max/export_for_max.py --styles gtr,sedan

Each FBX holds four groups, as parent dummies that the 3ds Max tools
(tools/max/nightracer.ms) turn into Max layers:

  NR_Edit      Body, Canopy, Roof: the shipped public/models/car-<style>.glb.
               These are what you model, and the only thing that comes back.
  NR_Envelope  Frozen and see-through: the three shells lofted FRESH from
               today's tools/blender/profiles.json (build_assets.build_style),
               uncrowned, in the same frame as Edit. Where the game's own
               shell is; the fix tools snap to it. Not the shipped file: the
               shipped hatch and super canopies are stale, and a fresh loft
               is what the game accepts.
  NR_Target    Hidden: the game's own shells as it builds them, CROWNED
               (tools/max/procedural.mjs). The panel crowns your Edit shells
               the same way and measures them against these, which is the
               test models.ts applies. car-<style>.nr.json beside the FBX
               carries the crown specs and the tolerance.
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

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "blender"))
import build_assets  # noqa: E402  (main() is guarded; build_style is what we want)

ap = argparse.ArgumentParser()
ap.add_argument("--models", default="public/models")
ap.add_argument("--context", default="press/renders/glb")
ap.add_argument("--cars", default="press/renders/cars.json")
ap.add_argument("--out", default="press/max")
ap.add_argument("--styles", default="sedan,zx,gtr,rx7,hatch,pony,pickup,super,suv")
ap.add_argument("--no-context", action="store_true")
ap.add_argument("--targets", default="press/max", help="where tools/max/procedural.mjs wrote car-<style>-target.glb")
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
    global profiles
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(HERE, "..", "blender", "profiles.json")) as f:
        profiles = json.load(f)
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
        g_tgt = dummy("NR_Target")
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

        # The Envelope: a fresh loft, named apart from the Edit shells first.
        for o in g_edit.children:
            o.name = "__edit_" + o.name
        Q = build_assets.QUALITY["max"]
        build_assets.Q, build_assets.SAMPLES_PER_SPAN, build_assets.BEVEL_STEPS = Q, Q["spans"], Q["bevel"]
        for env in build_assets.build_style(style, profiles[style]):
            base = env.name.split(".")[0]
            env.name = env.data.name = f"Envelope_{base}"
            env.data.materials.clear()
            env.data.materials.append(material("NR_Envelope", (0.2, 0.8, 1.0, 1.0), 0.25))
            parent_keep(env, g_env)
        for o in g_edit.children:
            o.name = o.data.name = o.name[len("__edit_"):]

        # The loft and the shipped shells must share a frame, or every
        # number the panel shows is the frame.
        from mathutils import Vector

        def box(o):
            pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
            return [min(p[i] for p in pts) for i in range(3)] + [max(p[i] for p in pts) for i in range(3)]
        for name in SLOTS:
            e, b = bpy.data.objects.get(f"Envelope_{name}"), bpy.data.objects.get(name)
            if e and b:
                off = max(abs(x - y) for x, y in zip(box(e), box(b)))
                if off > 0.05:
                    print(f"car-{style}: WARNING the Envelope {name} is {off * 1000:.0f} mm off the shipped one")

        # The Target: the game's crowned shells.
        tpath = os.path.join(args.targets, f"car-{style}-target.glb")
        if os.path.exists(tpath):
            for o in import_glb(tpath):
                if o.type == "MESH":
                    o.data.materials.clear()
                    o.data.materials.append(material("NR_Target", (1.0, 0.5, 0.1, 1.0), 0.3))
                    parent_keep(o, g_tgt)
                else:
                    bpy.data.objects.remove(o)
        else:
            print(f"car-{style}: no {tpath}; run tools/max/procedural.mjs first (npm run max:export does)")

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
