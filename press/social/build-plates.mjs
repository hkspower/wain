// Write the sixteen Instagram plates.
//
//   node press/social/build-plates.mjs   # then: node press/social/render.mjs
//
// Four designs across four sizes. They are generated rather than kept as
// sixteen hand-written files because they are one design system seen
// four ways: the ink weight, the screentone pitch and the safe area are
// decided once here instead of sixteen times by hand, and a correction
// lands on the whole set.
//
// Why these are not crops of the print brochure. An A4 page is 1:1.414
// and no Instagram size is, so a crop would cut the composition — and
// the type would come out unreadable: 16px body on a 794px page is 22px
// at 1080, in a feed, on a phone. Every plate is laid out at its own
// pixel size, at a scale built for arm's length.
//
// Two things here exist because Instagram recompresses what you upload:
// the ink is HEAVIER than print (a 4px border at 794 is a hairline at
// 1080 and the first thing a JPEG pass eats), and the screentone is
// COARSER (dots under ~3px moiré into mush). Both are set per format
// below rather than inherited from the page.
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- ink --
const INK = "#0a0b0d";
const PAPER = "#f4f5f7";
const SODIUM = "#ffc45c";
const GULF = "#7fe3ff";
// Sodium is ~1.6:1 on the paper — it is never bare text there, only
// stroked (the SFX) or on the ink (the dark strips).
const RUST = "#ce742a";

const HEAD = (title) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&family=IBM+Plex+Sans+Arabic:wght@700&display=swap">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${INK}; }
  .plate { position: relative; overflow: hidden; background: ${PAPER}; color: ${INK};
           font-family: "Barlow Condensed", "Arial Narrow", Impact, sans-serif; }
  /* Arabic set as Arabic: its own face, and never letter-spaced —
     tracking breaks the joins in a cursive script. */
  .ar { font-family: "IBM Plex Sans Arabic", "Noto Sans Arabic", Tahoma, sans-serif;
        font-weight: 700; letter-spacing: normal; }
  .sfx { font-weight: 900; line-height: 0.82; color: ${SODIUM}; text-transform: uppercase;
         -webkit-text-stroke: 7px ${INK}; paint-order: stroke fill; text-shadow: 14px 14px 0 ${INK}; }
  .panel { position: absolute; background: ${INK}; padding: 13px; }
  .panel > .in { position: relative; width: 100%; height: 100%; overflow: hidden; background: ${INK}; }
  .panel img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tone { position: absolute; inset: 0; mix-blend-mode: multiply; }
  .burst { position: absolute; inset: 0; }
  .balloon { position: absolute; background: ${PAPER}; border: 8px solid ${INK};
             border-radius: 50% / 36%; box-shadow: 10px 10px 0 ${INK}; }
  .tail-o, .tail-i { position: absolute; width: 0; height: 0; }
  .chip { position: absolute; background: ${PAPER}; border: 5px solid ${INK};
          font-weight: 900; text-transform: uppercase; white-space: nowrap; }
</style>
</head>
<body>`;

const FOOT = `</body>
</html>
`;

/** A panel: irregular shape, ink border, and its own tone. */
function panel({ x, y, w, h, img, pos = "50% 50%", clip, tone = "dots", pitch = 10, burst }) {
  const c = clip || "polygon(0% 2%, 100% 0%, 100% 98%, 0% 100%)";
  const toneCss =
    tone === "hatch"
      ? `background-image: repeating-linear-gradient(45deg, ${INK} 0 2px, transparent 2px ${pitch}px); opacity: 0.3;`
      : tone === "none"
        ? "display: none;"
        : `background-image: radial-gradient(${INK} 1.7px, transparent 2.1px); background-size: ${pitch}px ${pitch}px; opacity: 0.4;`;
  const toneMask = tone === "none" ? "" :
    `-webkit-mask: linear-gradient(#000 0%, #000 30%, transparent 58%); mask: linear-gradient(#000 0%, #000 30%, transparent 58%);`;
  const b = burst
    ? `<div class="burst" style="background: repeating-conic-gradient(from 0deg at ${burst.x} ${burst.y}, ${INK} 0deg 0.55deg, transparent 0.55deg 3.6deg);
         -webkit-mask: radial-gradient(circle at ${burst.x} ${burst.y}, transparent ${burst.r || "26%"}, #000 ${burst.o || "68%"});
         mask: radial-gradient(circle at ${burst.x} ${burst.y}, transparent ${burst.r || "26%"}, #000 ${burst.o || "68%"}); opacity: 0.62;"></div>`
    : "";
  return `<div class="panel" style="left:${x}px; top:${y}px; width:${w}px; height:${h}px; clip-path:${c};">
  <div class="in" style="clip-path:${c};">
    <img src="img/${img}" style="object-position:${pos};">
    ${b}
    <div class="tone" style="${toneCss} ${toneMask}"></div>
  </div>
</div>`;
}

