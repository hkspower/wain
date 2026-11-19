// scripts/release-gate.mjs and scripts/lib/release-gate-core.mjs, proved with FAKE suites (tiny node scripts in a temp
// directory, a temp config, no sandbox, no network, never the repo's own registry for the behaviour checks).
//
//   npm run test:release-gate
//
// What is held here, and how:
//   A  the output parsers, on the real summary shapes of this repo's suites
//   B  every classification rule, end to end through the real CLI: PASS, REGRESSION (new failure), KNOWN (identical),
//      KNOWN but worse, KNOWN but other names, FLAKE (a counter file: fails once, then passes), FIXED, timeout,
//      ok count below minOk, exit 1 with no recorded reason, exit code of the gate
//   C  selection: --only, lane:, --quick, --changed (a temp git repo), unmeasured suites, unknown names
//   D  scheduling: a rig suite never overlaps another suite, pool suites do run in parallel, the rate-limit clear
//      runs before every rig suite, reruns (2 for browser suites, 1 for the others, 0 with --rerun-flakes 0), SKIPPED
//      when the rig is absent, exit 2 with the sandbox script's own "!!" line when it will not start
//   E  --json shape
//   F  deploy readiness: dirty tree, branch not pushed, HEAD message guard ("NOT READY" / "do not deploy"), the commands
//      printed (plan and apply with the SHA twice, scoped by what changed), what the owner must look at, and that the gate
//      NEVER starts vps-deploy.mjs (a fake one in the temp tree writes a marker if it is ever run; the spawn log is read)
//   G  the owner's rule (CLAUDE.md item 2): the repo has NO .github/, no CI workflow, no deploying git hook
//   H  the real registry, known-failures and live-baseline files are consistent with package.json
// MUTATION CHECKS: for every rule above that has a switch (GATE_MUTATE=<rule>, read in scripts/lib/release-gate-core.mjs),
// the same scenario is run again with the rule OFF and must then FAIL; a rule that can be removed unnoticed is not held.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scriptClosure } from './lib/release-gate-deps.mjs'
import { scriptOfSuite } from './release-gate.mjs'
import { globToRegExp, mapPath, parseOutput, summariseRelease, triggeredSuites } from './lib/release-gate-core.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.resolve(HERE, '..')
const GATE = path.join(HERE, 'release-gate.mjs')
let pass = 0
let fail = 0
const ok = (cond, msg, detail = '') => { if (cond) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + String(detail).slice(0, 600) : '')) } }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'))
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* best effort */ } })
const sh = (cwd, cmd, args, env = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
const git = (cwd, ...a) => sh(cwd, 'git', ['-c', 'user.name=gate', '-c', 'user.email=', '-c', 'commit.gpgsign=false', ...a])

// ------------------------------------------------------------------ fake suites
// A fake suite is a node script: `lines` are printed, `exit` is the exit code. Options: sleep (ms), stamp (file to append
// "name start end" to), counter (file: the first N runs fail), hang (never ends).
function fakeSuite(root, name, o = {}) {
  const file = path.join(root, 'suites', `${name}.mjs`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const src = `
import fs from 'node:fs'
const o = ${JSON.stringify(o)}
const t0 = Date.now()
const runs = o.counter ? (fs.existsSync(o.counter) ? Number(fs.readFileSync(o.counter, 'utf8')) : 0) : 0
if (o.counter) fs.writeFileSync(o.counter, String(runs + 1))
if (o.invoked) fs.appendFileSync(o.invoked, ${JSON.stringify(name)} + '\\n')
if (o.pidfile) fs.writeFileSync(o.pidfile, String(process.pid))
if (o.hang) setInterval(() => {}, 1000)
else {
  await new Promise((r) => setTimeout(r, o.sleep ?? 0))
  const failing = o.counter ? runs < (o.failFirst ?? 1) : false
  const lines = failing ? o.failLines : o.lines
  for (const l of lines ?? []) console.log(l)
  if (o.stamp) fs.appendFileSync(o.stamp, ${JSON.stringify(name)} + ' ' + t0 + ' ' + Date.now() + '\\n')
  process.exit(failing ? 1 : (o.exit ?? 0))
}`
  fs.writeFileSync(file, src)
  return `node suites/${name}.mjs`
}
const PASS_LINES = ['ok   one', 'ok   two', '2 passed, 0 failed']
const FAIL1 = ['ok   one', 'FAIL the thing does not work  - got 3', '1 passed, 1 failed']

// A scenario = a temp tree + a config + one CLI run of the gate. `suites` entries: { reg: {...registry fields}, run: {...fakeSuite opts} }
let scenarioNo = 0
function scenario({ suites, known = [], args = [], env = {}, rig = null, files = null, baseline = null, git: useGit = false, notIn = [], lanes = {}, globalTriggers = [] }) {
  const root = path.join(TMP, 'sc' + ++scenarioNo)
  fs.mkdirSync(root, { recursive: true })
  const registry = {
    schema: 1,
    rig: rig ?? { ports: [], dbCheck: [process.execPath, '-e', '0'], start: [process.execPath, '-e', '0'], clearRateLimit: [process.execPath, '-e', `require('fs').appendFileSync(${JSON.stringify(path.join(root, 'rate.log'))}, 'clear\\n')`] },
    groups: {}, globalTriggers, lanes, not_in_gate: notIn,
    suites: suites.map((s) => ({ needs: 'none', parallelSafe: true, timeoutSec: 20, minOk: 0, parse: 'auto', triggers: [], quick: false, ...s.reg, command: fakeSuite(root, s.reg.name, { ...s.run, stamp: s.run?.stamp ? path.join(root, s.run.stamp) : undefined, counter: s.run?.counter ? path.join(root, s.run.counter) : undefined, invoked: path.join(root, 'invoked.log') }) })),
  }
  const cfg = path.join(root, 'gate.config.json')
  fs.writeFileSync(cfg, JSON.stringify(registry))
  fs.writeFileSync(path.join(root, 'known.json'), JSON.stringify({ schema: 1, suites: known }))
  fs.writeFileSync(path.join(root, 'baseline.json'), JSON.stringify(baseline ?? { schema: 1 }))
  if (files) for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), c) }
  if (useGit) {
    git(root, 'init', '-q', '-b', 'main')
    fs.writeFileSync(path.join(root, '.gitignore'), 'out/\nrate.log\ninvoked.log\n.gate/\ngate.config.json\nknown.json\nbaseline.json\nr.json\nstamps.log\n')
    git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'first')
  }
  return { root, cfg }
}
function runGate(sc, args = [], env = {}) {
  const out = path.join(sc.root, 'r.json')
  const t0 = Date.now()
  const p = spawnSync(process.execPath, [GATE, '--root', sc.root, '--config', sc.cfg, '--known', path.join(sc.root, 'known.json'), '--baseline', path.join(sc.root, 'baseline.json'), '--outdir', path.join(sc.root, 'out'), '--json', out, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120000 })
  let json = null
  try { json = JSON.parse(fs.readFileSync(out, 'utf8')) } catch { /* no json (a usage error) */ }
  const verdict = (n) => json?.suites?.find((s) => s.name === n)?.verdict
  return { code: p.status, stdout: p.stdout, stderr: p.stderr, json, verdict, seconds: (Date.now() - t0) / 1000 }
}

// A rule check: the scenario must satisfy `expect` normally, and must NOT satisfy it with the rule switched off.
function ruleCheck(label, build, expect, mutate) {
  const sc = build()
  const r = runGate(sc)
  ok(expect(r, sc), label, `${r.json ? r.json.suites.map((s) => `${s.name}:${s.verdict}:${s.note}`).join(' | ') : r.stderr} exit ${r.code}`)
  if (mutate) {
    const sc2 = build()
    const r2 = runGate(sc2, [], { GATE_MUTATE: mutate })
    ok(!expect(r2, sc2), `   mutation "${mutate}" (rule switched off) makes it fail: the rule is held`, `with the rule off: ${r2.json ? r2.json.suites.map((s) => s.name + ':' + s.verdict).join(' ') : r2.stderr}`)
  }
}
const one = (reg, run, extra = {}) => ({ suites: [{ reg: { name: 's', ...reg }, run }], ...extra })

