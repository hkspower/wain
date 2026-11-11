// Sporta icon set: builds the ICON SET section of public/sporta-shadows.css and brand/iconset/preview.html from the
// hand-drawn source glyphs in brand/iconset/*.svg (repo root /brand, which never ships).
//
//   node scripts/build-iconset.mjs           write the section into sporta-shadows.css and write preview.html
//   node scripts/build-iconset.mjs --check   exit 1 if either is not what the sources produce (the suite runs this)
//
// How the swap works on the live (compiled, foreign) storefront: every icon there is an inline <svg> with its own box
// (width/height attributes, re-tuned by the ICONS section). The section keeps that <svg> - its box, its position, its
// transforms (hover grow, the build's rtl:rotate-180, the ICONS section's RTL `scale`), its colour - and only changes
// what is painted inside it: the original shapes are made invisible and the box is painted in currentColor through a
// CSS mask that is the new glyph. Nothing in the markup or the bundle changes, and taking the section out restores the
// old glyphs exactly.
//
// The stroke: the mask image is an SVG whose shapes carry vector-effect="non-scaling-stroke", so the line is the same
// width in screen pixels at every box size (measured in Chromium: 1.50px at 14, 18, 22 and 48px boxes). Two widths,
// the ICONS section's two tokens: 1.5px up to a 20px box, 1.75px from 21px. A data: URI cannot read a CSS variable, so
// the two numbers are written here (TIERS) and must follow --sporta-icon-stroke / --sporta-icon-stroke-lg if those move.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SET = join(ROOT, '..', 'brand', 'iconset')
export const CSS_FILE = join(ROOT, 'public', 'sporta-shadows.css')
export const START = '/* ==== ICON SET'
export const END = '/* ==== end ICON SET */'
export const TIERS = { sm: 1.5, lg: 1.75 }

// ---- the sources ---------------------------------------------------------------------------------------------------
export const glyphs = () => Object.fromEntries(readdirSync(SET).filter((f) => f.endsWith('.svg')).sort().map((f) => {
  const src = readFileSync(join(SET, f), 'utf8')
  const name = f.slice(0, -4)
  const title = (src.match(/<title>([^<]*)<\/title>/) || [])[1] || name
  const inner = src.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[^<]*<\/title>/, '').trim()
  return [name, { name, title, inner, src, directional: /data-directional="true"/.test(src) }]
}))

// The glyph as a mask image: black on transparent, every shape with a non-scaling stroke of `sw` screen px.
export const maskSvg = (g, sw) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" data-glyph="${g.name}">`
  + g.inner.replace(/currentColor/g, '#000').replace(/<(path|circle|rect|line|polyline|polygon|ellipse)\b/g, '<$1 vector-effect="non-scaling-stroke"') + '</svg>'
export const uri = (svg) => `url("data:image/svg+xml,${svg.replace(/"/g, "'").replace(/[%<>#\n]/g, encodeURIComponent)}")`

