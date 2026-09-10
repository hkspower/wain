/**
 * If a fixed-name cached asset changed, sw.js's VERSION must have changed too.
 *
 *   node scripts/sw-version-test.mjs
 *
 * WHY. Seven files under /assets/ have names that never change while their
 * bytes do — sporta-ui.css, sporta-dark.css and five hand-written overlays.
 * sw.js was taught not to pin them (they fall through to network-first), and
 * that fix helps ARRIVALS ONLY. A browser still running an older worker is
 * executing the older rules, where everything under /assets/ was cache-first
 * and never re-asked; it holds whatever copy it first cached and does not ask
 * again. The single thing that frees it is a VERSION bump, because `activate`
 * deletes every cache that is not the current one.
 *
 * sw.js says exactly that, one paragraph above the constant. It has still been
 * missed twice: once before this rig existed, and once on 2026-09-10 by the
 * publisher that shipped the hero floor, the restored theme toggle and a
 * carousel-dot fix — all three in those very files — while arguing that no bump
 * was needed because they are network-first. True of the current worker, false
 * of the one the visitor is running. The owner's report was "I change something
 * and the shop still shows the old version", and every OTHER layer measured
 * innocent, which is what made it so hard to see.
 *
 * A rule that lives only in a comment is a rule that gets read as being about
 * the day it was written. So it is a test.
 *
 * HOW IT DECIDES, without storing any state of its own: find the last commit
 * that touched the VERSION line, then ask git whether any of the seven files
 * changed after it — in a later commit, or right now in the working tree. If
 * one did, the bump is owed.
 *
 * It reads git and the repository. It writes nothing.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const SW = 'sporta-site/public_html/sw.js'

// The fixed names sw.js names in its own comment. Kept in step with that list
// deliberately: a new overlay added to /assets/ belongs in both, and the check
// below fails loudly if one of these stops existing rather than passing quietly.
const FIXED = [
  'assets/sporta-ui.css',
  'assets/sporta-dark.css',
  'assets/contact.js',
  'assets/card.js',
  'assets/returns-link.js',
  'assets/returns-request.js',
  'assets/track-guard.js',
].map((p) => `sporta-site/public_html/${p}`)

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim()

const version = (readFileSync(SW, 'utf8').match(/^const VERSION = '([^']+)'/m) ?? [])[1]
check(!!version, 'sw.js declares a VERSION', version ?? '(none found)')
if (!version) process.exit(1)

// Every file must exist, or this rig would silently stop watching one.
const missing = FIXED.filter((f) => {
  try { readFileSync(f); return false } catch { return true }
})
check(missing.length === 0, 'every fixed-name asset it watches exists',
  missing.length ? missing.join(', ') : `${FIXED.length} files`)

/** The last commit that changed the VERSION line itself — not sw.js generally,
 *  which changes for comments and rule edits that do not free anybody. */
const bumpCommit = git('log', '-1', '--format=%H', '-S', `const VERSION = '${version}'`, '--', SW)
check(!!bumpCommit, 'the commit that set this VERSION was found', bumpCommit.slice(0, 8) || '(none)')
if (!bumpCommit) {
  console.log('\n     VERSION is set to a value no commit introduced — it is uncommitted.')
  console.log('     Commit the bump, then run this again.')
  process.exit(1)
}

// Changed in a commit AFTER the bump, or dirty in the working tree right now.
const changedSince = git('diff', '--name-only', `${bumpCommit}..HEAD`, '--', ...FIXED)
  .split('\n').filter(Boolean)
const changedNow = git('diff', '--name-only', '--', ...FIXED).split('\n').filter(Boolean)
const owed = [...new Set([...changedSince, ...changedNow])]

check(owed.length === 0,
  `no fixed-name asset changed since VERSION became ${version}`,
  owed.length
    ? `${owed.map((f) => f.split('/').pop()).join(', ')} — bump VERSION in sw.js, or every returning visitor keeps the old copy`
    : `${FIXED.length} watched, all older than the bump`)

console.log(fails
  ? `\n${fails} failed`
  : '\nall ok — the worker version is newer than every file it stops pinning')
process.exit(fails ? 1 : 0)