/** A speech balloon with a two-triangle tail, and the speaker under it. */
function balloon({ x, y, w, ar, en, who, side = "left", arSize = 34, enSize = 24 }) {
  const tail =
    side === "left"
      ? `<div class="tail-o" style="left:56px; bottom:-52px; border-left:26px solid transparent; border-right:26px solid transparent; border-top:52px solid ${INK};"></div>
         <div class="tail-i" style="left:66px; bottom:-34px; border-left:16px solid transparent; border-right:16px solid transparent; border-top:36px solid ${PAPER};"></div>`
      : `<div class="tail-o" style="right:56px; bottom:-52px; border-left:26px solid transparent; border-right:26px solid transparent; border-top:52px solid ${INK};"></div>
         <div class="tail-i" style="right:66px; bottom:-34px; border-left:16px solid transparent; border-right:16px solid transparent; border-top:36px solid ${PAPER};"></div>`;
  // The speaker rides INSIDE the balloon. Sat outside as its own chip it
  // has to guess the balloon's height, and the Arabic wraps to two lines
  // often enough that the guess lands on top of the English line.
  return `<div class="balloon" style="left:${x}px; top:${y}px; width:${w}px; padding:26px 30px 20px;">
  <div class="ar" lang="ar" dir="rtl" style="font-size:${arSize}px; line-height:1.5; text-align:center;">${ar}</div>
  <div style="margin-top:8px; font-size:${enSize}px; font-weight:700; letter-spacing:0.07em; text-transform:uppercase; text-align:center;">${en}</div>
  <div style="margin-top:10px; font-size:21px; font-weight:900; letter-spacing:0.09em; text-transform:uppercase; text-align:center; color:${RUST};">${who}</div>
  ${tail}
</div>`;
}

/** The carousel's continuity: one rule, one slide number, every frame. */
function railTop(n, W) {
  const idx = ["١", "٢", "٣", "٤"][n - 1];
  return `<div style="position:absolute; left:0; top:0; width:${W}px; height:14px; background:${SODIUM};"></div>
<div class="chip" style="right:44px; top:42px; padding:6px 16px; font-size:26px; letter-spacing:0.12em;">
  <span class="ar" lang="ar" style="letter-spacing:normal;">${idx}/٤</span>
</div>`;
}

/** The ink strip every plate signs off with. No URL: the project has no
 *  domain, so the call to action is the one an account actually carries. */
function footer({ y, W, h = 104, label }) {
  return `<div style="position:absolute; left:0; top:${y}px; width:${W}px; height:${h}px; background:${INK}; color:${PAPER};
     display:flex; align-items:center; justify-content:space-between; padding:0 44px;">
  <div style="font-size:28px; font-weight:900; letter-spacing:0.16em; text-transform:uppercase;">${label}</div>
  <div style="font-size:26px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; color:${SODIUM};">
    Link in bio &middot; <span class="ar" lang="ar" style="letter-spacing:normal;">الرابط في البايو</span>
  </div>
</div>`;
}

