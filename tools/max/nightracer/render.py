"""Render a car's render pack in 3ds Max with Arnold.

A pack (press/max/render/<car>/, from tools/max/render_pack.py) holds the
car as FBX, materials.json and studio.json. This builds that studio in Max
and renders it:

  open_pack(folder)      reset, metres, import the FBX, rebuild every
                         material as a Physical Material from materials.json,
                         the floor, five Arnold quad lights, an Arnold
                         skydome for the world grey, a camera per shot, and
                         a turntable dummy the car hangs from
  render_stills(...)     <pack>/out/<shot>.exr (+ a quick .png)
  render_turntable(...)  <pack>/out/turntable/####.exr
  render_all(root, ...)  every pack under press/max/render/, resumable

The EXRs are linear; tools/max/finish_render.py grades them with the same
ACES view as the Blender studio set and encodes the turntable MP4.

Everything Arnold- or version-specific goes through set_prop(), which logs
a property this Max does not have instead of stopping. log() collects those
lines; the panel shows them, and they are the first thing to send back if a
render looks wrong.
"""
import json
import math
import os

from pymxs import runtime as rt

from . import maxio

LOG = []


def log(msg):
    LOG.append(msg)
    print("[nightracer render] " + msg)


def set_prop(obj, names, value):
    """Set the first of `names` this object has. Returns the name used."""
    if isinstance(names, str):
        names = (names,)
    for n in names:
        try:
            if rt.isProperty(obj, n):
                setattr(obj, n, value)
                return n
        except Exception:
            continue
    log("no property %s on %s" % ("/".join(names), rt.classOf(obj)))
    return None


# ---------------------------------------------------------------- frames and colour

def _norm(v):
    n = math.sqrt(sum(x * x for x in v))
    return tuple(x / n for x in v)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def look_matrix(loc, target, k):
    """Max transform for a camera or light at loc facing target: local -Z
    toward the target, local Y as near world Z as it can be (Blender's
    to_track_quat('-Z', 'Y')). k: metres -> scene units."""
    z = _norm(tuple(l - t for l, t in zip(loc, target)))
    up = (0.0, 0.0, 1.0)
    if abs(z[2]) > 0.999:
        up = (0.0, 1.0, 0.0)
    x = _norm(_cross(up, z))
    y = _cross(z, x)
    return rt.Matrix3(rt.Point3(*x), rt.Point3(*y), rt.Point3(*z), rt.Point3(*(c * k for c in loc)))


def colour_pipeline():
    """Put the freshly reset scene in Gamma Workflow mode and say what it is.

    In that mode (and on 2023, which has no ColorPipelineMgr) a colour
    written to a parameter is a linear Rec.709 number: the gamma setting
    only changes how swatches are DRAWN. 8-bit textures are decoded to
    linear, and EXRs are written linear Rec.709, which materials.json and
    finish_render.py both assume. 3ds Max 2025+ start new scenes in OCIO
    with an ACEScg rendering space, which would leave every texture
    desaturated in the EXR as Blender reads it, so the pack's scene is
    switched. (The MAXScript property is ColorPipelineMgr.mode;
    ColorPipelineMode is only the C++ enum's name.)"""
    try:
        cpm = rt.ColorPipelineMgr          # 2024+; undefined on 2023
    except Exception:
        cpm = None
    if cpm is None:
        return "legacy gamma (2023): colours are linear"
    try:
        before = str(cpm.mode).lstrip("#").lower()
        if before != "gamma":
            cpm.mode = rt.Name("gamma")
            log("colour management: switched this scene from %s to gamma (linear Rec.709)" % before)
        return str(cpm.mode).lstrip("#").lower()
    except Exception as e:
        log("colour management: could not set Gamma Workflow mode (%s); colours may not match" % e)
        return "unknown"


def maxio_year():
    return int(rt.maxVersion()[0]) // 1000 - 2 + 2000


