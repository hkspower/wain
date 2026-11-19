// The release gate's pure parts: no process is spawned and no file is written here, so the gate's own suite
// (scripts/release-gate-test.mjs) can prove every rule on fake data.
//
//   parseOutput     a suite's output  -> { ok, fail, failLines }
//   classifyAttempt one run + the registry entry + the known-failures entry -> a verdict
//   settle          the attempts of one suite (first run + reruns) -> the final verdict
//   globToRegExp / matchesAny / triggeredSuites   what --changed selects
//   mapReleasePaths what a release contains, as vps-deploy.mjs --only scopes, and what needs the owner's eye
//
// TEST HOOK. GATE_MUTATE=<rule>[,<rule>] switches one rule OFF so the gate's own suite can prove that every rule
// matters (a rule that can be removed without a test going red is not held). It is read in exactly one place
// (`mutated`) and the runner prints a loud line when it is set. Never set it for a real run.
export const MUT = new Set((process.env.GATE_MUTATE ?? '').split(',').map((s) => s.trim()).filter(Boolean))
export const mutated = (rule) => MUT.has(rule)

// ------------------------------------------------------------------ globs
const esc = (s) => s.replace(/[.+^$()|[\]\\{}]/g, '\\$&')
export function globToRegExp(glob) {
  let re = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 2
        if (glob[i] === '/') { i++; re += '(?:.*/)?' } else re += '.*'
        continue
      }
      re += '[^/]*'; i++; continue
    }
    if (c === '?') { re += '[^/]'; i++; continue }
    if (c === '{') {
      const j = glob.indexOf('}', i)
      if (j > i) { re += '(?:' + glob.slice(i + 1, j).split(',').map(esc).join('|') + ')'; i = j + 1; continue }
    }
    re += esc(c); i++
  }
  return new RegExp('^' + re + '$')
}
export const matchesAny = (path, globs) => globs.some((g) => globToRegExp(g).test(path))

// "@group" entries of a trigger list expand to the registry's named groups.
export function expandTriggers(list, groups = {}) {
  const out = []
  for (const t of list ?? []) {
    if (t.startsWith('@')) out.push(...expandTriggers(groups[t.slice(1)] ?? [], groups))
    else out.push(t)
  }
  return out
}

// Which suites a set of changed files selects. ERRS ON RUNNING MORE: a suite's own script always counts, and the
// registry's globalTriggers (shared libraries, fixtures, the registry itself) select whole classes of suites.
export function triggeredSuites(registry, changed, scriptOf = () => null) {
  const groups = registry.groups ?? {}
  const picked = new Set()
  for (const s of registry.suites) {
    const globs = [...expandTriggers(s.triggers, groups)]
    const own = scriptOf(s.name)
    if (own) globs.push(own)
    if (changed.some((f) => matchesAny(f, globs))) picked.add(s.name)
  }
  for (const g of registry.globalTriggers ?? []) {
    if (!changed.some((f) => matchesAny(f, g.globs))) continue
    for (const s of registry.suites) {
      if (g.suites === 'all' || (Array.isArray(g.suites) && g.suites.includes(s.name))
        || (typeof g.suites === 'string' && g.suites.startsWith('needs:') && g.suites.slice(6).split('|').includes(s.needs))) picked.add(s.name)
    }
  }
  return picked
}

// ------------------------------------------------------------------ output parsing
// The suites of this repo print "ok ..." / "FAIL ..." lines and end with a summary in one of a handful of shapes.
// Patterns are tried in this order; the LAST line matching the first pattern that matches anywhere wins (a mutation
// pass prints a second summary under the first one, and a line may hold two counts: the first is the headline).
const SUMMARIES = [
  { id: 'passed-failed', re: /(\d+) passed, (\d+) failed/i, ok: 1, fail: 2 },
  { id: 'ok-fail', re: /(\d+) ok, (\d+) fail(?:ed)?\b/i, ok: 1, fail: 2 },
  { id: 'ok-expected-fail', re: /(\d+) ok\b[^\n]*?\b(\d+) FAIL\b/, ok: 1, fail: 2 },
  { id: 'failed-of', re: /(\d+) FAILED of (\d+) checks/, fail: 1, total: 2 },
  { id: 'fail-checks-passed', re: /(\d+) FAIL\S* [—–-]+ (\d+) checks passed/, fail: 1, ok: 2 },
  { id: 'checks-failed', re: /(\d+) checks, (\d+) failed/, total: 1, fail: 2 },
  { id: 'problems', re: /(\d+) problem\(s\)/, fail: 1 },
  { id: 'n-failed', re: /^\s*(\d+) FAILED\s*$/, fail: 1 },
]
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
const FAIL_LINE = /^\s*(?:FAIL|not ok)\b/
const OK_LINE = /^\s*(?:ok|PASS)\b/

