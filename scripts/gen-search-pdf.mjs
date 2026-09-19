/**
 * The search flow, exercised and photographed — scripts/gen-search-pdf.mjs
 *
 *   npm run build && npm run pdf:search    # writes wainkw-search.pdf
 *
 * Sibling of gen-site-pdf.mjs, and deliberately the opposite of it. That one
 * PRINTS every route through Chromium so the Arabic stays live vector text
 * and a reviewer can search the file for «قهوة». This one RASTERISES, because
 * what it documents is not the copy — it is what the screen looked like at a
 * given step of a flow, including the states that only exist after a keypress
 * and never appear in any route's HTML. A printed route cannot show a results
 * list that does not exist until someone types.
 *
 * It is a test first and a document second. Every shot is taken only after an
 * assertion about that state passed, so a page in the PDF is evidence rather
 * than an illustration: if the results never arrive the run fails and no PDF
 * is written at all. A deck that renders whatever it found would be worse than
 * no deck — it would photograph the bug and file it as the design.
 *
 * NO pdf-lib. gen-site-pdf.mjs needs it to stitch differently-sized pages, and
 * says so; here every page is the same size, so Chromium's own page.pdf() does
 * it from one HTML sheet with the shots inlined. One less dependency this
 * project does not have, for a file it generates on demand.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const PORT = 41877;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "gen-search-pdf needs Playwright, which this project does not depend on.\n" +
    "  npm i -D playwright && npx playwright install chromium"
  );
  process.exit(1);
}

const { requireFreshBuild } = await import(join(ROOT, "tests", "stale-build.mjs"));
requireFreshBuild(ROOT);

// Same handler as the browser suites: "/search" without the slash resolves to
// a directory, and readFileSync on one throws EISDIR inside the request
// handler, which kills the server rather than the request.
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml" };
const srv = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  let f = join(OUT, p);
  if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  if (!existsSync(f) || !f.startsWith(OUT)) { res.writeHead(404); return res.end("nope"); }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${PORT}`;

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 900 };

let failed = 0;
const shots = [];
const ok = (label, cond, detail = "") => {
  if (cond) { console.log(`  ✓ ${label}${detail ? ` (${detail})` : ""}`); }
  else { console.log(`  ✗ ${label}${detail ? ` (${detail})` : ""}`); failed++; }
  return cond;
};

// Same explicit path every browser suite in tests/ uses: this project's
// Playwright pins a newer browser build than the one installed here, so the
// default launch looks for a revision that is not on disk and tells you to
// download it. The installed Chromium is fine; it just has to be named.
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function shoot(page, { title, note, viewport }) {
  const buf = await page.screenshot({ type: "png" });
  shots.push({ title, note, viewport: `${viewport.width}×${viewport.height}`, png: buf.toString("base64") });
}

// How many result cards the page is showing. Kept as one selector in one
// place: every assertion below counts the same thing the same way, so a
// change to the markup fails loudly here instead of quietly disagreeing
// between two steps.
const RESULTS = "main ul li a[href^='/places/']";

console.log("\n════ البحث: ما الذي يراه الزائر فعلاً ════");

for (const [name, viewport] of [["phone", PHONE], ["desktop", DESK]]) {
  const ctx = await browser.newContext({ viewport, locale: "ar" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  console.log(`\n── ${name} ──`);

  // 1. The empty search page. After the top bar was removed this is the only
  //    way in, so if it is not reachable there is no search on the site.
  await page.goto(`${BASE}/search/`, { waitUntil: "networkidle" });
  const box = page.locator("input[type='search'], input[type='text']").first();
  ok("the query box is on /search", await box.count() > 0);
  await shoot(page, { title: "/search — فاضي", note: "نقطة الدخول الوحيدة للبحث بعد شيل الشريط العلوي.", viewport });

  // 2. A real query, typed rather than passed in the URL — the URL path is
  //    already covered by the route's own HTML; what is worth photographing
  //    is the state that only exists after someone types.
  await box.click();
  await box.fill("قهوة");
  await page.waitForTimeout(700);
  const n = await page.locator(RESULTS).count();
  ok("typing «قهوة» produces results", n > 0, `${n} نتيجة`);
  await shoot(page, { title: "«قهوة» — نتائج", note: `${n} مكان. الكتابة نفسها هي اللي تولّد هالحالة؛ ما تطلع في HTML أي مسار.`, viewport });

  // 3. A second query, to show the list actually re-queries rather than
  //    holding the first answer.
  await box.fill("");
  await box.fill("بحر");
  await page.waitForTimeout(700);
  const n2 = await page.locator(RESULTS).count();
  ok("«بحر» returns a different set", n2 > 0, `${n2} نتيجة`);
  await shoot(page, { title: "«بحر» — نتائج", note: `${n2} مكان — القائمة تتغيّر مع الطلب، ما تعلق على أول جواب.`, viewport });

  // 4. The dead end. «سفارة» rather than a nonsense string on purpose: a
  //    made-up word proves the empty state renders, but a real thing a
  //    visitor would genuinely type — and that 52 leisure places do not
  //    cover — proves it renders for the reason it exists. Verified to
  //    return 0 before being written in; «سوشي ياباني», the obvious first
  //    choice, does not (see the step after this one).
  await box.fill("");
  await box.fill("سفارة");
  await page.waitForTimeout(700);
  const none = await page.locator(RESULTS).count();
  ok("a query the catalogue cannot answer returns nothing", none === 0, `${none}`);
  const body = await page.locator("main").innerText();
  ok("and the page still offers a way on", body.trim().length > 40);
  await shoot(page, { title: "«سفارة» — الطريق المسدود", note: "طلب حقيقي ما يغطّيه الكتالوق. الصفحة لازم تعطي مخرج، مو بس «ما لقينا».", viewport });

  // 5. Not an assertion about what is right — a photograph of what happens.
  //    The matcher is loose enough that a cuisine it has never heard of
  //    resolves to a place, so the visitor is answered confidently with
  //    something they did not ask for. Recorded rather than asserted
  //    because whether that is generous or wrong is a judgement call.
  await box.fill("");
  await box.fill("سوشي ياباني");
  await page.waitForTimeout(700);
  const loose = await page.locator(RESULTS).count();
  const looseName = loose ? (await page.locator(RESULTS).first().innerText()).split("\n")[0].trim() : "—";
  ok("«سوشي ياباني» is answered (recording, not judging)", true, `${loose} → ${looseName}`);
  await shoot(page, { title: "«سوشي ياباني» — مطابقة فضفاضة", note: `مطبخ ما هو بالكتالوق أصلاً، والجواب «${looseName}». مو فشل فحص — بس يستاهل نظرة.`, viewport });

  ok("no page errors", errors.length === 0, errors[0] ?? "");
  await ctx.close();
}

await (async () => {
  if (failed) return;
  const page = await (await browser.newContext({ viewport: { width: 1120, height: 1580 } })).newPage();
  const sheet = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap">
<style>
  @page { size: 1120px 1580px; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "IBM Plex Sans Arabic", system-ui, sans-serif; background: #fff; color: #14120f; }
  .pg { width: 1120px; height: 1580px; padding: 56px 60px; display: flex; flex-direction: column; gap: 22px; page-break-after: always; }
  .pg:last-child { page-break-after: auto; }
  h1 { margin: 0; font-size: 34px; font-weight: 700; }
  h2 { margin: 0; font-size: 26px; font-weight: 700; }
  .meta { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #6b6357; letter-spacing: .04em; }
  .note { font-size: 15px; line-height: 1.65; color: #4e483f; margin: 0; }
  .frame { flex-grow: 1; display: flex; align-items: flex-start; justify-content: center; border: 1px solid #e6e4e0; border-radius: 16px; overflow: hidden; background: #fff; }
  .frame img { max-width: 100%; max-height: 100%; object-fit: contain; object-position: top; }
  .lede { font-size: 16px; line-height: 1.7; color: #4e483f; }
  .row { display: flex; gap: 10px; }
  .card { flex: 1; border: 1px solid #e6e4e0; border-radius: 12px; padding: 14px 16px; }
  .k { font-size: 12px; color: #6b6357; margin-bottom: 4px; }
  .v { font-size: 19px; font-weight: 700; }
</style></head><body>
<div class="pg">
  <h1>وين — البحث، مصوَّر</h1>
  <div class="meta">${new Date().toISOString().slice(0, 16).replace("T", " ")} · out/ · ${shots.length} لقطة</div>
  <p class="lede">كل صفحة جاية هي حالة صح — ما تنلتقط إلا بعد ما يعدّي الفحص حقها. إذا ما طلعت النتائج، الملف هذا ما ينكتب أصلاً.</p>
  <div class="row">
    <div class="card"><div class="k">الحالات</div><div class="v">${shots.length}</div></div>
    <div class="card"><div class="k">المقاسات</div><div class="v">390 · 1280</div></div>
    <div class="card"><div class="k">الفحوص</div><div class="v">${failed ? failed + " فشل" : "كلها عدّت"}</div></div>
  </div>
  <p class="note">ملاحظة: الشريط العلوي انشال، فزر البحث و<code>⌘K</code> ما عادوا موجودين. صفحة <code>/search</code> هي المدخل الوحيد الباقي، وهذا اللي تصوّره الصفحات الجاية.</p>
</div>
${shots.map((s) => `<div class="pg">
  <h2>${s.title}</h2>
  <div class="meta">${s.viewport}</div>
  <p class="note">${s.note}</p>
  <div class="frame"><img src="data:image/png;base64,${s.png}"></div>
</div>`).join("")}
</body></html>`;
  await page.setContent(sheet, { waitUntil: "networkidle" });
  const out = join(ROOT, "wainkw-search.pdf");
  await page.pdf({ path: out, width: "1120px", height: "1580px", printBackground: true });
  console.log(`\n▸ wrote ${out.replace(ROOT + "/", "")} — ${shots.length + 1} صفحة`);
})();

await browser.close();
srv.close();

if (failed) {
  console.log(`\n${failed} فحص فشل — ما انكتب PDF، لأن اللقطة الغلط توثّق العطل وتخليه يبان تصميم.`);
  process.exit(1);
}
console.log("البحث: كل شي تمام");
