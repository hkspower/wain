#!/usr/bin/env node
// THE RELEASE GATE: the whole "CI" of this project, local and honest, in one command.
//
//   npm run gate            the full gate (every measured suite, the sandbox rig made sure of first)
//   npm run gate:quick      the static and fast suites only (a few minutes, no rig)
//   npm run gate:check      deploy readiness only (read-only; prints the plan / apply commands, runs none of them)
//
// WHY IT EXISTS AND WHAT IT IS NOT. For two days the release gate was a person: lanes of `npm run test:*` against the
// sandbox rig, a comparison with a baseline of known failures, reruns of flaky browser suites, then the deploy plan. This
// is that, written down. It is NOT continuous integration: CLAUDE.md (owner, saved for all time) says nothing deploys from
// CI, there is no .github/ and none is to be created. This script never deploys, never contacts the live site and never
// runs scripts/vps-deploy.mjs: it only PRINTS the commands a person starts after an explicit "deploy"
// (scripts/release-gate-test.mjs asserts that, and that the repo has no CI config).
//
//   node scripts/release-gate.mjs [options]
//     --quick               only suites flagged quick in ops/release/gate.config.json (no rig)
//     --only a,b            exactly these suites (names without "test:"; "lane:<name>" expands a lane); wins over --quick
//     --changed[=<ref>]     only suites whose trigger globs match the files changed since <ref> (default: the ref of
//                           ops/release/live-baseline.json) plus uncommitted and untracked files; errs on running more
//     --since <ref>         the baseline ref for --changed and for the readiness diff, instead of live-baseline.json's
//     --jobs N              parallel lanes for suites marked parallelSafe (default 2). Rig suites are ALWAYS serial
//     --rerun-flakes N      reruns of a failing suite, each alone and serial after the lanes (default: 2 for browser
//                           suites, 1 for the others; 0 turns reruns off)
//     --include-unmeasured  also run suites the registry has no baseline measurement for (skipped by default)
//     --json <file>         write the machine-readable result there
//     --no-sandbox          never start the rig (suites that need it and find it absent are SKIPPED)
//     --list                print the registry (what each option would run) and exit
//     --deploy-check        only the deploy-readiness section
//     --config/--known/--baseline <file>, --outdir <dir>, --root <dir>   point the gate at other data (the gate's own suite does)
//     --help
//
// EXIT CODE: 0 = no regression (GATE GREEN); 1 = at least one REGRESSION; 2 = the gate itself could not run (bad option,
// the rig would not come up); 3 = --deploy-check alone and the tree is NOT ready.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyAttempt, mapPath, mdTable, mutated, MUT, parseOutput, settle, summariseRelease, triggeredSuites, utcStamp,
} from './lib/release-gate-core.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.resolve(HERE, '..')

// ------------------------------------------------------------------ options
export function parseArgs(argv) {
  const o = {
    quick: false, only: null, changed: false, changedRef: null, since: null, jobs: 2, rerun: null, json: null, noSandbox: false,
    list: false, deployCheck: false, help: false, unmeasured: false, outdir: null, config: null, known: null, baseline: null, root: null,
  }
  const need = (i, name) => { if (i >= argv.length || argv[i].startsWith('--')) throw new Error(`${name} needs a value`); return argv[i] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--quick') o.quick = true
    else if (a === '--only') o.only = need(++i, '--only').split(',').map((s) => s.trim().replace(/^test:/, '')).filter(Boolean)
    else if (a === '--changed') o.changed = true
    else if (a.startsWith('--changed=')) { o.changed = true; o.changedRef = a.slice(10) }
    else if (a === '--since') o.since = need(++i, '--since')
    else if (a === '--jobs') { o.jobs = Number(need(++i, '--jobs')); if (!(o.jobs >= 1)) throw new Error('--jobs needs a number of 1 or more') }
    else if (a === '--rerun-flakes') { o.rerun = Number(need(++i, '--rerun-flakes')); if (!(o.rerun >= 0)) throw new Error('--rerun-flakes needs 0 or more') }
    else if (a === '--json') o.json = need(++i, '--json')
    else if (a === '--no-sandbox') o.noSandbox = true
    else if (a === '--list') o.list = true
    else if (a === '--deploy-check') o.deployCheck = true
    else if (a === '--include-unmeasured') o.unmeasured = true
    else if (a === '--outdir') o.outdir = need(++i, '--outdir')
    else if (a === '--config') o.config = need(++i, '--config')
    else if (a === '--known') o.known = need(++i, '--known')
    else if (a === '--baseline') o.baseline = need(++i, '--baseline')
    else if (a === '--root') o.root = need(++i, '--root')
    else if (a === '--help' || a === '-h') o.help = true
    else throw new Error(`unknown option ${a} (see --help)`)
  }
  return o
}

