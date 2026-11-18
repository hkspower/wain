// COLOURS-1118 (owner, 2026-11-18: "remove red color and use orange color same logo exactly"): the shop has ONE orange, the logo's
// #FF7B17, and no red. What is proven here:
//   1  the orange of the tokens is the logo's, exactly, even when the bundle's theme applier writes its terracotta inline on <html>
//      (the !important of sporta-brand-theme.css), and hsl(var(--primary)) renders it;
//   2  the failure colours of the bundle (Tailwind's rose and red scales, read through variables) are oranges of the same hue on the
//      shop, and stay as they were while an admin screen is on the page (the admin keeps its reds);
//   3  the bundle's hard-coded literals the tokens do not reach (the checkout's invalid-field border) are orange;
//   4  the contrast of the pairs the shop uses (small text on light = the dark step, 5.28:1; the orange against the near-black both ways);
//   5  none of the old reds / burnt oranges is left in the storefront add-ons outside comments (the admin login keeps its own).
//   npm run test:colours-1118       (ADDON_FILE=<path> runs another brand-theme file; the NO RED block removed must FAIL)
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(ROOT, 'public')
const THEME = readFileSync(process.env.ADDON_FILE || join(PUB, 'sporta-brand-theme.css'), 'utf8')
let pass = 0, fail = 0
const is = (ok, msg, d = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } }

// ---- 4 contrast (WCAG relative luminance)
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const LOGO = '#ff7b17', DEEP = '#b34d00', INK = '#171a1e'
is(ratio(DEEP, '#ffffff') >= 4.5, `small orange text on white: ${ratio(DEEP, '#ffffff').toFixed(2)}:1 (the dark step ${DEEP})`)
is(ratio(DEEP, '#f6f1e8') >= 4.5, `...and on the warm panel ground #f6f1e8: ${ratio(DEEP, '#f6f1e8').toFixed(2)}:1`)
is(ratio('#ffffff', DEEP) >= 4.5, `white on the hover fill ${DEEP}: ${ratio('#ffffff', DEEP).toFixed(2)}:1`)
is(ratio(INK, LOGO) >= 6.5 && ratio(LOGO, INK) >= 6.5, `near-black on the logo orange and the logo orange on near-black: ${ratio(INK, LOGO).toFixed(2)}:1 (buttons, the Buy now label)`)
is(ratio(LOGO, '#ffffff') < 3, `the logo orange on white is ${ratio(LOGO, '#ffffff').toFixed(2)}:1: never used for small text on a light ground (the dark step is)`)
{ // the dark step has the logo's hue (26 degrees), so it reads as orange and not as brick red or brown
  const hue = (h) => { const [r, g, b] = rgb(h).map((v) => v / 255), M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m; return d ? (M === r ? ((g - b) / d) % 6 : M === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 : 0 }
  is(Math.abs(hue(DEEP) - hue(LOGO)) <= 1.5, `the dark step (${hue(DEEP).toFixed(1)} deg) has the logo's hue (${hue(LOGO).toFixed(1)} deg)`)
}

// ---- 5 the source
{
  const FILES = ['sporta-brand-theme.css', 'sporta-product-fix.css', 'sporta-bag-touch.css', 'sporta-checkout-a11y.css', 'sporta-cart-drawer.css', 'sporta-grid.css', 'sporta-images.css', 'sporta-shadows.css', 'sporta-ui-colours.css', 'sporta-home-trim.css', 'sporta-cat-tiles.css', 'sporta-returns-touch.css', 'sporta-clock.css', 'sporta-features.js']
  const OLD = /#e0561c|#b8430f|#be123c|#b91c1c|#fda4af|#e11d48|#c94c17|#fde8ee|rgba?\(\s*224\s*,\s*86\s*,\s*28|rgba?\(\s*184\s*,\s*67\s*,\s*15|rgba?\(\s*190\s*,\s*18\s*,\s*60/i
  const hits = []
  for (const f of FILES) {
    let t = readFileSync(join(PUB, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    if (f.endsWith('.js')) t = t.replace(/^\s*\/\/.*$/gm, '')
    if (f === 'sporta-ui-colours.css') t = t.split('\n').filter((l) => !/admin-login/.test(l)).join('\n')   // the admin sign-in keeps its own
    t.split('\n').forEach((l, i) => { if (OLD.test(l)) hits.push(`${f}:${i + 1} ${l.trim().slice(0, 70)}`) })
  }
  is(hits.length === 0, `none of the old reds and burnt oranges is left in the ${FILES.length} storefront add-on files (outside comments and the admin sign-in)`, hits.slice(0, 5).join(' | '))
}

// ---- 1-3 in a browser
const html = (extraBody = '') => `<!doctype html><html lang="en" style="--brand:#c76a42;--brand-bright:#d28a69;--brand-deep:#99452b;--primary:18.9 53.8% 61.8%;--accent:14.2 56.1% 38.4%"><head><style>
:root,:host{--color-rose-50:#fff1f2;--color-rose-100:#ffe4e6;--color-rose-200:#ffccd3;--color-rose-300:#ffa2ae;--color-rose-400:#ff667f;--color-rose-500:#ff2357;--color-rose-600:#e70044;--color-rose-700:#c20039;--color-rose-800:#a30037;--color-rose-900:#8b0836;--color-rose-950:#4d0218;--color-red-600:#e40014;--brand:#c76a42;--brand-bright:#d28a69;--brand-deep:#99452b}
.text-rose-600{color:var(--color-rose-600)}.text-rose-700{color:var(--color-rose-700)}.bg-rose-50{background-color:var(--color-rose-50)}.border-rose-400{border-color:var(--color-rose-400);border-style:solid;border-width:1px}.hover\\:text-red-600{color:var(--color-red-600)}
.purchase-checkout-layout :where(input,select,textarea)[aria-invalid=true]{border-color:#e11d48}
.prim{background:hsl(var(--primary))}.deep{color:var(--brand-deep)}.bright{background:var(--brand-bright)}.brand{background:var(--brand)}
${THEME}
</style></head><body>${extraBody}<div class="storefront-root"><p class="text-rose-600" id="t6">e</p><p class="text-rose-700" id="t7">e</p><div class="bg-rose-50" id="b50">x</div><div class="border-rose-400" id="bd4">x</div><span class="hover:text-red-600" id="r6">x</span>
<span class="prim" id="prim">x</span><span class="deep" id="deep">x</span><span class="bright" id="bright">x</span><span class="brand" id="brand">x</span>
<div class="purchase-checkout-layout"><input id="inv" aria-invalid="true"></div></div></body></html>`
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const get = async (body) => { const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.setContent(html(body)); const r = await p.evaluate(() => { const c = (id, pr = 'color') => getComputedStyle(document.getElementById(id))[pr]; return { t6: c('t6'), t7: c('t7'), b50: c('b50', 'backgroundColor'), bd4: c('bd4', 'borderTopColor'), prim: c('prim', 'backgroundColor'), deep: c('deep'), bright: c('bright', 'backgroundColor'), brand: c('brand', 'backgroundColor'), inv: c('inv', 'borderTopColor') } }); await ctx.close(); return r }
const shop = await get('')
is(shop.brand === 'rgb(255, 123, 23)' && shop.bright === 'rgb(255, 123, 23)', `--brand and --brand-bright are the logo orange (${shop.brand}), although the theme applier wrote terracotta inline on <html>`)
is(shop.prim === 'rgb(255, 123, 23)', `hsl(var(--primary)) renders the logo orange (${shop.prim})`)
is(shop.deep === 'rgb(179, 77, 0)', `--brand-deep (text and hover on light) is the dark step (${shop.deep})`)
is(shop.t6 === 'rgb(179, 77, 0)' && shop.t7 === 'rgb(153, 66, 0)', `an error line (text-rose-600 / 700) is orange, not rose (${shop.t6} / ${shop.t7})`)
is(shop.b50 === 'rgb(255, 244, 236)' && shop.bd4 === 'rgb(255, 149, 64)', `the notice ground and border (rose-50, rose-400) are orange tints (${shop.b50} / ${shop.bd4})`)
is(shop.inv === 'rgb(255, 123, 23)', `an invalid checkout field has the logo-orange border, not #e11d48 (${shop.inv})`)
const admin = await get('<div class="admin-shell"></div>'), login = await get('<div class="admin-login"></div>')
is(admin.t6 === 'rgb(231, 0, 68)' && admin.b50 === 'rgb(255, 241, 242)', `while an admin screen is on the page the bundle's own reds are untouched (${admin.t6})`)
is(login.t6 === 'rgb(231, 0, 68)', `...and on the admin sign-in screen (${login.t6})`)
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
