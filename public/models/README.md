# Authored 3D models

The cars in Gulf Road Nights are built from primitives at runtime by
`src/game/cars.ts`, which stays the shipping default. This folder is where
authored geometry goes when you want to replace one.

Models are **generated, not committed** — `.glb` files are build output.
Run the Blender script and the file lands here:

```bash
pip install bpy                                   # Blender as a Python module
python3 tools/blender/build_car.py --out public/models/efreet-rx.glb
```

No Blender GUI and no `.blend` file are involved: the mesh is defined in
Python, so the model is reviewable and diffable like the rest of the
project, and regenerating it is deterministic.

## What the script produces

`tools/blender/build_car.py` extrudes the same FD-style side profile used
by `rx7BodyGeo` in `src/game/cars.ts`, then solidifies and
subdivision-smooths it, so the export reads as the same car the procedural
factory builds rather than a different vehicle. Current output is about
1,100 triangles in 55 KB.

It exports **geometry only** (`export_materials="NONE"`). The game owns
paint, glass, tail-lamp emission and the live reflection probe, so baked
materials would fight the garage's respray and the brake-light flare.

## Node naming is the contract

The engine drives parts of the car by name, so the export uses fixed node
names:

| Node | Used for |
| --- | --- |
| `Body` | Main shell — receives the paint material and the reflection probe |
| `Canopy` | Glasshouse — receives the glass material |
| `WheelFL` `WheelFR` `WheelRL` `WheelRR` | Spun by road speed; the front pair also steers |

Renaming these silently breaks wheel spin, so keep them if you author a
replacement in the Blender GUI or another DCC tool.

## Status

The pipeline produces valid, verified glTF 2.0. Wiring a `.glb` in as the
drivable player car is the remaining step — it needs the loaded nodes
mapped onto the rig hooks the engine expects (`userData.wheels`,
`bodyMat`, `tailMat`, `tailGlowMats`), which is why the names above are
fixed now.
