/**
 * Every file index.html asks for, present on disk.
 *
 *   node scripts/package-check.mjs                    # the repo's public_html
 *   ROOT=/tmp/zv/public_html node scripts/package-check.mjs   # an extracted zip
 *
 * WHY THIS EXISTS. index.html was uploaded to the live shop without
 * assets/index-TIUCmnwm.css, the stylesheet it names. The result was not a
 * missing style here and there — it was the whole site with no layout at all:
 * navigation as bulleted lists, links in the browser's default purple and
 * underlined, 1000px of content crammed into a 393px phone, and every page
 * running off the right edge. The dark background survived, because
 * sporta-dark.css DID upload and it sets the ground colour, which made the
 * page look styled-but-broken rather than obviously unstyled.
 *
 * Nothing could have caught it. The browser rigs all run against a complete
 * sandbox, where the file is present; the site scan checks for 404s but only
 * against whatever server it is aimed at. The gap was between the two: a
 * package that is internally inconsistent, which is exactly what a partial
 * upload creates.
 *
 * So this reads index.html, collects every local path it references, and
 * checks each one is really there. Run it on the extracted zip before
 * uploading and a half-built package cannot leave.
 *
 * It reads the DOM's own attributes rather than a hand-written list, so a
 * reference added later is covered without anyone remembering to add it here.
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

const ROOT = resolve(process.env.ROOT ?? new URL('../sporta-site/public_html', import.meta.url).pathname)

let fails = 0
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }

const html = readFileSync(join(ROOT, 'index.html'), 'utf8')

// Every href= and src= that points at a path on this site. Data URIs, external
// origins and anchors are somebody else's problem.
const refs = new Set()
for (const m of html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)) {
  const v = m[1].trim()
  if (!v.startsWith('/')) continue                 // relative, external, data:, #
  if (v.startsWith('//')) continue                 // protocol-relative = external
  refs.add(v.split('?')[0].split('#')[0])
}
check(refs.size > 0, `index.html references ${refs.size} local files`)

// The stylesheet is called out by name because it is the one whose absence
// does not look like an absence.
const sheets = [...refs].filter((r) => r.endsWith('.css'))
check(sheets.length > 0, `and ${sheets.length} of them are stylesheets (${sheets.join(', ')})`)

for (const r of [...refs].sort()) {
  const p = join(ROOT, r.replace(/^\//, ''))
  const there = existsSync(p) && statSync(p).isFile()
  const size = there ? statSync(p).size : 0
  check(there && size > 0,
    `${r}${there ? ` (${size.toLocaleString()} B)` : ' is MISSING — the page will load and render unstyled'}`)
}

// The pairing that has its own failure mode: index.html's inline scripts are
// permitted by SHA-256 hashes that live in .htaccess. One without the other
// and the browser blocks the script — the page loads, then does nothing.
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].length
if (inline > 0) {
  check(existsSync(join(ROOT, '.htaccess')),
    `.htaccess travels with index.html — ${inline} inline scripts need its CSP hashes`)
}

// ===================================================== what must NOT be here
//
// The half above asks whether everything the page needs is present. It says
// nothing about what is present that should not be, and that is the more
// dangerous question: a missing stylesheet is ugly and obvious, an uploaded
// installer is a stranger resetting the shop's admin password.
//
// Everything below is a real file that exists in this working copy right now
// and must never reach the server. They are not mistakes in the repo — the
// installers were needed once and the sandbox configs are how the rigs run —
// which is exactly why a check is needed rather than a habit.

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      walk(full, out)
    } else out.push(full)
  }
  return out
}
const files = existsSync(ROOT) ? walk(ROOT) : []
const here = (rel) => existsSync(join(ROOT, rel))

console.log('')

/**
 * ONE-TIME ENDPOINTS. Each of these writes to the database or the filesystem
 * and none of them asks who is calling — that was fine when the shop was being
 * stood up on a URL nobody knew, and is a public administrative endpoint the
 * moment it is live.
 */
