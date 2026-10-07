#!/usr/bin/env python3
"""A whole car, packed to be rendered in 3ds Max (Arnold) in the game's studio.

    npm run max:render-pack -- black-demon
    npm run max:render-pack -- all                 # every car in press/renders/cars.json
    python3 tools/max/render_pack.py --car black-demon,storm-s8 [--width 2560 --height 1440]

Reads press/renders/glb/<car>.glb (tools/shots/export-cars.mjs: the car as
the game builds it, paint and lamps included) and writes
press/max/render/<car>/:

  <car>.fbx        the car, metres, the way Max reads FBX natively; every
                   material has a stable, unique name
  tex/             its textures (plates, tyre, decals) as PNG
  materials.json   every material's values, read from the glTF the importer
                   built: base colour (linear and sRGB), metalness, roughness,
                   clearcoat, alpha, transmission, emission, textures. FBX drops
                   clearcoat and emission strength, so the Max side rebuilds
                   every material from this, by name.
  studio.json      the studio of tools/blender/studio.py, solved for this car,
                   in Max's frame (metres, Z up, nose -Y): floor, five area
                   lights, the world grey, a fitted camera per shot (hero, side,
                   rear) and a turntable (pivot, frames, a camera framed so no
                   frame clips).

With more than one car it also writes press/max/render/packs.json, the
list the Max panel's "Render all packs" walks.

tools/max/nightracer/render.py builds and renders it in Max;
tools/max/preview_render.py renders the same pack in Cycles here.
"""
import argparse, json, math, os, sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "blender"))
import studio  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--car", default="black-demon")
ap.add_argument("--glb-dir", default="press/renders/glb")
ap.add_argument("--cars", default="press/renders/cars.json")
ap.add_argument("--out", default="press/max/render")
ap.add_argument("--width", type=int, default=2560)
ap.add_argument("--height", type=int, default=1440)
ap.add_argument("--tt-width", type=int, default=1920)
ap.add_argument("--tt-height", type=int, default=1080)
ap.add_argument("--frames", type=int, default=120)
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])


def srgb(c):
    return tuple(12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055 for v in c)


def rgb(socket):
    return tuple(round(float(v), 6) for v in socket.default_value[:3])


def linked_image(socket):
    """The image feeding a socket (directly or through a mapping), or None."""
    if not socket.is_linked:
        return None
    n = socket.links[0].from_node
    seen = 0
    while n is not None and n.type != "TEX_IMAGE" and seen < 6:
        ins = [i for i in n.inputs if i.is_linked]
        n = ins[0].links[0].from_node if ins else None
        seen += 1
    return n if n is not None and n.type == "TEX_IMAGE" else None


def roughness_of(socket):
    """The Principled roughness as a number Max can use.

    Unlinked, it is the socket's value. Linked to a texture (glTF puts
    roughness in the green channel of metallicRoughness, and the tyre's
    is the only one in the fleet), the socket's default_value is just
    the Principled default, 0.5 — which is what was recorded, and what
    gave the tyres a half-gloss in Max against the game's 0.7 sidewall
    and 0.86 tread. So the linked case reads the image: the mean of its
    green channel times any "Roughness Factor" Math node on the way, as
    Max's scalar; the map itself is recorded beside it (roughness_tex)
    for the renderer that can take one."""
    if not socket.is_linked:
        return round(float(socket.default_value), 4)
    n = socket.links[0].from_node
    factor = 1.0
    if n.type == "MATH" and n.operation == "MULTIPLY":
        linked = [i for i in n.inputs if i.is_linked]
        plain = [i for i in n.inputs if not i.is_linked]
        if plain:
            factor = float(plain[0].default_value)
        n = linked[0].links[0].from_node if linked else None
    img = linked_image(socket)
    if img is None or img.image is None:
        return 0.5
    px = img.image.pixels[:]
    if not px:
        return 0.5
    g = px[1::4]
    return round(factor * sum(g) / len(g), 4)


def mapping_of(tex_node):
    """KHR_texture_transform comes in as a Mapping node in front of the image.

    Not always DIRECTLY in front. For a texture whose wrap modes differ
    (the tyre's: REPEAT around, CLAMP across, with an 18x repeat), the
    importer puts Separate XYZ, Math and Combine XYZ nodes between the
    Mapping node and the image to do the clamp, and the Mapping node sits
    behind them. Walk upstream until it is found; the tyre's 18x repeat
    was being dropped, and Max drew one tread block stretched round the
    whole tyre."""
    v = tex_node.inputs.get("Vector")
    if v is None or not v.is_linked:
        return None
    stack, seen = [v.links[0].from_node], set()
    m = None
    while stack:
        n = stack.pop()
        if n.name in seen:
            continue
        seen.add(n.name)
        if n.type == "MAPPING":
            m = n
            break
        for i in n.inputs:
            if i.is_linked:
                stack.append(i.links[0].from_node)
    if m is None:
        return None
    return {"offset": [round(float(x), 6) for x in m.inputs["Location"].default_value[:2]],
            "rotation": round(float(m.inputs["Rotation"].default_value[2]), 6),
            "scale": [round(float(x), 6) for x in m.inputs["Scale"].default_value[:2]]}