// ------------------------------------------------------------ designs --
// Every Arabic line is the game's own: the rivals' dialogue comes out of
// src/game/rivals.ts, and car names are full — a truncated
// "زيتا ٣٠٠ جي تي آر" is the name of a different, cheaper car.
const DESIGNS = [
  {
    id: "cover", n: 1,
    en: "Night<br>Racer", enFlat: "Night Racer", ar: "متسابق<br>الليل", arFlat: "متسابق الليل",
    kicker: "Gulf Road Nights",
    img: "menu.jpg", pos: "50% 62%",
    burst: { x: "52%", y: "78%", r: "28%", o: "70%" },
    sfxEn: "Vroooom", sfxAr: "زوووم",
    ar_line: "هلا والله! يلا ورّني شنو عندك",
    en_line: "Yalla &mdash; let's see what you've got",
    who: `Abu Shanab &middot; <span class="ar" lang="ar" style="letter-spacing:normal;">أبو شنب</span>`,
    facts: [["7.3 km", "one lap of Gulf Road"], ["8", "street legends to beat"], ["00:00", "to 05:50, every night"]],
    label: "Night Racer &middot; Kuwait",
  },
  {
    id: "road", n: 2,
    en: "The<br>road", enFlat: "The road", ar: "شارع<br>الخليج", arFlat: "شارع الخليج العربي",
    kicker: "Corniche to skyline",
    img: "coast.jpg", pos: "50% 52%",
    burst: { x: "56%", y: "64%", r: "30%", o: "72%" },
    sfxEn: "The sea<br>on your left", sfxAr: "",
    ar_line: "قلت لك، شارع الخليج لي أنا",
    en_line: "I told you &mdash; Gulf Road is mine",
    who: `Bint Al-Deera &middot; <span class="ar" lang="ar" style="letter-spacing:normal;">بنت الديرة</span>`,
    facts: [["Towers", "the start line"], ["Salmiya", "marina, then Ras Al-Ard"], ["Al Hamra", "and the way home"]],
    label: "Gulf Road &middot; 7.3 km",
  },
  {
    id: "machines", n: 3,
    en: "The<br>machines", enFlat: "The machines", ar: "السيارات", arFlat: "السيارات",
    kicker: "Seventeen of them",
    img: "drift.jpg", pos: "48% 62%",
    burst: { x: "44%", y: "76%", r: "20%", o: "56%" },
    sfxEn: "Drift!", sfxAr: "صرييييير",
    ar_line: "الغبار اللي وراك؟ هذا أنا",
    en_line: "That dust behind you? That's me",
    who: `Bu Torab &middot; <span class="ar" lang="ar" style="letter-spacing:normal;">بو تراب</span>`,
    facts: [["415", "km/h &middot; Black Demon"], ["405", "km/h &middot; Zeta 300 GTR"], ["195", "km/h &middot; Jahra Pickup"]],
    label: "Hold Space to drift",
  },
  {
    id: "stops", n: 4,
    en: "Stop<br>&amp; pay", enFlat: "Stop &amp; pay", ar: "وقّف<br>وادفع", arFlat: "وقّف وادفع",
    kicker: "Petrol, paint, horn",
    img: "station.jpg", pos: "72% 54%",
    burst: null,
    sfxEn: "", sfxAr: "طووووط",
    ar_line: "اللي يخسر يعزم على المجبوس",
    en_line: "Loser buys the machboos",
    who: `Bu Machboos &middot; <span class="ar" lang="ar" style="letter-spacing:normal;">بو مجبوس</span>`,
    facts: [["85", "fils a litre, as it flows"], ["150", "KD and up, for a respray"], ["17", "cars, each with its own horn"]],
    label: "Drive in &middot; stop &middot; pay",
  },
];

// ------------------------------------------------------------ layouts --

/** 1080x1350. The feed unit, and the carousel. Instagram's profile grid
 *  is 3:4 now, so a 4:5 post is cropped at the SIDES — everything that
 *  matters stays inside the 810px centre column (x 135..945). */
