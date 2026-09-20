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

    meas = json.loads((HERE / "voice" / "durations.json").read_text())
    takes = []
    for i, ln in enumerate(lines, 1):
        p = HERE / "voice" / f"line{i:02d}.mp3"
        if not p.exists():
            raise SystemExit(f"missing take: {p}")
        m = meas[str(i)]
        takes.append((p, ln["start"], m["gain_db"], m["head"]))

    args = [exe, "-y"]
    for p, *_ in takes:
        args += ["-i", str(p)]

    # adelay wants milliseconds, and one value per channel — the takes are
    # mono, but stating both is harmless and survives a stereo take later.
    parts, labels = [], []
    for i, (_, start, gain, head) in enumerate(takes):
        # Level first. The takes arrived spread over 4 LU, which is heard as
        # the narrator stepping nearer and further away between sentences.
        # Plain gain, measured per take by measure_voice.py: it moves the whole
        # take and leaves the reading exactly as recorded, where a compressor
        # would even out the sentence's own shape as well.
        chain = [f"volume={gain}dB"]
        # Then place it by the first word, not by the first byte. On these
        # takes head is 0 and this is a no-op; on a padded take it is the
        # difference between the voice landing on its caption and after it.
        if head > 0.02:
            chain.append(f"atrim=start={head}")
            chain.append("asetpts=PTS-STARTPTS")
        ms = int(round(start * 1000))
        chain.append(f"adelay={ms}|{ms}")
        parts.append(f"[{i}]" + ",".join(chain) + f"[a{i}]")
        labels.append(f"[a{i}]")
    # normalize=0: amix otherwise divides every input by the number of inputs,
    # so fifteen takes that never overlap would each come out at a fifteenth of
    # their level — technically mixed, inaudibly quiet.
    # apad, then -t, is what makes the track the full length of the film.
    # amix ends when its longest input ends — which is the last take, 1.4s
    # before the picture does — and -t only truncates, it never pads. Without
    # this the mux's -shortest trimmed the video instead, cutting the closing
    # fade off the end. The file looked fine; it simply stopped early.
    parts.append("".join(labels) +
                 f"amix=inputs={len(takes)}:normalize=0[mixed]")
    # A ceiling at about -2 dBFS, not -1. Lossy encoders reconstruct peaks
    # above the samples they were given, and this track is encoded twice - mp3
    # here, then AAC in the mux - so each pass needs somewhere to overshoot
    # into. Measured: a -1 dBFS ceiling came back at -0.19 dBTP after the mp3
    # alone, which leaves nothing for the second encode.
    #
    # level=disabled is not optional. alimiter normalises up to its ceiling by
    # default, so it is a loudness maximiser unless told otherwise: lowering
    # the limit from 0.89 to 0.79 made the track LOUDER, -15.3 to -14.4 LUFS,
    # undoing the levelling that is the whole point of this step. Here the
    # limiter is a safety net for stray peaks, nothing more.
    parts.append("[mixed]apad,alimiter=limit=0.79:level=disabled[mix]")
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
    g = [t[2] for t in takes]
    print(f"  levelled to -16 LUFS · gains {min(g):+.1f} to {max(g):+.1f} dB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
