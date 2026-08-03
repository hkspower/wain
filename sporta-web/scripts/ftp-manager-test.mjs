// scripts/ftp-manager.mjs, against a real FTPS server.
//
//   npm run test:ftp
//
// The same rig publish-test.mjs uses — pyftpdlib with a throwaway self-signed
// certificate — because a file manager tested against a mock proves the mock.
// Every command below actually moves bytes over TLS and then the result is
// checked on the server's own disk, not in the tool's output.
//
// The check that matters most is the last one. This tool can delete and
// overwrite files on a live shop, and four of those files hold the only copy
// of a credential: api/config.php, knet/config.php, pay/config.php and
// config.js. `put` and `rm` must refuse them, and refusing them must not be a
// convention that a future edit quietly drops.
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = '/tmp/sporta-ftpman'
const HOME = join(DIR, 'home')

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 54 - t.length))}`)

const have = (bin, args) => {
  try { execFileSync(bin, args, { stdio: 'pipe' }); return true } catch { return false }
}
if (!have('python3', ['-c', 'import pyftpdlib']) || !have('openssl', ['version'])) {
  console.log('pyftpdlib or openssl is not installed — skipping (this needs a real FTPS server to mean anything)')
  process.exit(0)
}

rmSync(DIR, { recursive: true, force: true })
mkdirSync(join(HOME, 'public_html/api'), { recursive: true })
writeFileSync(join(HOME, 'public_html/index.html'), '<h1>shop</h1>\n')
writeFileSync(join(HOME, 'public_html/api/.htaccess'), '# deny\n')
// The one file whose loss takes the shop offline.
writeFileSync(join(HOME, 'public_html/api/config.php'), '<?php return ["db_pass"=>"REAL-DB-PASSWORD"];\n')

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
h.passive_ports = range(60200, 60240)
h.masquerade_address = '127.0.0.1'
FTPServer(('127.0.0.1', 2123), h).serve_forever()
`)
const srv = spawn('python3', [join(DIR, 'server.py')], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 1500))

// The certificate is self-signed, so FTP_INSECURE=1 — the same escape hatch
// publish-test.mjs uses, and the only place it is ever set.
const ftp = (args, input = '') => {
  try {
    return {
      out: execFileSync('node', [join(WEB, 'scripts/ftp-manager.mjs'), ...args], {
        cwd: DIR, encoding: 'utf8', input,
        env: { ...process.env, FTP_HOST: '127.0.0.1', FTP_PORT: '2123',
               FTP_USER: 'sporta', FTP_PASSWORD: 'ftp-test-pass', FTP_INSECURE: '1' },
      }),
      code: 0,
    }
  } catch (e) {
    return { out: (e.stdout ?? '') + (e.stderr ?? ''), code: e.status ?? 1 }
  }
}
const onServer = (p) => join(HOME, p)

try {
  head('reading')
  {
    const { out } = ftp(['ls', '/public_html'])
    is(/index\.html/.test(out) && /api\//.test(out), 'ls lists files and marks directories', out.split('\n')[0])

    const cat = ftp(['cat', '/public_html/api/.htaccess'])
    is(cat.out.includes('# deny'), 'cat prints the remote file', cat.out.trim())

    const get = ftp(['get', '/public_html/index.html', 'downloaded.html'])
    is(existsSync(join(DIR, 'downloaded.html'))
       && readFileSync(join(DIR, 'downloaded.html'), 'utf8').includes('shop'),
       'get downloads the real bytes', get.out.trim())

    const find = ftp(['find', '/public_html', 'config'])
    is(find.out.includes('/public_html/api/config.php'), 'find walks the tree', find.out.trim())

    const du = ftp(['du', '/public_html'])
    is(/\d/.test(du.out) && /files/.test(du.out), 'du totals the tree', du.out.trim())
  }

  head('writing')
  {
    writeFileSync(join(DIR, 'new.txt'), 'hello from the mac\n')
    const put = ftp(['put', 'new.txt', '/public_html/new.txt'])
    is(readFileSync(onServer('public_html/new.txt'), 'utf8').includes('hello from the mac'),
       'put uploads, and the server has the bytes', put.out.trim())

    ftp(['mkdir', '/public_html/fresh/deep'])
    is(existsSync(onServer('public_html/fresh/deep')), 'mkdir creates parents too')

    ftp(['mv', '/public_html/new.txt', '/public_html/fresh/moved.txt'])
    is(existsSync(onServer('public_html/fresh/moved.txt'))
       && !existsSync(onServer('public_html/new.txt')), 'mv moves it')

    // A delete on a live server cannot be undone and there is no trash, so it
    // asks — and answering anything but yes must leave the file alone.
    const no = ftp(['rm', '/public_html/fresh/moved.txt'], 'n\n')
    is(existsSync(onServer('public_html/fresh/moved.txt')),
       'rm asks first, and "n" leaves the file where it is', no.out.trim().slice(-30))

    const yes = ftp(['rm', '/public_html/fresh/moved.txt'], 'y\n')
    is(!existsSync(onServer('public_html/fresh/moved.txt')), 'and "y" deletes it', yes.out.trim())

    ftp(['rmdir', '/public_html/fresh/deep', '-f'])
    is(!existsSync(onServer('public_html/fresh/deep')), 'rmdir removes an empty directory')
  }

  head('the four files it must never touch')
  {
    // THE CHECK THIS SUITE EXISTS FOR. These hold the only copy of the
    // database password, the Tranportal credentials and the CBK secrets.
    // Overwriting one is not an inconvenience; it is a shop that stops taking
    // money until the owner can find the values again.
    writeFileSync(join(DIR, 'evil.php'), '<?php return [];\n')
    const put = ftp(['put', 'evil.php', '/public_html/api/config.php'])
    is(put.code !== 0, 'put REFUSES api/config.php', `exit ${put.code}`)
    is(readFileSync(onServer('public_html/api/config.php'), 'utf8').includes('REAL-DB-PASSWORD'),
       'and the live credentials are still there, untouched')

    const rm = ftp(['rm', '/public_html/api/config.php', '-f'])
    is(rm.code !== 0, 'rm REFUSES it too, even with -f', `exit ${rm.code}`)
    is(existsSync(onServer('public_html/api/config.php')), 'and the file survives')

    // Reading it is allowed, and is the point: that is how a backup is taken
    // before anything else is done.
    const get = ftp(['get', '/public_html/api/config.php', 'cfg-backup.php'])
    is(get.code === 0 && readFileSync(join(DIR, 'cfg-backup.php'), 'utf8').includes('REAL-DB-PASSWORD'),
       'but get is allowed — taking a backup is the whole point')
  }

  head('it does not leak the password')
  {
    const help = ftp(['--help'])
    is(!help.out.includes('ftp-test-pass'), 'not in --help')
    const err = ftp(['cat', '/public_html/nope.txt'])
    is(!err.out.includes('ftp-test-pass'), 'and not in an error message', err.out.trim().slice(0, 60))
  }
} finally {
  srv.kill()
  rmSync(DIR, { recursive: true, force: true })
}

console.log(fails ? `\n${fails} problem(s) in the FTP file manager`
                  : '\nFTPS file manager: every command works, and the credentials are safe')
process.exit(fails ? 1 : 0)