// ---- where each glyph goes ------------------------------------------------------------------------------------------
// S = scoped to the storefront and its bag drawer (the admin is never touched). Glyphs are recognised by the exact shape data of the live
// build's icon (it is a fixed, compiled build: these strings are its own), or by the control they sit in where that is
// as stable. `lg` = the glyph is also drawn at a box of 21px or more somewhere (gets the 1.75px variant).
// The bag drawer is portalled to <body>, outside .storefront-root (scripts/make-sizes-fixtures.mjs), so it is named too.
const S = ':root :is(.storefront-root, .campaign-cart-drawer)'
const I = `${S} svg.sporta-icon`
const has = (shape) => `:has(> ${shape})`
export const RULES = [
  // header
  { g: 'assistant', where: 'header: the "Sporta AI" launcher', sel: [`${S} .navbar-ai > svg.sporta-icon`, `${I}${has('path[d="M12 3v4M8 12h.01M16 12h.01M8 16h8"]')}`] },
  { g: 'globe', where: 'header: language switch', sel: [`${S} .navbar-language > svg.sporta-icon`, `${I}${has('ellipse[rx="4"][ry="9.5"]')}`] },
  { g: 'bag', where: 'header bag, bag drawer mark, product "Add" button', lg: true, sel: [`${I}${has('path[d="M5 7H19L20 21H4Z"]')}`] },
  // product cards and product page
  { g: 'heart', where: 'card wishlist, product-page wishlist', sel: [`${I}${has('path[d="M12 20.5 4 12.5a5 5 0 0 1 8-6.5 5 5 0 0 1 8 6.5Z"]')}`] },
  { g: 'heart-filled', where: 'the same, when saved (the build fills the heart)', sel: [`${I}[fill="currentColor"]${has('path[d="M12 20.5 4 12.5a5 5 0 0 1 8-6.5 5 5 0 0 1 8 6.5Z"]')}`, `${S} [aria-pressed="true"] > svg.sporta-icon${has('path[d="M12 20.5 4 12.5a5 5 0 0 1 8-6.5 5 5 0 0 1 8 6.5Z"]')}`] },
  { g: 'plus', where: 'card add-to-bag, quantity +', sel: [`${I}${has('path[d="M12 5V19M5 12H19"]')}`, `${I}${has('path[d="M12 5v14M5 12h14"]')}`] },
  { g: 'minus', where: 'quantity -', sel: [`${I}${has('path[d="M5 12H19"]')}`, `${I}${has('path[d="M5 12h14"]')}`] },
  { g: 'close', where: 'drawer close, remove a line, "not returnable" row', lg: true, sel: [`${I}${has('path[d="M6 6 18 18M18 6 6 18"]')}`, `${I}${has('path[d="M18 6 6 18M6 6l12 12"]')}`] },
  { g: 'trash', where: 'drawer remove (the build that draws a bin)', sel: [`${I}${has('path[d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"]')}`] },
  { g: 'zoom', where: 'product gallery zoom hint', sel: [`${I}${has('circle[cx="10.5"][cy="10.5"][r="6.5"]')}`] },
  { g: 'ruler', where: 'product page "Size guide"', sel: [`${I}${has('rect[x="3"][y="7"][width="18"][height="10"]')}`] },
  { g: 'check', where: 'colour swatch, selected', sel: [`${I}${has('path[d="M4 12 9 17 20 6"]')}`] },
  { g: 'check', where: 'product page "what you get" list (viewBox 20, no class)', sel: [`${S} svg${has('path[d="M4 10.5l4 4 8-9"]')}`] },
  { g: 'truck', where: 'delivery: product reassurance, features tile, contact "Track order"', lg: true, sel: [`${I}${has('path[d^="M2 18V5H14V18"]')}`] },
  { g: 'card', where: 'product reassurance: card payment', sel: [`${I}${has('path[d="M2 10H22M6 15H10"]')}`] },
  { g: 'returns', where: 'product reassurance, features tile (mirrored in RTL by the ICONS section)', lg: true, sel: [`${I}${has('path[d^="M8 3 4 7 8 11"]')}`] },
  { g: 'cash', where: 'footer "Cash on delivery", features tile', lg: true, sel: [`${I}${has('path[d="M5.5 11V13M18.5 11V13"]')}`] },
  { g: 'lock', where: 'bag drawer note, cart "secure" line', sel: [`${I}${has('path[d="M8 10V7a4 4 0 0 1 8 0V10M12 15V17"]')}`] },
  // arrows
  { g: 'arrow-right', where: 'hero "Shop now", "View all", brands CTA, hero prev / next (the build rotates them in RTL)', sel: [`${I}${has('path[d="M5 12h14M12 5l7 7-7 7"]')}`] },
  { g: 'arrow-up-right', where: 'home category tiles (the build mirrors the tile arrow in RTL)', lg: true, sel: [`${I}${has('path[d="M7 17 17 7M7 7h10v10"]')}`] },
  { g: 'chevron-down', where: 'checkout: the area / governorate list toggle (viewBox 20, no class)', sel: [`${S} svg${has('path[d="M5 8l5 5 5-5"]')}`] },
  { g: 'pause', where: 'home hero: pause the slideshow (viewBox 16, filled)', sel: [`${S} svg${has('path[d="M4 2h3v12H4zM9 2h3v12H9z"]')}`] },
  // footer and contact
  { g: 'whatsapp', where: 'footer "Message us", footer socials, contact WhatsApp card', lg: true, sel: [`${I}${has('path[d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"]')}`] },
  { g: 'instagram', where: 'footer socials', sel: [`${I}${has('path[d="M17.5 6.5h.01"]')}`] },
  { g: 'tiktok', where: 'footer socials', sel: [`${I}${has('path[d^="M14 4v11.2"]')}`] },
  // the features band that sporta-features.js builds (#sporta-features: own markup, colours written on the shapes)
  { g: 'chevron-right', where: 'features band "Shop now" (English)', color: '#000000', sel: [`.sf .sf__btn > svg${has('path[d="M9 6l6 6-6 6"]')}`] },
  { g: 'chevron-left', where: 'features band "Shop now" (Arabic)', color: '#000000', sel: [`.sf .sf__btn > svg${has('path[d="M15 6l-6 6 6 6"]')}`] },
  { g: 'whatsapp', where: 'features band WhatsApp button (WhatsApp green, as before)', color: '#25d366', sel: [`.sf .sf__btn--wa > svg`] },
  { g: 'truck', where: 'features band: 24-hour delivery', color: '#000000', lg: true, sel: [`.sf .sf__icon > svg${has('path[d="M3 7h11v9H3z"]')}`] },
  { g: 'returns', where: 'features band: free returns (mirrored in RTL here)', color: '#000000', lg: true, sel: [`.sf .sf__icon > svg${has('path[d="M4 12a8 8 0 1 0 2.3-5.6"]')}`] },
  { g: 'shield', where: 'features band: 100% authentic', color: '#000000', lg: true, sel: [`.sf .sf__icon > svg${has('path[d^="M12 3l7 3v5"]')}`] },
  { g: 'chat', where: 'features band: WhatsApp support', color: '#000000', lg: true, sel: [`.sf .sf__icon > svg${has('path[d^="M21 12a8.5 8.5"]')}`] },
]
// Mirrored in RTL by THIS section (everything else directional is mirrored by the build or by the ICONS section).
export const MIRROR = [
  `:root[dir="rtl"] .sf .sf__icon > svg${has('path[d="M4 12a8 8 0 1 0 2.3-5.6"]')}`,
]
// Drawn by REGCONTACT [rc-8] as a ::before mask (26px): the new envelope and bubble take the place of the old ones.
export const RC8 = [
  { g: 'envelope', sel: '.storefront-root .editorial-page:has(> .support-cards) .support-card:has(> a[href^="mailto:"])' },
  { g: 'chat', sel: '.storefront-root .editorial-page:has(> .support-cards) .support-card:has(> a[href="/support"])' },
]
// Box sizes that take the 1.75px stroke (the ICONS section's [icons-1] list), plus the two places sized in CSS.
const LG_BOX = ['21', '22', '23', '24', '26', '28', '32'].map((w) => `[width="${w}"]`).join(', ')

