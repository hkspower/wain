// Prove the Arabic type actually landed: the right families load, the
// canvas signage measures differently from the generic fallback (i.e.
// the webfont is really in use), and the CSS cancels the Latin
// letter-spacing/uppercase that would break cursive Arabic.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const C=[process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium","/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find(p=>existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium"); process.exit(2); }
const b = await chromium.launch({executablePath:exe,args:["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"],headless:true});
const page = await b.newPage({viewport:{width:1280,height:720}});
page.setDefaultTimeout(120000);
const fontReqs = [];
page.on("response",(r)=>{ if(/\.(woff2?|ttf)(\?|$)/.test(r.url())) fontReqs.push(r.url().split("/").pop().slice(0,40)); });
await page.goto("http://localhost:3000/race",{waitUntil:"networkidle"});
await page.evaluate(()=>{localStorage.clear();localStorage.setItem("gulf-road-nights-onboarded","2");localStorage.setItem("gulf-road-nights-coach","3");});
await page.reload({waitUntil:"networkidle"});
await page.click("text=START ENGINE");
await page.waitForFunction(()=>!!window.__grnDebug,null,{timeout:120000});
await page.evaluate(()=>document.fonts.ready);
await page.waitForTimeout(1500);

const fail=[]; const check=(c,m)=>{if(!c)fail.push(m);return c?"ok":"FAIL";};
const r = await page.evaluate(async ()=>{
  const cs = getComputedStyle(document.body);
  const stacks = {
    arabic: cs.getPropertyValue("--font-arabic").trim(),
    arabicDisplay: cs.getPropertyValue("--font-arabic-display").trim(),
    arabicSign: cs.getPropertyValue("--font-arabic-sign").trim(),
  };
  // Loaded faces the document actually has
  const loaded = [...document.fonts].filter(f=>f.status==="loaded").map(f=>f.family);
  // Does canvas really use the webfont? Compare widths vs a generic.
  const c = document.createElement("canvas").getContext("2d");
  const word = "طريق الخليج العربي";
  const widths = {};
  for (const [k, stack] of Object.entries(stacks)) {
    c.font = `700 40px ${stack}`; const w1 = c.measureText(word).width;
    c.font = `700 40px monospace`; const w2 = c.measureText(word).width;
    widths[k] = { webfont: +w1.toFixed(1), fallback: +w2.toFixed(1), differs: Math.abs(w1-w2) > 1 };
  }
  // The typography rules that keep Arabic from being set as Latin
  const probe = document.createElement("span");
  probe.className = "grn-label grn-ar";
  probe.textContent = "على المحك";
  document.body.appendChild(probe);
  const ps = getComputedStyle(probe);
  const rules = { letterSpacing: ps.letterSpacing, textTransform: ps.textTransform,
                  fontStyle: ps.fontStyle, direction: ps.direction, family: ps.fontFamily.split(",")[0] };
  probe.remove();
  return { stacks, loaded, widths, rules };
});
console.log("font files fetched:", [...new Set(fontReqs)].length);
for (const [k,v] of Object.entries(r.stacks)) console.log(`  ${k}: ${v.split(",")[0]}`);
console.log("loaded faces:", [...new Set(r.loaded)].join(", ").slice(0,120));
for (const [k,v] of Object.entries(r.widths))
  console.log(`  canvas ${k}: ${v.webfont}px vs generic ${v.fallback}px  ${check(v.differs, `${k} canvas text fell back to a generic face`)}`);
console.log(`grn-ar rules: spacing=${r.rules.letterSpacing} transform=${r.rules.textTransform} style=${r.rules.fontStyle} dir=${r.rules.direction}`);
check(r.rules.letterSpacing === "normal", "letter-spacing still prising apart cursive Arabic");
check(r.rules.textTransform === "none", "uppercase transform still applied to Arabic");
check(r.rules.fontStyle === "normal", "Arabic still inheriting a synthetic italic");
check(r.rules.direction === "rtl", "Arabic not set right-to-left");
check(r.stacks.arabic.includes("IBM") || r.stacks.arabic.includes("Plex") || /^__/.test(r.stacks.arabic), "arabic stack not wired");
// ---- every Arabic run in the DOM, not just the ones with a class -----
//
// The stacks above being right does not mean the page uses them. Arabic
// inside an element set to a Latin family does not fail loudly: the
// browser falls back per GLYPH, quietly, to whatever Arabic face the
// operating system happens to carry — a different one on every machine.
// That is exactly what every Arabic string outside the game UI was
// doing, and nothing here would have caught it, because the class-based
// probe above only ever looked at elements that already had the class.
//
// So: sweep the real DOM, find the Arabic, and ask two questions of each
// run — is an Arabic family anywhere in the stack it will actually
// resolve against, and does the markup say what language it is.
const AR_FAMILIES = ["Plex", "Cairo", "Naskh", "Arabic"];
const sweep = async (url, label) => {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const runs = await page.evaluate(() => {
    const AR = /[؀-ۿݐ-ݿ]/;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const out = [];
    const seen = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.trim();
      if (!t || !AR.test(t)) continue;
      const el = n.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      out.push({
        text: t.slice(0, 20),
        stack: cs.fontFamily,
        lang: el.closest("[lang]")?.getAttribute("lang") ?? "",
      });
    }
    return out;
  });
  const noFace = runs.filter((r) => !AR_FAMILIES.some((f) => r.stack.includes(f)));
  const noLang = runs.filter((r) => r.lang !== "ar");
  console.log(`\n${label}: ${runs.length} Arabic runs on screen`);
  console.log(`  with an Arabic family in the stack: ${runs.length - noFace.length}/${runs.length}  ` +
    check(noFace.length === 0,
      `${label}: ${noFace.length} Arabic runs set in a Latin-only stack — e.g. "${noFace[0]?.text}" in ${noFace[0]?.stack.split(",")[0]}`));
  console.log(`  marked lang="ar": ${runs.length - noLang.length}/${runs.length}  ` +
    check(noLang.length === 0,
      `${label}: ${noLang.length} Arabic runs not marked lang="ar" — e.g. "${noLang[0]?.text}" is announced as ${noLang[0]?.lang || "untagged"}`));
  return runs.length;
};
// The marketing pages are where this was broken; the race UI is where
// the Arabic type was designed. Both have to hold.
const home = await sweep("http://localhost:3000/", "home");
check(home > 0, "no Arabic found on the home page at all — the sweep is not reading anything");
await sweep("http://localhost:3000/places/kuwait-towers", "place page");

console.log(fail.length?"\nFAILURES:\n - "+fail.join("\n - "):"\nall font checks passed");
await b.close();
process.exit(fail.length?1:0);
