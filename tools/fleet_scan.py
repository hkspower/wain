#!/usr/bin/env python3
"""Scan every car in the catalogue into one file: the fleet infographic's data.

    python3 tools/fleet_scan.py            # -> press/infographic/fleet-scan.json

Nothing in it is typed in. Each car is read from four places the game and
its pipelines already write, and the file says which number came from
where:

  press/cars/cars.json          the showroom record (tools/shots/cars.mjs,
                                from the game's own catalogue): name, class,
                                price, top speed, 0-100, power, grip, brakes,
                                tank, drive, engine, kit, finish, the factory
                                build, the description
  press/data/game-data.json     the engine table (tools/game-data.mjs)
  press/renders/cars.json       the export record (tools/shots/export-cars.mjs):
                                body style, exhaust, racing number
  press/renders/glb/<id>.glb    the car as the game builds it, measured:
                                width, height and length over everything,
                                triangles, materials, lamps, the paint's
                                clear coat — read with the Unreal kit's own
                                GLB reader (unreal/Showcase/showcase_math.py)

and points at the car's renders: the 3ds Max render pack rendered at full
size (press/max/render/<id>/preview/final/, graded) and, once published,
press/renders/max/<shot>/<id>.jpg.

The derived columns (ranks, kilowatts-free ratios) are computed here, from
the numbers above, so the infographic draws them and does not do sums.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(REPO, "unreal", "Showcase"))
import showcase_math as sm  # noqa: E402

OUT = os.path.join(REPO, "press", "infographic", "fleet-scan.json")


def load(rel):
    with open(os.path.join(REPO, rel)) as f:
        return json.load(f)


def main():
    show = load("press/cars/cars.json")
    game = load("press/data/game-data.json")
    exp = load("press/renders/cars.json")
    exp = {c["id"]: c for c in (exp if isinstance(exp, list) else exp["cars"])}
    engines = {e["id"]: e for e in game["engines"]}
    rivals = game.get("rivals", [])

    cars = []
    for rec in show:
        cid = rec["id"]
        glb_path = os.path.join(REPO, "press", "renders", "glb", f"{cid}.glb")
        scan = None
        if os.path.exists(glb_path):
            g = sm.read_glb(glb_path)
            (x0, y0, z0), (x1, y1, z1) = g["bounds_gltf"]
            scan = {
                "file": os.path.relpath(glb_path, REPO),
                "bytes": os.path.getsize(glb_path),
                "widthM": round(x1 - x0, 3),
                "heightM": round(y1 - y0, 3),
                "lengthM": round(z1 - z0, 3),
                "triangles": g["triangles"],
                "materials": len(g["materials"]),
                "headLampNodes": g["head_lamp_nodes"],
                "tailLampNodes": g["tail_lamp_nodes"],
                "paint": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in (g["paint"] or {}).items()
                          if k in ("metallic", "roughness", "clearcoat", "clearcoat_roughness")},
                "extensions": g["extensions"],
            }
        renders = {}
        for shot in ("hero", "side", "rear"):
            png = os.path.join(REPO, "press", "max", "render", cid, "preview", "final", f"{shot}.png")
            jpg = os.path.join(REPO, "press", "renders", "max", shot, f"{cid}.jpg")
            renders[shot] = {
                "graded": os.path.relpath(png, REPO) if os.path.exists(png) else None,
                "published": os.path.relpath(jpg, REPO) if os.path.exists(jpg) else None,
            }
        e = engines.get(rec.get("engine"))
        x = exp.get(cid, {})
        rival = next((r for r in rivals if r.get("carId") == cid), None)
        cars.append({
            "id": cid,
            "name": rec["name"],
            "ar": rec.get("arabicName"),
            "cls": rec.get("cls"),
            "classLabel": rec.get("classLabel"),
            "price": rec.get("price"),
            "topSpeedKmh": rec.get("topSpeedKmh"),
            "zeroTo100s": rec.get("zeroTo100s"),
            "power": rec.get("power"),
            "grip": rec.get("grip"),
            "brake": rec.get("brake"),
            "tankLitres": rec.get("tankLitres"),
            "cardLengthM": rec.get("lengthM"),
            "drive": rec.get("drive"),
            "color": rec.get("color"),
            "finish": rec.get("finish"),
            "bodyStyle": rec.get("bodyStyle") or x.get("style"),
            "kit": rec.get("kit") or x.get("kit"),
            "rims": rec.get("rims"),
            "livery": rec.get("livery"),
            "wheels": 3 if rec.get("trike") else 4,
            "factoryBuild": rec.get("factoryBuild", []),
            "lockedRivals": rec.get("lockedRivals"),
            "lockedCar": rec.get("lockedCar"),
            "desc": rec.get("desc"),
            "engine": e and {"id": e["id"], "name": e["name"], "ar": e.get("ar"), "cylinders": e["cylinders"],
                             "layout": e["layout"], "litres": e["litres"], "redlineRpm": e["redlineRpm"]},
            "exhaust": x.get("exhaust") and {k: x["exhaust"][k] for k in ("id", "tips", "shape", "finish") if k in x["exhaust"]},
            "stickerNumber": x.get("stickerNumber"),
            "rival": rival and {"name": rival["name"], "ar": rival.get("ar"), "order": rival["order"], "crew": rival.get("crew")},
            "scan": scan,
            "renders": renders,
        })

    # Ranks, 1 = best: fastest, quickest, most powerful, grippiest,
    # strongest brakes, dearest. Ties share a rank.
    def rank(key, reverse=True):
        vals = sorted({c[key] for c in cars if c[key] is not None}, reverse=reverse)
        for c in cars:
            c.setdefault("rank", {})[key] = (vals.index(c[key]) + 1) if c[key] is not None else None
    rank("topSpeedKmh")
    rank("zeroTo100s", reverse=False)
    rank("power")
    rank("grip")
    rank("brake")
    rank("price")

    measured = [c for c in cars if c["scan"]]
    fleet = {
        "cars": len(cars),
        "scanned": len(measured),
        "classes": sorted({c["cls"] for c in cars}),
        "priceRange": [min(c["price"] for c in cars), max(c["price"] for c in cars)],
        "topSpeedRange": [min(c["topSpeedKmh"] for c in cars), max(c["topSpeedKmh"] for c in cars)],
        "zeroTo100Range": [min(c["zeroTo100s"] for c in cars), max(c["zeroTo100s"] for c in cars)],
        "triangles": sum(c["scan"]["triangles"] for c in measured),
        "glbBytes": sum(c["scan"]["bytes"] for c in measured),
        "rendersGraded": sum(1 for c in cars for s in c["renders"].values() if s["graded"]),
        "rendersPublished": sum(1 for c in cars for s in c["renders"].values() if s["published"]),
        "drive": {d: sum(1 for c in cars if c["drive"] == d) for d in sorted({c["drive"] for c in cars})},
        "engines": sorted({c["engine"]["id"] for c in cars if c["engine"]}),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({"fleet": fleet, "cars": cars, "sources": {
            "record": "press/cars/cars.json", "engines": "press/data/game-data.json",
            "export": "press/renders/cars.json", "glb": "press/renders/glb/<id>.glb",
            "renders": "press/max/render/<id>/preview/final/<shot>.png -> press/renders/max/<shot>/<id>.jpg",
        }}, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"{len(cars)} cars, {len(measured)} measured from their GLB, "
          f"{fleet['rendersGraded']} graded renders, {fleet['rendersPublished']} published -> {os.path.relpath(OUT, REPO)}")
    for c in cars:
        s = c["scan"]
        print(f"  {c['id']:16s} {c['cls']:9s} {c['topSpeedKmh']:3d} km/h  {c['zeroTo100s']:4.1f} s  "
              f"{c['price']:>7,d} KD  " + (f"{s['lengthM']:.2f} x {s['widthM']:.2f} x {s['heightM']:.2f} m  {s['triangles']:,} tris" if s else "no GLB"))


if __name__ == "__main__":
    main()
