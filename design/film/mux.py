#!/usr/bin/env python3
"""Put a narration track onto the rendered film.

    python3 design/film/mux.py voice.mp3
    python3 design/film/mux.py voice.wav --out /tmp/film-with-voice.mp4

The video is copied, not re-encoded — muxing audio onto a finished picture
should not cost it a generation of quality.

It refuses when the narration and the picture are more than two seconds apart.
A track that runs long ends on nothing; one that runs short leaves the last
scenes silent. Neither is visible while scrubbing, and both are obvious to the
first person who watches it through — which is the wrong place to find out.
"""

import argparse
import json
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
TOLERANCE = 2.0


def duration(exe, path):
    """Seconds, read from ffmpeg's own report — no ffprobe in the wheel."""
    out = subprocess.run([exe, "-i", str(path)], capture_output=True,
                         text=True).stderr
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", out)
    if not m:
        raise SystemExit(f"cannot read the duration of {path}")
    h, mnt, s = m.groups()
    return int(h) * 3600 + int(mnt) * 60 + float(s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--video", default=str(HERE / "nokhatha-film.mp4"))
    ap.add_argument("--out", default=str(HERE / "nokhatha-film-voice.mp4"))
    ap.add_argument("--force", action="store_true",
                    help="mux even when the lengths disagree")
    a = ap.parse_args()

    import imageio_ffmpeg
    exe = imageio_ffmpeg.get_ffmpeg_exe()

    for p in (a.audio, a.video):
        if not pathlib.Path(p).exists():
            raise SystemExit(f"missing: {p}")

    want = json.loads((HERE / "narration.json").read_text())["total"]
    vid = duration(exe, a.video)
    aud = duration(exe, a.audio)
    print(f"  picture   {vid:6.2f}s   (timeline says {want:.2f}s)")
    print(f"  narration {aud:6.2f}s")

    if abs(aud - vid) > TOLERANCE and not a.force:
        longer = "longer than" if aud > vid else "shorter than"
        raise SystemExit(
            f"\n  the narration is {abs(aud-vid):.1f}s {longer} the picture.\n"
            f"  Re-record closer to {vid:.0f}s, or re-time the film in\n"
            f"  build_film.py so the two agree. --force muxes anyway.")

    cmd = [exe, "-y", "-i", a.video, "-i", a.audio,
           "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
           "-map", "0:v:0", "-map", "1:a:0", "-shortest",
           "-movflags", "+faststart", a.out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-1500:])
        raise SystemExit("ffmpeg failed")
    size = pathlib.Path(a.out).stat().st_size
    print(f"\n  {a.out}  ({size/1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
