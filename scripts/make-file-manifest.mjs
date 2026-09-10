/**
 * Regenerate live-file-check.php's manifest from git, and fail when it drifts.
 *
 *   node scripts/make-file-manifest.mjs            # rewrite the manifest
 *   node scripts/make-file-manifest.mjs --check    # fail if it is out of date
 *
 * WHY THIS EXISTS. live-file-check.php answers "which files on the live server
 * differ from the repository", and it answers it against a HARDCODED list of
 * 182 sha256s. CLAUDE.md already records what that costs: the list had gone
 * eight hashes behind and was missing two files that were live, so a run would
 * have called two live files "missing" and eight correct ones "differ" — and
 * the instruction written down for it was *"regenerate it from git ls-files
 * before believing a run"*, which is a step a person has to remember every
 * time, for ever.
 *
 * It went stale again immediately. On 2026-09-10, minutes after publishing
 * eight files, the manifest was behind by exactly those eight — so the next run
 * would have reported the server as wrong about the very files that had just
 * been made right, and the obvious response to that report is to republish
 * them. **A checker that reports the repository's staleness as the server's
 * does not merely mislead; it points at work that is already done.**
 *
 * So the manifest is generated, and `--check` makes drift a test failure rather
 * than something to remember. That is the same shape as make-brand-tokens.mjs,
 * for the same reason.
 *
 * THE EXCLUSION LIST HAS ONE HOME. $MUSTNOT is read OUT of the PHP rather than
 * repeated here. Those six files must not exist on the server, so they must not
 * be in the manifest either — a file listed in both would be reported missing
 * for ever, which is how a real signal gets trained into noise. Reading it from
 * the source means adding a name to $MUSTNOT automatically keeps it out of
 * $WANT, and the two can never disagree.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const PHP = 'scripts/live/live-file-check.php'
const PREFIX = 'sporta-site/public_html/'
const check = process.argv.includes('--check')

const src = readFileSync(PHP, 'utf8')

/** The names that must NOT be on the server, read from the PHP itself. */
const mustNotBlock = src.match(/\$MUSTNOT\s*=\s*\[([\s\S]*?)\];/)
if (!mustNotBlock) {
  console.error(`could not find $MUSTNOT in ${PHP} — refusing to guess at the exclusions`)
  process.exit(2)
}
const mustNot = new Set([...mustNotBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]))

const tracked = execFileSync('git', ['ls-files', 'sporta-site/public_html'], { encoding: 'utf8' })
  .split('\n').filter(Boolean)

// A generator that emits nothing would produce an empty manifest, and an empty
// manifest reports `same=0/0` — which reads like a clean run.
if (tracked.length < 50) {
  console.error(`git ls-files returned only ${tracked.length} files under the docroot; refusing to write a manifest from that`)
  process.exit(2)
}

const rows = []
for (const path of tracked.sort()) {
  const rel = path.slice(PREFIX.length)
  if (mustNot.has(rel)) continue
  rows.push(`    '${rel}' => '${createHash('sha256').update(readFileSync(path)).digest('hex')}',`)
}

const block = `$WANT = [\n${rows.join('\n')}\n];`
const next = src.replace(/\$WANT\s*=\s*\[[\s\S]*?\n\];/, block)

// A replacement that matches nothing is a no-op that looks like success — this
// repository has paid for that one already, so the edit is checked afterwards.
if (next === src && !src.includes(block)) {
  console.error(`the $WANT block was not replaced in ${PHP} — the pattern matched nothing`)
  process.exit(2)
}

if (check) {
  if (next === src) {
    console.log(`ok   the manifest matches the repository (${rows.length} files, ${mustNot.size} excluded)`)
    process.exit(0)
  }
  // Name what drifted, so the failure is actionable rather than "regenerate it".
  const was = new Map([...src.matchAll(/^    '([^']+)' => '([a-f0-9]{64})',$/gm)].map((m) => [m[1], m[2]]))
  const now = new Map([...block.matchAll(/^    '([^']+)' => '([a-f0-9]{64})',$/gm)].map((m) => [m[1], m[2]]))
  const stale = [...now.keys()].filter((k) => was.has(k) && was.get(k) !== now.get(k))
  const added = [...now.keys()].filter((k) => !was.has(k))
  const gone = [...was.keys()].filter((k) => !now.has(k))
  console.error(`FAIL the manifest in ${PHP} is out of date — run: node scripts/make-file-manifest.mjs`)
  if (stale.length) console.error(`       ${stale.length} stale hash(es): ${stale.slice(0, 10).join(', ')}`)
  if (added.length) console.error(`       ${added.length} tracked file(s) missing from it: ${added.slice(0, 10).join(', ')}`)
  if (gone.length) console.error(`       ${gone.length} entr(ies) no longer tracked: ${gone.slice(0, 10).join(', ')}`)
  console.error('     A stale manifest reports the REPOSITORY\'s staleness as the SERVER\'s,')
  console.error('     and points at republishing files that are already correct.')
  process.exit(1)
}

writeFileSync(PHP, next)
console.log(`wrote ${rows.length} files into ${PHP} (${mustNot.size} excluded as must-not-be-there)`)
