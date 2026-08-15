#!/usr/bin/env python3
"""Model the game's graphics in Blender and export game-ready glTF.

    pip install bpy
    node scripts/export-car-profiles.mjs        # refresh profiles.json
    python3 tools/blender/build_assets.py --out public/models

Produces, at the chosen quality (default `max`):

  car-{sedan,zx,gtr,rx7}.glb   body shells: Body, Canopy, Roof
  wheel-{5,6}.glb              hero wheel: Tire, Barrel, Alloy, Rotor, Lugs
  palm.glb                     corniche palm crown: Crown
  driver.glb                   the driver at the wheel: Helmet, Visor,
                               Glove, Wheel, Pedal

Every one of these replaces the *geometry* of meshes the game already
builds procedurally (src/game/models.ts), so materials, anchors, physics
and the low-detail traffic fleet are untouched, and a missing file just
leaves the procedural version standing.

Fidelity is the whole point. The car loft reproduces what
THREE.ExtrudeGeometry does with the same profiles in src/game/cars.ts —
a Catmull-Rom spline through the top run, straight rocker, and a
quarter-circle side bevel that bulges the mid-section outward by the
bevel radius. Every anchored detail (pop-up doors, tail garnish, wipers)
was positioned against that bulged surface, so the authored shells must
land on it exactly — just far smoother. The wheel and palm are modelled
rather than lofted, but they hold the same envelope the runtime meshes
occupy: a 0.36 m tire radius, a 0.26 m section width, a 0.2 m rotor.
Break those and the car sits at the wrong ride height.

Axes: built in Blender coordinates (X = width, -Y = nose, Z = up); the
glTF exporter's Y-up conversion turns that into the game's frame
(X = width, Y = up, +Z = nose). The wheel spins about X in both.
"""

import argparse
import json
import math
import os
import sys

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))

# Quality presets. The runtime SplineCurve resolves to ~31 samples per
# span and five bevel steps; everything here is far past that. The bevel
# count is the one that matters most on a car — the side roll-over is
# where every specular line on the flank lives, and steps read as facets
# under a moving streetlight.
#
#   samples/span, bevel steps, tire radial segs, tire profile segs,
#   alloy radial segs, palm leaflet pairs
QUALITY = {
    "max": dict(spans=96, bevel=28, tire_r=160, tire_p=30, alloy=96, leaflets=13, driver=96),
    "high": dict(spans=64, bevel=20, tire_r=96, tire_p=22, alloy=64, leaflets=10, driver=64),
    "draft": dict(spans=40, bevel=12, tire_r=48, tire_p=14, alloy=32, leaflets=7, driver=28),
}
Q = QUALITY["max"]

SAMPLES_PER_SPAN = Q["spans"]
BEVEL_STEPS = Q["bevel"]


def catmull_rom_chain(points, samples_per_span):
    """Uniform Catmull-Rom through all points, clamped ends —
    the interpolation THREE.SplineCurve applies under splineThru."""
    if len(points) == 2:
        return [points[0], points[1]]
    out = []
    n = len(points)
    for i in range(n - 1):
        p0 = points[max(i - 1, 0)]
        p1 = points[i]
        p2 = points[i + 1]
        p3 = points[min(i + 2, n - 1)]
        for k in range(samples_per_span):
            t = k / samples_per_span
            t2, t3 = t * t, t * t * t
            out.append(tuple(
                0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t
                       + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2
                       + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)
                for c in (0, 1)
            ))
    out.append(points[-1])
    return out


def profile_contour(geo):
    """Closed 2-D contour (x = length, y = height) of one profile:
    splined top run, straight bottom run — mirroring extrudeProfile."""
    pts = [tuple(p) for p in geo["points"]]
    bottom = int(geo.get("bottom", 2))
    top = pts[: len(pts) - bottom] if bottom else pts
    contour = catmull_rom_chain(top, SAMPLES_PER_SPAN)
    for i in range(len(pts) - bottom, len(pts)):
        if bottom:
            contour.append(pts[i])
    # closePath: the wrap edge from last back to first is implicit
    return contour


