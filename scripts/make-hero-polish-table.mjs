/**
 * The polish table inside scripts/publish/publish-hero-polish.php, generated from the artefacts AT that
 * publisher's own $COMMIT — and a check that it has not drifted.
 *
 *   node scripts/make-hero-polish-table.mjs           rewrite the table from the files at $COMMIT
 *   node scripts/make-hero-polish-table.mjs --check   fail if the table, $COMMIT or HEAD disagree
 *
 * WHY GENERATED. The publisher fetches each artefact from $COMMIT and refuses anything that is not
 * exactly the recorded sha256 and size, so the table and the pin must describe the same files. A
 * table typed by hand drifts the day the artefacts are rebuilt (they were, the same day: the four
 * full-body phone squares grew to give the controls more floor). Changing $COMMIT and running this is
 * the whole re-pin.
 *
 * WHAT --check FAILS ON:
 *  - the table in the PHP is not what the files at $COMMIT say;
 *  - HEAD carries polish artefacts that differ from $COMMIT's. That is the silent under-publish this
 *    repository has met before: rebuilt pictures committed, the pin left behind, and the publisher
 *    happily writing the OLD pictures and reporting success. Re-pin $COMMIT to the commit that holds
 *    the new files and regenerate.
 *  - the neutral pictures at $COMMIT are not the ones publish-hero-neutral.php's $SWAPS wrote to the
 *    live rows (the publisher swaps only rows carrying those), or a phone picture is not square.
 * A working-tree copy that differs from HEAD is reported, not failed: that is work in progress.
 *
 * The five names and the live rows' current hashes are READ from publish-hero-neutral.php, not
 * repeated here, and the parse must find five.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { webpSize } from './_hero-seed.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const PHP = new URL('./publish/publish-hero-polish.php', import.meta.url)
const NEUTRAL = new URL('./publish/publish-hero-neutral.php', import.meta.url)
const ART = 'sporta-site/assets/hero/'
const check = process.argv.includes('--check')
const die = (m) => { console.error('FAIL ' + m); process.exit(1) }
const sha = (b) => createHash('sha256').update(b).digest('hex')
const blob = (ref, path) => {
  try { return execFileSync('git', ['show', `${ref}:${path}`], { cwd: ROOT, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }) }
  catch { return null }
}

const src = readFileSync(PHP, 'utf8')
const commit = (src.match(/^\$COMMIT\s*=\s*'([^']*)';/m) || [])[1]
if (!commit || !/^[0-9a-f]{40}$/.test(commit)) die(`publish-hero-polish.php has no full forty-character $COMMIT (found ${JSON.stringify(commit)})`)

const swaps = [...readFileSync(NEUTRAL, 'utf8').matchAll(/\[\s*'(\w+)',\s*'[0-9a-f]{64}',\s*'([0-9a-f]{64})',\s*'([0-9a-f]{64})',\s*\d+\s*\]/g)]
  .map((m) => ({ name: m[1], master: m[2], phone: m[3] }))
if (swaps.length !== 5) die(`expected the five slides in publish-hero-neutral.php's $SWAPS, parsed ${swaps.length}`)

let bad = 0
const rows = []
for (const { name, master, phone } of swaps) {
  const files = { m: `${name}-neutral-desktop.webp`, p: `${name}-neutral-mobile.webp`, d: `${name}-polish-desktop-2560.webp`, q: `${name}-polish-phone.webp` }
  const at = {}
  for (const [k, f] of Object.entries(files)) {
    const b = blob(commit, ART + f)
    if (!b || !b.length) die(`${f} is not in commit ${commit.slice(0, 12)} — pin $COMMIT to the commit that holds the polish artefacts`)
    at[k] = { b, sha: sha(b), size: webpSize(b) }
  }
  if (at.m.sha !== master) die(`${files.m} at ${commit.slice(0, 12)} is not the master publish-hero-neutral.php wrote (${at.m.sha.slice(0, 12)} vs ${master.slice(0, 12)})`)
  if (at.p.sha !== phone) die(`${files.p} at ${commit.slice(0, 12)} is not the phone picture publish-hero-neutral.php wrote`)
  const [dw, dh] = at.d.size, [pw, ph] = at.q.size
  if (!(dw > dh)) die(`${files.d} is ${dw}x${dh}, not a wide banner`)
  if (pw !== ph) die(`${files.q} is ${pw}x${ph}: the owner chose SQUARE phone pictures`)
  rows.push({ name, master, phone, d: at.d.sha, dw, dh, q: at.q.sha, pw, ph })

  // HEAD and the working tree, against the pin
  for (const k of ['d', 'q']) {
    const head = blob('HEAD', ART + files[k])
    if (!head) { console.error(`FAIL ${files[k]} is not in HEAD any more, but the publisher fetches it from ${commit.slice(0, 12)}`); bad++; continue }
    if (sha(head) !== at[k].sha) {
      console.error(`FAIL ${files[k]} at HEAD (${sha(head).slice(0, 12)}) differs from $COMMIT ${commit.slice(0, 12)} (${at[k].sha.slice(0, 12)}) — re-pin $COMMIT and regenerate`)
      bad++
    }
    const wt = ROOT + ART + files[k]
    if (existsSync(wt) && sha(readFileSync(wt)) !== sha(head)) console.log(`note ${files[k]}: the working tree differs from HEAD (uncommitted)`)
  }
}

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length))
const block = [
  '// >>> POLISH TABLE — generated by scripts/make-hero-polish-table.mjs from the artefacts AT $COMMIT. Do not edit by hand.',
  '// name => [3200 master sha256, 1080x1350 phone sha256 (both as publish-hero-neutral.php wrote them, live today),',
  '//          polish desktop sha256, width, height, polish phone sha256, width, height]',
  '$POLISH = [',
  ...rows.map((r) =>
    `    ${pad(`'${r.name}'`, 12)} => ['${r.master}', '${r.phone}',\n` +
    `                     '${r.d}', ${r.dw}, ${r.dh}, '${r.q}', ${r.pw}, ${r.ph}],`),
  '];',
  '// <<< POLISH TABLE',
].join('\n')

const RE = /\/\/ >>> POLISH TABLE[\s\S]*?\/\/ <<< POLISH TABLE/g
const found = src.match(RE) || []
if (found.length !== 1) die(`expected one POLISH TABLE block in publish-hero-polish.php, found ${found.length}`)

if (check) {
  if (found[0] !== block) { console.error(`FAIL the table in publish-hero-polish.php is not what the files at ${commit.slice(0, 12)} say — run npm run make:hero-polish-table`); bad++ }
  for (const r of rows) console.log(`${bad ? '    ' : 'ok  '} ${pad(r.name, 10)} desktop ${r.dw}x${r.dh} ${r.d.slice(0, 12)}  phone ${r.pw}x${r.ph} ${r.q.slice(0, 12)}`)
  console.log(bad ? `\n${bad} failed` : `\nall ok — the table, $COMMIT ${commit.slice(0, 12)} and HEAD agree on all five`)
  process.exit(bad ? 1 : 0)
}

const out = src.replace(RE, () => block)
if (!out.includes(block)) die('the replacement did not land')   // a replace that matched nothing is a no-op that looks like success
if (out !== src) writeFileSync(PHP, out)
for (const r of rows) console.log(`${pad(r.name, 10)} desktop ${r.dw}x${r.dh} ${r.d.slice(0, 12)}  phone ${r.pw}x${r.ph} ${r.q.slice(0, 12)}`)
console.log(out === src ? 'table already current' : `table written from ${commit.slice(0, 12)}`)
if (bad) { console.error(`${bad} problem(s) above: HEAD and $COMMIT disagree`); process.exit(1) }