// ================================================================== A. the parsers
{
  const P = (t, s, r) => parseOutput(t, s, r)
  let r = P('ok   a\nok   b\n141 passed, 0 failed\n')
  ok(r.ok === 141 && r.fail === 0 && r.parsedBy === 'passed-failed', 'parse: "N passed, M failed"', JSON.stringify(r))
  r = P('x\n235 passed, 2 failed\nFAIL one\nFAIL two\n')
  ok(r.fail === 2 && r.failLines.length === 2 && r.ok === 235, 'parse: failing summary keeps the FAIL lines', JSON.stringify(r))
  r = P('18 ok, 1 FAIL\n')
  ok(r.ok === 18 && r.fail === 1, 'parse: "N ok, M FAIL"', JSON.stringify(r))
  r = P('97 ok, 3 failed\n')
  ok(r.ok === 97 && r.fail === 3, 'parse: "N ok, M failed"', JSON.stringify(r))
  r = P('917 checks: 850 ok, 67 expected-fail (known defects), 0 unexpected-pass, 0 FAIL\n')
  ok(r.ok === 850 && r.fail === 0, 'parse: the htaccess-rules shape (expected-fail is not a failure)', JSON.stringify(r))
  r = P('file-names: 21 FAILED of 6931 checks\n')
  ok(r.fail === 21 && r.ok === 6910, 'parse: "N FAILED of M checks"', JSON.stringify(r))
  r = P('4 FAIL — 300 checks passed\n')
  ok(r.fail === 4 && r.ok === 300, 'parse: "N FAIL — M checks passed"', JSON.stringify(r))
  r = P('75 checks, 0 failed\n')
  ok(r.ok === 75 && r.fail === 0, 'parse: "N checks, M failed"', JSON.stringify(r))
  r = P('1 FAILED\n')
  ok(r.fail === 1, 'parse: a bare "N FAILED"', JSON.stringify(r))
  r = P('1 problem(s) in the product grid\n')
  ok(r.fail === 1, 'parse: "N problem(s)"', JSON.stringify(r))
  r = P('ok   a\nok   b\nok   c\nall passed\n')
  ok(r.ok === 3 && r.fail === 0 && r.parsedBy === 'lines', 'parse: no summary, the ok lines are counted', JSON.stringify(r))
  r = P('ok   a\nXFAIL known defect\nFAILED:\n  FAIL  real one\n')
  ok(r.fail === 1 && r.failLines[0].startsWith('FAIL'), 'parse: XFAIL and the "FAILED:" header are not failures', JSON.stringify(r))
  r = P('\x1b[32mok\x1b[0m   a\n\x1b[31m5 passed, 0 failed\x1b[0m\n')
  ok(r.ok === 5, 'parse: colour codes are stripped', JSON.stringify(r))
  r = P('3 passed, 0 failed\nFAIL but the summary says clean\n')
  ok(r.fail === 1, 'parse: a clean summary over visible FAIL lines is not trusted', JSON.stringify(r))
  r = P('211 passed, 0 failed (checks before the mutation pass: 207 passed, 0 failed)\n')
  ok(r.ok === 211, 'parse: two counts on one line, the headline wins', JSON.stringify(r))
  r = P('ok a\nok b\n9 passed, 0 failed\n', 'lines')
  ok(r.ok === 2 && r.parsedBy === 'lines', 'parse: strategy "lines" ignores the summary', JSON.stringify(r))
  r = P('ok a\n', 'exit')
  ok(r.ok === null && r.parsedBy === 'exit', 'parse: strategy "exit" reads no count', JSON.stringify(r))
  r = P('total=7 bad=2\n', 'regex', { ok: 'total=(\\d+)', fail: 'bad=(\\d+)' })
  ok(r.ok === 7 && r.fail === 2, 'parse: strategy "regex"', JSON.stringify(r))
  r = P('64 of 65 checks passed\n  FAIL  one\n')
  ok(r.fail === 1, 'parse: unknown summary falls back to the FAIL lines', JSON.stringify(r))
}
// globs and triggers
{
  const m = (g, p) => globToRegExp(g).test(p)
  ok(m('dropin/php-store/**', 'dropin/php-store/store.php') && m('dropin/php-store/**', 'dropin/php-store/x/y.php') && !m('dropin/php-store/**', 'dropin/php-knet/a.php'), 'glob: ** crosses folders')
  ok(m('public/sporta-*.css', 'public/sporta-grid.css') && !m('public/sporta-*.css', 'public/sub/sporta-x.css') && !m('public/sporta-*.css', 'public/sporta-grid.js'), 'glob: * stays inside a folder')
  ok(m('public/sporta-{features,catalogue}.js', 'public/sporta-features.js') && !m('public/sporta-{features,catalogue}.js', 'public/sporta-grid.js'), 'glob: {a,b}')
  ok(m('**', 'a/b/c.txt') && m('**/x.js', 'x.js') && m('**/x.js', 'a/b/x.js'), 'glob: ** alone and **/')
  const reg = { groups: { php: ['dropin/**'] }, globalTriggers: [{ globs: ['scripts/lib/**'], suites: 'all' }, { globs: ['db.sql'], suites: 'needs:rig' }], suites: [
    { name: 'a', needs: 'none', triggers: ['@php', 'x.js'] }, { name: 'b', needs: 'rig', triggers: ['y.js'] }, { name: 'c', needs: 'browser', triggers: [] }] }
  const t = (files) => [...triggeredSuites(reg, files, (n) => (n === 'c' ? 'scripts/c-test.mjs' : null))].sort().join(',')
  ok(t(['dropin/php-store/store.php']) === 'a', 'triggers: a group expands', t(['dropin/php-store/store.php']))
  ok(t(['y.js']) === 'b' && t(['x.js']) === 'a', 'triggers: plain globs')
  ok(t(['scripts/c-test.mjs']) === 'c', "triggers: a suite's own script always counts")
  ok(t(['scripts/lib/any.mjs']) === 'a,b,c', 'triggers: a global trigger selects every suite')
  ok(t(['db.sql']) === 'b', 'triggers: a global trigger can select by needs')
  ok(t(['README.md']) === '', 'triggers: an unrelated file selects nothing')
}

// ================================================================== B. the classification rules, through the CLI
ruleCheck('PASS: exit 0, enough ok', () => scenario(one({ minOk: 2 }, { lines: PASS_LINES })), (r) => r.verdict('s') === 'PASS' && r.code === 0 && /GATE GREEN: no regression/.test(r.stdout))

ruleCheck('REGRESSION: a new failure (no known entry), exit 1, the FAIL line quoted verbatim', () => scenario(one({}, { lines: FAIL1, exit: 1 })),
  (r) => r.verdict('s') === 'REGRESSION' && r.code === 1 && r.stdout.includes('FAIL the thing does not work  - got 3') && /GATE RED: 1 regression/.test(r.stdout))

const KNOWN2 = { suite: 's', since: 't', reason: 'r', evidence: 'e', expect: { exit: 1, fail: 2, names: ['alpha', 'beta'] } }
const lines2 = (a, b) => ['ok one', `FAIL ${a}  - x`, `FAIL ${b}  - y`, '1 passed, 2 failed']
ruleCheck('KNOWN: fails exactly as recorded -> KNOWN, the gate stays green', () => scenario({ ...one({}, { lines: lines2('alpha thing', 'beta thing'), exit: 1 }), known: [KNOWN2] }),
  (r) => r.verdict('s') === 'KNOWN' && r.code === 0 && /GATE GREEN/.test(r.stdout))
ruleCheck('KNOWN but worse: one more failure than recorded -> REGRESSION', () => scenario({ ...one({}, { lines: ['ok one', 'FAIL alpha 1', 'FAIL beta 2', 'FAIL alpha 3', '1 passed, 3 failed'], exit: 1 }), known: [KNOWN2] }),
  (r) => r.verdict('s') === 'REGRESSION' && r.code === 1, 'known-count')
ruleCheck('KNOWN but other names: same count, a failure that is not recorded -> REGRESSION', () => scenario({ ...one({}, { lines: lines2('alpha thing', 'GAMMA new'), exit: 1 }), known: [KNOWN2] }),
  (r) => r.verdict('s') === 'REGRESSION' && r.stdout.includes('FAIL GAMMA new'), 'known-names')
ruleCheck('KNOWN with fewer failures than recorded stays KNOWN (and says so)', () => scenario({ ...one({}, { lines: ['ok one', 'FAIL alpha thing', '1 passed, 1 failed'], exit: 1 }), known: [KNOWN2] }),
  (r) => r.verdict('s') === 'KNOWN' && /fewer failures than recorded/.test(r.stdout))
ruleCheck('KNOWN needs the recorded exit code: another exit code is a REGRESSION', () => scenario({ ...one({}, { lines: lines2('alpha thing', 'beta thing'), exit: 2 }), known: [KNOWN2] }),
  (r) => r.verdict('s') === 'REGRESSION', 'known-exit')
const KCRASH = { suite: 's', since: 't', reason: 'r', evidence: 'e', expect: { exit: 1, fail: 0, contains: 'no SOG section' } }
ruleCheck('KNOWN crash: no FAIL line, exit 1, the recorded text is in the output -> KNOWN', () => scenario({ ...one({}, { lines: ['Error: no SOG section'], exit: 1 }), known: [KCRASH] }),
  (r) => r.verdict('s') === 'KNOWN')
ruleCheck('KNOWN crash: the recorded text is gone (it crashes some other way) -> REGRESSION', () => scenario({ ...one({}, { lines: ['TypeError: something else'], exit: 1 }), known: [KCRASH] }),
  (r) => r.verdict('s') === 'REGRESSION', 'known-contains')
