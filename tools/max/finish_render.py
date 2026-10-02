#!/usr/bin/env python3
"""Grade 3ds Max (or preview) renders the way the Blender studio set is graded.

    npm run max:finish -- <folder>            # e.g. press/max/render/black-demon/out
    python3 tools/max/finish_render.py <folder> [--exposure 0] [--fps 30]

<folder>/*.exr            -> <folder>/final/<name>.png   ACES view, sRGB display
<folder>/turntable/*.exr  -> <folder>/final/turntable.mp4 H.264, plus the PNG frames

The EXRs are scene-linear (Arnold's or Cycles' own numbers); the look —
ACES, exposure, sRGB — is applied here, once, the same for both, so a Max
render and a Cycles render of the pack can be compared like for like.
Needs only `pip install bpy`: Blender's colour management and its own
ffmpeg do the work.
"""
import argparse, glob, os, sys

import bpy

ap = argparse.ArgumentParser()
ap.add_argument("folder")
ap.add_argument("--exposure", type=float, default=0.0)
ap.add_argument("--fps", type=int, default=30)
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

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
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGB"
sc.render.image_settings.color_depth = "8"

final = os.path.join(args.folder, "final")
os.makedirs(final, exist_ok=True)


def grade(src, dst):
    img = bpy.data.images.load(os.path.abspath(src))
    img.save_render(os.path.abspath(dst), scene=sc)  # applies the scene's view transform
    bpy.data.images.remove(img)


stills = sorted(glob.glob(os.path.join(args.folder, "*.exr")))
for p in stills:
    dst = os.path.join(final, os.path.splitext(os.path.basename(p))[0] + ".png")
    grade(p, dst)
    print(f"[finish] {os.path.basename(p)} -> {os.path.relpath(dst)} ({sc.view_settings.view_transform})")

frames = sorted(glob.glob(os.path.join(args.folder, "turntable", "*.exr")))
if frames:
    fdir = os.path.join(final, "turntable")
    os.makedirs(fdir, exist_ok=True)
    pngs = []
    for i, p in enumerate(frames):
        dst = os.path.join(fdir, "%04d.png" % (i + 1))
        grade(p, dst)
        pngs.append(dst)
    # Encode with Blender's ffmpeg through the sequencer: no ffmpeg needed.
    img = bpy.data.images.load(os.path.abspath(pngs[0]))
    w, h = img.size
    bpy.data.images.remove(img)
    sc.sequence_editor_create()
    seq = sc.sequence_editor
    strips = getattr(seq, "strips", None) or seq.sequences
    strip = strips.new_image("tt", os.path.abspath(pngs[0]), 1, 1)
    for p in pngs[1:]:
        strip.elements.append(os.path.basename(p))
    strip.colorspace_settings.name = "sRGB"
    sc.frame_start, sc.frame_end = 1, len(pngs)
    sc.render.fps = args.fps
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    sc.view_settings.view_transform = "Standard"  # the PNGs are already graded
    sc.view_settings.exposure = 0.0
    r = sc.render
    r.image_settings.file_format = "FFMPEG"
    r.ffmpeg.format = "MPEG4"
    r.ffmpeg.codec = "H264"
    r.ffmpeg.constant_rate_factor = "HIGH"
    r.ffmpeg.ffmpeg_preset = "GOOD"
    r.ffmpeg.gopsize = args.fps
    r.use_sequencer = True
    mp4 = os.path.abspath(os.path.join(final, "turntable.mp4"))
    r.filepath = mp4
    bpy.ops.render.render(animation=True)
    got = [f for f in os.listdir(final) if f.startswith("turntable") and f.endswith(".mp4")]
    if got and got[0] != "turntable.mp4":  # Blender may append the frame range
        os.replace(os.path.join(final, got[0]), mp4)
    print(f"[finish] {len(pngs)} frames -> {os.path.relpath(mp4)} ({w}x{h}, {args.fps} fps)")

if not stills and not frames:
    sys.exit(f"no EXRs in {args.folder}")