def colour(lin, mode=None):
    """A swatch colour from a LINEAR Rec.709 value, written as is: Max reads
    a parameter colour as linear in every mode this script leaves the scene
    in. (`mode` is kept for the callers; it is always linear now.)"""
    return rt.Color(*(max(0.0, min(1.0, v)) * 255.0 for v in lin))


# ---------------------------------------------------------------- materials

def bitmap(pack, rel, mapping=None, alpha=False, clamp=False, raw=False):
    path = os.path.normpath(os.path.join(pack, rel))
    if not os.path.exists(path):
        log("missing texture %s" % path)
        return None
    b = rt.Bitmaptexture(filename=path)
    if raw:
        # Vectors, not colours: an 8-bit PNG would otherwise be decoded with
        # gamma 2.2, which turns a flat 0.5 into 0.21 and bends every normal.
        try:
            b.bitmap = rt.openBitMap(path, gamma=1.0)
        except Exception as e:
            log("could not load %s as raw data (normals will be gamma-decoded): %s" % (path, e))
    if alpha:
        set_prop(b, "monoOutput", 1)      # alpha as the mono output
        set_prop(b, "alphaSource", 0)     # the image's own alpha
    if clamp:
        set_prop(b.coords, "U_Tile", False)
        set_prop(b.coords, "V_Tile", False)
    if mapping:
        # Blender's Mapping node (Point): t = R(rot) S uv + L, about UV (0, 0).
        # Max's StandardUVGen rotates FIRST and tiles second, about the map
        # centre: t = S' R(w) (uv - 0.5 - off) + 0.5 (NVIDIA's 3ds Max Bitmap
        # emulation, ad_3dsmax_maps.mdl). S' R(w) equals R(rot) S only when
        # |sx| == |sy| (w = rot, or -rot when mirrored) or rot is a multiple
        # of 90 degrees (at 90/270 the tiling swaps axes); anything else would
        # need a skew StandardUVGen cannot express, and is logged.
        # With M = R(rot) S matched, off = M^-1 (0.5 - L) - 0.5.
        # (No pack has a transform today; this is for the first that does.)
        c = b.coords
        (lx, ly), (sx, sy), rot = mapping["offset"], mapping["scale"], mapping["rotation"]
        sx = sx if abs(sx) > 1e-9 else 1e-9
        sy = sy if abs(sy) > 1e-9 else 1e-9
        cr, sr = math.cos(rot), math.sin(rot)
        tu, tv, w = sx, sy, rot
        if abs(cr) <= 1e-6:                      # 90 / 270 degrees: tiling swaps axes
            tu, tv = sy, sx
        elif abs(sr) > 1e-6:                     # any other non-trivial angle
            tol = 1e-6 * max(1.0, abs(sx), abs(sy))
            if abs(sx + sy) <= tol and abs(sx - sy) > tol:   # mirrored uniform scale
                w = -rot
            elif abs(sx - sy) > tol:
                log("texture %s: rotation with non-uniform scale cannot be matched by StandardUVGen (it will skew)" % path)
        a, d = 0.5 - lx, 0.5 - ly
        set_prop(c, "U_Tiling", tu)
        set_prop(c, "V_Tiling", tv)
        set_prop(c, "U_Offset", (a * cr + d * sr) / sx - 0.5)
        set_prop(c, "V_Offset", (-a * sr + d * cr) / sy - 0.5)
        set_prop(c, "W_Angle", math.degrees(w))
    return b


