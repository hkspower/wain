#!/usr/bin/env python3
"""Render the ship animation to MP4, and stills to look at.

    python3 design/ship/render_ship.py            # ship.mp4 + ship-poster.png
    python3 design/ship/render_ship.py --stills   # six frames, for looking at

Frames are pulled by index, not by letting the page play: `renderFrame(n)` is a
pure function of n, so a slow screenshot cannot drop or shift a frame — the same
reason the film renderer seeks its timeline instead of recording it.
"""

import argparse
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / "ship.mp4"))
    ap.add_argument("--stills", action="store_true")
    a = ap.parse_args()

    import imageio_ffmpeg
    from playwright.sync_api import sync_playwright

    page_file = HERE / "ship.html"
    if not page_file.exists():
        raise SystemExit("run build_ship.py first")

    W, H = 1920, 1080
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=CHROME,
                               args=["--force-color-profile=srgb",
                                     "--font-render-hinting=none",
                                     "--disable-lcd-text"])
        page = br.new_page(viewport={"width": W, "height": H},
                           device_scale_factor=1)
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(page_file.as_uri() + "?still")
        page.wait_for_timeout(400)
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(400)
        if errs:
            br.close()
            raise SystemExit("page errors: " + "; ".join(errs))

        meta = page.evaluate("window.SHIP_META")
        if not meta:
            raise SystemExit("renderFrame never loaded — the page is not the "
                             "animation")
        total = meta["frames"]
        print(f"  {total} frames · {meta['fps']}fps · {meta['total']}s"
              f" · {meta['cells']} code cells make the hull")
        if meta["cells"] < 400:
            raise SystemExit(
                f"only {meta['cells']} cells fall inside the mark — the mask is "
                "not finding the ship, and the code would assemble nothing")
        if meta.get("late"):
            raise SystemExit(
                f"{meta['late']} cells are struck outside the lock window — "
                "each is a hole in the hull that no frame ever fills")

        if a.stills:
            out = HERE / "stills"
            out.mkdir(exist_ok=True)
            for i, f in enumerate([12, 60, 130, 178, 230, 288]):
                page.evaluate("f => window.renderFrame(f)", f)
                page.screenshot(path=str(out / f"{i}-f{f:03d}.png"))
                print(f"    {i}-f{f:03d}.png   t={f/meta['fps']:.1f}s")
            br.close()
            return 0

        # Frames come back as PNG screenshots, not as canvas pixel arrays.
        # getImageData over the automation bridge means 8.3 million JSON
        # numbers per frame — correct, and slow enough to be useless.
        from io import BytesIO
        from PIL import Image

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        cmd = [exe, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
               "-s", f"{W}x{H}", "-r", str(meta["fps"]), "-i", "-", "-an",
               "-c:v", "libx264", "-preset", "slow", "-crf", "18",
               "-pix_fmt", "yuv420p", "-movflags", "+faststart", a.out]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.PIPE)
        try:
            for f in range(total):
                page.evaluate("f => window.renderFrame(f)", f)
                im = Image.open(BytesIO(page.screenshot(type="png")))
                im = im.convert("RGB")
                if im.size != (W, H):
                    raise SystemExit(f"frame {f} came back {im.size}, not "
                                     f"{(W, H)} — the video would be sheared")
                proc.stdin.write(im.tobytes())
                if f % 30 == 0:
                    print(f"      {f/meta['fps']:5.1f}s / {meta['total']}s")
            # the poster is the frame where the mark has resolved and the
            # wordmark is fully in — the one a still viewer should meet
            page.evaluate("f => window.renderFrame(f)", total - 12)
            page.screenshot(path=str(HERE / "ship-poster.png"))
        finally:
            proc.stdin.close()
            err = proc.stderr.read().decode(errors="replace")
            rc = proc.wait()
        br.close()
        if rc:
            raise SystemExit("ffmpeg failed:\n" + err[-1500:])

    mp4 = pathlib.Path(a.out)
    print(f"\n  {mp4}  ({mp4.stat().st_size/1e6:.1f} MB)")
    print(f"  {HERE / 'ship-poster.png'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
