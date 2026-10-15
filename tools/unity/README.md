# Car stills in Unity

`render-cars.sh` renders every catalogue car inside the game's own Unity project, `unity/`, with the game's own car code. The cars are loaded by `CarLibrary.LoadNow`, exactly as the game loads them: the prefab baked into `unity/Assets/Resources/Cars` when there is one, otherwise the GLB, built by `CarModel` and painted by `CarMaterials`. The studio code is in `unity/Assets/Editor/Studio/`. It runs in edit mode and never enters Play, so the game itself never starts.

There are two sets:

- **studio** is the Blender studio (`tools/blender/studio.py`) rebuilt in URP. It is the Unity counterpart of `tools/blender/render_cars.py`, with the same five lights, the same floor and the same camera, so a Unity render and a Cycles render of one car can be compared side by side.
- **street** is each car parked on the game's own night Gulf Road, as the player meets it, in three shots: hero, side and rear.

## What the street set shows

- **The world:** the world is built by `WorldBuilder`, as in the game. That means the road and rails, the sodium lamps and their coronas, the moon, the fog and the landmarks.
- **Reflections:** `NightReflections.Install()` makes the game's night sky the reflection source. The camera clears to the game's night colour.
- **Where the car stands:** the car is in the player's lane (`TrackSpline.Lanes[1]`). It is parked 3 m short of the lit street lamp nearest 160 m along the lap: the corniche just past the Kuwait Towers. The lamp is found among the scene's lights after the build, so the spot follows whatever the world does with its lamps. The camera stands on the lamp's side, so the flank it sees is the lit one.
- **Lights on the car:** the car gets the two lights `GameController` gives the player: the headlight and the warm rim light behind the roof. Its tail lamps sit at idle and its contact shadow stays on.
- **Reflection probe:** the reflection probe is the game's own (`NightReflections.Follow`: size, clip planes, intensity, and a culling mask that leaves out cars and coronas), at 1024 px. It is baked once at the spot, before any car is placed. The cars are not in it, so one bake serves them all.
- **Grade:** the grade is the game's `GulfRoadPostProfile` on a global volume, with motion blur turned off, since a still has no motion.
- **Rails:** if a long car's side shot would put the camera behind the guard rail, the lens widens until the camera fits inside it. Each shot records its lens in `unity.json`.

## What you need

