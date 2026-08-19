// Build the showroom check sheet from press/cars/.
//
//   npm run shots:cars      # render the fourteen cards first
//   node tools/shots/carsheet.mjs
//
// Writes press/cars/showroom.html: every car in the game, in the order a
// player actually buys them, with the render, both names, and the four
// numbers that decide whether the next one up is worth the money. The
// findings at the top are computed from the roster rather than written
// by hand, so the sheet cannot claim the showroom is fine after someone
// changes it.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const DIR = "press/cars";
const cars = JSON.parse(readFileSync(`${DIR}/cars.json`, "utf8"));

// Downscale for embedding. The press PNGs are 1200 px wide at 2.5x for
// print; a card on a web page needs a third of that, and fourteen
// full-size frames would be an eight-megabyte page.
const b64 = (id) => {
  const src = `${DIR}/${id}.png`;
  if (!existsSync(src)) throw new Error(`missing render: ${src}`);
  const out = execFileSync("python3", [
    "-c",
    `import sys,io,base64
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
im = im.resize((620, round(620*im.height/im.width)), Image.LANCZOS)
b = io.BytesIO(); im.save(b, "JPEG", quality=82, optimize=True)
sys.stdout.write(base64.b64encode(b.getvalue()).decode())`,
    src,
  ]).toString();
  return `data:image/jpeg;base64,${out}`;
};

const ladder = [...cars].sort((a, b) => a.price - b.price);
const range = (k) => {
  const v = cars.map((c) => c[k]);
  return [Math.min(...v), Math.max(...v)];
};
const R = { topSpeedKmh: range("topSpeedKmh"), power: range("power"), grip: range("grip"), brake: range("brake") };
const pct = (c, k) => {
  const [lo, hi] = R[k];
  return Math.round(((c[k] - lo) / (hi - lo)) * 100);
};

// --- findings, derived ------------------------------------------------
const styleCount = {};
for (const c of cars) styleCount[c.bodyStyle] = (styleCount[c.bodyStyle] ?? 0) + 1;

// A name that promises a silhouette the model does not have.
const PROMISES = [
  { re: /pickup|ونيت/i, want: "a pickup bed" },
  { re: /hatch|هاتش/i, want: "a hatchback tail" },
  { re: /coupe|كوبيه/i, want: "a two-door roofline" },
];
const misnamed = cars.flatMap((c) => {
  const hit = PROMISES.find((p) => p.re.test(c.name) || p.re.test(c.arabicName ?? ""));
  return hit && c.bodyStyle === "sedan" ? [{ car: c, want: hit.want }] : [];
});

// Beaten on every number by something cheaper: nobody should ever buy it.
const dominated = cars.flatMap((a) => {
  const by = cars.filter(
    (b) =>
      b.price < a.price &&
      b.topSpeedKmh >= a.topSpeedKmh &&
      b.power >= a.power &&
      b.grip >= a.grip &&
      b.brake >= a.brake
  );
  return by.length ? [{ car: a, by }] : [];
});

// Costs more than the car below it on the ladder and is slower.
const backwards = ladder.flatMap((c, i) =>
  i > 0 && c.topSpeedKmh < ladder[i - 1].topSpeedKmh
    ? [{ car: c, under: ladder[i - 1] }]
    : []
);

const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const kd = (n) => (n === 0 ? "free" : n.toLocaleString("en-US") + " KD");

const flagsFor = (c) => {
  const f = [];
  if (misnamed.some((m) => m.car.id === c.id)) f.push({ k: "warn", t: "name promises another shape" });
  if (dominated.some((d) => d.car.id === c.id)) f.push({ k: "bad", t: "beaten by a cheaper car" });
  if (backwards.some((b) => b.car.id === c.id)) f.push({ k: "warn", t: "slower than the one below" });
  return f;
};

const bar = (c, k, label) => `
          <div class="stat">
            <span class="stat-k">${label}</span>
            <span class="stat-v">${c[k]}</span>
            <span class="track"><i style="width:${Math.max(3, pct(c, k))}%"></i></span>
          </div>`;

