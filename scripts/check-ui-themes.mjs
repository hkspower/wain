// The colour schemes (data-ui-theme) hold to the same floor as the rest of the UI.
//
//   npm run check:themes
//
// A scheme swaps the two accents the interface is built on (sodium: actions,
// prices, the selected row; gulf: meters and labels). Nothing here renders
// anything: it reads the tokens in src/app/globals.css, so a scheme can not be
// added with an accent that reads poorly on the night surfaces, with glow
// triplets that disagree with their tokens, or without a stylesheet block.
//
//   1. every scheme in settings.ts (UI_THEMES) has a block in globals.css
//      (the first, sodium, is the :root default), and every block is listed;
//   2. the accents drawn as type (sodium-400, gulf-300, gulf-400) are at least
//      4.5:1 against the darkest and the lightest night surface they sit on
//      (night-950, steel-600), WCAG AA; the 500 fills at least 3:1;
//   3. dark type on the primary accent (the buttons: night-900 on sodium-500) is
//      at least 4.5:1;
//   4. the rgb triplets the glows read equal their hex tokens.
// --self-test breaks a scheme on purpose and checks each rule catches it.
import { readFileSync } from "node:fs";

const css = readFileSync("src/app/globals.css", "utf8");
const settings = readFileSync("src/game/settings.ts", "utf8");

const hex = (name, from = css) => {
  const m = from.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  return m && m[1].toLowerCase();
};
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const triplet = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");

function schemes(cssText) {
  const out = { sodium: {
    p4: hex("sodium-400", cssText), p5: hex("sodium-500", cssText),
    i3: hex("gulf-300", cssText), i4: hex("gulf-400", cssText), i5: hex("gulf-500", cssText),
    rgb: Object.fromEntries([...cssText.matchAll(/^:root \{\s*--accent-rgb:\s*([\d ]+);\s*--accent-hi-rgb:\s*([\d ]+);\s*--info-rgb:\s*([\d ]+);\s*--info-hi-rgb:\s*([\d ]+);/gm)]
      .flatMap((m) => [["accent", m[1]], ["accentHi", m[2]], ["info", m[3]], ["infoHi", m[4]]])),
  } };
  for (const m of cssText.matchAll(/html\[data-ui-theme="([a-z]+)"\]\s*\{([^}]*)\}/g)) {
    const b = m[2];
    const g = (n) => (b.match(new RegExp(`--color-${n}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1]?.toLowerCase();
    const r = (n) => (b.match(new RegExp(`--${n}:\\s*([\\d ]+);`)) || [])[1];
    out[m[1]] = { p4: g("sodium-400"), p5: g("sodium-500"), i3: g("gulf-300"), i4: g("gulf-400"), i5: g("gulf-500"),
      rgb: { accent: r("accent-rgb"), accentHi: r("accent-hi-rgb"), info: r("info-rgb"), infoHi: r("info-hi-rgb") } };
  }
  return out;
}

function audit(cssText) {
  const bad = [];
  const night950 = hex("night-950", cssText), night900 = hex("night-900", cssText), steel600 = hex("steel-600", cssText);
  const sch = schemes(cssText);
  const listed = [...settings.matchAll(/\{\s*id:\s*"([a-z]+)",\s*label:/g)].map((m) => m[1]);
  for (const id of listed) if (!sch[id]) bad.push(`${id}: listed in settings.ts UI_THEMES but has no html[data-ui-theme="${id}"] block`);
  for (const id of Object.keys(sch)) if (!listed.includes(id)) bad.push(`${id}: has a stylesheet block but is not in UI_THEMES`);
  for (const [id, t] of Object.entries(sch)) {
    // The 400 / 300 steps are drawn as type (text-sodium-400, text-gulf-300);
    // the 500s are the saturated fills, gradients and borders, held to the 3:1
    // WCAG asks of a UI component.
    for (const [k, v, floor] of [["p4", t.p4, 4.5], ["i3", t.i3, 4.5], ["i4", t.i4, 4.5], ["p5", t.p5, 3], ["i5", t.i5, 3]]) {
      if (!v) { bad.push(`${id}: token ${k} missing`); continue; }
      for (const [sn, sv] of [["night-950", night950], ["steel-600", steel600]]) {
        const r = ratio(v, sv);
        if (r < floor) bad.push(`${id}: ${k} ${v} is ${r.toFixed(2)}:1 on ${sn}, under ${floor}`);
      }
    }
    if (t.p5) { const r = ratio(night900, t.p5); if (r < 4.5) bad.push(`${id}: dark type on the primary accent ${t.p5} is ${r.toFixed(2)}:1, under 4.5`); }
    const want = { accent: t.p5, accentHi: t.p4, info: t.i4, infoHi: t.i3 };
    for (const [k, h] of Object.entries(want)) {
      if (h && t.rgb[k] !== triplet(h)) bad.push(`${id}: --${k === "accent" ? "accent" : k === "accentHi" ? "accent-hi" : k === "info" ? "info" : "info-hi"}-rgb is "${t.rgb[k]}", its token ${h} is "${triplet(h)}"`);
    }
  }
  return { bad, count: Object.keys(sch).length };
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ["a missing block", css.replace(/html\[data-ui-theme="neon"\]\s*\{[^}]*\}\n/, ""), /neon: listed/],
    ["a dim accent", css.replace(/(html\[data-ui-theme="violet"\][^}]*--color-sodium-400:) #d8b0ff/, "$1 #3a2f55"), /violet: p4/],
    ["dark type on a dark primary", css.replace(/(html\[data-ui-theme="crimson"\][^}]*--color-sodium-500:) #ff4f55/, "$1 #7a2226"), /crimson: .*(primary accent|p5)/],
    ["a glow triplet that disagrees", css.replace(/(html\[data-ui-theme="ice"\][^}]*--accent-rgb:) [\d ]+;/, "$1 1 2 3;"), /ice: --accent-rgb/],
  ];
  let ok = true;
  for (const [name, text, re] of cases) {
    const { bad } = audit(text);
    const hit = bad.some((b) => re.test(b));
    console.log(`  ${hit ? "ok  " : "FAIL"}  ${name}${hit ? "" : ` (got: ${bad.join("; ") || "nothing"})`}`);
    ok &&= hit;
  }
  const { bad } = audit(css);
  console.log(`  ${bad.length === 0 ? "ok  " : "FAIL"}  the shipped stylesheet passes (${bad.length} problems)`);
  process.exit(ok && bad.length === 0 ? 0 : 1);
}

const { bad, count } = audit(css);
if (bad.length) { console.error(bad.map((b) => "  - " + b).join("\n")); console.error(`\n${bad.length} problem(s) in ${count} colour schemes`); process.exit(1); }
console.log(`${count} colour schemes: every accent is at least 4.5:1 on the night surfaces, dark type holds on every primary, and the glow triplets match their tokens`);
