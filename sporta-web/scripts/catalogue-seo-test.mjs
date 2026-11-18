// CATALOGUE-1118, what a crawler reads at /catalogue BEFORE any script runs: api/seo-page.php (dropin/php-store/seo-page.php) and the
// .htaccess rule that sends the path to it. The page itself is drawn by sporta-catalogue.js, but the owner chose a PUBLIC, indexable page, so the
// first HTML must already carry the right title, description, robots, canonical and alternates (otherwise the home page's static tags would
// describe it until a script ran).
//
//   npm run test:catalogue-seo     (php CLI + the real seo-page.php with the store's database layer stubbed: only the pure route/meta/render code runs)
//
// Asserted: /catalogue and /catalogue/ are a "page" route answered 200 and indexable, /catalogue/x and /Catalogue are the app's 404; Arabic and
// English titles ("... — سبورتا" / "... — Sporta"), descriptions, canonical (itself; ?lang=en in English), the en / ar / x-default alternates, og and
// twitter tags, robots; the strings are IDENTICAL to the ones sporta-features.js sets once it runs (so the head never flips); the .htaccess sends
// /catalogue to seo-page.php when it exists and to index.html when it does not, and /catalogue is in the same lists as the other fixed routes;
// the other routes' meta is untouched (the same defaults as before). MUTATION: with the route removed from seo-page.php the check goes red.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
if (spawnSync('php', ['-v']).error) { console.log('SKIP php is not installed'); process.exit(0) }

const SEO = readFileSync(join(ROOT, 'dropin/php-store/seo-page.php'), 'utf8')
const SHELL = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>home</title><meta name="description" content="home description">'
  + '<meta name="robots" content="index, follow"><link rel="canonical" href="https://www.sporta.com.kw/"><link rel="alternate" hreflang="en" href="https://www.sporta.com.kw/?lang=en">'
  + '<meta property="og:title" content="home"><meta property="og:description" content="home"><meta property="og:url" content="https://www.sporta.com.kw/">'
  + '<meta name="twitter:title" content="home"><meta name="twitter:description" content="home"></head><body><div id="root"></div></body></html>'

function runPhp(seoText, uri, lang) {
  const d = mkdtempSync(join(tmpdir(), 'sporta-seo-'))
  try {
    writeFileSync(join(d, 'seo-page.php'), seoText)
    // the store's layer, stubbed: nothing here touches a database, a file outside this directory or the network
    writeFileSync(join(d, 'store.php'), '<?php function store_seo_image_path($raw) { return ""; }\nfunction store_kwd($f) { return number_format($f / 1000, 3, ".", ""); }\nfunction store_effective_price($p) { return ["fils" => 0]; }\nfunction store_seo_public($db) { return []; }\n')
    writeFileSync(join(d, 'seo-runtime.php'), '<?php function sporta_seo_db() { return null; }\nfunction sporta_seo_public_path($f) { return null; }\n')
    writeFileSync(join(d, 'run.php'), `<?php
declare(strict_types=1);
$_SERVER['REQUEST_URI'] = ${JSON.stringify(uri)};
require __DIR__ . '/seo-page.php';
$route = sporta_seo_route($_SERVER['REQUEST_URI']);
$meta = sporta_seo_meta($route, ${JSON.stringify(lang)}, [], null);
echo json_encode(['route' => $route, 'meta' => $meta, 'html' => sporta_seo_render(file_get_contents(__DIR__ . '/shell.html'), $meta, ${JSON.stringify(lang)}, null, null)], JSON_UNESCAPED_UNICODE);
`)
    writeFileSync(join(d, 'shell.html'), SHELL)
    const o = spawnSync('php', [join(d, 'run.php')], { encoding: 'utf8' })
    if (o.status !== 0) return { error: (o.stderr || o.stdout).slice(0, 300) }
    return JSON.parse(o.stdout)
  } finally { rmSync(d, { recursive: true, force: true }) }
}
const tag = (html, re) => (re.exec(html) || [])[1]
const FEAT = readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8')
const block = /var TXT = \{[\s\S]*?\n    \}\n/.exec(FEAT.slice(FEAT.indexOf('CATALOGUE-1118 - begin')))[0]
// the block's strings are plain JS string literals with \\u escapes: evaluate the object literal, nothing else
const TXT = Function('"use strict"; ' + block + '; return TXT')()

