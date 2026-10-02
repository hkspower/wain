"""3ds Max <-> core.py: meshes out of the scene, results back into it.

Everything here talks to pymxs; everything it hands core.py is plain lists.
Positions leave Max in metres, world space, in Max's own frame (z up, nose
-y) and core.to_game turns them into the game's.
"""
import json
import os

from pymxs import runtime as rt

from . import core

GROUPS = ("NR_Edit", "NR_Envelope", "NR_Target", "NR_Context", "NR_Heatmap")
SLOTS = ("Body", "Canopy", "Roof")
PREFIX = {"NR_Edit": "", "NR_Envelope": "Envelope_", "NR_Target": "Target_", "NR_Heatmap": "NR_Heat_"}


# ---------------------------------------------------------------- scene

def metres():
    rt.units.DisplayType = rt.Name("metric")
    rt.units.MetricType = rt.Name("meters")
    rt.units.SystemType = rt.Name("meters")
    rt.units.SystemScale = 1.0


def unit_to_m():
    """Scene units -> metres, whatever the scene is set to."""
    return 1.0 / float(rt.units.decodeValue("1m"))


def root_name(node):
    r = node
    while r.parent is not None:
        r = r.parent
    return str(r.name)


def is_geometry(node):
    return rt.superClassOf(node) == rt.GeometryClass and rt.classOf(node) != rt.Targetobject


def group_of(node):
    """Which NR group a node belongs to: by its root dummy, else by its layer."""
    r = root_name(node)
    if r in GROUPS:
        return r
    try:
        ln = str(node.layer.name)
        if ln in GROUPS:
            return ln
    except Exception:
        pass
    return None


def slot_nodes(group, slot):
    """Every geometry node of `slot` in `group` (the game needs exactly one)."""
    want = (PREFIX.get(group, "") + slot).lower()
    out = []
    for n in rt.objects:
        if not is_geometry(n):
            continue
        name = str(n.name).lower()
        if name != want and name.split(".")[0] != want:
            continue
        g = group_of(n)
        if g == group or (group == "NR_Edit" and g is None and n.parent is None):
            out.append(n)
    return out


def slot_node(group, slot):
    hits = slot_nodes(group, slot)
    return hits[0] if len(hits) == 1 else None


def layer(name, frozen=False, hidden=False):
    l = rt.LayerManager.getLayerFromName(name)
    if l is None:
        l = rt.LayerManager.newLayerFromName(name)
    l.isFrozen = frozen
    l.isHidden = hidden
    return l


# ---------------------------------------------------------------- meshes

def read_mesh(node, game=True):
    """(pos, tri) of a node as it renders (modifiers applied), world space,
    metres; in the game frame unless game=False."""
    m = rt.snapshotAsMesh(node)
    k = unit_to_m()
    nv, nf = int(rt.getNumVerts(m)), int(rt.getNumFaces(m))
    pos = [0.0] * (nv * 3)
    for i in range(nv):
        p = rt.getVert(m, i + 1)
        pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2] = p.x * k, p.y * k, p.z * k
    tri = [0] * (nf * 3)
    for f in range(nf):
        fa = rt.getFace(m, f + 1)
        tri[f * 3], tri[f * 3 + 1], tri[f * 3 + 2] = int(fa.x) - 1, int(fa.y) - 1, int(fa.z) - 1
    rt.delete(m)
    return (core.to_game(pos), tri) if game else (pos, tri)


def make_mesh(name, pos_max, tri, colours=None):
    """A new Editable Mesh node from Max-frame metres (identity transform)."""
    k = 1.0 / unit_to_m()
    verts = [rt.Point3(pos_max[i] * k, pos_max[i + 1] * k, pos_max[i + 2] * k) for i in range(0, len(pos_max), 3)]
    faces = [rt.Point3(tri[i] + 1, tri[i + 1] + 1, tri[i + 2] + 1) for i in range(0, len(tri), 3)]
    node = rt.mesh(vertices=verts, faces=faces)
    node.name = name
    rt.meshop.autoSmooth(node, rt.Name("all"), 45.0)
    if colours:
        m = node.mesh
        rt.setNumCPVVerts(m, len(colours))
        for i, (r, g, b) in enumerate(colours):
            rt.setVertColor(m, i + 1, rt.Color(r, g, b))
        rt.defaultVCFaces(m)
        rt.update(node)
        node.showVertexColors = True
        node.vertexColorType = 0
        node.vertexColorsShaded = False
    return node


