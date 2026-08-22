#!/usr/bin/env python3
"""Speak the film's narration with ElevenLabs, then hand it to mux.py.

    export ELEVENLABS_API_KEY=...            # never written to a file
    python3 design/film/tts_elevenlabs.py --list-voices
    python3 design/film/tts_elevenlabs.py --voice <voice_id>
    python3 design/film/mux.py design/film/voice.mp3

Stdlib only, so it runs on any machine with Python and no pip install.

The key comes from the environment and nothing here writes it anywhere: not to
a config file, not into the output, not into an error message. If the variable
is missing the script says so and stops, rather than prompting — a key typed at
a prompt ends up in shell history.

It speaks the whole narration as ONE request, not fifteen. Sentence-by-sentence
synthesis joins fifteen separate takes, and the seams are audible: each one
starts cold, ends with its own trailing silence, and drifts in pace. One
request gives the model the paragraph, which is what makes it read like
someone talking rather than a list being announced.
"""

import argparse
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
API = "https://api.elevenlabs.io/v1"


def key():
    k = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not k:
        raise SystemExit(
            "ELEVENLABS_API_KEY is not set.\n"
            "  export ELEVENLABS_API_KEY=...   then run this again.\n"
            "  (Set it in the environment, not in a file — nothing in this\n"
            "   repository should ever hold a key.)")
    return k


def call(path, data=None, headers=None, method=None):
    req = urllib.request.Request(f"{API}{path}", data=data, method=method)
    req.add_header("xi-api-key", key())
    for h, v in (headers or {}).items():
        req.add_header(h, v)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:500]
        # 401 here means the key, not the text — say which, or the next hour
        # goes into rewriting perfectly good Arabic
        raise SystemExit(f"ElevenLabs answered {e.code}: {body}")
    except urllib.error.URLError as e:
        raise SystemExit(f"cannot reach ElevenLabs: {e.reason}")


def list_voices():
    raw, _ = call("/voices")
    for v in json.loads(raw).get("voices", []):
        labels = v.get("labels") or {}
        tags = " · ".join(str(x) for x in labels.values() if x)
        print(f"  {v['voice_id']}  {v.get('name','?'):<22} {tags}")
    print("\n  Pick one that actually speaks Arabic — an English voice reading")
    print("  Arabic text is the single most common way this goes wrong.")


def speak(voice, model, out):
    text = (HERE / "narration-plain.txt").read_text().strip()
    total = json.loads((HERE / "narration.json").read_text())["total"]
    words = len(text.split())
    print(f"  {words} words, {len(text)} characters")
    print(f"  the picture is {total:.0f}s — aim for a delivery close to that")

    body = json.dumps({
        "text": text,
        "model_id": model,
        # Deliberate settings, not defaults. Stability high because this is a
        # corporate read that must not wander in tone between scenes; style at
        # zero because a performance fights the plain sentences; speaker boost
        # on because the film is watched on phone speakers.
        "voice_settings": {"stability": 0.55, "similarity_boost": 0.8,
                           "style": 0.0, "use_speaker_boost": True},
    }).encode()

    audio, _ = call(f"/text-to-speech/{voice}",
                    data=body,
                    headers={"Content-Type": "application/json",
                             "Accept": "audio/mpeg"},
                    method="POST")
    if len(audio) < 20000:
        raise SystemExit(f"the reply was only {len(audio)} bytes — not audio")
    pathlib.Path(out).write_bytes(audio)
    print(f"\n  {out}  ({len(audio)/1e6:.1f} MB)")
    print(f"  next:  python3 design/film/mux.py {out}")
    print("  mux.py refuses if it is more than 2s off the picture.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", help="voice_id from --list-voices")
    ap.add_argument("--model", default="eleven_multilingual_v2",
                    help="a multilingual model — the English-only ones "
                         "mangle Arabic")
    ap.add_argument("--out", default=str(HERE / "voice.mp3"))
    ap.add_argument("--list-voices", action="store_true")
    a = ap.parse_args()

    if a.list_voices:
        list_voices()
        return 0
    if not a.voice:
        raise SystemExit("--voice is required. Run --list-voices first.")
    speak(a.voice, a.model, a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