// ---- the CSS section ------------------------------------------------------------------------------------------------
export const section = () => {
  const G = glyphs()
  const used = new Map()
  for (const r of [...RULES, ...RC8.map((x) => ({ ...x, lg: true }))]) {
    if (!G[r.g]) throw new Error(`no source for glyph "${r.g}" in brand/iconset`)
    const u = used.get(r.g) || { lg: false }; u.lg ||= !!r.lg; used.set(r.g, u)
  }
  const L = []
  L.push(`${START} (2026-11-11, owner: "build full new set icons sporta style") =====================================
 * One custom Sporta icon set replaces the glyphs the shopper sees. GENERATED by scripts/build-iconset.mjs from the
 * hand-drawn sources in /brand/iconset/*.svg (preview: /brand/iconset/preview.html): edit a source, run the script,
 * never edit this section by hand (npm run test:iconset fails when it drifts).
 *
 * The family: 24 grid, 2-unit margin, round caps and joins, 2.5 corner radius on cards and boxes, one stroke in screen
 * pixels (1.5px up to a 20px box, 1.75px from 21px: the ICONS section's two tokens), and a short trailing speed dash on
 * the things that move (the arrows, the delivery truck). The bag carries the Sporta swoosh across its front.
 *
 * The technique: each live icon keeps its own <svg> box, position, transforms and colour. Its shapes are made invisible
 * and the box is painted in currentColor through a mask that is the new glyph, so hover / active colours, the build's
 * rtl:rotate-180 on the arrows, the ICONS section's RTL mirroring of the returns arrow, the hover grow and the box
 * scale all keep working, and there is no layout shift. Each live icon is recognised by the exact shape data of the
 * compiled build (a fixed build: these strings are its own) or by its control. Mirrored in RTL here: the features band
 * returns arrow (the build already mirrors the hero / "View all" arrows and the category tile arrow). NOT mirrored (deliberately): the truck (owner decision pending in the
 * ICONS section notes; one MIRROR line in the script if wanted), the bag, the heart and every symmetric glyph.
 * The live clock (sporta-clock.css) is a working clock, not a glyph, and is left alone.
 * Proven by npm run test:iconset on the captured live markup under the live rules (the section removed fails it).
 * ===================================================================================================================== */`)
  L.push(':root {')
  for (const [n, u] of [...used].sort(([a], [b]) => a.localeCompare(b))) {
    L.push(`  --sig-${n}: ${uri(maskSvg(G[n], TIERS.sm))};`)
    if (u.lg) L.push(`  --sig-${n}-lg: ${uri(maskSvg(G[n], TIERS.lg))};`)
  }
  L.push('}')
  const all = []
  for (const r of RULES) {
    L.push(`/* ${r.g}: ${r.where} */`)
    L.push(`${r.sel.join(',\n')} {\n  --si: var(--sig-${r.g});\n  --si-lg: var(--sig-${r.g}${used.get(r.g).lg ? '-lg' : ''});${r.color ? `\n  --si-color: ${r.color};` : ''}\n}`)
    all.push(...r.sel)
  }
  const ALL = `:is(\n  ${all.join(',\n  ')}\n)`
  L.push('/* the swap: the old shapes are hidden, the box is painted through the new glyph */')
  L.push(`${ALL} {\n  background-color: var(--si-color, currentColor);\n  -webkit-mask: var(--si) center / 100% 100% no-repeat;\n  mask: var(--si) center / 100% 100% no-repeat;\n}`)
  L.push(`${ALL}:is(${LG_BOX}),\n:root .storefront-root .home-feature-icon > svg.sporta-icon,\n.sf .sf__icon > svg {\n  -webkit-mask-image: var(--si-lg, var(--si));\n  mask-image: var(--si-lg, var(--si));\n}`)
  L.push(`${ALL} > * {\n  visibility: hidden;\n}`)
  L.push('/* direction: mirrored in RTL (the individual `scale` property composes with the hover transform) */')
  L.push(`${MIRROR.join(',\n')} {\n  scale: -1 1;\n}`)
  L.push('/* Contact [rc-8]: the envelope and the bubble drawn by REGCONTACT come from this set too (26px box) */')
  for (const x of RC8) L.push(`:root ${x.sel} {\n  --rc-icon: var(--sig-${x.g}-lg);\n}`)
  L.push(`${END}`)
  return L.join('\n') + '\n'
}

