#!/usr/bin/env python3
"""Measure the narration takes: where the speech actually is, and how loud.

    python3 design/film/measure_voice.py

Writes design/film/voice/durations.json — the one measured source that both
build_film.py (which times the picture) and assemble_voice.py (which places and
levels the takes) read. Measuring twice is how a picture ends up timed to one
number and an audio track built from another.

LOUDNESS is the reason this exists. The takes came back spread over 4.0 LU:
line08 at -18.4 LUFS against line03 at -14.4. That is plainly audible line to
line, and no amount of care in the writing survives a narrator who seems to
step nearer the microphone and then further away. Each take gets the gain that
brings it to -16 LUFS — plain gain, not compression, because these are clean
single-voice recordings with nothing to tame; gain moves the whole take and
leaves the performance exactly as it was recorded.

SPEECH, NOT FILE is measured too, though on these takes it changes nothing:
every one of the fifteen starts and ends on speech, with no padding. It is here
because a padded take is invisible in every other check — the picture gets
timed to the file, and a caption sits over dead air for as long as the padding
lasts. Worth knowing before it happens rather than after.

A correction, recorded because I published the claim before checking it: I
first reported line06 as 4.49s of file holding 2.78s of speech. It is not. The
silence I found at 2.78s ends 0.086s later and the sentence continues — it is a
pause mid-line. My throwaway script had assumed any silence in the back half
ran to the end of the file. The take is fine; the measurement was not.
"""

import json
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
VOICE = HERE / "voice"
TARGET_LUFS = -16.0     # speech-led content on the streaming platforms
SILENCE_DB = -40        # below this is silence, for onset detection
MIN_SILENCE = 0.08      # shorter than this is a breath, not a gap


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def analyse(exe, path):
    r = subprocess.run(
        [exe, "-i", str(path),
         "-af", f"silencedetect=n={SILENCE_DB}dB:d={MIN_SILENCE},"
                "loudnorm=print_format=json",
         "-f", "null", "-"],
        capture_output=True, text=True).stderr

    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", r)
    if not m:
        raise SystemExit(f"cannot read {path}")
    h, mnt, s = m.groups()
    file_len = int(h) * 3600 + int(mnt) * 60 + float(s)

    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r)]
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r)]
    # a silence that ends before any silence begins was at the head
    head = ends[0] if ends and (not starts or ends[0] <= starts[0]) else 0.0
    # a silence that begins in the back half and never ends was at the tail
    tail = (file_len - starts[-1]) if starts and len(starts) > len(ends) else 0.0

    lj = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r, re.S)
    lufs = float(json.loads(lj.group(0))["input_i"]) if lj else TARGET_LUFS

    return {
        "file": round(file_len, 3),
        "head": round(head, 3),                       # silence before the words
        "speech": round(file_len - head - tail, 3),   # the words themselves
        "lufs": round(lufs, 2),
        "gain_db": round(TARGET_LUFS - lufs, 2),
    }


def main():
    exe = ffmpeg()
    takes = sorted(VOICE.glob("line*.mp3"))
    if not takes:
        raise SystemExit(f"no takes in {VOICE}")

    out = {}
    print(f"{'take':<8}{'file':>8}{'speech':>9}{'head':>7}{'LUFS':>9}{'gain':>8}")
    for p in takes:
        a = analyse(exe, p)
        out[str(int(p.stem[4:]))] = a
        flag = "  ← trailing silence" if a["file"] - a["speech"] - a["head"] > 0.4 else ""
        print(f"{p.stem:<8}{a['file']:>7.2f}s{a['speech']:>8.2f}s"
              f"{a['head']:>6.2f}s{a['lufs']:>8.1f}{a['gain_db']:>+7.1f}{flag}")

    (VOICE / "durations.json").write_text(
        json.dumps(out, indent=1, ensure_ascii=False) + "\n")

    lu = [v["lufs"] for v in out.values()]
    print(f"\n  loudness spread before levelling: {max(lu)-min(lu):.1f} LU")
    print(f"  every take will be brought to {TARGET_LUFS:.0f} LUFS")
    print(f"  wrote {VOICE / 'durations.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
