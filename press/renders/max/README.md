# Every car's 3ds Max render pack, rendered at full size

The packs under `press/max/render/` (`npm run max:render-pack -- all`:
each car as the game builds it, its materials, and the Blender studio
solved for it in Max's frame) rendered at the pack's own size and graded
the way the Max side is graded — ACES, the game's exposure — so a render
of the same pack in 3ds Max with Arnold compares like for like.

- `hero/`, `side/`, `rear/` — `<car>.jpg`, 2560 x 1440, 128 samples
- `hero-sheet.jpg`, `side-sheet.jpg`, `rear-sheet.jpg` — a contact sheet per shot
- `turntables/<car>.mp4` — 120 frames, one turn, 960 x 540 at 32 samples
- `manifest.json` — which pack each came from and when, and the sizes
- `cars.json` — the catalogue the sheets are captioned from

Made by `npm run max:full` (`tools/max/full-render.sh`): fresh GLBs out of
the running game, a pack per car, Cycles standing in for Arnold, then
`tools/max/finish_render.py --publish press/renders/max`. On a machine
with 3ds Max, `tools/max/render_all.py` under `3dsmaxbatch` renders the
same packs with Arnold into each pack's `out/`, and the same finish
command publishes those here instead. `press/max/` itself is not in git:
the packs are rebuilt on demand, and this folder is what is kept.
