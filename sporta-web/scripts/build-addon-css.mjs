#!/usr/bin/env node
// BUILD ADDON CSS - the lossless "slim" build of a live add-on stylesheet (today: public/sporta-admin-knet.css).
//
//   npm run build:addon-css                      rebuild public/<name>.css from addons-src/<name>.css
//   node scripts/build-addon-css.mjs --check     the DRIFT GUARD: rebuild in memory, exit 1 if public/ differs
//   node scripts/build-addon-css.mjs --apply     the one-time SWITCH (see below); idempotent
//   node scripts/build-addon-css.mjs --stats     raw / gzip / brotli before and after (add --all for every add-on CSS)
//
// WHY. public/sporta-admin-knet.css is linked, render-blocking, by the LIVE index.html, so EVERY shopper page load downloads it
// although only /backends uses it. About half of it is comments - the thorough ones CLAUDE.md asks for, written down because they
// carry measured live facts. The comments must not be lost and the file must not get cheaper by getting less true, so:
//
//   addons-src/<name>.css   the READABLE source. Thorough comments. This is the file people edit.
//   public/<name>.css       GENERATED from it by this tool: comments and whitespace gone, one header line, nothing else changed.
//                           It is in public/ because scripts/vps-deploy.mjs copies public/ verbatim from a pushed commit sha, and
//                           because the live index.html links /<name>.css. It is committed, so the sha carries it.
//   addons-src/ is NOT under public/, so Vite never copies it into dist/, make-package.mjs never stages it and the deploy never
//   ships it (scripts/addon-css-slim-test.mjs proves that against a real build and the real file-audit).
//
// WHAT "LOSSLESS" MEANS HERE, AND THE ONE SETTING THAT MAKES IT TRUE. The only transform is lightningcss `minify: true`, with the
// browser targets of the shop's own build (Vite's cssTarget for build.target 'es2022': chrome/edge 94, firefox 93, safari/ios 16.4,
// opera 80 - the app's other CSS is minified the same way) and ONE feature switched off, `Features.LightDark`.
//
// Both halves are measured, not assumed (the numbers are in PERFORMANCE.md, "Lighter admin CSS"):
//   * NO targets looks safest and is not. Without targets lightningcss does not know any browser, so it (a) rewrites every
//     `@media (min-width: 768px)` to the range syntax `(width >= 768px)`, which Chrome 94-103 does not parse (the whole media block
//     silently stops applying), and (b) merges adjacent rules with the same declarations even when one selector is `:has(...)`,
//     which Chrome < 105 and Firefox < 121 drop as a whole: the plain selector that used to work there would stop working.
//     Chromium 1243, where the proof runs, cannot see either regression, which is exactly why they must be impossible by construction.
//   * WITH the shop's targets lightningcss keeps the classic media syntax, refuses to merge a rule into a list that an older browser
//     would invalidate, and splits a list whose members it cannot keep together - each of which is equivalent in every browser at or
//     above the floor. It also injects `--lightningcss-light` / `--lightningcss-dark` next to every `color-scheme: light` (a polyfill for
//     light-dark(), which this file does not use). Those are two new computed custom properties on every element under the rule, so the
//     feature is switched off. Nothing else is: the proof compares every property.
// What the minifier still does is syntax-neutral at the floor: drop comments and whitespace, shorten values (`#E0561C` -> `#e0561c`,
// `0px` -> `0`, `transparent` -> `#0000`, four-value shorthands), merge ADJACENT rules that share a selector or a declaration block
// (only when every selector is valid at the floor), and drop a rule that a LATER rule with the identical selector and importance
// overrides completely (the cascade can never reach it: same element set, same specificity, later wins). It never reorders rules and
// never merges across an @media boundary, so the ORDER the add-on is written against (it is layered over a compiled admin; specificity
// ties are decided by order, and !important is used on purpose) is kept. scripts/addon-css-slim-test.mjs proves it: the computed style
// of every element for the properties a stylesheet can change, pseudo-elements and forced :hover / :focus / :focus-visible / :active /
// :disabled states included, is identical on every admin screen fixture, light and dark, and a CSSOM comparison shows every
// (selector, property, importance) in the same order. `--targets none` exists only so the two hazards above can be re-measured.
//
// --prune-dead (OFF by default, never written into public/): additionally removes a rule when EVERY selector in it can never match
// the admin because it requires a class / id / data-attribute that appears nowhere in the corpus (all captured compiled admin chunks,
// the add-on scripts that build admin DOM, the repo's src/ and the PHP that may emit markup). Any class that is built from pieces
// (`bg-${c}-500`, "btn-"+kind) keeps every rule whose class starts or ends like the constant piece; when unsure the rule stays.
// The removed rules and the evidence go to --pruned-json for a human to review. It needs --live-assets <dir of compiled chunks>
// because the live build's source is not in the repo; without them it refuses.
//
// --apply, the switch (run once, by whoever owns the file, when no lane is editing it):
//   1. refuses if git reports ANY uncommitted change to public/<name>.css or addons-src/<name>.css;
//   2. `git mv public/<name>.css addons-src/<name>.css`  (history follows the readable file);
//   3. generates public/<name>.css and `git add`s it. You commit both: they are one change.
//   Run again and it changes nothing. If addons-src/<name>.css exists but public/<name>.css is not generated (somebody edited the
//   shipped file by hand) it refuses and tells you to move the edit into addons-src/.
//
// The builder never overwrites a public/<name>.css that does not start with the generated header (hand-written or not yet switched);
// pass --force to do it anyway. Before the switch, the source is public/<name>.css itself and an --out path is required.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, basename, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { gzipSync, brotliCompressSync, constants as Z } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import postcss from 'postcss'                           // already a devDependency (the test suites and Vite use it)

