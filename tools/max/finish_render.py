#!/usr/bin/env python3
"""Grade 3ds Max (or preview) renders the way the Blender studio set is graded.

    npm run max:finish -- <folder>                 # one car: e.g. press/max/render/black-demon/out
    npm run max:finish -- press/max/render         # every pack: each <car>/out
    npm run max:finish -- press/max/render --from preview   # every pack's Cycles preview instead
    python3 tools/max/finish_render.py <folder> [--exposure 0] [--fps 30]

One car's folder:
  <folder>/*.exr            -> <folder>/final/<name>.png   ACES view, sRGB display
  <folder>/turntable/*.exr  -> <folder>/final/turntable.mp4 H.264, plus the PNG frames

A folder of packs (it has packs.json, or subfolders with studio.json):
  each <car>/<from>/ as above, then
  <root>/final-<from>/<shot>/<car>.png    every car's still, per shot
  <root>/final-<from>/<shot>-sheet.jpg    a contact sheet per shot (tools/shots/render-sheet.mjs)
  <root>/final-<from>/turntables/<car>.mp4

The EXRs are scene-linear (Arnold's or Cycles' own numbers); the look —
ACES, exposure, sRGB — is applied here, once, the same for both, so a Max
render and a Cycles render of the pack can be compared like for like.
Needs only `pip install bpy` (and node, for the sheets).
"""
import argparse, glob, json, os, shutil, subprocess, sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "blender"))
import version as _version  # noqa: E402

_version.require()

ap = argparse.ArgumentParser()
ap.add_argument("folder")
# Default: the exposure that makes Blender's ACES 1.3 view equal the
# game's three.js ACESFilmic (tools/blender/studio.py, GAME_EXPOSURE_EV).
ap.add_argument("--exposure", type=float, default=0.737)
ap.add_argument("--fps", type=int, default=30)
ap.add_argument("--from", dest="src", default="out", help="in a folder of packs: which subfolder to grade (out | preview)")
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def graded_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    for vt in ("ACES 1.3", "Khronos PBR Neutral", "Standard"):
        try:
            sc.view_settings.view_transform = vt
            break
        except TypeError:
            continue
    sc.view_settings.look = "None"
    sc.view_settings.exposure = args.exposure
    sc.display_settings.display_device = "sRGB"
    s = sc.render.image_settings
    s.file_format, s.color_mode, s.color_depth = "PNG", "RGB", "8"
    return sc


def grade(sc, src, dst):
    img = bpy.data.images.load(os.path.abspath(src))
    img.save_render(os.path.abspath(dst), scene=sc)  # applies the scene's view transform
    bpy.data.images.remove(img)


def encode(sc, pngs, mp4):
    """Blender's own ffmpeg, through the sequencer: no ffmpeg needed."""
    img = bpy.data.images.load(os.path.abspath(pngs[0]))
    w, h = img.size
    bpy.data.images.remove(img)
    sc.sequence_editor_create()
    seq = sc.sequence_editor
    strip = seq.strips.new_image("tt", os.path.abspath(pngs[0]), 1, 1)
    for p in pngs[1:]:
        strip.elements.append(os.path.basename(p))
    strip.colorspace_settings.name = "sRGB"
    sc.frame_start, sc.frame_end = 1, len(pngs)
    sc.render.fps = args.fps
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    sc.view_settings.view_transform = "Standard"  # the PNGs are already graded
    sc.view_settings.exposure = 0.0
    r = sc.render
    r.image_settings.media_type = "VIDEO"  # Blender 5: pick video before the format
    r.image_settings.file_format = "FFMPEG"
    r.ffmpeg.format = "MPEG4"
    r.ffmpeg.codec = "H264"
    r.ffmpeg.constant_rate_factor = "HIGH"
    r.ffmpeg.ffmpeg_preset = "GOOD"
    r.ffmpeg.gopsize = args.fps
    r.use_sequencer = True
    d = os.path.dirname(os.path.abspath(mp4))
    before = set(os.listdir(d))
    r.filepath = os.path.abspath(mp4)
    bpy.ops.render.render(animation=True)
    new = [f for f in os.listdir(d) if f not in before and f.endswith(".mp4")]
    if not os.path.exists(mp4) and new:  # Blender may append the frame range
        os.replace(os.path.join(d, new[0]), mp4)
    return w, h


