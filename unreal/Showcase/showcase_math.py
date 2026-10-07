"""The Black Demon showcase, as numbers — no `unreal` import, so it runs here.

    python3 unreal/Showcase/test_showcase_math.py

grn_showcase.py (run inside the editor) builds what this describes. The
split is deliberate: everything that can be wrong without an engine is
here, tested with plain Python against the GLB and the Blender pack; what
needs the engine is over there, thin, and checked on the Mac.

THE STUDIO IS THE BLENDER STUDIO. tools/blender/studio.py is the one
definition of the stage every renderer shoots the cars in — the five
lights, the floor, the three shot angles, the box-fitted camera — and
this imports it rather than restating it, then moves it into Unreal's
frame. So the UE5 hero is lit and framed as the Cycles hero is, and the
two can be set side by side.

FRAMES. Three of them, and the conversions are the part most worth a
test:

  glTF     metres, right-handed, +Y up. The car (three.js) faces +Z.
  Blender  metres, right-handed, +Z up; its glTF importer maps
           (x, y, z) -> (x, -z, y), so the nose is -Y and the +X flank is
           the one the hero camera sees (studio.py's own words).
  Unreal   centimetres, left-handed, +Z up, X forward. The car's nose is
           +X, so its LEFT flank — Blender's +X, the one the camera sees
           — is -Y.

  b2u: (x, y, z)_blender -> (-y, -x, z) * 100. Determinant -1, which is
  the handedness change and not a mirror: a left-flank camera stays on
  the left flank.

The importer's own axis choice is NOT assumed. After the GLB lands in
Unreal the script finds the head-lamp cores and the tail lamps by their
node names and yaws the car until they point +X. read_glb() here does
the same sum on the file, so the test can show the names resolve and
the nose really is one axis of the file.

LIGHT UNITS. A Blender area light is in watts; an Unreal rect light in
lumens. 683 lm/W is the luminous efficacy of the white both renderers
mean, and LIGHT_SCALE is the one knob to turn if the first preview is
off — the five lights keep their ratio. EV100 is then the exposure that
puts an 18% grey where Blender's view exposure put it, worked from the
key's illuminance at the car (about 3000 lux -> EV 10.2) less the
0.74 EV the Blender set is opened by (studio.GAME_EXPOSURE_EV). A
starting point, printed by `preview`, not a measurement.
"""
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(REPO, "tools", "blender"))
import studio  # noqa: E402  (tools/blender/studio.py: the one studio)

CAR_ID = "black-demon"
GLB = os.path.join(HERE, "black-demon.glb")

# Where everything the kit makes lives in the project, and nowhere else,
# so a `build` can be thrown away by deleting one folder.
CONTENT_ROOT = "/Game/GRN/Showcase"
IMPORT_PATH = CONTENT_ROOT + "/BlackDemon"          # the Interchange import
MERGED_MESH = CONTENT_ROOT + "/SM_BlackDemon"        # one static mesh, X forward
PAINT_MI = CONTENT_ROOT + "/MI_BlackDemonPaint"      # the port's Substrate paint, this car's numbers
PAINT_PARENT = "/Game/GRN/Generated/M_GRNCarPaint_v1"  # GRNPaint::MaterialPath, built by GulfRoadNightsEditor
PROBE_GLB_NAME = "AxisProbe"
STUDIO_MAP = CONTENT_ROOT + "/BlackDemonStudio"
SEQ_PATH = CONTENT_ROOT + "/Sequences"
MRQ_PATH = CONTENT_ROOT + "/MRQ"
OUT_DIR = os.path.join(REPO, "press", "unreal", CAR_ID)  # frames land here, by shot

LUMENS_PER_WATT = 683.0
LIGHT_SCALE = 1.0
EV100 = 9.3
CAMERA_ISO = 100.0
CAMERA_FSTOP = 4.0

STILL = {"width": 3840, "height": 2160, "tiles": 2}
TURNTABLE = {"width": 1920, "height": 1080, "frames": 240, "fps": 24}
PREVIEW = {"width": 960, "height": 540}

# The night Gulf Road stations: the same two places the web build's 4K
# stills stand (tools/shots/ik4k.mjs), in metres along the lap and off
# the centreline, with the camera the web's sweep shot uses.
NIGHT_SHOTS = {
    "night-city": {"station_m": 587.0, "lateral_m": 1.75, "cam_back_m": 7.4, "cam_side_m": 3.2, "cam_up_m": 1.3},
    "night-coast": {"station_m": 3304.0, "lateral_m": -1.75, "cam_back_m": 7.4, "cam_side_m": -3.2, "cam_up_m": 1.3},
}


