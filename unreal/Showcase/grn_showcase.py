"""Build the Black Demon showcase inside the Unreal editor.

    unreal/Showcase/run.sh probe     # what this editor's Python exposes, before anything is made
    unreal/Showcase/run.sh build     # import the car, build the studio map, sequences and MRQ presets
    unreal/Showcase/run.sh report    # what build made, as press/unreal/black-demon/build.json

Run by UnrealEditor-Cmd with -ExecutePythonScript; never by plain python
(it imports `unreal`). The numbers all come from showcase_math.py, which
IS testable with plain python — this file only hands them to the engine.

HOW IT IS WRITTEN. This code has never met the engine it is written for:
the repository's machines have no Unreal, so every `unreal.*` name below
is from Epic's documentation and the 5.x Python API as remembered, not
from a run. Three habits follow from that:

  - `probe` first. It prints which classes and functions exist in THIS
    editor, so a rename shows up as a line in a table rather than as a
    traceback halfway through `build`.
  - every non-essential property goes through set_prop(), which logs a
    miss and carries on; the essential steps (the import, the mesh, the
    map, the sequences, the presets) raise, because a build without
    them is not a build.
  - nothing is assumed about how the importer turns glTF axes into
    Unreal's. A probe GLB (showcase_math.write_probe_glb) goes through
    the same pipeline first and its bounds say how, and the car is then
    imported with the yaw that puts its nose on +X, checked by its own
    bounds afterwards.

Everything it makes lives under /Game/GRN/Showcase. Delete that folder
and the project is as it was.
"""
import json
import math
import os
import sys
import tempfile
import time

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import showcase_math as sm  # noqa: E402

LOG = []
WARN = []


def log(msg):
    unreal.log(f"[showcase] {msg}")
    LOG.append(msg)


def warn(msg):
    unreal.log_warning(f"[showcase] {msg}")
    WARN.append(msg)


def set_prop(obj, name, value, essential=False):
    """Set an editor property; a miss is a warning unless essential."""
    try:
        obj.set_editor_property(name, value)
        return True
    except Exception as e:  # noqa: BLE001
        msg = f"{type(obj).__name__}.{name} = {value!r}: {e}"
        if essential:
            raise RuntimeError(msg) from e
        warn(msg)
        return False


def asset_tools():
    return unreal.AssetToolsHelpers.get_asset_tools()


def subsystem(cls):
    try:
        return unreal.get_editor_subsystem(cls)
    except Exception:  # noqa: BLE001
        return None


def save_asset(path):
    try:
        unreal.EditorAssetLibrary.save_asset(path, only_if_is_dirty=False)
    except Exception as e:  # noqa: BLE001
        warn(f"save {path}: {e}")


def ensure_dir(path):
    if not unreal.EditorAssetLibrary.does_directory_exist(path):
        unreal.EditorAssetLibrary.make_directory(path)


def vec(p):
    return unreal.Vector(float(p[0]), float(p[1]), float(p[2]))


def rot(pyr):
    pitch, yaw, roll = pyr
    return unreal.Rotator(roll=float(roll), pitch=float(pitch), yaw=float(yaw))


def lin(c, a=1.0):
    return unreal.LinearColor(float(c[0]), float(c[1]), float(c[2]), float(a))


def engine_version():
    try:
        return str(unreal.SystemLibrary.get_engine_version())
    except Exception:  # noqa: BLE001
        return "?"


# ------------------------------------------------------------------ probe

PROBE_NAMES = [
    # import
    "AssetImportTask", "InterchangeGenericAssetsPipeline", "InterchangePipelineStackOverride",
    "InterchangeManager", "ImportAssetParameters",
    # level and actors
    "LevelEditorSubsystem", "EditorActorSubsystem", "EditorLevelLibrary", "EditorAssetLibrary",
    "StaticMeshActor", "RectLight", "RectLightComponent", "CineCameraActor", "PostProcessVolume",
    "LightingChannels", "LightUnits", "ComponentMobility",
    # materials
    "MaterialEditingLibrary", "MaterialInstanceConstant", "MaterialInstanceConstantFactoryNew",
    "MaterialFactoryNew", "MaterialExpressionConstant3Vector", "MaterialExpressionConstant",
    "MaterialProperty", "MaterialShadingModel",
    # sequencer
    "LevelSequence", "LevelSequenceFactoryNew", "MovieSceneCameraCutTrack", "MovieScene3DTransformTrack",
    "MovieSceneSequenceExtensions", "MovieSceneKeyInterpolation", "SequenceTimeUnit", "FrameRate", "FrameNumber",
    # movie render queue
    "MoviePipelinePrimaryConfig", "MoviePipelineMasterConfig", "MoviePipelineDeferredPassBase",
    "MoviePipelineImageSequenceOutput_PNG", "MoviePipelineOutputSetting", "MoviePipelineAntiAliasingSetting",
    "MoviePipelineHighResSetting", "MoviePipelineConsoleVariableSetting", "MoviePipelineGameOverrideSetting",
    "MoviePipelinePythonHostExecutor", "MoviePipelineQueue", "MoviePipelineExecutorJob", "MoviePipeline",
    "AntiAliasingMethod", "DirectoryPath", "IntPoint",
    # post process
    "AutoExposureMethod", "DynamicGlobalIlluminationMethod", "ReflectionMethod",
    # the port
    "GRNShowcase",
]


