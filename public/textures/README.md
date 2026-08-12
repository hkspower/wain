# Authored textures — the art drop-in

Every surface in Gulf Road Nights ships a procedural texture generated at
runtime, and that is what you see out of the box. Nothing here is required.

This folder is the seam for replacing any of those maps with authored
artwork — a Photoshop export, a photographic scan, a substance bake —
without touching a line of engine code.

## How to use it

1. Export your maps as PNG into this folder.
2. Create `manifest.json` naming them:

```json
{
  "road": {
    "map": "asphalt-albedo.png",
    "normalMap": "asphalt-normal.png",
    "roughnessMap": "asphalt-roughness.png"
  }
}
```

3. Reload. The maps replace the procedural ones at boot.

Every key is optional: supply only a roughness map and the procedural
colour and normals stay. Delete `manifest.json` and the game reverts to
fully procedural with a single 404 and no other requests.

Surfaces currently registered: `road`.

## Authoring requirements

**The textures must tile seamlessly.** The road repeats roughly every
14 metres over a 7.3 km lap; a visible seam becomes a rung on a ladder.
Use Photoshop's *Filter → Other → Offset* with wrap-around to check.

**Square power-of-two, 1024×1024 or 2048×2048.** The procedural originals
are 1024². Larger costs VRAM on the 30-car traffic scene for detail no one
reads at 200 km/h.

**Colour space matters, and getting it wrong is not subtle.** The albedo is
sRGB. The normal and roughness maps are *data* and are loaded linear. If a
roughness map is tagged sRGB, mid-grey samples as ~0.21 instead of 0.5 and
the road turns into a black mirror under the sodium lamps — this project
has shipped that bug once already. Export data maps without an embedded
colour profile.

**Roughness convention:** black is a mirror, white is matte. Tire-polished
wheel tracks belong darker than the coarse aggregate between them; that
contrast is what makes the streetlights smear along the lane.

**Normal maps are OpenGL convention** (+Y up). If your bake looks lit from
the wrong side, invert the green channel.

## Notes

Files here are served as static assets, so they are also included in the
static export the Electron/Steam shell loads — a packaged build carries its
own copy with no server involved.

Keep an eye on repository size: these are binaries, and a 2048² PNG set
runs several megabytes.