export const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..')   // sporta-web/
export const SRC_DIR = 'addons-src'
export const OUT_DIR = 'public'
export const DEFAULT_NAME = 'sporta-admin-knet'

const require = createRequire(import.meta.url)
const lightningcss = require('lightningcss')            // Vite's own minifier, already in node_modules (no dependency added)
export const LIGHTNINGCSS_VERSION = (() => { try { return JSON.parse(readFileSync(join(dirname(require.resolve('lightningcss')), '..', 'package.json'), 'utf8')).version } catch { return '?' } })()

export const headerFor = (name) => `/* generated from ${SRC_DIR}/${name}.css by scripts/build-addon-css.mjs; do not edit */`
const HEADER_RE = /^\/\* generated from addons-src\/[\w.-]+\.css by scripts\/build-addon-css\.mjs; do not edit \*\/\n/

// browsers as lightningcss wants them: major << 16 | minor << 8
const v = (major, minor = 0) => (major << 16) | (minor << 8)
export const TARGETS = {
  shop: { chrome: v(94), edge: v(94), firefox: v(93), safari: v(16, 4), ios_saf: v(16, 4), opera: v(80) },   // DEFAULT: Vite's cssTarget for build.target 'es2022' (see the header)
  none: undefined,                                       // for re-measuring the two hazards only; NOT lossless at the floor
}
const EXCLUDE = lightningcss.Features ? lightningcss.Features.LightDark : 0   // the light-dark() polyfill injects custom properties

// ------------------------------------------------------------------------------------------------------------- slim
// Custom-property values are OPAQUE to the browser until something reads them, and lightningcss does rewrite what it can parse
// inside them: it folds a static `color-mix(in srgb, #e0561c 16%, transparent)` to the 8-bit `#e0561c29` (alpha 0.16 -> 0.1608), which
// is a different specified value and a different computed one. So the tool never lets lightningcss see them: each distinct custom
// property value is swapped for an identifier token before the transform and put back, verbatim (whitespace runs collapsed), after.
// A plain property that holds a static color-mix() is still folded by the minifier; slim() reports that as a warning (see foldedColorMix).
const KEEP = '__sporta_keep_'
function protectCustomProps(code) {
  if (code.includes(KEEP)) throw new Error(`the source contains the reserved text ${KEEP}`)
  const root = postcss.parse(code)
  const ids = new Map(), list = []
  root.walkDecls((d) => {
    if (!d.prop.startsWith('--')) return
    const val = d.value.replace(/\s+/g, ' ').trim()
    if (!ids.has(val)) { ids.set(val, list.length); list.push(val) }
    d.value = `${KEEP}${ids.get(val)}__`
  })
  return { code: root.toString(), list }
}
const restoreCustomProps = (css, list) => {
  const out = css.replace(new RegExp(`${KEEP}(\\d+)__`, 'g'), (_, i) => list[Number(i)])
  if (out.includes(KEEP)) throw new Error('a protected custom-property token was left in the output')
  return out
}
// `guard` (default on for the shipped targets): the build FAILS instead of shipping an output that does more than drop comments and
// white space - see losslessProblems() below. It is off for --targets none (a re-measurement of the two hazards) and for --prune-dead
// (which removes rules on purpose).
export function slim(code, { targets = 'shop', filename = 'addon.css', visitor, guard = targets === 'shop' && !visitor } = {}) {
  if (!(targets in TARGETS)) throw new Error(`unknown --targets ${targets} (shop | none)`)
  const prot = protectCustomProps(code)
  const r = lightningcss.transform({
    filename, code: Buffer.from(prot.code), minify: true, targets: TARGETS[targets], exclude: EXCLUDE, errorRecovery: false, sourceMap: false, visitor,
  })
  if (r.warnings && r.warnings.length) throw new Error('lightningcss warned: ' + r.warnings.map((w) => w.message).join('; '))
  const out = restoreCustomProps(Buffer.from(r.code).toString('utf8'), prot.list)
  if (guard) {
    const bad = losslessProblems(code, out)
    if (bad.length) throw new Error('the minifier did more than drop comments and white space (the output would not be the file that was written):\n  - ' + bad.join('\n  - '))
  }
  return out
}

