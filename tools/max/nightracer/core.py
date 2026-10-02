"""The game's shell tests, in plain Python, for the 3ds Max panel.

No 3ds Max and no numpy here: this module is the part that can be proved
against the game, and tools/max/test_core.py does exactly that — the
crown, the fit and the mirror check below are held to src/game/cars.ts
(crownShell), src/game/models.ts (shellFit) and scripts/check-shell-mirror.mjs
on every shipped shell. maxio.py feeds it 3ds Max meshes; panel.py shows
what it says.

A mesh here is (pos, tri): pos a flat list [x0, y0, z0, x1, ...] in the
GAME frame (metres, y up, nose +z), tri a flat list of vertex indices,
three per triangle. Max and Blender are z up with the nose toward -y;
to_game / from_game convert.
"""
import math
import struct

PLAN_HOLD = 0.41   # cars.ts: the plan taper's full-width hold, as a fraction of length
N_STATIONS = 32    # cars.ts: crownShell's stations along the car
MIN_TWINS = 0.995  # check-shell-mirror.mjs
SEAM_EPS = 0.002   # check-shell-mirror.mjs: |x| under this is on the centreline


def _f32(v):
    """Round to float32, as a write into a Float32Array does."""
    return struct.unpack("f", struct.pack("f", v))[0]


def _js_round(v):
    """Math.round: halves go up, not to even."""
    return math.floor(v + 0.5)


# ---------------------------------------------------------------- frames

def to_game(pos):
    """Max/Blender (z up, nose -y) -> game (y up, nose +z): (x, z, -y)."""
    out = [0.0] * len(pos)
    for i in range(0, len(pos), 3):
        out[i], out[i + 1], out[i + 2] = pos[i], pos[i + 2], -pos[i + 1]
    return out


def from_game(pos):
    out = [0.0] * len(pos)
    for i in range(0, len(pos), 3):
        out[i], out[i + 1], out[i + 2] = pos[i], -pos[i + 2], pos[i + 1]
    return out


def bbox(pos):
    xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


# ---------------------------------------------------------------- crown

def crown(pos, spec):
    """crownShell (src/game/cars.ts), on a copy. spec: tuck, roof, shoulder,
    plan (optional), smooth (optional). Returns the new flat position list."""
    n = len(pos) // 3
    out = list(pos)
    if not n:
        return out
    (_, _, z0), (_, _, z1) = bbox(pos)
    span = z1 - z0
    if not span > 1e-4:
        return out
    N = N_STATIONS
    # Float32Array(N).fill(...): the fills are stored as float32 too, and
    # the smoothing below compares against the double. For 1e-4 the two
    # differ, so an empty half-width station is NOT skipped — as in the game.
    max_x = [_f32(1e-4)] * N
    max_y = [_f32(-1e9)] * N
    min_y = [_f32(1e9)] * N

    def station(z):
        return min(N - 1, max(0, math.floor(((z - z0) / span) * N)))

    for i in range(n):
        k = station(pos[i * 3 + 2])
        ax = abs(pos[i * 3])
        if ax > max_x[k]:
            max_x[k] = _f32(ax)
        y = pos[i * 3 + 1]
        if y > max_y[k]:
            max_y[k] = _f32(y)
        if y < min_y[k]:
            min_y[k] = _f32(y)

    def sm(a, fill):
        res = [0.0] * N
        for k in range(N):
            s, w = 0.0, 0
            for d in (-1, 0, 1):
                j = k + d
                if j < 0 or j >= N:
                    continue
                if not math.isfinite(a[j]) or a[j] == fill:
                    continue
                s += a[j]
                w += 1
            res[k] = _f32(s / w) if w else a[k]
        return res

    half_w, top_y, bot_y = sm(max_x, 1e-4), sm(max_y, -1e9), sm(min_y, 1e9)
    tuck, roof, shoulder = spec["tuck"], spec["roof"], spec["shoulder"]
    plan = spec.get("plan") or 0.0
    smooth = bool(spec.get("smooth"))

    def lerp(a, b, t):
        return a + (b - a) * t

    for i in range(n):
        x, y, z = pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]
        if smooth:
            f = min(N - 1, max(0, ((z - z0) / span) * N - 0.5))
            k0 = math.floor(f)
            k1 = min(N - 1, k0 + 1)
            kt = f - k0
        else:
            k0 = k1 = station(z)
            kt = 0.0
        hw = lerp(half_w[k0], half_w[k1], kt)
        hi = lerp(top_y[k0], top_y[k1], kt)
        lo = lerp(bot_y[k0], bot_y[k1], kt)
        if not hw > 1e-3 or not (hi - lo) > 1e-3:
            continue
        u = min(1.0, abs(x) / hw)
        t = min(1.0, max(0.0, (y - lo) / (hi - lo)))
        den = (1 - shoulder) if t >= shoulder else (shoulder or 1)
        d = (t - shoulder) / den
        pull = tuck * (1 - math.cos(min(1.0, abs(d)) * math.pi)) * 0.5
        zf = (z - z0) / span
        past = max(0.0, abs(zf - 0.5) - PLAN_HOLD)
        nip = plan * (1 - math.cos(min(1.0, past / (0.5 - PLAN_HOLD)) * math.pi)) * 0.5
        out[i * 3] = x * (1 - pull) * (1 - nip)
        if t > 0.5:
            w = (t - 0.5) / 0.5
            out[i * 3 + 1] = y - roof * u * u * w * w
    return out