function portrait(d) {
  const W = 1080, H = 1350;
  return `${HEAD(`Night Racer — ${d.enFlat} — portrait`)}
<div class="plate" style="width:${W}px; height:${H}px;">
  ${railTop(d.n, W)}
  <div style="position:absolute; left:135px; top:84px; font-size:30px; font-weight:700; letter-spacing:0.22em; text-transform:uppercase;">${d.kicker}</div>
  <div style="position:absolute; left:135px; top:118px; font-size:132px; font-weight:900; line-height:0.84; text-transform:uppercase;">${d.en}</div>
  <div class="ar" lang="ar" dir="rtl" style="position:absolute; right:135px; top:132px; font-size:60px; line-height:1.18; text-align:right;">${d.ar}</div>

  ${panel({ x: 60, y: 430, w: 960, h: 500, img: d.img, pos: d.pos, burst: d.burst, pitch: 11 })}
  ${d.sfxEn ? `<div class="sfx" style="position:absolute; right:110px; top:440px; font-size:104px; transform:rotate(-6deg) skew(-11deg); z-index:4; text-align:right;">${d.sfxEn}</div>` : ""}
  ${d.sfxAr ? `<div class="sfx ar" lang="ar" style="position:absolute; right:120px; top:${d.sfxEn ? 566 : 452}px; font-size:76px; transform:rotate(-6deg); z-index:4; -webkit-text-stroke:6px ${INK}; text-shadow:10px 10px 0 ${INK};">${d.sfxAr}</div>` : ""}

  ${balloon({ x: 140, y: 728, w: 548, ar: d.ar_line, en: d.en_line, who: d.who, side: "left" })}

  <div style="position:absolute; left:135px; right:135px; top:1046px; display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:22px;">
    ${d.facts.map(([big, small]) => `<div style="display:flex; flex-direction:column; gap:4px;">
      <div style="font-size:64px; font-weight:900; line-height:1;">${big}</div>
      <div style="font-size:26px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${RUST};">${small}</div>
    </div>`).join("\n    ")}
  </div>
  ${footer({ y: H - 104, W, label: d.label })}
</div>
${FOOT}`;
}

/** 1080x1080. The least distinctive shape in a feed, so it carries the
 *  loudest single idea rather than a paragraph. */
function square(d) {
  const W = 1080, H = 1080;
  return `${HEAD(`Night Racer — ${d.enFlat} — square`)}
<div class="plate" style="width:${W}px; height:${H}px;">
  ${panel({ x: 0, y: 0, w: W, h: 700, img: d.img, pos: d.pos, burst: d.burst, pitch: 11, clip: "polygon(0% 0%, 100% 0%, 100% 97%, 0% 100%)" })}
  ${railTop(d.n, W)}
  ${d.sfxEn ? `<div class="sfx" style="position:absolute; right:74px; top:150px; font-size:132px; transform:rotate(-6deg) skew(-11deg); z-index:4; text-align:right;">${d.sfxEn}</div>` : ""}
  ${d.sfxAr ? `<div class="sfx ar" lang="ar" style="position:absolute; right:84px; top:${d.sfxEn ? 330 : 170}px; font-size:92px; transform:rotate(-6deg); z-index:4; -webkit-text-stroke:6px ${INK}; text-shadow:12px 12px 0 ${INK};">${d.sfxAr}</div>` : ""}

  <div style="position:absolute; left:64px; top:726px; font-size:26px; font-weight:700; letter-spacing:0.22em; text-transform:uppercase;">${d.kicker}</div>
  <div style="position:absolute; left:64px; top:760px; font-size:118px; font-weight:900; line-height:0.84; text-transform:uppercase;">${d.en}</div>
  <div class="ar" lang="ar" dir="rtl" style="position:absolute; right:64px; top:772px; font-size:54px; line-height:1.18; text-align:right;">${d.ar}</div>
  ${footer({ y: H - 104, W, label: d.label })}
</div>
${FOOT}`;
}

/** 1080x566. Renders smallest in feed and crops hardest on the grid —
 *  its real use is a link or ad preview, so it says one thing. */
function wide(d) {
  const W = 1080, H = 566;
  return `${HEAD(`Night Racer — ${d.enFlat} — landscape`)}
<div class="plate" style="width:${W}px; height:${H}px;">
  ${panel({ x: 0, y: 0, w: W, h: H, img: d.img, pos: d.pos, burst: d.burst, pitch: 9, clip: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)" })}
  <div style="position:absolute; left:0; top:0; width:${W}px; height:${H}px;
       background: linear-gradient(100deg, ${INK} 0%, ${INK} 34%, transparent 62%); opacity:0.92;"></div>
  <div style="position:absolute; left:0; top:0; width:${W}px; height:12px; background:${SODIUM};"></div>
  <div style="position:absolute; left:56px; top:96px; font-size:24px; font-weight:700; letter-spacing:0.22em; text-transform:uppercase; color:${PAPER};">${d.kicker}</div>
  <div style="position:absolute; left:56px; top:128px; font-size:92px; font-weight:900; line-height:0.84; text-transform:uppercase; color:${PAPER};">${d.en}</div>
  <div class="ar" lang="ar" dir="rtl" style="position:absolute; left:56px; top:${d.en.includes("<br>") ? 316 : 232}px; font-size:44px; color:${SODIUM};">${d.arFlat}</div>
  <div style="position:absolute; left:56px; bottom:46px; font-size:24px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:${SODIUM};">
    Link in bio &middot; <span class="ar" lang="ar" style="letter-spacing:normal;">الرابط في البايو</span>
  </div>
</div>
${FOOT}`;
}