// ------------------------------------------------------------------------------------------------------------- the guard
// WHY. addon-css-slim-test.mjs proves the CURRENT file. This file keeps being edited (other lanes append to it), and the tool is
// re-run on whatever it looks like then. Measured on a synthetic stylesheet (review 2026-11-04), the minifier with the shop targets
// does these things to CSS that the current file happens not to contain, each of which changes what a browser does:
//   * merges `.a:has(x), .b {..}` with a neighbour that has the same declarations into `:is(.a:has(x), .b), .c {..}`: `:is()` takes the
//     specificity of its MOST specific argument, so `.b` silently gains the specificity of `.a:has(x)`;
//   * adds vendor twins (`-webkit-user-select`, `-moz-text-size-adjust`) and drops prefixed ones the floor no longer needs
//     (`-webkit-appearance`, `position:-webkit-sticky`): the declared set changes;
//   * collapses a fallback pair written in one rule when it believes the floor supports the second value;
//   * turns an escape inside a string (`content:"\201C"`) into the raw character, so the file stops being ASCII (it relies on the
//     server's charset header from then on);
//   * prints numbers with 6 significant digits (`.1234567891rem` -> `.123457rem`);
//   * rewrites range media / container queries.
// None of these is wrong at the floor, and none is "comments and white space only". So the build refuses each of them and says what
// moved; the author then writes the form the minifier would produce (or drops the dead prefix) in the source, after which the build
// goes through and the proof compares the rest. The guard compares FACTS read by postcss from the source and from the output, never
// the minifier's own opinion: the set of single selectors, of property names and vendor tokens, of at-rules, of non-ASCII characters,
// the number of fallback declarations, and the long numbers.
const unescapeCss = (v) => v.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_, h, c) => (h ? String.fromCodePoint(parseInt(h, 16)) : c))
const ATTR_SEL = /\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(?:[^\]\\]|\\.)*?)\s*(?:\s[iIsS])?)?\]/g
// one selector, spelled the one way every spelling of it reduces to: attribute values unquoted-and-unescaped then JSON-quoted, white
// space around combinators and inside brackets gone, `::before` as `:before`, a leading `*` before a compound dropped
export function normSelector(s) {
  s = s.replace(ATTR_SEL, (_, n, op, v) => (op ? `[${n}${op}${JSON.stringify(unescapeCss(/^["']/.test(v) ? v.slice(1, -1) : v.trim()))}]` : `[${n}]`))
  s = s.replace(/\s+/g, ' ').trim()
  let o = '', q = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) { o += c; if (c === '\\') o += s[++i]; else if (c === q) q = ''; continue }
    if (c === '\\') { o += c + s[++i]; continue }
    if (c === '"' || c === "'") { q = c; o += c; continue }
    if (c === ' ') { const p = o[o.length - 1], n = s[i + 1]; if ('(,>+~'.includes(p) || n === ')' || n === ',' || n === '>' || n === '+' || n === '~') continue }
    o += c
  }
  return o.replace(/::(before|after|first-line|first-letter)\b/g, ':$1').replace(/(^|[\s>+~(,])\*(?=[.#[:])/g, '$1')
}
const VENDOR_TOKEN = /(?<![\w-])-(?:webkit|moz|ms|o)-[a-z][a-z-]*/gi
function factsOf(css) {
  const root = postcss.parse(css)
  const f = { sels: new Set(), props: new Set(), vendor: new Set(), atrules: new Set(), nonAscii: new Set(), fallbacks: 0, longNumbers: [] }
  const ascii = (text) => { for (const ch of text) if (ch.codePointAt(0) > 127) f.nonAscii.add(ch) }
  root.walkAtRules((a) => { f.atrules.add('@' + a.name.toLowerCase() + ' ' + a.params.replace(/\s+/g, '').toLowerCase()) })
  root.walkRules((r) => {
    if (r.parent && r.parent.type === 'atrule' && /keyframes$/i.test(r.parent.name)) return
    for (const s of r.selectors) { f.sels.add(normSelector(s)); ascii(s) }
    const seen = new Map()
    r.each((d) => {
      if (d.type !== 'decl') return
      const p = d.prop.toLowerCase(), custom = p.startsWith('--')
      f.props.add(p)
      if (!custom) {
        const k = p + (d.important ? '!' : ''); seen.set(k, (seen.get(k) || 0) + 1)
        for (const m of d.value.matchAll(/(?<![\w.#-])[+-]?(?:\d+\.\d+|\.\d+)(?![\d.])/g)) if (m[0].replace(/^[+-]/, '').replace('.', '').replace(/^0+/, '').length > 6) f.longNumbers.push(`${p}: ${m[0]}`)
      }
      for (const m of (p + ' ' + d.value).matchAll(VENDOR_TOKEN)) f.vendor.add(m[0].toLowerCase())
      ascii(d.value)
    })
    for (const n of seen.values()) f.fallbacks += n - 1
  })
  return f
}
// the problems, as short sentences; [] means the output differs from the source in comments, white space and spelling only
export function losslessProblems(srcCss, outCss) {
  const a = factsOf(srcCss), b = factsOf(outCss), out = []
  const diff = (x, y) => [...x].filter((v) => !y.has(v))
  const show = (list) => list.slice(0, 3).map((x) => (x.length > 90 ? x.slice(0, 90) + '...' : x)).join(' | ') + (list.length > 3 ? ` (+${list.length - 3} more)` : '')
  const newSel = diff(b.sels, a.sels)
  if (newSel.length) out.push(`${newSel.length} selector(s) in the output that the source does not contain (a list rewritten with :is(), whose specificity is that of its most specific member; or a changed spelling): ${show(newSel)}`)
  const addP = diff(b.props, a.props), dropP = diff(a.props, b.props)
  if (addP.length) out.push(`property name(s) ADDED: ${addP.join(', ')} - a vendor twin the floor needs, or longhands merged into a shorthand: write that form in the source`)
  if (dropP.length) out.push(`property name(s) DROPPED: ${dropP.join(', ')} - merged into a shorthand, or a prefix the floor no longer needs: write the merged form / delete them in the source`)
  const addV = diff(b.vendor, a.vendor), dropV = diff(a.vendor, b.vendor)
  if (addV.length || dropV.length) out.push(`vendor-prefixed token(s) changed: added ${addV.join(', ') || 'none'}; dropped ${dropV.join(', ') || 'none'}`)
  const addA = diff(b.atrules, a.atrules)
  if (addA.length) out.push(`at-rule condition(s) rewritten: ${show(addA)} (write them in that form in the source)`)
  const addN = diff(b.nonAscii, a.nonAscii)
  if (addN.length) out.push(`non-ASCII character(s) in the output that the source writes as escapes (${addN.map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(' ')}): the file would stop being ASCII; write the character itself in the source`)
  if (b.fallbacks < a.fallbacks) out.push(`${a.fallbacks - b.fallbacks} fallback declaration(s) collapsed (a property declared twice in one rule, e.g. 100vh then 100dvh)`)
  if (a.longNumbers.length) out.push(`number(s) with more than 6 significant digits, which the minifier rounds: ${show(a.longNumbers)}`)
  return out
}
// color-mix() calls with no var() in them that the minifier folded to a colour in a NON-custom property (count in minus count out)
export const foldedColorMix = (srcCss, outCss) => {
  const count = (t) => (t.replace(/\/\*[\s\S]*?\*\//g, '').match(/color-mix\(/gi) || []).length
  return Math.max(0, count(srcCss) - count(outCss))
}
// the file as shipped: one header line, the minified CSS, one newline
export const generated = (name, code, opts) => headerFor(name) + '\n' + slim(code, opts) + '\n'
export const isGenerated = (text) => HEADER_RE.test(text)

// ------------------------------------------------------------------------------------------------------------- sizes
export const sizes = (buf) => {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  return { raw: b.length, gzip: gzipSync(b, { level: 9 }).length, brotli: brotliCompressSync(b, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_SIZE_HINT]: b.length } }).length }
}

// ------------------------------------------------------------------------------------------------------------- prune
// Everything the admin can render, as one text plus the "built from pieces" fragments. See the header for the policy.
const CORPUS_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.html', '.htm', '.php'])
const CLASSISH = '[A-Za-z0-9_:\\-\\/\\[\\]%.#]'
export function buildCorpus(paths) {
  const files = []
  const walk = (p) => {
    let st; try { st = statSync(p) } catch { return }
    if (st.isDirectory()) { for (const e of readdirSync(p)) { if (e === 'node_modules' || e === '.git') continue; walk(join(p, e)) } return }
    if (CORPUS_EXT.has(extname(p).toLowerCase())) files.push(p)   // stylesheets are NOT corpus: the add-on's own selectors would make everything "alive"
  }
  for (const p of paths) walk(p)
  files.sort()
  let text = ''
  for (const f of files) text += readFileSync(f, 'utf8') + '\n'
  const prefixes = new Set(), suffixes = new Set()
  // static text right before an interpolation / a "+":  `bg-${c}`  "btn-"+kind
  for (const m of text.matchAll(new RegExp(`(${CLASSISH}+)(?=\\$\\{)`, 'g'))) if (m[1].length >= 2) prefixes.add(m[1])
  for (const m of text.matchAll(new RegExp(`(${CLASSISH}+)["'\`]\\s*\\+`, 'g'))) if (m[1].length >= 2) prefixes.add(m[1])
  // static text right after an interpolation / a "+":  `${c}-500`  x+"-500"
  for (const m of text.matchAll(new RegExp(`\\}([-_:/]${CLASSISH}*)`, 'g'))) if (m[1].length >= 2) suffixes.add(m[1])
  for (const m of text.matchAll(new RegExp(`\\+\\s*["'\`]([-_:/]${CLASSISH}*)`, 'g'))) if (m[1].length >= 2) suffixes.add(m[1])
  // exact tokens (a class written whole between quotes / spaces) - used only to tell strong evidence from weak
  const tokens = new Set(text.split(/[\s"'`\\<>=,;(){}|&!?+*^~$@]+/))
  return { text, files, prefixes: [...prefixes], suffixes: [...suffixes], tokens, bytes: text.length }
}

// A very small selector printer for the evidence file (display only; the decision is made on the AST).
const cssEsc = (s) => s.replace(/[^A-Za-z0-9_\u00a1-\uffff-]/g, (c) => '\\' + c)
const COMB = { descendant: ' ', child: ' > ', 'next-sibling': ' + ', 'later-sibling': ' ~ ' }
const selStr = (sel) => sel.map((c) => {
  switch (c.type) {
    case 'class': return '.' + cssEsc(c.name)
    case 'id': return '#' + cssEsc(c.name)
    case 'type': return c.name
    case 'universal': return '*'
    case 'combinator': return COMB[c.value] ?? ` ${c.value} `
    case 'attribute': { const o = c.operation; const op = o ? (OPS[o.operator] ?? '?=') : ''; return `[${c.name}${op}${o ? JSON.stringify(o.value) : ''}]` }
    case 'pseudo-class': return ':' + c.kind + (c.selectors ? '(' + c.selectors.map(selStr).join(', ') + ')' : '')
    case 'pseudo-element': return '::' + c.kind
    case 'nesting': return '&'
    default: return `<${c.type}>`
  }
}).join('')

const OPS = { equal: '=', includes: '~=', 'dash-match': '|=', prefix: '^=', suffix: '$=', substring: '*=' }
const STANDARD_ATTRS = new Set(['class', 'id', 'type', 'href', 'src', 'name', 'value', 'for', 'role', 'dir', 'lang', 'style', 'disabled', 'checked', 'readonly', 'required', 'hidden', 'open', 'selected', 'placeholder', 'title', 'alt', 'target', 'rel', 'tabindex', 'min', 'max', 'step', 'multiple', 'autocomplete', 'inputmode', 'pattern', 'maxlength', 'accept', 'colspan', 'rowspan', 'scope', 'width', 'height', 'download', 'draggable', 'contenteditable', 'spellcheck', 'translate', 'popover', 'inert'])

// Returns null when the compound/selector may match, else {kind, value, why}.
export function makeJudge(corpus) {
  const has = (s) => corpus.text.includes(s)
  const viaPiece = (c) => corpus.prefixes.some((p) => c.length > p.length && c.startsWith(p)) || corpus.suffixes.some((s) => c.length > s.length && c.endsWith(s))
  const weak = []
  const deadName = (kind, value) => {            // class or id
    if (has(value)) { if (!corpus.tokens.has(value)) weak.push({ kind, value, why: 'substring only (not a whole token)' }); return null }
    if (viaPiece(value)) { weak.push({ kind, value, why: 'matches a built-from-pieces fragment' }); return null }
    return { kind, value, why: 'appears nowhere in the corpus' }
  }
  // `el.dataset.fooBar = 1` creates the attribute data-foo-bar without the text "data-foo-bar" appearing anywhere, and
  // `setAttribute('data-' + kind, ..)` / `setAttribute(`data-${mode}-flag`, ..)` build the name from pieces: both keep the rule
  // (reviewed 2026-11-04: both used to be removed, which would have deleted a rule that matches at run time)
  const camelOf = (n) => n.replace(/^data-/, '').replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase())
  const deadAttr = (c) => {
    const name = c.name
    if (!(STANDARD_ATTRS.has(name) || name.startsWith('aria-')) && !has(name)) {
      if (name.startsWith('data-') && has(camelOf(name))) { weak.push({ kind: 'attribute', value: name, why: 'the camelCase dataset key appears in the corpus' }); return null }
      if (viaPiece(name)) { weak.push({ kind: 'attribute', value: name, why: 'matches a built-from-pieces fragment' }); return null }
      return { kind: 'attribute', value: name, why: 'attribute name appears nowhere in the corpus' }
    }
    const o = c.operation
    if (o && typeof o.value === 'string' && o.value !== '' && !/\s/.test(o.value) && !has(o.value) && !viaPiece(o.value)) return { kind: 'attribute-value', value: `[${name}${OPS[o.operator] ?? '?='}${JSON.stringify(o.value)}]`, why: 'value appears nowhere in the corpus' }
    return null
  }
  const deadComp = (c) => {
    switch (c.type) {
      case 'class': return deadName('class', c.name)
      case 'id': return deadName('id', c.name)
      case 'attribute': return deadAttr(c)
      case 'pseudo-class':
        if ((c.kind === 'is' || c.kind === 'where' || c.kind === 'matches' || c.kind === 'any' || c.kind === 'has') && c.selectors) {
          const inner = c.selectors.map(deadSel)
          return inner.every(Boolean) ? { kind: 'pseudo-class', value: ':' + c.kind + '(...)', why: 'every alternative is dead: ' + inner.map((d) => d.value).join(' | ') } : null
        }
        return null                                                      // :not(), :hover, :nth-child ... never make a selector unmatchable
      default: return null
    }
  }
  // a complex selector needs EVERY compound; one dead component kills it
  function deadSel(sel) { for (const c of sel) { const d = deadComp(c); if (d) return d } return null }
  return { deadSel, weak }
}

// ------------------------------------------------------------------------------------------------------------- build
const rel = (p) => { const r = relative(WEB, p).split('\\').join('/'); return r.startsWith('..') ? p : r }
const read = (p) => readFileSync(p, 'utf8')
const git = (...args) => execFileSync('git', ['-C', WEB, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export function paths(name) {
  return { name, src: join(WEB, SRC_DIR, name + '.css'), pub: join(WEB, OUT_DIR, name + '.css') }
}

function parseArgs(argv) {
  const o = { names: [], mode: 'build', targets: 'shop', corpus: [], liveAssets: [], flags: new Set() }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i] }
    if (a === '--check') o.mode = 'check'
    else if (a === '--apply') o.mode = 'apply'
    else if (a === '--stats') o.mode = 'stats'
    else if (a === '--from') o.from = resolve(val())
    else if (a === '--out') o.out = resolve(val())
    else if (a === '--targets') o.targets = val()
    else if (a === '--prune-dead') o.flags.add('prune')
    else if (a === '--live-assets') o.liveAssets.push(resolve(val()))
    else if (a === '--corpus') o.corpus.push(resolve(val()))
    else if (a === '--pruned-json') o.prunedJson = resolve(val())
    else if (['--all', '--force', '--require', '--quiet', '--json'].includes(a)) o.flags.add(a.slice(2))
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`)
    else o.names.push(basename(a).replace(/\.css$/, ''))
  }
  o.explicitNames = o.names.length > 0
  if (!o.names.length) o.names.push(DEFAULT_NAME)
  return o
}

function sourceFor(o, name) {
  const p = paths(name)
  if (o.from) return { file: o.from, switched: false, explicit: true }
  if (existsSync(p.src)) return { file: p.src, switched: true }
  if (existsSync(p.pub) && !isGenerated(read(p.pub))) return { file: p.pub, switched: false }
  throw new Error(`no source for ${name}: ${rel(p.src)} does not exist and ${rel(p.pub)} is missing or already generated`)
}

function doPrune(o, srcText) {
  if (!o.liveAssets.length) throw new Error('--prune-dead needs --live-assets <dir of the captured compiled admin chunks>: the live build\'s source is not in the repo, so without its chunks "appears nowhere" would be a guess')
  const own = [join(WEB, 'src'), join(WEB, OUT_DIR), join(WEB, 'dropin', 'php-store')].filter(existsSync)
  const corpus = buildCorpus([...o.liveAssets, ...o.corpus, ...own])
  if (!corpus.files.length) throw new Error('the corpus is empty')
  const { deadSel, weak } = makeJudge(corpus)
  const removed = [], partial = []
  const visitor = {
    Rule: {
      style(rule) {
        const sels = rule.value.selectors
        const verdicts = sels.map(deadSel)
        const line = (rule.value.loc?.line ?? -1) + 1
        if (verdicts.every(Boolean)) {
          removed.push({ line, selectors: sels.map((s, i) => ({ selector: selStr(s), dead: verdicts[i] })), declarations: (rule.value.declarations?.declarations?.length ?? 0) + (rule.value.declarations?.importantDeclarations?.length ?? 0) })
          return []
        }
        verdicts.forEach((d, i) => { if (d) partial.push({ line, selector: selStr(sels[i]), dead: d }) })
        return undefined
      },
    },
  }
  const css = slim(srcText, { targets: o.targets, visitor })
  return { css, removed, partial, weak, corpus }
}

function buildOne(o, name) {
  const p = paths(name)
  const s = sourceFor(o, name)
  const srcText = read(s.file)
  if (isGenerated(srcText)) throw new Error(`${rel(s.file)} is itself generated; the source is ${SRC_DIR}/${name}.css`)
  let body, prune = null
  if (o.flags.has('prune')) { prune = doPrune(o, srcText); body = prune.css } else body = slim(srcText, { targets: o.targets })
  const text = headerFor(name) + '\n' + body + '\n'
  const folded = foldedColorMix(srcText, body)
  if (folded) console.error(`warning: the minifier folded ${folded} color-mix() call(s) to a static colour (8-bit alpha). Write the folded value in the source, or keep the call in a custom property`)
  return { p, s, srcText, text, prune }
}

function writeSafely(o, p, text, s) {
  const out = o.out ?? p.pub
  if (!o.out && !s.switched) throw new Error(`not switched yet: the source is ${rel(s.file)} itself, which this tool must not overwrite. Give --out <path> (a scratch file), or run --apply once to move the commented source to ${SRC_DIR}/ first`)
  if (!o.out && o.flags.has('prune')) throw new Error('--prune-dead never writes into public/ (the corpus is not in the repo, so the result cannot be reproduced by --check). Give --out <path> for review')
  if (existsSync(out) && !isGenerated(read(out)) && !o.flags.has('force') && out === p.pub) throw new Error(`${rel(out)} exists and is not generated (hand-edited, or not switched yet). Move the edit into ${SRC_DIR}/${p.name}.css, or pass --force to overwrite`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, text)
  return out
}

function printStats(label, rows) {
  const w = Math.max(...rows.map((r) => r.label.length), label.length)
  console.log(`${label.padEnd(w)}  ${'raw'.padStart(9)} ${'gzip'.padStart(8)} ${'brotli'.padStart(8)}`)
  for (const r of rows) console.log(`${r.label.padEnd(w)}  ${fmt(r.raw).padStart(9)} ${fmt(r.gzip).padStart(8)} ${fmt(r.brotli).padStart(8)}`)
}

function main(argv) {
  const o = parseArgs(argv)
  const quiet = o.flags.has('quiet')
  const say = (...a) => { if (!quiet) console.log(...a) }

  if (o.mode === 'stats' && o.flags.has('all')) {
    // what the same tool could save on every add-on stylesheet (nothing is written)
    const names = readdirSync(join(WEB, OUT_DIR)).filter((f) => /^(sporta-.*|backends-offline)\.css$/.test(f)).map((f) => f.replace(/\.css$/, '')).sort()
    const rows = []
    for (const n of names) {
      const t = read(join(WEB, OUT_DIR, n + '.css'))
      const src = isGenerated(t) && existsSync(paths(n).src) ? read(paths(n).src) : t
      let after
      let problems = []
      try { const body = generated(n, src, { targets: o.targets, guard: false }); after = sizes(body); if (o.targets === 'shop') problems = losslessProblems(src, body.replace(/^\/\*[^\n]*\*\/\n/, '')) } catch (e) { rows.push({ n, err: e.message.split('\n')[0] }); continue }
      rows.push({ n, before: sizes(src), after, problems })
    }
    console.log('file'.padEnd(26), 'raw before'.padStart(11), 'raw after'.padStart(10), 'gzip before'.padStart(12), 'gzip after'.padStart(11), 'br before'.padStart(10), 'br after'.padStart(9))
    let tb = { raw: 0, gzip: 0, brotli: 0 }, ta = { raw: 0, gzip: 0, brotli: 0 }
    for (const r of rows) {
      if (r.err) { console.log(r.n.padEnd(26), 'not measured:', r.err); continue }
      console.log(r.n.padEnd(26), fmt(r.before.raw).padStart(11), fmt(r.after.raw).padStart(10), fmt(r.before.gzip).padStart(12), fmt(r.after.gzip).padStart(11), fmt(r.before.brotli).padStart(10), fmt(r.after.brotli).padStart(9), r.problems.length ? `  GUARD: ${r.problems.length} problem(s) - the build would refuse this file as written` : '')
      for (const k of Object.keys(tb)) { tb[k] += r.before[k]; ta[k] += r.after[k] }
    }
    console.log('TOTAL'.padEnd(26), fmt(tb.raw).padStart(11), fmt(ta.raw).padStart(10), fmt(tb.gzip).padStart(12), fmt(ta.gzip).padStart(11), fmt(tb.brotli).padStart(10), fmt(ta.brotli).padStart(9))
    return 0
  }

  if (o.mode === 'check') {
    let bad = 0, checked = 0
    // no name given: the default plus every addons-src/*.css, so a source file added later is guarded too
    const names = o.explicitNames ? o.names : [...new Set([DEFAULT_NAME, ...(existsSync(join(WEB, SRC_DIR)) ? readdirSync(join(WEB, SRC_DIR)).filter((f) => f.endsWith('.css')).map((f) => f.replace(/\.css$/, '')) : [])])]
    for (const name of names) {
      const p = paths(name)
      if (!existsSync(p.src)) { say(`NOT SWITCHED: ${rel(p.src)} does not exist, nothing to compare for ${name} (run --apply to switch)`); if (o.flags.has('require')) bad++; continue }
      checked++
      if (!existsSync(p.pub)) { console.error(`DRIFT: ${rel(p.pub)} is missing; run npm run build:addon-css`); bad++; continue }
      const want = generated(name, read(p.src), { targets: o.targets })
      const have = read(p.pub)
      if (have === want) say(`ok   ${rel(p.pub)} is exactly what ${rel(p.src)} builds (${fmt(Buffer.byteLength(want))} bytes, lightningcss ${LIGHTNINGCSS_VERSION})`)
      else { bad++; console.error(`DRIFT: ${rel(p.pub)} differs from a fresh build of ${rel(p.src)}${isGenerated(have) ? '' : ' (it is not even a generated file: someone edited the shipped file; move the edit into ' + SRC_DIR + '/)'}. Run: npm run build:addon-css`) }
    }
    return bad ? 1 : 0
  }

  if (o.mode === 'apply') {
    for (const name of o.names) {
      const p = paths(name)
      const dirty = (() => { try { return git('status', '--porcelain', '--', rel(p.pub), rel(p.src)).trim() } catch (e) { throw new Error('git failed (is sporta-web inside a git work tree?): ' + String(e.stderr || e.message).trim()) } })()
      const haveSrc = existsSync(p.src), havePub = existsSync(p.pub)
      if (!havePub && !haveSrc) throw new Error(`neither ${rel(p.pub)} nor ${rel(p.src)} exists`)
      const pubGen = havePub && isGenerated(read(p.pub))
      // already switched and current: nothing to do, whether or not the switch itself has been committed yet
      if (haveSrc && pubGen && read(p.pub) === generated(name, read(p.src), { targets: o.targets })) {
        say(`ok     already switched, ${rel(p.pub)} is current (nothing changed)${dirty ? `\nnext   git commit -m "<message>" -- ${rel(p.src)} ${rel(p.pub)}   (the switch is staged, not committed)` : ''}`)
        continue
      }
      if (dirty) throw new Error(`refusing: git reports uncommitted changes to the file(s):\n${dirty}\nCommit or discard them first, so the switch is a clean move that nobody else's edit is in.`)
      let built
      if (!haveSrc) {
        if (pubGen) throw new Error(`${rel(p.pub)} is generated but ${rel(p.src)} is missing: the readable source is gone. Recover it from git history (git log -- ${rel(p.pub)})`)
        // Build BEFORE anything moves: if the minifier or the build guard refuses this file, `git mv` must not have happened (a refusal
        // after the move would leave public/ without its stylesheet and addons-src/ staged: a half-made switch).
        built = generated(name, read(p.pub), { targets: o.targets })
        mkdirSync(dirname(p.src), { recursive: true })
        try { git('mv', rel(p.pub), rel(p.src)) } catch (e) { throw new Error(`git mv failed (is ${rel(p.pub)} tracked?): ` + String(e.stderr || e.message).trim()) }
        say(`moved  ${rel(p.pub)} -> ${rel(p.src)}`)
      } else if (!pubGen && havePub) {
        throw new Error(`both ${rel(p.src)} and ${rel(p.pub)} exist, and ${rel(p.pub)} is not generated: somebody edited the shipped file after the switch. Merge by hand into ${SRC_DIR}/, then rebuild`)
      }
      const text = built ?? generated(name, read(p.src), { targets: o.targets })
      const same = existsSync(p.pub) && read(p.pub) === text
      if (!same) { mkdirSync(dirname(p.pub), { recursive: true }); writeFileSync(p.pub, text); git('add', '--', rel(p.pub), rel(p.src)) }
      say(same && haveSrc ? `ok     already switched, ${rel(p.pub)} is current (nothing changed)` : `built  ${rel(p.pub)} (${fmt(Buffer.byteLength(text))} bytes) from ${rel(p.src)}`)
      if (!same || !haveSrc) say(`next   git commit -m "<message>" -- ${rel(p.src)} ${rel(p.pub)}`)
    }
    return 0
  }

  // build / stats
  let status = 0
  for (const name of o.names) {
    const b = buildOne(o, name)
    if (o.mode === 'stats') {
      const rows = [{ label: `${rel(b.s.file)} (source, commented)`, ...sizes(b.srcText) }]
      const pure = generated(name, b.srcText, { targets: o.targets })
      rows.push({ label: 'minify only (what ships)', ...sizes(pure) })
      if (b.prune) rows.push({ label: 'minify + prune-dead (not shipped)', ...sizes(b.text) })
      printStats(name, rows)
      const cm = [...b.srcText.matchAll(/\/\*[\s\S]*?\*\//g)].reduce((n, m) => n + m[0].length, 0)
      say(`comments in the source: ${fmt(cm)} of ${fmt(b.srcText.length)} chars (${(100 * cm / b.srcText.length).toFixed(1)}%)   lightningcss ${LIGHTNINGCSS_VERSION}   targets: ${o.targets}`)
    } else {
      const out = writeSafely(o, b.p, b.text, b.s)
      say(`built  ${rel(out)} - ${fmt(Buffer.byteLength(b.text))} bytes from ${rel(b.s.file)} (${fmt(Buffer.byteLength(b.srcText))} bytes), lightningcss ${LIGHTNINGCSS_VERSION}, targets ${o.targets}${b.prune ? ', PRUNED' : ''}`)
    }
    if (b.prune) {
      const pr = b.prune
      say(`prune-dead: ${pr.removed.length} rule(s) removed, ${pr.partial.length} dead selector(s) left inside live rules (kept), ${pr.weak.length} class/id kept on weak evidence; corpus ${pr.corpus.files.length} files, ${fmt(pr.corpus.bytes)} chars`)
      if (o.prunedJson) {
        mkdirSync(dirname(o.prunedJson), { recursive: true })
        writeFileSync(o.prunedJson, JSON.stringify({
          tool: 'scripts/build-addon-css.mjs --prune-dead', source: rel(b.s.file), lightningcss: LIGHTNINGCSS_VERSION,
          corpus: { files: pr.corpus.files.length, chars: pr.corpus.bytes, prefixFragments: pr.corpus.prefixes.length, suffixFragments: pr.corpus.suffixes.length, roots: [...o.liveAssets, ...o.corpus, 'src', 'public', 'dropin/php-store'] },
          policy: 'a rule is removed only if EVERY selector in it needs a class/id/attribute that appears nowhere in the corpus (a built-from-pieces fragment keeps it); :not() never kills; :is/:where/:has die only when every alternative is dead',
          removedRules: pr.removed, deadSelectorsInLiveRules: pr.partial, keptOnWeakEvidence: pr.weak,
        }, null, 1) + '\n')
        say(`wrote  ${o.prunedJson}`)
      }
    }
  }
  return status
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = main(process.argv.slice(2)) } catch (e) { console.error('build-addon-css: ' + e.message); process.exitCode = 2 }
}