def probe():
    log(f"Unreal {engine_version()}, Python {sys.version.split()[0]}")
    missing = []
    for n in PROBE_NAMES:
        have = hasattr(unreal, n)
        unreal.log(f"  {'ok     ' if have else 'MISSING'} unreal.{n}")
        if not have:
            missing.append(n)
    paint = unreal.EditorAssetLibrary.does_asset_exist(sm.PAINT_PARENT)
    unreal.log(f"  {'ok     ' if paint else 'MISSING'} {sm.PAINT_PARENT}  (GulfRoadNightsEditor builds it on first open)")
    unreal.log(f"  {'ok     ' if sm.valid_glb(sm.GLB) else 'BAD    '} {sm.GLB}")
    for cv in ("r.Substrate", "r.MegaLights.EnableForProject", "r.DynamicGlobalIlluminationMethod"):
        try:
            v = unreal.SystemLibrary.get_console_variable_int_value(cv)
            unreal.log(f"  {cv} = {v}")
        except Exception as e:  # noqa: BLE001
            unreal.log(f"  {cv}: {e}")
    if "MoviePipelinePrimaryConfig" in missing and "MoviePipelineMasterConfig" not in missing:
        log("this engine still calls the MRQ config MoviePipelineMasterConfig; build() uses whichever exists")
        missing.remove("MoviePipelinePrimaryConfig")
    if "MoviePipelineMasterConfig" in missing:
        missing.remove("MoviePipelineMasterConfig")  # the old name, expected to be gone
    if "GRNShowcase" in missing:
        warn("unreal.GRNShowcase is missing: the GulfRoadNights module did not build with GRNShowcase.cpp — the night shot needs it")
    verdict = "ready" if not [m for m in missing if m != "GRNShowcase"] else f"{len(missing)} missing"
    log(f"probe: {verdict}")
    return missing


# ----------------------------------------------------------------- import

def mrq_config_class():
    return getattr(unreal, "MoviePipelinePrimaryConfig", None) or getattr(unreal, "MoviePipelineMasterConfig")


def import_static_mesh(glb_path, dest_path, name, yaw_deg=0.0, combine=True, nanite=True):
    """One static mesh out of a glTF binary through Interchange, all its
    meshes combined, rotated by yaw_deg about Z on the way in. Returns the
    UStaticMesh. Raises if nothing came out."""
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", glb_path)
    task.set_editor_property("destination_path", dest_path)
    task.set_editor_property("destination_name", name)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    if hasattr(unreal, "InterchangeGenericAssetsPipeline"):
        pipe = unreal.InterchangeGenericAssetsPipeline()
        if yaw_deg:
            set_prop(pipe, "import_offset_rotation", unreal.Rotator(roll=0.0, pitch=0.0, yaw=float(yaw_deg)))
        try:
            mp = pipe.get_editor_property("mesh_pipeline")
            set_prop(mp, "combine_static_meshes", combine)
            set_prop(mp, "import_static_meshes", True)
            set_prop(mp, "build_nanite", nanite)
        except Exception as e:  # noqa: BLE001
            warn(f"mesh pipeline settings: {e}")
        try:
            mat = pipe.get_editor_property("material_pipeline")
            set_prop(mat, "import_materials", True)
        except Exception as e:  # noqa: BLE001
            warn(f"material pipeline settings: {e}")
        if hasattr(unreal, "InterchangePipelineStackOverride"):
            over = unreal.InterchangePipelineStackOverride()
            added = False
            for fn in ("add_python_pipeline", "add_pipeline"):
                if hasattr(over, fn):
                    try:
                        getattr(over, fn)(pipe)
                        added = True
                        break
                    except Exception as e:  # noqa: BLE001
                        warn(f"InterchangePipelineStackOverride.{fn}: {e}")
            if added:
                task.set_editor_property("options", over)
            else:
                warn("could not hand the pipeline to the import task; the project's default pipeline runs (meshes may not be combined)")
        else:
            warn("no InterchangePipelineStackOverride: the project's default pipeline runs")
    else:
        warn("no InterchangeGenericAssetsPipeline: importing with the default pipeline")
    asset_tools().import_asset_tasks([task])
    paths = [str(p) for p in task.get_editor_property("imported_object_paths")]
    meshes = []
    for p in paths:
        a = unreal.load_asset(p)
        if isinstance(a, unreal.StaticMesh):
            meshes.append(a)
    if not meshes:
        # the task may list only the package; look in the folder
        for p in unreal.EditorAssetLibrary.list_assets(dest_path, recursive=True, include_folder=False):
            a = unreal.load_asset(p)
            if isinstance(a, unreal.StaticMesh) and name.lower() in a.get_name().lower():
                meshes.append(a)
    if not meshes:
        raise RuntimeError(f"importing {glb_path} produced no static mesh (imported: {paths})")
    meshes.sort(key=lambda m: -m.get_bounds().box_extent.length())
    log(f"imported {glb_path} -> {meshes[0].get_path_name()} ({len(paths)} objects)")
    return meshes[0]


