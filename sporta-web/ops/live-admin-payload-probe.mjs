// READ-ONLY probe: what does the LIVE (compiled) /backends send for the routes whose boolean rule got stricter in this release?
// GET only, public files only (the site's own scripts), no sign-in, nothing posted. Prints a short window of code around each
// route name so the payload shape can be read: is `active` / `paid` a real boolean, or a string / number / absent?
//
// WHY (release gate, reviewer 3, 2026-11-18): admin.php now answers 400 invalid_active / invalid_paid unless `active` / `paid` is a
// real JSON boolean (product_active, brand_active, slide_save, discount_save, discount_active, cod_paid). The live admin is a build
// whose source is not in this repo, so the only way to know it still works is to read what it sends.
const B = 'https://www.sporta.com.kw'
const say = (s) => console.log(s)
const ROUTES = ['product_active', 'brand_active', 'slide_save', 'discount_save', 'discount_active', 'cod_paid', 'brand_save', 'product_save']
const get = async (p) => { const r = await fetch(B + p, { redirect: 'follow' }); return { status: r.status, text: await r.text() } }

const page = await get('/backends')
say(`/backends ${page.status}, ${page.text.length} bytes`)
const queue = [...page.text.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1])
const seen = new Set()
const hits = {}
let bytes = 0
while (queue.length && seen.size < 80 && bytes < 12e6) {
  const a = queue.shift()
  if (seen.has(a)) continue
  seen.add(a)
  const f = await get(a)
  bytes += f.text.length
  if (f.status !== 200) continue
  // chunks name each other as "./Name-hash.js" or "assets/Name-hash.js"
  for (const m of f.text.matchAll(/["'`]\.?\/?(?:assets\/)?([A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,12}\.js)["'`]/g)) queue.push('/assets/' + m[1])
  for (const r of ROUTES) {
    let i = -1
    while ((i = f.text.indexOf(r, i + 1)) >= 0 && (hits[r]?.length ?? 0) < 4) {
      const ctx = f.text.slice(Math.max(0, i - 90), i + r.length + 150).replace(/\s+/g, ' ')
      ;(hits[r] ??= []).push(`${a}: ...${ctx}...`)
    }
  }
}
say(`scripts read: ${seen.size} (${Math.round(bytes / 1024)} kB)`)
for (const r of ROUTES) {
  say(`== ${r}: ${hits[r]?.length ?? 0} place(s)`)
  for (const h of hits[r] ?? []) say(h)
}
say('PROBE_DONE')
