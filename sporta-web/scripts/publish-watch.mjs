// Auto-publish on change: watch the source, and whenever it settles, run the
// normal publish (build → file audit → FTPS upload → byte-for-byte verify).
//
//   npm run publish:watch
//   npm run publish:watch -- --dry-run     # rehearse: never opens a connection
//
// WHY THIS EXISTS
// "Always connected" is not a thing worth building. An idle FTP control channel
// is dropped by the server within minutes, and holding one open would not make
// a deploy happen — what actually gets asked for is "I change something and it
// is live without me doing anything". That is this: a watcher that reacts to
// saved files, on the machine that already holds the credentials.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It does not weaken a single guard. Every cycle goes through the same
// publish-ftps.mjs, which refuses to upload if the file audit fails, never
// touches config.js or knet/config.php, sends index.html last so a half-finished
// run is not a white screen, and re-downloads .htaccess and index.html to
// compare them byte for byte afterwards.
//
// It also runs on YOUR machine, which means it stops when the machine sleeps.
// For deployment that continues while you are asleep, the repo also carries a
// cloud runner — see DEPLOY-AUTOMATION.md.
import { spawn } from 'node:child_process'
import { watch, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const web = resolve(new URL('..', import.meta.url).pathname)
const passthrough = process.argv.slice(2)

// Debounce: one editor save fires several fs events, and a build touching many
// files would otherwise queue a publish per file.
const SETTLE_MS = 2500

const WATCH = ['src', 'public', 'index.html', 'tailwind.config.js', 'vite.config.js', 'dropin']
  .map((p) => join(web, p))
  .filter(existsSync)

// dist/ is the build OUTPUT — watching it would make every publish trigger the
// next one forever. node_modules is noise.
const IGNORE = /(^|[/\\])(dist|node_modules|\.git)([/\\]|$)/

const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`
const stamp = () => new Date().toTimeString().slice(0, 8)
const log = (s) => console.log(`${c(90, stamp())}  ${s}`)

let timer = null
let running = false
let queued = false
let cycles = 0

function branchName() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: web, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function publish() {
  if (running) {
    // Changes landed mid-upload. Remember, and run once more when this finishes
    // — a second concurrent publish would interleave two sets of files on the
    // server, which is how you get a half-and-half site.
    queued = true
    return
  }
  running = true
  cycles++
  log(c(36, `▸ publishing (run ${cycles})`))
  const child = spawn(process.execPath, [join(web, 'scripts', 'publish-ftps.mjs'), ...passthrough], {
    cwd: web,
    stdio: 'inherit',
  })
  child.on('exit', (code) => {
    running = false
    if (code === 0) log(c(32, '✓ live — watching for the next change'))
    else log(c(31, `✖ publish failed (exit ${code}) — nothing was uploaded. Still watching.`))
    if (queued) {
      queued = false
      log(c(33, '↻ changes arrived during that run — publishing again'))
      schedule(0)
    }
  })
}

function schedule(delay = SETTLE_MS) {
  clearTimeout(timer)
  timer = setTimeout(publish, delay)
}

const branch = branchName()
console.log()
log(c(36, 'Sporta auto-publish'))
log(`  watching  ${WATCH.length} path(s) under sporta-web/`)
log(`  settle    ${SETTLE_MS}ms after the last change`)
if (branch) {
  log(`  branch    ${branch}`)
  // Not a hard block: a human running this interactively knows what they are
  // doing. But this repo holds several unrelated projects, so saying which
  // branch is about to reach the live store is worth three lines of output.
  if (!/^(sporta-live|main)$/.test(branch)) {
    log(c(33, `  note      this is a working branch — whatever you save here goes to the LIVE store`))
  }
}
if (passthrough.includes('--dry-run')) log(c(33, '  DRY RUN   nothing will be uploaded'))
log(c(90, '  Ctrl-C to stop'))
console.log()

for (const dir of WATCH) {
  watch(dir, { recursive: true }, (_event, filename) => {
    if (filename && IGNORE.test(filename)) return
    log(`changed: ${filename ?? '(unknown)'}`)
    schedule()
  })
}

process.on('SIGINT', () => {
  console.log()
  log(c(36, `stopped after ${cycles} publish cycle(s)`))
  process.exit(0)
})
