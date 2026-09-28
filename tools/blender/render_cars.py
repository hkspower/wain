#!/usr/bin/env python3
"""Studio beauty renders of every car in the catalogue, in Blender.

    pip install bpy                                   # Blender as a module
    node tools/shots/export-cars.mjs                  # the cars, out of the game
    python3 tools/blender/render_cars.py              # all of them, 2560x1440
    python3 tools/blender/render_cars.py --only black-demon --preview

Reads press/renders/glb/<id>.glb (tools/shots/export-cars.mjs) and
press/renders/cars.json, writes press/renders/<id>.png and a
renders.json of what each took.

THE STUDIO. A black stage the car sits on, the way a car is shot for a
brochure: a dark, glossy floor that carries the reflection and nothing
else; a big soft key high on the front quarter; a cooler, weaker fill
from the other side; a hard rim from behind for the roofline; and the
one thing that makes a car photograph read as a car photograph — a long
thin strip of light over the roof, so a single unbroken highlight runs
the length of the bonnet and roof and turns at the pillars. A sodium
kicker low behind the far flank ties it to the game's road. The world
is black to the camera and a dim grey to everything else, so the paint
has something to reflect where the lights are not.

THE MATERIALS COME WITH THE CAR. The glTF carries the paint's colour,
metalness, roughness and clearcoat, the glass's alpha and film, the
lamps' emission, every decal and canvas texture (KHR clearcoat,
emissive_strength and texture_transform all import). What the game
does in its renderer that a file cannot carry — the environment probe,
envMapIntensity — the studio lighting stands in for. The one thing put
right here is back-face culling: the exhaust bores are inside-out
cylinders by design and glTF is single-sided, so culling is off on
every material, which Cycles honours.

COLOUR. The game tone-maps with ACESFilmic; Blender 5.0 ships ACES 1.3
as a view transform, so a paint here lands where the game puts it. The
fallbacks (Khronos PBR Neutral, Standard) are for older Blenders.

Cycles on the CPU with OpenImageDenoise: measured on this project's
build machine at 0.99 s per sample per megapixel under load, so a
2560x1440 car at 128 samples is a few minutes on an idle 4-core box —
adaptive sampling stops the black background early, and the denoiser
takes the rest of the noise out of the paint.
"""
import argparse, json, math, os, sys, time

import bpy
from mathutils import Vector

ap = argparse.ArgumentParser()
ap.add_argument("--glb-dir", default="press/renders/glb")
ap.add_argument("--cars", default="press/renders/cars.json")
ap.add_argument("--out", default="press/renders")
ap.add_argument("--width", type=int, default=2560)
ap.add_argument("--height", type=int, default=1440)
ap.add_argument("--samples", type=int, default=128)
ap.add_argument("--only", default="", help="comma-separated car ids")
ap.add_argument("--preview", action="store_true", help="640x360 at 32 samples, for a look")
ap.add_argument("--exposure", type=float, default=0.0, help="view exposure, in stops")
ap.add_argument("--keep-blend", action="store_true", help="save <out>/<id>.blend beside the render")
args = ap.parse_args(sys.argv[1:] if "--" not in sys.argv else sys.argv[sys.argv.index("--") + 1:])
if args.preview:
    args.width, args.height, args.samples = 640, 360, 32

# The game paints in sRGB hex; the sodium the road is lit by.
SODIUM = (0.92, 0.40, 0.03)


def log(*a):
    print("[render]", *a, flush=True)


def try_set(obj, attr, value):
    try:
        setattr(obj, attr, value)
        return True
    except Exception:
        return False


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def add_area(name, loc, target, energy, size, size_y=None, spread_deg=180, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.color = color
    ld.shape = "RECTANGLE" if size_y else "SQUARE"
    ld.size = size
    if size_y:
        ld.size_y = size_y
    ld.spread = math.radians(spread_deg)
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).normalized().to_track_quat("-Z", "Y").to_euler()
    return ob