def bounds_of(mesh):
    b = mesh.get_bounds()
    o, e = b.origin, b.box_extent
    return (o.x - e.x, o.y - e.y, o.z - e.z), (o.x + e.x, o.y + e.y, o.z + e.z)


def find_axis_mapping():
    """Import the probe, read its bounds, delete it: the importer's rule."""
    tmp = os.path.join(tempfile.gettempdir(), "grn_axis_probe.glb")
    sm.write_probe_glb(tmp)
    mesh = import_static_mesh(tmp, sm.IMPORT_PATH + "/Probe", sm.PROBE_GLB_NAME, combine=True, nanite=False)
    mn, mx = bounds_of(mesh)
    mapping, scale = sm.probe_mapping(mn, mx)
    log(f"axis probe: bounds {tuple(round(v, 1) for v in mn)} .. {tuple(round(v, 1) for v in mx)} -> "
        f"glTF X,Y,Z = Unreal {[('xyz'[a], '+' if s > 0 else '-') for a, s in (mapping[0], mapping[1], mapping[2])]}, {scale:.1f} cm/m")
    try:
        unreal.EditorAssetLibrary.delete_directory(sm.IMPORT_PATH + "/Probe")
    except Exception as e:  # noqa: BLE001
        warn(f"could not delete the probe: {e}")
    return mapping, scale


def import_car(glb):
    """The Black Demon as one Nanite static mesh, nose on +X, floor at z 0."""
    mapping, scale = find_axis_mapping()
    nose_ue = sm.map_dir(mapping, glb["nose_gltf"])
    up_ue = sm.map_dir(mapping, (0, 1, 0))
    if up_ue[2] < 0.9:
        warn(f"the importer does not put glTF +Y on Unreal +Z ({up_ue}); the car may lie on its side — tell me")
    yaw = sm.yaw_to_plus_x((nose_ue[0], nose_ue[1]))
    log(f"nose in Unreal before rotation: {tuple(round(v, 3) for v in nose_ue)}; importing with yaw {yaw:+.1f}")
    mesh = import_static_mesh(sm.GLB, sm.IMPORT_PATH, "SM_BlackDemon_import", yaw_deg=yaw)
    mn, mx = bounds_of(mesh)
    L = (mx[0] - mn[0]) / 100.0
    W = (mx[1] - mn[1]) / 100.0
    baked = abs(L - 4.66) < 0.25 and W < 2.6
    if not baked:
        warn(f"after import the mesh is {L:.2f} m along X and {W:.2f} m along Y; the yaw offset was not applied by "
             f"the pipeline — the studio actor will be yawed {yaw:+.1f} instead, and the night-scene body is not X-forward")
    else:
        log(f"the mesh is {L:.2f} m along X, {W:.2f} m across: nose on +X")
    # one stable name for everything downstream
    final = sm.MERGED_MESH
    if unreal.EditorAssetLibrary.does_asset_exist(final):
        unreal.EditorAssetLibrary.delete_asset(final)
    if not unreal.EditorAssetLibrary.rename_asset(mesh.get_path_name(), final):
        warn(f"could not rename the mesh to {final}; using {mesh.get_path_name()}")
        final = mesh.get_path_name()
    mesh = unreal.load_asset(final)
    save_asset(final)
    return mesh, (0.0 if baked else yaw), (mn, mx)