def finish(folder):
    """One car's EXRs -> graded PNGs and the turntable MP4. Returns what it made."""
    final = os.path.join(folder, "final")
    os.makedirs(final, exist_ok=True)
    sc = graded_scene()
    made = {"stills": {}, "mp4": None}
    for p in sorted(glob.glob(os.path.join(folder, "*.exr"))):
        name = os.path.splitext(os.path.basename(p))[0]
        dst = os.path.join(final, name + ".png")
        grade(sc, p, dst)
        made["stills"][name] = dst
        print(f"[finish] {os.path.relpath(p)} -> {os.path.relpath(dst)} ({sc.view_settings.view_transform})")
    frames = sorted(glob.glob(os.path.join(folder, "turntable", "*.exr")))
    if frames:
        fdir = os.path.join(final, "turntable")
        os.makedirs(fdir, exist_ok=True)
        pngs = []
        for i, p in enumerate(frames):
            dst = os.path.join(fdir, "%04d.png" % (i + 1))
            grade(sc, p, dst)
            pngs.append(dst)
        mp4 = os.path.join(final, "turntable.mp4")
        if os.path.exists(mp4):
            os.remove(mp4)
        w, h = encode(sc, pngs, mp4)
        made["mp4"] = mp4
        print(f"[finish] {len(pngs)} frames -> {os.path.relpath(mp4)} ({w}x{h}, {args.fps} fps)")
    return made


def packs_in(root):
    index = os.path.join(root, "packs.json")
    if os.path.exists(index):
        return [c["id"] for c in json.load(open(index))["cars"]]
    return sorted(d for d in os.listdir(root) if os.path.exists(os.path.join(root, d, "studio.json")))


def main():
    root = args.folder
    cars = packs_in(root) if os.path.isdir(root) else []
    if not cars:
        made = finish(root)
        if not made["stills"] and not made["mp4"]:
            sys.exit(f"no EXRs in {root}")
        return
    collect = os.path.join(root, "final-" + args.src)
    by_shot, mp4s, missing = {}, 0, []
    for car in cars:
        folder = os.path.join(root, car, args.src)
        if not glob.glob(os.path.join(folder, "*.exr")) and not glob.glob(os.path.join(folder, "turntable", "*.exr")):
            missing.append(car)
            continue
        made = finish(folder)
        for shot, png in made["stills"].items():
            d = os.path.join(collect, shot)
            os.makedirs(d, exist_ok=True)
            shutil.copyfile(png, os.path.join(d, f"{car}.png"))
            by_shot.setdefault(shot, []).append(car)
        if made["mp4"]:
            d = os.path.join(collect, "turntables")
            os.makedirs(d, exist_ok=True)
            shutil.copyfile(made["mp4"], os.path.join(d, f"{car}.mp4"))
            mp4s += 1
    # Contact sheets, one per shot, with the same tool as the studio set's.
    cars_json = os.path.join(REPO, "press", "renders", "cars.json")
    for shot, ids in by_shot.items():
        d = os.path.join(collect, shot)
        if os.path.exists(cars_json):
            shutil.copyfile(cars_json, os.path.join(d, "cars.json"))
        try:
            subprocess.run(["node", os.path.join(REPO, "tools", "shots", "render-sheet.mjs"), d,
                            os.path.join(collect, f"{shot}-sheet.jpg")], check=True, cwd=REPO)
        except (OSError, subprocess.CalledProcessError) as e:
            print(f"[finish] no contact sheet for {shot} ({e}); the PNGs are in {d}")
    print(f"[finish] {len(cars) - len(missing)} cars graded, {mp4s} turntables -> {collect}")
    if missing:
        print(f"[finish] nothing to grade yet for: {', '.join(missing)}")


main()
