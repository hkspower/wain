#!/usr/bin/env python3
"""The 3ds Max render pack, rendered in Cycles: what Max should come close to.

    python3 tools/max/preview_render.py press/max/render/black-demon [--shots hero,side,rear] [--turntable]
                                        [--samples 128] [--scale 1] [--tt-samples 32] [--tt-scale 0.5]
    python3 tools/max/preview_render.py press/max/render --scale 0.5 --samples 64   # every pack

Builds the studio from the pack's studio.json (not from render_cars.py), so
the cameras, lights, floor and world are exactly what the Max side places,
and the car from the GLB the pack was made from. Writes linear EXRs to
<pack>/preview/ (<shot>.exr, turntable/####.exr); tools/max/finish_render.py
grades them to ACES PNG and the MP4, the same way it grades Max's output.
"""
import argparse, json, math, os, sys, time

import bpy
from mathutils import Matrix, Vector

ap = argparse.ArgumentParser()
ap.add_argument("pack")
ap.add_argument("--shots", default="hero,side,rear")
ap.add_argument("--turntable", action="store_true")
ap.add_argument("--samples", type=int, default=128)
ap.add_argument("--tt-samples", type=int, default=32)
ap.add_argument("--tt-scale", type=float, default=0.5, help="turntable resolution as a share of the pack's")
ap.add_argument("--frames", type=int, default=0, help="render only this many turntable frames (0 = all)")
ap.add_argument("--scale", type=float, default=1.0, help="stills resolution as a share of the pack's")
ap.add_argument("--skip-existing", action="store_true", help="leave a shot whose EXR is already there")
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])



def look(obj, loc, target):
    obj.location = loc
    obj.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