def physical(name, m, pack, mode):
    """A Physical Material from one materials.json entry."""
    p = rt.PhysicalMaterial()
    p.name = name
    set_prop(p, "base_weight", 1.0)
    set_prop(p, "base_color", colour(m["base"], mode))
    set_prop(p, "metalness", m["metalness"])
    set_prop(p, "roughness", m["roughness"])
    set_prop(p, "roughness_inv", False)
    set_prop(p, "trans_ior", m.get("ior", 1.5))
    if m.get("coat", 0) > 0:
        set_prop(p, ("coating", "coat_weight"), m["coat"])
        set_prop(p, "coat_roughness", m["coat_roughness"])
        set_prop(p, "coat_ior", 1.5)
        # Physical defaults both to 0.5, darkening and roughening the base
        # under the coat; Blender's Principled coat and three.js clearcoat
        # do neither (Arnold standard_surface's own default is 0 too).
        set_prop(p, "coat_affect_color", 0.0)
        set_prop(p, "coat_affect_roughness", 0.0)
    if m.get("base_tex"):
        t = bitmap(pack, m["base_tex"], m.get("base_tex_map"), clamp=m.get("base_tex_clamp", False))
        if t:
            set_prop(p, "base_color_map", t)
    if m.get("normal_tex"):
        t = bitmap(pack, m["normal_tex"], raw=True)
        if t:
            nb = rt.Normal_Bump()
            set_prop(nb, "normal_map", t)
            set_prop(p, "bump_map", nb)
            set_prop(p, "bump_map_amt", 1.0)
    # Glass: the game blends it at alpha ~0.94 over a dark tint, which is a
    # thin, dark, reflective pane, not a solid lens.
    if m.get("blend") and m.get("alpha", 1) < 1 and not m.get("alpha_tex"):
        set_prop(p, "transparency", 1.0 - m["alpha"])
        set_prop(p, "trans_color", colour((1, 1, 1), mode))
        set_prop(p, "thin_walled", True)
    if m.get("alpha_tex"):
        t = bitmap(pack, m["alpha_tex"], m.get("alpha_tex_map"), alpha=True, clamp=m.get("alpha_tex_clamp", False))
        if t:
            set_prop(p, "cutout_map", t)
    if m.get("emission_strength", 0) > 0:
        set_prop(p, "emission", 1.0)
        set_prop(p, "emit_color", colour(m["emission"], mode))
        # Max's physical scale: 1500 cd/m2 renders as 1.0. The game's
        # emission strength is that 1.0 scale already.
        set_prop(p, "emit_luminance", 1500.0 * m["emission_strength"])
        set_prop(p, "emit_kelvin", 6500.0)
        if m.get("emission_tex"):
            t = bitmap(pack, m["emission_tex"], m.get("emission_tex_map"), clamp=m.get("emission_tex_clamp", False))
            if t:
                set_prop(p, "emit_color_map", t)
    return p


def apply_materials(pack, mats, mode):
    """Swap every imported material whose name is in materials.json, in
    plain and multi-materials alike. Returns (replaced, missing names)."""
    built = {}

    def get(name):
        if name not in built:
            built[name] = physical(name, mats[name], pack, mode)
        return built[name]

    # Sub-materials through MAXScript: a Multimaterial's list is 1-based and
    # pymxs hands back a copy of the array, not the list itself.
    rt.execute("fn nrSubCount m = m.materialList.count")
    rt.execute("fn nrGetSub m i = m.materialList[i]")
    rt.execute("fn nrSetSub m i s = (m.materialList[i] = s; ok)")
    seen = set()
    for n in rt.objects:
        mtl = n.material
        if mtl is None:
            continue
        if rt.classOf(mtl) == rt.Multimaterial:
            for i in range(1, int(rt.nrSubCount(mtl)) + 1):
                sub = rt.nrGetSub(mtl, i)
                if sub is not None:
                    seen.add(str(sub.name))
                    if str(sub.name) in mats:
                        rt.nrSetSub(mtl, i, get(str(sub.name)))
        else:
            seen.add(str(mtl.name))
            if str(mtl.name) in mats:
                n.material = get(str(mtl.name))
    missing = sorted(seen - set(mats))
    if missing:
        log("materials in the scene but not in materials.json (left as imported): %s" % ", ".join(missing))
    return len(built), missing


# ---------------------------------------------------------------- studio

def arnold_available():
    try:
        return rt.Arnold is not None and rt.Arnold_Light is not None
    except Exception:
        return False