# ---------------------------------------------------------------- frames

def g2b(p):
    """glTF (Y up) -> Blender (Z up), as Blender's glTF importer does."""
    x, y, z = p
    return (x, -z, y)


def b2u(p):
    """Blender metres -> Unreal centimetres: nose -Y -> +X, left flank +X -> -Y."""
    x, y, z = p
    return (-y * 100.0, -x * 100.0, z * 100.0)


def u2b(p):
    X, Y, Z = p
    return (-Y / 100.0, -X / 100.0, Z / 100.0)


def b2u_dir(d):
    x, y, z = d
    return (-y, -x, z)


def look_rotator(loc, aim):
    """Unreal (pitch, yaw, roll) in degrees that points +X from loc at aim,
    roll zero (local Y level), which is what Blender's to_track_quat
    ('-Z', 'Y') gives a light or a camera."""
    dx, dy, dz = aim[0] - loc[0], aim[1] - loc[1], aim[2] - loc[2]
    yaw = math.degrees(math.atan2(dy, dx))
    pitch = math.degrees(math.atan2(dz, math.hypot(dx, dy)))
    return (pitch, yaw, 0.0)


def yaw_to_plus_x(nose_xy):
    """Degrees of yaw (about +Z, Unreal's sense: positive turns +X toward
    +Y) that brings a horizontal nose vector onto +X."""
    return -math.degrees(math.atan2(nose_xy[1], nose_xy[0]))


# ------------------------------------------------------------- the GLB

def valid_glb(path):
    """Whole file: magic, and the header's length is the file's."""
    try:
        with open(path, "rb") as f:
            head = f.read(12)
        return len(head) == 12 and head[:4] == b"glTF" and \
            int.from_bytes(head[8:12], "little") == os.path.getsize(path)
    except OSError:
        return False


def _mat_mul(a, b):
    """4x4 row-major matrices as 16-lists."""
    out = [0.0] * 16
    for r in range(4):
        for c in range(4):
            out[r * 4 + c] = sum(a[r * 4 + k] * b[k * 4 + c] for k in range(4))
    return out


def _gltf_matrix(node):
    """A node's local matrix, row-major. glTF stores column-major."""
    m = node.get("matrix")
    if m:
        return [m[c * 4 + r] for r in range(4) for c in range(4)]
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def _xform(m, p):
    x, y, z = p
    return (m[0] * x + m[1] * y + m[2] * z + m[3],
            m[4] * x + m[5] * y + m[6] * z + m[7],
            m[8] * x + m[9] * y + m[10] * z + m[11])


