#!/usr/bin/env node
// rtl-static-scan.mjs - STATIC scan for physical-direction CSS/JS that breaks a right-to-left page. Read-only.
//
//   node scripts/rtl-static-scan.mjs                       # public/*.css add-ons + src/ (the repo)
//   node scripts/rtl-static-scan.mjs --live DIR            # a capture of the live build: DIR/index.html, DIR/assets/*.css|js, DIR/sporta-*.css|js
//   node scripts/rtl-static-scan.mjs --live DIR --json     # machine-readable
//   SELFTEST=1 node scripts/rtl-static-scan.mjs            # proves the classifier on a fixture with known good and bad rules
//
// Exit code: 0 when nothing is UNMIRRORED, 1 otherwise (2 on a usage error).
//
// WHAT IT LOOKS FOR (the audit lens "static CSS and the admin", 2026-11-04)
//   CSS declarations that name a side: margin/padding/border/inset left|right, left:/right:, float, text-align left|right,
//   corner radii, background/object-position with a left/right keyword, gradients with a physical angle, transform-origin,
//   translate/rotate/scale on an axis, direction:ltr|rtl. Each is classified:
//     harmless    symmetric (a radius on both top corners, a table text-indent:0, a spin keyframe),
//     overridden  the SAME rule block also sets the logical twin after it (lightningcss writes `padding:a b c d` and then
//                 `padding-inline:...` for old browsers: the physical one is dead where logical properties work),
//     mirrored    another rule with [dir=rtl] / [dir=ltr] / :lang(ar) / :dir(rtl) in its selector sets the same property for
//                 the same element, or the rule itself sits under such a selector,
//     forced      `direction:ltr|rtl` (a deliberate decision that needs a human: its children inherit it),
//     UNMIRRORED  everything else.
//   Tailwind utilities that name a side (.ml-* .mr-* .pl-* .pr-* .left-* .right-* .text-left .text-right .border-l|r .rounded-l|r
//   .-translate-x-* .origin-left|right) are looked up in the JS: where a class string uses one and carries no rtl: variant,
//   it is UNMIRRORED (this is how the Track stepper's connector, `-translate-x-1/2`, was found: it is right in English
//   and runs the wrong way in Arabic).
//   Add-on JS that writes physical inline styles (style.cssText / style="..." / el.style.marginLeft ...).
//
// WHAT IT CANNOT KNOW: whether a flagged rule is reachable, or what it looks like. It names the rule; the proof is a render of
// the component in both languages (scripts/page-alignment-audit.mjs, pairs/).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(ROOT, 'package.json'))
const postcss = require('postcss')

