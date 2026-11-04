// Mutation check for scripts/checkout-split-test.mjs.
//
//   node scripts/checkout-split-mutants.mjs [M3 M7 ...]     (no arguments: every mutant)
//
// A suite that passes proves little until it has been seen to fail. This takes a COPY of the working tree
// (never the repo), removes ONE behaviour from the copy, builds it, runs the sections of the suite that are
// supposed to notice, and requires the run to FAIL -- and to fail on the checks that guard that behaviour,
// not on something unrelated. Then it runs the unmutated copy once and requires it to PASS, so a mutant
// cannot "die" because the harness is broken.
//
// The baseline build (the working tree with the failure message taken out: controlTree) is made once and shared.
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WEB, buildSite, controlTree, copyTree, rmrf, workDir } from './checkout-split-harness.mjs'

// The mutation texts below quote source files of src/ that import their neighbours ("../lib/x"). Written out in full they
// read, to test:file-names, as imports of THIS script that resolve to nothing (it failed on four of them), so the
// leading ".." is spelled apart from the rest.
const UP = '..'

const MUTANTS = [
  {
    id: 'M1', what: 'a lazy page that cannot load is not noticed (no listener)', sections: 'E', expect: ['E0'],
    edit: { 'vite.config.js': [["'addEventListener(\"error\",bad);addEventListener(\"unhandledrejection\",bad)})()</script>'", "'})()</script>'"]] },
  },
  {
    id: 'M2', what: 'the message shows over a page that is working', sections: 'E', expect: ['E9'],
    edit: { 'vite.config.js': [['if(!o||o.children.length||document.getElementById("sporta-cf"))return;', 'if(!o||document.getElementById("sporta-cf"))return;']] },
  },
  {
    id: 'M3', what: 'the Retry button does nothing', sections: 'E', expect: ['E7'],
    edit: { 'vite.config.js': [['d.lastChild.onclick=function(){location.reload()}', 'd.lastChild.onclick=function(){}']] },
  },
  {
    id: 'M4', what: 'the Retry button is not focused', sections: 'E', expect: ['E4'],
    edit: { 'vite.config.js': [['document.body.append(d);d.lastChild.focus()}', 'document.body.append(d)}']] },
  },
  {
    id: 'M5', what: 'the message is always left-to-right', sections: 'E', expect: ['E2'],
    edit: { 'vite.config.js': [['d.dir=a?"rtl":"ltr";', 'd.dir="ltr";']] },
  },
  {
    id: 'M6', what: 'the message grows by 3 kB that does not compress (the price every page pays)', sections: 'A', expect: ['A5'],
    edit: { 'vite.config.js': [["addEventListener(\"error\",bad);addEventListener(\"unhandledrejection\",bad)})()</script>'", `addEventListener(\"error\",bad);addEventListener(\"unhandledrejection\",bad)})()/*${randomBytes(2300).toString('base64')}*/</script>'`]] },
  },
  {
    id: 'M7', what: 'the checkout is loaded by the document on every page', sections: 'A', expect: ['A2'],
    edit: {
      'vite.config.js': [["        return html.replace('</head>', () => script + '</head>')", "        const pre = Object.keys(ctx.bundle).filter((f) => /^assets\\/Checkout-.*\\.js$/.test(f)).map((f) => `<link rel=\"modulepreload\" href=\"/${f}\">`).join('')\n        return html.replace('</head>', () => pre + script + '</head>')"]],
    },
  },
  {
    id: 'M8', what: 'the order carries an amount', sections: 'F', expect: ['F2', 'F4'],
    edit: { 'src/lib/backend.js': [['      track_id: trackId,\n', '      track_id: trackId,\n      amount: 1,\n']] },
  },
  {
    id: 'M9', what: 'a stop is added to the tab order', sections: 'G', expect: ['G2'],
    edit: { 'src/pages/Checkout.jsx': [['<h1 className="mt-5 mb-2 text-3xl font-extrabold text-slate-900">{t.cart.checkout}</h1>', '<h1 tabIndex={0} className="mt-5 mb-2 text-3xl font-extrabold text-slate-900">{t.cart.checkout}</h1>']] },
  },
  {
    id: 'M10', what: 'applying a coupon needs a chunk that is fetched on demand', sections: 'D', expect: ['D6'],
    edit: { 'src/pages/Checkout.jsx': [['    const entered = code.trim()\n', `    const entered = code.trim()\n    await import('${UP}/lib/zz-lazy-mutant')\n`]] },
    files: { 'src/lib/zz-lazy-mutant.js': 'export const mutant = Date.now()\n' },
  },
  {
    id: 'M11', what: 'the checkout shifts after it has painted', sections: 'H', expect: ['H1'],
    edit: {
      'src/pages/Checkout.jsx': [
        ["  usePageMeta({ path: '/checkout', robots: 'noindex, follow' })\n", "  usePageMeta({ path: '/checkout', robots: 'noindex, follow' })\n  const [late, setLate] = useState(false)\n  useEffect(() => { const id = setTimeout(() => setLate(true), 600); return () => clearTimeout(id) }, [])\n"],
        ['      <CheckoutSteps current="details" paying={busy} />\n\n      <h1 className="mt-5 mb-2', '      {late && <div style={{ height: 160 }}>.</div>}\n      <CheckoutSteps current="details" paying={busy} />\n\n      <h1 className="mt-5 mb-2'],
      ],
    },
  },
  {
    id: 'M12', what: 'intent no longer fetches the checkout from the bag', sections: 'D', expect: ['D1'],
    edit: { 'src/lib/prefetchRoute.js': [[`  '/checkout': () => import('${UP}/pages/Checkout'),`, "  '/checkout': () => Promise.resolve(),"]] },
  },
  {
    id: 'M13', what: 'intent ignores Save-Data and 2G', sections: 'D', expect: ['D4'],
    edit: { 'src/lib/prefetchRoute.js': [['  const c = navigator.connection\n  if (!c) return true\n', '  return true\n']] },
  },
  // ---- added in review
  {
    id: 'M14', what: 'the message takes the language the page BOOTED in, not the one it is in now', sections: 'E', expect: ['E11'],
    edit: { 'vite.config.js': [['a=(document.documentElement.lang||window.__SPORTA_LANG)=="ar"', 'a=(window.__SPORTA_LANG||document.documentElement.lang)=="ar"']] },
  },
  {
    id: 'M15', what: 'a helper is given a file of its own that the document loads (one more request on every page)', sections: 'A', expect: ['A9'],
    edit: { 'vite.config.js': [["if (id.includes('vite/preload-helper')) return 'react-vendor'", "if (id.includes('vite/preload-helper')) return 'preload-helper'"]] },
  },
  {
    id: 'M16', what: 'the message card touches both screen edges on a narrow phone', sections: 'E', expect: ['E13'],
    edit: { 'vite.config.js': [['max-width:min(28rem,calc(100% - 2rem));', 'max-width:28rem;']] },
  },
  {
    id: 'M17', what: 'the quick-checkout card is split into a chunk of its own (the split that was measured and rejected)', sections: 'A', expect: ['A10'],
    edit: { 'src/pages/Checkout.jsx': [[`import QuickCheckout from '${UP}/components/QuickCheckout'`, `import { lazy } from 'react'\nconst QuickCheckout = lazy(() => import('${UP}/components/QuickCheckout'))`]] },
  },
  {
    id: 'M18', what: 'a failed prefetch followed by a click ends on an empty page (no listener for the rejection)', sections: 'E', expect: ['E14'],
    edit: { 'vite.config.js': [["'addEventListener(\"error\",bad);addEventListener(\"unhandledrejection\",bad)})()</script>'", "'})()</script>'"]] },
  },
]

