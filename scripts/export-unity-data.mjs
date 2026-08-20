#!/usr/bin/env node
// Regenerates unity/Assets/Scripts/GRNData.cs from the web build's
// TypeScript — the single source of truth for track geometry, the rival
// roster, the showroom and the handling constants.
//
//   node scripts/export-unity-data.mjs
//   npm run sync:unity
//
// This is the Unity twin of scripts/export-unreal-data.mjs. It exists for
// the same reason: the Unity port's roster used to be hand-copied, and it
// had silently fallen six rivals and a whole showroom behind the game.
// Hand-maintained duplicates of game data always rot — generate them.

import { readFileSync, writeFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
// Strip comments first: a ')' or a quote inside one would derail the
// brace-walking and the field regexes below.
const strip = (s) => s.replace(/\/\/[^\n]*/g, "");
const trackTs = strip(read("src/game/track.ts"));
const rivalsTs = strip(read("src/game/rivals.ts"));
const modsTs = strip(read("src/game/mods.ts"));
const handlingTs = strip(read("src/game/handling.ts"));
const enginesTs = strip(read("src/game/engines.ts"));

// ---------------------------------------------------------------- track
const cpBlock = trackTs.match(/const CONTROL_POINTS[^=]*=\s*\[([^;]*)\];/s)[1];
const points = [...cpBlock.matchAll(/\[\s*(-?\d+)\s*,\s*0\s*,\s*(-?\d+)\s*\]/g)].map(
  ([, x, z]) => ({ x: +x, z: +z })
);
if (points.length < 10) throw new Error("track parse failed");
const roadHalf = +trackTs.match(/ROAD_HALF_WIDTH\s*=\s*([\d.]+)/)[1];
const lanes = trackTs
  .match(/LANES\s*=\s*\[([^\]]+)\]/)[1]
  .split(",")
  .map((v) => +v.trim());

// --------------------------------------------------------------- rivals
const rivalBlocks = rivalsTs.split(/\n  \{\n/).slice(1);
const rivals = rivalBlocks
  .map((b) => {
    const f = (re) => b.match(re)?.[1];
    const name = f(/\bname: "([^"]+)"/);
    if (!name) return null;
    return {
      id: f(/\bid: "([^"]+)"/),
      name,
      arabic: f(/arabicName: "([^"]+)"/),
      crew: f(/crew: "([^"]+)"/),
      area: f(/area: "([^"]+)"/),
      color: f(/bodyColor: 0x([0-9a-fA-F]{6})/),
      accent: f(/accentColor: 0x([0-9a-fA-F]{6})/),
      top: +f(/topSpeedKmh: ([\d.]+)/),
      style: f(/bodyStyle: "(\w+)"/) ?? "sedan",
      intro: f(/intro: "([^"]*)"/),
      win: f(/win: "([^"]*)"/),
      lose: f(/lose: "([^"]*)"/),
    };
  })
  .filter(Boolean);
if (rivals.length < 6) throw new Error(`rival parse failed (${rivals.length})`);

// -------------------------------------------------------------- engines
// Two fours, two sixes and a V8, parsed from engines.ts. Ship the cars
// without these and every machine pulls the same way.
const engBlock = enginesTs.match(/export const ENGINES[^=]*=\s*\[(.*?)\n\];/s)[1];
const engines = engBlock
  .split(/\n  \{\n/)
  .slice(1)
  .map((b) => {
    const g = (re) => b.match(re)?.[1];
    const id = g(/id: "([^"]+)"/);
    if (!id) return null;
    return {
      id,
      name: g(/name: "([^"]+)"/),
      cylinders: +g(/cylinders: (\d+)/),
      layout: g(/layout: "(\w+)"/),
      litres: +g(/litres: ([\d.]+)/),
      idle: +g(/idleRpm: (\d+)/),
      redline: +g(/redlineRpm: (\d+)/),
      peakAt: +g(/peakAt: ([\d.]+)/),
      breadth: +g(/breadth: ([\d.]+)/),
      floor: +g(/floor: ([\d.]+)/),
      powerMult: +g(/powerMult: ([\d.]+)/),
      massKg: +g(/massKg: (-?[\d.]+)/),
      subMix: +g(/subMix: ([\d.]+)/),
      lopeDepth: +g(/lopeDepth: ([\d.]+)/),
      price: +g(/price: (\d+)/),
    };
  })
  .filter(Boolean);
if (engines.length !== 5) throw new Error(`engine parse failed (${engines.length}, want 5)`);
const layoutMap = { inline: "EngineLayout.Inline", flat: "EngineLayout.Flat", vee: "EngineLayout.Vee" };
const layoutCs = (l, who) => {
  const v = layoutMap[l];
  if (!v) throw new Error(`${who}: unknown engine layout "${l}"`);
  return v;
};
const engIndex = (id, who) => {
  const i = engines.findIndex((e) => e.id === id);
  if (i < 0) throw new Error(`${who}: unknown engine "${id}" — it is not in engines.ts`);
  return i;
};
/** Mean raw torque over [0.12, 1] — what normalises every engine to the
 *  same average. The identical sum runs in engines.ts; the contract check
 *  compares the two. */