def quad_light(L, k, scale, mode):
    """One studio light. Blender area watts P -> radiance P / (pi A), given to
    Arnold UN-normalised: with normalize off, intensity is the radiance itself,
    whatever the light's size and the scene's units. (With it on, Arnold
    divides by the area again: the key would come out 8.6x too dark and the
    fill 17.5x.)"""
    area = L["size"] * L["size_y"]
    radiance = L["energy"] / (math.pi * area) * scale
    if L.get("down"):
        target = (L["loc"][0], L["loc"][1], L["loc"][2] - 1.0)
    else:
        target = L["target"]
    if arnold_available():
        a = rt.Arnold_Light()
        set_prop(a, ("shapeType", "lightShape"), 3)   # MAXtoA shapeType: 3 = Quad
        set_prop(a, "quadX", L["size"] * k)
        set_prop(a, "quadY", L["size_y"] * k)
        set_prop(a, "normalize", False)
        set_prop(a, "intensity", radiance)
        set_prop(a, "exposure", 0.0)
        set_prop(a, "color", colour(L["color"], mode))
        set_prop(a, "spread", min(1.0, L["spread_deg"] / 180.0))
        hide_from_camera(a)
        set_prop(a, "samples", 2)
    else:
        a = rt.Free_Area()   # photometric fallback: lights, but not matched
        set_prop(a, "light_length", L["size_y"] * k)
        set_prop(a, "light_width", L["size"] * k)
        set_prop(a, "intensity", radiance * 1000.0)
        log("Arnold lights unavailable: %s is a Photometric area light; levels will not match" % L["name"])
    a.name = "NR_" + L["name"]
    a.transform = look_matrix(L["loc"], target, k)
    return a


def hide_from_camera(light):
    """Lights light, and show in reflections, but the camera never sees them
    (as in the Blender studio). The shape's own visibility is the switch;
    the Contribution panel's camera weight goes to 0 too where it exists."""
    set_prop(light, "lightShapeVisible", False)
    try:
        if rt.isProperty(light, "camera"):
            light.camera = 0.0
    except Exception:
        pass


def build_studio(pack, spec, light_scale=1.0, mode="linear"):
    k = 1.0 / maxio.unit_to_m()
    made = []
    fl = spec["floor"]
    plane = rt.Plane(length=fl["size"] * k, width=fl["size"] * k, lengthsegs=1, widthsegs=1)
    plane.position = rt.Point3(*(c * k for c in fl["center"]))
    plane.name = "NR_Floor"
    fm = rt.PhysicalMaterial()
    fm.name = "NR_Stage"
    set_prop(fm, "base_color", colour(fl["base"], mode))
    set_prop(fm, "roughness", fl["roughness"])
    set_prop(fm, "reflectivity", fl["specular"] * 2.0)   # Blender specular 0.5 is F0 4%, Physical reflectivity 1.0
    plane.material = fm
    made.append(plane)

    for L in spec["lights"]:
        made.append(quad_light(L, k, light_scale, mode))

    if arnold_available():
        sky = rt.Arnold_Light()
        sky.name = "NR_World"
        set_prop(sky, ("shapeType", "lightShape"), 6)     # MAXtoA shapeType: 6 = Skydome
        set_prop(sky, "color", colour(spec["world"], mode))
        set_prop(sky, "intensity", 1.0 * light_scale)
        set_prop(sky, "exposure", 0.0)
        hide_from_camera(sky)
        made.append(sky)
    rt.backgroundColor = rt.Color(0, 0, 0)

    cams = {}
    hfov = spec["hfov_deg"]
    for name, s in spec["stills"]["shots"].items():
        c = rt.Freecamera()
        c.name = "NR_Cam_" + name
        set_prop(c, "fovType", 1)       # horizontal
        set_prop(c, "fov", hfov)
        c.transform = look_matrix(s["loc"], s["aim"], k)
        cams[name] = c
    tt = spec["turntable"]
    c = rt.Freecamera()
    c.name = "NR_Cam_turntable"
    set_prop(c, "fovType", 1)
    set_prop(c, "fov", hfov)
    c.transform = look_matrix(tt["loc"], tt["aim"], k)
    cams["turntable"] = c
    return made, cams


