/**
 * public_html/.htaccess, executed by a real Apache.
 *
 *   node scripts/htaccess-test.mjs        (installs nothing; needs apache2)
 *
 * 24 KB of routing, redirects and refusals had never been RUN here. The
 * sandbox serves the site with `php -S`, which ignores .htaccess entirely, so
 * every rule in it was only ever read. That is the whole file: which URLs
 * exist, which are redirected, which are refused, and which are allowed to
 * 404 — and a mistake in any of them is invisible until the live site has it.
 *
 * This boots Apache on 4400 against the real public_html with AllowOverride
 * All, asks it for a list of URLs, and checks the answers.
 *
 * TWO THINGS IT HAS TO FAKE, because both rules are real and would otherwise
 * swallow every request:
 *
 *   Host: www.sporta.com.kw     .htaccess 301s every other hostname
 *   X-Forwarded-Proto: https    and 301s anything not already on https
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK. This Apache has no PHP handler, so
 * .php files come back as SOURCE with a 200. That is a property of the rig,
 * not of Hostinger — but it means a check like "admin.php answers 200" would
 * pass here while proving nothing, and would keep passing if the file were
 * empty. So nothing below asserts anything about a PHP response; admin.php is
 * covered by admin-live-test.mjs against real PHP. The one PHP path that IS
 * asserted is config.php, and only that it is REFUSED — a 403 is a 403
 * whether or not an interpreter is present.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync, existsSync, rmSync, readdirSync, unlinkSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const DOCROOT = `${ROOT}/sporta-site/public_html`
const PORT = 4400
const CONF = '/tmp/sporta-htaccess-test.conf'

if (!existsSync('/usr/sbin/apache2')) {
  console.log('SKIP  apache2 is not installed — this check needs a real Apache')
  console.log('      apt-get install -y apache2   (it is never started as a service)')
  process.exit(0)
}

// Only the modules .htaccess actually uses. Listed rather than pulled from the
// distro's config so this cannot silently start depending on something the
// real host does not load.
const MODULES = ['mpm_event', 'authz_core', 'mime', 'dir', 'setenvif', 'env',
                 'expires', 'deflate', 'filter', 'alias', 'headers', 'rewrite']
const load = MODULES
  .filter((m) => existsSync(`/usr/lib/apache2/modules/mod_${m}.so`))
  .map((m) => `LoadModule ${m}_module /usr/lib/apache2/modules/mod_${m}.so`)
  .join('\n')

writeFileSync(CONF, `ServerName 127.0.0.1
Listen ${PORT}
${load}
TypesConfig /etc/mime.types
User www-data
Group www-data
ErrorLog /tmp/sporta-htaccess-test.err
PidFile /tmp/sporta-htaccess-test.pid
<VirtualHost *:${PORT}>
  DocumentRoot ${DOCROOT}
  <Directory ${DOCROOT}>
    AllowOverride All
    Require all granted
  </Directory>
</VirtualHost>
`)

const stop = () => spawnSync('apache2', ['-f', CONF, '-k', 'stop'], { stdio: 'ignore' })
stop()
const start = spawnSync('apache2', ['-f', CONF, '-k', 'start'], { encoding: 'utf8' })
if (start.status !== 0) {
  console.log('FAIL apache would not start:\n' + (start.stderr || start.stdout))
  process.exit(1)
}
// Apache forks; give it a moment to bind before the first request.
execFileSync('sh', ['-c', 'for i in $(seq 20); do curl -s -o /dev/null ' +
  `http://127.0.0.1:${PORT}/ && exit 0; sleep 0.2; done`], { stdio: 'ignore' })

let fails = 0
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }

/** Same as get(), but for a named host — the asset host has its own rules. */
const getOn = (host, path) => {
  const out = execFileSync('curl', [
    '-s', '-o', '/dev/null',
    '-H', `Host: ${host}`,
    '-H', 'X-Forwarded-Proto: https',
    '-w', '%{http_code} %{redirect_url}',
    `http://127.0.0.1:${PORT}${path}`,
  ], { encoding: 'utf8' }).trim().split(' ')
  return { status: Number(out[0]), to: out[1] ?? '' }
}

/** A named response header, as a named host sees it. */
const headerOn = (host, path, name) => {
  const head = execFileSync('curl', [
    '-s', '-o', '/dev/null', '-D', '-',
    '-H', `Host: ${host}`, '-H', 'X-Forwarded-Proto: https',
    `http://127.0.0.1:${PORT}${path}`,
  ], { encoding: 'utf8' })
  return (head.match(new RegExp(`^${name}:\\s*(.*)$`, 'im'))?.[1] ?? '').trim()
}