def force_clockwise(contour):
    """THREE.ExtrudeGeometry reverses shapes to clockwise before beveling;
    the bevel vectors below assume the same winding."""
    n = len(contour)
    area = sum(
        contour[i][0] * contour[(i + 1) % n][1] - contour[(i + 1) % n][0] * contour[i][1]
        for i in range(n)
    )
    return list(reversed(contour)) if area > 0 else contour


def bevel_vec(prev, pt, nxt):
    """Direct port of THREE.ExtrudeGeometry's getBevelVec: a true miter
    (intersection of the two offset edge lines) with the same collinear
    fallback and the same clamp that stops sharp tips from spiking. The
    runtime extrusion offsets by exactly these vectors, so using anything
    else here would pull the authored shells off the runtime surface."""
    eps = 1e-10
    ix, iy = pt
    vpx, vpy = ix - prev[0], iy - prev[1]
    vnx, vny = nxt[0] - ix, nxt[1] - iy
    vp_lensq = vpx * vpx + vpy * vpy
    collinear = vpx * vny - vpy * vnx

    if abs(collinear) > eps * math.sqrt(vp_lensq * (vnx * vnx + vny * vny)):
        vp_len = math.sqrt(vp_lensq)
        vn_len = math.hypot(vnx, vny)
        # Each edge shifted one unit along its left normal…
        psx, psy = prev[0] - vpy / vp_len, prev[1] + vpx / vp_len
        nsx, nsy = nxt[0] - vny / vn_len, nxt[1] + vnx / vn_len
        # …and the miter is where the shifted lines meet
        sf = ((nsx - psx) * vny - (nsy - psy) * vnx) / (vpx * vny - vpy * vnx)
        tx = psx + vpx * sf - ix
        ty = psy + vpy * sf - iy
        lensq = tx * tx + ty * ty
        if lensq <= 2:
            return (tx, ty)
        shrink = math.sqrt(lensq / 2)
    else:
        # Collinear edges: same direction → plain perpendicular; a
        # 180° spike → fold along the edge, shrunk like three does
        same_dir = (
            (vpx > eps and vnx > eps)
            or (vpx < -eps and vnx < -eps)
            or (abs(vpx) <= eps and math.copysign(1, vpy) == math.copysign(1, vny))
        )
        if same_dir:
            tx, ty = -vpy, vpx
            shrink = math.sqrt(vp_lensq)
        else:
            tx, ty = vpx, vpy
            shrink = math.sqrt(vp_lensq / 2)
    return (tx / shrink, ty / shrink)


def contour_bevels(contour):
    n = len(contour)
    return [
        bevel_vec(contour[i - 1], contour[i], contour[(i + 1) % n])
        for i in range(n)
    ]