/** 1080x1920. Instagram lays its profile row over the top and the reply
 *  bar over the bottom: the image bleeds through both, nothing that has
 *  to be read does. Two stacked panel bands rather than one tall image —
 *  the stills are 16:9, so a full-bleed vertical panel would be an
 *  upscale, and a stack is how a story reads anyway. */
function story(d) {
  const W = 1080, H = 1920;
  const second = { cover: "night.jpg", road: "towers.jpg", machines: "city.jpg", stops: "drift.jpg" }[d.id];
  // The SFX has to clear the headline, and the headline is one line or
  // two depending on the design — at 150px on a 0.82 leading that is
  // 123px a line, so a two-line title runs 246px down from its top.
  const sfxTop = d.en.includes("<br>") ? 600 : 500;
  return `${HEAD(`Night Racer — ${d.enFlat} — story`)}
<div class="plate" style="width:${W}px; height:${H}px;">
  <div style="position:absolute; left:0; top:0; width:${W}px; height:18px; background:${SODIUM};"></div>

  <div style="position:absolute; left:64px; top:286px; font-size:30px; font-weight:700; letter-spacing:0.22em; text-transform:uppercase;">${d.kicker}</div>
  <div style="position:absolute; left:64px; top:326px; font-size:150px; font-weight:900; line-height:0.82; text-transform:uppercase;">${d.en}</div>
  <div class="ar" lang="ar" dir="rtl" style="position:absolute; right:64px; top:344px; font-size:72px; line-height:1.16; text-align:right;">${d.ar}</div>

  ${panel({ x: 64, y: 640, w: 952, h: 440, img: d.img, pos: d.pos, burst: d.burst, pitch: 12 })}
  ${d.sfxEn ? `<div class="sfx" style="position:absolute; left:64px; top:${sfxTop}px; font-size:150px; transform:rotate(-5deg) skew(-11deg); z-index:4;">${d.sfxEn}</div>` : ""}
  ${d.sfxAr ? `<div class="sfx ar" lang="ar" style="position:absolute; right:74px; top:${d.sfxEn ? 1020 : sfxTop}px; font-size:110px; transform:rotate(-6deg); z-index:4; -webkit-text-stroke:7px ${INK}; text-shadow:14px 14px 0 ${INK};">${d.sfxAr}</div>` : ""}

  ${panel({ x: 64, y: 1130, w: 952, h: 360, img: second, pos: "50% 48%", tone: "hatch", pitch: 11, clip: "polygon(0% 0%, 100% 3%, 100% 100%, 0% 96%)" })}

  ${balloon({ x: 104, y: 1262, w: 580, ar: d.ar_line, en: d.en_line, who: d.who, side: "left", arSize: 36, enSize: 25 })}

  <div style="position:absolute; left:64px; top:1546px; display:flex; align-items:baseline; gap:26px;">
    <div style="font-size:72px; font-weight:900; line-height:1;">${d.facts[0][0]}</div>
    <div style="font-size:28px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${RUST};">${d.facts[0][1]}</div>
  </div>
  ${footer({ y: 1630, W, h: 108, label: d.label })}
</div>
${FOOT}`;
}

// ------------------------------------------------------------- write ---
const FORMATS = [
  ["post-square", square], ["post-portrait", portrait],
  ["post-wide", wide], ["story", story],
];
let n = 0;
for (const [prefix, fn] of FORMATS) {
  for (const d of DESIGNS) {
    const name = `${prefix}-${d.id}.html`;
    writeFileSync(resolve(HERE, name), fn(d), "utf8");
    n++;
  }
}
console.log(`wrote ${n} plates into press/social/`);
