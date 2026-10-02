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


def colour_space():
    """'linear' or 'srgb': how this Max reads a colour swatch value."""
    try:
        if maxio_year() >= 2024 and rt.isProperty(rt.ColorPipelineMgr, "ColorPipelineMode"):
            return "linear"
    except Exception:
        pass
    try:
        if str(rt.IDisplayGamma.colorCorrectionMode) == "gamma":
            return "srgb"
    except Exception:
        pass
    return "linear"


def maxio_year():
    return int(rt.maxVersion()[0]) // 1000 - 2 + 2000


def colour(lin, mode):
    """A swatch colour from a LINEAR value: encoded to sRGB when this Max
    reads swatches as gamma-encoded."""
    def enc(v):
        v = max(0.0, min(1.0, v))
        if mode != "srgb":
            return v
        return 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
    return rt.Color(*(enc(v) * 255.0 for v in lin))


# ---------------------------------------------------------------- materials

def bitmap(pack, rel, mapping=None, alpha=False):
    path = os.path.normpath(os.path.join(pack, rel))
    if not os.path.exists(path):
        log("missing texture %s" % path)
        return None
    b = rt.Bitmaptexture(filename=path)
    if alpha:
        set_prop(b, "monoOutput", 1)      # alpha as the mono output
        set_prop(b, "alphaSource", 0)     # the image's own alpha
    if mapping:
        c = b.coords
        set_prop(c, "U_Offset", mapping["offset"][0])
        set_prop(c, "V_Offset", mapping["offset"][1])
        set_prop(c, "U_Tiling", mapping["scale"][0])
        set_prop(c, "V_Tiling", mapping["scale"][1])
        set_prop(c, "W_Angle", math.degrees(mapping["rotation"]))
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
    if m.get("base_tex"):
        t = bitmap(pack, m["base_tex"], m.get("base_tex_map"))
        if t:
            set_prop(p, "base_color_map", t)
    if m.get("normal_tex"):
        t = bitmap(pack, m["normal_tex"])
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
        t = bitmap(pack, m["alpha_tex"], m.get("alpha_tex_map"), alpha=True)
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
            t = bitmap(pack, m["emission_tex"], m.get("emission_tex_map"))
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
    """One studio light. Blender area watts -> normalised radiance P / (pi A)."""
    area = L["size"] * L["size_y"]
    radiance = L["energy"] / (math.pi * area) * scale
    if L.get("down"):
        target = (L["loc"][0], L["loc"][1], L["loc"][2] - 1.0)
    else:
        target = L["target"]
    if arnold_available():
        a = rt.Arnold_Light()
        set_prop(a, ("lightShape", "shape"), 3)       # quad
        set_prop(a, "quadX", L["size"] * k)
        set_prop(a, "quadY", L["size_y"] * k)
        set_prop(a, "normalize", True)
        set_prop(a, "intensity", radiance)
        set_prop(a, "exposure", 0.0)
        set_prop(a, "color", colour(L["color"], mode))
        set_prop(a, "spread", min(1.0, L["spread_deg"] / 180.0))
        set_prop(a, ("camera", "cameraVisibility"), 0.0)
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
        set_prop(sky, ("lightShape", "shape"), 6)         # skydome
        set_prop(sky, "color", colour(spec["world"], mode))
        set_prop(sky, "intensity", 1.0 * light_scale)
        set_prop(sky, ("camera", "cameraVisibility"), 0.0)
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
    rt.FBXImporterSetParam("ResetImport")
    rt.FBXImporterSetParam("Mode", rt.Name("create"))
    rt.FBXImporterSetParam("ScaleConversion", True)
    rt.FBXImporterSetParam("ConvertUnit", "m")
    rt.FBXImporterSetParam("SmoothingGroups", True)
    rt.FBXImporterSetParam("Cameras", False)
    rt.FBXImporterSetParam("Lights", False)
    rt.FBXImporterSetParam("Animation", False)
    before = set(str(n.handle) for n in rt.objects)
    rt.importFile(os.path.join(pack, spec["fbx"]), rt.Name("noPrompt"), using=rt.FBXIMP)
    car = [n for n in rt.objects if str(n.handle) not in before]
    k = 1.0 / maxio.unit_to_m()

    mode = colours if colours in ("linear", "srgb") else colour_space()
    log("colour swatches read as %s" % mode)
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
    bm = rt.render(camera=cam, outputwidth=w, outputheight=h, outputfile=path, vfb=False, quiet=True)
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
