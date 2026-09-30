/**
 * A navigation must revalidate for nothing — and must not go stale doing it.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/seo-cache-test.mjs
 *
 * WHAT THIS IS ABOUT. Every route on this shop — `/`, /shop, /checkout, every
 * /product/<slug> — is rewritten to seo.php, which injects the per-route <head>
 * and echoes the shell. PHP sends no validator of its own, so until 2026-09-10
 * that response carried `max-age=0, must-revalidate` and NOTHING to revalidate
 * WITH. Measured on the live server:
 *
 *   shell   200/42810  v=NONE     inm=no-etag  ims=no-lm
 *   worker  200/18880  v=etag+lm  inm=304/0
 *   api     200/21773  v=etag     inm=304/0
 *
 * Every other file on the shop could answer "still the same" in an empty 304.
 * The one page every visit starts at re-sent 42,810 bytes, every time, in both
 * Chrome and Safari, and neither browser had any way to avoid it.
 *
 * THE TWO HALVES, AND THE SECOND IS THE DANGEROUS ONE.
 *
 *   1. A matching conditional request must come back 304 with an EMPTY body —
 *      including the forms a real cache sends: a weakened W/"…" tag, and a list
 *      of several tags. store_out_cacheable() carries the same loop and calls
 *      getting this wrong "a slower no-store with extra steps".
 *
 *   2. THE TAG MUST CHANGE WHEN THE PAGE CHANGES. This is the half that can
 *      hurt: an ETag that never moves pins every visitor to a page that no
 *      longer exists, and it does it silently and for ever — exactly the
 *      service-worker failure this project already spent a day on, one layer
 *      down. So the rig EDITS A PRODUCT'S NAME in the database, and requires
 *      that the product page's tag moves and that the OLD tag now answers 200
 *      rather than 304. Asserting only half of this would pass on a server
 *      that returns a constant.
 *
 * IT ALSO GUARDS bfcache. `no-store` on a NAVIGATION disables the back/forward
 * cache in both browsers, turning the back button from instant into a full
 * reload. Nothing here sends it today and nothing should start: it is one word,
 * added in a hurry to "stop caching", and the cost lands on the one interaction
 * a shopper makes most.
 *
 * WHY THE SANDBOX CAN SEE THIS AT ALL, as of today: it could not. php -S reads
 * no .htaccess, so `/` was served from disk and seo.php had never been
 * exercised by any rig — not its canonical, not its hreflang, not its fail-safe
 * branch. scripts/dev-router.php now mirrors those rewrites, per the rule in
 * CLAUDE.md that the two are changed together.
 *
 * It restores the product name in a finally.
 */
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ' — ' + extra : ''}`)
}

const sql = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4',
   '--batch', '--raw', '-e', q], { encoding: 'utf8' })

/** A request, returning the status, the validator and the real body length. */
const get = async (path, headers = {}) => {
  const res = await fetch(BASE + path, { headers, redirect: 'manual' })
  const body = await res.arrayBuffer()
  return {
    status: res.status,
    etag: res.headers.get('etag'),
    cc: res.headers.get('cache-control') ?? '',
    setCookie: res.headers.getSetCookie?.() ?? [],
    bytes: body.byteLength,
  }
}

// Named, not picked by position — a fixture chosen by position is a fixture
// chosen at random, which this repository records of a sign-in that grabbed
// whichever admin sorted first.
const SLUG = sql("select slug from products where active = 1 order by slug limit 1;")
  .trim().split('\n')[1]?.trim()

const ROUTES = ['/', '/shop', '/about', '/about?lang=en', `/product/${SLUG}`]

try {
  check(!!SLUG, 'found an active product to test a product page with', String(SLUG))

  /* ------------------------------------------- 1. every route has a validator */
  const first = {}
  for (const r of ROUTES) {
    const res = await get(r)
    first[r] = res
    check(res.status === 200 && !!res.etag,
      `${r} carries an ETag`, `status=${res.status} etag=${res.etag}`)
    // A navigation that says no-store cannot be bfcached, and the back button
    // becomes a full reload in both browsers.
    check(!/no-store/i.test(res.cc),
      `${r} does not send no-store, so the back button stays instant`, res.cc)
  }

  /* ------------------------------------------ 2. the tags are not all one tag */
  // A server returning a constant would pass every 304 check below while
  // pinning every page to the same bytes.
  const tags = new Set(ROUTES.map((r) => first[r].etag))
  check(tags.size === ROUTES.length,
    'each route has its OWN tag — none collides', `${tags.size} distinct of ${ROUTES.length}`)

  /* -------------------------------------------- 3. a conditional costs nothing */
  for (const r of ROUTES) {
    const tag = first[r].etag
    const exact = await get(r, { 'If-None-Match': tag })
    const weak = await get(r, { 'If-None-Match': `W/${tag}` })
    const many = await get(r, { 'If-None-Match': `"zzz", ${tag}` })

    check(exact.status === 304 && exact.bytes === 0,
      `${r} revalidates to an empty 304`, `${exact.status}/${exact.bytes}`)
    // A cache is allowed to weaken a tag, and comparing the header as one
    // string is how the 304 silently never fires.
    check(weak.status === 304, `${r} accepts a weakened W/ tag`, String(weak.status))
    check(many.status === 304, `${r} accepts a list of tags`, String(many.status))

    const stale = await get(r, { 'If-None-Match': '"not-the-tag"' })
    check(stale.status === 200 && stale.bytes > 1000,
      `${r} still sends the page to a browser holding a stale tag`,
      `${stale.status}/${stale.bytes}`)
  }

  /* ------------------------------- 4. and it MOVES when the page really moves */
  //
  // EACH LANGUAGE AGAINST THE FIELD IT ACTUALLY RENDERS. The first version of
  // this edited name_en and asked the DEFAULT product page — which is ARABIC
  // (seo.php: $isEn comes from ?lang=en, and the Arabic branch reads name_ar).
  // So it changed a column that page never prints, the tag correctly did not
  // move, and the rig reported a staleness bug in code that was right.
  //
  // A fixture that does not have the property under test does not test it, and
  // the failure it produces looks exactly like the real fault. Doing both
  // languages is also strictly better than fixing the one: it proves the two
  // pages are independently keyed, so an edit to the Arabic name cannot leave
  // an English shopper on a stale page or the reverse.
  if (SLUG) {
    for (const [column, path] of [
      ['name_ar', `/product/${SLUG}`],
      ['name_en', `/product/${SLUG}?lang=en`],
    ]) {
      const before = (await get(path)).etag
      sql(`update products set ${column} = concat(${column}, ' ETAGRIG') where slug = '${SLUG}';`)

      const after = await get(path)
      check(after.etag && after.etag !== before,
        `editing ${column} changes the tag of the page that renders it`,
        `before=${before} after=${after.etag}`)

      // Not merely different but CORRECT: a browser holding the old tag must be
      // sent the new page rather than told the old one is current.
      const withOld = await get(path, { 'If-None-Match': before })
      check(withOld.status === 200 && withOld.bytes > 1000,
        `a browser holding the old ${column} tag gets the new page, not a 304`,
        `${withOld.status}/${withOld.bytes}`)

      sql(`update products set ${column} = replace(${column}, ' ETAGRIG', '') where slug = '${SLUG}';`)
    }
  }

  /* -------------------------------------- 5. the storefront still sets nothing */
  const cookies = ROUTES.reduce((n, r) => n + first[r].setCookie.length, 0)
  check(cookies === 0,
    'no route sets a cookie — the storefront stays cookie-free', String(cookies))
} finally {
  // Strip the marker rather than writing the captured name back. Re-inserting a
  // name means quoting whatever the shop happens to sell — an apostrophe in it
  // would either break the SQL or, worse, be silently mangled and left that way.
  // The mutation only ever APPENDS, so removing what it appended is exact, and
  // it is idempotent if the rig is interrupted and run again.
  if (SLUG) {
    sql(`update products set name_en = replace(name_en, ' ETAGRIG', ''),
                             name_ar = replace(name_ar, ' ETAGRIG', '') where slug = '${SLUG}';`)
    const back = sql(`select name_en, name_ar from products where slug = '${SLUG}';`)
    check(!back.includes('ETAGRIG'), 'the product name was restored', back.trim())
  }
}

console.log(fails
  ? `\n${fails} failed`
  : '\nall ok — a repeat navigation costs an empty 304, and a changed page still arrives')
process.exit(fails ? 1 : 0)