head('the route and the head the server writes')
for (const [uri, lang, ar] of [['/catalogue', 'ar', true], ['/catalogue', 'en', false], ['/catalogue/', 'ar', true]]) {
  const r = runPhp(SEO, uri + (lang === 'en' ? '?lang=en' : ''), lang), t = `${uri} (${lang})`
  if (r.error) { is(false, `${t}: seo-page.php runs`, r.error); continue }
  is(r.route.kind === 'page' && r.route.status === 200 && r.route.path === '/catalogue' && r.meta.indexable === true, `${t}: a page route, status 200, indexable`, JSON.stringify(r.route))
  is(r.meta.title === TXT[lang].title && r.meta.description === TXT[lang].desc, `${t}: the title and description are the ones sporta-features.js sets (the head never flips)`, r.meta.title + ' | ' + TXT[lang].title)
  is(r.meta.canonical === 'https://www.sporta.com.kw/catalogue' + (ar ? '' : '?lang=en') && r.meta.ar === 'https://www.sporta.com.kw/catalogue' && r.meta.en === 'https://www.sporta.com.kw/catalogue?lang=en', `${t}: canonical is the page itself in its language; the alternates are both languages`, JSON.stringify([r.meta.canonical, r.meta.ar, r.meta.en]))
  is(tag(r.html, /<title>([^<]*)<\/title>/) === TXT[lang].title && /name="description" content="[^"]+"/.test(r.html) && !/home description/.test(r.html), `${t}: the shell's own home title and description are replaced`)
  is(/rel="canonical" href="https:\/\/www\.sporta\.com\.kw\/catalogue/.test(r.html) && !/rel="canonical" href="https:\/\/www\.sporta\.com\.kw\/"/.test(r.html), `${t}: the shell's home canonical is replaced`)
  is(!/noindex/i.test(r.html) && /name="robots" content="index/.test(r.html), `${t}: robots says index`)
  is(/property="og:url" content="https:\/\/www\.sporta\.com\.kw\/catalogue/.test(r.html) && /property="og:title" content="[^"]*(Product catalogue|كتالوج)/.test(r.html), `${t}: og:url and og:title name the catalogue`)
}
head('what is not the catalogue')
for (const uri of ['/catalogue/x', '/Catalogue', '/catalogues', '/catalogue.html']) {
  const r = runPhp(SEO, uri, 'en'); is(!r.error && r.route.kind === 'missing' && r.route.status === 404 && r.meta.indexable === false, `${uri}: still the app's real 404 (noindex)`, JSON.stringify(r.route))
}
for (const uri of ['/shop', '/about', '/']) {
  const r = runPhp(SEO, uri, 'en'); is(!r.error && r.route.kind === 'page' && !/atalogue/.test(r.meta.title), `${uri}: unchanged (${r.meta && r.meta.title})`)
}
head('.htaccess')
const HT = readFileSync(join(ROOT, 'public/.htaccess'), 'utf8')
const lines = HT.split('\n').filter((l) => /RewriteRule \^\(shop\|cart\|/.test(l))
is(lines.length === 2 && lines.every((l) => /\|catalogue\)\/\?\$/.test(l)), '/catalogue is in both fixed-route rules (the seo-page.php one and the index.html fallback)', String(lines.length))
const iSeo = lines.findIndex((l) => /seo-page\.php \[END\]/.test(l)), iIdx = lines.findIndex((l) => /\/index\.html \[L\]/.test(l))
is(iSeo >= 0 && iIdx >= 0 && HT.indexOf(lines[iSeo]) < HT.indexOf(lines[iIdx]), 'the seo-page.php rule comes first (and is guarded by the file existing), the index.html fallback after it')
is(/sporta-features\\\.js\|sporta-catalogue\\\.js\|/.test(HT), 'sporta-catalogue.js is in the no-cache add-on list (a new version reaches every visitor)')
head('mutation')
{
  const cut = SEO.replace("'/terms', '/privacy', '/catalogue'], true)", "'/terms', '/privacy'], true)")
  const r = runPhp(cut, '/catalogue', 'en')
  is(cut !== SEO && !r.error && r.route.kind === 'missing', 'with /catalogue cut from the route list the crawler would get a 404: the check above goes red')
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
void existsSync
