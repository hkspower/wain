#!/usr/bin/env python3
"""npm run test:showcase — the showcase's numbers, without an engine.

Holds: the frame conversions (b2u is a proper handedness change, g2b is
Blender's import, look_rotator points where it should), the GLB reader
on the kit's own black-demon.glb (whole file, a `paint` material with the
web's factors, head and tail lamp nodes found, the nose on one axis), and
that the studio it builds is the Blender pack's studio: same bounds as
press/max/render/black-demon/studio.json, same light positions after
the frame change, cameras that see the left flank from the front quarter.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import showcase_math as sm  # noqa: E402

fail = []


def check(cond, msg):
    if not cond:
        fail.append(msg)
    return cond


def close(a, b, tol=1e-6):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


# --- frames ---------------------------------------------------------------
check(close(sm.b2u((1.0, 2.0, 3.0)), (-200.0, -100.0, 300.0)), "b2u: nose -Y must land on +X, +X flank on -Y")
check(close(sm.u2b(sm.b2u((0.3, -1.2, 0.7))), (0.3, -1.2, 0.7)), "u2b does not invert b2u")
# determinant -1: the handedness change, not a mirror of the car
ex, ey, ez = sm.b2u_dir((1, 0, 0)), sm.b2u_dir((0, 1, 0)), sm.b2u_dir((0, 0, 1))
det = (ex[0] * (ey[1] * ez[2] - ey[2] * ez[1]) - ex[1] * (ey[0] * ez[2] - ey[2] * ez[0]) + ex[2] * (ey[0] * ez[1] - ey[1] * ez[0]))
check(abs(det + 1.0) < 1e-9, f"b2u's determinant is {det}, expected -1 (right- to left-handed)")
check(close(sm.g2b((1.0, 2.0, 3.0)), (1.0, -3.0, 2.0)), "g2b is not Blender's glTF import (x, -z, y)")
# the nose: glTF +Z is Blender -Y is Unreal +X
check(close(sm.b2u_dir(sm.g2b((0, 0, 1))), (1, 0, 0)), "a glTF +Z nose does not come out +X in Unreal")

p, y, r = sm.look_rotator((0, 0, 0), (10, 0, 0))
check(abs(p) < 1e-9 and abs(y) < 1e-9, "look_rotator along +X is not (0, 0)")
p, y, r = sm.look_rotator((0, 0, 0), (0, 10, 0))
check(abs(y - 90) < 1e-9, "look_rotator toward +Y is not yaw 90")
p, y, r = sm.look_rotator((0, 0, 100), (100, 0, 0))
check(abs(p + 45) < 1e-9, "a camera above the car looking down must have negative pitch")
check(abs(sm.yaw_to_plus_x((0, 1)) + 90) < 1e-9, "a nose along +Y needs yaw -90 to face +X")
check(abs(sm.yaw_to_plus_x((-1, 0))) == 180.0, "a nose along -X needs 180")
print("frames      ok" if not fail else "frames      FAIL")

# --- the GLBs: every exported car -------------------------------------------
n0 = len(fail)
cat = {c["id"]: c for c in sm.catalogue()}
check(len(cat) == 17, f"the catalogue has {len(cat)} cars, expected 17")
seen = 0
for cid in sm.car_ids():
    path = sm.glb_path(cid)
    if not path:
        if cid == sm.DEFAULT_CAR:
            fail.append(f"{sm.KIT_GLB} is missing — copy press/renders/glb/black-demon.glb there")
        continue          # the other cars' GLBs are git-ignored; present only where export-cars.mjs has run
    seen += 1
    check(sm.valid_glb(path), f"{cid}: not a whole glTF binary")
    g = sm.read_glb(path)
    pf = g["paint"]
    check("paint" in g["materials"], f"{cid}: no material named paint")
    check(bool(pf) and 0.0 <= pf["metallic"] <= 1.0 and 0.0 < pf["roughness"] <= 1.0, f"{cid}: paint factors {pf}")
    # gloss 0.045, satin 0.10, matte up to 0.42 (efreet-rx, efreet-rx-kai, hawally-2t, wain-special are matte)
    check(bool(pf) and 0.0 <= pf["clearcoat_roughness"] <= 0.6, f"{cid}: clear coat roughness {pf.get('clearcoat_roughness')}")
    check(g["head_lamp_nodes"] >= 2, f"{cid}: {g['head_lamp_nodes']} head-lamp cores, need 2 or more")
    check(g["tail_lamp_nodes"] >= 1, f"{cid}: no tail-lamp nodes")
    nz = g["nose_gltf"]
    check(nz is not None and nz[2] > 0.95, f"{cid}: the nose is not along +Z in the file: {nz}")
    mn, mx = g["bounds_blender"]
    L = mx[1] - mn[1]
    card = cat[cid].get("lengthM")
    check(card is None or abs(L - card) < 0.35, f"{cid}: {L:.2f} m long, the card says {card}")
    check(mx[2] - mn[2] < 1.9 and mn[2] > -0.1, f"{cid}: floor at z {mn[2]:.3f}, roof at {mx[2]:.3f}")
    check(g["triangles"] > 150000, f"{cid}: only {g['triangles']} triangles - not the full-detail export")
    # the studio and every camera must be buildable and sane for THIS car
    st = sm.studio_ue(g["bounds_blender"])
    check(len(st["lights"]) == 5 and len(st["cameras"]) == 4, f"{cid}: studio has {len(st['lights'])} lights, {len(st['cameras'])} cameras")
    hc = st["cameras"]["hero"]
    check(hc["loc"][0] > 0 and hc["loc"][1] < 0, f"{cid}: hero camera {hc['loc']} is not on the front-left quarter")
    check(all(abs(v) < 5e4 for v in hc["loc"]), f"{cid}: hero camera {hc['loc']} is absurdly far")
    p_ = sm.paths(cid)
    check("-" not in p_.folder and p_.mesh.startswith(sm.CONTENT_ROOT), f"{cid}: asset paths {p_.folder}")
check(seen >= 1, "no GLB read at all")
if seen:
    bd = sm.read_glb(sm.glb_path(sm.DEFAULT_CAR))
    mn, mx = bd["bounds_blender"]
    pack = os.path.join(sm.REPO, "press", "max", "render", "black-demon", "studio.json")
    if os.path.exists(pack):
        pj = json.load(open(pack))
        check(close(mn, pj["bounds"]["min"], 1e-3) and close(mx, pj["bounds"]["max"], 1e-3),
              f"GLB bounds {mn} {mx} differ from the Max pack's {pj['bounds']}")
slugs = [sm.paths(c).slug for c in sm.car_ids()]
check(len(set(slugs)) == len(slugs), "two cars share a slug, so would share an Unreal folder")
try:
    sm.resolve_cars("black-demon,not-a-car")
    fail.append("resolve_cars accepted an unknown id")
except ValueError:
    pass
check(sm.resolve_cars("all") == sm.car_ids() and sm.resolve_cars("falcon-720") == ["falcon-720"], "resolve_cars")
print(f"glbs        {seen} of {len(cat)} cars read here  " + ("ok" if len(fail) == n0 else "FAIL"))

# --- the studio -----------------------------------------------------------
n0 = len(fail)
pack = os.path.join(sm.REPO, "press", "max", "render", "black-demon", "studio.json")
pj = json.load(open(pack))
bounds = (tuple(pj["bounds"]["min"]), tuple(pj["bounds"]["max"]))
st = sm.studio_ue(bounds)
check(len(st["lights"]) == 5, f"{len(st['lights'])} lights, the studio has 5")
by = {L["name"]: L for L in st["lights"]}
for PL in pj["lights"]:
    U = by.get(PL["name"])
    if not check(U is not None, f"light {PL['name']} missing"):
        continue
    check(close(U["loc"], sm.b2u(PL["loc"]), 1e-6), f"{PL['name']} is not where the pack puts it")
    check(abs(U["lumens"] - PL["energy"] * 683.0) < 1e-6, f"{PL['name']} lumens are not watts x 683")
check(by["Rim"]["lights_floor"] is False, "the Rim must stay off the floor (studio.rig: floor False)")
check(by["Key"]["lights_floor"] is True, "the Key lights the floor")
check(by["Strip"]["rot"] == (-90.0, 0.0, 0.0), "the Strip hangs level pointing straight down")
check(by["Strip"]["source_height_cm"] > by["Strip"]["source_width_cm"] * 5, "the Strip's long side must be SourceHeight (along the car)")
# the key stands high and ahead of the nose on the car's left: +X, -Y, well up
k = by["Key"]["loc"]
check(k[0] > 0 and k[1] < 0 and k[2] > 300, f"the Key is at {k}: expected ahead (+X), left (-Y), high")
# cameras: the hero sees the nose and the left flank from a little above the beltline
h = st["cameras"]["hero"]
check(h["loc"][0] > 0 and h["loc"][1] < 0, f"the hero camera at {h['loc']} is not on the front-left quarter")
check(-20 < h["rot"][0] < 0, f"the hero camera pitch {h['rot'][0]:.1f} should look slightly down")
check(abs(h["sensor_w_mm"] - 36) < 1e-9 and abs(h["sensor_h_mm"] - 20.25) < 1e-9, "a 36 mm filmback at 16:9 is 36 x 20.25")
s = st["cameras"]["side"]
check(abs(s["loc"][0] - st["pivot"][0]) < 50 and s["loc"][1] < -500, f"the side camera at {s['loc']} should sit square on the left flank")
t = st["cameras"]["turntable"]
dh = math.hypot(h["loc"][0] - h["aim"][0], h["loc"][1] - h["aim"][1])
dt = math.hypot(t["loc"][0] - t["aim"][0], t["loc"][1] - t["aim"][1])
check(dt > dh, "the turntable camera must stand further back than the hero's to keep the swept box in frame")
# exposure arithmetic: EV100 9.3 at ISO 100 f/4 is a 1/39 s shutter
check(abs(sm.shutter_for(9.3, 100, 4.0) - 2 ** 9.3 / 16) < 1e-9, "shutter_for is not EV100 arithmetic")
check(abs(sm.turntable_yaw(240) - 360) < 1e-9 and sm.turntable_yaw(0) == 0, "the turntable is one full turn")
print("studio      " + ("ok" if len(fail) == n0 else "FAIL"))

# --- the axis probe --------------------------------------------------------
n0 = len(fail)
import tempfile
with tempfile.TemporaryDirectory() as td:
    pp = sm.write_probe_glb(os.path.join(td, "probe.glb"))
    check(sm.valid_glb(pp), "the probe GLB's header does not match its length")
    gp = sm.read_glb(pp)
    check(close(gp["bounds_gltf"][0], (0, 0, 0)) and close(gp["bounds_gltf"][1], sm.PROBE_EXTENTS),
          f"the probe's bounds read back as {gp['bounds_gltf']}")
    check(gp["triangles"] == 3 and gp["nose_gltf"] is None, "the probe is three triangles and no lamps")
# the rule UE's own glTF path is believed to use: swap Y and Z, x100 — and a yaw of -90 then faces the car +X
m, scale = sm.probe_mapping((0, 0, 0), (300, 200, 100))
check(m == {0: (0, 1), 1: (2, 1), 2: (1, 1)} and abs(scale - 100) < 1e-9, f"probe_mapping misread a Y/Z swap: {m} {scale}")
check(close(sm.map_dir(m, (0, 0, 1)), (0, 1, 0)), "a +Z nose through a Y/Z swap should come out +Y")
check(abs(sm.yaw_to_plus_x(sm.map_dir(m, (0, 0, 1))[:2]) + 90) < 1e-9, "that nose needs yaw -90")
# a mirrored importer: the sign is read off the far extent
m2, _ = sm.probe_mapping((-300, 0, -200), (0, 100, 0))
check(m2 == {0: (0, -1), 1: (1, 1), 2: (2, -1)}, f"probe_mapping misread negative axes: {m2}")
try:
    sm.probe_mapping((0, 0, 0), (100, 100, 100))
    fail.append("probe_mapping accepted a cube that cannot be the probe")
except ValueError:
    pass
print("probe       " + ("ok" if len(fail) == n0 else "FAIL"))

if fail:
    print("\nFAIL\n  " + "\n  ".join(fail))
    sys.exit(1)
print("\nok")
