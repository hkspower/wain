"""The studio the car renders are shot in, as numbers.

One definition, used by every renderer that shoots the cars:

  tools/blender/render_cars.py   the Cycles studio set (press/renders)
  tools/max/render_pack.py       the same studio handed to 3ds Max / Arnold
  tools/max/preview_render.py    the Cycles preview of that pack

Frame: Blender's, which is also 3ds Max's: metres, Z up, the car's nose
toward -Y, its +X flank the one the key light and the hero camera see.
Plain tuples and math only, so it runs anywhere a Python does.
"""
import math

SODIUM = (0.92, 0.40, 0.03)
WORLD_GREY = (0.045, 0.045, 0.055)   # what reflections see where there is no light; camera sees black
# The game tone-maps with three.js ACESFilmic, which is Blender's ACES 1.3
# view evaluated at x / 0.6 (measured on a ramp: 0.18 -> 127 in the game is
# 0.30 -> 127 in Blender). So a Blender render at exposure 0 sat 0.74 EV
# under the game's own picture, whites topping out grey; this is the view
# exposure that makes the two the same.
GAME_EXPOSURE_EV = 0.737
LENS_MM, SENSOR_MM = 55.0, 36.0      # horizontal sensor fit
FILL = 0.93                           # the worst box corner sits at 93% of the half-frame

# Shots: azimuth swung from the nose (0) toward +X, elevation, both degrees.
SHOTS = {
    "hero": (36.0, 8.5),          # three-quarter front, a little below the beltline
    "side": (90.0, 4.0),          # the +X flank, square on
    "rear": (144.0, 8.5),         # three-quarter rear, same flank
}


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a):
    n = math.sqrt(_dot(a, a))
    return (a[0] / n, a[1] / n, a[2] / n)


def dims(mn, mx):
    """centre, floor z, length L (the long side), height H."""
    c = ((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2)
    L = max(mx[0] - mn[0], mx[1] - mn[1])
    return c, mn[2], L, mx[2] - mn[2]


def floor(mn, mx):
    c, gz, L, H = dims(mn, mx)
    # Black, low roughness, a lower specular: the reflection is the point,
    # and at 0.26 / 0.6 the key's reflection pooled into a hot patch. At
    # 0.30 the rim and the sodium still pooled on it, clipped (46% of the
    # lower right of the hero frame at 255), so the floor is a touch
    # rougher and the rim is kept off it altogether (see rig(): floor).
    return {"center": (c[0], c[1], gz), "size": max(120.0, L * 30), "base": (0.010, 0.010, 0.011),
            "roughness": 0.40, "specular": 0.4}


def rig(mn, mx):
    """The five area lights. Each: name, loc, target, energy (Blender watts),
    size (x), size_y (y), spread_deg, color, down=True for the strip,
    which hangs level, pointing straight down, long along the car, and
    floor=False for a light the floor does not receive."""
    c, gz, L, H = dims(mn, mx)
    tgt = c
    # The camera stands on the nose side swung toward +X, so +X is the
    # flank it sees. The key is on that side, high and forward; the fill
    # answers from -X; the rim and the sodium kicker come from behind —
    # the sodium from the far rear quarter, off the camera's axis, so it
    # edges the far flank rather than sitting behind the glasshouse.
    return [
        {"name": "Key", "loc": (c[0] + 1.3 * L, c[1] - 0.8 * L, gz + 2.4 * H + 1.0), "target": tgt,
         "energy": 1100, "size": 3.6, "size_y": 2.4, "spread_deg": 110, "color": (1, 1, 1)},
        {"name": "Fill", "loc": (c[0] - 1.6 * L, c[1] - 0.6 * L, gz + 1.0 * H + 0.6), "target": tgt,
         "energy": 170, "size": 5.0, "size_y": 3.5, "spread_deg": 160, "color": (0.86, 0.91, 1.0)},
        # The rim lights the car, not the floor: on a glossy floor its
        # mirror image lands just below the hero frame and spread a clipped
        # pool across the lower right of every hero shot. A studio would
        # flag it off the floor; Blender's light linking does the same.
        {"name": "Rim", "loc": (c[0] - 0.5 * L, c[1] + 1.4 * L, gz + 2.2 * H + 1.0), "target": tgt,
         "energy": 1400, "size": 2.2, "size_y": 1.2, "spread_deg": 80, "color": (0.95, 0.97, 1.0), "floor": False},
        {"name": "Sodium", "loc": (c[0] - 1.3 * L, c[1] + 0.6 * L, gz + 0.45 * H), "target": (c[0], c[1], gz + 0.5 * H),
         "energy": 260, "size": 1.6, "size_y": 0.6, "spread_deg": 70, "color": SODIUM},
        # The strip: long, thin, straight down over the roof, along the car,
        # a little toward the camera's side so the highlight sits on the
        # near shoulder.
        {"name": "Strip", "loc": (c[0] + 0.15 * L, c[1], gz + H + 1.5 * H + 0.9), "target": tgt,
         "energy": 1500, "size": 0.35, "size_y": 3.0 * L, "spread_deg": 120, "color": (1, 1, 1), "down": True},
    ]


def view_dir(az_deg, el_deg):
    """Unit vector from the aim point toward the camera."""
    a = -(math.pi / 2 - math.radians(az_deg))   # 0 = toward -Y (the nose), positive swings toward +X
    e = math.radians(el_deg)
    return (math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))