def replace_geometry(node, pos_max, tri):
    """Swap a node's whole mesh for this one, keeping its name, parent and
    layer. Comes back as Editable Poly, auto-smoothed."""
    new = make_mesh(str(node.name), pos_max, tri)
    new.parent = node.parent
    node.layer.addNode(new)
    new.wirecolor = node.wirecolor
    try:
        new.material = node.material
    except Exception:
        pass
    rt.delete(node)
    rt.convertToPoly(new)
    return new


# ---------------------------------------------------------------- the style's data

def style_info():
    """The car-<style>.nr.json dict stored in the scene, or None."""
    raw = file_prop("nr_json")
    return json.loads(raw) if raw else None


def file_prop(name):
    i = rt.fileProperties.findProperty(rt.Name("custom"), name)
    return str(rt.fileProperties.getPropertyValue(rt.Name("custom"), i)) if i and i > 0 else None


def set_file_prop(name, value):
    rt.fileProperties.addProperty(rt.Name("custom"), name, value)


def open_style(fbx_path, symmetry=False):
    """Reset, import, sort onto layers, load the style's nr.json into the scene."""
    rt.resetMaxFile(rt.Name("noPrompt"))
    metres()
    rt.FBXImporterSetParam("ResetImport")
    rt.FBXImporterSetParam("Mode", rt.Name("create"))
    rt.FBXImporterSetParam("ScaleConversion", True)
    rt.FBXImporterSetParam("ConvertUnit", "m")
    rt.FBXImporterSetParam("SmoothingGroups", True)
    rt.FBXImporterSetParam("Cameras", False)
    rt.FBXImporterSetParam("Lights", False)
    rt.FBXImporterSetParam("Animation", False)
    if rt.importFile(fbx_path, rt.Name("noPrompt"), using=rt.FBXIMP) is False:
        raise RuntimeError("FBX import failed: %s" % fbx_path)

    base = os.path.splitext(os.path.basename(fbx_path))[0]
    style = base[4:] if base.startswith("car-") else base
    lay = {"NR_Edit": layer("NR_Edit"), "NR_Envelope": layer("NR_Envelope", frozen=True),
           "NR_Target": layer("NR_Target", frozen=True, hidden=True), "NR_Context": layer("NR_Context", frozen=True)}
    for n in list(rt.objects):
        g = root_name(n)
        if g in lay:
            lay[g].addNode(n)
            if g != "NR_Edit":
                n.renderable = False
            if g == "NR_Envelope":
                n.xray = True
    if symmetry:
        for s in SLOTS:
            for n in slot_nodes("NR_Edit", s):
                n.pivot = rt.Point3(0, 0, 0)
                rt.addModifier(n, rt.Symmetry())

    set_file_prop("nr_style", style)
    set_file_prop("nr_dir", os.path.dirname(fbx_path))
    j = os.path.join(os.path.dirname(fbx_path), "car-%s.nr.json" % style)
    if os.path.exists(j):
        with open(j) as f:
            set_file_prop("nr_json", f.read())
    rt.execute("max zoomext sel all")
    return style, os.path.exists(j)


# ---------------------------------------------------------------- checks

def gather(group):
    out = {}
    for s in SLOTS:
        n = slot_node(group, s)
        if n is not None:
            out[s.lower()] = read_mesh(n)
    return out


def check():
    """core.judge on the scene, plus the name count per slot."""
    info = style_info()
    if info is None:
        raise RuntimeError("This scene has no Night Racer style data. Open the car with 'Open style...' first.")
    counts = {s.lower(): len(slot_nodes("NR_Edit", s)) for s in SLOTS}
    edit = gather("NR_Edit")
    target = gather("NR_Target")
    verdicts = core.judge(edit, target, info)
    for s, v in verdicts.items():
        v["count"] = counts[s]
        if counts[s] != 1:
            v["ok"] = v["gameOk"] = False
            v["reason"] = "%d meshes named %s; the game needs exactly one" % (counts[s], s.capitalize())
    return verdicts