def paint_slot_of(mesh):
    mats = mesh.get_editor_property("static_materials")
    for i, m in enumerate(mats):
        try:
            if str(m.get_editor_property("material_slot_name")).lower() == "paint":
                return i
        except Exception:  # noqa: BLE001
            pass
    for i, m in enumerate(mats):
        try:
            mi = m.get_editor_property("material_interface")
            if mi and "paint" in mi.get_name().lower():
                return i
        except Exception:  # noqa: BLE001
            pass
    return -1


def dress_paint(mesh, glb):
    """The port's Substrate paint on the body, with this car's numbers."""
    slot = paint_slot_of(mesh)
    if slot < 0:
        warn("no material slot called paint on the imported mesh; the body keeps the importer's material")
        return -1, False
    parent = unreal.load_asset(sm.PAINT_PARENT)
    if not parent:
        warn(f"{sm.PAINT_PARENT} is not in this project (open the editor once so GulfRoadNightsEditor builds it); "
             f"the body keeps the importer's paint for now")
        return slot, False
    if unreal.EditorAssetLibrary.does_asset_exist(sm.PAINT_MI):
        mi = unreal.load_asset(sm.PAINT_MI)
    else:
        mi = asset_tools().create_asset("MI_BlackDemonPaint", sm.CONTENT_ROOT, unreal.MaterialInstanceConstant,
                                        unreal.MaterialInstanceConstantFactoryNew())
    mel = unreal.MaterialEditingLibrary
    mel.set_material_instance_parent(mi, parent)
    pf = glb["paint"]
    mel.set_material_instance_vector_parameter_value(mi, "Color", lin(pf["color"]))
    mel.set_material_instance_scalar_parameter_value(mi, "Metalness", float(pf["metallic"]))
    mel.set_material_instance_scalar_parameter_value(mi, "BaseRoughness", float(pf["roughness"]))
    mel.set_material_instance_scalar_parameter_value(mi, "ClearCoat", float(pf["clearcoat"]))
    mel.set_material_instance_scalar_parameter_value(mi, "ClearCoatRoughness", float(pf["clearcoat_roughness"]))
    mel.update_material_instance(mi)
    save_asset(sm.PAINT_MI)
    mesh.set_material(slot, mi)
    save_asset(mesh.get_path_name())
    log(f"paint slot {slot} wears {sm.PAINT_MI}: colour {tuple(round(c, 4) for c in pf['color'])}, "
        f"metalness {pf['metallic']:.3f}, roughness {pf['roughness']}, clear coat {pf['clearcoat']} at {pf['clearcoat_roughness']}")
    return slot, True


# -------------------------------------------------------------- materials