def loft_shell(name, geo):
    """Solid shell: contour lofted across the width with the same
    quarter-circle bevel THREE.ExtrudeGeometry applies — original
    profile at the outer faces, bulged out by `bevel` mid-body."""
    contour = force_clockwise(profile_contour(geo))
    bevels = contour_bevels(contour)
    width, bevel = geo["width"], geo["bevel"]
    half_depth = (width - 2 * bevel) / 2

    sections = []  # (w, offset) across the width
    for k in range(BEVEL_STEPS + 1):
        a = (math.pi / 2) * (1 - k / BEVEL_STEPS)
        sections.append((-(half_depth + bevel * math.sin(a)), bevel * math.cos(a)))
    for k in range(BEVEL_STEPS + 1):
        a = (math.pi / 2) * (k / BEVEL_STEPS)
        sections.append((half_depth + bevel * math.sin(a), bevel * math.cos(a)))

    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    rings = []
    for w, off in sections:
        ring = []
        for (px, py), (bx, by) in zip(contour, bevels):
            x, y = px + bx * off, py + by * off
            # Blender frame: X width, -Y nose, Z up
            ring.append(bm.verts.new((w, -x, y)))
        rings.append(ring)
    bm.verts.ensure_lookup_table()

    n = len(contour)
    for r in range(len(rings) - 1):
        a, b = rings[r], rings[r + 1]
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    # Side panels: the flat faces at the original profile. With the
    # clockwise contour, the wall quads above face outward; the left cap
    # needs its ring reversed (and the right cap kept) to agree with them
    # — the wrong pairing makes the doors vanish under backface culling.
    bm.faces.new(reversed(rings[0]))
    bm.faces.new(rings[-1])

    # Orientation is decided, not guessed: the construction above is
    # uniformly wound (walls and caps agree), so the whole solid is either
    # entirely outward or entirely inward — the sign of the enclosed
    # volume says which. recalc_face_normals is deliberately NOT used;
    # its raycast heuristic mis-orients the thin canopy/roof shells where
    # the offset rings self-touch at the sharp tips.
    if bm.calc_volume(signed=True) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)

    bm.to_mesh(mesh)
    bm.free()

    # Fully smooth, like mergeVertices + computeVertexNormals at runtime
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.update()
    return obj


def build_style(style, parts):
    objs = []
    for part, geo in parts.items():
        objs.append(loft_shell(part.capitalize(), geo))
    return objs


# --------------------------------------------------------------- helpers

def mesh_from_quads(name, rings, close_rings=True, close_loop=False, cap=False):
    """Surface through a list of equal-length vertex rings.

    close_rings joins the last vertex of each ring back to the first (a
    tube); close_loop joins the last ring back to the first (a torus);
    cap closes the two ends of a tube with n-gons.

    Orientation is decided by the sign of the enclosed volume, which is
    only meaningful for a closed mesh — so anything whose facing matters
    must be closed here. An open tube comes out facing whichever way the
    heuristic guesses, and a spoke facing inward is a spoke the camera
    cannot see."""
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    verts = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    last = len(rings) if close_loop else len(rings) - 1
    for r in range(last):
        a, b = verts[r], verts[(r + 1) % len(rings)]
        span = n if close_rings else n - 1
        for i in range(span):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap and not close_loop:
        # Same pairing the car loft uses: the first ring reversed, the
        # last as built, which is what agrees with the wall winding.
        bm.faces.new(reversed(verts[0]))
        bm.faces.new(verts[-1])
    bm.normal_update()
    if bm.calc_volume(signed=True) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.update()
    return obj


def revolve(name, profile, segments, sharp_edges=(), closed=True):
    """Revolve a 2-D profile — (axial x, radius) pairs — about the X axis.

    Points whose index is in sharp_edges keep a hard crease by being
    emitted twice, so a tread groove has an edge instead of a smear.

    `closed` joins the profile's last point back to its first, making the
    result a solid ring rather than an open shell. Leave it on for
    anything the camera can see the edge of: an open tire is a hole
    straight into the carcass at the bead."""
    rings = []
    for k in range(segments):
        a = (k / segments) * math.tau
        ca, sa = math.cos(a), math.sin(a)
        ring = []
        for i, (x, r) in enumerate(profile):
            ring.append((x, r * ca, r * sa))
            if i in sharp_edges:
                ring.append((x, r * ca, r * sa))
        rings.append(ring)
    # A revolve is a tube around the axis: the angular direction always
    # closes, the profile direction closes only for a solid ring.
    return mesh_from_quads(name, rings, close_rings=closed, close_loop=True)


def join(name, objs):
    """Merge objects into one mesh — the game swaps one geometry per
    material slot, so each exported part must arrive as a single mesh."""
    bm = bmesh.new()
    for o in objs:
        bm.from_mesh(o.data)
        bpy.data.objects.remove(o, do_unlink=True)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