const normOf = (e) => {
  const N = 256, MIN = 0.12;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const r = MIN + ((1 - MIN) * (i + 0.5)) / N;
    const d = r - e.peakAt;
    sum += e.floor + (1 - e.floor) * Math.exp(-(d * d) / (2 * e.breadth * e.breadth));
  }
  return sum / N;
};

// ----------------------------------------------------------------- cars
const carsBlock = modsTs.match(/export const CARS[^=]*=\s*\[(.*?)\n\];/s)[1];
const cars = carsBlock
  .split(/\n  \{\n/)
  .slice(1)
  .map((b) => {
    const f = (re) => b.match(re)?.[1];
    const id = f(/id: "([^"]+)"/);
    if (!id) return null;
    return {
      id,
      name: f(/name: "([^"]+)"/),
      price: +f(/price: (\d+)/),
      power: +f(/power: ([\d.]+)/),
      top: +f(/topSpeedKmh: ([\d.]+)/),
      grip: +f(/grip: ([\d.]+)/),
      brake: +f(/brake: ([\d.]+)/),
      color: f(/color: 0x([0-9a-fA-F]{6})/),
      style: f(/style: "(\w+)"/) ?? "sedan",
      kit: f(/kit: "(\w+)"/) ?? null,
      engine: f(/engine: "([^"]+)"/),
    };
  })
  .filter(Boolean);
if (cars.length < 5) throw new Error(`car parse failed (${cars.length})`);
for (const c of cars) {
  if (!c.engine) throw new Error(`${c.id}: no stock engine — every car has one`);
}

// ------------------------------------------------------------- handling
const handling = {};
for (const [, k, v] of handlingTs.matchAll(/^\s{2}(\w+):\s*([\d.]+),/gm)) {
  handling[k] = +v;
}
const needed = [
  "ceiling", "thrustK", "dragA", "dragB", "steerSmoothRate", "casterRate",
  "headingClamp", "flashRangeM", "driftMinSpeed", "driftAngleBase",
  "driftAngleSpeedK", "driftEngageRate", "driftRecoverRate", "driftYawClamp",
  "driftLatScrub", "driftDriveLoss",
];
for (const k of needed) {
  if (handling[k] === undefined) throw new Error(`handling constant ${k} missing`);
}

const apiVersion = +read("src/game/api.ts").match(/GRN_API_VERSION = (\d+)/)[1];

// --------------------------------------------------------------- emit C#
const styleEnum = { sedan: "BodyStyle.Sedan", zx: "BodyStyle.ZX", gtr: "BodyStyle.GTR", rx7: "BodyStyle.RX7", hatch: "BodyStyle.Hatch" };
/** A style the map does not know must stop the build. Emitting
 *  `Style = undefined` would produce C# that does not compile, and the
 *  failure would surface in Unity rather than here. */
