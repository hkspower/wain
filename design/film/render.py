#!/usr/bin/env python3
"""Render the النوخذة film page to an MP4.

    python3 design/film/render.py              # 1920×1080, 30fps
    python3 design/film/render.py --fps 25 --scale .5 --out /tmp/draft.mp4
    python3 design/film/render.py --stills     # one PNG per scene, to look at

Seeks rather than records. Every animation on the page runs once on one
timeline; this sets `currentTime` on all of them, screenshots, and steps on.
So a frame takes exactly as long as it takes — a slow screenshot cannot drop
a frame, a fast machine cannot double one, and the same second is the same
pixels every run. Recording a page in real time gives you none of that.

Frames go straight into ffmpeg over a pipe: 81 seconds at 30fps is 2,430
frames, and writing them out first would be a gigabyte of PNGs to read back.
ffmpeg comes from the `imageio-ffmpeg` wheel, so there is nothing to install
with a package manager.

The film has no voice track. Nothing in this container can synthesise Arabic
speech — the voice models live on hosts the network policy refuses — so the
narration ships as text and timecodes beside the video, and `voice.md` sets
out the two ways to add it. Silence is stated, never disguised: the caption
band carries every line, so the film says what it means with the sound off.
"""

import argparse
import io
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent

SEEK = """(t) => {
  // Seek every animation on the page to the same instant. Not just the ones
  // that have started: an animation whose delay has not elapsed still exists,
  // and skipping it leaves the element at its default rather than at its
  // fill-mode 'both' start state.
  const anims = document.getAnimations();
  for (const a of anims) {
    try { a.pause(); a.currentTime = t; } catch (e) {}
  }
  return anims.length;
}"""


FITS = """() => {
  // A scene that overflows is clipped by the caption band and by the frame,
  // and nothing in a screenshot says so — the card just ends. So measure:
  // the union of a scene's children against the box it is allowed to use.
  const cap = document.querySelector('.cap').getBoundingClientRect().height;
  const out = [];
  for (const sc of document.querySelectorAll('.sc')) {
    const cs = getComputedStyle(sc);
    const padT = parseFloat(cs.paddingTop), padB = parseFloat(cs.paddingBottom);
    const safe = 1080 - padT - Math.max(padB, cap);
    let top = Infinity, bot = -Infinity;
    for (const el of sc.children) {
      const r = el.getBoundingClientRect();
      if (!r.height) continue;
      top = Math.min(top, r.top); bot = Math.max(bot, r.bottom);
    }
    if (!isFinite(top)) continue;
    const h = Math.round(bot - top);
    if (h > safe) out.push({scene: sc.dataset.scene, h,
                            safe: Math.round(safe), over: Math.round(h - safe)});
  }
  return out;
}"""


def frames(page, total, fps, w, h):
    from PIL import Image
    n = int(round(total * fps))
    for i in range(n):
        page.evaluate(SEEK, i * 1000.0 / fps)
        shot = page.screenshot(type="png")
        img = Image.open(io.BytesIO(shot)).convert("RGB")
        if img.size != (w, h):
            img = img.resize((w, h), Image.LANCZOS)
        yield img.tobytes()
        if i % (fps * 5) == 0:
            print(f"    {i/fps:5.1f}s / {total:.0f}s", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--out", default=str(HERE / "nokhatha-film.mp4"))
    ap.add_argument("--stills", action="store_true",
                    help="one PNG per scene instead of a video — for looking at")
    a = ap.parse_args()

    import imageio_ffmpeg
    from playwright.sync_api import sync_playwright

    film = HERE / "film.html"
    if not film.exists():
        raise SystemExit("run build_film.py first")
    meta = json.loads((HERE / "narration.json").read_text())
    total = meta["total"]
    w, h = int(1920 * a.scale), int(1080 * a.scale)
    if w % 2 or h % 2:                       # H.264 wants even dimensions
        w, h = w - w % 2, h - h % 2

    with sync_playwright() as p:
        br = p.chromium.launch(
            executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
            args=["--force-color-profile=srgb", "--font-render-hinting=none",
                  "--disable-lcd-text"])
        page = br.new_page(viewport={"width": 1920, "height": 1080},
                           device_scale_factor=1)
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(film.as_uri())
        page.wait_for_timeout(600)
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(400)

        count = page.evaluate(SEEK, 0)
        print(f"  {count} animations on one timeline, {total}s")
        if count == 0:
            raise SystemExit("no animations found — the page is not the film")

        if a.stills:
            out = HERE / "stills"
            out.mkdir(exist_ok=True)
            # the middle of each scene, where it is fully drawn
            marks = {}
            for ln in meta["lines"]:
                marks.setdefault(ln["scene"], []).append(ln)
            for i, (scene, lines) in enumerate(marks.items()):
                # the middle of a caption line, never the gap between two —
                # that gap is a crossfade, and a still shot there shows a
                # half-faded band and reads as a bug in the film
                ln = lines[len(lines) // 2]
                t = (ln["start"] + ln["end"]) / 2
                page.evaluate(SEEK, t * 1000)
                page.screenshot(path=str(out / f"{i:02d}-{scene}.png"))
                print(f"    {i:02d}-{scene}.png  at {t:.1f}s")
            over = page.evaluate(FITS)
            print()
            for o in over:
                print(f"    OVERFLOW  {o['scene']}: content {o['h']}px in "
                      f"{o['safe']}px of safe area ({o['over']}px past)")
            if not over:
                print("    every scene fits inside the safe area")
            br.close()
            if errs:
                print("  page errors:", errs)
            return 1 if over else 0

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        cmd = [exe, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
               "-s", f"{w}x{h}", "-r", str(a.fps), "-i", "-",
               "-an",
               "-c:v", "libx264", "-preset", "slow", "-crf", "18",
               "-pix_fmt", "yuv420p", "-movflags", "+faststart",
               a.out]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.PIPE)
        try:
            for buf in frames(page, total, a.fps, w, h):
                proc.stdin.write(buf)
        finally:
            proc.stdin.close()
            err = proc.stderr.read().decode(errors="replace")
            rc = proc.wait()
        br.close()

    if rc != 0:
        print(err[-2000:])
        raise SystemExit(f"ffmpeg failed ({rc})")
    if errs:
        print("  page errors:", errs)
    size = pathlib.Path(a.out).stat().st_size
    print(f"\n  {a.out}")
    print(f"  {w}×{h} · {a.fps}fps · {total}s · {size/1e6:.1f} MB · no audio")
    print("  narration: design/film/narration-ar.txt + narration.srt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