const card = (c, i) => `
      <article class="car">
        <div class="shot"><img src="${b64(c.id)}" alt="${esc(c.name)}" loading="lazy" /></div>
        <header>
          <span class="rung">${String(i + 1).padStart(2, "0")}</span>
          <div class="names">
            <h2>${esc(c.name)}</h2>
            <p class="ar" lang="ar" dir="rtl">${esc(c.arabicName ?? "")}</p>
          </div>
          <span class="price">${kd(c.price)}</span>
        </header>
        <div class="chips">
          <span class="chip">${esc(c.cls)}</span>
          <span class="chip body">${esc(c.bodyStyle)}</span>
          ${c.kit === "attack" ? '<span class="chip kit">attack kit</span>' : ""}
          ${flagsFor(c).map((f) => `<span class="chip ${f.k}">${f.t}</span>`).join("")}
        </div>
        <div class="stats">
${bar(c, "topSpeedKmh", "top km/h")}
${bar(c, "power", "power")}
${bar(c, "grip", "grip")}
${bar(c, "brake", "brake")}
        </div>
        <p class="desc">${esc(c.desc ?? "")}</p>
      </article>`;

const findingBlock = () => {
  const items = [];
  const sedans = styleCount.sedan ?? 0;
  items.push(`<li><b>${sedans} of ${cars.length} cars share one silhouette.</b>
    The showroom has ${Object.keys(styleCount).length} body shapes in it —
    ${Object.entries(styleCount).map(([k, v]) => `${v}&times; ${k}`).join(", ")} —
    so most of the ladder is the same car in different paint.</li>`);
  for (const m of misnamed) {
    items.push(`<li><b>${esc(m.car.name)}</b> <span lang="ar" dir="rtl">${esc(m.car.arabicName)}</span>
      is built on the <code>sedan</code> body. The name promises ${m.want}.</li>`);
  }
  for (const d of dominated) {
    items.push(`<li><b>${esc(d.car.name)}</b> at ${kd(d.car.price)} is beaten on
      <em>every</em> number by ${d.by.map((b) => `${esc(b.name)} at ${kd(b.price)}`).join(" and ")}.
      There is no reason to buy it.</li>`);
  }
  for (const b of backwards) {
    items.push(`<li><b>${esc(b.car.name)}</b> costs ${kd(b.car.price)} and tops out
      ${b.under.topSpeedKmh - b.car.topSpeedKmh} km/h <em>lower</em> than
      ${esc(b.under.name)} at ${kd(b.under.price)}.</li>`);
  }
  return items.join("\n");
};