// ---------------------------------------------------------------- classification
const WORD = (side) => new RegExp(`(^|[^a-z0-9_-])${side}([^a-z0-9_-]|$)`, 'i')
const HAS_LR = (v) => WORD('(left|right)').test(v)
const MIRROR_SEL = /\[dir=["']?(rtl|ltr)["']?\]|:lang\((ar|ae|fa|he|ur)[^)]*\)|:dir\((rtl|ltr)\)|\brtl\\?:|\.rtl\b/i

/** First argument of every translate()/translateX()/translate3d()/scaleX() in a value, as [fn, arg]. */
const xArgs = (v) => [...v.matchAll(/(translate3d|translatex|translate|scalex)\(\s*([^,)]+)/gi)].map((m) => [m[1].toLowerCase(), m[2].trim()])

/** Which physical aspect (if any) does this declaration have? Returns { key, family } or null. `family` is the logical property prefix. */
export function physicalOf(prop, value) {
  const p = prop.toLowerCase(), v = value.trim()
  let m
  if ((m = p.match(/^(margin|padding|scroll-margin|scroll-padding)-(left|right)$/))) return { key: `${m[1]}-x`, family: `${m[1]}-inline` }
  if ((m = p.match(/^border-(left|right)(-(width|style|color))?$/))) return { key: `border-x${m[2] || ''}`, family: `border-inline${m[2] || ''}` }
  if ((m = p.match(/^border-(top|bottom)-(left|right)-radius$/))) return { key: `radius-${m[1]}`, family: 'border-start-', radius: true }
  if (p === 'left' || p === 'right') return { key: 'inset-x', family: 'inset-inline' }
  if ((p === 'float' || p === 'clear') && /^(left|right)$/.test(v)) return { key: p, family: null }
  if ((p === 'text-align' || p === 'text-align-last') && /^(left|right)$/.test(v)) return { key: p, family: null }
  if (/^(background-position(-x)?|object-position|mask-position)$/.test(p) && (HAS_LR(v) || /^-?\d+(\.\d+)?%/.test(v)) && !/^(50%|center)(\s|$)/.test(v)) return { key: p, family: null }
  if (/^(transform-origin|perspective-origin)$/.test(p) && HAS_LR(v)) return { key: p, family: null }
  if ((p === 'transform' || p === 'translate') && !/var\(--tw-/.test(v)) {
    if (xArgs(v).some(([fn, a]) => fn === 'scalex' || !/^-?0+(\.0+)?(px|%|rem|em)?$/.test(a))) return { key: 'transform-x', family: null }
    if (p === 'translate' && /^-?\d/.test(v) && !/^-?0+(\.0+)?(px|%|rem|em)?(\s|$)/.test(v)) return { key: 'transform-x', family: null }
  }
  if (/^(background|background-image|mask-image|-webkit-mask-image)$/.test(p) && /linear-gradient\(\s*(to\s+(left|right)|\d+(\.\d+)?deg)/i.test(v)) return { key: 'gradient-angle', family: null }
  if (p === 'direction' && /^(ltr|rtl)$/.test(v)) return { key: 'direction', family: null, forced: true }
  if (['margin', 'padding', 'inset', 'scroll-padding', 'scroll-margin'].includes(p)) {
    const parts = v.replace(/\([^)]*\)/g, (x) => x.replace(/\s+/g, '')).split(/\s+/)
    if (parts.length === 4 && parts[1] !== parts[3]) return { key: `${p}-x`, family: `${p}-inline` }
  }
  if (p === 'border-radius') {
    const parts = v.split('/')[0].trim().split(/\s+/)
    if (parts.length === 4 && (parts[0] !== parts[1] || parts[3] !== parts[2])) return { key: 'radius-x', family: 'border-start-' }
  }
  return null
}

const ctxOf = (node) => { const o = []; for (let p = node.parent; p && p.type !== 'root'; p = p.parent) if (p.type === 'atrule') o.unshift(`@${p.name} ${p.params}`.trim()); return o.join(' > ') }
const norm = (s) => s.replace(/\s+/g, ' ').trim()

/** Scan one stylesheet text. Returns { file, logical, physical:[{sel, prop, value, ctx, cls, why}] } */
export function scanCss(text, file = '') {
  const root = postcss.parse(text, { from: file || undefined })
  const rules = []
  root.walkRules((r) => { if (r.parent?.type === 'atrule' && /keyframes$/i.test(r.parent.name)) rules.push({ r, keyframes: true }); else rules.push({ r }) })
  // every selector part of every rule that carries a mirror marker, with the properties it sets
  const mirroredProps = []
  for (const { r } of rules) {
    if (!MIRROR_SEL.test(r.selector)) continue
    const props = new Set(); r.walkDecls((d) => { props.add(d.prop.toLowerCase()); const k = physicalOf(d.prop, d.value); if (k) props.add('key:' + k.key) })
    mirroredProps.push({ sel: r.selector, base: norm(r.selector.replace(MIRROR_SEL, '').replace(/:root|html/g, '')), props })
  }
  const out = { file, logical: 0, physical: [] }
  const LOGICAL = /^(margin|padding|scroll-margin|scroll-padding)-(inline|block)(-start|-end)?$|^inset-(inline|block)(-start|-end)?$|^border-(inline|block)(-start|-end)?(-width|-style|-color)?$|^border-(start|end)-(start|end)-radius$/
  root.walkDecls((d) => {
    if (LOGICAL.test(d.prop.toLowerCase()) || (/^text-align(-last)?$/.test(d.prop) && /^(start|end)$/.test(d.value.trim())) || (/^(float|clear)$/.test(d.prop) && /^inline-/.test(d.value.trim()))) out.logical++
    const rule = d.parent; if (!rule || rule.type !== 'rule') return
    const ph = physicalOf(d.prop, d.value); if (!ph) return
    const sel = norm(rule.selector), ctx = ctxOf(rule)
    const row = { sel: sel.slice(0, 200), prop: d.prop, value: d.value.slice(0, 120), ctx, line: d.source?.start?.line }
    const inKeyframes = /keyframes/i.test(ctx)
    if (ph.forced) { row.cls = 'forced'; row.why = `direction:${d.value.trim()} is inherited by every child`; out.physical.push(row); return }
    if (ph.radius) { // symmetric when the mirrored corner has the same value in the same rule
      const twin = {}; rule.walkDecls((x) => { const m = x.prop.match(/^border-(top|bottom)-(left|right)-radius$/); if (m) (twin[m[1]] ||= {})[m[2]] = x.value })
      const t = twin[ph.key.replace('radius-', '')]; if (t && t.left === t.right) { row.cls = 'harmless'; row.why = 'both corners carry the same radius'; out.physical.push(row); return }
    }
    if (ph.key === 'transform-x' && inKeyframes) { row.cls = 'harmless'; row.why = 'animation keyframe (a shimmer/spin is decorative)'; out.physical.push(row); return }
    if (d.prop.toLowerCase() === 'text-indent') { row.cls = 'harmless'; row.why = 'indent 0'; out.physical.push(row); return }
    if (/env\(safe-area-inset-(left|right)|var\(--sa-(left|right)\)/.test(d.value)) { row.cls = 'harmless'; row.why = 'safe-area insets are physical (the notch is on a side of the glass), whatever the text direction'; out.physical.push(row); return }
    if (/skeleton|shimmer/i.test(sel)) { row.cls = 'harmless'; row.why = 'decorative loading shimmer (sweeps one way in both languages)'; out.physical.push(row); return }
    if (/^\.((\\.|[A-Za-z0-9_-])+)$/.test(sel) && SIDE_UTIL.test(sel.slice(1).replace(/\\(.)/g, '$1')) && !MIRROR_SEL.test(sel)) { row.cls = 'utility'; row.why = 'a Tailwind utility: judged where a component uses it (the JS pass below)'; out.physical.push(row); return }
    if (MIRROR_SEL.test(rule.selector)) { row.cls = 'mirrored'; row.why = 'the rule itself is scoped to a direction'; out.physical.push(row); return }
    // the same block sets the logical twin AFTER this declaration (lightningcss: `padding:a b c d; padding-inline:...`)
    let after = false, seen = false
    rule.each((x) => { if (x === d) { seen = true; return } if (seen && x.type === 'decl' && ph.family && x.prop.toLowerCase().startsWith(ph.family)) after = true })
    if (after) { row.cls = 'overridden'; row.why = 'a logical property later in the same rule wins'; out.physical.push(row); return }
    // another rule with a direction marker sets this property on the same element
    const base = norm(rule.selector)
    const twin = mirroredProps.find((m) => (m.props.has(d.prop.toLowerCase()) || m.props.has('key:' + ph.key)) && (m.base === base || m.base.endsWith(base) || base.endsWith(m.base) && m.base.length > 3))
    if (twin) { row.cls = 'mirrored'; row.why = `counterpart: ${twin.sel.slice(0, 80)}`; out.physical.push(row); return }
    row.cls = 'UNMIRRORED'; row.why = 'no logical twin, no [dir]/:lang(ar) counterpart for this selector'
    out.physical.push(row)
  })
  return out
}

// ---------------------------------------------------------------- Tailwind utilities used in JS
const SIDE_UTIL = /^(-?)(ml|mr|pl|pr|left|right|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-|^text-(left|right)$|^border-(l|r)(-|$)|^rounded-(l|r|tl|tr|bl|br)(-|$)|^-?translate-x-|^origin-(left|right|top-left|top-right|bottom-left|bottom-right)$|^float-(left|right)$|^bg-gradient-to-(r|l)$|^space-x-|^divide-x/
const RTL_COUNTER = /rtl:[^\s`'"]*(translate-x|rotate|scale-x|text-|ml-|mr-|pl-|pr-|left-|right-|border-|rounded-|origin-|bg-gradient|-translate|float|space-x|divide-x)/

/** Utilities that the stylesheet defines (so some component uses them) and name a side. */
export function sideUtilitiesIn(css) {
  const found = new Set()
  for (const m of css.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)\s*[{,:]/g)) {
    const name = m[1].replace(/\\(.)/g, '$1')
    if (/^(rtl|ltr|sm|md|lg|xl|2xl|hover|focus|group|dark|max|min):/.test(name)) continue
    if (SIDE_UTIL.test(name) && !/^(start|end)-/.test(name)) found.add(name)
  }
  return [...found]
}

/** For each class string (a quoted/template literal) in a JS chunk that uses a side utility, say whether an rtl: variant sits beside it. */
const ADMIN_CHUNK = /^(AdminApp|AdminPasscode|ActivityLog|Brands|CRM|Catalog|CheckoutEditor|Discounts|Inventory|Orders|Overview|Payments|Profiles|Promotions|ReturnRequests|SEOEditor|Slides|Support-Bh|ThemeEditor|TopbarEditor)/
/** Reviewed by hand: a row here is reported as `reviewed`, not as UNMIRRORED. Add a line (with the reason) only after rendering it in both languages. */
const REVIEWED = [
  { file: /^HeroSlider/, util: 'right-0', snippet: 'absolute bottom-0 right-0 h-full w-auto', why: 'hero art SVG: its wrapper carries rtl:-scale-x-100, so the pair mirrors (checked 2026-11-04)' },
  { file: /^index-/, util: 'right-0', snippet: 'absolute bottom-0 right-0 h-full w-auto', why: 'hero art SVG: its wrapper carries rtl:-scale-x-100, so the pair mirrors (checked 2026-11-04)' },
]
export function usesInJs(js, utilities, file = '') {
  const rows = []
  const seen = new Set()
  const set = new Set(utilities)
  const re = /(`[^`\\]*(?:\\.[^`\\]*)*`|"[^"\n]*"|'[^'\n]*')/g
  for (const m of js.matchAll(re)) {
    const s = m[1]; if (s.length > 600 || !/[a-z]-[a-z0-9]/.test(s)) continue
    const toks = s.slice(1, -1).split(/\s+/).filter(Boolean)
    const hit = toks.filter((t) => set.has(t))
    if (!hit.length) continue
    const counter = RTL_COUNTER.test(s)
    const key = hit.join(' ') + '|' + s.slice(0, 160); if (seen.has(key)) continue; seen.add(key)
    const row = { file, utilities: hit, counter, snippet: s.slice(0, 160), at: m.index }
    if (ADMIN_CHUNK.test(file)) row.admin = true
    const rv = REVIEWED.find((r) => r.file.test(file) && hit.includes(r.util) && s.includes(r.snippet)); if (rv) row.reviewed = rv.why
    rows.push(row)
  }
  return rows
}

// ---------------------------------------------------------------- add-on JS inline styles
export function inlinePhysicalStyles(js, file = '') {
  const rows = []
  const lines = js.split('\n')
  lines.forEach((ln, i) => {
    if (/opacity:\s*0/.test(ln) && /position:\s*fixed/.test(ln)) return
    if (/parseFloat\(|getComputedStyle|\bcs\.(padding|margin)/.test(ln) && !/cssText|style=/.test(ln)) return
    if (!/cssText|\.style\.|style=|setProperty|style\.setProperty|createElement\(['"]style/.test(ln) && !/(margin|padding|border)-(left|right)|text-align:\s*(left|right)|float:\s*(left|right)|marginLeft|marginRight|paddingLeft|paddingRight|textAlign\s*=\s*['"](left|right)|(^|[;'" ])(left|right):\s*-?\d/.test(ln)) return
    if (/(margin|padding|border)-(left|right)\s*:|text-align:\s*(left|right)|float:\s*(left|right)|marginLeft|marginRight|paddingLeft|paddingRight|textAlign\s*=\s*['"](left|right)/.test(ln) || /['"; ](left|right):\s*-?\d+(px|%|rem)?[^;]*;?/.test(ln) && /style|cssText/.test(ln))
      rows.push({ file, line: i + 1, text: ln.trim().slice(0, 160) })
  })
  return rows
}

// ---------------------------------------------------------------- driver
const listFiles = (dir, re) => existsSync(dir) ? readdirSync(dir).filter((f) => re.test(f)).map((f) => join(dir, f)).filter((f) => statSync(f).isFile()) : []
const walk = (dir, re, acc = []) => { if (!existsSync(dir)) return acc; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p, re, acc); else if (re.test(e.name)) acc.push(p) } return acc }

function selftest() {
  const css = `
    .a{margin-left:4px}
    [dir=rtl] .a{margin-right:4px}
    .b{padding:1px 2px 1px 8px;padding-inline:8px 2px}
    .c{padding:1px 2px 1px 8px}
    .d{text-align:left}
    .e{border-top-left-radius:4px;border-top-right-radius:4px}
    .f{position:absolute;right:0}
    .g{direction:ltr}
    .h{background:linear-gradient(90deg,#000,#fff)}
    :root[dir=rtl] .h{background:linear-gradient(270deg,#000,#fff)}
    @keyframes sh{to{transform:translateX(100%)}}
    .i{--brand-bright:#f70;background:var(--brand-bright)}
    .j{margin-inline-start:4px;padding-inline:2px;inset-inline-end:0;text-align:end}
    .k{text-align:right}
    :lang(ar) .k{text-align:left}
  `
  const r = scanCss(css, 'selftest.css')
  const by = (sel, prop) => r.physical.find((x) => x.sel.endsWith(sel) && x.prop === prop && !/rtl|lang/.test(x.sel))?.cls
  const checks = [
    ['margin-left with a [dir=rtl] twin is mirrored', by('.a', 'margin-left') === 'mirrored'],
    ['the padding shorthand followed by padding-inline is overridden', by('.b', 'padding') === 'overridden'],
    ['a bare asymmetric padding shorthand is UNMIRRORED', by('.c', 'padding') === 'UNMIRRORED'],
    ['text-align:left alone is UNMIRRORED', by('.d', 'text-align') === 'UNMIRRORED'],
    ['equal top radii are harmless', by('.e', 'border-top-left-radius') === 'harmless'],
    ['right:0 alone is UNMIRRORED', by('.f', 'right') === 'UNMIRRORED'],
    ['direction:ltr is forced', by('.g', 'direction') === 'forced'],
    ['a physical gradient with an :root[dir=rtl] twin is mirrored', by('.h', 'background') === 'mirrored'],
    ['a keyframe translateX is harmless', r.physical.some((x) => /keyframes/.test(x.ctx) && x.cls === 'harmless')],
    ['--brand-bright is not a "right" (word boundary)', !r.physical.some((x) => x.sel.endsWith('.i'))],
    ['logical declarations are counted (4 on .j + 1 padding-inline on .b)', r.logical === 5],
    ['text-align:right with a :lang(ar) twin is mirrored', by('.k', 'text-align') === 'mirrored'],
  ]
  const utils = sideUtilitiesIn('.-translate-x-1\\/2{translate:1px}.rtl\\:translate-x-1\\/2:where([dir=rtl]){translate:2px}.ml-2{margin-left:1px}.ms-2{margin-inline-start:1px}.text-left{text-align:left}')
  checks.push(['side utilities found: -translate-x-1/2, ml-2, text-left (and not rtl:/ms-)', ['-translate-x-1/2', 'ml-2', 'text-left'].every((u) => utils.includes(u)) && !utils.some((u) => /^rtl:|^ms-/.test(u))])
  const js = 'x=`absolute inset-x-0 -translate-x-1/2 ${a}`;y=`absolute start-1/2 -translate-x-1/2 rtl:translate-x-1/2`;z="ml-2 flex"'
  const u = usesInJs(js, utils, 'f.js')
  checks.push(['a class string with -translate-x-1/2 and no rtl: variant is UNMIRRORED', u.some((x) => x.utilities.includes('-translate-x-1/2') && !x.counter)])
  checks.push(['the same utility beside rtl:translate-x-1/2 is mirrored', u.some((x) => x.utilities.includes('-translate-x-1/2') && x.counter)])
  checks.push(['ml-2 in a plain string is UNMIRRORED', u.some((x) => x.utilities.includes('ml-2') && !x.counter)])
  const inl = inlinePhysicalStyles("el.style.cssText = 'margin-left:8px;color:red'\nel.style.cssText = 'margin-inline-start:8px'\n", 'x.js')
  checks.push(['an inline margin-left in add-on JS is reported, margin-inline-start is not', inl.length === 1 && inl[0].line === 1])
  let bad = 0
  for (const [name, ok] of checks) { console.log((ok ? 'ok   ' : 'FAIL ') + name); if (!ok) bad++ }
  console.log(`${checks.length - bad}/${checks.length} selftest checks passed`)
  process.exit(bad ? 1 : 0)
}

function main() {
  const args = process.argv.slice(2)
  const liveIx = args.indexOf('--live'), live = liveIx >= 0 ? args[liveIx + 1] : null
  const asJson = args.includes('--json')
  if (liveIx >= 0 && (!live || !existsSync(live))) { console.error('--live needs a directory (a capture of the live build)'); process.exit(2) }
  const cssFiles = [], jsAddons = [], jsChunks = []
  if (live) {
    cssFiles.push(...listFiles(join(live, 'assets'), /\.css$/), ...listFiles(live, /^sporta-.*\.css$/))
    jsAddons.push(...listFiles(live, /\.js$/))
    jsChunks.push(...listFiles(join(live, 'assets'), /\.js$/).filter((f) => !/react-vendor|rolldown-runtime/.test(f)))
  } else {
    cssFiles.push(...listFiles(join(ROOT, 'public'), /^sporta-.*\.css$/), ...walk(join(ROOT, 'src'), /\.css$/))
    jsAddons.push(...listFiles(join(ROOT, 'public'), /^(sporta-.*|boot|config|birthday)\.js$/))
    jsChunks.push(...walk(join(ROOT, 'src'), /\.jsx?$/))
  }
  const report = { scope: live ? `live capture ${live}` : 'repo (public add-ons + src)', css: [], utilities: [], inlineStyles: [], counts: {} }
  let utilNames = new Set()
  for (const f of cssFiles) {
    const text = readFileSync(f, 'utf8'); const r = scanCss(text, f)
    report.css.push({ file: basename(f), bytes: text.length, logical: r.logical, physical: r.physical })
    for (const u of sideUtilitiesIn(text)) utilNames.add(u)
  }
  if (!live) utilNames = new Set([...utilNames, ...['ml-', 'mr-', 'pl-', 'pr-', 'left-', 'right-', 'text-left', 'text-right', 'border-l', 'border-r', 'rounded-l', 'rounded-r'].flatMap((p) => p.endsWith('-') ? [] : [p])])
  const utilities = [...utilNames]
  for (const f of jsChunks) {
    const text = readFileSync(f, 'utf8')
    if (live) { for (const row of usesInJs(text, utilities, basename(f))) report.utilities.push(row) }
    else for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) { const s = '`' + (m[1] ?? m[2]) + '`'; const toks = s.slice(1, -1).split(/\s+/); const hit = toks.filter((t) => SIDE_UTIL.test(t) && !/^rtl:|^start-|^end-/.test(t)); if (hit.length) { const row = { file: basename(f), utilities: hit, counter: RTL_COUNTER.test(s), snippet: s.slice(0, 160) }; if (ADMIN_CHUNK.test(basename(f)) || /[\\/]admin[\\/]/.test(f)) row.admin = true; const rv = REVIEWED.find((r) => r.file.test(basename(f)) && hit.includes(r.util) && s.includes(r.snippet)); if (rv) row.reviewed = rv.why; report.utilities.push(row) } }
  }
  for (const f of jsAddons) report.inlineStyles.push(...inlinePhysicalStyles(readFileSync(f, 'utf8'), basename(f)))
  const tally = { harmless: 0, overridden: 0, mirrored: 0, utility: 0, forced: 0, UNMIRRORED: 0 }
  let logical = 0
  for (const c of report.css) { logical += c.logical; for (const p of c.physical) tally[p.cls]++ }
  const unmirroredUtil = report.utilities.filter((u) => !u.counter && !u.admin && !u.reviewed)
  const adminUtil = report.utilities.filter((u) => !u.counter && u.admin).length, reviewedUtil = report.utilities.filter((u) => !u.counter && u.reviewed).length
  report.counts = { logicalDeclarations: logical, physical: tally, utilitiesUsedWithoutRtlVariant: unmirroredUtil.length, utilitiesWithRtlVariant: report.utilities.filter((u) => u.counter).length, utilitiesInAdminChunks: adminUtil, utilitiesReviewed: reviewedUtil, addonInlinePhysicalStyles: report.inlineStyles.length }
  if (asJson) { console.log(JSON.stringify(report, null, 1)); process.exit(tally.UNMIRRORED || unmirroredUtil.length || report.inlineStyles.length ? 1 : 0) }
  console.log(`RTL static scan - ${report.scope}`)
  console.log(`  stylesheets: ${report.css.length}   logical declarations: ${logical}   physical: ${JSON.stringify(tally)}`)
  for (const c of report.css) for (const p of c.physical) if (p.cls === 'UNMIRRORED' || p.cls === 'forced') console.log(`  ${p.cls.padEnd(10)} ${c.file}:${p.line}  ${p.ctx ? '[' + p.ctx + '] ' : ''}${p.sel}  { ${p.prop}: ${p.value} }  - ${p.why}`)
  console.log(`  Tailwind side utilities used in JS: ${unmirroredUtil.length} without an rtl: variant, ${report.counts.utilitiesWithRtlVariant} with one, ${adminUtil} in admin chunks (the admin is dir=ltr), ${reviewedUtil} reviewed by hand`)
  for (const u of unmirroredUtil) console.log(`  UNMIRRORED ${u.file}  ${u.utilities.join(' ')}  <- ${u.snippet}`)
  console.log(`  add-on JS inline physical styles: ${report.inlineStyles.length}`)
  for (const s of report.inlineStyles) console.log(`  inline     ${s.file}:${s.line}  ${s.text}`)
  process.exit(tally.UNMIRRORED || unmirroredUtil.length || report.inlineStyles.length ? 1 : 0)
}

if (process.env.SELFTEST === '1') selftest()
else if (import.meta.url === `file://${process.argv[1]}`) main()