export function parseOutput(raw, strategy = 'auto', regexes = null) {
  const lines = stripAnsi(String(raw ?? '')).split(/\r?\n/)
  const failLines = lines.filter((l) => FAIL_LINE.test(l)).map((l) => l.trim())
  const okLines = lines.filter((l) => OK_LINE.test(l)).length
  const byLines = { ok: okLines, fail: failLines.length, failLines, parsedBy: 'lines' }
  if (strategy === 'lines' || strategy === 'exit') {
    return strategy === 'exit' ? { ...byLines, ok: null, parsedBy: 'exit' } : byLines
  }
  if (strategy === 'regex' && regexes) {
    const okM = regexes.ok ? lines.map((l) => l.match(new RegExp(regexes.ok))).filter(Boolean).pop() : null
    const failM = regexes.fail ? lines.map((l) => l.match(new RegExp(regexes.fail))).filter(Boolean).pop() : null
    return { ok: okM ? Number(okM[1]) : okLines, fail: failM ? Number(failM[1]) : failLines.length, failLines, parsedBy: 'regex' }
  }
  const list = strategy === 'auto' ? SUMMARIES : SUMMARIES.filter((s) => s.id === strategy || (strategy === 'ok-fail' && s.id.startsWith('ok-')))
  for (const s of list) {
    let hit = null
    for (const l of lines) { const m = l.match(s.re); if (m) hit = m }
    if (!hit) continue
    let ok = s.ok ? Number(hit[s.ok]) : null
    const fail = Number(hit[s.fail])
    if (s.total) ok = Number(hit[s.total]) - (s.id === 'failed-of' ? fail : 0)
    if (s.id === 'checks-failed') ok = Number(hit[s.total]) - fail
    // A summary that says "0 failed" over visible FAIL lines is not trusted: the lines are what a person reads.
    const failN = fail === 0 && failLines.length > 0 ? failLines.length : fail
    return { ok: ok ?? okLines, fail: failN, failLines, parsedBy: s.id }
  }
  return byLines
}

// ------------------------------------------------------------------ classification
// A run (one attempt): { exit, timedOut, ok, fail, failLines, text }
// reg: the suite's registry entry; known: its known-failures entry or undefined.
// Returns { verdict, reasons[] }. Verdicts: PASS KNOWN FIXED REGRESSION (FLAKE and SKIPPED are decided elsewhere).
export function classifyAttempt(reg, known, run) {
  const reasons = []
  if (run.timedOut && !mutated('timeout')) {
    return { verdict: 'REGRESSION', reasons: [`timed out after ${reg.timeoutSec}s`] }
  }
  const failing = run.timedOut ? false : (run.exit !== 0 || run.fail > 0)
  if (!failing) {
    const minOk = reg.minOk ?? 0
    if (!mutated('min-ok') && minOk > 0 && (run.ok ?? 0) < minOk) {
      return { verdict: 'REGRESSION', reasons: [`ok count ${run.ok ?? 0} is below the registry's minOk ${minOk} (checks disappeared)`] }
    }
    if (known && !mutated('fixed')) return { verdict: 'FIXED', reasons: [`known failure "${reg.name}" now passes: remove it from ops/release/known-failures.json`] }
    return { verdict: 'PASS', reasons }
  }
  if (known) {
    const why = matchKnown(known.expect ?? {}, run)
    if (why === null) return { verdict: 'KNOWN', reasons: knownNotes(known.expect ?? {}, run) }
    return { verdict: 'REGRESSION', reasons: [`fails, and not as recorded in known-failures.json: ${why}`] }
  }
  if (run.fail === 0 && !mutated('exit-no-reason')) {
    return { verdict: 'REGRESSION', reasons: [`exit code ${run.exit} with no FAIL line and no recorded reason`] }
  }
  return { verdict: 'REGRESSION', reasons: [`${run.fail} new failure(s)`] }
}