# ---------------------------------------------------------------- fit (models.ts)

def box_drift(a, b):
    (ax0, ay0, az0), (ax1, ay1, az1) = bbox(a)
    (bx0, by0, bz0), (bx1, by1, bz1) = bbox(b)
    return max(abs(ax0 - bx0), abs(ax1 - bx1), abs(ay0 - by0), abs(ay1 - by1), abs(az0 - bz0), abs(az1 - bz1))


def worst_face(a, b):
    (ax0, ay0, az0), (ax1, ay1, az1) = bbox(a)
    (bx0, by0, bz0), (bx1, by1, bz1) = bbox(b)
    faces = [("left (-x)", ax0 - bx0), ("right (+x)", ax1 - bx1), ("bottom (-y)", ay0 - by0),
             ("top (+y)", ay1 - by1), ("tail (-z)", az0 - bz0), ("nose (+z)", az1 - bz1)]
    return max(faces, key=lambda f: abs(f[1]))


class DownCaster:
    """Straight-down rays against one mesh, the way three.js answers them for
    surfaceDrift: front faces only (FrontSide material), nearest hit first.
    Triangles are bucketed on an XZ grid so 25 rays cost nothing."""

    def __init__(self, pos, tri, cells=64):
        (x0, _, z0), (x1, _, z1) = bbox(pos)
        self.x0, self.z0 = x0, z0
        self.cx = max((x1 - x0) / cells, 1e-6)
        self.cz = max((z1 - z0) / cells, 1e-6)
        self.cells = cells
        self.grid = {}
        self.pos, self.tri = pos, tri
        for t in range(0, len(tri), 3):
            a, b, c = tri[t] * 3, tri[t + 1] * 3, tri[t + 2] * 3
            xs = (pos[a], pos[b], pos[c])
            zs = (pos[a + 2], pos[b + 2], pos[c + 2])
            i0, i1 = self._ix(min(xs)), self._ix(max(xs))
            j0, j1 = self._jz(min(zs)), self._jz(max(zs))
            for i in range(i0, i1 + 1):
                for j in range(j0, j1 + 1):
                    self.grid.setdefault((i, j), []).append(t)

    def _ix(self, x):
        return min(self.cells - 1, max(0, int((x - self.x0) / self.cx)))

    def _jz(self, z):
        return min(self.cells - 1, max(0, int((z - self.z0) / self.cz)))

    def top(self, x, z):
        """The highest front-facing hit at (x, z), or None."""
        p, tri = self.pos, self.tri
        best = None
        for t in self.grid.get((self._ix(x), self._jz(z)), ()):
            a, b, c = tri[t] * 3, tri[t + 1] * 3, tri[t + 2] * 3
            ax, ay, az = p[a], p[a + 1], p[a + 2]
            e1x, e1y, e1z = p[b] - ax, p[b + 1] - ay, p[b + 2] - az
            e2x, e2y, e2z = p[c] - ax, p[c + 1] - ay, p[c + 2] - az
            ny = e1z * e2x - e1x * e2z            # (e1 x e2).y
            if ny <= 0:                           # back-facing to a downward ray, or edge-on
                continue
            # Barycentrics in the XZ plane.
            px, pz = x - ax, z - az
            det = e1x * e2z - e2x * e1z
            if det == 0:
                continue
            u = (px * e2z - e2x * pz) / det
            v = (e1x * pz - px * e1z) / det
            if u < 0 or v < 0 or u + v > 1:
                continue
            y = ay + u * e1y + v * e2y
            if best is None or y > best:
                best = y
        return best