def read_glb(path=GLB):
    """What the kit needs from the file: bounds (glTF and Blender frames),
    the paint's factors, every material name, the nose direction found
    from the lamp nodes, and which node names carry it."""
    with open(path, "rb") as f:
        b = f.read()
    if b[:4] != b"glTF":
        raise ValueError(f"{path} is not a glTF binary")
    clen = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + clen])
    nodes, meshes, accessors = j["nodes"], j["meshes"], j["accessors"]

    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    world = {}

    def world_of(i):
        if i in world:
            return world[i]
        m = _gltf_matrix(nodes[i])
        if i in parent:
            m = _mat_mul(world_of(parent[i]), m)
        world[i] = m
        return m

    def mesh_corners(i):
        n = nodes[i]
        if "mesh" not in n:
            return []
        m = world_of(i)
        pts = []
        for pr in meshes[n["mesh"]]["primitives"]:
            acc = accessors[pr["attributes"]["POSITION"]]
            mn, mx = acc["min"], acc["max"]
            for x in (mn[0], mx[0]):
                for y in (mn[1], mx[1]):
                    for z in (mn[2], mx[2]):
                        pts.append(_xform(m, (x, y, z)))
        return pts

    def subtree(i):
        out = [i]
        for c in nodes[i].get("children", []):
            out += subtree(c)
        return out

    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for i in range(len(nodes)):
        for p in mesh_corners(i):
            for k in range(3):
                lo[k] = min(lo[k], p[k])
                hi[k] = max(hi[k], p[k])

    def centre_of(indices):
        pts = [p for i in indices for p in mesh_corners(i)]
        if not pts:
            return None
        return tuple(sum(p[k] for p in pts) / len(pts) for k in range(3))

    heads = [i for i, n in enumerate(nodes) if n.get("name") == "lamp-core"]
    tails = [k for i, n in enumerate(nodes) if n.get("name") == "tail-lamps" for k in subtree(i)]
    head_c, tail_c = centre_of(heads), centre_of(tails)
    nose = None
    if head_c and tail_c:
        d = tuple(head_c[k] - tail_c[k] for k in range(3))
        ln = math.sqrt(sum(v * v for v in d))
        nose = tuple(v / ln for v in d)

    paint = next((m for m in j.get("materials", []) if m.get("name") == "paint"), None)
    pf = {}
    if paint:
        pbr = paint.get("pbrMetallicRoughness", {})
        cc = (paint.get("extensions") or {}).get("KHR_materials_clearcoat", {})
        pf = {
            "color": tuple(pbr.get("baseColorFactor", [1, 1, 1, 1])[:3]),
            "metallic": pbr.get("metallicFactor", 1.0),
            "roughness": pbr.get("roughnessFactor", 1.0),
            "clearcoat": cc.get("clearcoatFactor", 0.0),
            "clearcoat_roughness": cc.get("clearcoatRoughnessFactor", 0.0),
        }

    bmin, bmax = g2b(lo), g2b(hi)
    bounds_b = (tuple(min(a, b_) for a, b_ in zip(bmin, bmax)), tuple(max(a, b_) for a, b_ in zip(bmin, bmax)))
    return {
        "bounds_gltf": (tuple(lo), tuple(hi)),
        "bounds_blender": bounds_b,
        "nose_gltf": nose,
        "head_lamp_nodes": len(heads),
        "tail_lamp_nodes": len(tails),
        "materials": [m.get("name") for m in j.get("materials", [])],
        "paint": pf,
        "triangles": sum((accessors[pr["indices"]]["count"] // 3 if "indices" in pr
                          else accessors[pr["attributes"]["POSITION"]]["count"] // 3)
                         for me in meshes for pr in me["primitives"]),
        "extensions": j.get("extensionsUsed", []),
    }


# ------------------------------------------------------------ the studio

def light_ue(L):
    """One of studio.rig()'s lights as an Unreal rect light."""
    loc = b2u(L["loc"])
    tgt = b2u(L["target"])
    if L.get("down"):
        rot = (-90.0, 0.0, 0.0)         # straight down; local Z (SourceHeight) lands along +X, the car
    else:
        rot = look_rotator(loc, tgt)
    size_x = L["size"]
    size_y = L["size_y"] or L["size"]
    spread = L.get("spread_deg", 180)
    return {
        "name": L["name"],
        "loc": loc, "rot": rot,
        "lumens": L["energy"] * LUMENS_PER_WATT * LIGHT_SCALE,
        "color": tuple(L["color"]),
        # Blender's local X (size) is horizontal -> Unreal SourceWidth (local Y);
        # its local Y (size_y) is the vertical-plane side -> SourceHeight (local Z).
        "source_width_cm": size_x * 100.0,
        "source_height_cm": size_y * 100.0,
        # Barn doors stand in for Blender's spread: half the spread is the
        # door angle off the axis, fully open at 180.
        "barn_door_angle": 88.0 if spread >= 180 else max(10.0, min(88.0, spread / 2.0)),
        "barn_door_length_cm": 0.5 * max(size_x, size_y) * 100.0,
        "lights_floor": L.get("floor", True) is not False,
    }


def camera_ue(mn, mx, az, el, aspect, corners=None):
    loc_b, aim_b, _ = studio.fit_camera(tuple(mn), tuple(mx), az, el, aspect, corners=corners)
    loc, aim = b2u(loc_b), b2u(aim_b)
    return {
        "loc": loc, "aim": aim, "rot": look_rotator(loc, aim),
        "focal_mm": studio.LENS_MM,
        "sensor_w_mm": studio.SENSOR_MM,
        "sensor_h_mm": studio.SENSOR_MM / aspect,
    }


def shutter_for(ev100=EV100, iso=CAMERA_ISO, fstop=CAMERA_FSTOP):
    """Shutter speed (1/s) that gives ev100 at this ISO and f-stop:
    EV100 = log2(N^2 * t_inv * 100 / ISO)."""
    return (2.0 ** ev100) * iso / (100.0 * fstop * fstop)


def studio_ue(bounds_b):
    """The whole stage in Unreal numbers for a car whose Blender-frame
    bounds are bounds_b (metres)."""
    mn, mx = bounds_b
    fl = studio.floor(mn, mx)
    cams = {}
    still_aspect = STILL["width"] / STILL["height"]
    for name, (az, el) in studio.SHOTS.items():
        cams[name] = camera_ue(mn, mx, az, el, still_aspect)
    az, el = studio.SHOTS["hero"]
    cams["turntable"] = camera_ue(mn, mx, az, el, TURNTABLE["width"] / TURNTABLE["height"],
                                  corners=studio.turntable_corners(mn, mx))
    c, gz, L, H = studio.dims(mn, mx)
    return {
        "floor": {
            "loc": b2u(fl["center"]),
            "size_cm": fl["size"] * 100.0,
            "base": tuple(fl["base"]), "roughness": fl["roughness"], "specular": fl["specular"],
        },
        "world_grey": tuple(studio.WORLD_GREY),
        "dome_radius_cm": max(60.0, L * 20.0) * 100.0,
        "lights": [light_ue(L_) for L_ in studio.rig(mn, mx)],
        "cameras": cams,
        "pivot": b2u((c[0], c[1], gz)),
        "ev100": EV100,
        "shutter": shutter_for(),
    }


# --------------------------------------------------------- the axis probe

PROBE_EXTENTS = (3.0, 1.0, 2.0)   # metres along glTF X, Y, Z: three different lengths


def write_probe_glb(path):
    """A tiny glTF binary whose box runs 0..3 m in X, 0..1 in Y and 0..2
    in Z. Imported through the same pipeline as the car, its static mesh
    bounds say exactly how the importer maps glTF axes to Unreal's and
    what it scales by — read off numbers, not off a guess about the
    importer. probe_mapping() does the reading."""
    pos = [(0, 0, 0), (PROBE_EXTENTS[0], 0, 0), (0, PROBE_EXTENTS[1], 0), (0, 0, PROBE_EXTENTS[2])]
    idx = [0, 1, 2, 0, 1, 3, 0, 2, 3]
    bin_pos = b"".join(struct.pack("<3f", *p) for p in pos)
    bin_idx = b"".join(struct.pack("<H", i) for i in idx)
    bin_idx += b"\0" * ((4 - len(bin_idx) % 4) % 4)
    blob = bin_pos + bin_idx
    doc = {
        "asset": {"version": "2.0", "generator": "unreal/Showcase axis probe"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": PROBE_GLB_NAME}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3",
             "min": [0.0, 0.0, 0.0], "max": list(PROBE_EXTENTS)},
            {"bufferView": 1, "componentType": 5123, "count": len(idx), "type": "SCALAR"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(bin_pos), "target": 34962},
            {"buffer": 0, "byteOffset": len(bin_pos), "byteLength": len(idx) * 2, "target": 34963},
        ],
        "buffers": [{"byteLength": len(blob)}],
    }
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(path, "wb") as f:
        f.write(b"glTF" + struct.pack("<II", 2, total))
        f.write(struct.pack("<I", len(js)) + b"JSON" + js)
        f.write(struct.pack("<I", len(blob)) + b"BIN\0" + blob)
    return path