const want = process.argv.slice(2)
const todo = MUTANTS.filter((m) => !want.length || want.includes(m.id))
const tmp = workDir('mutants')
let bad = 0
try {
  console.log('baseline (the working tree without the failure message) ...')
  const snap = copyTree(join(tmp, 'snap')) // one snapshot: the baseline, the control and every mutant start from it
  const baseline = buildSite(controlTree(join(tmp, 'ctl'), snap), join(tmp, 'baseline'))

  const run = (root, sections) => {
    const r = spawnSync(process.execPath, [join(WEB, 'scripts', 'checkout-split-test.mjs')], {
      encoding: 'utf8', maxBuffer: 1 << 26,
      env: { ...process.env, SPLIT_ROOT: root, SPLIT_BEFORE_DIST: baseline, SPLIT_SECTIONS: sections, SPLIT_WORK: tmp },
    })
    const out = `${r.stdout}\n${r.stderr}`
    return { status: r.status, failed: [...out.matchAll(/^FAIL (\S+)/gm)].map((m) => m[1]), tail: out.split('\n').slice(-6).join('\n') }
  }

  // The control: an unmutated copy must pass the same sections, one group at a time (a busy machine
  // should not be able to fail it by being asked for everything at once).
  {
    const root = copyTree(join(tmp, 'control'), snap)
    for (const sections of [...new Set(todo.map((m) => m.sections))]) {
      const r = run(root, sections)
      const ok = r.status === 0
      console.log(`${ok ? 'ok  ' : 'FAIL'} control: the unmutated copy passes section ${sections}`)
      if (!ok) { bad++; console.log(r.tail) }
    }
  }

  for (const m of todo) {
    const root = copyTree(join(tmp, m.id), snap)
    for (const [rel, edits] of Object.entries(m.edit)) {
      let s = readFileSync(join(root, rel), 'utf8')
      for (const [from, to] of edits) {
        if (!s.includes(from)) throw new Error(`${m.id}: text to mutate not found in ${rel}: ${from.slice(0, 70)}`)
        s = s.replace(from, () => to)
      }
      writeFileSync(join(root, rel), s)
    }
    for (const [rel, body] of Object.entries(m.files ?? {})) {
      mkdirSync(join(root, rel, '..'), { recursive: true })
      writeFileSync(join(root, rel), body)
    }
    const r = run(root, m.sections)
    const caught = r.status !== 0 && m.expect.some((id) => r.failed.some((f) => f === id))
    if (!caught) bad++
    console.log(`${caught ? 'ok  ' : 'FAIL'} ${m.id} ${m.what}: ${caught ? `the suite failed on ${[...new Set(r.failed)].join(', ')}` : `NOT CAUGHT (exit ${r.status}, failed: ${r.failed.join(',') || 'none'})`}`)
    rmrf(join(tmp, m.id))
  }
} finally {
  rmrf(tmp)
}
console.log(bad ? `\n${bad} problem(s)` : '\nevery mutant was caught')
process.exit(bad ? 1 : 0)