# ---------------------------------------------------------------- heatmap

def heatmap(green_mm=5.0, red_mm=10.0, progress=None):
    """Colour a copy of each Edit shell by how far its CROWNED surface sits
    from the game's own (Target), and show the copies instead of the shells."""
    info = style_info()
    if info is None:
        raise RuntimeError("Open the car with 'Open style...' first.")
    clear_heatmap()
    hl = layer("NR_Heatmap")
    made = []
    for s in SLOTS:
        n, t = slot_node("NR_Edit", s), slot_node("NR_Target", s)
        if n is None or t is None:
            continue
        pos_max, tri = read_mesh(n, game=False)
        game = core.to_game(pos_max)
        crowned = core.crown(game, info["slots"][s.lower()]["crown"])
        tp, tt = read_mesh(t)
        near = core.Nearest(tp, tt)
        # One query per welded position; split normals share an answer.
        seen, dist = {}, []
        nv = len(crowned) // 3
        for i in range(nv):
            key = (round(crowned[i * 3], 5), round(crowned[i * 3 + 1], 5), round(crowned[i * 3 + 2], 5))
            if key not in seen:
                seen[key] = near.query(*key)[0]
            dist.append(seen[key])
            if progress and i % 2000 == 0:
                progress(s, i, nv)
        h = make_mesh(PREFIX["NR_Heatmap"] + s, pos_max, tri, core.heat(dist, green_mm / 1000.0, red_mm / 1000.0))
        hl.addNode(h)
        h.renderable = False
        finite = [d for d in dist if d < float("inf")]
        made.append((s, max(finite) if finite else float("nan")))
    show_heatmap(True)
    return made


def clear_heatmap():
    for n in list(rt.objects):
        if str(n.name).startswith(PREFIX["NR_Heatmap"]):
            rt.delete(n)


def show_heatmap(on):
    layer("NR_Heatmap", hidden=not on)
    layer("NR_Edit", hidden=on)


# ---------------------------------------------------------------- fixes

def edit_or_raise(slot):
    n = slot_node("NR_Edit", slot)
    if n is None:
        raise RuntimeError("Need exactly one %s on the NR_Edit layer." % slot)
    return n


def selected_edit_node():
    sel = [n for n in rt.selection if group_of(n) == "NR_Edit" and is_geometry(n)]
    if len(sel) != 1:
        raise RuntimeError("Select one shell (Body, Canopy or Roof) on the NR_Edit layer.")
    return sel[0]


def snap_selected_verts():
    """Move the selected vertices of the selected Edit shell (Editable Poly)
    to the nearest point on its Envelope."""
    n = selected_edit_node()
    if rt.classOf(n.baseObject) != rt.Editable_Poly:
        raise RuntimeError("Convert %s to Editable Poly first." % n.name)
    slot = str(n.name).split(".")[0].capitalize()
    env = slot_node("NR_Envelope", slot)
    if env is None:
        raise RuntimeError("No Envelope_%s in the scene." % slot)
    ep, et = read_mesh(env, game=False)
    near = core.Nearest(ep, et)
    k = unit_to_m()
    # Iterating a pymxs BitArray yields booleans, not indices; MAXScript's
    # "as array" gives the 1-based indices of the set bits.
    sel = [int(i) for i in rt.execute("fn nrBitsToArray b = (b as array)")(rt.polyop.getVertSelection(n))]
    if not sel:
        raise RuntimeError("Select some vertices on %s first (vertex sub-object level)." % n.name)
    worst = 0.0
    for v in sel:
        p = rt.polyop.getVert(n, v)
        d, q = near.query(p.x * k, p.y * k, p.z * k, max_ring=12)
        if q is None:
            continue
        worst = max(worst, d)
        rt.polyop.setVert(n, v, rt.Point3(q[0] / k, q[1] / k, q[2] / k))
    rt.redrawViews()
    return len(sel), worst