- **The Unity editor named in `unity/ProjectSettings/ProjectVersion.txt`** (6000.0.32f1), installed through Unity Hub. Another 6000.0 patch also works: batch mode upgrades the project quietly.
- **A Unity sign-in on the machine.** Open Unity Hub once and sign in. A free Personal licence is enough. Batch mode will not start without a licence.
- **Node and the repo's `npm install`.** These are used for the car export and the contact sheets.
- **The cars**, in any of these forms:
  - baked into the project: run **Night Racer ▸ Bake Cars to Assets** in the Editor;
  - copied with `npm run sync:unity-cars`;
  - the export itself, in `press/renders/glb/`.

  If a car is missing from all three, the script exports it from the running game. See [Getting the cars](#getting-the-cars).

## Run it on a Mac

1. Install Unity Hub. Sign in, then install the editor version named in `unity/ProjectSettings/ProjectVersion.txt`. The script finds it at:

   ```
   /Applications/Unity/Hub/Editor/6000.0.32f1/Unity.app/Contents/MacOS/Unity
   ```

   If it is anywhere else, point at it:

   ```sh
   export UNITY_EDITOR="/path/to/Unity.app/Contents/MacOS/Unity"
   ```

2. Close the project in the Editor if it is open. Batch mode refuses a project that another Unity instance has open.
3. From the repo:

   ```sh
   tools/unity/render-cars.sh --only black-demon   # one car, both sets, to check the look
   tools/unity/render-cars.sh                      # all 17, both sets
   tools/unity/render-cars.sh --mode street        # the street set only
   ```

The first run imports the project and URP, which takes a few minutes. If no URP asset is assigned yet, the run then goes through **Night Racer ▸ Setup Rendering** (`RenderSetup.Setup`). After that, each car takes seconds per still.

You can also render from the Editor. Use **Night Racer ▸ Render Car Stills (Studio)** or **Night Racer ▸ Render Car Stills (Night Street)**. The menu renders every car regardless of file dates, shows a progress bar you can cancel, and puts your open scenes back afterwards.

## Outputs

| Output | What it is |
|---|---|
| `press/unity/<id>.png` | studio still, 2560×1440, supersampled 2× plus MSAA (up to 8×, as many as the GPU has) |
| `press/unity/street/<id>-hero.png` | street, three-quarter front, a little below the beltline |
| `press/unity/street/<id>-side.png` | street, the flank square on |
| `press/unity/street/<id>-rear.png` | street, three-quarter rear |
| `press/unity/contact-sheet.jpg` | every studio still in one grid (`tools/shots/render-sheet.mjs`) |
| `press/unity/street/contact-sheet.jpg` | every street hero shot in one grid |
| `press/unity/unity.json` | see below |
| `press/unity/unity.log` | Unity's full log (git-ignored); the script's lines start with `[render]` |

For each car and set, `unity.json` records:

- the seconds it took;
- each shot's lens, MSAA, clipped-pixel share and median luma;
- any failures.

It is merged by car and set, so a `--only` run or a one-set run keeps the rest. Unity exits with 1 if any car failed, or 2 on bad arguments.

## Options

**Both sets:**

- `--mode studio|street|both`: which set to render. The default is `both`.
- `--only a,b`: render these car ids only. An unknown id exits 2.
- `--force`: re-render even when the stills are newer than the car's prefab or GLB.
- `--out DIR`: write somewhere other than `press/unity`.
- `--width`, `--height`: output size. The default is 2560×1440.
- `--supersample 1|2|4`: render at N× the size, then halve down to it. The default is 2.
- `--msaa N`: MSAA samples on the render target. The default is 8, capped at what the GPU supports.
- `UNITY_EDITOR=/path/to/Unity`: use this editor.

**Studio only:**

- `--exposure EV`: the post exposure. The default is +0.737, `studio.py`'s `GAME_EXPOSURE_EV`. It puts URP's ACES at the game's white level, as it does for Blender's.
- `--light-scale F`: scale every studio light. Lower it if the render reads hot, raise it if it reads dim.
- `--no-mirror`: drop the floor reflection.
- `--flip-nose`: turn the car 180°. It should never be needed: the reader keeps the nose on +Z.

**Street only:**

- `--street-s M`: put the car at the lit lamp nearest M metres along the lap. The default is 160.
- `--lane N`: which lane to park in, 0 to 3. The default is 1, the player's.
- `--street-exposure EV`: added to the game profile's own post exposure.

## How the studio maps across

- **Positions:** every light and camera position comes from `studio.py`. Each is converted from Blender's Z-up frame (nose toward −Y) to the car's Unity frame (nose +Z).
- **Lights:** URP has no realtime area lights, so each area light is a soft spot of the same colour and relative power. The long roof strip is a row of five spots. Blender watts become URP intensity as P / π².
- **Light shapes in the paint:** an unlit panel of each light's size and radiance stands in the light's place. Only the reflection probe sees the panels, so the paint still reflects the lights' shapes.
- **The rim light and the floor:** the rim light does not light the floor, as in `studio.py`. URP rendering layers do this, the way light linking does it in Blender.
- **Floor reflection:** the car is drawn a second time, mirrored, under a floor that lets 14% of it through. Mirrored twins of the lights light the mirrored car.
- **Materials:** the paint, glass and lamps are the game's. That is URP Complex Lit with the clear coat, premultiplied glass, and the real emissive strengths.

## How it is drawn

- **Render calls:** every frame is a synchronous `RenderPipeline.SubmitRenderRequest`. The batch run therefore passes `-quit`.
- **Anti-aliasing:** MSAA is set on the target texture, which is where URP takes it from. Each still is drawn at 2× its size and halved through exact 2×2 boxes in linear light.
- **Reflection probes:** probes are baked with `Lightmapping.BakeReflectionProbe` into `unity/Assets/StudioCache/`. The run deletes that folder when it ends.
- **Pipeline:** the studio set draws with its own in-memory URP asset: Forward+, an 8K soft-shadow atlas, rendering layers on. The street set draws with an in-memory copy of the game's asset with 64-bit HDR. The game's `GulfRoadURP.asset` is never edited.

## Getting the cars

The GLBs are git-ignored, so a fresh clone has none. They come out of the running game. The script runs the export itself when a car is missing, but the dev server has to be up first.

```sh
npm install
npm run dev                                   # in another terminal; the export drives http://localhost:3000
npm run cars:export                           # press/renders/glb/<id>.glb and press/renders/cars.json
```

The export also needs a Chromium-family browser. It finds Chrome, Chromium or Edge in `/Applications`, and Playwright's own builds. For a browser anywhere else, set `CHROME_PATH`:

```sh
CHROME_PATH="/Applications/Google Chrome.app" npm run cars:export
```

## If something is off

- **"No Unity … editor found":** install the version in `ProjectVersion.txt`, or set `UNITY_EDITOR`.
- **A licence error in `unity.log`:** sign in through Unity Hub once.
- **"another Unity instance is running":** close the project in the Editor.
- **A compile error in `unity.log`:** open `unity/` once in the Editor and read the Console. The script prints the first errors it finds in the log.
- **"no baked prefab and no GLB":** follow [Getting the cars](#getting-the-cars).
- **"probe: … failed" in `unity.json`:** the stills were drawn without the probe. The paint then reflects only the night sky (street) or nothing (studio). The log says why.
- **Too bright or too dark:** use `--exposure` or `--light-scale` for the studio set, and `--street-exposure` for the street set.