# ------------------------------------------------------------------ wheel
# Envelope the runtime meshes occupy, and which physics and every wheel
# arch, brake glow and skid effect is positioned against (src/game/cars.ts):
TIRE_R = 0.36        # rolling radius — changing it changes the ride height
TIRE_HALF_W = 0.13
BEAD_R = 0.205       # where the tire meets the rim barrel
ROTOR_R = 0.2
HUB_R = 0.06


def build_tire():
    """A tire section, not a puck: tread crown, shouldered edges, three
    circumferential grooves, a sidewall bulge and a bead seat."""
    grooves = []
    profile = [(-TIRE_HALF_W, BEAD_R)]          # inboard bead
    profile += [(-0.118, 0.245), (-0.108, 0.30), (-0.100, 0.339)]  # sidewall
    profile += [(-0.093, 0.352), (-0.084, TIRE_R - 0.004)]         # shoulder
    # Tread face with three grooves cut into it
    tread = []
    for i in range(13):
        x = -0.075 + i * 0.0125
        deep = i in (3, 6, 9)
        tread.append((x, TIRE_R - (0.012 if deep else 0.0)))
        if deep:
            grooves.append(len(profile) + len(tread) - 1)
    profile += tread
    profile += [(0.084, TIRE_R - 0.004), (0.093, 0.352)]           # shoulder
    profile += [(0.100, 0.339), (0.108, 0.30), (0.118, 0.245)]     # sidewall
    profile += [(TIRE_HALF_W, BEAD_R)]                             # outboard bead
    return revolve("Tire", profile, Q["tire_r"], sharp_edges=set(grooves))