def studio(mn, mx):
    """The stage, lit for a car whose world bounds are mn..mx (metres)."""
    sc = bpy.context.scene
    dims = mx - mn
    c = (mn + mx) / 2
    gz = mn.z
    # The car comes in nose along -Y (glTF +Z forward); its long axis is Y.
    L = max(dims.x, dims.y)
    H = dims.z

    # Floor: black diffuse, low roughness — the reflection is the whole
    # point, and the specular is independent of the albedo.
    bpy.ops.mesh.primitive_plane_add(size=max(120.0, L * 30), location=(c.x, c.y, gz))
    ground = bpy.context.active_object
    ground.name = "Ground"
    gm = bpy.data.materials.new("Stage")
    gm.use_nodes = True
    b = gm.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.010, 0.010, 0.011, 1.0)
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Roughness"].default_value = 0.26
    b.inputs["Specular IOR Level"].default_value = 0.6
    ground.data.materials.append(gm)

    tgt = (c.x, c.y, c.z)
    # Camera stands on the -Y side (the nose side), off toward -X.
    add_area("Key", (c.x - 1.3 * L, c.y - 0.8 * L, gz + 2.4 * H + 1.0), tgt, energy=1100, size=3.6, size_y=2.4, spread_deg=110)
    add_area("Fill", (c.x + 1.6 * L, c.y - 0.6 * L, gz + 1.0 * H + 0.6), tgt, energy=170, size=5.0, size_y=3.5, spread_deg=160, color=(0.86, 0.91, 1.0))
    add_area("Rim", (c.x + 0.5 * L, c.y + 1.4 * L, gz + 2.2 * H + 1.0), tgt, energy=1400, size=2.2, size_y=1.2, spread_deg=80, color=(0.95, 0.97, 1.0))
    add_area("Sodium", (c.x - 0.9 * L, c.y + 1.2 * L, gz + 0.45 * H), (c.x, c.y, gz + 0.5 * H), energy=260, size=1.6, size_y=0.6, spread_deg=70, color=SODIUM)
    # The strip: long, thin, straight down over the roof, along the car.
    strip = add_area("Strip", (c.x - 0.15 * L, c.y, gz + H + 1.5 * H + 0.9), tgt, energy=1500, size=0.35, size_y=3.0 * L, spread_deg=120)
    strip.rotation_euler = (0, 0, 0)

    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    w = sc.world
    if w.node_tree is None:
        w.use_nodes = True
    wn = w.node_tree
    wn.nodes.clear()
    out = wn.nodes.new("ShaderNodeOutputWorld")
    lit = wn.nodes.new("ShaderNodeBackground")
    lit.inputs["Color"].default_value = (0.045, 0.045, 0.055, 1)
    lit.inputs["Strength"].default_value = 1.0
    black = wn.nodes.new("ShaderNodeBackground")
    black.inputs["Color"].default_value = (0, 0, 0, 1)
    lp = wn.nodes.new("ShaderNodeLightPath")
    mix = wn.nodes.new("ShaderNodeMixShader")
    wn.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
    wn.links.new(lit.outputs["Background"], mix.inputs[1])
    wn.links.new(black.outputs["Background"], mix.inputs[2])
    wn.links.new(mix.outputs["Shader"], out.inputs["Surface"])

    # Camera: three-quarter front, a little below the beltline. Fitted
    # to the car's BOX, not its sphere: the eight corners are projected
    # through the lens and the camera walks back along its own axis until
    # all of them sit inside the frame with a 7% margin. A sphere fit
    # (the first cut) left a 4.7 m car filling half the width.
    cam_d = bpy.data.cameras.new("Cam")
    cam_d.lens = 55.0
    cam_d.sensor_width = 36.0
    cam_d.sensor_fit = "HORIZONTAL"
    cam = link(bpy.data.objects.new("Cam", cam_d))
    az = -(math.pi / 2 - math.radians(36))  # toward -Y (the nose), swung 36 deg off the axis
    el = math.radians(8.5)
    view = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    aim = Vector((c.x, c.y, gz + 0.40 * H))
    tan_h = cam_d.sensor_width / 2 / cam_d.lens
    tan_v = tan_h * args.height / args.width
    corners = [Vector((x, y, z)) for x in (mn.x, mx.x) for y in (mn.y, mx.y) for z in (mn.z, mx.z)]
    dist = 1.0
    for _ in range(40):
        cam.location = aim + view * dist
        rot = (aim - cam.location).to_track_quat("-Z", "Y")
        inv = rot.to_matrix().transposed()
        worst = 0.0
        for k in corners:
            p = inv @ (k - cam.location)  # camera space: -Z forward
            depth = -p.z
            if depth <= 0.05:
                worst = 9.0
                break
            worst = max(worst, abs(p.x) / (depth * tan_h), abs(p.y) / (depth * tan_v))
        if abs(worst - 0.93) < 0.005:
            break
        dist *= worst / 0.93
    cam.rotation_euler = (aim - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam


def settle_materials():
    """What the game's renderer did that the file cannot say."""
    for m in bpy.data.materials:
        m.use_backface_culling = False
        try_set(m, "use_backface_culling_shadow", False)


def configure(sc, out_png):
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    cy.device = "CPU"
    cy.samples = args.samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.01
    cy.adaptive_min_samples = min(32, args.samples)
    cy.time_limit = 0
    cy.max_bounces = 10
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 6
    cy.transmission_bounces = 8
    cy.transparent_max_bounces = 10
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.use_denoising = True
    try_set(cy, "denoiser", "OPENIMAGEDENOISE")
    try_set(cy, "denoising_input_passes", "RGB_ALBEDO_NORMAL")
    try_set(cy, "denoising_prefilter", "ACCURATE")
    try_set(cy, "denoising_quality", "HIGH")
    try_set(cy, "denoising_use_gpu", False)
    try_set(cy, "use_light_tree", True)
    sc.render.film_transparent = False
    sc.render.filter_size = 1.5
    for vt in ("ACES 1.3", "Khronos PBR Neutral", "Standard"):
        if try_set(sc.view_settings, "view_transform", vt):
            break
    try_set(sc.view_settings, "look", "None")
    sc.view_settings.exposure = args.exposure
    sc.view_settings.gamma = 1.0
    try_set(sc.display_settings, "display_device", "sRGB")
    r = sc.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = args.width, args.height, 100
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGB"
    r.image_settings.color_depth = "8"
    r.image_settings.compression = 60
    r.filepath = out_png
    r.threads_mode = "AUTO"


def render_car(rec):
    cid = rec["id"]
    glb = os.path.join(args.glb_dir, f"{cid}.glb")
    if not os.path.exists(glb):
        log(f"{cid}: no {glb} — run tools/shots/export-cars.mjs first")
        return None
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(
        filepath=glb, import_pack_images=True, merge_vertices=False,
        import_shading="NORMALS", import_scene_as_collection=True,
    )
    bpy.context.view_layer.update()
    imported = [o for o in bpy.data.objects if o not in before]
    mn = Vector((math.inf,) * 3)
    mx = Vector((-math.inf,) * 3)
    tris = 0
    for o in imported:
        if o.type != "MESH":
            continue
        tris += len(o.data.polygons)
        for cnr in o.bound_box:
            p = o.matrix_world @ Vector(cnr)
            mn = Vector(map(min, mn, p))
            mx = Vector(map(max, mx, p))
    mats = len(bpy.data.materials)
    images = len(bpy.data.images)
    settle_materials()
    studio(mn, mx)
    out_png = os.path.abspath(os.path.join(args.out, f"{cid}.png"))
    configure(sc, out_png)
    log(f"{cid}: {len(imported)} objects, {tris} polys, {mats} materials, {images} images, "
        f"{(mx - mn).x:.2f} x {(mx - mn).y:.2f} x {(mx - mn).z:.2f} m; {args.width}x{args.height} @ {args.samples} spp, "
        f"{sc.view_settings.view_transform}")
    t1 = time.time()
    bpy.ops.render.render(write_still=True)
    took = time.time() - t1
    if args.keep_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(args.out, f"{cid}.blend")), compress=True)
    log(f"{cid}: rendered in {took:.0f} s -> {out_png} ({os.path.getsize(out_png) / 1e6:.1f} MB)")
    return {"id": cid, "png": os.path.relpath(out_png), "seconds": round(took, 1), "polys": tris,
            "materials": mats, "images": images, "width": args.width, "height": args.height,
            "samples": args.samples, "view": sc.view_settings.view_transform, "setup_s": round(t1 - t0, 1)}


records = json.load(open(args.cars))
only = [s for s in args.only.split(",") if s]
todo = [r for r in records if not only or r["id"] in only]
os.makedirs(args.out, exist_ok=True)
log(f"bpy {bpy.app.version_string}; {len(todo)} car(s)")
done = []
for rec in todo:
    r = render_car(rec)
    if r:
        done.append(r)
        with open(os.path.join(args.out, "renders.json"), "w") as f:
            json.dump(done, f, indent=2)
total = sum(d["seconds"] for d in done)
log(f"{len(done)} rendered, {total / 60:.1f} min of rendering")
