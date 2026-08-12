#!/usr/bin/env python3
"""Model every car silhouette in Blender and export game-ready glTF.

    pip install bpy
    node scripts/export-car-profiles.mjs        # refresh profiles.json
    python3 tools/blender/build_cars.py --out public/models

Produces car-sedan.glb, car-zx.glb, car-gtr.glb and car-rx7.glb, each
holding three meshes named Body, Canopy and Roof — the shells the game
swaps in over its procedural extrusions (src/game/models.ts). Wheels,
lamps, trim and aero stay procedural, so the export is geometry only.

Fidelity is the whole point: the loft below reproduces what
THREE.ExtrudeGeometry does with the same profiles in src/game/cars.ts —
a Catmull-Rom spline through the top run, straight rocker, and a
quarter-circle side bevel that bulges the mid-section outward by the
bevel radius. Every anchored detail (pop-up doors, tail garnish, wipers)
was positioned against that bulged surface, so the authored shells must
land on it exactly — just smoother, sampled at roughly four times the
density the runtime extrusion affords.

Axes: built in Blender coordinates (X = width, -Y = nose, Z = up); the
glTF exporter's Y-up conversion turns that into the game's frame
(X = width, Y = up, +Z = nose).
"""

import argparse
import json
import math
import os
import sys

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))

# Sampling density: the runtime SplineCurve resolves to ~31 samples per
# span (curveSegments 28 × 9 control points over 8 spans); 32 per span
# meets it along the profile, and 8 bevel steps beat the runtime's 5
# across the width — the authored shells are never the coarser mesh.
SAMPLES_PER_SPAN = 32
BEVEL_STEPS = 8


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="public/models")
    ap.add_argument("--styles", default="sedan,zx,gtr,rx7")
    args = ap.parse_args(sys.argv[1:])

    with open(os.path.join(HERE, "profiles.json")) as f:
        profiles = json.load(f)

    os.makedirs(args.out, exist_ok=True)
    for style in args.styles.split(","):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        objs = build_style(style, profiles[style])
        path = os.path.join(args.out, f"car-{style}.glb")
        export_glb(path, objs)

        deps = bpy.context.evaluated_depsgraph_get()
        tris = 0
        for o in objs:
            mesh = o.evaluated_get(deps).to_mesh()
            mesh.calc_loop_triangles()
            tris += len(mesh.loop_triangles)
            o.evaluated_get(deps).to_mesh_clear()
        print(f"car-{style}.glb  {os.path.getsize(path)/1024:.0f} KB  ~{tris} tris")


if __name__ == "__main__":
    main()
