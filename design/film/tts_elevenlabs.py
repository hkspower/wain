#!/usr/bin/env python3
"""Record the narration with ElevenLabs — every line, ready for the pipeline.

    export ELEVENLABS_API_KEY=...              # never written to a file
    python3 design/film/tts_elevenlabs.py --list-voices
    python3 design/film/tts_elevenlabs.py                  # record every line
    python3 design/film/tts_elevenlabs.py --lines 15,16    # just these
    python3 design/film/measure_voice.py                   # then measure
    python3 design/film/build_film.py                      # time the picture
    python3 design/film/assemble_voice.py                  # level and place
    python3 design/film/render.py && python3 design/film/mux.py design/film/voice.mp3

Writes design/film/voice/lineNN.mp3 — the names the rest of the pipeline reads.

Stdlib only, so it runs on any machine with Python and nothing installed.

THE SAME CALL THE OFFICIAL SDK MAKES. `pip install elevenlabs` would give you
client.text_to_speech.convert(text=…, voice_id=…, model_id=…,
output_format=…); this sends exactly those four to the same endpoint, and adds
voice_settings, which the SDK's own example leaves at its defaults and this
film should not. The SDK is not used because it is a dependency to install for
no behaviour this needs, and "nothing to install" is what makes this route the
one that still works when the connector does not.

WHY THIS EXISTS ALONGSIDE THE CONNECTOR. The claude.ai ElevenLabs connector
can do this too, when it happens to be switched on for a chat. It is switched
on per chat, and it went away twice mid-project — once when the container
restarted — each time stranding the film one recording short of finished. This
route depends on nothing but a key and a network, so it cannot be taken away
between one turn and the next.

ONE TAKE PER LINE, not one long read. The captions are burned into the picture
at fixed times; a single continuous reading drifts against them within a few
sentences and by the end is speaking one line under another's caption. Each
take is placed at its own caption's start, so they stay locked for the whole
film. The usual objection to splitting a read — audible seams — does not apply
when every line is separated from the next by silence anyway.

The key comes from the environment and is written nowhere: not to a config
file, not into the output, not into an error message. A missing key stops the
script rather than prompting for one, because a key typed at a prompt lands in
the shell's history.
"""

import argparse
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
VOICE = HERE / "voice"
API = "https://api.elevenlabs.io/v1"

# "صوت رجل عربي شبابي", Modern Standard Arabic — the voice the owner asked for.
# Recorded in voice.md; change both together or the note stops being true.
DEFAULT_VOICE = "SeP2zIpx6zw2aAs6ZXFW"
DEFAULT_MODEL = "eleven_multilingual_v2"

# Pinned, not left to the default. Every take is mixed into one track, and
# ffmpeg will silently resample a take that disagrees with its neighbours —
# so the format is stated rather than inherited from whatever the endpoint
# decides today. 44.1kHz/128k is what the official SDK example uses, and it
# survives the two lossy encodes this audio goes through (mp3 here, AAC in
# the mux) without adding a third resampling step.
DEFAULT_FORMAT = "mp3_44100_128"


def key():
    k = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not k:
        raise SystemExit(
            "ELEVENLABS_API_KEY is not set.\n"
            "  export ELEVENLABS_API_KEY=...   then run this again.\n"
            "  (Set it in the environment, not in a file — nothing in this\n"
            "   repository should ever hold a key.)")
    return k


# Retried, because a batch is sixteen calls and a rate limit on the ninth
# should not end the run. Only on the codes that mean "try again" — a 401 or a
# 422 will say the same thing however many times it is asked, and retrying
# those just turns a clear error into a slow one.
RETRY_ON = {429, 500, 502, 503, 504}
ATTEMPTS = 4


def call(path, data=None, headers=None, method=None, timeout=180):
    for attempt in range(1, ATTEMPTS + 1):
        req = urllib.request.Request(f"{API}{path}", data=data, method=method)
        req.add_header("xi-api-key", key())
        for h, v in (headers or {}).items():
            req.add_header(h, v)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:400]
            if e.code in RETRY_ON and attempt < ATTEMPTS:
                # honour Retry-After when the server sends one; it knows
                wait = float(e.headers.get("Retry-After") or 0) or 2 ** attempt
                print(f"    {e.code} — waiting {wait:.0f}s, attempt "
                      f"{attempt + 1} of {ATTEMPTS}")
                time.sleep(wait)
                continue
            # 401 is the key, 422 is the request, 429 is the quota. Say which,
            # or the next hour goes into rewriting perfectly good Arabic.
            raise SystemExit(f"ElevenLabs answered {e.code}: {body}")
        except urllib.error.URLError as e:
            if attempt < ATTEMPTS:
                print(f"    network: {e.reason} — retrying")
                time.sleep(2 ** attempt)
                continue
            raise SystemExit(f"cannot reach ElevenLabs: {e.reason}")