const HELP = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 36).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')

// ------------------------------------------------------------------ process helpers
// Every child process of the gate starts here, so the gate's own suite can read the log (GATE_SPAWN_LOG) and prove
// that nothing named vps-deploy is ever started.
function logSpawn(cmd, args) {
  const f = process.env.GATE_SPAWN_LOG
  if (f) { try { fs.appendFileSync(f, JSON.stringify({ cmd, args }) + '\n') } catch { /* the log is a test aid */ } }
}
function runSync(cmd, args, cwd) {
  logSpawn(cmd, args)
  return new Promise((resolve) => {
    let out = ''
    let child
    try { child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { return resolve({ code: 127, out: String(e.message) }) }
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', (e) => resolve({ code: 127, out: out + String(e.message) }))
    child.on('close', (code) => resolve({ code: code ?? 1, out }))
  })
}
const git = async (cwd, ...args) => { const r = await runSync('git', args, cwd); return { ...r, out: r.out.trim() } }

// One suite run: a shell, its own process group (so a timeout kills the browsers it started), output to a log file.
function runSuite(command, cwd, logFile, timeoutSec) {
  logSpawn('sh', ['-c', command])
  return new Promise((resolve) => {
    const t0 = Date.now()
    const stream = fs.createWriteStream(logFile)
    let timedOut = false
    const child = spawn('sh', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } })
    child.stdout.pipe(stream, { end: false })
    child.stderr.pipe(stream, { end: false })
    const kill = (sig) => { try { process.kill(-child.pid, sig) } catch { /* already gone */ } }
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 5000).unref() }, timeoutSec * 1000)
    const done = (code, err) => {
      clearTimeout(timer)
      if (err) stream.write(`\n[gate] could not start: ${err}\n`)
      stream.end(() => {
        let text = ''
        try { const b = fs.readFileSync(logFile); text = b.subarray(Math.max(0, b.length - 8 * 1024 * 1024)).toString('utf8') } catch { /* empty */ }
        resolve({ exit: timedOut ? null : (code ?? 1), timedOut, text, seconds: Math.round((Date.now() - t0) / 100) / 10, startedAt: t0, endedAt: Date.now() })
      })
    }
    child.on('error', (e) => done(127, e.message))
    child.on('close', (code) => done(code))
  })
}

const tcpUp = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: '127.0.0.1' })
  const end = (v) => { s.destroy(); resolve(v) }
  s.setTimeout(1500, () => end(false))
  s.on('connect', () => end(true))
  s.on('error', () => end(false))
})

// ------------------------------------------------------------------ data files
const readJson = (f, what) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { throw new Error(`cannot read ${what} (${f}): ${e.message}`) }
}
export function loadData(o, webDir) {
  const dir = path.join(webDir, 'ops/release')
  const registry = readJson(o.config ?? path.join(dir, 'gate.config.json'), 'the registry')
  const known = readJson(o.known ?? path.join(dir, 'known-failures.json'), 'known-failures.json')
  const baselineFile = o.baseline ?? path.join(dir, 'live-baseline.json')
  const baseline = fs.existsSync(baselineFile) ? readJson(baselineFile, 'live-baseline.json') : null
  const knownBy = new Map((known.suites ?? []).map((k) => [k.suite, k]))
  return { registry, known, knownBy, baseline }
}