def skin_drift(a_pos, a_tri, b_pos, b_tri, a_cast=None, b_cast=None):
    """surfaceDrift: 5 x 5 downward rays over the inner 70% of A's footprint,
    compared only where both surfaces answer. Metres."""
    ca = a_cast or DownCaster(a_pos, a_tri)
    cb = b_cast or DownCaster(b_pos, b_tri)
    (x0, _, z0), (x1, _, z1) = bbox(a_pos)
    worst, N = 0.0, 5
    for i in range(N):
        x = x0 + (x1 - x0) * (0.15 + 0.7 * (i / (N - 1)))
        for j in range(N):
            z = z0 + (z1 - z0) * (0.15 + 0.7 * (j / (N - 1)))
            ha, hb = ca.top(x, z), cb.top(x, z)
            if ha is None or hb is None:
                continue
            worst = max(worst, abs(ha - hb))
    return worst


def shell_fit(a_pos, a_tri, b_pos, b_tri, tol=0.01):
    """shellFit: box first, then skin. a is the authored shell ALREADY crowned."""
    box = box_drift(a_pos, b_pos)
    if box > tol:
        return {"box": box, "skin": None, "ok": False, "reason": "stale: %.0f mm off the profile" % (box * 1000)}
    skin = skin_drift(a_pos, a_tri, b_pos, b_tri)
    if skin > tol:
        return {"box": box, "skin": skin, "ok": False, "reason": "stale: skin %.0f mm off the profile" % (skin * 1000)}
    return {"box": box, "skin": skin, "ok": True, "reason": "authored"}


# ---------------------------------------------------------------- mirror (check-shell-mirror.mjs)

def _welded(pos):
    """Canonical vertex ids on a 0.5 mm key, and each vertex's mirror id (-1 if none)."""
    n = len(pos) // 3
    canon, cid = {}, [0] * n

    def key(x, y, z):
        return (_js_round(x * 2000), _js_round(y * 2000), _js_round(z * 2000))

    for i in range(n):
        k = key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
        if k not in canon:
            canon[k] = len(canon)
        cid[i] = canon[k]
    mir = [canon.get(key(-pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), -1) for i in range(n)]
    return cid, mir


def mirror_report(pos, tri):
    """twin share of one-sided triangles, straddling count, open and over-shared edges."""
    cid, mir = _welded(pos)
    faces = set()
    for t in range(0, len(tri), 3):
        faces.add(tuple(sorted((cid[tri[t]], cid[tri[t + 1]], cid[tri[t + 2]]))))

    def side(i):
        x = pos[i * 3]
        return 1 if x > SEAM_EPS else (-1 if x < -SEAM_EPS else 0)

    twins = sided = straddle = 0
    edges = {}
    for t in range(0, len(tri), 3):
        a, b, c = tri[t], tri[t + 1], tri[t + 2]
        s = (side(a), side(b), side(c))
        if any(v > 0 for v in s) and any(v < 0 for v in s):
            straddle += 1
        else:
            sided += 1
            if mir[a] >= 0 and mir[b] >= 0 and mir[c] >= 0 and tuple(sorted((mir[a], mir[b], mir[c]))) in faces:
                twins += 1
        for p0, p1 in ((cid[a], cid[b]), (cid[b], cid[c]), (cid[c], cid[a])):
            k = (p0, p1) if p0 < p1 else (p1, p0)
            edges[k] = edges.get(k, 0) + 1
    open_ = sum(1 for v in edges.values() if v == 1)
    over = sum(1 for v in edges.values() if v > 2)
    share = twins / max(1, sided)
    return {"share": share, "tris": len(tri) // 3, "straddle": straddle, "open": open_, "over": over,
            "ok": share >= MIN_TWINS and open_ == 0}