const html = `<title>Gulf Road Showroom</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,600;1,600;1,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;600&display=swap" />
<style>
  /* One committed visual world: the game is a night racer and this is its
     showroom at 2 a.m. Every colour is painted explicitly so the page
     holds on either host ground rather than borrowing one. Tokens are the
     game's own (src/app/globals.css): sodium amber, gulf cyan, and a navy
     that is a chosen neutral rather than a grey. */
  :root {
    --ground: #05080f;
    --panel: #0b111e;
    --panel-2: #101a2c;
    --line: #1e2b45;
    --ink: #e9eef8;
    --muted: #8d9bb8;
    --sodium: #f5a524;
    --gulf: #38c9ee;
    --bad: #ff7b7b;
    --warn: #ffc45c;
    --display: "Barlow Condensed", "Arial Narrow", sans-serif;
    --body: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
    --ar: "IBM Plex Sans Arabic", "IBM Plex Sans", sans-serif;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: var(--body);
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 3rem 1.25rem 5rem; }

  header.top { border-bottom: 1px solid var(--line); padding-bottom: 1.5rem; }
  .eyebrow {
    font-family: var(--display);
    font-size: 0.82rem; letter-spacing: 0.28em; text-transform: uppercase;
    color: var(--gulf); margin: 0 0 0.35rem;
  }
  h1 {
    font-family: var(--display); font-style: italic; font-weight: 700;
    font-size: clamp(2.4rem, 7vw, 4rem); line-height: 0.95; margin: 0;
    text-wrap: balance; letter-spacing: 0.01em;
  }
  .lede { color: var(--muted); max-width: 62ch; margin: 0.9rem 0 0; }

  .findings {
    margin: 2rem 0 3rem; padding: 1.4rem 1.5rem;
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 10px;
  }
  .findings h2 {
    font-family: var(--display); text-transform: uppercase; letter-spacing: 0.16em;
    font-size: 0.95rem; color: var(--sodium); margin: 0 0 0.8rem;
  }
  .findings ul { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.7rem; }
  .findings li { color: var(--muted); }
  .findings b { color: var(--ink); font-weight: 600; }
  .findings code {
    font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.88em;
    background: var(--panel-2); padding: 0.05em 0.35em; border-radius: 4px; color: var(--gulf);
  }

  .grid { display: grid; gap: 1.1rem; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); }

  .car {
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    overflow: hidden; display: flex; flex-direction: column;
  }
  .shot { background: #070d18; border-bottom: 1px solid var(--line); }
  .shot img { display: block; width: 100%; height: auto; }

  .car header { display: flex; align-items: baseline; gap: 0.7rem; padding: 0.9rem 1rem 0; }
  .rung {
    font-family: var(--display); font-size: 1.5rem; font-weight: 600; font-style: italic;
    color: var(--line); line-height: 1; font-variant-numeric: tabular-nums;
  }
  .names { flex: 1; min-width: 0; }
  .car h2 {
    font-family: var(--display); font-size: 1.42rem; font-weight: 600;
    margin: 0; line-height: 1.05; letter-spacing: 0.01em;
  }
  .ar { font-family: var(--ar); font-size: 0.92rem; color: var(--muted); margin: 0.15rem 0 0; }
  .price {
    font-family: var(--display); font-size: 1rem; color: var(--sodium);
    white-space: nowrap; font-variant-numeric: tabular-nums;
  }

  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; padding: 0.7rem 1rem 0; }
  .chip {
    font-size: 0.68rem; letter-spacing: 0.09em; text-transform: uppercase;
    padding: 0.2rem 0.5rem; border-radius: 999px;
    border: 1px solid var(--line); color: var(--muted); background: var(--panel-2);
  }
  .chip.body { color: var(--gulf); border-color: #1d4f63; }
  .chip.kit { color: var(--sodium); border-color: #5a4218; }
  .chip.warn { color: var(--warn); border-color: #5c4720; background: #221a0c; }
  .chip.bad { color: var(--bad); border-color: #5e2626; background: #240f0f; }

  .stats { padding: 0.9rem 1rem 0; display: grid; gap: 0.4rem; }
  .stat { display: grid; grid-template-columns: 5.2rem 2.9rem 1fr; align-items: center; gap: 0.55rem; }
  .stat-k { font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .stat-v { font-size: 0.88rem; font-variant-numeric: tabular-nums; text-align: right; }
  .track { height: 4px; border-radius: 2px; background: var(--panel-2); overflow: hidden; }
  .track i { display: block; height: 100%; background: linear-gradient(90deg, #1aa7cc, var(--gulf)); }

  .desc { color: var(--muted); font-size: 0.86rem; padding: 0.85rem 1rem 1.1rem; margin: 0; }

  footer { margin-top: 3rem; padding-top: 1.4rem; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.85rem; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>

<div class="wrap">
  <header class="top">
    <p class="eyebrow">Gulf Road Nights &middot; <span lang="ar" dir="rtl">ليالي شارع الخليج</span></p>
    <h1>The Showroom</h1>
    <p class="lede">All ${cars.length} cars, rendered on the game's own turntable under the
      menu's showroom lighting, in the order a player buys them. Every card is the
      same camera at the same angle, so the sizes are comparable.</p>
  </header>

  <section class="findings">
    <h2>What to check</h2>
    <ul>
${findingBlock()}
    </ul>
  </section>

  <div class="grid">
${ladder.map(card).join("\n")}
  </div>

  <footer>
    Bars are scaled across the roster: full width is the best car in the game for that
    number, not an absolute. Renders by <code>npm run shots:cars</code>; this sheet by
    <code>tools/shots/carsheet.mjs</code>, findings computed from the roster.
  </footer>
</div>
`;

writeFileSync(`${DIR}/showroom.html`, html);
console.log(`press/cars/showroom.html — ${cars.length} cars, ${(html.length / 1e6).toFixed(1)} MB`);
console.log(`findings: ${misnamed.length} misnamed, ${dominated.length} dominated, ${backwards.length} backwards on the ladder`);
