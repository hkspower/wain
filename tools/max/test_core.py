#!/usr/bin/env python3
"""Hold tools/max/nightracer/core.py to the game's own code.

    npm run test:max-core

The 3ds Max panel judges a shell with core.py; the game judges it with
crownShell (src/game/cars.ts), shellFit (src/game/models.ts) and
scripts/check-shell-mirror.mjs. This runs all of them on every shipped
shell and fails on any disagreement:

  crown   core.crown against crownShell's output, vertex by vertex
          (tools/max/procedural.mjs --dump): under 0.01 mm
  fit     core.shell_fit (crowned shipped shell against the game's own
          procedural one) against check-shell-fit --json: box and skin
          within 0.1 mm, and the same verdict
  mirror  core.mirror_report against check-shell-mirror.mjs: the same
          twin share to 0.1 % and the same open and over-shared edge counts

and, with --loft DIR, also judges freshly lofted shells (DIR/car-<style>.glb
from tools/blender/build_assets.py) the same way, which is what the panel's
"Replace with Envelope" fix relies on.
"""
import json, os, re, struct, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from nightracer import core  # noqa: E402
from nightracer.glb import read_glb  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
os.chdir(ROOT)
STYLES = ["sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super", "suv"]
TS = ["node", "--experimental-strip-types", "--no-warnings", "--import", "./tools/parity/ts-resolve.mjs"]


def main():
    loft = sys.argv[sys.argv.index("--loft") + 1] if "--loft" in sys.argv else None
    fails = []
    dump = tempfile.mkdtemp(prefix="max-core-")
    tgt = tempfile.mkdtemp(prefix="max-target-")
    subprocess.run(TS + ["tools/max/procedural.mjs", "--out", tgt, "--dump", dump], check=True, stdout=subprocess.DEVNULL)

    # --- crown parity
    worst_crown = 0.0
    for style in STYLES:
        info = json.load(open(os.path.join(tgt, f"car-{style}.nr.json")))
        shipped = read_glb(f"public/models/car-{style}.glb")
        for slot in core.SLOTS:
            raw = os.path.join(dump, f"{style}-{slot}-raw.f32")
            if not os.path.exists(raw):
                continue
            js_raw = list(struct.unpack(f"<{os.path.getsize(raw) // 4}f", open(raw, "rb").read()))
            js_crowned = open(os.path.join(dump, f"{style}-{slot}-crowned.f32"), "rb").read()
            js_crowned = struct.unpack(f"<{len(js_crowned) // 4}f", js_crowned)
            mine = core.crown(js_raw, info["slots"][slot]["crown"])
            d = max(abs(a - b) for a, b in zip(mine, js_crowned))
            worst_crown = max(worst_crown, d)
            if d > 1e-5:
                fails.append(f"crown {style} {slot}: {d * 1000:.4f} mm from crownShell")
            # The dumped raw positions must be the shipped file's, or the
            # comparison above is of nothing.
            pos = shipped[slot][0]
            if len(pos) == len(js_raw):
                dd = max(abs(a - b) for a, b in zip(pos, js_raw))
                if dd > 1e-6:
                    fails.append(f"reader {style} {slot}: positions differ from three.js by {dd}")
    print(f"crown   worst vertex difference from crownShell: {worst_crown * 1000:.5f} mm")

    # --- fit parity, and mirror parity
    def judge_dir(files, label):
        ref = subprocess.run(TS + ["scripts/check-shell-fit.mjs", "--json"] + files, capture_output=True, text=True)
        ref = {os.path.basename(f["file"]): f for f in json.loads(ref.stdout)["files"]}
        worst = 0.0
        for f in files:
            style = re.match(r"car-(.+)\.glb", os.path.basename(f)).group(1)
            info = json.load(open(os.path.join(tgt, f"car-{style}.nr.json")))
            target = read_glb(os.path.join(tgt, f"car-{style}-target.glb"))
            mine_glb = read_glb(f)
            for slot in core.SLOTS:
                r = ref[os.path.basename(f)]["slots"].get(slot)
                if not r or "box" not in r:
                    continue
                pos, tri = mine_glb[slot]
                tp, tt = target[f"target_{slot}"]
                fit = core.shell_fit(core.crown(pos, info["slots"][slot]["crown"]), tri, tp, tt, info["tolerance"])
                db = abs(fit["box"] - r["box"])
                ds = 0.0 if (fit["skin"] is None and r["skin"] is None) else abs((fit["skin"] or 0) - (r["skin"] or 0))
                worst = max(worst, db, ds)
                line = (f"{label:6} {style:7} {slot:6} box {fit['box'] * 1000:6.1f} mm (js {r['box'] * 1000:6.1f})  "
                        f"skin {'--' if fit['skin'] is None else '%.1f' % (fit['skin'] * 1000):>5} "
                        f"(js {'--' if r['skin'] is None else '%.1f' % (r['skin'] * 1000)})  {'ok' if fit['ok'] else 'REJECTED'}")
                print(line)
                if db > 1e-4 or ds > 1e-4 or fit["ok"] != r["ok"]:
                    fails.append(f"fit {label} {style} {slot}: python {fit} vs js box {r['box']} skin {r['skin']} ok {r['ok']}")
        return worst

    w = judge_dir([f"public/models/car-{s}.glb" for s in STYLES], "fit")
    print(f"fit     worst difference from shellFit: {w * 1000:.3f} mm")

    ref = subprocess.run(["node", "scripts/check-shell-mirror.mjs"], capture_output=True, text=True).stdout
    rows = re.findall(r"(car-\S+\.glb)\s+(\w+)\s+([\d.]+)%\s+(\d+)\s+\((\d+) across the seam\)\s+open\s+(\d+)\s+over\s+(\d+)", ref)
    if len(rows) != 27:
        fails.append(f"mirror: expected 27 rows from check-shell-mirror.mjs, parsed {len(rows)}")
    for f, part, share, tris, straddle, open_, over in rows:
        pos, tri = read_glb(f"public/models/{f}")[part.lower()]
        m = core.mirror_report(pos, tri)
        same = abs(m["share"] * 100 - float(share)) <= 0.1 and m["open"] == int(open_) and m["over"] == int(over) \
            and m["straddle"] == int(straddle) and m["tris"] == int(tris)
        if not same:
            fails.append(f"mirror {f} {part}: python {m} vs js share {share} straddle {straddle} open {open_} over {over}")
    print(f"mirror  {len(rows)} shells compared with check-shell-mirror.mjs")

    if loft:
        files = sorted(os.path.join(loft, x) for x in os.listdir(loft) if re.match(r"car-.+\.glb$", x))
        judge_dir(files, "loft")

    if fails:
        print(f"\n{len(fails)} disagreement(s):")
        for f in fails:
            print("  - " + f)
        sys.exit(1)
    print("\ncore.py agrees with the game on the crown, the fit and the mirror check")


main()
