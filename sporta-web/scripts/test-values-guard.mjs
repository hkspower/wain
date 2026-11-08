#!/usr/bin/env node
// TEST VALUES MUST NOT BE PRODUCTION VALUES.
//
// The suites seed a database and a config on a sandbox machine. If one of them
// logs in, or sends mail, as the owner's real mailbox, the test is touching a
// real account and a real inbox. This guard reads the suite sources and fails
// when a production identity appears in a line that names a login, a sender,
// an admin account or a seeded table. Scans and DNS/live probes are excluded:
// they point at the live site on purpose and never write.
//
//   node scripts/test-values-guard.mjs        exit 0 = clean, exit 1 = a match
//
// Add a production value to PRODUCTION below when a new one must stay out of
// the test suites. Add a file to ALLOWED only when it quotes the value as
// public copy, not as a test identity.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')  // sporta-web
const PRODUCTION = ['cs@sporta.com.kw']
const IDENTITY = /admin|login|email|mail_|EMAIL|admin_users|sporta_admin|signin|sign_in|sender|from:|reply/i
const ALLOWED = new Set([
  'scripts/assistant-test.mjs',       // asserts the public contact text in replies
  'scripts/config-rules-test.mjs',    // the shop's own default contact value
  'scripts/arabic-spell-test.mjs',    // a comment listing public channels
  'scripts/xss-config-test.mjs',      // a header-injection case that must contain the address
])
const SKIP_NAME = /(scan|check|probe|audit|live|dns|apex|generate|fixture)/i

function files() {
  const out = []
  for (const dir of ['scripts', 'scripts/lib']) {
    const abs = join(root, dir)
    if (!existsSync(abs)) continue
    for (const f of readdirSync(abs)) {
      if (!/(-test\.mjs|\.mjs|\.sh)$/.test(f)) continue
      if (SKIP_NAME.test(f) && !/-test\.mjs$/.test(f)) continue
      out.push(join(abs, f))
    }
  }
  return out
}

const hits = []
let scanned = 0
for (const file of files()) {
  const rel = relative(root, file).split('\\').join('/')
  if (ALLOWED.has(rel)) continue
  scanned++
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const value of PRODUCTION) {
      // The whole address only: qa-cs@sporta.com.kw is a different mailbox.
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const whole = new RegExp(`(?<![\\w.+-])${escaped}(?![\\w-])`, 'i')
      if (whole.test(line) && IDENTITY.test(line)) {
        hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 140)}`)
      }
    }
  })
}

if (hits.length) {
  console.error(`FAIL ${hits.length} test line(s) use a production identity:`)
  for (const h of hits) console.error('  ' + h)
  process.exit(1)
}
console.log(`ok   ${scanned} suite file(s): no production identity in a login, sender or seed`)
process.exit(0)