const get = (path) => {
  const out = execFileSync('curl', [
    '-s', '-o', '/dev/null',
    '-H', 'Host: www.sporta.com.kw',
    '-H', 'X-Forwarded-Proto: https',
    '-w', '%{http_code} %{redirect_url}',
    `http://127.0.0.1:${PORT}${path}`,
  ], { encoding: 'utf8' }).trim().split(' ')
  return { status: Number(out[0]), to: out[1] ?? '' }
}

/** The BODY Apache returns. get() throws it away (-o /dev/null), which made
 *  "does not serve its contents" a check that could never fail. */
const bodyOf = (path) => execFileSync('curl', [
  '-s', '-H', 'Host: www.sporta.com.kw', '-H', 'X-Forwarded-Proto: https',
  `http://127.0.0.1:${PORT}${path}`,
], { encoding: 'utf8' })

/** The Cache-Control a real Apache actually sends for a path, or '' if none. */
const cacheOf = (path) => {
  const head = execFileSync('curl', [
    '-s', '-o', '/dev/null', '-D', '-',
    '-H', 'Host: www.sporta.com.kw',
    '-H', 'X-Forwarded-Proto: https',
    `http://127.0.0.1:${PORT}${path}`,
  ], { encoding: 'utf8' })
  return (head.match(/^cache-control:\s*(.*)$/im)?.[1] ?? '').trim()
}

// --- the cookie-free asset host ------------------------------------------
//
// static.sporta.com.kw shares this document root, so every rule in this file
// applies to it too. That is what makes it cheap and what makes it dangerous:
// left alone it is a second, complete, indexable copy of the shop.
//
// None of this was checked here before the host existed, and a rule nobody
// asserts is a rule the next edit can drop in silence.
const STATIC = 'static.sporta.com.kw'
console.log('\n--- static.sporta.com.kw, the cookie-free asset host')
{
  const css = getOn(STATIC, '/assets/sporta-ui.css')
  check(css.status === 200, `assets are SERVED on the asset host (${css.status})`)

  for (const dir of ['/fonts/alexandria-var-latin.woff2', '/hero/desktop/bodybuilding-men.webp']) {
    check(getOn(STATIC, dir).status === 200, `${dir} is served there too`)
  }

  // The half that stops it becoming a second shop.
  for (const page of ['/', '/shop', '/checkout', '/backends']) {
    const r = getOn(STATIC, page)
    check(r.status === 301 && /^https:\/\/www\.sporta\.com\.kw/.test(r.to),
      `${page} on the asset host goes to www (${r.status} ${r.to || 'nowhere'})`)
  }

  // A cross-origin font is refused without this, whatever CSP says.
  const acao = headerOn(STATIC, '/fonts/alexandria-var-latin.woff2', 'access-control-allow-origin')
  check(acao === 'https://www.sporta.com.kw',
    `fonts carry one named CORS origin, not a wildcard — "${acao || 'NOTHING'}"`)

  check(/noindex/i.test(headerOn(STATIC, '/assets/sporta-ui.css', 'x-robots-tag')),
    'assets on the asset host are noindex')

  // And www must be unaffected by all of it.
  check(get('/shop').status === 200, 'www still serves the app')
}