def open_pack(pack, light_scale=1.0, colours="auto"):
    """Build the whole scene. Returns a dict the render calls use."""
    del LOG[:]
    spec = json.load(open(os.path.join(pack, "studio.json")))
    mats = json.load(open(os.path.join(pack, "materials.json")))
    rt.resetMaxFile(rt.Name("noPrompt"))
    maxio.metres()
    log("colour management: %s" % colour_pipeline())
    rt.FBXImporterSetParam("ResetImport")
    rt.FBXImporterSetParam("Mode", rt.Name("create"))
    rt.FBXImporterSetParam("ScaleConversion", True)
    rt.FBXImporterSetParam("ConvertUnit", "m")
    rt.FBXImporterSetParam("SmoothingGroups", True)
    rt.FBXImporterSetParam("Cameras", False)
    rt.FBXImporterSetParam("Lights", False)
    rt.FBXImporterSetParam("Animation", False)
    before = set(str(n.handle) for n in rt.objects)
    fbx = os.path.join(pack, spec["fbx"])
    if not os.path.isfile(fbx):
        raise RuntimeError("FBX not found: %s" % fbx)
    ok = rt.importFile(fbx, rt.Name("noPrompt"), using=rt.FBXIMP)
    car = [n for n in rt.objects if str(n.handle) not in before]
    if ok is False or not car:
        # Without this a failed import renders an empty studio, and the batch
        # would count those EXRs as done.
        raise RuntimeError("FBX import failed or brought in nothing: %s" % fbx)
    k = 1.0 / maxio.unit_to_m()

    mode = "linear"
    n, missing = apply_materials(pack, mats, mode)
    log("%d Physical Materials built from materials.json" % n)

    # The car hangs from a dummy at its floor centre, for the turntable.
    pivot = rt.Dummy()
    pivot.name = "NR_Turntable"
    pivot.position = rt.Point3(*(c * k for c in spec["turntable"]["pivot"]))
    for node in car:
        if node.parent is None:
            node.parent = pivot

    if not arnold_available():
        log("Arnold is not available in this Max: install MAXtoA (it ships with 3ds Max) for a matched render")
    else:
        rt.renderers.current = rt.Arnold()
    made, cams = build_studio(pack, spec, light_scale, mode)
    rt.SceneExposureControl.exposureControl = None    # linear EXRs; the grade is finish_render's
    rt.execute("max zoomext sel all")
    return {"pack": pack, "spec": spec, "cams": cams, "pivot": pivot, "car": car}


def arnold_quality(aa=6, diffuse=3, specular=3, transmission=4):
    r = rt.renderers.current
    if rt.classOf(r) != rt.Arnold:
        return
    set_prop(r, "AA_samples", aa)
    set_prop(r, "GI_diffuse_samples", diffuse)
    set_prop(r, "GI_specular_samples", specular)
    set_prop(r, "GI_transmission_samples", transmission)
    set_prop(r, "GI_diffuse_depth", 2)
    set_prop(r, "GI_specular_depth", 4)
    set_prop(r, "GI_transmission_depth", 8)
    set_prop(r, "GI_total_depth", 10)


def _render(cam, path, w, h):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # outputHDRbitmap: a 32-bit float buffer, or the EXR is clipped at 1.0
    # before finish_render.py's ACES view ever sees the highlights.
    bm = rt.render(camera=cam, outputwidth=w, outputheight=h, outputfile=path,
                   outputHDRbitmap=True, vfb=False, quiet=True)
    return bm