def symmetrize(pos, tri):
    """scripts/mirror-shells.mjs, on one mesh: keep the +x half's triangles
    and the seam, and replace the -x half with the +x half mirrored. Moves
    no vertex; every vertex must already have a mirror twin to 0.5 mm (a
    loft does; a hand-edited mesh may not — the Symmetry modifier is the
    tool for that). Returns the new triangle list, or raises ValueError."""
    n = len(pos) // 3

    def key(x, y, z):
        return (_js_round(x * 2000), _js_round(y * 2000), _js_round(z * 2000))

    at = {}
    for i in range(n):
        at.setdefault(key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), []).append(i)
    m = [-1] * n
    missing = 0
    for i in range(n):
        c = at.get(key(-pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]))
        if c:
            m[i] = c[0]
        else:
            missing += 1
    if missing:
        raise ValueError("%d vertices have no mirror twin; use the Symmetry modifier instead" % missing)

    def side(i):
        x = pos[i * 3]
        return 1 if x > SEAM_EPS else (-1 if x < -SEAM_EPS else 0)

    def classify(a, b, c):
        s = (side(a), side(b), side(c))
        if all(v >= 0 for v in s) and any(v > 0 for v in s):
            return 1
        if all(v <= 0 for v in s) and any(v < 0 for v in s):
            return -1
        return 0

    out, right, left = [], 0, 0
    for t in range(0, len(tri), 3):
        a, b, c = tri[t], tri[t + 1], tri[t + 2]
        k = classify(a, b, c)
        if k > 0:
            right += 1
            out += [a, b, c]
        elif k < 0:
            left += 1
        else:
            out += [a, b, c]
    for t in range(0, len(tri), 3):
        a, b, c = tri[t], tri[t + 1], tri[t + 2]
        if classify(a, b, c) > 0:
            out += [m[a], m[c], m[b]]
    if left != right:
        raise ValueError("left %d and right %d triangles differ; use the Symmetry modifier instead" % (left, right))
    return out


# ---------------------------------------------------------------- solid

def signed_volume(pos, tri):
    v = 0.0
    for t in range(0, len(tri), 3):
        a, b, c = tri[t] * 3, tri[t + 1] * 3, tri[t + 2] * 3
        ax, ay, az = pos[a], pos[a + 1], pos[a + 2]
        bx, by, bz = pos[b], pos[b + 1], pos[b + 2]
        cx, cy, cz = pos[c], pos[c + 1], pos[c + 2]
        v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6.0
    return v


# ---------------------------------------------------------------- nearest point (heatmap, snap)

def _closest_on_tri(px, py, pz, a, b, c):
    """Ericson, Real-Time Collision Detection 5.1.5. Returns the closest point."""
    ax, ay, az = a
    bx, by, bz = b
    cx, cy, cz = c
    abx, aby, abz = bx - ax, by - ay, bz - az
    acx, acy, acz = cx - ax, cy - ay, cz - az
    apx, apy, apz = px - ax, py - ay, pz - az
    d1 = abx * apx + aby * apy + abz * apz
    d2 = acx * apx + acy * apy + acz * apz
    if d1 <= 0 and d2 <= 0:
        return a
    bpx, bpy, bpz = px - bx, py - by, pz - bz
    d3 = abx * bpx + aby * bpy + abz * bpz
    d4 = acx * bpx + acy * bpy + acz * bpz
    if d3 >= 0 and d4 <= d3:
        return b
    vc = d1 * d4 - d3 * d2
    if vc <= 0 and d1 >= 0 and d3 <= 0:
        v = d1 / (d1 - d3)
        return (ax + v * abx, ay + v * aby, az + v * abz)
    cpx, cpy, cpz = px - cx, py - cy, pz - cz
    d5 = abx * cpx + aby * cpy + abz * cpz
    d6 = acx * cpx + acy * cpy + acz * cpz
    if d6 >= 0 and d5 <= d6:
        return c
    vb = d5 * d2 - d1 * d6
    if vb <= 0 and d2 >= 0 and d6 <= 0:
        w = d2 / (d2 - d6)
        return (ax + w * acx, ay + w * acy, az + w * acz)
    va = d3 * d6 - d5 * d4
    if va <= 0 and (d4 - d3) >= 0 and (d5 - d6) >= 0:
        w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        return (bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz))
    den = 1.0 / (va + vb + vc)
    v, w = vb * den, vc * den
    return (ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w)


