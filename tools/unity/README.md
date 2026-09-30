# Car renders in Unity

`render-cars.sh` renders every catalogue car in a Unity (URP) studio. It is the Unity counterpart of `tools/blender/render_cars.py` and uses the same cars, the same stage and the same camera, so the two sets can be compared side by side.

## What you need

- Unity 6 LTS (any `6000.0.x`), installed through Unity Hub.
- A Unity sign-in on that machine. A free Personal license is enough; open the Hub and sign in once. Batch mode will not start without a license.
- Node and the repo's `npm install`, used for the car export and the contact sheet.

## Run

```sh
tools/unity/render-cars.sh --only black-demon   # one car first, to check the look
tools/unity/render-cars.sh                      # all 17
```

The first run opens the project, fetches URP and glTFast and imports them, which takes a few minutes. After that, each car takes seconds.

| Output | What it is |
|---|---|
| `press/unity/<id>.png` | 2560×1440, supersampled 2× plus MSAA 8× |
| `press/unity/contact-sheet.jpg` | every car in one grid (`tools/shots/render-sheet.mjs`) |
| `press/unity/unity.json` | size, seconds per car, and any failures |
| `press/unity/unity.log` | Unity's full log; the script's lines start with `[render]` |

If the GLBs in `press/renders/glb/` are missing, the script exports them from the game first with `node tools/shots/export-cars.mjs`.

## Options

- `--only a,b`: render these car ids only.
- `--force`: re-render cars even when their PNG is newer than their GLB.
- `--width`, `--height`: output size, 2560×1440 by default.
- `--supersample N`: render at N× size and filter down. The default is 2.
- `--light-scale F`: scale every light (1 by default). Lower it if the render reads hot, raise it if it reads dim.
- `--exposure EV`: post exposure in stops.
- `--flip-nose`: turn the car 180°. Use it if the camera shows the tail instead of the nose.
- `--no-mirror`: drop the floor reflection.
- `UNITY_EDITOR=/path/to/Unity`: use this editor when it isn't in a default Hub folder.

## How the studio maps across

- **Positions:** light and camera positions are taken from `render_cars.py`, converted from Blender's Z-up frame (nose toward −Y) to Unity's Y-up frame.
- **Lights:** URP has no realtime area lights, so each one becomes a soft spot light, and the long roof strip becomes five spots. An unlit panel of the same size stands in each light's place. Only the reflection probe sees these panels, so the paint still reflects the lights' shapes.
- **Floor reflection:** the car is drawn a second time, mirrored, under a floor that lets 14% of it through.
- **Tonemapping:** ACES, the same as the game and the Blender set.
- **Known difference:** glTFast's URP shaders have no clearcoat, so the paint is the base layer only. Cycles renders the coat.

## If something is off

- **"No Unity 6 editor found":** set `UNITY_EDITOR`.
- **A license error in `unity.log`:** sign in through Unity Hub once.
- **Unity asks to upgrade the project:** that is expected with a different 6000.0 patch release. Accept it.
- **A compile error, or glTFast not found:** open `tools/unity/NightRacerStudio` once in the Editor so the Package Manager resolves `Packages/manifest.json`, then run the script again.
- **The tail faces the camera:** use `--flip-nose`.
- **Too bright or too dark:** use `--light-scale` or `--exposure`.