const style = (s, who) => {
  const v = styleEnum[s];
  if (!v) throw new Error(`${who}: unknown bodyStyle "${s}" — add it to styleEnum and the C# BodyStyle enum`);
  return v;
};
const cs = (s) => (s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const col = (hex) => `Hex(0x${hex.toUpperCase()})`;
const f = (n) => `${n}f`;

const out = `// GENERATED FILE — do not edit by hand.
// Produced by scripts/export-unity-data.mjs from the web build's
// src/game/{track,rivals,mods,handling}.ts. Regenerate with:
//
//     npm run sync:unity
//
// One web unit = one metre = one Unity unit, so the numbers below are
// used as-is. Verified against the live API by \`npm run check:unity\`.

using UnityEngine;

public enum BodyStyle { Sedan, ZX, GTR, RX7 }

public static class GRNData
{
    /// <summary>Payload shape this build understands; the API client
    /// refuses live data that does not match.</summary>
    public const int ApiVersion = ${apiVersion};

    public const float RoadHalfWidth = ${f(roadHalf)};
    public static readonly float[] Lanes = { ${lanes.map(f).join(", ")} };

    public struct TrackPoint { public float X, Z; }
    public static readonly TrackPoint[] ControlPoints =
    {
${points.map((p) => `        new TrackPoint { X = ${f(p.x)}, Z = ${f(p.z)} },`).join("\n")}
    };

    public class Rival
    {
        public string Id, Name, ArabicName, Crew, Area;
        public Color Body, Accent;
        public float TopSpeedKmh;
        public BodyStyle Style;
        public int PrizeKd;
        public string IntroAr, WinAr, LoseAr;
    }

    public static readonly Rival[] Rivals =
    {
${rivals
  .map(
    (r, i) => `        new Rival {
            Id = "${cs(r.id)}", Name = "${cs(r.name)}", ArabicName = "${cs(r.arabic)}",
            Crew = "${cs(r.crew)}", Area = "${cs(r.area)}",
            Body = ${col(r.color)}, Accent = ${col(r.accent)},
            TopSpeedKmh = ${f(r.top)}, Style = ${style(r.style, r.id)}, PrizeKd = ${400 + i * 300},
            IntroAr = "${cs(r.intro)}",
            WinAr = "${cs(r.win)}",
            LoseAr = "${cs(r.lose)}",
        },`
  )
  .join("\n")}
    };

    public enum EngineLayout { Inline, Flat, Vee }

    /// <summary>One of the five. The curve is a Gaussian bump on a floor,
    /// normalised so every engine's mean torque over the usable rev range
    /// is exactly 1.0 — see src/game/engines.ts for why.</summary>
    public class Engine
    {
        public string Id, Name;
        public int Cylinders;
        public EngineLayout Layout;
        public float Litres, IdleRpm, RedlineRpm;
        public float PeakAt, Breadth, Floor, PowerMult, MassKg;
        public float SubMix, LopeDepth;
        public int Price;
        /// <summary>Mean of the raw curve over the usable range, baked by
        /// the generator so nothing has to integrate it at runtime.</summary>
        public float Norm;
    }

    public static readonly Engine[] Engines =
    {
${engines
  .map(
    (e) => `        new Engine {
            Id = "${cs(e.id)}", Name = "${cs(e.name)}", Cylinders = ${e.cylinders}, Layout = ${layoutCs(e.layout, e.id)},
            Litres = ${f(e.litres)}, IdleRpm = ${f(e.idle)}, RedlineRpm = ${f(e.redline)},
            PeakAt = ${f(e.peakAt)}, Breadth = ${f(e.breadth)}, Floor = ${f(e.floor)},
            PowerMult = ${f(e.powerMult)}, MassKg = ${f(e.massKg)},
            SubMix = ${f(e.subMix)}, LopeDepth = ${f(e.lopeDepth)}, Price = ${e.price},
            Norm = ${normOf(e).toFixed(6)}f,
        },`
  )
  .join("\n")}
    };

    /// <summary>Lowest rev fraction the gearbox ever asks for.</summary>
    public const float MinRevFraction = 0.12f;

    /// <summary>Torque multiplier at a point in the rev range. Averages to
    /// exactly 1.0 for every engine: a swap redistributes power, never
    /// adds any.</summary>
    public static float EngineTorque(int engineIndex, float rev)
    {
        var e = Engines[engineIndex];
        float r = Mathf.Clamp01(rev);
        float d = r - e.PeakAt;
        float raw = e.Floor + (1f - e.Floor) * Mathf.Exp(-(d * d) / (2f * e.Breadth * e.Breadth));
        return raw / e.Norm;
    }

    /// <summary>The note: a four-stroke fires Cylinders/2 times per crank
    /// revolution.</summary>
    public static float EngineFiringHz(int engineIndex, float rev)
    {
        var e = Engines[engineIndex];
        float rpm = e.IdleRpm + (e.RedlineRpm - e.IdleRpm) * Mathf.Clamp01(rev);
        return (rpm / 60f) * (e.Cylinders * 0.5f);
    }

    public class Car
    {
        public string Id, Name;
        public int Price;
        public float Power, TopSpeedKmh, Grip, Brake;
        public Color Paint;
        public BodyStyle Style;
        /// <summary>Factory time-attack aero (wing, splitter, bronze wheels).</summary>
        public bool AttackKit;
        /// <summary>Index into Engines — what the car left the factory with.</summary>
        public int Engine;
    }

    public static readonly Car[] Cars =
    {
${cars
  .map(
    (c) => `        new Car {
            Id = "${cs(c.id)}", Name = "${cs(c.name)}", Price = ${c.price},
            Power = ${f(c.power)}, TopSpeedKmh = ${f(c.top)}, Grip = ${f(c.grip)}, Brake = ${f(c.brake)},
            Paint = ${col(c.color)}, Style = ${style(c.style, c.id)}, AttackKit = ${c.kit === "attack" ? "true" : "false"},
            Engine = ${engIndex(c.engine, c.id)},
        },`
  )
  .join("\n")}
    };

    /// <summary>Mirrors src/game/handling.ts. The contract test proves the
    /// values here match what the browser is actually racing.</summary>
    public static class Handling
    {
${Object.keys(handling).map((k) => `        public const float ${k[0].toUpperCase()}${k.slice(1)} = ${f(handling[k])};`).join("\n")}
    }

    static Color Hex(int rgb) =>
        new Color(((rgb >> 16) & 255) / 255f, ((rgb >> 8) & 255) / 255f, (rgb & 255) / 255f);
}
`;

writeFileSync("unity/Assets/Scripts/GRNData.cs", out);
console.log(
  `GRNData.cs regenerated: ${points.length} track points, ${rivals.length} rivals, ` +
    `${engines.length} engines, ${cars.length} cars, ${Object.keys(handling).length} handling constants, ` +
    `apiVersion ${apiVersion}.`
);