// ------------------------------------------------------------------ selection
export function scriptOfSuite(webDir) {
  let scripts = {}
  try { scripts = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8')).scripts ?? {} } catch { /* a temp tree has none */ }
  return (name) => {
    const m = String(scripts[`test:${name}`] ?? '').match(/(?:node|php) (scripts\/[^ ]+)/)
    return m ? m[1] : null
  }
}

export function select(registry, o, changedFiles, scriptOf) {
  const by = new Map(registry.suites.map((s) => [s.name, s]))
  const notIn = new Map((registry.not_in_gate ?? []).map((x) => [x.name, x.reason]))
  let names
  if (o.only) {
    names = []
    for (const n of o.only) {
      if (n.startsWith('lane:')) {
        const lane = registry.lanes?.[n.slice(5)]
        if (!lane) throw new Error(`unknown lane ${n} (lanes: ${Object.keys(registry.lanes ?? {}).join(', ')})`)
        names.push(...lane)
      } else if (by.has(n)) names.push(n)
      else if (notIn.has(n)) throw new Error(`${n} is not in the gate: ${notIn.get(n)}`)
      else throw new Error(`unknown suite ${n} (see --list)`)
    }
    names = [...new Set(names)]
  } else {
    let pool = registry.suites.filter((s) => (o.unmeasured || s.measured !== false) && s.disabled !== true)
    if (o.quick) pool = pool.filter((s) => s.quick)
    if (o.changed) {
      const hit = triggeredSuites(registry, changedFiles, scriptOf)
      pool = pool.filter((s) => hit.has(s.name))
    }
    names = pool.map((s) => s.name)
  }
  return names.map((n) => by.get(n))
}

const isRig = (s) => s.needs === 'rig' || s.needs === 'rig+browser'
const isBrowser = (s) => s.needs === 'browser' || s.needs === 'rig+browser'
const inPool = (s) => !isRig(s) && s.parallelSafe === true

// ------------------------------------------------------------------ the rig
async function ensureRig(registry, o, webDir, say) {
  const rig = registry.rig ?? {}
  const check = async () => {
    for (const p of rig.ports ?? []) if (!(await tcpUp(p))) return `port ${p} is not answering`
    if (rig.dbCheck?.length) {
      const r = await runSync(rig.dbCheck[0], rig.dbCheck.slice(1), webDir)
      if (r.code !== 0) return `the database is not reachable (${rig.dbCheck.join(' ')} exited ${r.code})`
    }
    return null
  }
  let problem = await check()
  if (!problem) { say('rig: up (database and test servers answer)'); return { up: true } }
  if (o.noSandbox) { say(`rig: absent (${problem}); --no-sandbox, so suites that need it are SKIPPED`); return { up: false, problem } }
  say(`rig: ${problem}; starting it (${(rig.start ?? ['npm', 'run', 'sandbox']).join(' ')})`)
  const r = await runSync((rig.start ?? ['npm', 'run', 'sandbox'])[0], (rig.start ?? ['npm', 'run', 'sandbox']).slice(1), webDir)
  const bang = r.out.split('\n').filter((l) => l.startsWith('!!'))
  problem = await check()
  if (problem) {
    const e = new Error(`the sandbox rig would not come up (${problem})\n${(bang.length ? bang : r.out.trim().split('\n').slice(-3).map((l) => '!! ' + l)).join('\n')}`)
    e.exitCode = 2
    throw e
  }
  say('rig: started')
  return { up: true }
}
async function clearRateLimit(registry, webDir) {
  const c = registry.rig?.clearRateLimit
  if (!c?.length) return
  await runSync(c[0], c.slice(1), webDir) // best effort: a missing table must not fail a suite that does not use it
}

// ------------------------------------------------------------------ the run
export async function runGate(o, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s + '\n'))
  const webDir = o.root ? path.resolve(o.root) : WEB
  const data = loadData(o, webDir)
  const { registry, knownBy, baseline } = data
  if (MUT.size) out(`!! GATE_MUTATE=${[...MUT].join(',')} is set: rules are switched OFF on purpose (the gate's own suite). Do not trust this run.`)

  const startedAt = new Date()
  const head = (await git(webDir, 'rev-parse', 'HEAD')).out
  const branch = (await git(webDir, 'rev-parse', '--abbrev-ref', 'HEAD')).out
  const result = {
    schema: 1, started: startedAt.toISOString(), finished: null, durationSec: 0, head, branch, outdir: null,
    options: { ...o }, suites: [], totals: {}, verdict: null, regressions: [], fixed: [], skipped: [], readiness: null,
  }

  if (o.deployCheck) {
    result.readiness = await readiness(o, webDir, data, out)
    result.verdict = result.readiness.ready ? 'READY' : 'NOT READY'
    result.finished = new Date().toISOString()
    if (o.json) fs.writeFileSync(o.json, JSON.stringify(result, null, 2))
    return { code: result.readiness.ready ? 0 : 3, result }
  }

  // --changed: the files changed since the ref (committed, uncommitted, untracked), relative to sporta-web/
  let changedFiles = []
  if (o.changed) {
    const ref = o.changedRef ?? o.since ?? (await defaultRef(webDir, baseline))
    if (!ref) throw new Error('--changed needs a ref: pass --changed=<ref> or fill ops/release/live-baseline.json')
    changedFiles = await changedSince(webDir, ref)
    out(`changed since ${ref.slice(0, 10)}: ${changedFiles.length} file(s)`)
  }
  const scriptOf = scriptOfSuite(webDir)
  const selected = select(registry, o, changedFiles, scriptOf)
  if (!selected.length) out('no suite selected: nothing to run')

  const outdir = path.resolve(o.outdir ?? path.join(webDir, '.gate', utcStamp(startedAt)))
  fs.mkdirSync(outdir, { recursive: true })
  result.outdir = outdir
  out(`gate: ${selected.length} suite(s), logs in ${path.relative(webDir, outdir) || outdir}, HEAD ${head.slice(0, 8)} on ${branch}`)

  // (a) the rig, only when a selected suite needs it
  let rig = { up: true }
  if (selected.some(isRig) && !registry.rig?.disabled) rig = await ensureRig(registry, o, webDir, out)

  const runOne = async (s, attemptNo) => {
    const command = s.command ?? `npm run test:${s.name}`
    if (isRig(s)) await clearRateLimit(registry, webDir)
    const log = path.join(outdir, `${s.name}${attemptNo ? `.rerun${attemptNo}` : ''}.log`)
    const r = await runSuite(command, webDir, log, s.timeoutSec ?? 900)
    const parsed = parseOutput(r.text, s.parse ?? 'auto', s.parseRegex)
    const run = { exit: r.exit, timedOut: r.timedOut, ok: parsed.ok, fail: parsed.fail, failLines: parsed.failLines, text: r.text }
    const c = classifyAttempt(s, knownBy.get(s.name), run)
    return {
      verdict: c.verdict, reasons: c.reasons, exit: r.exit, timedOut: r.timedOut, ok: parsed.ok, fail: parsed.fail, failLines: parsed.failLines,
      seconds: r.seconds, startedAt: r.startedAt, endedAt: r.endedAt, log: path.relative(webDir, log), parsedBy: parsed.parsedBy,
    }
  }

  const first = new Map()
  let n = 0
  const progress = (s, a) => { n++; out(`[${n}/${selected.length}] ${a.verdict.padEnd(10)} ${s.name} (${a.seconds}s, ok ${a.ok ?? '-'}, FAIL ${a.fail}${a.exit === null ? ', timeout' : a.exit ? `, exit ${a.exit}` : ''})`) }

  // suites whose environment is absent are SKIPPED, with the reason
  const runnable = []
  for (const s of selected) {
    if (isRig(s) && !rig.up) {
      first.set(s.name, { skipped: `needs the sandbox rig, which is absent (${rig.problem}); run npm run sandbox or drop --no-sandbox` })
      n++; out(`[${n}/${selected.length}] SKIPPED    ${s.name} (rig absent)`)
    } else if (s.requires?.length && s.requires.some((f) => !fs.existsSync(path.join(webDir, f)))) {
      const miss = s.requires.filter((f) => !fs.existsSync(path.join(webDir, f)))
      first.set(s.name, { skipped: `needs ${miss.join(', ')} which is absent (${s.requiresHint ?? 'build it first'})` })
      n++; out(`[${n}/${selected.length}] SKIPPED    ${s.name} (${miss.join(', ')} absent)`)
    } else if (s.measured === false && !o.unmeasured && !o.only) {
      first.set(s.name, { skipped: 'no baseline measurement yet' })
    } else runnable.push(s)
  }

  // (b) the pool (parallel-safe, never rig) then the serial lane (everything that touches the rig, or is not known to be safe)
  const pool = runnable.filter(inPool).sort((a, b) => (b.timeoutSec ?? 0) - (a.timeoutSec ?? 0))
  const serial = runnable.filter((s) => !inPool(s))
  let next = 0
  const worker = async () => {
    while (next < pool.length) {
      const s = pool[next++]
      const a = await runOne(s, 0)
      first.set(s.name, { attempts: [a] }); progress(s, a)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, o.jobs) }, worker))
  // MUTATION rig-serial: with the rule off, rig suites go through the pool, i.e. they may overlap.
  if (mutated('rig-serial')) {
    const queue = [...serial]
    await Promise.all(Array.from({ length: Math.max(2, o.jobs) }, async () => {
      while (queue.length) { const s = queue.shift(); const a = await runOne(s, 0); first.set(s.name, { attempts: [a] }); progress(s, a) }
    }))
  } else {
    for (const s of serial) {
      const a = await runOne(s, 0)
      first.set(s.name, { attempts: [a] }); progress(s, a)
    }
  }

  // reruns: each alone, serial, after the lanes
  for (const s of runnable) {
    const rec = first.get(s.name)
    const maxRe = o.rerun ?? (isBrowser(s) ? 2 : 1)
    while (rec.attempts[0].verdict === 'REGRESSION' && !rec.attempts[0].timedOut && rec.attempts.length <= maxRe && rec.attempts.at(-1).verdict === 'REGRESSION') {
      out(`rerun ${rec.attempts.length}/${maxRe}: ${s.name} (alone)`)
      const a = await runOne(s, rec.attempts.length)
      rec.attempts.push(a)
    }
  }

  // (c) verdicts
  for (const s of selected) {
    const rec = first.get(s.name)
    if (rec.skipped) {
      result.suites.push({ name: s.name, needs: s.needs, verdict: 'SKIPPED', note: rec.skipped, ok: null, fail: 0, exit: null, seconds: 0, attempts: [] })
      result.skipped.push({ suite: s.name, reason: rec.skipped })
      continue
    }
    const st = settle(rec.attempts)
    const f = st.final
    const entry = {
      name: s.name, needs: s.needs, verdict: st.verdict, note: st.reasons.join('; '), ok: f.ok, fail: f.fail, exit: f.exit, seconds: Math.round(rec.attempts.reduce((x, a) => x + a.seconds, 0) * 10) / 10,
      failLines: f.failLines, log: f.log, attempts: rec.attempts.map((a) => ({ verdict: a.verdict, exit: a.exit, ok: a.ok, fail: a.fail, seconds: a.seconds, startedAt: new Date(a.startedAt).toISOString(), endedAt: new Date(a.endedAt).toISOString(), log: a.log })),
    }
    if (s.measured === false && st.verdict === 'PASS') entry.note = `unmeasured: record minOk ${f.ok} in gate.config.json`
    result.suites.push(entry)
    if (st.verdict === 'REGRESSION') result.regressions.push({ suite: s.name, reasons: st.reasons, failLines: f.failLines })
    if (st.verdict === 'FIXED') result.fixed.push(s.name)
  }
  for (const v of ['PASS', 'KNOWN', 'FLAKE', 'FIXED', 'REGRESSION', 'SKIPPED']) result.totals[v] = result.suites.filter((x) => x.verdict === v).length

  // (d) the report
  out('')
  out(mdTable(result.suites.map((x) => [x.name, x.ok ?? '-', x.fail, x.exit === null ? (x.verdict === 'SKIPPED' ? '-' : 'timeout') : x.exit, x.seconds, x.verdict]), ['suite', 'ok', 'FAIL', 'exit', 'seconds', 'verdict']))
  out('')
  out(`totals: ${Object.entries(result.totals).map(([k, v]) => `${v} ${k}`).join(', ')}; ${result.suites.reduce((a, x) => a + (x.ok ?? 0), 0)} ok lines in all`)
  for (const x of result.suites.filter((y) => y.verdict === 'FIXED')) out(`FIXED  ${x.name}: a recorded known failure now passes. Remove it from ops/release/known-failures.json (same commit).`)
  for (const x of result.suites.filter((y) => y.verdict === 'FLAKE')) out(`FLAKE  ${x.name}: ${x.note}`)
  for (const x of result.suites.filter((y) => y.verdict === 'KNOWN' && y.note)) out(`KNOWN  ${x.name}: ${x.note}`)
  for (const x of result.suites.filter((y) => y.verdict === 'SKIPPED')) out(`SKIPPED ${x.name}: ${x.note}`)
  const fl = (l) => (l.length > 500 ? l.slice(0, 500) + ' ...' : l)
  if (result.regressions.length) {
    out(`GATE RED: ${result.regressions.length} regression${result.regressions.length === 1 ? '' : 's'}`)
    for (const r of result.regressions) {
      out(`  - ${r.suite}: ${r.reasons.join('; ')}`)
      for (const l of r.failLines.slice(0, 12)) out(`      ${fl(l)}`)
      if (r.failLines.length > 12) out(`      ... and ${r.failLines.length - 12} more FAIL lines (see the log)`)
    }
    result.verdict = 'RED'
  } else {
    out('GATE GREEN: no regression')
    result.verdict = 'GREEN'
  }
  result.finished = new Date().toISOString()
  result.durationSec = Math.round((Date.now() - startedAt.getTime()) / 1000)
  out(`(${result.durationSec}s; logs in ${path.relative(webDir, outdir) || outdir})`)

  // (e) readiness, only after a green run
  if (result.verdict === 'GREEN') result.readiness = await readiness(o, webDir, data, out)
  if (o.json) fs.writeFileSync(o.json, JSON.stringify(result, null, 2))
  return { code: result.verdict === 'RED' ? 1 : 0, result }
}