def make_material(name, base=None, roughness=None, specular=None, emissive=None, unlit=False):
    path = f"{sm.CONTENT_ROOT}/{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    mat = asset_tools().create_asset(name, sm.CONTENT_ROOT, unreal.Material, unreal.MaterialFactoryNew())
    mel = unreal.MaterialEditingLibrary
    if unlit:
        set_prop(mat, "shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    y = -300

    def const3(value, prop):
        nonlocal y
        e = mel.create_material_expression(mat, unreal.MaterialExpressionConstant3Vector, -400, y)
        y += 200
        set_prop(e, "constant", lin(value), essential=True)
        mel.connect_material_property(e, "", prop)

    def const1(value, prop):
        nonlocal y
        e = mel.create_material_expression(mat, unreal.MaterialExpressionConstant, -400, y)
        y += 200
        set_prop(e, "r", float(value), essential=True)
        mel.connect_material_property(e, "", prop)

    MP = unreal.MaterialProperty
    if base is not None:
        const3(base, MP.MP_BASE_COLOR)
    if emissive is not None:
        const3(emissive, MP.MP_EMISSIVE_COLOR)
    if roughness is not None:
        const1(roughness, MP.MP_ROUGHNESS)
    if specular is not None:
        const1(specular, MP.MP_SPECULAR)
    mel.recompile_material(mat)
    save_asset(path)
    return mat


# ------------------------------------------------------------- the studio

def level_subsystem():
    return subsystem(unreal.LevelEditorSubsystem) if hasattr(unreal, "LevelEditorSubsystem") else None


def actor_subsystem():
    return subsystem(unreal.EditorActorSubsystem) if hasattr(unreal, "EditorActorSubsystem") else None


def new_level(path):
    ls = level_subsystem()
    if ls:
        ok = ls.new_level(path)
    else:
        ok = unreal.EditorLevelLibrary.new_level(path)
    if not ok:
        raise RuntimeError(f"could not create level {path}")
    log(f"new level {path}")


def save_level():
    ls = level_subsystem()
    if ls:
        ls.save_current_level()
    else:
        unreal.EditorLevelLibrary.save_current_level()


def spawn(cls, loc, rotation=(0, 0, 0), label=None):
    sub = actor_subsystem()
    if sub:
        a = sub.spawn_actor_from_class(cls, vec(loc), rot(rotation))
    else:
        a = unreal.EditorLevelLibrary.spawn_actor_from_class(cls, vec(loc), rot(rotation))
    if label:
        a.set_actor_label(label)
    return a


def channels(c0, c1):
    return unreal.LightingChannels(channel0=bool(c0), channel1=bool(c1), channel2=False)


def build_studio(mesh, actor_yaw, st):
    """The stage from showcase_math.studio_ue, as actors in a new map."""
    new_level(sm.STUDIO_MAP)
    plane = unreal.load_asset("/Engine/BasicShapes/Plane")
    sphere = unreal.load_asset("/Engine/BasicShapes/Sphere")
    floor_mat = make_material("M_ShowcaseFloor", base=st["floor"]["base"], roughness=st["floor"]["roughness"],
                              specular=st["floor"]["specular"])
    dome_mat = make_material("M_ShowcaseDome", emissive=st["world_grey"], unlit=True)

    # The floor: black, glossy, big; lit by channel 0 only (the Rim stays off it)
    floor = spawn(unreal.StaticMeshActor, st["floor"]["loc"], label="Floor")
    fc = floor.static_mesh_component
    fc.set_mobility(unreal.ComponentMobility.STATIC)
    fc.set_static_mesh(plane)
    s = st["floor"]["size_cm"] / 100.0  # the engine plane is 100 cm
    floor.set_actor_scale3d(unreal.Vector(s, s, 1.0))
    fc.set_material(0, floor_mat)
    set_prop(fc, "lighting_channels", channels(True, False))

    # The dome: what reflections see where there is no light; the camera does not see it
    dome = spawn(unreal.StaticMeshActor, st["pivot"], label="ReflectionDome")
    dc = dome.static_mesh_component
    dc.set_mobility(unreal.ComponentMobility.STATIC)
    dc.set_static_mesh(sphere)
    r = st["dome_radius_cm"] / 50.0  # the engine sphere is 100 cm across
    dome.set_actor_scale3d(unreal.Vector(r, r, r))
    dc.set_material(0, dome_mat)
    set_prop(dc, "cast_shadow", False)
    set_prop(dome, "hidden", True)                      # editor
    set_prop(dc, "hidden_in_game", True)                # camera
    set_prop(dc, "affect_indirect_lighting_while_hidden", True)  # Lumen still sees it
    set_prop(dc, "lighting_channels", channels(False, False))

    # The car: one Nanite mesh at the pivot, movable so the turntable can turn it
    car = spawn(unreal.StaticMeshActor, st["pivot"], (0.0, actor_yaw, 0.0), label="BlackDemon")
    cc = car.static_mesh_component
    cc.set_mobility(unreal.ComponentMobility.MOVABLE)
    cc.set_static_mesh(mesh)
    set_prop(cc, "lighting_channels", channels(True, True))

    # The five lights
    for L in st["lights"]:
        a = spawn(unreal.RectLight, L["loc"], L["rot"], label=f"Light_{L['name']}")
        lc = a.get_editor_property("rect_light_component") if hasattr(a, "rect_light_component") else a.light_component
        lc.set_mobility(unreal.ComponentMobility.MOVABLE)
        set_prop(lc, "intensity_units", unreal.LightUnits.LUMENS)
        lc.set_intensity(float(L["lumens"]))
        lc.set_light_color(lin(L["color"]))
        set_prop(lc, "source_width", float(L["source_width_cm"]))
        set_prop(lc, "source_height", float(L["source_height_cm"]))
        set_prop(lc, "barn_door_angle", float(L["barn_door_angle"]))
        set_prop(lc, "barn_door_length", float(L["barn_door_length_cm"]))
        set_prop(lc, "cast_shadows", True)
        set_prop(lc, "lighting_channels", channels(L["lights_floor"], True))

    # Exposure and Lumen, unbound
    pp = spawn(unreal.PostProcessVolume, st["pivot"], label="Look")
    set_prop(pp, "unbound", True)
    s_ = pp.get_editor_property("settings")
    for k, v in [
        ("override_auto_exposure_method", True), ("auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL),
        ("override_camera_shutter_speed", True), ("camera_shutter_speed", float(st["shutter"])),
        ("override_camera_iso", True), ("camera_iso", float(sm.CAMERA_ISO)),
        ("override_depth_of_field_fstop", True), ("depth_of_field_fstop", float(sm.CAMERA_FSTOP)),
        ("override_auto_exposure_bias", True), ("auto_exposure_bias", 0.0),
        ("override_dynamic_global_illumination_method", True),
        ("dynamic_global_illumination_method", unreal.DynamicGlobalIlluminationMethod.LUMEN),
        ("override_reflection_method", True), ("reflection_method", unreal.ReflectionMethod.LUMEN),
        ("override_lumen_final_gather_quality", True), ("lumen_final_gather_quality", 4.0),
        ("override_lumen_reflection_quality", True), ("lumen_reflection_quality", 4.0),
        ("override_motion_blur_amount", True), ("motion_blur_amount", 0.0),
        ("override_vignette_intensity", True), ("vignette_intensity", 0.0),
    ]:
        set_prop(s_, k, v)
    set_prop(pp, "settings", s_)

    # Cameras: one per shot, the Blender studio's 55 mm on a 36 mm filmback
    cams = {}
    for name, C in st["cameras"].items():
        a = spawn(unreal.CineCameraActor, C["loc"], C["rot"], label=f"Cam_{name}")
        comp = a.get_cine_camera_component()
        set_prop(comp, "current_focal_length", float(C["focal_mm"]))
        try:
            fb = comp.get_editor_property("filmback")
            set_prop(fb, "sensor_width", float(C["sensor_w_mm"]))
            set_prop(fb, "sensor_height", float(C["sensor_h_mm"]))
            set_prop(comp, "filmback", fb)
            fs = comp.get_editor_property("focus_settings")
            set_prop(fs, "focus_method", unreal.CameraFocusMethod.DISABLE)
            set_prop(comp, "focus_settings", fs)
        except Exception as e:  # noqa: BLE001
            warn(f"camera {name} filmback/focus: {e}")
        cams[name] = a
    save_level()
    log(f"studio: floor, dome, car, {len(st['lights'])} lights, {len(cams)} cameras; EV100 {st['ev100']} "
        f"(1/{st['shutter']:.0f} s at ISO {sm.CAMERA_ISO:.0f} f/{sm.CAMERA_FSTOP})")
    return car, cams


# ----------------------------------------------------------- sequences

def binding_id(seq, binding):
    ext = unreal.MovieSceneSequenceExtensions
    for fn in ("get_binding_id", "make_binding_id"):
        if hasattr(ext, fn):
            try:
                return getattr(ext, fn)(seq, binding)
            except Exception:  # noqa: BLE001
                pass
    if hasattr(binding, "get_binding_id"):
        return binding.get_binding_id()
    raise RuntimeError("cannot make a camera binding id in this engine's Python")


def add_root_track(seq, cls):
    if hasattr(seq, "add_track"):
        return seq.add_track(cls)
    return seq.add_master_track(cls)


def make_sequence(name, frames, camera=None, car=None, car_yaw0=0.0):
    path = f"{sm.SEQ_PATH}/{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    seq = asset_tools().create_asset(name, sm.SEQ_PATH, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
    fps = sm.TURNTABLE["fps"]
    seq.set_display_rate(unreal.FrameRate(fps, 1))
    seq.set_playback_start(0)
    seq.set_playback_end(frames)
    if camera is not None:
        cb = seq.add_possessable(camera)
        cut_track = add_root_track(seq, unreal.MovieSceneCameraCutTrack)
        cut = cut_track.add_section()
        cut.set_range(0, frames)
        cut.set_camera_binding_id(binding_id(seq, cb))
    if car is not None:
        bind = seq.add_possessable(car)
        tr = bind.add_track(unreal.MovieScene3DTransformTrack)
        sec = tr.add_section()
        sec.set_range(0, frames)
        chans = sec.get_all_channels()
        loc = car.get_actor_location()
        scale = car.get_actor_scale3d()
        start = [loc.x, loc.y, loc.z, 0.0, 0.0, car_yaw0, scale.x, scale.y, scale.z]
        LIN = unreal.MovieSceneKeyInterpolation.LINEAR
        unit = unreal.SequenceTimeUnit.DISPLAY_RATE
        for i, ch in enumerate(chans[:9]):
            ch.add_key(unreal.FrameNumber(0), float(start[i]), 0.0, unit, LIN)
            if i == 5:  # rotation Z: one full turn
                ch.add_key(unreal.FrameNumber(frames), float(car_yaw0 + 360.0), 0.0, unit, LIN)
    save_asset(path)
    log(f"sequence {path}: {frames} frame(s) at {fps} fps" + (", camera cut" if camera else "") + (", turntable" if car else ""))
    return seq


# ------------------------------------------------------- MRQ presets

def make_preset(name, width, height, out_sub, temporal, tiles=1, warmup=32, cvars=None):
    path = f"{sm.MRQ_PATH}/{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)
    cfg = asset_tools().create_asset(name, sm.MRQ_PATH, mrq_config_class(), None)
    out = cfg.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
    set_prop(out, "output_resolution", unreal.IntPoint(int(width), int(height)), essential=True)
    set_prop(out, "output_directory", unreal.DirectoryPath(os.path.join(sm.OUT_DIR, out_sub)), essential=True)
    set_prop(out, "file_name_format", "{sequence_name}.{frame_number}")
    set_prop(out, "use_custom_frame_rate", True)
    set_prop(out, "output_frame_rate", unreal.FrameRate(sm.TURNTABLE["fps"], 1))
    set_prop(out, "override_existing_output", True)
    set_prop(out, "zero_pad_frame_numbers", 4)
    cfg.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPassBase)
    cfg.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_PNG)
    aa = cfg.find_or_add_setting_by_class(unreal.MoviePipelineAntiAliasingSetting)
    set_prop(aa, "spatial_sample_count", 1)
    set_prop(aa, "temporal_sample_count", int(temporal))
    set_prop(aa, "override_anti_aliasing", True)
    set_prop(aa, "anti_aliasing_method", unreal.AntiAliasingMethod.AAM_NONE)
    set_prop(aa, "render_warm_up_count", int(warmup))
    set_prop(aa, "engine_warm_up_count", int(warmup))
    set_prop(aa, "render_warm_up_frames", True)
    if tiles > 1:
        hr = cfg.find_or_add_setting_by_class(unreal.MoviePipelineHighResSetting)
        set_prop(hr, "tile_count", int(tiles))
        set_prop(hr, "overlap_ratio", 0.1)
        set_prop(hr, "allocate_history_per_tile", True)
        set_prop(hr, "texture_sharpness_bias", 0.0)
    if cvars:
        cv = cfg.find_or_add_setting_by_class(unreal.MoviePipelineConsoleVariableSetting)
        if hasattr(cv, "add_or_update_console_variable"):
            for k, v in cvars.items():
                cv.add_or_update_console_variable(k, float(v))
        else:
            set_prop(cv, "console_variables", {k: float(v) for k, v in cvars.items()})
    go = cfg.find_or_add_setting_by_class(unreal.MoviePipelineGameOverrideSetting)
    set_prop(go, "cinematic_quality_settings", True)
    save_asset(path)
    log(f"preset {path}: {width}x{height}, {temporal} temporal samples, {tiles}x{tiles} tiles -> {out_sub}/")
    return cfg