def probe_mapping(ue_min, ue_max):
    """From the probe's Unreal bounds (two xyz triples, cm), the importer's
    rule: for each glTF axis k, (unreal axis index, sign), and the scale
    in cm per metre. Chooses the axis permutation whose length ratios
    agree best, so a stray millimetre cannot mis-assign an axis."""
    ext = [ue_max[a] - ue_min[a] for a in range(3)]
    best = None
    for perm in ((0, 1, 2), (0, 2, 1), (1, 0, 2), (1, 2, 0), (2, 0, 1), (2, 1, 0)):
        ratios = [ext[perm[k]] / PROBE_EXTENTS[k] for k in range(3)]
        mean = sum(ratios) / 3
        spread = max(abs(r - mean) for r in ratios) / max(mean, 1e-9)
        if best is None or spread < best[0]:
            best = (spread, perm, mean)
    spread, perm, scale = best
    if spread > 0.05:
        raise ValueError(f"the probe's bounds {ue_min} {ue_max} do not look like a {PROBE_EXTENTS} m box")
    mapping = {}
    for k in range(3):
        a = perm[k]
        # the probe's coordinates are all >= 0, so the far extent tells the sign
        sign = 1 if abs(ue_max[a]) >= abs(ue_min[a]) else -1
        mapping[k] = (a, sign)
    return mapping, scale


def map_dir(mapping, d):
    """A glTF-space direction through the importer's rule."""
    out = [0.0, 0.0, 0.0]
    for k in range(3):
        a, sign = mapping[k]
        out[a] += sign * d[k]
    return tuple(out)


def turntable_yaw(frame, frames=TURNTABLE["frames"]):
    """Degrees of car yaw at a turntable frame: one full turn, linear."""
    return 360.0 * frame / frames
