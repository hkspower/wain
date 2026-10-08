#!/usr/bin/env python3
"""Every render pack, rendered in 3ds Max with Arnold, from the command line.

    set NR_PACKS=C:\\wain\\press\\max\\render
    "C:\\Program Files\\Autodesk\\3ds Max 2026\\3dsmaxbatch.exe" tools\\max\\render_all.py

The same render_all the panel's "Render ALL packs in folder..." button
runs (nightracer/render.py), with the dials set for the finished set
rather than for a look: every shot, the turntable, full size, AA 6, and a
car whose EXRs are all there skipped — so a stopped night picks up where
it was. Options are environment variables, because 3dsmaxbatch has no
argv of its own and a scheduler can set them:

    NR_PACKS      the folder of packs (default: this repo's press/max/render)
    NR_SHOTS      hero,side,rear
    NR_TURNTABLE  1 (0 for stills only)
    NR_FRAMES     the turntable's frames (default: the pack's, 120)
    NR_HALF       1 for a half-size test pass
    NR_AA         Arnold camera samples, 6 (the turntable takes two fewer)
    NR_LIGHT      a scale on every light, 1.0
    NR_RERENDER   1 to render a car again even if its EXRs are all there

Arnold has to be the current renderer; it ships with 3ds Max (MAXtoA), and
this stops with a message rather than render the studio with the scanline.
Each car's EXRs land in <pack>/out/, the report in <root>/render-all.json.
Then, in the repo:  npm run max:finish -- <root> --publish press/renders/max

Without Max, tools/max/full-render.sh renders the same packs in Cycles.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))


def _flag(env, name, default):
    v = env.get(name)
    if v is None or v.strip() == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


def settings(env=None):
    """The run, read from the environment. Everything has a default; a
    value that does not parse is an error here, before any Max is opened."""
    env = os.environ if env is None else env
    shots = tuple(s.strip() for s in env.get("NR_SHOTS", "hero,side,rear").split(",") if s.strip())
    if not shots:
        raise ValueError("NR_SHOTS names no shot")
    frames = env.get("NR_FRAMES", "").strip()
    return {
        "root": env.get("NR_PACKS", "").strip() or os.path.join(REPO, "press", "max", "render"),
        "shots": shots,
        "turntable": _flag(env, "NR_TURNTABLE", True),
        "frames": int(frames) if frames else None,
        "half": _flag(env, "NR_HALF", False),
        "aa": int(env.get("NR_AA", "6") or 6),
        "light": float(env.get("NR_LIGHT", "1") or 1),
        "rerender": _flag(env, "NR_RERENDER", False),
    }


def run(root, shots, turntable, frames, half, aa, light, rerender, progress=None):
    from nightracer import render
    if not render.arnold_available():
        raise RuntimeError("Arnold is not available in this 3ds Max: install MAXtoA (it ships with Max). "
                           "Not rendering the studio with another renderer.")
    packs = render.list_packs(root)
    if not packs:
        raise RuntimeError("no render packs under %s: in the repo, npm run max:render-pack -- all" % root)
    return render.render_all(root, shots, turntable, frames, half, aa, light, not rerender, progress)


def main():
    s = settings()
    print("[render-all] %s: %s%s, %s, AA %d, lights x%.2f%s" % (
        s["root"], ", ".join(s["shots"]), " + turntable" if s["turntable"] else "",
        "half size" if s["half"] else "full size", s["aa"], s["light"],
        ", rendering every car again" if s["rerender"] else ", skipping cars already rendered"), flush=True)

    def progress(name, i, n):
        print("[render-all] %s (%d/%d)" % (name, i + 1, n), flush=True)

    report = run(s["root"], s["shots"], s["turntable"], s["frames"], s["half"], s["aa"], s["light"], s["rerender"], progress)
    for r in report:
        print("[render-all]   %-16s %s%s" % (r["id"], r["status"], " (%.0f s)" % r["seconds"] if "seconds" in r else ""), flush=True)
    failed = [r["id"] for r in report if r["status"].startswith("FAILED")]
    print("[render-all] %d cars, %d failed -> %s" % (len(report), len(failed), os.path.join(s["root"], "render-all.json")), flush=True)
    print("[render-all] grade and publish:  npm run max:finish -- \"%s\" --publish press/renders/max" % s["root"], flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    code = main()
    if code:
        raise SystemExit(code)