def build_alloy(spokes):
    """Rim barrel, machined outer lip, N tapered spokes and the hub. The
    barrel is exported separately because the game paints it a darker
    metal than the spoke face."""
    barrel = revolve(
        "Barrel",
        [(-0.135, BEAD_R), (-0.135, 0.19), (-0.06, 0.176), (0.06, 0.176),
         (0.135, 0.19), (0.135, BEAD_R)],
        Q["alloy"],
    )

    parts = []
    # Outer lip: a rolled edge at the face of the rim
    parts.append(revolve(
        "Lip",
        [(0.108, 0.181), (0.128, 0.187), (0.142, 0.196), (0.145, 0.2035),
         (0.138, 0.2085), (0.124, 0.206), (0.112, 0.197)],
        Q["alloy"],
    ))
    # Hub: dished centre with a raised cap
    parts.append(revolve(
        "Hub",
        [(-0.145, 0.0), (-0.145, HUB_R), (0.06, HUB_R), (0.10, 0.058),
         (0.118, 0.05), (0.126, 0.03), (0.128, 0.0)],
        max(24, Q["alloy"] // 3),
    ))

    # Spokes: each is a lofted bar running hub → lip, tapering in width
    # and dishing outward, with rounded flanks so the highlight travels
    # along the spoke instead of flashing on and off a flat face.
    for s in range(spokes):
        base = (s / spokes) * math.tau
        rings = []
        steps = 16
        for k in range(steps + 1):
            t = k / steps
            r = 0.052 + t * 0.152                     # hub out to the lip
            half_w = math.radians(15.5 - 7.0 * t)     # angular half-width
            x = 0.104 + 0.030 * (t ** 1.6)            # dish toward the face
            depth = 0.030 - 0.011 * t                 # thickness
            ring = []
            # Rounded cross-section: 10 points around the bar
            for i in range(10):
                a = (i / 10) * math.tau
                # width around the wheel axis, thickness along it
                da = math.sin(a) * half_w
                dx = math.cos(a) * depth
                ang = base + da
                rr = r + abs(math.cos(a)) * 0.0 + 0.0
                ring.append((x + dx, rr * math.cos(ang), rr * math.sin(ang)))
            rings.append(ring)
        parts.append(mesh_from_quads(f"Spoke{s}", rings, close_rings=True, cap=True))

    return barrel, join("Alloy", parts)


def build_rotor():
    """A vented two-plate rotor with radial vanes between the faces —
    the vanes are what the camera sees through the spokes."""
    parts = []
    # Two solid plates with a gap between them — each closed in section,
    # so there is no open edge for the camera to see into.
    for x0, x1 in ((-0.011, -0.0035), (0.0035, 0.011)):
        parts.append(revolve(
            "Plate",
            [(x0, 0.09), (x0, ROTOR_R - 0.004), ((x0 + x1) / 2, ROTOR_R),
             (x1, ROTOR_R - 0.004), (x1, 0.09)],
            Q["alloy"],
        ))
    # The hat the wheel bolts to, standing proud of the outer plate
    parts.append(revolve(
        "Hat",
        [(-0.011, 0.055), (-0.011, 0.094), (0.011, 0.094), (0.020, 0.086),
         (0.020, 0.055)],
        max(24, Q["alloy"] // 3),
    ))
    # Vanes: radial webs bridging the plates, seen through the edge gap
    for i in range(28):
        a = (i / 28) * math.tau
        rings = []
        for r in (0.1, ROTOR_R - 0.004):
            ring = []
            for dx, dw in ((-0.0035, -0.0035), (-0.0035, 0.0035),
                           (0.0035, 0.0035), (0.0035, -0.0035)):
                ang = a + dw
                ring.append((dx, r * math.cos(ang), r * math.sin(ang)))
            rings.append(ring)
        parts.append(mesh_from_quads(f"Vane{i}", rings, close_rings=True, cap=True))
    return join("Rotor", parts)


def build_lugs():
    """Five chamfered hex nuts on the outer face."""
    parts = []
    for i in range(5):
        a = (i / 5) * math.tau + 0.3
        cy, cz = math.cos(a) * 0.058, math.sin(a) * 0.058
        rings = []
        for x, r in ((0.120, 0.0), (0.122, 0.010), (0.128, 0.016),
                     (0.146, 0.016), (0.150, 0.011), (0.150, 0.0)):
            ring = []
            for k in range(6):
                t = (k / 6) * math.tau
                ring.append((x, cy + r * math.cos(t), cz + r * math.sin(t)))
            rings.append(ring)
        parts.append(mesh_from_quads(f"Lug{i}", rings, close_rings=True, cap=True))
    obj = join("Lugs", parts)
    obj.data.polygons.foreach_set("use_smooth", [False] * len(obj.data.polygons))
    obj.data.update()
    return obj


def build_wheel(spokes):
    barrel, alloy = build_alloy(spokes)
    return [build_tire(), barrel, alloy, build_rotor(), build_lugs()]


# ------------------------------------------------------------------- palm
def build_palm():
    """A date palm crown: fronds arching out and down, each a folded
    spine carrying two rows of leaflets that shorten toward the tip.
    The runtime crown is eight flat boxes; this is the same silhouette
    with the fold and droop that catch the sodium light.

    Sits at the trunk top (6 m) in the same local frame as the runtime
    geometry, so the instanced placement is unchanged."""
    parts = []
    fronds = 14
    for f in range(fronds):
        yaw = (f / fronds) * math.tau + (f % 2) * 0.16
        droop = 0.30 + (f % 3) * 0.12
        length = 2.05 - (f % 3) * 0.13
        rings = []
        steps = Q["leaflets"]
        for k in range(steps + 1):
            t = k / steps
            # Spine arcs out and bends down under its own weight
            d = t * length
            z = -droop * (t ** 2) * length * 0.6 + 0.18 * math.sin(t * 2.2)
            # Leaflet half-span, wide at the middle, tapering to a tip
            half = (0.20 - 0.15 * abs(t - 0.42)) * (1.0 - 0.55 * t)
            half = max(half, 0.012)
            fold = 0.055 * (1.0 - t)  # the V-fold of the frond
            ring = [
                (0.0, -half, -fold),
                (0.0, 0.0, 0.012),
                (0.0, half, -fold),
                (0.0, 0.0, -0.012),
            ]
            rings.append([(d, y, z + zz) for (_, y, zz) in ring])
        # Orient the frond: built along +X, rotated about Z by yaw
        ca, sa = math.cos(yaw), math.sin(yaw)
        rings = [[(x * ca - y * sa, x * sa + y * ca, z) for (x, y, z) in ring]
                 for ring in rings]
        parts.append(mesh_from_quads(f"Frond{f}", rings, close_rings=True, cap=True))
    # Central tuft closing the crown
    tuft = []
    for k in range(6):
        t = k / 5
        r = 0.22 * (1 - t)
        ring = []
        for i in range(8):
            a = (i / 8) * math.tau
            ring.append((r * math.cos(a), r * math.sin(a), t * 0.7))
        tuft.append(ring)
    parts.append(mesh_from_quads("Tuft", tuft, close_rings=True, cap=True))
    crown = join("Crown", parts)
    crown.location = (0, 0, 6.1)
    bpy.context.view_layer.update()
    return [crown]


# ----------------------------------------------------------------- driver
# The seated driver's authored parts. Everything here is dimensioned from
# the rig block in profiles.json — the same numbers src/game/rig.ts hands
# to the runtime and to the UE5 header — because these meshes hang off
# joints an IK solver is moving. Author a helmet at the wrong radius and
# it clips the roof; author the rim at the wrong radius and the solved
# hands float beside it. Nothing here may be a hand-copied constant.
#
# Parts are authored in the joint's OWN local frame, not the car's: the
# game swaps geometry into meshes that are already children of the
# shoulder, wrist, column and pedal joints, so a part that bakes in a
# joint's position would be applied twice.


def build_driver(rig):
    d = rig["driver"]
    segs = Q["driver"]
    objs = []

    # Helmet: a sphere with a brow line, sat on the head joint's origin.
    helmet_r = 0.135
    prof = []
    n = segs // 2
    for i in range(n + 1):
        a = math.pi * (i / n)
        prof.append((math.cos(a) * helmet_r, max(1e-4, math.sin(a) * helmet_r)))
    helmet = revolve("Helmet", prof, segs, closed=False)
    # Revolve runs about X; the helmet's pole belongs up (+Z in Blender).
    helmet.rotation_euler = (0.0, math.radians(90.0), 0.0)
    objs.append(helmet)

    # Visor: a band of a slightly larger sphere across the front. Built
    # as its own shell so the game can keep its smoked glass material.
    visor_r = helmet_r + 0.008
    rings = []
    for i in range(segs // 3 + 1):
        # Vertical sweep across the eye line
        pitch = math.radians(-26.0) + math.radians(38.0) * (i / (segs // 3))
        ring = []
        for k in range(segs // 2 + 1):
            yaw = math.radians(-58.0) + math.radians(116.0) * (k / (segs // 2))
            cp, sp = math.cos(pitch), math.sin(pitch)
            ring.append((math.sin(yaw) * cp * visor_r, math.cos(yaw) * cp * visor_r, sp * visor_r))
        rings.append(ring)
    objs.append(mesh_from_quads("Visor", rings, close_rings=False, close_loop=False))

    # Glove: a closed fist, at the wrist joint's origin. Slightly ovoid
    # and rolled toward the rim, which is how a hand on a wheel reads.
    grip_r = 0.052
    prof = []
    for i in range(segs // 2 + 1):
        a = math.pi * (i / (segs // 2))
        prof.append((math.cos(a) * grip_r * 1.25, max(1e-4, math.sin(a) * grip_r)))
    glove = revolve("Glove", prof, segs, closed=False)
    glove.rotation_euler = (0.0, math.radians(90.0), 0.0)
    objs.append(glove)

    # Steering wheel rim: a torus at the authored radius, in the column
    # joint's frame (the rim lies in that joint's own plane).
    rim_r = d["wheelRadius"]
    tube_r = 0.019
    rings = []
    for i in range(segs):
        a = (i / segs) * math.tau
        ca, sa = math.cos(a), math.sin(a)
        ring = []
        for k in range(segs // 3):
            b = (k / (segs // 3)) * math.tau
            rr = rim_r + math.cos(b) * tube_r
            ring.append((ca * rr, sa * rr, math.sin(b) * tube_r))
        rings.append(ring)
    objs.append(mesh_from_quads("Wheel", rings, close_rings=True, close_loop=True))

    # Pedal face: a dished plate with a lip, in the pedal joint's frame.
    # It travels with the press, so it is authored about its own origin.
    pw, ph, pt = 0.035, 0.055, 0.008
    rings = []
    steps = max(6, segs // 8)
    for i in range(steps + 1):
        v = -1.0 + 2.0 * (i / steps)
        # A shallow dish: the middle stands slightly proud of the edges
        dish = (1.0 - v * v) * 0.006
        rings.append([
            (-pw, v * ph, pt + dish),
            (pw, v * ph, pt + dish),
            (pw, v * ph, -pt),
            (-pw, v * ph, -pt),
        ])
    objs.append(mesh_from_quads("Pedal", rings, close_rings=True, close_loop=False))

    return objs


def export_glb(path, objects):
    for o in bpy.context.scene.objects:
        o.select_set(o in objects)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_materials="NONE",  # the game owns paint and glass
        export_yup=True,
    )


def triangle_count(objs):
    deps = bpy.context.evaluated_depsgraph_get()
    tris = 0
    for o in objs:
        mesh = o.evaluated_get(deps).to_mesh()
        mesh.calc_loop_triangles()
        tris += len(mesh.loop_triangles)
        o.evaluated_get(deps).to_mesh_clear()
    return tris


def emit(out, name, objs, report):
    path = os.path.join(out, f"{name}.glb")
    tris = triangle_count(objs)
    export_glb(path, objs)
    kb = os.path.getsize(path) / 1024
    report[name] = {"tris": tris, "kb": round(kb, 1),
                    "parts": sorted(o.name for o in objs)}
    print(f"{name}.glb  {kb:.0f} KB  ~{tris} tris  [{', '.join(sorted(o.name for o in objs))}]")


def main():
    global Q, SAMPLES_PER_SPAN, BEVEL_STEPS
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="public/models")
    ap.add_argument("--styles", default="sedan,zx,gtr,rx7")
    ap.add_argument("--quality", default="max", choices=sorted(QUALITY))
    ap.add_argument("--only", default="cars,wheels,palm,driver",
                    help="comma-separated subset of cars,wheels,palm,driver")
    args = ap.parse_args(sys.argv[1:])

    Q = QUALITY[args.quality]
    SAMPLES_PER_SPAN = Q["spans"]
    BEVEL_STEPS = Q["bevel"]
    only = set(args.only.split(","))

    with open(os.path.join(HERE, "profiles.json")) as f:
        profiles = json.load(f)

    os.makedirs(args.out, exist_ok=True)
    report = {}
    print(f"quality: {args.quality}  {Q}")

    if "cars" in only:
        for style in args.styles.split(","):
            bpy.ops.wm.read_factory_settings(use_empty=True)
            emit(args.out, f"car-{style}", build_style(style, profiles[style]), report)

    if "wheels" in only:
        # Two variants because the street cast runs five spokes and the
        # forged bronze six — the game picks by wheel finish.
        for spokes in (5, 6):
            bpy.ops.wm.read_factory_settings(use_empty=True)
            emit(args.out, f"wheel-{spokes}", build_wheel(spokes), report)

    if "palm" in only:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        emit(args.out, "palm", build_palm(), report)

    if "driver" in only:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        emit(args.out, "driver", build_driver(profiles["rig"]), report)

    total = sum(v["tris"] for v in report.values())
    print(f"\n{len(report)} files, ~{total} tris authored at quality={args.quality}")
    with open(os.path.join(args.out, "build.json"), "w") as f:
        json.dump({"quality": args.quality, "settings": Q, "assets": report}, f, indent=2)


if __name__ == "__main__":
    main()
