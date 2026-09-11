/**
 * Every inline <script> in index.html is named, by hash, in the CSP.
 *
 *   node scripts/csp-check.mjs
 *
 * The CSP in public_html/.htaccess pins inline scripts by sha256. Edit one
 * byte of an inline script without updating the hash and NOTHING fails here —
 * the local PHP server reads no .htaccess — while on the live server the
 * browser refuses to run that script, silently, and the page half-works in a
 * way that depends on which script died. That exact mistake was made in this
 * repo (the font unification edited the boot script) and was caught by hand;
 * this file is so the next one is caught by a machine.
 *
 * EVERY .html IN THE DOCROOT, not just index.html. The CSP is set by
 * `Header set` at the top of .htaccess, so it applies to every page the server
 * hands out — and this only ever read one of them. card.html was added with no
 * inline script precisely so it would need no hash, but "it has none today" is
 * not a property anybody can see from the CSP; the check is what keeps it
 * true, and it is now the same check for every page rather than a rule that
 * happens to hold for the one page anyone looked at.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

const DOCROOT = new URL('../sporta-site/public_html/', import.meta.url)
const ht = readFileSync(new URL('.htaccess', DOCROOT), 'utf8')

// PAGES THAT ARE NEVER DEPLOYED need no hash in the live CSP, and adding one
// would be the wrong fix — it permanently widens the policy the real shop runs
// under, for a page that must not be on the real shop.
//
// THE LIST IS EMPTY NOW, and that is the point: go-live.html was the only
// entry, and it has been DELETED rather than merely excluded. So have
// api/setup-admin.php, api/reset-admin.php, api/preflight.php and
// knet/setup-config.php — a set of unauthenticated endpoints that created an
// admin account, reset its password, reported the database and paths back to
// the caller, and wrote the bank's credentials from a request. They were
// needed once, on a URL nobody knew. Being excluded from a package by
// convention is not the same as not existing, and package-check.mjs now
// FAILS if any of them comes back.
//
// The mechanism stays because the situation can recur: a page here that is
// not uploaded needs no hash, and if one is ever deployed anyway its inline
// script simply will not run. Anything added must be listed by name with the
// reason — "anything with 'setup' in it" is how a real page gets skipped by
// accident.
const NOT_DEPLOYED = []

const pages = readdirSync(DOCROOT).filter((f) => f.endsWith('.html'))
const inline = []
for (const page of pages) {
  const body = readFileSync(new URL(page, DOCROOT), 'utf8')
  const found = [...body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  const skip = NOT_DEPLOYED.includes(page)
  console.log(`--   ${page}: ${found.length} inline script(s)${skip ? ' — not deployed, so not hashed' : ''}`)
  if (skip) continue
  for (const s of found) inline.push(createHash('sha256').update(s).digest('base64'))
}
const declared = [...ht.matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map((m) => m[1])

let fails = 0
for (const h of inline) {
  const ok = declared.includes(h)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} inline script sha256-${h.slice(0, 12)}… ${ok ? 'is in the CSP' : 'is NOT in the CSP — the live server will refuse to run it'}`)
}
for (const d of declared) {
  if (!inline.includes(d)) {
    // Stale is a warning, not a failure: it runs nothing, it only widens the
    // allowlist by one dead entry. Still worth clearing out.
    console.log(`--   declared sha256-${d.slice(0, 12)}… matches no script (stale, harmless, remove it)`)
  }
}
// ---------------------------------------------------------------------------
// THE PAYMENT DROPINS, which this file did not look at and which is how the
// T-Pay path shipped dead.
//
// Everything above scans .html in the docroot. /pay/ and /knet/ serve PHP that
// PRINTS HTML, under CSPs of their own, and neither the pages nor the policies
// were ever compared to each other. What that missed, measured under Apache
// 2.4.58 and Chromium:
//
//   * pay.php auto-submitted with `onload="document.forms[0].submit()"`. An
//     inline EVENT HANDLER can never be authorised by a hash — that needs
//     'unsafe-hashes' — and the storefront's policy, inherited into /pay/,
//     carries hashes, which makes its 'unsafe-inline' inert. "Refused to
//     execute inline event handler."
//   * that same inherited policy's form-action named the two KNET hosts and
//     not CBK's, while the form posts to pg.cbk.com. "Refused to send form
//     data."
//
// Either one alone strands the shopper on a 200 page with an order they
// cannot pay for, and nothing about it is visible from the server. So the
// three things below are checked for every payment page: no event handlers at
// all, every script element hashed in the policy that governs its directory,
// and every host the page can post to named in that policy's form-action.
// Returns `ok`, so a caller can bail out of a block whose remaining
// assertions depend on this one. It did not, at first, and `if (!check(...))
// continue` therefore skipped EVERY per-page check while printing two green
// lines — this whole section passed vacuously on its first run.
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
  return ok
}

const cspOf = (text) => {
  const m = text.match(/Header (?:always )?set Content-Security-Policy "([^"]*)"/)
  return m ? m[1] : null
}
const directive = (csp, name) => {
  const m = csp.match(new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`))
  return m ? m[1].trim().split(/\s+/) : []
}

console.log('')
for (const dir of ['pay', 'knet']) {
  const ht = readFileSync(new URL(`${dir}/.htaccess`, DOCROOT), 'utf8')
  const csp = cspOf(ht)
  // A directory with no policy of its own INHERITS the storefront's, which is
  // the state that broke /pay/. Proven under Apache: a file in /pay/ came back
  // carrying the root policy verbatim. So "has one" is itself the assertion.
  if (!check(csp !== null, `/${dir}/ sets a Content-Security-Policy of its own`,
             'without one it inherits the storefront policy, which is written for the shop')) continue
  if (csp === null) continue

  const allowedScripts = directive(csp, 'script-src')
  const allowedForms = directive(csp, 'form-action')
  const pages = readdirSync(new URL(`${dir}/`, DOCROOT))
    .filter((f) => f.endsWith('.php') && !/^(config|config\.example)\./.test(f))

  for (const page of pages) {
    const body = readFileSync(new URL(`${dir}/${page}`, DOCROOT), 'utf8')

    // Only pages that actually emit markup. cbk.php and knet.php are
    // libraries; a page with no <form and no <script has nothing to declare.
    if (!/<(form|script|body)\b/i.test(body)) continue

    // 1. NO INLINE EVENT HANDLERS. This is the specific bug, and it is worth
    //    its own assertion rather than being folded into the hash check,
    //    because the hash check would pass while the page stayed dead: the
    //    handler is not a script element, so nothing above ever sees it.
    const handlers = [...body.matchAll(/\son(load|click|submit|error)\s*=\s*["']/gi)]
      .map((m) => 'on' + m[1])
    check(handlers.length === 0,
      `${dir}/${page} uses no inline event handler`,
      `${handlers.join(', ')} — no CSP hash can ever authorise one`)

    // 2. EVERY SCRIPT ELEMENT IS HASHED IN THIS DIRECTORY'S OWN POLICY.
    const scripts = [...body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => createHash('sha256').update(m[1]).digest('base64'))
    for (const h of scripts) {
      check(allowedScripts.includes(`'sha256-${h}'`),
        `${dir}/${page} script sha256-${h.slice(0, 12)}… is pinned in /${dir}/.htaccess`,
        'the live server will refuse to run it')
    }
    if (scripts.length === 0 && allowedScripts.length) {
      check(allowedScripts.includes("'none'"),
        `${dir}/${page} has no script, and the policy says script-src 'none'`,
        `script-src is ${allowedScripts.join(' ')}`)
    }

    // 3. EVERY HOST THE PAGE CAN POST TO IS IN form-action.
    //
    //    The action is `<?= $h($checkoutUrl) ?>`, built from cbk_base(), so it
    //    cannot be read off this file — but its two possible values can:
    //    config.example.php names test_base and production_base, and the page
    //    posts to one or the other depending on `env`. BOTH must be allowed,
    //    or switching a config value from test to production breaks payment
    //    with no code change to point at.
    if (/<form\b/i.test(body)) {
      const ex = readFileSync(new URL(`${dir}/config.example.php`, DOCROOT), 'utf8')
      const hosts = [...ex.matchAll(/'(?:test|production)_(?:base|url)'\s*=>\s*'(https:\/\/[^/']+)/g)]
        .map((m) => m[1])
      check(hosts.length > 0, `${dir}/config.example.php names the gateway hosts`)
      for (const host of hosts) {
        check(allowedForms.includes(host),
          `${dir}/${page} may post to ${host}, and form-action allows it`,
          `form-action is ${allowedForms.join(' ') || '(unset)'}`)
      }
    }
  }
}

console.log(fails ? `\n${fails} failed` : `\nall ok — ${inline.length} inline scripts, all declared; the payment dropins can reach their gateways`)
process.exit(fails ? 1 : 0)