def pack(car):
    glb = os.path.join(args.glb_dir, f"{car}.glb")
    if not os.path.exists(glb):
        sys.exit(f"no {glb}: run node tools/shots/export-cars.mjs first")
    rec = next((c for c in json.load(open(args.cars)) if c["id"] == car), {"id": car, "name": car})
    out = os.path.join(args.out, car)
    tex_dir = os.path.join(out, "tex")
    os.makedirs(tex_dir, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb, import_pack_images=True, merge_vertices=False, import_shading="NORMALS")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    mn = Vector((math.inf,) * 3)
    mx = Vector((-math.inf,) * 3)
    for o in meshes:
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            mn, mx = Vector(map(min, mn, p)), Vector(map(max, mx, p))
    mn, mx = tuple(mn), tuple(mx)

    # Stable, Max-safe material names: no dots, unnamed ones numbered.
    used = []
    for o in meshes:
        for s in o.material_slots:
            if s.material and s.material not in used:
                used.append(s.material)
    for i, m in enumerate(sorted(used, key=lambda m: m.name)):
        name = m.name.replace(".", "_")
        if name.startswith("Material"):
            name = "mat_%02d" % i
        m.name = name

    images_saved = {}

    def save_image(node):
        if node is None or node.image is None:
            return None
        img = node.image
        if img.name in images_saved:
            return images_saved[img.name]
        fn = "%s.png" % "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in os.path.splitext(img.name)[0])
        path = os.path.join(tex_dir, fn)
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        images_saved[img.name] = "tex/" + fn
        return images_saved[img.name]

    mats = {}
    for m in used:
        b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b is None:
            continue
        g = b.inputs.get
        base = rgb(g("Base Color"))
        emis = rgb(g("Emission Color"))
        rec_m = {
            "base": base, "base_srgb": tuple(round(v, 6) for v in srgb(base)),
            "metalness": round(float(g("Metallic").default_value), 4),
            "roughness": roughness_of(g("Roughness")),
            "coat": round(float(g("Coat Weight").default_value), 4) if g("Coat Weight") else 0.0,
            "coat_roughness": round(float(g("Coat Roughness").default_value), 4) if g("Coat Roughness") else 0.0,
            "alpha": round(float(g("Alpha").default_value), 4),
            "transmission": round(float(g("Transmission Weight").default_value), 4) if g("Transmission Weight") else 0.0,
            "ior": round(float(g("IOR").default_value), 4),
            "emission": emis, "emission_srgb": tuple(round(v, 6) for v in srgb(emis)),
            "emission_strength": round(float(g("Emission Strength").default_value), 4),
            "blend": getattr(m, "surface_render_method", "DITHERED") == "BLENDED",
        }
        for key, sock in (("base_tex", "Base Color"), ("alpha_tex", "Alpha"), ("emission_tex", "Emission Color")):
            node = linked_image(g(sock))
            if node:
                rec_m[key] = save_image(node)
                mp = mapping_of(node)
                if mp:
                    rec_m[key + "_map"] = mp
                # glTF CLAMP comes in as EXTEND with nothing in front; REPEAT
                # either as REPEAT or as EXTEND behind wrap maths. Max tiles a
                # bitmap unless told not to.
                if node.extension == "EXTEND" and not node.inputs["Vector"].is_linked:
                    rec_m[key + "_clamp"] = True
        nrm = g("Normal")
        if nrm is not None and nrm.is_linked and nrm.links[0].from_node.type == "NORMAL_MAP":
            nm = nrm.links[0].from_node
            node = linked_image(nm.inputs["Color"])
            if node:
                rec_m["normal_tex"] = save_image(node)
                # The map alone is not the relief: the game's normalScale
                # (1.6 on the tyre lettering, 0.85 on the rubber) arrives as
                # the Normal Map node's Strength, and Max's Normal_Bump has
                # its own multiplier for it. Left out, the lettering stood
                # 37% shallower in Max than in the game and in Blender.
                rec_m["normal_strength"] = round(float(nm.inputs["Strength"].default_value), 4)
                mp = mapping_of(node)
                if mp:
                    rec_m["normal_tex_map"] = mp
                if node.extension == "EXTEND" and not node.inputs["Vector"].is_linked:
                    rec_m["normal_tex_clamp"] = True
        # The roughness map, where there is one (the tyre's: satin
        # sidewall 0.7, matte tread 0.86, in the green channel), with the
        # transform the colour map has.
        rs = g("Roughness")
        if rs.is_linked:
            node = linked_image(rs)
            if node:
                rec_m["roughness_tex"] = save_image(node)
                mp = mapping_of(node)
                if mp:
                    rec_m["roughness_tex_map"] = mp
                if node.extension == "EXTEND" and not node.inputs["Vector"].is_linked:
                    rec_m["roughness_tex_clamp"] = True
        if g("Roughness").is_linked or g("Metallic").is_linked:
            rec_m["note"] = "metal/rough from a texture in the game; the scalar is the map's mean"
        mats[m.name] = rec_m

    # The FBX: the car, nothing else.
    for o in bpy.data.objects:
        o.select_set(o.type in ("MESH", "EMPTY"))
    fbx = os.path.join(out, f"{car}.fbx")
    bpy.ops.export_scene.fbx(filepath=fbx, use_selection=True, apply_scale_options="FBX_SCALE_ALL",
                             axis_forward="-Z", axis_up="Y", object_types={"EMPTY", "MESH"},
                             mesh_smooth_type="FACE", use_tspace=False, add_leaf_bones=False, bake_anim=False,
                             path_mode="RELATIVE", embed_textures=False)

    c, gz, L, H = studio.dims(mn, mx)
    shots = {}
    for name, (az, el) in studio.SHOTS.items():
        loc, aim, worst = studio.fit_camera(mn, mx, az, el, args.width / args.height)
        shots[name] = {"loc": loc, "aim": aim, "az": az, "el": el, "fill": round(worst, 4)}
    az, el = studio.SHOTS["hero"]
    tloc, taim, tworst = studio.fit_camera(mn, mx, az, el, args.tt_width / args.tt_height,
                                           corners=studio.turntable_corners(mn, mx))
    spec = {
        "car": car, "name": rec.get("name", car), "ar": rec.get("ar", ""),
        "frame": "metres, Z up, nose -Y (3ds Max and Blender)",
        "bounds": {"min": mn, "max": mx}, "length": L, "height": H,
        "fbx": os.path.basename(fbx), "glb": os.path.relpath(glb, out),
        "floor": studio.floor(mn, mx), "lights": studio.rig(mn, mx), "world": studio.WORLD_GREY,
        "lens_mm": studio.LENS_MM, "sensor_mm": studio.SENSOR_MM,
        "hfov_deg": math.degrees(2 * math.atan(studio.SENSOR_MM / 2 / studio.LENS_MM)),
        "stills": {"width": args.width, "height": args.height, "shots": shots},
        "turntable": {"width": args.tt_width, "height": args.tt_height, "frames": args.frames, "fps": 30,
                      "pivot": (c[0], c[1], gz), "loc": tloc, "aim": taim, "fill": round(tworst, 4)},
        "tonemap": "ACES (tools/max/finish_render.py), as the Blender studio set",
    }
    json.dump(spec, open(os.path.join(out, "studio.json"), "w"), indent=2)
    json.dump(mats, open(os.path.join(out, "materials.json"), "w"), indent=2)
    print(f"{car}: {len(meshes)} meshes, {len(mats)} materials, {len(images_saved)} textures, "
          f"{mx[0] - mn[0]:.2f} x {mx[1] - mn[1]:.2f} x {mx[2] - mn[2]:.2f} m -> {out}")
    for k, s in shots.items():
        print(f"  {k:5} camera at {tuple(round(v, 2) for v in s['loc'])}, worst corner at {s['fill']:.3f} of the frame")
    print(f"  turntable camera at {tuple(round(v, 2) for v in tloc)}, {args.frames} frames")
    return {"id": car, "name": rec.get("name", car), "ar": rec.get("ar", ""), "cls": rec.get("cls"),
            "pack": car, "meshes": len(meshes), "materials": len(mats)}


def main():
    records = json.load(open(args.cars))
    if args.car == "all":
        cars = [c["id"] for c in records]
    else:
        cars = [c for c in args.car.split(",") if c]
    known = {c["id"] for c in records}
    unknown = [c for c in cars if c not in known]
    if unknown:
        sys.exit(f"not in {args.cars}: {', '.join(unknown)}")
    done, failed = [], []
    for car in cars:
        try:
            done.append(pack(car))
        except (Exception, SystemExit) as e:  # one bad car must not end the batch
            print(f"{car}: FAILED: {e}")
            failed.append(car)
    if len(cars) > 1:
        # Merged by id, so packing a few cars again keeps the others listed.
        index = os.path.join(args.out, "packs.json")
        old = {}
        if os.path.exists(index):
            old = {c["id"]: c for c in json.load(open(index)).get("cars", [])}
        old.update({c["id"]: c for c in done})
        order = [c["id"] for c in records if c["id"] in old]
        json.dump({"cars": [old[i] for i in order]}, open(index, "w"), indent=2)
        print(f"\n{len(done)} packs, {len(failed)} failed -> {index}")
    if failed:
        sys.exit(1)


main()