// null = the failure is exactly the recorded one (or a subset of it); otherwise the reason it is not.
function matchKnown(expect, run) {
  const wantExit = expect.exit
  if (wantExit !== undefined && run.exit !== wantExit && !mutated('known-exit')) return `exit code ${run.exit}, recorded ${wantExit}`
  if (expect.contains && !run.text.includes(expect.contains) && !mutated('known-contains')) return `the output no longer contains "${expect.contains}"`
  const max = expect.fail ?? 0
  if (run.fail > max && !mutated('known-count')) return `${run.fail} failures, recorded at most ${max}`
  const names = expect.names ?? []
  if (names.length && !mutated('known-names')) {
    const stray = run.failLines.filter((l) => !names.some((n) => l.includes(n)))
    if (stray.length) return `a failure that is not recorded: ${stray[0].slice(0, 200)}`
  }
  if (run.fail === 0 && run.exit === 0) return 'it passes'
  return null
}
function knownNotes(expect, run) {
  const notes = []
  if ((expect.fail ?? 0) > run.fail && run.fail > 0) notes.push(`fewer failures than recorded (${run.fail} of ${expect.fail}): consider tightening known-failures.json`)
  return notes
}

// First run + reruns -> the suite's final verdict.
// A REGRESSION that does not repeat on the rerun is a FLAKE (it was a failure once and then PASSed or fell back to the
// recorded KNOWN failure). A REGRESSION on every attempt stays a REGRESSION, reported from the LAST attempt.
export function settle(attempts) {
  const first = attempts[0]
  if (first.verdict !== 'REGRESSION' || attempts.length === 1) return { verdict: first.verdict, reasons: first.reasons, final: first }
  if (!mutated('flake')) {
    const later = attempts.slice(1).find((a) => ['PASS', 'KNOWN', 'FIXED'].includes(a.verdict))
    if (later) return { verdict: 'FLAKE', reasons: [`failed once (${first.reasons[0]}), then ${later.verdict} on the rerun`], final: later }
  }
  const last = attempts[attempts.length - 1]
  return { verdict: 'REGRESSION', reasons: last.reasons, final: last }
}

// ------------------------------------------------------------------ what a release contains
// Paths are relative to sporta-web/. Returns one entry per changed path.
//   kind: api | knet | pay | htaccess | addon | ondemand | foreign | source | migration | public-other
export function mapPath(path, baseline) {
  const b = baseline ?? {}
  const base = path.split('/').pop()
  const flags = []
  if (path.startsWith('dropin/php-store/')) {
    if (/\.mysql\.sql$/.test(path)) flags.push('migration')
    if (/\/cron-[a-z-]+\.php$/.test(path)) flags.push('cron')
    return { path, kind: 'api', scope: 'api', flags }
  }
  if (path.startsWith('dropin/php-knet/')) return { path, kind: 'knet', scope: 'knet', flags: ['money'] }
  if (path.startsWith('dropin/php-cbk/')) return { path, kind: 'pay', scope: 'pay', flags: ['money'] }
  if (path === 'public/.htaccess') return { path, kind: 'htaccess', scope: '.htaccess', flags: [] }
  if (path.startsWith('public/')) {
    const rel = path.slice('public/'.length)
    if (rel === 'sporta-admin-brands.js') return { path, kind: 'addon', scope: 'sporta-admin-brands.js,sporta-admin-brands.full.js', flags: ['loader-pair'] }
    if ((b.linked ?? []).includes(rel)) return { path, kind: 'addon', scope: rel, flags: [] }
    if ((b.onDemand ?? []).includes(rel)) return { path, kind: 'ondemand', scope: rel, flags: [] }
    if ((b.foreign ?? []).some((g) => globToRegExp(g).test(rel))) return { path, kind: 'foreign', scope: null, flags: [] }
    if ((b.heldBack ?? []).includes(rel)) return { path, kind: 'public-other', scope: rel, flags: ['held-back'] }
    return { path, kind: 'public-other', scope: rel.includes('/') ? rel.split('/')[0] : rel, flags: [] }
  }
  if (path === 'index.html' || path.startsWith('src/')) return { path, kind: 'foreign', scope: null, flags: ['storefront-source'] }
  return { path, kind: 'source', scope: null, flags: [] }
}