const FORBIDDEN = [
  ['api/setup-admin.php', 'creates an admin account — anyone who finds it owns the shop'],
  ['api/reset-admin.php', "resets the admin's password, unauthenticated"],
  ['api/preflight.php', 'reports the database, the paths and the config back to the caller'],
  ['knet/setup-config.php', "writes the bank's credentials from a request"],
  ['go-live.html', 'the launch checklist, with the internal steps on it'],
]
for (const [rel, why] of FORBIDDEN) {
  check(!here(rel), `${rel} is NOT in the package — ${why}`)
}

/**
 * SANDBOX CREDENTIALS. pay/config.php and knet/config.php hold the literal
 * SANDBOX_NOT_A_REAL_* strings the rigs run against, and api/config.php the
 * sandbox database password.
 *
 * THE HAZARD IS OVERWRITING, NOT READING. api/.htaccess denies all three by
 * name and test:htaccess asserts it, so an uploaded config is not served to
 * anybody. What it does is replace the real credentials on the server — after
 * which every card payment fails and the shop cannot reach its own database,
 * with nothing in any log to say why.
 *
 * They are git-ignored, so `git archive` cannot carry them and the documented
 * way of building the package is safe. A zip built by hand from a working copy
 * picks them straight up, which is the case this exists for — so it is only an
 * error when checking an extracted package (ROOT set), and a note when looking
 * at the working copy, where they SHOULD be present or the rigs cannot run.
 */
const CHECKING_A_PACKAGE = !!process.env.ROOT
const SANDBOX_MARKS = [
  ['SANDBOX_NOT_A_REAL', 'a sandbox bank credential'],
  ['localdev', 'the sandbox database password'],
  ["'db_host' => '127.0.0.1'", 'the sandbox database host'],
]
const poisoned = []
for (const f of files) {
  if (!/\.(php|js|json|env|ini|txt)$/i.test(f)) continue
  let body
  try { body = readFileSync(f, 'utf8') } catch { continue }
  for (const [mark, what] of SANDBOX_MARKS) {
    if (body.includes(mark)) poisoned.push(`${relative(ROOT, f)} — ${what} (${mark})`)
  }
}
if (CHECKING_A_PACKAGE) {
  check(poisoned.length === 0,
    `no file carries a sandbox credential${poisoned.length ? ':\n     ' + poisoned.join('\n     ') : ''}`)
} else if (poisoned.length) {
  console.log(`--   ${poisoned.length} sandbox config(s) present, as they must be for the rigs:`)
  for (const p of poisoned) console.log(`       ${p}`)
  console.log('     They are git-ignored, so `git archive` excludes them. Run this with')
  console.log('     ROOT=<extracted zip>/public_html to have their presence FAIL.')
}

/**
 * SCRATCH. A probe script or an editor backup left in the docroot is served as
 * a static file by Apache.
 *
 * .sql IS NOT IN THIS LIST, and the first version of it was. The api/*.mysql
 * files are deliberate import fixtures, and api/.htaccess denies *.sql by name
 * — its own comment says why, because seed.mysql.sql carries every product's
 * COST PRICE. Calling eleven intentional files a leak is how a check gets
 * ignored. The denial is asserted where it can actually be proved, against a
 * real Apache, in test:htaccess.
 */
const scratch = files
  .map((f) => relative(ROOT, f))
  .filter((r) => /(^|\/)_|\.(bak|orig|swp|log)$|~$|\.DS_Store$/.test(r))
check(scratch.length === 0,
  `nothing scratch in the docroot${scratch.length ? ': ' + scratch.slice(0, 8).join(', ') : ''}`)

console.log(fails ? `\n${fails} failed — do not upload this` : '\nall ok — everything needed is here, and nothing that must not be')
process.exit(fails ? 1 : 0)
