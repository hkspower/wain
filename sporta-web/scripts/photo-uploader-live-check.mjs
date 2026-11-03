// Read-only check that the LIVE compiled admin still has the words the Photos panel finds the Catalogue screen by.
//
//   node scripts/photo-uploader-live-check.mjs            (BASEURL=https://www.sporta.com.kw by default)
//
// WHY THIS EXISTS. findTable() in public/sporta-admin-brands.js (block "ADMIN PHOTO UPLOADER") anchors the panel to
// the Catalogue's product table by its column headers (Product / Price and Web name or On sale) or by the heading
// "Every product in the database". The fixture of that screen was REBUILT from src/admin because the live screen sits
// behind the admin sign-in, and a session may not sign in to the live site. If the compiled build words those
// headers differently the panel simply never appears (it fails closed), and nobody would know why.
//
// WHAT IT DOES, and what it cannot. It signs in to nothing, posts nothing and reads no data: it downloads the
// public index page and the public JavaScript chunks the admin is made of (the same files any visitor can fetch),
// and COUNTS how often each needle occurs as a string literal. It prints counts, never text. A needle with a count
// of zero is a header the panel will not find. What it cannot do: tell which table a literal belongs to, or see the
// rendered DOM, so a clean result means "the words are in the build", not "the panel sits above the product table".
// The last step stays: open /backends once as the owner, Catalogue, and confirm the Photos panel is above the list
// and not above the Comparison table.
//
// Written for the Hostinger one-shot job (node:24-alpine, fetch only): no dollar sign, no template literal, no
// regex end anchor, no filesystem access, so it can be pasted into a compose command or fetched from a pushed sha.
let BASE = process.env.BASEURL || 'https://www.sporta.com.kw'
while (BASE.endsWith('/')) BASE = BASE.slice(0, -1)
const NEEDLES = [
  'Every product in the database', 'Web name', 'On sale', 'Off sale', 'Product', 'Price', 'Site price',
  'Comparison', 'product_image_upload', 'products_all', 'product_save'
]

async function get(path) {
  const url = path.indexOf('http') === 0 ? path : BASE + path
  const res = await fetch(url, { redirect: 'follow' })
  return { status: res.status, text: await res.text() }
}
function count(hay, needle) {
  let n = 0, at = hay.indexOf(needle)
  while (at >= 0) { n++; at = hay.indexOf(needle, at + needle.length) }
  return n
}
function assetsIn(text) {
  const out = new Set()
  let m
  // "assets/Name-hash.js" (Vite's preload map and the entry tag) and "./Name-hash.js" (a lazy import inside a chunk)
  const full = /\/?assets\/[A-Za-z0-9_.-]+\.js/g
  while ((m = full.exec(text))) out.add('/' + m[0].replace(/^\//, ''))
  const rel = /["'`]\.\/([A-Za-z0-9_.-]+\.js)["'`]/g
  while ((m = rel.exec(text))) out.add('/assets/' + m[1])
  return [...out]
}

const index = await get('/')
console.log('index status=' + index.status + ' bytes=' + index.text.length + ' sporta-build-meta=' + (index.text.indexOf('name="sporta-build"') >= 0))
const seen = new Map()
let queue = assetsIn(index.text)
// two hops: the entry chunk names the lazy chunks (AdminApp, Catalogue ...), which may name further ones
for (let hop = 0; hop < 2; hop++) {
  const next = []
  for (const a of queue) {
    if (seen.has(a)) continue
    const r = await get(a)
    seen.set(a, r)
    if (r.status === 200) for (const b of assetsIn(r.text)) if (!seen.has(b)) next.push(b)
  }
  queue = next
}
const totals = {}
for (const n of NEEDLES) totals[n] = 0
const where = {}
for (const [a, r] of seen) {
  if (r.status !== 200) continue
  for (const n of NEEDLES) {
    // as a quoted literal: "Web name", 'Web name' or `Web name`, the way a compiled string appears
    const c = count(r.text, '"' + n + '"') + count(r.text, "'" + n + "'") + count(r.text, '`' + n + '`')
    const loose = n.indexOf(' ') > 0 ? count(r.text, n) : 0   // a multi-word needle also inside longer prose
    const k = Math.max(c, loose)
    if (k > 0) { totals[n] += k; (where[n] = where[n] || []).push(a.split('/').pop() + ':' + k) }
  }
}
console.log('chunks read=' + [...seen.values()].filter((r) => r.status === 200).length + ' of ' + seen.size)
for (const n of NEEDLES) console.log((totals[n] > 0 ? 'FOUND  ' : 'ABSENT ') + n + '  x' + totals[n] + (where[n] ? '  in ' + where[n].slice(0, 4).join(', ') : ''))
const headersOk = totals['Product'] > 0 && totals['Price'] > 0 && (totals['Web name'] > 0 || totals['On sale'] > 0)
const headingOk = totals['Every product in the database'] > 0
console.log('panel anchor words: headers=' + headersOk + ' heading=' + headingOk + (headersOk || headingOk ? '  (the panel can find the screen)' : '  (NOT FOUND: findTable() needs the live wording)'))
process.exit(headersOk || headingOk ? 0 : 1)
