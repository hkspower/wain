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
    };
  })
  .filter(Boolean);
if (cars.length < 5) throw new Error(`car parse failed (${cars.length})`);

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
const styleEnum = { sedan: "BodyStyle.Sedan", zx: "BodyStyle.ZX", gtr: "BodyStyle.GTR", rx7: "BodyStyle.RX7" };
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

    public class Car
    {
        public string Id, Name;
        public int Price;
        public float Power, TopSpeedKmh, Grip, Brake;
        public Color Paint;
        public BodyStyle Style;
        /// <summary>Factory time-attack aero (wing, splitter, bronze wheels).</summary>
        public bool AttackKit;
    }

    public static readonly Car[] Cars =
    {
${cars
  .map(
    (c) => `        new Car {
            Id = "${cs(c.id)}", Name = "${cs(c.name)}", Price = ${c.price},
            Power = ${f(c.power)}, TopSpeedKmh = ${f(c.top)}, Grip = ${f(c.grip)}, Brake = ${f(c.brake)},
            Paint = ${col(c.color)}, Style = ${style(c.style, c.id)}, AttackKit = ${c.kit === "attack" ? "true" : "false"},
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
    `${cars.length} cars, ${Object.keys(handling).length} handling constants, apiVersion ${apiVersion}.`
);
