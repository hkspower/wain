#!/usr/bin/env python3
"""Lay the fifteen narration takes onto one track, each at its own timecode.

    python3 design/film/assemble_voice.py

Reads design/film/voice/line01.mp3 … line15.mp3 and narration.json, and writes
design/film/voice.mp3 — one track the length of the film, silent except where
someone is speaking.

Why per-line takes rather than one long read: the captions are burned into the
picture at fixed times. A single continuous reading drifts against them within
a few sentences, and by the end it is speaking one sentence while the screen
shows another. Placing each take at its caption's own start keeps them locked
together for the whole film, and the seams that usually argue against splitting
a read do not exist here — every line is separated from the next by silence
anyway.

Nothing is stretched or pitch-shifted to fit. build_film.py has already re-timed
the picture to these recordings; this only places them.
"""

import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent


def main():
    import imageio_ffmpeg
    exe = imageio_ffmpeg.get_ffmpeg_exe()

    meta = json.loads((HERE / "narration.json").read_text())
    lines, total = meta["lines"], meta["total"]

    takes = []
    for i, ln in enumerate(lines, 1):
        p = HERE / "voice" / f"line{i:02d}.mp3"
        if not p.exists():
            raise SystemExit(f"missing take: {p}")
        takes.append((p, ln["start"]))

    args = [exe, "-y"]
    for p, _ in takes:
        args += ["-i", str(p)]

    # adelay wants milliseconds, and one value per channel — the takes are
    # mono, but stating both is harmless and survives a stereo take later.
    parts, labels = [], []
    for i, (_, start) in enumerate(takes):
        ms = int(round(start * 1000))
        parts.append(f"[{i}]adelay={ms}|{ms}[a{i}]")
        labels.append(f"[a{i}]")
    # normalize=0: amix otherwise divides every input by the number of inputs,
    # so fifteen takes that never overlap would each come out at a fifteenth of
    # their level — technically mixed, inaudibly quiet.
    parts.append("".join(labels) +
                 f"amix=inputs={len(takes)}:normalize=0[mix]")
    args += ["-filter_complex", ";".join(parts),
             "-map", "[mix]", "-t", f"{total}",
             "-c:a", "libmp3lame", "-b:a", "192k",
             str(HERE / "voice.mp3")]

    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-2000:])
        raise SystemExit("ffmpeg failed")

    out = HERE / "voice.mp3"
    print(f"  {out}  ({out.stat().st_size/1e6:.1f} MB, {total:.2f}s)")
    speaking = sum(ln["end"] - ln["start"] for ln in lines)
    print(f"  {len(takes)} takes · speaking {speaking:.1f}s of {total:.1f}s"
          f" ({speaking/total*100:.0f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
