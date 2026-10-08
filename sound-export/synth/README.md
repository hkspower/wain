# synth — the sounds the game makes itself, rendered

`../sfx`, `../music` and `../voices` are the ElevenLabs renders. This folder is
the other half of the game's audio: the thirty-two sounds `src/game/sound.ts`
synthesises live in Web Audio — the engine, the tyres, every one-shot and
sting — captured from the running game by `tools/shots/render-sounds.mjs`.

    npm run dev
    node tools/shots/render-sounds.mjs                 # all of them, here
    ONLY="bump hard,horn" node tools/shots/render-sounds.mjs

Each file is 16-bit stereo WAV at the browser's rate (`index.json` says
which, 48 kHz on the machine that made these), tapped from the engine's
own output — after the limiter and the ceiling, which is what leaves the
speakers — through an AudioWorklet, so nothing is dropped while the page
is busy drawing. The window of each file is cut by the audio clock's frame
count, not by wall time.

Two kinds, rendered differently:

- **One-shots** (18): fired once into a standing car with the engine bed
  turned down, so a file holds the effect and its room tail and not an
  idle engine under it. `rev-start` is the exception — it IS the engine —
  and is rendered with the bed up.
- **Held voices** (14): the whole car at that state, four seconds —
  engine on song, on the limiter, the skid, wheelspin, boost, nitrous,
  rain, the tunnel, a rival alongside, the sea.

`index.json` carries each file's length, peak and RMS at the output. The
levels are the game's own mix; nothing is normalised. These are not what
the game plays back — it synthesises them each time — they are the
catalogue made listenable, for judging the mix and for anyone who wants
the sounds outside the game.
