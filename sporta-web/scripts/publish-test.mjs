// Proves the deploy actually deploys — against a REAL FTPS server, before the
// owner trusts it to run unattended.
//
//   npm run test:publish
//
// WHY THIS EXISTS
// `npm run publish` is about to be given to a GitHub Action and a file watcher,
// both of which run with nobody looking. The things that could go wrong are not
// the ones a dry run catches:
//
//   * it could overwrite knet/config.php and take the card path down. Those
//     credentials exist ONLY on the server; there is no copy to restore from.
//   * it could send index.html before the chunks it names, so an interrupted
//     run leaves a white screen.
//   * it could re-upload the setup tools the owner was told to delete, quietly
//     undoing that cleanup on every deploy.
//   * it could delete something it did not put there.
//
// Every one of those is a property of the WHOLE run, so the whole run is what
// gets executed here: real build, real audit, real FTPS with TLS, real files on
// a real disk afterwards.
//
// The server is pyftpdlib with a throwaway self-signed certificate. If it or
// openssl is missing the suite skips rather than fails — the same rule
// storage-audit follows when Apache is absent, because a check that cannot run
// must not look like a check that passed.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const web = dirname(new URL('..', import.meta.url).pathname.replace(/\/$/, '')) + '/sporta-web'
const WEB = existsSync(join(web, 'package.json')) ? web : new URL('..', import.meta.url).pathname

let fails = 0
const ok = (c, what, d = '') => {
  if (!c) fails++
  console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${d ? `  — ${d}` : ''}`)
}
const have = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'pipe' }); return true } catch { return false } }

if (!have('python3', ['-c', 'import pyftpdlib']) || !have('openssl', ['version'])) {
  console.log('pyftpdlib or openssl is not installed — skipping (this test needs a real FTPS server to mean anything)')
  process.exit(0)
}

const DIR = mkdtempSync(join(tmpdir(), 'sporta-ftps-'))
const HOME = join(DIR, 'home')
const ROOT = join(HOME, 'public_html')
mkdirSync(join(ROOT, 'knet'), { recursive: true })
mkdirSync(join(ROOT, 'pay'), { recursive: true })
mkdirSync(join(ROOT, 'api'), { recursive: true })

// The live server's own files, staged exactly as they exist there: created by
// hand, never in the package, and holding the only copy of each secret.
const LIVE = {
  'config.js': 'window.SPORTA_CONFIG={LIVE:1}\n',
  'knet/config.php': '<?php return ["tranportal_id"=>"REAL-LIVE-ID"];\n',
  'pay/config.php': '<?php return ["ClientId"=>"REAL-CBK-CLIENT"];\n',
  'api/config.php': '<?php return ["db_pass"=>"REAL-DB-PASSWORD"];\n',
}
for (const [f, body] of Object.entries(LIVE)) writeFileSync(join(ROOT, f), body)
// Something the deploy did not put there and must not remove — an old logo, a
// folder of invoices, anything. mirror stays false for exactly this reason.
writeFileSync(join(ROOT, 'owners-own-file.txt'), 'not ours\n')

execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', join(DIR, 'k.pem'),
  '-out', join(DIR, 'c.pem'), '-days', '2', '-nodes', '-subj', '/CN=127.0.0.1'], { stdio: 'pipe' })
writeFileSync(join(DIR, 'both.pem'),
  readFileSync(join(DIR, 'k.pem')) + readFileSync(join(DIR, 'c.pem')).toString())

writeFileSync(join(DIR, 'server.py'), `
from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import TLS_FTPHandler
from pyftpdlib.servers import FTPServer
a = DummyAuthorizer()
a.add_user('sporta', 'ftp-test-pass', ${JSON.stringify(HOME)}, perm='elradfmwMT')
h = TLS_FTPHandler
h.certfile = ${JSON.stringify(join(DIR, 'both.pem'))}
h.authorizer = a
h.tls_control_required = True
h.tls_data_required = True
h.passive_ports = range(60100, 60140)
h.masquerade_address = '127.0.0.1'
FTPServer(('127.0.0.1', 2122), h).serve_forever()
`)
const srv = spawn('python3', [join(DIR, 'server.py')], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1500))

console.log('\n## A real publish, over real TLS')
let out = ''
let code = 0
try {
  out = execFileSync('npm', ['run', 'publish'], {
    cwd: WEB,
    encoding: 'utf8',
    env: {
      ...process.env,
      FTP_HOST: '127.0.0.1', FTP_PORT: '2122',
      FTP_USER: 'sporta', FTP_PASSWORD: 'ftp-test-pass',
      // The certificate is self-signed and generated seconds ago. Nothing else
      // about the TLS is relaxed: the control and data channels are both
      // encrypted, and the server refuses plaintext.
      FTP_INSECURE: '1',
      VITE_PAY_BASE_URL: '', VITE_CBK_BASE_URL: '', VITE_PHP_API_URL: '',
    },
  })
} catch (e) {
  code = e.status ?? 1
  out = `${e.stdout ?? ''}${e.stderr ?? ''}`
}
srv.kill()
ok(code === 0, 'the publish runs to completion', code === 0 ? '' : out.slice(-500))

console.log('\n## What it must never have touched')
for (const [f, body] of Object.entries(LIVE)) {
  const now = existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : '(gone)'
  ok(now === body, `${f} still holds the live value`, now === body ? '' : `became ${JSON.stringify(now.slice(0, 40))}`)
}
ok(existsSync(join(ROOT, 'owners-own-file.txt')),
   'a file the deploy did not put there is still there', 'mirror stays false')

console.log('\n## What it must have sent')
for (const f of ['index.html', '.htaccess', 'knet/.htaccess', 'api/api.php', 'sw.js']) {
  const local = join(WEB, 'dist', f)
  const remote = join(ROOT, f)
  const same = existsSync(remote) && existsSync(local)
    && readFileSync(remote).equals(readFileSync(local))
  ok(same, `${f} arrived byte for byte`)
}

console.log('\n## Order, and the things held back')
// index.html names the hashed chunks. If it lands before them, an interrupted
// run is a white screen — which is the failure this whole ordering exists to
// prevent, and it is invisible unless asserted.
const sent = [...out.matchAll(/uploaded (\d+)\/(\d+)\s+(\S+)/g)].map((m) => [m[1], m[2], m[3]])
const last = sent[sent.length - 1]
ok(last && last[2] === 'index.html', 'index.html was uploaded LAST',
   last ? `${last[0]}/${last[1]} ${last[2]}` : '(no upload lines)')
for (const f of ['go-live.html', 'knet/selftest.php', 'knet/setup-config.php', 'api/setup-admin.php']) {
  ok(!existsSync(join(ROOT, f)), `${f} was NOT re-uploaded`,
     'GO-LIVE tells the owner to delete these; a deploy must not put them back')
}
for (const f of ['.env', '.env.deploy']) {
  ok(!existsSync(join(ROOT, f)), `${f} was never sent`)
}

rmSync(DIR, { recursive: true, force: true })
console.log(fails ? `\n${fails} problem(s) in the publish path` : '\npublish: builds, audits, uploads, verifies — and leaves the server\'s own secrets alone')
process.exit(fails ? 1 : 0)