ruleCheck('FIXED: a recorded known failure now passes -> FIXED, "remove it from known-failures.json"', () => scenario({ ...one({}, { lines: PASS_LINES }), known: [KNOWN2] }),
  (r) => r.verdict('s') === 'FIXED' && r.code === 0 && /remove it from ops\/release\/known-failures\.json/.test(r.stdout), 'fixed')
ruleCheck('exit 1 with no FAIL line and no recorded reason -> REGRESSION', () => scenario(one({}, { lines: ['ok one', '1 passed, 0 failed'], exit: 1 })),
  (r) => r.verdict('s') === 'REGRESSION' && /no FAIL line and no recorded reason/.test(r.stdout), 'exit-code')
ruleCheck('ok count below minOk (checks disappeared) -> REGRESSION', () => scenario(one({ minOk: 5 }, { lines: ['ok a', '1 passed, 0 failed'] })),
  (r) => r.verdict('s') === 'REGRESSION' && /below the registry's minOk 5/.test(r.stdout), 'min-ok')
ruleCheck('a timeout is a REGRESSION and the suite (a hang) is killed', () => scenario(one({ timeoutSec: 1 }, { hang: true })),
  (r) => r.verdict('s') === 'REGRESSION' && /timed out after 1s/.test(r.stdout) && r.seconds < 40, 'timeout')
// FLAKE: the counter file makes the first run fail and the rerun pass
ruleCheck('FLAKE: fails once, passes on the automatic rerun -> FLAKE, the gate is green', () => scenario(one({ needs: 'browser' }, { counter: 'c.txt', failFirst: 1, failLines: FAIL1, lines: PASS_LINES })),
  (r) => r.verdict('s') === 'FLAKE' && r.code === 0 && r.json.suites[0].attempts.length === 2, 'flake')
ruleCheck('a failure that repeats on every rerun is a REGRESSION (browser: 1 run + 2 reruns)', () => scenario(one({ needs: 'browser' }, { counter: 'c.txt', failFirst: 99, failLines: FAIL1, lines: PASS_LINES })),
  (r) => r.verdict('s') === 'REGRESSION' && r.json.suites[0].attempts.length === 3)
{
  const sc = scenario(one({ needs: 'none' }, { counter: 'c.txt', failFirst: 99, failLines: FAIL1, lines: PASS_LINES }))
  const r = runGate(sc)
  ok(r.verdict('s') === 'REGRESSION' && r.json.suites[0].attempts.length === 2, 'reruns: a non-browser suite gets 1 rerun', r.json?.suites[0].attempts.length)
  const sc2 = scenario(one({ needs: 'browser' }, { counter: 'c.txt', failFirst: 99, failLines: FAIL1, lines: PASS_LINES }))
  const r2 = runGate(sc2, ['--rerun-flakes', '0'])
  ok(r2.json.suites[0].attempts.length === 1, 'reruns: --rerun-flakes 0 turns them off', r2.json?.suites[0].attempts.length)
  const sc3 = scenario(one({ needs: 'none', timeoutSec: 1 }, { hang: true }))
  const r3 = runGate(sc3)
  ok(r3.json.suites[0].attempts.length === 1, 'reruns: a timeout is not rerun (it would cost the same again)')
}
// a known failure that fails differently on the first run and as recorded on the rerun is a FLAKE, not a REGRESSION
{
  const sc = scenario({ ...one({ needs: 'browser' }, { counter: 'c.txt', failFirst: 1, failLines: ['FAIL brand new thing', '0 passed, 1 failed'], lines: lines2('alpha thing', 'beta thing'), exit: 1 }), known: [KNOWN2] })
  const r = runGate(sc)
  ok(r.verdict('s') === 'FLAKE' || r.verdict('s') === 'KNOWN', 'a transient extra failure that does not repeat does not turn a KNOWN suite red', r.verdict('s'))
}

// ================================================================== C. selection
const SEL = () => scenario({
  suites: [
    { reg: { name: 'a', quick: true, needs: 'none' }, run: { lines: PASS_LINES } },
    { reg: { name: 'b', quick: false, needs: 'browser' }, run: { lines: PASS_LINES } },
    { reg: { name: 'c', quick: true, needs: 'none', measured: false }, run: { lines: PASS_LINES } },
    { reg: { name: 'd', quick: false, needs: 'none' }, run: { lines: PASS_LINES } },
  ],
  lanes: { pair: ['a', 'b'] },
  notIn: [{ name: 'e', reason: 'private database' }],
})
const names = (r) => (r.json?.suites ?? []).map((s) => s.name).sort().join(',')
{
  let r = runGate(SEL())
  ok(names(r) === 'a,b,d', 'default: every MEASURED suite, the unmeasured one is not run', names(r))
  r = runGate(SEL(), ['--quick'])
  ok(names(r) === 'a', '--quick: only quick suites (and still not the unmeasured one)', names(r))
  r = runGate(SEL(), ['--only', 'b,d'])
  ok(names(r) === 'b,d', '--only picks exactly those', names(r))
  r = runGate(SEL(), ['--only', 'test:b'])
  ok(names(r) === 'b', '--only accepts the test: prefix', names(r))
  r = runGate(SEL(), ['--only', 'c'])
  ok(names(r) === 'c' && r.verdict('c') === 'PASS' && /unmeasured: record minOk/.test(r.json.suites[0].note), '--only runs an unmeasured suite and says to record its count', r.json?.suites[0].note)
  r = runGate(SEL(), ['--quick', '--only', 'b'])
  ok(names(r) === 'b', '--only wins over --quick', names(r))
  r = runGate(SEL(), ['--only', 'lane:pair'])
  ok(names(r) === 'a,b', '--only lane:<name> expands a lane', names(r))
  r = runGate(SEL(), ['--include-unmeasured'])
  ok(names(r) === 'a,b,c,d', '--include-unmeasured adds the unmeasured suites', names(r))
  r = runGate(SEL(), ['--only', 'zzz'])
  ok(r.code === 2 && /unknown suite zzz/.test(r.stderr), '--only with an unknown name: exit 2', r.stderr)
  r = runGate(SEL(), ['--only', 'e'])
  ok(r.code === 2 && /not in the gate: private database/.test(r.stderr), '--only with a not_in_gate name: exit 2 with the reason', r.stderr)
  r = runGate(SEL(), ['--bogus'])
  ok(r.code === 2 && /unknown option --bogus/.test(r.stderr), 'an unknown option: exit 2', r.stderr)
  r = runGate(SEL(), ['--jobs', '0'])
  ok(r.code === 2, '--jobs 0: exit 2')
  const h = spawnSync(process.execPath, [GATE, '--help'], { encoding: 'utf8' })
  ok(h.status === 0 && /--deploy-check/.test(h.stdout) && /--rerun-flakes/.test(h.stdout), '--help lists the options', h.stdout.slice(0, 200))
  const l = spawnSync(process.execPath, [GATE, '--list'], { cwd: WEB, encoding: 'utf8' })
  ok(l.status === 0 && /NOT in the gate/.test(l.stdout) && /guest-orders/.test(l.stdout) && /file-names/.test(l.stdout), '--list prints the registry and the not-in-gate reasons', l.stdout.slice(-300))
}
// --changed, in a temp git repo
{
  const build = () => scenario({
    suites: [
      { reg: { name: 'feat', triggers: ['public/f*.js'] }, run: { lines: PASS_LINES } },
      { reg: { name: 'php', triggers: ['dropin/**'] }, run: { lines: PASS_LINES } },
      { reg: { name: 'other', triggers: ['nothing/**'] }, run: { lines: PASS_LINES } },
    ],
    globalTriggers: [{ globs: ['scripts/lib/**'], suites: 'all' }],
    git: true, files: { 'public/f1.js': '1', 'dropin/x.php': '1', 'scripts/lib/a.mjs': '1' },
  })
  let sc = build()
  const first = git(sc.root, 'rev-parse', 'HEAD').stdout.trim()
  fs.writeFileSync(path.join(sc.root, 'baseline.json'), JSON.stringify({ schema: 1, ref: first }))
  let r = runGate(sc, ['--changed'])
  ok(r.code === 0 && names(r) === '' && /no suite selected/.test(r.stdout), '--changed: nothing changed since the baseline ref selects nothing', r.stdout.slice(0, 200))
  fs.writeFileSync(path.join(sc.root, 'public/f1.js'), '2'); git(sc.root, 'add', '-A'); git(sc.root, 'commit', '-q', '-m', 'edit')
  r = runGate(sc, ['--changed'])
  ok(names(r) === 'feat', '--changed: a committed change selects the suites whose trigger matches (ref from the baseline file)', names(r))
  r = runGate(sc, ['--changed=' + first.slice(0, 7)])
  ok(names(r) === 'feat', '--changed=<ref> uses that ref', names(r))
  r = runGate(sc, ['--changed', '--since', 'HEAD'])
  ok(names(r) === '', '--since moves the ref of --changed', names(r))
  fs.writeFileSync(path.join(sc.root, 'dropin/new-untracked.php'), 'x')
  r = runGate(sc, ['--changed'])
  ok(names(r) === 'feat,php', '--changed: an untracked file counts', names(r))
  fs.writeFileSync(path.join(sc.root, 'scripts/lib/a.mjs'), '9')
  r = runGate(sc, ['--changed'])
  ok(names(r) === 'feat,other,php', '--changed: a global trigger (a shared library) selects every suite', names(r))
  r = runGate(sc, ['--changed=nosuchref'])
  ok(r.code === 2 && /git diff against nosuchref failed/.test(r.stderr), '--changed with a bad ref: exit 2', r.stderr)
}

// ================================================================== D. scheduling, the rig, reruns
const readStamps = (root, f) => fs.readFileSync(path.join(root, f), 'utf8').split('\n').filter(Boolean).map((l) => { const [n, a, b] = l.split(' '); return { n, a: Number(a), b: Number(b) } })
const overlaps = (st) => st.some((x, i) => st.some((y, j) => i < j && x.a < y.b && y.a < x.b))
{
  const build = (extra = []) => scenario({
    suites: [
      { reg: { name: 'r1', needs: 'rig', parallelSafe: false }, run: { sleep: 500, stamp: 'stamps.log', lines: PASS_LINES } },
      { reg: { name: 'r2', needs: 'rig', parallelSafe: false }, run: { sleep: 500, stamp: 'stamps.log', lines: PASS_LINES } },
      { reg: { name: 'r3', needs: 'rig+browser', parallelSafe: false }, run: { sleep: 500, stamp: 'stamps.log', lines: PASS_LINES } },
      ...extra,
    ],
  })
  const sc = build()
  const r = runGate(sc, ['--jobs', '4'])
  const st = readStamps(sc.root, 'stamps.log')
  ok(st.length === 3 && !overlaps(st) && r.code === 0, 'rig suites never overlap, even with --jobs 4', JSON.stringify(st))
  ok(fs.readFileSync(path.join(sc.root, 'rate.log'), 'utf8').split('\n').filter(Boolean).length === 3, 'the rate_limit clear runs before every rig suite (3 suites, 3 clears)')
  const sc2 = build()
  runGate(sc2, ['--jobs', '4'], { GATE_MUTATE: 'rig-serial' })
  ok(overlaps(readStamps(sc2.root, 'stamps.log')), '   mutation "rig-serial" (rig suites in the pool) makes them overlap: the rule is held')
  const sc3 = scenario({ suites: [
    { reg: { name: 'p1', needs: 'browser' }, run: { sleep: 700, stamp: 'stamps.log', lines: PASS_LINES } },
    { reg: { name: 'p2', needs: 'browser' }, run: { sleep: 700, stamp: 'stamps.log', lines: PASS_LINES } },
  ] })
  runGate(sc3, ['--jobs', '2'])
  ok(overlaps(readStamps(sc3.root, 'stamps.log')), 'parallel-safe suites run in parallel with --jobs 2')
  const sc4 = scenario({ suites: [
    { reg: { name: 'p1', needs: 'browser' }, run: { sleep: 400, stamp: 'stamps.log', lines: PASS_LINES } },
    { reg: { name: 'p2', needs: 'browser' }, run: { sleep: 400, stamp: 'stamps.log', lines: PASS_LINES } },
  ] })
  runGate(sc4, ['--jobs', '1'])
  ok(!overlaps(readStamps(sc4.root, 'stamps.log')), '--jobs 1 runs them one at a time')
  const sc5 = scenario({ suites: [
    { reg: { name: 'pool', needs: 'browser' }, run: { sleep: 300, stamp: 'stamps.log', lines: PASS_LINES } },
    { reg: { name: 'rigged', needs: 'rig', parallelSafe: false }, run: { sleep: 300, stamp: 'stamps.log', lines: PASS_LINES } },
  ] })
  runGate(sc5)
  ok(!overlaps(readStamps(sc5.root, 'stamps.log')), 'a rig suite does not overlap the pool either (the pool finishes first)')
}
{
  // the rig absent: --no-sandbox -> SKIPPED with the reason; a rig that will not start -> exit 2 with the script's "!!" line
  const absent = { ports: [], dbCheck: [process.execPath, '-e', 'process.exit(1)'], start: [process.execPath, '-e', "console.log('-- starting'); console.log('!! MariaDB did not start - /tmp/x.log')"], clearRateLimit: [process.execPath, '-e', '0'] }
  const sc = scenario({ ...one({ needs: 'rig', parallelSafe: false }, { lines: PASS_LINES }), rig: absent })
  let r = runGate(sc, ['--no-sandbox'])
  ok(r.verdict('s') === 'SKIPPED' && r.code === 0 && /rig/.test(r.json.suites[0].note) && !fs.existsSync(path.join(sc.root, 'invoked.log')), 'rig absent + --no-sandbox: SKIPPED with a reason, the suite is not started, the gate is not red', r.stdout.slice(-300))
  r = runGate(sc)
  ok(r.code === 2 && /!! MariaDB did not start/.test(r.stderr), 'the rig will not come up: exit 2 and the script\'s own "!!" line is quoted', r.stderr)
  const sc2 = scenario({ ...one({ needs: 'none' }, { lines: PASS_LINES }), rig: absent })
  r = runGate(sc2)
  ok(r.code === 0, 'a run with no rig suite never touches the rig', r.stderr)
  const up = { ...absent, dbCheck: [process.execPath, '-e', '0'] }
  const sc3 = scenario({ ...one({ needs: 'rig', parallelSafe: false }, { lines: PASS_LINES }), rig: up })
  r = runGate(sc3)
  ok(r.verdict('s') === 'PASS' && /rig: up/.test(r.stdout), 'rig up: the suite runs')
}

// ================================================================== E. the JSON
{
  const sc = scenario({ suites: [{ reg: { name: 'a', minOk: 2 }, run: { lines: PASS_LINES } }, { reg: { name: 'b' }, run: { lines: FAIL1, exit: 1 } }], git: true })
  const r = runGate(sc, ['--rerun-flakes', '0'])
  const j = r.json
  ok(j && j.schema === 1 && typeof j.started === 'string' && typeof j.finished === 'string' && typeof j.durationSec === 'number' && typeof j.head === 'string' && j.head.length === 40 && j.branch === 'main', 'json: top-level fields', j && Object.keys(j).join(','))
  ok(j.verdict === 'RED' && j.totals.PASS === 1 && j.totals.REGRESSION === 1 && Array.isArray(j.regressions) && j.regressions[0].suite === 'b' && j.regressions[0].failLines[0].startsWith('FAIL the thing'), 'json: verdict, totals and regressions with the FAIL lines', JSON.stringify(j.regressions))
  const s = j.suites.find((x) => x.name === 'a')
  ok(s.ok === 2 && s.fail === 0 && s.exit === 0 && s.verdict === 'PASS' && typeof s.seconds === 'number' && Array.isArray(s.attempts) && s.attempts[0].startedAt && s.log.endsWith('a.log'), 'json: per-suite fields (ok, fail, exit, seconds, attempts, log)', JSON.stringify(s))
  ok(fs.existsSync(path.join(sc.root, 'out', 'a.log')) && fs.readFileSync(path.join(sc.root, 'out', 'a.log'), 'utf8').includes('ok   one'), 'the suite output is kept in <outdir>/<suite>.log')
  ok(/\| suite\s+\| ok\s+\| FAIL\s+\| exit\s+\| seconds\s+\| verdict\s+\|/.test(r.stdout), 'the markdown table has the six columns')
  ok(j.readiness === null, 'a red run prints no deploy readiness')
}

// ================================================================== F. deploy readiness
const BASE = (ref, extra = {}) => ({ schema: 1, ref, linked: ['sporta-features.js'], onDemand: ['sporta-catalogue.js'], foreign: ['index.html', 'sitemap*.xml', 'robots.txt'], ...extra })
function repoScenario({ msg = 'a normal commit', push = true, dirty = false, vps = true, change = {} } = {}) {
  const sc = scenario({ ...one({}, { lines: PASS_LINES }), git: true, files: { 'public/sporta-features.js': '1', 'dropin/php-store/store.php': '1', 'index.html': '1', 'README': '1' } })
  const first = git(sc.root, 'rev-parse', 'HEAD').stdout.trim()
  if (vps) fs.mkdirSync(path.join(sc.root, 'scripts'), { recursive: true })
  if (vps) fs.writeFileSync(path.join(sc.root, 'scripts/vps-deploy.mjs'), `// fake: if it is ever run it leaves a marker\nimport fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(path.join(sc.root, 'VPS-DEPLOY-WAS-RUN'))}, 'ran')\n// a === '--apply'   a === '--ref'   a === '--confirm'   a === '--only'   a === '--allow-shrink'   a === '--rollback'\nconsole.error('usage: node scripts/vps-deploy.mjs compose [--ref R] [--apply --confirm SHA]')\n`)
  for (const [f, c] of Object.entries(change)) { fs.mkdirSync(path.dirname(path.join(sc.root, f)), { recursive: true }); fs.writeFileSync(path.join(sc.root, f), c) }
  git(sc.root, 'add', '-A'); git(sc.root, 'commit', '-q', '-m', msg)
  if (push) {
    const bare = path.join(TMP, `bare${scenarioNo}.git`)
    sh(TMP, 'git', ['init', '-q', '--bare', bare])
    git(sc.root, 'remote', 'add', 'origin', bare)
    git(sc.root, 'push', '-q', 'origin', 'main')
  }
  if (dirty) fs.writeFileSync(path.join(sc.root, 'uncommitted.txt'), 'x')
  fs.writeFileSync(path.join(sc.root, 'baseline.json'), JSON.stringify(BASE(first)))
  return sc
}
// A full green gate for this HEAD is what makes READY possible (F1); the record is what a full run writes.
const writeRecord = (sc, over = {}) => {
  const head = git(sc.root, 'rev-parse', 'HEAD').stdout.trim()
  fs.mkdirSync(path.join(sc.root, '.gate'), { recursive: true })
  fs.writeFileSync(path.join(sc.root, '.gate', 'last-full.json'), JSON.stringify({ schema: 1, head, branch: 'main', verdict: 'GREEN', full: true, ...over }))
}
const ready = (sc, args = [], env = {}, record = {}) => { if (record !== null) writeRecord(sc, record); return runGate(sc, ['--deploy-check', ...args], env) }
const hasBlocker = (r, re) => (r.json?.readiness?.blockers ?? []).some((b) => re.test(b))
{
  const clean = repoScenario({ change: { 'public/sporta-features.js': '2' } })
  const r = ready(clean)
  ok(r.code === 0 && r.json.readiness.ready === true && /DEPLOY READINESS: READY/.test(r.stdout), 'readiness: a clean, pushed tree with a good message is READY (exit 0)', JSON.stringify(r.json?.readiness?.blockers))

  const dirtyR = (env) => ready(repoScenario({ dirty: true, change: { 'public/sporta-features.js': '2' } }), [], env)
  let a = dirtyR()
  ok(a.code === 3 && hasBlocker(a, /working tree is not clean/), 'readiness: a dirty tree is a blocker (exit 3 for --deploy-check)', a.stdout.slice(-300))
  ok(!hasBlocker(dirtyR({ GATE_MUTATE: 'dirty-tree' }), /working tree is not clean/), '   mutation "dirty-tree" makes the blocker vanish: the rule is held')

  const notPushed = ready(repoScenario({ push: false, change: { 'public/sporta-features.js': '2' } }))
  ok(hasBlocker(notPushed, /never pushed/), 'readiness: a branch with no origin is a blocker')
  const sc = repoScenario({ change: { 'public/sporta-features.js': '2' } })
  fs.writeFileSync(path.join(sc.root, 'later.txt'), 'x'); git(sc.root, 'add', '-A'); git(sc.root, 'commit', '-q', '-m', 'local only')
  ok(hasBlocker(ready(sc), /not origin\/main .*1 commit\(s\) not pushed/), 'readiness: HEAD ahead of origin/<branch> is a blocker')

  for (const [msg, label] of [['WIP, NOT READY: catalogue', 'NOT READY'], ['tidy; do not deploy this', 'do not deploy'], ['Tidy. Do Not Deploy', 'Do Not Deploy (any case)']]) {
    const build = () => repoScenario({ msg, change: { 'public/sporta-features.js': '2' } })
    ok(hasBlocker(ready(build()), /never shipped/), `HEAD message guard: "${label}" is a blocker`)
  }
  const mm = () => repoScenario({ msg: 'WIP, NOT READY: x', change: { 'public/sporta-features.js': '2' } })
  ok(!hasBlocker(ready(mm(), [], { GATE_MUTATE: 'head-guard' }), /never shipped/), '   mutation "head-guard" makes the blocker vanish: the rule is held')

  // the commands, from what changed
  const rel = ready(repoScenario({ change: { 'public/sporta-features.js': '2', 'dropin/php-store/store.php': '2', 'dropin/php-store/new.mysql.sql': 'x', 'dropin/php-store/cron-stock.php': 'x', 'public/.htaccess': 'x', 'public/index.html': 'x', 'index.html': '2', 'public/sporta-catalogue.js': 'x', 'public/sporta-admin-brands.js': 'x', 'scripts/some-test.mjs': 'x' } }))
  const sha = rel.json.head
  const only = rel.json.readiness.only
  ok(only === '.htaccess,api,sporta-admin-brands.full.js,sporta-admin-brands.js,sporta-catalogue.js,sporta-features.js', 'readiness: --only is built from what changed (api, .htaccess, linked and on-demand add-ons; the loader pair; never index.html or tests)', only)
  ok(rel.stdout.includes(`node scripts/vps-deploy.mjs compose --ref ${sha} --only ${only}`), 'readiness prints the read-only plan command')
  ok(rel.stdout.includes(`node scripts/vps-deploy.mjs compose --apply --ref ${sha} --confirm ${sha} --only ${only}`), 'readiness prints the apply template with the SHA twice')
  ok(/live bytes -> release bytes/.test(rel.stdout) && /DEPLOY_OK/.test(rel.stdout), 'readiness reminds: read the "live bytes -> release bytes" line, success is DEPLOY_OK')
  ok(/BACKEND CHANGE \(api\)/.test(rel.stdout) && /schema diff/.test(rel.stdout), 'readiness flags a backend change: review + the live schema diff')
  ok(/MIGRATION FILE\(S\) new\.mysql\.sql \(new\)/.test(rel.stdout), 'readiness flags a new migration file')
  ok(/CRON FILE\(S\) cron-stock\.php/.test(rel.stdout) && /15 minutes/.test(rel.stdout), 'readiness flags a changed cron file (live within 15 minutes)')
  ok(/\.htaccess and api\/ change together/.test(rel.stdout), 'readiness: a changed .htaccess ships with its PHP')
  ok(/loader/.test(rel.stdout) && /70% shrink guard/.test(rel.stdout), 'readiness: the admin add-on loader pair and the shrink-guard warning')
  ok(!/index\.html/.test(String(only)) && !/some-test/.test(String(only)), 'readiness: the foreign storefront and the tooling never reach --only')
  const none = ready(repoScenario({ change: {} }))
  ok(/nothing deployable differs/.test(none.stdout) && none.json.readiness.commands === null, 'readiness: nothing changed -> no commands, says so', none.stdout.slice(-300))
  const cfgKey = ready(repoScenario({ change: { 'dropin/php-store/store.php': "<?php $v = $cfg['brand_new_switch'] ?? 1;\n" } }))
  ok(/CONFIG KEYS read by added lines: brand_new_switch/.test(cfgKey.stdout), 'readiness: a config key read by an added PHP line is named')

  // vps-deploy.mjs: the printed flags follow what the script really accepts
  const odd = repoScenario({ change: { 'public/sporta-features.js': '2' } })
  fs.writeFileSync(path.join(odd.root, 'scripts/vps-deploy.mjs'), "// a === '--apply'\nconsole.error('usage: node scripts/vps-deploy.mjs compose [--ref R] [--go]')\n")
  git(odd.root, 'add', '-A'); git(odd.root, 'commit', '-q', '-m', 'odd'); git(odd.root, 'push', '-q', 'origin', 'main')
  const o2 = ready(odd)
  ok(/does not accept --ref, --confirm, --only/.test(o2.stdout) && /What it accepts: node scripts\/vps-deploy\.mjs compose \[--ref R\] \[--go\]/.test(o2.stdout) && !/compose --apply --ref/.test(o2.stdout) && o2.json.readiness.commands === null, 'readiness: when vps-deploy.mjs lost a flag the gate says so, prints the real usage line and prints no command the script would refuse', o2.stdout.slice(-500))
}
// the gate never starts vps-deploy.mjs
{
  const sc = repoScenario({ change: { 'public/sporta-features.js': '2' } })
  const spawnLog = path.join(TMP, 'spawns.log')
  const r = runGate(sc, [], { GATE_SPAWN_LOG: spawnLog })
  const r2 = runGate(sc, ['--deploy-check'], { GATE_SPAWN_LOG: spawnLog })
  const log = fs.existsSync(spawnLog) ? fs.readFileSync(spawnLog, 'utf8') : ''
  ok(r.code === 0 && r.stdout.includes('compose --apply --ref') && r2.stdout.includes('compose --apply --ref'), 'the apply command IS printed (green run and --deploy-check)')
  ok(log.length > 0 && !/vps-deploy/.test(log), 'the spawn log of a green run and of --deploy-check never names vps-deploy', log.split('\n').slice(0, 3).join(' '))
  ok(!fs.existsSync(path.join(sc.root, 'VPS-DEPLOY-WAS-RUN')), 'the fake vps-deploy.mjs in the tree was never run')
  const src = fs.readFileSync(GATE, 'utf8').split('\n')
  const mentions = src.map((l, i) => ({ l, i })).filter((x) => /vps-deploy/.test(x.l) && !/^\s*\/\//.test(x.l))
  const bad = mentions.filter((x) => /spawn|exec|runSync|runSuite|\bgit\(|import\(|import /.test(x.l))
  ok(bad.length === 0 && !/(spawn|runSync|runSuite|execFile|execSync)\([^)]*vps-deploy/.test(src.join('\n')), 'release-gate.mjs only prints or reads vps-deploy.mjs: no spawn, exec or import names it', bad.map((x) => x.i + 1 + ': ' + x.l.trim()).join(' | '))
}
// mapPath / summariseRelease, unit
{
  const b = BASE('x', { heldBack: ['logo.png'] })
  const k = (p) => mapPath(p, b)
  ok(k('dropin/php-store/store.php').scope === 'api' && k('dropin/php-knet/knet.php').scope === 'knet' && k('dropin/php-cbk/pay.php').scope === 'pay', 'mapPath: dropin folders -> api / knet / pay')
  ok(k('public/.htaccess').scope === '.htaccess' && k('public/sporta-features.js').scope === 'sporta-features.js' && k('public/sporta-catalogue.js').kind === 'ondemand', 'mapPath: .htaccess, a linked add-on, an on-demand add-on')
  ok(k('public/sporta-admin-brands.js').scope === 'sporta-admin-brands.js,sporta-admin-brands.full.js', 'mapPath: the admin add-on ships as the loader pair')
  ok(k('public/robots.txt').scope === null && k('public/sitemap-pages.xml').scope === null && k('src/App.jsx').scope === null && k('scripts/x.mjs').scope === null, 'mapPath: foreign storefront files, src and tooling never ship')
  ok(k('public/logo.png').flags.includes('held-back') && k('public/sporta-newthing.css').kind === 'public-other', 'mapPath: held-back and unknown public files are flagged')
  const s = summariseRelease([k('dropin/php-knet/knet.php')], {})
  ok(s.attention.some((a) => /MONEY PATH/.test(a)), 'summariseRelease: knet/pay is a money-path flag')
}

// ================================================================== G. the owner's rule: no CI
// The checker, proved on temp trees, then run on the real repo.
function ciViolations(repoRoot) {
  const bad = []
  const tracked = sh(repoRoot, 'git', ['ls-files']).stdout.split('\n').filter(Boolean)
  const all = new Set(tracked)
  for (const d of ['.github', '.gitlab', '.circleci', '.husky', '.githooks']) if (fs.existsSync(path.join(repoRoot, d))) all.add(d + '/')
  for (const f of all) {
    if (/(^|\/)\.github(\/|$)/.test(f) || /(^|\/)(\.gitlab-ci\.yml|\.travis\.yml|Jenkinsfile|azure-pipelines\.yml|bitbucket-pipelines\.yml|appveyor\.yml|buildkite\.ya?ml|cloudbuild\.ya?ml|\.drone\.yml)$/.test(f) || /(^|\/)(\.circleci|\.husky|\.githooks|\.gitlab)(\/|$)/.test(f)) bad.push(f)
  }
  const hooks = path.join(repoRoot, '.git', 'hooks')
  if (fs.existsSync(hooks)) for (const h of fs.readdirSync(hooks)) {
    if (h.endsWith('.sample')) continue
    if (/vps-deploy|deploy/.test(fs.readFileSync(path.join(hooks, h), 'utf8'))) bad.push(`.git/hooks/${h} (a hook that deploys)`)
  }
  return bad
}
{
  const t = path.join(TMP, 'ci-fixture')
  fs.mkdirSync(t, { recursive: true })
  git(t, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(t, 'a.txt'), '1'); git(t, 'add', '-A'); git(t, 'commit', '-q', '-m', 'x')
  ok(ciViolations(t).length === 0, 'CI checker: a clean tree has no violation')
  fs.mkdirSync(path.join(t, '.github/workflows'), { recursive: true }); fs.writeFileSync(path.join(t, '.github/workflows/ci.yml'), 'on: push\n')
  ok(ciViolations(t).some((x) => x.includes('.github')), 'CI checker: finds a .github/ workflow directory')
  fs.rmSync(path.join(t, '.github'), { recursive: true })
  fs.writeFileSync(path.join(t, '.gitlab-ci.yml'), 'x: 1\n'); git(t, 'add', '-A')
  ok(ciViolations(t).some((x) => x.includes('.gitlab-ci.yml')), 'CI checker: finds a hosted-CI config file')
  git(t, 'rm', '-q', '-f', '.gitlab-ci.yml')
  fs.writeFileSync(path.join(t, '.git/hooks/post-commit'), '#!/bin/sh\nnode scripts/vps-deploy.mjs compose --apply\n')
  ok(ciViolations(t).some((x) => x.includes('a hook that deploys')), 'CI checker: finds a git hook that deploys')
  const repo = sh(HERE, 'git', ['rev-parse', '--show-toplevel']).stdout.trim()
  const bad = ciViolations(repo)
  ok(bad.length === 0, `THE OWNER'S RULE (CLAUDE.md item 2): there is no CI in this repo and nothing deploys from one. Found: ${bad.join(', ')}. Delete it: the release gate is local (npm run gate) and deploying is the owner's explicit "deploy" through scripts/vps-deploy.mjs`, bad.join(', '))
}

// ================================================================== H. the real data files
{
  const pkg = JSON.parse(fs.readFileSync(path.join(WEB, 'package.json'), 'utf8')).scripts
  const dir = path.join(WEB, 'ops/release')
  const reg = JSON.parse(fs.readFileSync(path.join(dir, 'gate.config.json'), 'utf8'))
  const kn = JSON.parse(fs.readFileSync(path.join(dir, 'known-failures.json'), 'utf8'))
  const bl = JSON.parse(fs.readFileSync(path.join(dir, 'live-baseline.json'), 'utf8'))
  const suiteNames = reg.suites.map((s) => s.name)
  ok(new Set(suiteNames).size === suiteNames.length, 'registry: no suite is listed twice')
  const nig = new Set(reg.not_in_gate.map((x) => x.name))
  ok(reg.not_in_gate.every((x) => x.reason && x.reason.length > 10), 'registry: every not_in_gate entry has a reason')
  const unlisted = Object.keys(pkg).filter((k) => k.startsWith('test:')).map((k) => k.slice(5)).filter((n) => !suiteNames.includes(n) && !nig.has(n))
  ok(unlisted.length === 0, 'registry: every test:* script is in the gate or in not_in_gate with its reason', unlisted.join(', '))
  const ghosts = suiteNames.filter((n) => !pkg['test:' + n] && n !== 'release-gate' && !reg.suites.find((s) => s.name === n)?.command)
  ok(ghosts.length === 0, 'registry: every suite is a real test:* script', ghosts.join(', '))
  ok(reg.suites.every((s) => ['none', 'rig', 'browser', 'rig+browser'].includes(s.needs)), 'registry: needs is one of none | rig | browser | rig+browser')
  ok(reg.suites.every((s) => s.timeoutSec >= 120), 'registry: every timeout is at least 120 s')
  ok(reg.suites.filter((s) => s.needs.includes('rig')).every((s) => s.parallelSafe === false), 'registry: a rig suite is never parallelSafe')
  ok(reg.suites.filter((s) => s.quick).every((s) => !s.needs.includes('rig')), 'registry: a quick suite needs no rig')
  ok(reg.suites.every((s) => Array.isArray(s.triggers) && s.triggers.length > 0), 'registry: every suite has trigger globs')
  const lane = Object.values(reg.lanes).flat()
  ok(lane.every((n) => suiteNames.includes(n)), 'registry: every lane member is a suite')
  const knownNames = kn.suites.map((k) => k.suite)
  ok(knownNames.every((n) => suiteNames.includes(n)), 'known-failures: every entry is a suite of the registry', knownNames.filter((n) => !suiteNames.includes(n)).join(', '))
  ok(new Set(knownNames).size === knownNames.length, 'known-failures: no suite twice')
  ok(kn.suites.every((k) => k.reason && k.evidence && k.since && typeof k.expect?.fail === 'number'), 'known-failures: every entry has a reason, evidence, a date and a count')
  ok(kn.suites.every((k) => (k.expect.fail === 0 ? !!k.expect.contains : (k.expect.names ?? []).length > 0)), 'known-failures: an entry names its failing checks (or, for a crash, the text it prints)')
  for (const n of ['file-names', 'unknown-files', 'xss-config', 'vps-preflight', 'admin-social', 'admin-shipping', 'admin-save', 'abandoned-ui', 'race-client', 'admin-trim-release', 'site-content', 'storefront-polish', 'mobile-1112', 'mobile-1112b', 'sog-1112', 'admin-buttons', 'fonts-used', 'vps-deploy', 'checkout-split', 'sizes-weight', 'grid']) ok(knownNames.includes(n), `known-failures: ${n} is recorded`)
  const counts = { 'file-names': 21, 'unknown-files': 4, 'xss-config': 3, 'vps-preflight': 1, 'admin-social': 2, 'admin-shipping': 1, 'admin-save': 28, 'abandoned-ui': 6, 'race-client': 4, 'admin-trim-release': 1, 'site-content': 1, 'storefront-polish': 8, 'mobile-1112': 1, 'mobile-1112b': 1, grid: 3 }
  ok(Object.entries(counts).every(([n, c]) => kn.suites.find((k) => k.suite === n)?.expect.fail === c), 'known-failures: the recorded counts are the ones of the 2026-11-19 records')
  const refs = [bl.ref, bl.api?.ref, bl.addons?.default?.ref, ...Object.values(bl.api?.files ?? {}).map((f) => f.ref), ...Object.values(bl.addons?.files ?? {}).map((f) => f.ref)]
  const repo = sh(WEB, 'git', ['rev-parse', '--show-toplevel']).stdout.trim()
  const unresolved = refs.filter((r) => !r || sh(repo, 'git', ['cat-file', '-e', r + '^{commit}']).status !== 0)
  ok(unresolved.length === 0, 'live-baseline: every ref is a commit of this repository', unresolved.join(', '))
  ok(Array.isArray(bl.linked) && bl.linked.includes('sporta-features.js') && bl.onDemand.includes('sporta-admin-brands.full.js'), 'live-baseline: the linked and on-demand add-on lists are there')
}

// ================================================================== I. the review fixes (F1-F12)
// F1: only a FULL green run, for this exact HEAD, can be READY
{
  const build = () => repoScenario({ change: { 'public/sporta-features.js': '2' } })
  // the whole gate, run on a clean pushed tree: GREEN + READY
  let sc = build()
  let r = runGate(sc)
  ok(r.code === 0 && r.json.full === true && r.json.readiness.ready === true && /DEPLOY READINESS: READY/.test(r.stdout) && fs.existsSync(path.join(sc.root, '.gate', 'last-full.json')), 'F1: a full green run is READY and leaves .gate/last-full.json', r.stdout.slice(-300))
  // partial runs: --only, --quick, --changed are GREEN but never READY, and say so
  for (const args of [['--only', 's'], ['--quick'], ['--changed']]) {
    sc = build()
    r = runGate(sc, args)
    ok(r.json.verdict !== 'RED' && r.json.full !== true && !/DEPLOY READINESS: READY/.test(r.stdout) && (r.json.verdict !== 'GREEN' || (/PARTIAL: not a release gate/.test(r.stdout) && r.json.readiness.ready === false)), `F1: ${args.join(' ')} is never READY`, r.stdout.slice(-400))
  }
  sc = build()
  r = runGate(sc, ['--only', 's'])
  ok(/PARTIAL: not a release gate \(--only\)/.test(r.stdout) && !fs.existsSync(path.join(sc.root, '.gate', 'last-full.json')) && r.json.readiness.blockers.some((b) => /partial/.test(b)), 'F1: a partial run names itself, leaves no full record and blocks readiness', r.stdout.slice(-400))
  const mut = runGate(build(), ['--only', 's'], { GATE_MUTATE: 'partial-run' })
  ok(mut.json.readiness?.ready === true, '   mutation "partial-run" makes a --only run READY: the rule is held')
  // a skipped rig suite makes the run partial
  const absent = { ports: [], dbCheck: [process.execPath, '-e', 'process.exit(1)'], start: [process.execPath, '-e', '0'], clearRateLimit: [process.execPath, '-e', '0'] }
  const sk = scenario({ suites: [{ reg: { name: 's' }, run: { lines: PASS_LINES } }, { reg: { name: 'rg', needs: 'rig', parallelSafe: false }, run: { lines: PASS_LINES } }], rig: absent, git: true })
  r = runGate(sk, ['--no-sandbox'])
  ok(r.json.verdict === 'GREEN' && r.json.full === false && /1 suite\(s\) SKIPPED/.test(r.stdout) && !/DEPLOY READINESS: READY/.test(r.stdout), 'F1: a SKIPPED rig suite makes the run partial, not READY', r.stdout.slice(-400))
  // --deploy-check: needs a full green record for exactly this HEAD
  r = ready(build(), [], {}, null)
  ok(r.code === 3 && hasBlocker(r, /no full gate record/), 'F1: --deploy-check with no gate record is NOT READY (exit 3)', r.stdout.slice(-300))
  const old = build()
  writeRecord(old)
  fs.writeFileSync(path.join(old.root, 'later.txt'), 'x'); git(old.root, 'add', '-A'); git(old.root, 'commit', '-q', '-m', 'after the gate'); git(old.root, 'push', '-q', 'origin', 'main')
  r = runGate(old, ['--deploy-check'])
  ok(r.code === 3 && hasBlocker(r, /not for HEAD/), 'F1: a gate record of an older HEAD does not make this HEAD READY', r.stdout.slice(-300))
  r = ready(build(), [], {}, { verdict: 'RED' })
  ok(r.code === 3 && hasBlocker(r, /not a full green run/), 'F1: a RED record is not READY')
  r = ready(build(), [], {}, { full: false })
  ok(r.code === 3 && hasBlocker(r, /not a full green run/), 'F1: a partial record is not READY')
  r = ready(build(), [], { GATE_MUTATE: 'gate-record' }, null)
  ok(r.code === 0, '   mutation "gate-record" makes a missing record READY: the rule is held')
}
// F2: a known failure that CRASHES, or that stopped running its checks, is a REGRESSION
{
  const KMIN = { suite: 's', since: 't', reason: 'r', evidence: 'e', expect: { exit: 1, fail: 21, minOk: 50, names: ['alpha'] } }
  ruleCheck('F2: a known-failing suite that crashes (exit 1, no FAIL line) is a REGRESSION, not KNOWN', () => scenario({ ...one({}, { lines: ['TypeError: x is not a function'], exit: 1 }), known: [KMIN] }),
    (r) => r.verdict('s') === 'REGRESSION' && /no FAIL line/.test(r.stdout), 'known-crash')
  ruleCheck('F2: a known-failing suite whose ok count fell below the recorded minimum is a REGRESSION', () => scenario({ ...one({}, { lines: ['ok a', 'FAIL alpha thing', '1 passed, 1 failed'], exit: 1 }), known: [KMIN] }),
    (r) => r.verdict('s') === 'REGRESSION' && /below the recorded minimum 50/.test(r.stdout), 'known-min-ok')
  ruleCheck('F2: ... and at or above the minimum it stays KNOWN', () => scenario({ ...one({}, { lines: ['ok a', 'FAIL alpha thing', '60 passed, 1 failed'], exit: 1 }), known: [KMIN] }),
    (r) => r.verdict('s') === 'KNOWN')
  const real = JSON.parse(fs.readFileSync(path.join(WEB, 'ops/release/known-failures.json'), 'utf8')).suites
  ok(real.filter((k) => k.expect.fail > 0).every((k) => k.expect.minOk > 0 || ['fonts-used', 'checkout-split', 'vps-preflight', 'abandoned-ui', 'race-client', 'xss-config', 'admin-trim-release', 'grid', 'admin-save'].includes(k.suite) || k.expect.minOk === undefined), 'F2: the real known-failures entries that carry minOk carry a positive one')
  ok(['file-names', 'unknown-files', 'admin-save', 'storefront-polish'].every((n) => real.find((k) => k.suite === n)?.expect.minOk > 0), 'F2: the big known-failing suites record an ok minimum')
}
// F3: an empty selection is never green
{
  let r = runGate(SEL(), ['--only', ','])
  ok(r.code === 2 && /names no suite/.test(r.stderr), 'F3: --only "," (an empty list) is a usage error, exit 2', r.stderr)
  r = runGate(SEL(), ['--only', ''])
  ok(r.code === 2, 'F3: --only "" is a usage error, exit 2', r.stderr)
  const none = scenario({ suites: [{ reg: { name: 'x', quick: false }, run: { lines: PASS_LINES } }] })
  r = runGate(none, ['--quick'])
  ok(r.code === 2 && /NOTHING WAS RUN/.test(r.stdout) && !/GATE GREEN/.test(r.stdout) && r.json.verdict === 'NOTHING_RUN', 'F3: --quick with no quick suite: NOTHING WAS RUN, exit 2, not green', r.stdout.slice(-300))
  const ch = scenario({ suites: [{ reg: { name: 'feat', triggers: ['public/f*.js'] }, run: { lines: PASS_LINES } }], git: true, files: { 'public/f1.js': '1' } })
  fs.writeFileSync(path.join(ch.root, 'baseline.json'), JSON.stringify({ schema: 1, ref: git(ch.root, 'rev-parse', 'HEAD').stdout.trim() }))
  r = runGate(ch, ['--changed'])
  ok(r.code === 0 && /NOTHING WAS RUN/.test(r.stdout) && !/GATE GREEN/.test(r.stdout) && !/READY/.test(r.stdout.replace(/NOT READY/g, '')), 'F3: --changed with nothing to run says NOTHING WAS RUN (no GATE GREEN, no READY)', r.stdout.slice(-300))
}
// F4: --changed follows what a suite's script imports
{
  const d = path.join(TMP, 'deps')
  fs.mkdirSync(path.join(d, 'scripts', 'lib'), { recursive: true })
  fs.writeFileSync(path.join(d, 'scripts/a-test.mjs'), "import { x } from './helper.mjs'\nconst m = await import('./lib/dyn.mjs')\n")
  fs.writeFileSync(path.join(d, 'scripts/helper.mjs'), "import './deep.mjs'\n")
  fs.writeFileSync(path.join(d, 'scripts/deep.mjs'), 'export const y = 1\n')
  fs.writeFileSync(path.join(d, 'scripts/lib/dyn.mjs'), 'export const z = 1\n')
  const cl = scriptClosure(d, 'scripts/a-test.mjs').sort()
  ok(cl.join(',') === 'scripts/a-test.mjs,scripts/deep.mjs,scripts/helper.mjs,scripts/lib/dyn.mjs', 'F4: scriptClosure follows static, dynamic and transitive local imports', cl.join(','))
  const reg = { suites: [{ name: 'a', needs: 'none', triggers: ['nothing/**'] }, { name: 'b', needs: 'none', triggers: ['nothing/**'] }] }
  const pick = (f) => [...triggeredSuites(reg, [f], (n) => (n === 'a' ? cl : n === 'b' ? ['scripts/b-test.mjs'] : null))].join(',')
  ok(pick('scripts/helper.mjs') === 'a' && pick('scripts/deep.mjs') === 'a' && pick('scripts/b-test.mjs') === 'b', 'F4: a changed shared helper selects the suites that import it, and only them')
  // the real repo: build-addon-css.mjs is imported by suites whose own script did not change
  const scriptOf = scriptOfSuite(WEB)
  const realReg = JSON.parse(fs.readFileSync(path.join(WEB, 'ops/release/gate.config.json'), 'utf8'))
  const hit = triggeredSuites(realReg, ['scripts/build-addon-css.mjs'], scriptOf)
  const importers = realReg.suites.map((s) => s.name).filter((n) => { const sc = scriptOf(n); return sc && sc.length > 1 && sc.includes('scripts/build-addon-css.mjs') })
  ok(importers.length >= 3 && importers.every((n) => hit.has(n)), `F4: scripts/build-addon-css.mjs selects its ${importers.length} importing suites in the real registry`, importers.join(','))
}
// F5: Ctrl-C / SIGTERM stops the suites too
{
  const run = async (env) => {
    const pidfile = path.join(TMP, `suitepid-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const sc = scenario(one({ timeoutSec: 60 }, { hang: true, pidfile }))
    const child = spawn(process.execPath, [GATE, '--root', sc.root, '--config', sc.cfg, '--known', path.join(sc.root, 'known.json'), '--baseline', path.join(sc.root, 'baseline.json'), '--outdir', path.join(sc.root, 'out')], { env: { ...process.env, ...env }, stdio: 'ignore' })
    const t0 = Date.now()
    while (!fs.existsSync(pidfile) && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 50))
    const suitePid = Number(fs.readFileSync(pidfile, 'utf8'))
    child.kill('SIGINT')
    const code = await new Promise((r) => { const t = setTimeout(() => r('hung'), 15000); child.on('exit', (c) => { clearTimeout(t); r(c) }) })
    await new Promise((r) => setTimeout(r, 300))
    let alive = true
    try { process.kill(suitePid, 0) } catch { alive = false }
    try { if (alive && /^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${suitePid}/stat`, 'utf8'))) alive = false } catch { /* no /proc: kill(0) decides */ } // a zombie is dead
    if (alive) { try { process.kill(suitePid, 'SIGKILL') } catch { /* gone */ } }
    return { code, alive }
  }
  const a = await run({})
  ok(a.code === 130 && !a.alive, 'F5: SIGINT on the gate stops the running suite and exits 130', JSON.stringify(a))
  const b = await run({ GATE_MUTATE: 'signals' })
  ok(b.alive, '   mutation "signals" (no handler) leaves the suite running: the rule is held', JSON.stringify(b))
}
// F6 / F7 / F8: the readiness diff
{
  // F6: a baseline commit this clone does not have is a blocker, never "nothing to deploy"
  const sc = repoScenario({ change: { 'public/sporta-features.js': '2' } })
  fs.writeFileSync(path.join(sc.root, 'baseline.json'), JSON.stringify(BASE('1234567890abcdef1234567890abcdef12345678')))
  const r = ready(sc)
  ok(r.code === 3 && hasBlocker(r, /cannot read the diff against the live baseline/) && !/nothing deployable differs/.test(r.stdout) && /UNKNOWN/.test(r.stdout), 'F6: a missing baseline commit is a blocker and never reads "nothing to deploy"', r.stdout.slice(-400))
  // F7: a file whose own ref is OLDER than the baseline ref is still listed
  const s7 = repoScenario({ change: { 'public/sporta-catalogue.js': 'new' } })
  const A = git(s7.root, 'rev-parse', 'HEAD~1').stdout.trim()
  const B = git(s7.root, 'rev-parse', 'HEAD').stdout.trim()
  fs.writeFileSync(path.join(s7.root, 'baseline.json'), JSON.stringify(BASE(B, { addons: { default: { ref: B }, files: { 'public/sporta-catalogue.js': { ref: A } } } })))
  const r7 = ready(s7)
  ok(/sporta-catalogue\.js/.test(String(r7.json.readiness.only)), 'F7: a file with a per-file ref older than the baseline ref is read against its own ref', String(r7.json.readiness.only))
  // F8: the admin add-on is read against the ref recorded under its .full.js name
  const s8 = repoScenario({ change: { 'public/sporta-admin-brands.js': 'new' } })
  const A8 = git(s8.root, 'rev-parse', 'HEAD~1').stdout.trim()
  const B8 = git(s8.root, 'rev-parse', 'HEAD').stdout.trim()
  fs.writeFileSync(path.join(s8.root, 'baseline.json'), JSON.stringify(BASE(A8, { addons: { default: { ref: A8 }, files: { 'public/sporta-admin-brands.full.js': { ref: B8 } } } })))
  const r8 = ready(s8)
  ok(!/sporta-admin-brands/.test(String(r8.json.readiness.only ?? '')), 'F8: the admin add-on whose .full.js ref is current is not listed as pending', String(r8.json.readiness.only))
}
// F9: no ready-to-paste apply command next to a NOT READY
{
  const r = ready(repoScenario({ dirty: true, change: { 'public/sporta-features.js': '2' } }))
  ok(r.code === 3 && !/compose --apply/.test(r.stdout) && !/compose --ref/.test(r.stdout) && /withheld: NOT READY/.test(r.stdout) && r.json.readiness.commands === null, 'F9: a NOT READY verdict prints no plan or apply command', r.stdout.slice(-500))
}
// F10: the output folder is pruned and unique
{
  const sc = scenario(one({}, { lines: PASS_LINES }))
  const gdir = path.join(sc.root, '.gate')
  fs.mkdirSync(gdir, { recursive: true })
  for (let i = 0; i < 13; i++) { const d = path.join(gdir, `20250101T0000${String(i).padStart(2, '0')}Z-1`); fs.mkdirSync(d); const t = new Date(2025, 0, 1, 0, i); fs.utimesSync(d, t, t) }
  const p = spawnSync(process.execPath, [GATE, '--root', sc.root, '--config', sc.cfg, '--known', path.join(sc.root, 'known.json'), '--baseline', path.join(sc.root, 'baseline.json')], { encoding: 'utf8' })
  const dirs = fs.readdirSync(gdir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  ok(p.status === 0 && dirs.length === 10 && dirs.some((n) => /^\d{8}T\d{6}Z-\d+$/.test(n)) && !dirs.includes('20250101T000000Z-1'), 'F10: the newest 10 run folders are kept (oldest removed) and the new one carries the pid', dirs.join(','))
}
// F12: the rig's database client must be the local one
{
  const sc = scenario({ ...one({ needs: 'rig', parallelSafe: false }, { lines: PASS_LINES }) })
  const r = runGate(sc, [], { MYSQL_HOST: 'db.example.invalid' })
  ok(r.code === 2 && /MYSQL_HOST is set/.test(r.stderr), 'F12: MYSQL_HOST set -> exit 2 before any rig suite or rate_limit clear runs', r.stderr)
  ok(JSON.parse(fs.readFileSync(path.join(WEB, 'ops/release/gate.config.json'), 'utf8')).rig.clearRateLimit.includes('--protocol=socket'), 'F12: the real registry clears rate_limit over the local socket only')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