def make_symmetric(node=None):
    """Symmetry modifier about X = 0, collapsed: works on any edited mesh."""
    n = node or selected_edit_node()
    n.pivot = rt.Point3(0, 0, 0)
    rt.addModifier(n, rt.Symmetry())
    rt.maxOps.CollapseNode(n, True)
    return n


def recentre(node=None):
    n = node or selected_edit_node()
    c = (n.min.x + n.max.x) / 2.0
    n.position = rt.Point3(n.position.x - c, n.position.y, n.position.z)
    return c / (1.0 / unit_to_m())


def turn_outward():
    """Flip every Edit shell that is inside-out as a whole."""
    flipped = []
    for s in SLOTS:
        n = slot_node("NR_Edit", s)
        if n is None:
            continue
        pos, tri = read_mesh(n)
        if core.signed_volume(pos, tri) < 0:
            rt.addModifier(n, rt.Normalmodifier(flip=True))
            rt.maxOps.CollapseNode(n, True)
            flipped.append(s)
    return flipped


def replace_with_envelope(slot):
    """The guided fix: this slot becomes the fresh loft, made symmetric the
    way scripts/mirror-shells.mjs does it, ready to refine."""
    n = edit_or_raise(slot)
    env = slot_node("NR_Envelope", slot)
    if env is None:
        raise RuntimeError("No Envelope_%s in the scene." % slot)
    pos, tri = read_mesh(env, game=False)
    try:
        tri = core.symmetrize(pos, tri)
    except ValueError:
        pass  # left as lofted; the mirror check will say so
    return replace_geometry(n, pos, tri)


# ---------------------------------------------------------------- files

FBX_EXPORT = (("Animation", False), ("BakeAnimation", False), ("Cameras", False), ("Lights", False),
              ("EmbedTextures", False), ("SmoothingGroups", True), ("Triangulate", True), ("Shape", False),
              ("Skin", False), ("ScaleFactor", 1.0), ("ConvertUnit", "m"), ("UpAxis", "Y"), ("ASCII", False))


def export_for_game(out_dir=None):
    style = file_prop("nr_style")
    if not style:
        raise RuntimeError("No style in this scene; open it with 'Open style...'.")
    nodes = []
    for s in SLOTS:
        hits = slot_nodes("NR_Edit", s)
        if len(hits) != 1:
            raise RuntimeError("Need exactly one %s (found %d)." % (s, len(hits)))
        nodes.append(hits[0])
    d = out_dir or os.path.join(file_prop("nr_dir") or str(rt.getDir(rt.Name("export"))), "to-game")
    os.makedirs(d, exist_ok=True)
    out = os.path.join(d, "car-%s.fbx" % style)
    rt.FBXExporterSetParam("ResetExport")
    for k, v in FBX_EXPORT:
        rt.FBXExporterSetParam(k, v)
    was = list(rt.selection)
    rt.select(nodes)
    rt.exportFile(out, rt.Name("noPrompt"), selectedOnly=True, using=rt.FBXEXP)
    if was:
        rt.select(was)
    else:
        rt.clearSelection()
    return out


def save_work():
    style, d = file_prop("nr_style"), file_prop("nr_dir")
    if not style or not d:
        raise RuntimeError("Open a style first.")
    path = os.path.join(d, "car-%s.max" % style)
    rt.saveMaxFile(path, quiet=True)
    return path


def export_all(folder, progress=None):
    """Open every car-*.max in `folder` and export it. Returns [(file, out or error)]."""
    files = sorted(f for f in os.listdir(folder) if f.startswith("car-") and f.endswith(".max"))
    current = str(rt.maxFilePath) + str(rt.maxFileName)
    done = []
    for i, f in enumerate(files):
        if progress:
            progress(f, i, len(files))
        try:
            rt.loadMaxFile(os.path.join(folder, f), quiet=True)
            done.append((f, export_for_game(os.path.join(folder, "to-game"))))
        except Exception as e:  # one bad file must not stop the batch
            done.append((f, "FAILED: %s" % e))
    if current and os.path.exists(current):
        rt.loadMaxFile(current, quiet=True)
    return done
