/**
 * Every publisher pins a FULL forty-character commit sha.
 *
 *   npm run test:publish-pin          (no server, no browser)
 *
 * WHY THIS IS A TEST AND NOT A NOTE. CLAUDE.md has recorded since 2026-09-11
 * that raw.githubusercontent.com answers 404 for an abbreviated sha — measured
 * three times running, while the same path at full length answered 200 — and
 * that an unresolvable ref is an EMPTY FETCH which reports nothing. The note
 * ended "other publishers here carry short shas and happened to work, which is
 * worse than failing outright".
 *
 * Eighteen of them still did. `publish-hero-mobile.php` is what it costs: the
 * file was written, committed, correct in every hash, and pinned to `def64d5`.
 * It could not fetch a byte. `live-image-check` reported `differ=5` on exactly
 * the five images it existed to publish, for six days — which reads as "the
 * server is behind" and was really "the publisher cannot reach the artwork".
 *
 * A rule that has to be remembered every time is a rule that will one day not
 * be. This is the same argument as make-brand-tokens --check and the generated
 * file manifest, and it is why both of those exist.
 *
 * IT ALSO ASSERTS IT FOUND SOMETHING. A guard that scans a directory can fail
 * by matching nothing, and its silence and its success look identical — this
 * repository's oldest lesson. A run that finds no publishers is a failure.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const DIR = new URL('./publish/', import.meta.url).pathname
let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.php'))
check(files.length > 10, `there are publishers to check (${files.length})`,
  files.length ? '' : 'an empty directory passes every check below')

const short = []
const unknown = []
let pinned = 0

for (const f of files) {
  const src = readFileSync(DIR + f, 'utf8')
  // The ASSIGNMENT, not any mention: these files talk about shas in prose, and
  // a guard that matched the word would fail on its own explanation — exactly
  // how the cookie-flags guard nearly got loosened into uselessness.
  const m = src.match(/^\$COMMIT\s*=\s*'([^']*)'/m)
  if (!m) continue
  pinned++
  const sha = m[1]
  if (!/^[0-9a-f]{40}$/.test(sha)) { short.push(`${f}:${sha}`); continue }
  // AND IT MUST RESOLVE. A full-length string that is not a commit in this
  // repository fetches exactly as much as a short one does: nothing.
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' })
  } catch { unknown.push(`${f}:${sha.slice(0, 12)}…`) }
}

check(pinned > 10, `${pinned} of them pin a commit`,
  pinned ? '' : 'nothing was examined, so nothing below means anything')

check(short.length === 0,
  short.length
    ? `${short.length} publisher(s) pin an ABBREVIATED sha — raw.githubusercontent 404s on those, silently:\n       `
      + short.join('\n       ')
    : `every pinned sha is the full forty characters`)

check(unknown.length === 0,
  unknown.length
    ? `${unknown.length} publisher(s) pin a sha this repository does not contain:\n       ` + unknown.join('\n       ')
    : 'and every one of them is a commit that exists here')

console.log(fails ? `\n${fails} failed` : `\nall ok — ${pinned} publishers, every ref resolvable`)
process.exit(fails ? 1 : 0)