def camera_basis(loc, aim):
    """right, up, forward of a camera at loc looking at aim with world Z up
    (what Blender's to_track_quat('-Z', 'Y') gives)."""
    f = _norm(_sub(aim, loc))
    r = _norm(_cross(f, (0.0, 0.0, 1.0)))
    u = _cross(r, f)
    return r, u, f


def fit_camera(mn, mx, az_deg, el_deg, aspect, lens=LENS_MM, sensor=SENSOR_MM, fill=FILL, corners=None):
    """Walk the camera back along its view until the worst of the box's
    corners (or `corners`) sits at `fill` of the half-frame. Returns
    (loc, aim, worst). aspect = width / height."""
    c, gz, L, H = dims(mn, mx)
    aim = (c[0], c[1], gz + 0.40 * H)
    view = view_dir(az_deg, el_deg)
    tan_h = sensor / 2 / lens
    tan_v = tan_h / aspect
    pts = corners or [(x, y, z) for x in (mn[0], mx[0]) for y in (mn[1], mx[1]) for z in (mn[2], mx[2])]
    dist, worst = 1.0, 0.0
    for _ in range(40):
        loc = (aim[0] + view[0] * dist, aim[1] + view[1] * dist, aim[2] + view[2] * dist)
        r, u, f = camera_basis(loc, aim)
        worst = 0.0
        for k in pts:
            p = _sub(k, loc)
            depth = _dot(p, f)
            if depth <= 0.05:
                worst = 9.0
                break
            worst = max(worst, abs(_dot(p, r)) / (depth * tan_h), abs(_dot(p, u)) / (depth * tan_v))
        if abs(worst - fill) < 0.005:
            break
        dist *= worst / fill
    loc = (aim[0] + view[0] * dist, aim[1] + view[1] * dist, aim[2] + view[2] * dist)
    return loc, aim, worst


def turntable_corners(mn, mx, steps=24):
    """The box's corners swept round the car's vertical axis: framing these
    keeps every frame of a turntable inside the picture."""
    c, gz, L, H = dims(mn, mx)
    out = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        for x in (mn[0], mx[0]):
            for y in (mn[1], mx[1]):
                dx, dy = x - c[0], y - c[1]
                for z in (mn[2], mx[2]):
                    out.append((c[0] + dx * ct - dy * st, c[1] + dx * st + dy * ct, z))
    return out