// ---- the preview page -------------------------------------------------------------------------------------------------
export const preview = () => {
  const G = glyphs()
  const names = Object.keys(G)
  const where = (n) => [...new Set([...RULES.filter((r) => r.g === n).map((r) => r.where), ...RC8.filter((r) => r.g === n).map(() => 'contact page card')])]
  const vars = names.map((n) => `--p-${n}:${uri(maskSvg(G[n], TIERS.sm))};--p-${n}-lg:${uri(maskSvg(G[n], TIERS.lg))};`).join('\n')
  const icon = (n, px) => `<i class="ic${G[n].directional ? ' dir' : ''}" style="--m:var(--p-${n}${px >= 21 ? '-lg' : ''});width:${px}px;height:${px}px" aria-hidden="true"></i>`
  const big = (n) => `<span class="big${G[n].directional ? ' dir' : ''}">${G[n].src.replace(/<title>[^<]*<\/title>/, '').replace('<svg ', '<svg width="48" height="48" aria-hidden="true" ')}</span>`
  const card = (n) => {
    const w = where(n)
    return `<li class="card"><div class="row">${[16, 20, 24].map((s) => icon(n, s)).join('')}${big(n)}</div><div class="name">${n}${G[n].directional ? ' <span class="tag">mirrors in RTL</span>' : ''}</div><div class="desc">${G[n].title}</div><div class="use">${w.length ? 'Live: ' + w.join('; ') : 'In the set, not on the live pages captured so far'}</div></li>`
  }
  const panel = (dir, tone) => `<section class="panel ${tone}" dir="${dir}"><h2>${tone === 'orange' ? 'Burnt orange #E0561C' : tone === 'charcoal' ? 'Charcoal #171A1E on beige' : 'Bright #FF7B17 on charcoal'} · ${dir.toUpperCase()}</h2><ul class="grid">${names.map(card).join('')}</ul></section>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sporta Icon Set</title>
<!-- GENERATED by sporta-web/scripts/build-iconset.mjs from the *.svg files beside this page. Do not edit by hand. -->
<style>
:root{${vars}
--orange:#e0561c;--orange-hover:#b8430f;--bright:#ff7b17;--charcoal:#171a1e;--beige:#e2dbce;--paper:#f6f3ee}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--charcoal);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:32px 16px 8px;max-width:1240px;margin:0 auto}
h1{margin:0 0 4px;font-size:28px;letter-spacing:-.01em}
header p{margin:0;max-width:72ch;color:#4b5058}
.panel{max-width:1240px;margin:24px auto;padding:20px 16px;border-radius:16px}
.panel h2{margin:0 0 16px;font-size:15px;letter-spacing:.04em;text-transform:uppercase}
.panel.orange{background:#fff;color:var(--orange)}
.panel.charcoal{background:var(--beige);color:var(--charcoal)}
.panel.dark{background:var(--charcoal);color:var(--bright)}
.panel h2,.panel .desc,.panel .use,.panel .name{color:var(--charcoal)}
.panel.dark h2,.panel.dark .desc,.panel.dark .use,.panel.dark .name{color:#e8e4dc}
.grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.card{padding:14px;border-radius:12px;background:rgba(127,127,127,.06);border:1px solid rgba(127,127,127,.18)}
.row{display:flex;align-items:center;gap:14px;min-height:52px}
.ic{display:inline-block;flex:none;background-color:currentColor;-webkit-mask:var(--m) center/100% 100% no-repeat;mask:var(--m) center/100% 100% no-repeat}
.big{display:inline-flex;margin-inline-start:auto}
[dir=rtl] .dir{scale:-1 1}
.name{margin-top:8px;font-weight:700;font-size:14px}
.tag{font-weight:600;font-size:11px;padding:1px 6px;border-radius:99px;background:rgba(224,86,28,.14);color:#9a3a10}
.panel.dark .tag{color:#ffb27a}
.desc{font-size:13px}
.use{font-size:12px;opacity:.75;margin-top:2px}
.ctx{max-width:1240px;margin:24px auto;padding:0 16px}
.bar{display:flex;align-items:center;gap:10px;background:var(--charcoal);color:#fff;border-radius:14px;padding:10px 16px}
.bar .sp{flex:1}
.bar button,.cardbtn{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:12px;border:0;background:transparent;color:inherit}
.bar button:hover{background:rgba(255,123,23,.14);color:var(--bright)}
.chips{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}
.chip{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;background:#fff;border:1px solid rgba(23,26,30,.12);font-size:14px}
.chip .ic{color:var(--orange)}
.cta{display:inline-flex;align-items:center;gap:8px;height:48px;padding:0 20px;border-radius:12px;background:var(--orange);color:var(--charcoal);font-weight:800;text-decoration:none}
.cta:hover{background:var(--orange-hover)}
@media (max-width:480px){.grid{grid-template-columns:1fr 1fr}.big{display:none}}
</style>
</head>
<body>
<header>
<h1>Sporta icon set</h1>
<p>${names.length} hand-drawn glyphs on one 24 grid: round caps and joins, one stroke in screen pixels (1.5px up to a 20px box, 1.75px from 21px, as on the live shop), a 2.5 corner radius, and a short speed dash on the things that move. Each card shows the glyph at 16, 20 and 24px exactly as the shop paints it (a mask in currentColor), then the source drawing at 48px. Glyphs marked "mirrors in RTL" are flipped in the right-to-left panels.</p>
</header>
<section class="ctx" dir="ltr" aria-label="In context">
<div class="bar">${icon('assistant', 20)}<span class="sp"></span><button aria-label="Language">${icon('globe', 16)}</button><button aria-label="Bag">${icon('bag', 22)}</button></div>
<div class="chips"><span class="chip">${icon('truck', 18)}Delivery within 24 hours</span><span class="chip">${icon('card', 18)}Card payment</span><span class="chip">${icon('returns', 18)}14-day returns</span><span class="chip">${icon('lock', 16)}Secure checkout</span><a class="cta" href="#">Shop now${icon('arrow-right', 18)}</a></div>
</section>
<section class="ctx" dir="rtl" lang="ar" aria-label="In context, Arabic">
<div class="bar">${icon('assistant', 20)}<span class="sp"></span><button aria-label="اللغة">${icon('globe', 16)}</button><button aria-label="الحقيبة">${icon('bag', 22)}</button></div>
<div class="chips"><span class="chip">${icon('truck', 18)}التوصيل خلال ٢٤ ساعة</span><span class="chip">${icon('returns', 18)}إرجاع خلال ١٤ يومًا</span><a class="cta" href="#">تسوّق الآن<i class="ic" style="--m:var(--p-arrow-right);width:18px;height:18px;rotate:180deg" aria-hidden="true"></i></a></div>
</section>
${panel('ltr', 'orange')}
${panel('ltr', 'charcoal')}
${panel('rtl', 'orange')}
${panel('rtl', 'charcoal')}
${panel('ltr', 'dark')}
</body>
</html>
`
}