def render_stills(scene, shots=("hero", "side", "rear"), width=None, height=None, aa=6, progress=None):
    spec, out = scene["spec"], os.path.join(scene["pack"], "out")
    w, h = width or spec["stills"]["width"], height or spec["stills"]["height"]
    arnold_quality(aa)
    done = []
    scene["pivot"].rotation = rt.EulerAngles(0, 0, 0)
    for i, name in enumerate(shots):
        if progress:
            progress(name, i, len(shots))
        exr = os.path.join(out, "%s.exr" % name)
        bm = _render(scene["cams"][name], exr, w, h)
        try:  # a quick look, display-gamma; the graded PNG comes from finish_render
            bm.filename = os.path.join(out, "%s_quick.png" % name)
            rt.save(bm)
            rt.close(bm)
        except Exception as e:
            log("quick PNG for %s: %s" % (name, e))
        done.append(exr)
    return done


def render_turntable(scene, frames=None, width=None, height=None, aa=4, progress=None):
    spec, out = scene["spec"], os.path.join(scene["pack"], "out", "turntable")
    tt = spec["turntable"]
    n = frames or tt["frames"]
    w, h = width or tt["width"], height or tt["height"]
    arnold_quality(aa)
    for i in range(n):
        if progress:
            progress("turntable", i, n)
        # One full turn over the frames; frame 1 is the hero angle.
        scene["pivot"].rotation = rt.EulerAngles(0, 0, 360.0 * i / tt["frames"])
        bm = _render(scene["cams"]["turntable"], os.path.join(out, "%04d.exr" % (i + 1)), w, h)
        try:
            rt.close(bm)
        except Exception:
            pass
    scene["pivot"].rotation = rt.EulerAngles(0, 0, 0)
    return out


# ---------------------------------------------------------------- every car

def list_packs(root):
    """The packs under root, in packs.json order when there is one."""
    index = os.path.join(root, "packs.json")
    if os.path.exists(index):
        ids = [c["id"] for c in json.load(open(index))["cars"]]
    else:
        ids = sorted(d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d)))
    return [i for i in ids if os.path.exists(os.path.join(root, i, "studio.json"))]


def _done(pack, shots, turntable, frames):
    out = os.path.join(pack, "out")
    if any(not os.path.exists(os.path.join(out, "%s.exr" % s)) for s in shots):
        return False
    if turntable:
        n = frames or json.load(open(os.path.join(pack, "studio.json")))["turntable"]["frames"]
        return os.path.exists(os.path.join(out, "turntable", "%04d.exr" % n))
    return True


def render_all(root, shots=("hero", "side", "rear"), turntable=False, frames=None, half=False, aa=6,
               light_scale=1.0, skip_done=True, progress=None):
    """Every pack under root (npm run max:render-pack -- all): stills, and the
    turntable if asked. Resumable: a car whose EXRs are all there is skipped.
    One bad car is logged and the batch goes on. Writes root/render-all.json."""
    import time
    packs = list_packs(root)
    report = []
    for i, car in enumerate(packs):
        pack = os.path.join(root, car)
        if progress:
            progress(car, i, len(packs))
        if skip_done and _done(pack, shots, turntable, frames):
            report.append({"id": car, "status": "skipped (already rendered)"})
            continue
        t0 = time.time()
        try:
            sc = open_pack(pack, light_scale)
            st, tt = sc["spec"]["stills"], sc["spec"]["turntable"]
            w, h = (st["width"] // 2, st["height"] // 2) if half else (st["width"], st["height"])
            render_stills(sc, shots, w, h, aa)
            if turntable:
                tw, th = (tt["width"] // 2, tt["height"] // 2) if half else (tt["width"], tt["height"])
                render_turntable(sc, frames, tw, th, max(1, aa - 2))
            report.append({"id": car, "status": "ok", "seconds": round(time.time() - t0, 1), "log": list(LOG)})
        except Exception as e:  # keep going: one car must not cost the night
            report.append({"id": car, "status": "FAILED: %s" % e, "log": list(LOG)})
            log("%s failed: %s" % (car, e))
        with open(os.path.join(root, "render-all.json"), "w") as f:
            json.dump(report, f, indent=2)
    return report