class Nearest:
    """Closest point on a mesh, triangles bucketed in a 3D grid."""

    def __init__(self, pos, tri, cell=0.05):
        self.pos, self.tri, self.cell = pos, tri, cell
        self.grid = {}
        for t in range(0, len(tri), 3):
            a, b, c = tri[t] * 3, tri[t + 1] * 3, tri[t + 2] * 3
            lo = [min(pos[a + k], pos[b + k], pos[c + k]) for k in range(3)]
            hi = [max(pos[a + k], pos[b + k], pos[c + k]) for k in range(3)]
            i0, i1 = (self._c(lo[0]), self._c(hi[0]))
            j0, j1 = (self._c(lo[1]), self._c(hi[1]))
            k0, k1 = (self._c(lo[2]), self._c(hi[2]))
            for i in range(i0, i1 + 1):
                for j in range(j0, j1 + 1):
                    for k in range(k0, k1 + 1):
                        self.grid.setdefault((i, j, k), []).append(t)

    def _c(self, v):
        return int(math.floor(v / self.cell))

    def query(self, x, y, z, max_ring=8):
        """(distance, (cx, cy, cz)) to the nearest surface point, or (inf, None)
        when nothing lies within max_ring cells."""
        p = self.pos
        ci, cj, ck = self._c(x), self._c(y), self._c(z)
        best, best_pt, seen = math.inf, None, set()
        for r in range(max_ring + 1):
            if best_pt is not None and (r - 1) * self.cell > best:
                break
            for i in range(ci - r, ci + r + 1):
                for j in range(cj - r, cj + r + 1):
                    for k in range(ck - r, ck + r + 1):
                        if max(abs(i - ci), abs(j - cj), abs(k - ck)) != r:
                            continue
                        for t in self.grid.get((i, j, k), ()):
                            if t in seen:
                                continue
                            seen.add(t)
                            a, b, c = self.tri[t] * 3, self.tri[t + 1] * 3, self.tri[t + 2] * 3
                            q = _closest_on_tri(x, y, z, (p[a], p[a + 1], p[a + 2]),
                                                (p[b], p[b + 1], p[b + 2]), (p[c], p[c + 1], p[c + 2]))
                            d = math.sqrt((q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2)
                            if d < best:
                                best, best_pt = d, q
        return best, best_pt


def heat(distances, green=0.005, red=0.01):
    """Distance (m) -> RGB 0..255: green under `green`, amber up to `red`, red past it."""
    out = []
    for d in distances:
        if d is None or not math.isfinite(d):
            out.append((90, 90, 90))
        elif d <= green:
            out.append((40, 200, 90))
        elif d <= red:
            f = (d - green) / max(1e-9, red - green)
            out.append((int(240), int(200 - 60 * f), 30))
        else:
            out.append((230, 40, 40))
    return out


# ---------------------------------------------------------------- the whole judgement

SLOTS = ("body", "canopy", "roof")


def judge(edit, target, info, budget=1.5):
    """edit / target: {slot: (pos, tri)} in the game frame, edit UNcrowned.
    info: the car-<style>.nr.json dict. Returns {slot: verdict dict}."""
    tol = info.get("tolerance", 0.01)
    out = {}
    for slot in SLOTS:
        v = {"slot": slot}
        out[slot] = v
        if slot not in edit:
            v.update(ok=False, reason="not in the scene")
            continue
        pos, tri = edit[slot]
        spec = info["slots"][slot]["crown"]
        crowned = crown(pos, spec)
        if slot in target:
            fit = shell_fit(crowned, tri, target[slot][0], target[slot][1], tol)
            v.update(fit)
            v["face"] = worst_face(crowned, target[slot][0])
        else:
            v.update(ok=True, reason="no target for this slot")
        shipped = info["slots"][slot].get("shipped")
        v["alreadyRejected"] = bool(shipped and not shipped.get("ok", True))
        m = mirror_report(pos, tri)
        v["mirror"] = m
        v["insideOut"] = signed_volume(pos, tri) < 0
        v["tris"] = len(tri) // 3
        st = info["slots"][slot].get("shippedTris")
        v["overBudget"] = bool(st and v["tris"] > st * budget)
        v["gameOk"] = v.get("ok", False) and m["ok"] and not v["insideOut"]
    return out