try {
  console.log('--- the panel, and the alias to it')
  // The panel lives on /backends. /admin is an alias and must REDIRECT, not
  // rewrite: the single-page app's router only knows /backends, so serving
  // index.html at /admin renders the shop's 404 and reads as a broken panel.
  for (const [from, to] of [
    ['/admin', '/backends'],
    ['/admin/orders', '/backends/orders'],
    ['/admin/inventory', '/backends/inventory'],
  ]) {
    const r = get(from)
    check(r.status === 302 && r.to === `https://www.sporta.com.kw${to}`,
      `${from} redirects to ${to} (${r.status} ${r.to})`)
  }
  // 302, not 301: a permanent redirect is cached by the browser more or less
  // forever, and there is no reaching into that cache if the panel moves.
  check(get('/admin').status === 302, 'the alias is temporary (302), so it stays changeable')

  for (const p of ['/backends', '/backends/orders', '/backends/inventory']) {
    check(get(p).status === 200, `${p} is served by the app (deep links and refreshes work)`)
  }

  console.log('\n--- the shop')
  for (const p of ['/', '/shop', '/cart', '/checkout', '/about', '/contact',
                   '/wishlist', '/track', '/returns', '/terms', '/privacy', '/review',
                   '/product/vanquish-t-shirt-white', '/invoice/SPABC123', '/payment/result']) {
    check(get(p).status === 200, `${p} answers 200`)
  }
  // THE SHOP'S PAGES MUST GO THROUGH seo.php, AND "200" CANNOT TELL YOU THAT.
  //
  // index.html has one hardcoded <head>: served for every route it gives every
  // product URL the same title and a canonical pointing at "/", which reads to
  // Google as 92 duplicates of the homepage and makes every shared product
  // link preview as the generic store card. seo.php exists to replace those
  // tags per route, looking the product up in MySQL.
  //
  // The repo shipped index.html here for a long time while the live server ran
  // seo.php, and nothing noticed — because every check above asks only whether
  // the route answers 200, and it does either way. A rewrite pointing at the
  // wrong file is invisible to a status code.
  //
  // THE RIG'S OWN LIMITATION IS WHAT MAKES THIS CHECKABLE. This Apache has no
  // PHP (see the header), so a .php target comes back as SOURCE — which means
  // the body carries seo.php's own first line when the rewrite is right, and
  // cannot when it points at index.html. On a real host PHP executes and the
  // body is HTML, so this assertion is deliberately scoped to the rig.
  for (const p of ['/', '/shop', '/product/vanquish-t-shirt-white', '/invoice/SPABC123']) {
    const body = bodyOf(p)
    check(body.includes('seo.php — per-route'),
      `${p} is rendered through seo.php, not straight from index.html`)
  }

  // A real 404, not the SPA shell with a 200. Google reads a soft 404 as a
  // page worth indexing, and the crawl budget goes on junk.
  check(get('/no-such-page').status === 404, 'an unknown URL is a genuine 404, not a soft one')
  check(get('/shop/').to === 'https://www.sporta.com.kw/shop',
    'a trailing slash redirects to the canonical spelling')
  check(get('/index.html').to === 'https://www.sporta.com.kw/',
    '/index.html redirects to / so it cannot be indexed twice')

  console.log('\n--- .txt, both directions')
  // ROBOTS.TXT IS THE DANGEROUS HALF OF THIS RULE. .txt is denied by default
  // because a hand-over note naming which file holds the database password was
  // found sitting in the live web root, publicly fetchable. But robots.txt
  // closed to Googlebot is worse than that leak — crawling stops, and it stops
  // silently, with the site looking perfectly healthy to everyone who visits
  // it. So the allowlist is asserted before the denial is.
  for (const f of ['/robots.txt', '/llms.txt']) {
    check(get(f).status === 200, `${f} is still served — search engines depend on it`)
  }
  writeFileSync(`${DOCROOT}/UPLOAD-NOTE-RIG.txt`, 'internal deployment note\n')
  check(get('/UPLOAD-NOTE-RIG.txt').status === 403,
    'a hand-over note left in the web root is refused (403)')
  check(!bodyOf('/UPLOAD-NOTE-RIG.txt').includes('internal deployment note'),
    'and its contents do not come back anyway')
  rmSync(`${DOCROOT}/UPLOAD-NOTE-RIG.txt`, { force: true })

  console.log('\n--- what must never be served')
  // Not a PHP question: a refusal is a refusal with or without an
  // interpreter, which is exactly why it is safe to assert here.
  for (const p of ['/api/config.php', '/pay/config.php', '/knet/config.php']) {
    const r = get(p)
    check(r.status === 403 || r.status === 404, `${p} is refused (${r.status})`)
  }
  for (const p of ['/.git/config', '/.env', '/.htaccess']) {
    const r = get(p)
    check(r.status === 403 || r.status === 404, `${p} is refused (${r.status})`)
  }
  // THE IMPORT FIXTURES. api/.htaccess denies *.sql by name and its own
  // comment says why — seed.mysql.sql names every product and its COST PRICE,
  // which is the shop's margin on a public URL. The rule was never asserted;
  // the sandbox runs PHP's built-in server, which reads no .htaccess and
  // answers these 200, so nothing here would ever have noticed it break.
  for (const p of ['/api/install.mysql.sql', '/api/seed.mysql.sql', '/api/store.php']) {
    const r = get(p)
    check(r.status === 403 || r.status === 404, `${p} is refused (${r.status})`)
  }
  // LOGS AND DUMPS, anywhere in the docroot. The two payment logs are
  // configured to live two levels ABOVE public_html, so a correct install
  // never puts one here — this is for the install that is not correct.
  // `log_file` is a path in a config file, it looks relative, and a hand that
  // points it at __DIR__ rather than __DIR__/../.. publishes every track id,
  // amount and bank result code under a guessable name.
  //
  // THE DECOYS ARE WRITTEN FIRST, and that is the whole point. Asking for a
  // file that does not exist answers 404, which is indistinguishable from
  // "refused" — the first version of this check accepted either and passed
  // happily with the deny rule deleted. A file that is really on disk is
  // refused only if a rule refuses it.
  const decoys = [
    ['cbk-payments.log', 'trackid=SPDECOY1 amt=11.000 result=CAPTURED paymentid=P9'],
    ['knet-payments.log', 'trackid=SPDECOY2 amt=8.000 result=CAPTURED'],
    ['backup.sql', 'insert into orders values (1, "SPDECOY3", "96555512345");'],
    ['dump.bak', 'db_pass=decoy'],
  ]
  for (const [name, body] of decoys) writeFileSync(`${DOCROOT}/${name}`, body)
  try {
    for (const [name, body] of decoys) {
      const r = get(`/${name}`)
      check(r.status === 403, `/${name} is refused even though the file is really there (${r.status})`)
      check(!bodyOf(`/${name}`).includes(body.slice(0, 18)),
        `/${name} does not serve its contents`)
    }
  } finally {
    for (const [name] of decoys) { try { unlinkSync(`${DOCROOT}/${name}`) } catch {} }
  }

  console.log('\n--- the generated sitemap beats the stale static copy')
  check(get('/sitemap-products.xml').status === 200,
    'sitemap-products.xml is answered (by api/sitemap-products.php on a real host)')

  // ---------------------------------------------------- caching, by category
  //
  // EVERY FILE MUST MATCH A RULE. The caching block keys on filename patterns —
  // a content hash for build output, an extension for images and fonts — and a
  // file matching none of them gets no Cache-Control at all, which does not
  // mean "do not cache". It means every cache in the path applies a heuristic,
  // typically a tenth of the time since Last-Modified.
  //
  // That was true of the four hand-written override files, and it is the worst
  // place for it: they carry every correction made since the build was produced
  // and they only work as a SET with the index.html that names them. A browser
  // holding yesterday's sporta-ui.css against today's page applies half the
  // rules and not the other half, which does not look like a stale cache — it
  // looks like the site is broken, and the server cannot see it because the
  // server sent the right file.
  console.log('\n--- what may be cached, and for how long')
  //
  // site.webmanifest and the HTML are in this list from 2026-09-05, after the
  // live server was asked and answered max-age=3600 for the manifest and a
  // bare max-age=0 for the shell. Both are fixed names whose bytes change —
  // the manifest names the app icons, index.html IS the whole app — so they
  // belong with sw.js and config.js rather than with robots.txt. Neither was
  // checked here before, which is why neither was noticed.
  for (const f of ['/assets/sporta-ui.css', '/assets/sporta-dark.css',
                   '/assets/contact.js', '/assets/card.js', '/config.js', '/sw.js',
                   '/site.webmanifest', '/card.html', '/']) {
    const cc = cacheOf(f)
    check(/no-cache/.test(cc),
      `${f} revalidates before use — "${cc || 'NOTHING, so every cache guesses'}"`)
  }

  // And the other half of the bargain: only content-hashed output may be
  // immutable, because only its filename changes when its bytes do.
  const hashed = readdirSync(`${DOCROOT}/assets`)
    .filter((f) => /-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(f)).slice(0, 3)
  for (const f of hashed) {
    const cc = cacheOf(`/assets/${f}`)
    check(/immutable/.test(cc), `assets/${f} is immutable — "${cc}"`)
  }
  for (const f of ['/assets/sporta-ui.css', '/assets/contact.js']) {
    check(!/immutable/.test(cacheOf(f)),
      `${f} is NOT immutable — its name never changes, so a year would strand it`)
  }

  // EVERY un-hashed script and stylesheet in assets/, not a list of them.
  //
  // The .htaccess rule that gives these files `no-cache` names them one by one,
  // and track-guard.js was added to the folder a fortnight after the rule was
  // written, so it matched nothing and every cache in the path guessed at it.
  // That is invisible from the server — the right file was sent — and its
  // symptom is the /track button going silent again for whoever held the stale
  // copy, which is the exact defect the script exists to fix.
  //
  // Checking the FOLDER rather than a list is the only version of this test
  // that catches the NEXT one. A file is un-hashed if its name has no content
  // hash in it, which is precisely the condition that makes the immutable rule
  // inapplicable and an explicit Cache-Control necessary.
  const unhashed = readdirSync(`${DOCROOT}/assets`)
    .filter((f) => /\.(js|css)$/.test(f) && !/-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(f))
  for (const f of unhashed) {
    const cc = cacheOf(`/assets/${f}`)
    check(/no-cache|must-revalidate|max-age=0/.test(cc),
      `assets/${f} names no content hash, so it states its own freshness — "${cc || 'NOTHING'}"`)
  }
} finally {
  stop()
  rmSync(CONF, { force: true })
}

console.log(fails ? `\n${fails} failed` : '\nall ok — .htaccess, run by Apache')
process.exit(fails ? 1 : 0)