// ------------------------------------------------------------------ git helpers
async function defaultRef(webDir, baseline) {
  if (!baseline) return null
  if (baseline.ref) return baseline.ref
  return null
}
async function changedSince(webDir, ref) {
  const prefix = (await git(webDir, 'rev-parse', '--show-prefix')).out
  const tracked = await git(webDir, 'diff', '--name-only', ref)
  if (tracked.code !== 0) throw new Error(`git diff against ${ref} failed: ${tracked.out.split('\n')[0]}`)
  const untracked = await git(webDir, 'ls-files', '--others', '--exclude-standard')
  const rel = (f) => (prefix && f.startsWith(prefix) ? f.slice(prefix.length) : prefix ? '../' + f : f)
  return [...new Set([...tracked.out.split('\n'), ...untracked.out.split('\n')].filter(Boolean).map(rel))]
}

// ------------------------------------------------------------------ deploy readiness (printed, never executed)
export async function readiness(o, webDir, data, out) {
  const { baseline } = data
  const blockers = []
  const warnings = []
  out('')
  out('== DEPLOY READINESS (printed only: this gate never deploys; a deploy is the owner\'s explicit "deploy")')
  const head = (await git(webDir, 'rev-parse', 'HEAD')).out
  const branch = (await git(webDir, 'rev-parse', '--abbrev-ref', 'HEAD')).out

  // 1 working tree
  const st = await git(webDir, 'status', '--porcelain')
  const dirty = st.out ? st.out.split('\n') : []
  if (dirty.length && !mutated('dirty-tree')) {
    blockers.push(`the working tree is not clean (${dirty.length} path(s)): ${dirty.slice(0, 5).map((l) => l.trim()).join('; ')}${dirty.length > 5 ? ' ...' : ''}`)
  }
  // 2 pushed
  const remote = await git(webDir, 'rev-parse', '--verify', '-q', `origin/${branch}`)
  if (remote.code !== 0) blockers.push(`branch ${branch} has no origin/${branch} (never pushed): the VPS downloads the commit from GitHub, so push it first`)
  else if (remote.out !== head) {
    const ahead = (await git(webDir, 'rev-list', '--count', `origin/${branch}..HEAD`)).out
    blockers.push(`HEAD ${head.slice(0, 8)} is not origin/${branch} (${remote.out.slice(0, 8)}; ${ahead} commit(s) not pushed, as of the last fetch): push first, the VPS downloads the commit from GitHub`)
  }
  // 3 HEAD message
  const msg = (await git(webDir, 'log', '-1', '--format=%B')).out
  if (/NOT READY|do not deploy/i.test(msg) && !mutated('head-guard')) {
    blockers.push(`HEAD's commit message says "${msg.match(/NOT READY|do not deploy/i)[0]}" (CLAUDE.md: such a commit is never shipped): ${msg.split('\n')[0].slice(0, 120)}`)
  }

  // 4 what the release contains
  const refs = collectRefs(baseline, o.since)
  let mapped = []
  let diffText = ''
  const added = new Set()
  if (!refs.size) warnings.push('no live baseline (ops/release/live-baseline.json): cannot say what the release contains')
  else {
    const byRef = new Map()
    const files = new Set()
    const oldest = [...refs.values()][0]
    // every path changed since the OLDEST baseline ref, then each filtered against ITS OWN baseline ref
    const all = await git(webDir, 'diff', '--relative', '--name-status', oldest.ref, 'HEAD', '--', '.')
    if (all.code !== 0) warnings.push(`git diff against ${oldest.ref} failed: ${all.out.split('\n')[0]}`)
    for (const line of all.out.split('\n').filter(Boolean)) files.add(line.split('\t').at(-1))
    for (const f of files) {
      const r = refFor(f, baseline, o.since)
      if (!byRef.has(r)) byRef.set(r, [])
      byRef.get(r).push(f)
    }
    const changed = []
    for (const [ref, list] of byRef) {
      if (ref === oldest.ref) { for (const f of list) changed.push(f); continue }
      const d = await git(webDir, 'diff', '--relative', '--name-status', ref, 'HEAD', '--', ...list)
      for (const line of d.out.split('\n').filter(Boolean)) changed.push(line.split('\t').at(-1))
    }
    for (const line of all.out.split('\n').filter(Boolean)) {
      const [status, ...rest] = line.split('\t')
      if (status === 'A') added.add(rest.at(-1))
    }
    mapped = [...new Set(changed)].sort().map((p) => mapPath(p, baseline))
    const dd = await git(webDir, 'diff', '--relative', oldest.ref, 'HEAD', '--', 'dropin')
    diffText = dd.out
  }
  const sum = summariseRelease(mapped, { addedFiles: added, diffText })
  const shipping = mapped.filter((m) => m.scope)
  out(`   baseline: ${[...refs.values()].map((r) => `${r.label} ${r.ref.slice(0, 8)}`).join(', ') || 'none'}`)
  out(`   HEAD: ${head.slice(0, 8)} on ${branch}`)
  out(`   the release contains ${shipping.length} deployable path(s) (${mapped.length - shipping.length} other changed path(s) are source, tooling or the foreign storefront and never ship):`)
  const groups = {}
  for (const m of shipping) (groups[m.scope] ??= []).push(m.path)
  for (const [scope, list] of Object.entries(groups)) out(`     --only ${scope.padEnd(44)} ${list.length > 3 ? `${list.length} files` : list.join(', ')}`)
  if (sum.attention.length) {
    out('   needs the owner\'s attention:')
    for (const a of sum.attention) out(`     * ${a}`)
  }
  for (const w of warnings) out(`   note: ${w}`)

  // 5 the commands, from what vps-deploy.mjs really accepts
  const accepted = vpsDeployFlags(webDir)
  const only = sum.scopes.length ? sum.scopes.sort().join(',') : null
  const missing = ['--apply', '--ref', '--confirm', '--only'].filter((f) => !accepted.flags.includes(f))
  out('')
  if (missing.length) {
    out(`!! scripts/vps-deploy.mjs does not accept ${missing.join(', ')} any more. What it accepts: ${accepted.usage || '(no usage line found)'}`)
    blockers.push(`vps-deploy.mjs no longer accepts ${missing.join(', ')}; update CLAUDE.md and this gate`)
  }
  if (only) {
    out('   1) plan (read-only; changes nothing on the server; run it through the Hostinger connector, as the person who says "deploy"):')
    out(`        node scripts/vps-deploy.mjs compose --ref ${head} --only ${only}`)
    out('   2) read the plan: the "live bytes -> release bytes" line of every file (a shrink is a wrong base), the per-file list, health before.')
    out('   3) apply (needs the full SHA TWICE; add --allow-shrink only when a shrink in the plan is intended):')
    out(`        node scripts/vps-deploy.mjs compose --apply --ref ${head} --confirm ${head} --only ${only}`)
    out('   4) success is the job log saying DEPLOY_OK (and nothing else). Undo: compose --rollback <the deploy name it prints>.')
    out('   5) afterwards edit ops/release/live-baseline.json (ref, deploy name, date) in the commit that records the deploy.')
  } else if (refs.size) {
    out('   nothing deployable differs from the live baseline: there is nothing to deploy.')
  }
  out('')
  const ready = blockers.length === 0
  if (ready) out('DEPLOY READINESS: READY (the tree is clean and pushed, HEAD may be shipped; the owner still has to say "deploy")')
  else {
    out(`DEPLOY READINESS: NOT READY (${blockers.length})`)
    for (const b of blockers) out(`   - ${b}`)
  }
  return { ready, blockers, warnings, head, branch, only, attention: sum.attention, files: mapped, commands: only ? { plan: `node scripts/vps-deploy.mjs compose --ref ${head} --only ${only}`, apply: `node scripts/vps-deploy.mjs compose --apply --ref ${head} --confirm ${head} --only ${only}` } : null }
}