// Group the mapped paths into the --only scopes of vps-deploy.mjs and the owner's attention list.
export function summariseRelease(mapped, { addedFiles = new Set(), diffText = '' } = {}) {
  const scopes = new Set()
  const attention = []
  const byKind = {}
  for (const m of mapped) {
    ;(byKind[m.kind] ??= []).push(m.path)
    if (m.scope) for (const s of m.scope.split(',')) scopes.add(s)
  }
  const backend = ['api', 'knet', 'pay'].filter((k) => byKind[k])
  if (backend.length) {
    attention.push(`BACKEND CHANGE (${backend.join(', ')}): needs an independent review with the verdict SHIP, this gate green, and the read-only live schema diff (CLAUDE.md "Gate"; npm run audit:db-schema-live through the job in ops/db/schema-diff.compose.json) BEFORE the apply`)
  }
  if (byKind.knet || byKind.pay) attention.push('MONEY PATH (knet / pay): the same gate plus the payment reviewer; card payments are an owner step in /backends -> Payments, not a deploy')
  const migrations = mapped.filter((m) => m.flags.includes('migration'))
  if (migrations.length) {
    attention.push(`MIGRATION FILE(S) ${migrations.map((m) => m.path.split('/').pop() + (addedFiles.has(m.path) ? ' (new)' : ' (changed)')).join(', ')}: a deploy copies no SQL. The live database must carry it first (owner-approved one-shot job with a backup, then re-run the schema diff)`)
  }
  const crons = mapped.filter((m) => m.flags.includes('cron'))
  if (crons.length) attention.push(`CRON FILE(S) ${crons.map((m) => m.path.split('/').pop()).join(', ')}: the host cron runs them from the live container, so new code is live within 15 minutes of the file copy (cron-stock.php includes the 24 h COD auto-cancel)`)
  if (byKind.htaccess && !byKind.api) attention.push('.htaccess changed with NO api change: CLAUDE.md says a changed .htaccess ships with its PHP (a route the .htaccess names must exist in api/seo-page.php); check that no route in it needs PHP that is not live')
  if (byKind.htaccess && byKind.api) attention.push('.htaccess and api/ change together: ship them in the same apply (the .htaccess may send a path to PHP the old api cannot answer)')
  if (mapped.some((m) => m.flags.includes('loader-pair'))) attention.push('sporta-admin-brands.js is a 1 kB loader at deploy time: scope it as BOTH names (sporta-admin-brands.js,sporta-admin-brands.full.js); read the plan\'s "live bytes -> release bytes" line, the tool\'s 70% shrink guard does not cover JS')
  if (mapped.some((m) => m.flags.includes('held-back'))) attention.push('a root brand file the owner held back on purpose changed: it ships only on the owner\'s explicit yes')
  if (mapped.some((m) => m.flags.includes('storefront-source'))) attention.push('src/ or index.html changed: this repo\'s storefront is NOT live (the live one is a foreign build); never ship it unless the owner asks for --replace-storefront')
  for (const m of mapped.filter((x) => x.kind === 'public-other')) attention.push(`public/${m.scope} is not a linked add-on: check the plan lists it and that the owner wants it live`)
  // Config keys the added PHP lines read: each needs a safe default in code (the live store config is root-owned 0440).
  const keys = new Set()
  for (const line of diffText.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    for (const m of line.matchAll(/\$cfg\[['"]([a-z0-9_]+)['"]\]|store_listing_rule_on\(['"]([a-z0-9_]+)['"]/g)) keys.add(m[1] ?? m[2])
  }
  if (keys.size) attention.push(`CONFIG KEYS read by added lines: ${[...keys].sort().join(', ')}. The live config cannot be edited by a deploy: each key must have a safe default in code (check), and a key the owner must set is an owner step`)
  return { scopes: [...scopes], attention, byKind }
}

// ------------------------------------------------------------------ small formatting helpers
export const pad = (s, n) => String(s).padEnd(n)
export function mdTable(rows, head) {
  const all = [head, ...rows]
  const w = head.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? '').length)))
  const line = (r) => '| ' + r.map((c, i) => String(c ?? '').padEnd(w[i])).join(' | ') + ' |'
  return [line(head), '| ' + w.map((n) => '-'.repeat(n)).join(' | ') + ' |', ...rows.map(line)].join('\n')
}
export const utcStamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
