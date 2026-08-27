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
import { writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs'

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
  // A real 404, not the SPA shell with a 200. Google reads a soft 404 as a
  // page worth indexing, and the crawl budget goes on junk.
  check(get('/no-such-page').status === 404, 'an unknown URL is a genuine 404, not a soft one')
  check(get('/shop/').to === 'https://www.sporta.com.kw/shop',
    'a trailing slash redirects to the canonical spelling')
  check(get('/index.html').to === 'https://www.sporta.com.kw/',
    '/index.html redirects to / so it cannot be indexed twice')

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
  for (const f of ['/assets/sporta-ui.css', '/assets/sporta-dark.css',
                   '/assets/contact.js', '/assets/card.js', '/config.js', '/sw.js']) {
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
} finally {
  stop()
  rmSync(CONF, { force: true })
}

console.log(fails ? `\n${fails} failed` : '\nall ok — .htaccess, run by Apache')
process.exit(fails ? 1 : 0)