def list_voices():
    for v in json.loads(call("/voices")).get("voices", []):
        labels = v.get("labels") or {}
        tags = " · ".join(str(x) for x in labels.values() if x)
        mark = "  ← default" if v["voice_id"] == DEFAULT_VOICE else ""
        print(f"  {v['voice_id']}  {v.get('name','?'):<34} {tags}{mark}")
    print("\n  Pick one that actually speaks Arabic. An English voice reading")
    print("  Arabic text is the single most common way this goes wrong, and")
    print("  the multilingual model does not save you from it.")


def say(text, voice, model, fmt):
    body = json.dumps({
        "text": text,
        "model_id": model,
        # Deliberate, not defaults. Stability high because this is a corporate
        # read that must not wander in tone from line to line — the takes are
        # recorded separately and heard consecutively. Style at zero because a
        # performance fights these plain sentences. Speaker boost on because
        # the film is watched on phone speakers.
        #
        # Level is NOT set here, because it cannot be: the API gives no
        # loudness target, and the first fifteen takes came back spread over
        # 4 LU. measure_voice.py measures each one and assemble_voice.py
        # applies the gain. Do not try to fix loudness by re-recording.
        "voice_settings": {"stability": 0.55, "similarity_boost": 0.8,
                           "style": 0.0, "use_speaker_boost": True},
    }).encode()
    return call(f"/text-to-speech/{voice}?output_format={fmt}", data=body,
                headers={"Content-Type": "application/json",
                         "Accept": "audio/mpeg"}, method="POST")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default=DEFAULT_VOICE)
    ap.add_argument("--model", default=DEFAULT_MODEL,
                    help="a multilingual model — English-only ones mangle Arabic")
    ap.add_argument("--format", default=DEFAULT_FORMAT,
                    help="output_format; keep every take the same or the mix "
                         "resamples them against each other")
    ap.add_argument("--lines", default="",
                    help="comma-separated line numbers; default is all of them")
    ap.add_argument("--force", action="store_true",
                    help="re-record lines that already have a take")
    ap.add_argument("--list-voices", action="store_true")
    a = ap.parse_args()

    if a.list_voices:
        list_voices()
        return 0

    lines = [ln["text"] for ln in
             json.loads((HERE / "narration.json").read_text())["lines"]]
    wanted = ([int(x) for x in a.lines.split(",") if x.strip()]
              if a.lines else list(range(1, len(lines) + 1)))
    bad = [n for n in wanted if not 1 <= n <= len(lines)]
    if bad:
        raise SystemExit(f"no such line(s): {bad} — the script has {len(lines)}")

    VOICE.mkdir(exist_ok=True)
    todo = [n for n in wanted
            if a.force or not (VOICE / f"line{n:02d}.mp3").exists()]
    skipped = sorted(set(wanted) - set(todo))
    if skipped:
        print(f"  already recorded, left alone: {skipped}")
        print("  (--force re-records them; every re-recording is a different")
        print("   reading, so re-record a line only when its words changed)")
    if not todo:
        print("\n  nothing to record.")
        return 0

    print(f"\n  recording {len(todo)} line(s) · voice {a.voice}"
          f" · {a.model} · {a.format}\n")
    for n in todo:
        text = lines[n - 1]
        audio = say(text, a.voice, a.model, a.format)
        if len(audio) < 8000:
            raise SystemExit(f"line {n}: reply was {len(audio)} bytes, not audio")
        out = VOICE / f"line{n:02d}.mp3"
        out.write_bytes(audio)
        print(f"  line{n:02d}  {len(audio)/1000:6.0f} KB   {text[:52]}")
        time.sleep(0.3)          # do not hammer the endpoint

    print("\n  next:  python3 design/film/measure_voice.py")
    print("         python3 design/film/build_film.py")
    print("         python3 design/film/assemble_voice.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