def build(pack, spec):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.normpath(os.path.join(pack, spec["glb"])), import_pack_images=True,
                              merge_vertices=False, import_shading="NORMALS")
    car = [o for o in bpy.data.objects if o not in before]
    pivot = bpy.data.objects.new("Turntable", None)
    sc.collection.objects.link(pivot)
    pivot.location = spec["turntable"]["pivot"]
    bpy.context.view_layer.update()
    for o in car:
        if o.parent is None:
            mw = o.matrix_world.copy()
            o.parent = pivot
            o.matrix_parent_inverse = pivot.matrix_world.inverted()
            o.matrix_world = mw

    fl = spec["floor"]
    bpy.ops.mesh.primitive_plane_add(size=fl["size"], location=fl["center"])
    gm = bpy.data.materials.new("Stage")
    gm.use_nodes = True
    b = gm.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*fl["base"], 1)
    b.inputs["Roughness"].default_value = fl["roughness"]
    b.inputs["Specular IOR Level"].default_value = fl["specular"]
    bpy.context.active_object.data.materials.append(gm)

    for L in spec["lights"]:
        ld = bpy.data.lights.new(L["name"], "AREA")
        ld.energy, ld.color, ld.shape = L["energy"], L["color"], "RECTANGLE"
        ld.size, ld.size_y, ld.spread = L["size"], L["size_y"], math.radians(L["spread_deg"])
        ob = bpy.data.objects.new(L["name"], ld)
        sc.collection.objects.link(ob)
        look(ob, L["loc"], L["target"])
        if L.get("down"):
            ob.rotation_euler = (0, 0, 0)
        ob.visible_camera = False

    w = bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    wn = w.node_tree
    wn.nodes.clear()
    o_ = wn.nodes.new("ShaderNodeOutputWorld")
    lit = wn.nodes.new("ShaderNodeBackground")
    lit.inputs["Color"].default_value = (*spec["world"], 1)
    black = wn.nodes.new("ShaderNodeBackground")
    black.inputs["Color"].default_value = (0, 0, 0, 1)
    lp = wn.nodes.new("ShaderNodeLightPath")
    mix = wn.nodes.new("ShaderNodeMixShader")
    wn.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
    wn.links.new(lit.outputs["Background"], mix.inputs[1])
    wn.links.new(black.outputs["Background"], mix.inputs[2])
    wn.links.new(mix.outputs["Shader"], o_.inputs["Surface"])

    cd = bpy.data.cameras.new("Cam")
    cd.lens, cd.sensor_width, cd.sensor_fit = spec["lens_mm"], spec["sensor_mm"], "HORIZONTAL"
    cam = bpy.data.objects.new("Cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam

    cy = sc.cycles
    sc.render.engine = "CYCLES"
    cy.device = "CPU"
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.01
    cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces = 10, 3, 6
    cy.transmission_bounces, cy.transparent_max_bounces = 8, 10
    cy.caustics_reflective = cy.caustics_refractive = False
    cy.use_denoising = True
    sc.render.filter_size = 1.5
    s = sc.render.image_settings
    s.file_format, s.color_mode, s.color_depth, s.exr_codec = "OPEN_EXR", "RGB", "16", "ZIP"
    return sc, cam, pivot


def render(sc, path, w, h, samples):
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    sc.cycles.samples = samples
    sc.cycles.adaptive_min_samples = min(32, samples)
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    return time.time() - t


def preview(pack):
    spec = json.load(open(os.path.join(pack, "studio.json")))
    out = os.path.join(pack, "preview")
    os.makedirs(os.path.join(out, "turntable"), exist_ok=True)
    st = spec["stills"]
    todo = [s for s in args.shots.split(",") if s and not (args.skip_existing and os.path.exists(os.path.join(out, f"{s}.exr")))]
    if not todo and not args.turntable:
        print(f"[preview] {spec['car']}: all shots already rendered", flush=True)
        return
    sc, cam, pivot = build(pack, spec)
    w, h = int(st["width"] * args.scale), int(st["height"] * args.scale)
    for name in todo:
        shot = st["shots"][name]
        look(cam, shot["loc"], shot["aim"])
        took = render(sc, os.path.abspath(os.path.join(out, f"{name}.exr")), w, h, args.samples)
        print(f"[preview] {spec['car']} {name}: {w}x{h} @ {args.samples} spp in {took:.0f} s", flush=True)

    if args.turntable:
        tt = spec["turntable"]
        look(cam, tt["loc"], tt["aim"])
        w, h = int(tt["width"] * args.tt_scale), int(tt["height"] * args.tt_scale)
        n = args.frames or tt["frames"]
        t0 = time.time()
        for i in range(n):
            frame = os.path.abspath(os.path.join(out, "turntable", "%04d.exr" % (i + 1)))
            if args.skip_existing and os.path.exists(frame):
                continue  # resume an interrupted turntable
            pivot.rotation_euler = (0, 0, 2 * math.pi * i / tt["frames"])
            render(sc, frame, w, h, args.tt_samples)
            if i % 10 == 0:
                el = time.time() - t0
                print(f"[preview] turntable {i + 1}/{n}, ~{el / (i + 1) * (n - i - 1) / 60:.0f} min left", flush=True)
    print("[preview] done ->", out, flush=True)


if os.path.exists(os.path.join(args.pack, "studio.json")):
    preview(args.pack)
else:  # a folder of packs
    index = os.path.join(args.pack, "packs.json")
    cars = [c["id"] for c in json.load(open(index))["cars"]] if os.path.exists(index) else \
        sorted(d for d in os.listdir(args.pack) if os.path.exists(os.path.join(args.pack, d, "studio.json")))
    t_all = time.time()
    for i, car in enumerate(cars):
        try:
            preview(os.path.join(args.pack, car))
        except Exception as e:  # one car must not end the batch
            print(f"[preview] {car} FAILED: {e}", flush=True)
        print(f"[preview] {i + 1}/{len(cars)} cars, ~{(time.time() - t_all) / (i + 1) * (len(cars) - i - 1) / 60:.0f} min left", flush=True)