// Every distinct baseline ref, oldest first (git order is not needed: --changed only wants SOME ref that is old enough).
function collectRefs(baseline, sinceOverride) {
  const m = new Map()
  const add = (ref, label) => { if (ref && !m.has(ref)) m.set(ref, { ref, label }) }
  if (sinceOverride) { add(sinceOverride, '--since'); return m }
  if (!baseline) return m
  add(baseline.ref, 'baseline')
  add(baseline.api?.ref, 'api')
  for (const f of Object.values(baseline.api?.files ?? {})) add(f.ref, 'api file')
  add(baseline.addons?.default?.ref, 'add-ons')
  for (const f of Object.values(baseline.addons?.files ?? {})) add(f.ref, 'add-on file')
  return m
}
function refFor(file, baseline, sinceOverride) {
  if (sinceOverride) return sinceOverride
  const b = baseline ?? {}
  if (b.api?.files?.[file]) return b.api.files[file].ref
  if (file.startsWith('dropin/')) return b.api?.ref ?? b.ref
  if (b.addons?.files?.[file]) return b.addons.files[file].ref
  if (file.startsWith('public/')) return b.addons?.default?.ref ?? b.ref
  return b.ref
}
function vpsDeployFlags(webDir) {
  let src = ''
  try { src = fs.readFileSync(path.join(webDir, 'scripts/vps-deploy.mjs'), 'utf8') } catch { /* absent in a temp tree */ }
  const usage = (src.match(/usage: (node scripts\/vps-deploy\.mjs compose[^'\\]*)/) ?? [])[1] ?? ''
  const flags = ['--apply', '--ref', '--confirm', '--only', '--allow-shrink', '--rollback'].filter((f) => src.includes(`'${f}'`) || src.includes(`a === '${f}'`))
  return { flags: src ? flags : ['--apply', '--ref', '--confirm', '--only'], usage }
}

// ------------------------------------------------------------------ --list
function printList(o, webDir) {
  const { registry, knownBy, baseline } = loadData(o, webDir)
  const scriptOf = scriptOfSuite(webDir)
  const picked = new Set(select(registry, { ...o, changed: false }, [], scriptOf).map((s) => s.name))
  const rows = registry.suites.map((s) => [
    s.name, s.needs, s.quick ? 'quick' : '', s.parallelSafe ? 'parallel' : 'serial', s.timeoutSec, s.minOk ?? '', s.measured === false ? 'unmeasured' : '',
    knownBy.has(s.name) ? 'KNOWN' : '', picked.has(s.name) ? 'yes' : '-',
  ])
  console.log(mdTable(rows, ['suite', 'needs', 'quick', 'lane', 'timeout', 'minOk', 'baseline', 'known', 'runs now']))
  console.log(`\n${registry.suites.length} suites in the registry, ${picked.size} selected by the current options; ${knownBy.size} known failures; baseline ref ${baseline?.ref?.slice(0, 8) ?? 'none'}`)
  console.log('lanes: ' + Object.entries(registry.lanes ?? {}).map(([k, v]) => `${k} (${v.length})`).join(', '))
  console.log(`\nNOT in the gate (${(registry.not_in_gate ?? []).length}):`)
  for (const x of registry.not_in_gate ?? []) console.log(`  ${x.name.padEnd(24)} ${x.reason}`)
}

// ------------------------------------------------------------------ main
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  let o
  try { o = parseArgs(process.argv.slice(2)) } catch (e) { console.error(e.message); process.exit(2) }
  if (o.help) { console.log(HELP); process.exit(0) }
  try {
    if (o.list) { printList(o, o.root ? path.resolve(o.root) : WEB); process.exit(0) }
    const { code } = await runGate(o)
    process.exit(code)
  } catch (e) {
    console.error(`release-gate: ${e.message}`)
    process.exit(e.exitCode ?? 2)
  }
}