# Starting points for the Mac, tuned on the first preview: Lumen at its
# quality end, reflections at full resolution, no temporal reuse because
# MRQ's own temporal samples do that job.
QUALITY_CVARS = {
    "r.Lumen.Reflections.DownsampleFactor": 1,
    "r.Lumen.Reflections.MaxRoughnessToTrace": 0.6,
    "r.Lumen.ScreenProbeGather.DownsampleFactor": 8,
    "r.Lumen.ScreenProbeGather.TracingOctahedronResolution": 16,
    "r.Lumen.Reflections.Temporal": 0,
    "r.Lumen.ScreenProbeGather.Temporal": 0,
    "r.Shadow.Virtual.ResolutionLodBiasLocal": -2,
    "r.ScreenPercentage": 100,
}


# ------------------------------------------------------------------ build

def build():
    t0 = time.time()
    if not sm.valid_glb(sm.GLB):
        raise RuntimeError(f"{sm.GLB} is not a whole glTF binary; re-copy it from press/renders/glb/")
    glb = sm.read_glb(sm.GLB)
    if not glb["nose_gltf"]:
        raise RuntimeError("the GLB's lamp nodes were not found; cannot tell its nose from its tail")
    log(f"GLB: {glb['triangles']} triangles, {len(glb['materials'])} materials, nose {tuple(round(v, 3) for v in glb['nose_gltf'])} in the file")
    for d in (sm.CONTENT_ROOT, sm.IMPORT_PATH, sm.SEQ_PATH, sm.MRQ_PATH):
        ensure_dir(d)
    os.makedirs(sm.OUT_DIR, exist_ok=True)

    mesh, actor_yaw, (mn, mx) = import_car(glb)
    paint_slot, paint_is_ports = dress_paint(mesh, glb)

    # The studio for the car's Blender-frame bounds (the pack's bounds,
    # read off the file, not off the import, so the stage never depends
    # on the importer's scale)
    st = sm.studio_ue(glb["bounds_blender"])
    car, cams = build_studio(mesh, actor_yaw, st)

    for name in ("hero", "side", "rear"):
        make_sequence(f"LS_{name}", 1, camera=cams[name])
    make_sequence("LS_turntable", sm.TURNTABLE["frames"], camera=cams["turntable"], car=car, car_yaw0=actor_yaw)
    # The night shot renders from the player's own camera, so no cut
    make_sequence("LS_night", 1)

    make_preset("MRQ_preview", sm.PREVIEW["width"], sm.PREVIEW["height"], "preview", temporal=4, warmup=16)
    make_preset("MRQ_still4k", sm.STILL["width"], sm.STILL["height"], "stills", temporal=32, tiles=sm.STILL["tiles"],
                warmup=48, cvars=QUALITY_CVARS)
    make_preset("MRQ_turntable1080", sm.TURNTABLE["width"], sm.TURNTABLE["height"], "turntable", temporal=8,
                warmup=32, cvars=QUALITY_CVARS)
    make_preset("MRQ_night", 1920, 1080, "night", temporal=32, warmup=64, cvars=QUALITY_CVARS)

    report = {
        "engine": engine_version(),
        "glb": {"triangles": glb["triangles"], "materials": glb["materials"], "paint": glb["paint"],
                "nose_gltf": glb["nose_gltf"], "bounds_blender": glb["bounds_blender"]},
        "mesh": sm.MERGED_MESH, "mesh_bounds_cm": [mn, mx], "actor_yaw": actor_yaw,
        "paint_slot": paint_slot, "paint_is_ports": paint_is_ports, "paint_param": "Color" if paint_is_ports else "None",
        "map": sm.STUDIO_MAP, "sequences": [f"{sm.SEQ_PATH}/LS_{n}" for n in ("hero", "side", "rear", "turntable", "night")],
        "presets": [f"{sm.MRQ_PATH}/MRQ_{n}" for n in ("preview", "still4k", "turntable1080", "night")],
        "studio": {"ev100": st["ev100"], "shutter": st["shutter"], "light_scale": sm.LIGHT_SCALE,
                   "lights": [{k: v for k, v in L.items()} for L in st["lights"]],
                   "cameras": st["cameras"]},
        "warnings": WARN, "log": LOG, "seconds": round(time.time() - t0, 1),
    }
    with open(os.path.join(sm.OUT_DIR, "build.json"), "w") as f:
        json.dump(report, f, indent=1, default=str)
    unreal.EditorAssetLibrary.save_directory(sm.CONTENT_ROOT, only_if_is_dirty=False, recursive=True)
    log(f"build done in {report['seconds']} s with {len(WARN)} warning(s); report at {sm.OUT_DIR}/build.json")


def report():
    p = os.path.join(sm.OUT_DIR, "build.json")
    if not os.path.exists(p):
        log("no build.json yet — run build first")
        return
    with open(p) as f:
        r = json.load(f)
    paint = "the port's Substrate paint" if r["paint_is_ports"] else "the importer's material"
    log(f"built on Unreal {r['engine']}: mesh {r['mesh']}, paint slot {r['paint_slot']} ({paint}), "
        f"{len(r['warnings'])} warning(s)")
    for w in r["warnings"]:
        unreal.log_warning(f"  {w}")


def main(argv):
    cmd = argv[0] if argv else "probe"
    try:
        if cmd == "probe":
            probe()
        elif cmd == "build":
            build()
        elif cmd == "report":
            report()
        else:
            warn(f"unknown command {cmd}; one of probe, build, report")
    except Exception as e:  # noqa: BLE001
        unreal.log_error(f"[showcase] {cmd} failed: {e}")
        import traceback
        unreal.log_error(traceback.format_exc())
    finally:
        if not os.environ.get("GRN_KEEP_EDITOR"):
            try:
                unreal.SystemLibrary.quit_editor()
            except Exception:  # noqa: BLE001
                pass


main(sys.argv[1:])