// ---- write / check --------------------------------------------------------------------------------------------------
export const splice = (css, sec) => {
  const i = css.indexOf(START), j = css.indexOf(END)
  if (i < 0) return css.replace(/\n*$/, '\n\n') + sec
  if (j < i) throw new Error('ICON SET start marker without its end marker')
  return css.slice(0, i) + sec + css.slice(j + END.length).replace(/^\n/, '')
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const css = readFileSync(CSS_FILE, 'utf8'), want = splice(css, section())
  const pv = join(SET, 'preview.html'), wantPv = preview()
  if (process.argv.includes('--check')) {
    let bad = 0
    if (css !== want) { console.error('sporta-shadows.css ICON SET section is not what brand/iconset produces: run node scripts/build-iconset.mjs'); bad++ }
    let cur = ''; try { cur = readFileSync(pv, 'utf8') } catch {}
    if (cur !== wantPv) { console.error('brand/iconset/preview.html is stale: run node scripts/build-iconset.mjs'); bad++ }
    process.exit(bad ? 1 : 0)
  }
  writeFileSync(CSS_FILE, want); writeFileSync(pv, wantPv)
  console.log(`ICON SET: ${Object.keys(glyphs()).length} glyphs, ${RULES.length} rules; section ${section().length} bytes; preview written`)
}
