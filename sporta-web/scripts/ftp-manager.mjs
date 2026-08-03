// A File Manager for Hostinger, on the command line, over FTPS.
//
//   npm run ftp -- ls /public_html
//   npm run ftp -- ls -l /public_html/api
//   npm run ftp -- cat /public_html/api/.htaccess
//   npm run ftp -- get /public_html/api/config.php ./config-backup.php
//   npm run ftp -- put ./local.php /public_html/api/local.php
//   npm run ftp -- mkdir /public_html/newfolder
//   npm run ftp -- mv /public_html/a.php /public_html/b.php
//   npm run ftp -- rm /public_html/oldfile.php
//   npm run ftp -- chmod 600 /public_html/api/config.php
//   npm run ftp -- du /public_html
//   npm run ftp -- find /public_html config.php
//
// -------------------------------------------------------------------------
// WHY THIS AND NOT AN API ON THE SERVER
//
// The obvious version of this is a PHP file in the web root that takes a path
// and returns or writes a file. This project has already had one:
// sporta-deploy.php sat in public_html answering to anyone on the internet.
// An endpoint that reads and writes arbitrary files IS the vulnerability —
// not a route to one — and no amount of key-checking changes what it is,
// because the key then lives in the same web root it is guarding.
//
// FTPS adds nothing to attack. Hostinger already runs it, already
// authenticates it, and the credentials are revocable in hPanel in one click.
// This file is a CLIENT: it runs on your Mac, the password never leaves it,
// and switching it off means deleting a file from your own laptop.
//
// It is also the only shape that can work. Claude's sandbox has no network
// route to the server — an API there would be equally unreachable from here,
// so it would not have solved the problem it was asked to solve either.
// -------------------------------------------------------------------------
//
// Credentials come from sporta-web/.env.deploy (git-ignored), the same file
// npm run publish uses: FTP_HOST, FTP_USER, FTP_PASSWORD. If you have not set
// them up, run `npm run ftp:doctor` first — it finds the right host.
import { Client } from 'basic-ftp'
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs'
import { basename, dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { config as loadEnv } from 'dotenv'

const web = join(dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: join(web, '.env.deploy') })

const RED = (s) => `\x1b[31m${s}\x1b[0m`
const YEL = (s) => `\x1b[33m${s}\x1b[0m`
const GRN = (s) => `\x1b[32m${s}\x1b[0m`
const DIM = (s) => `\x1b[2m${s}\x1b[0m`

const die = (m) => { console.error(RED(m)); process.exit(1) }

// THE FILES THIS TOOL WILL NOT OVERWRITE OR DELETE.
//
// The same list npm run publish holds, and for the same reason: these are the
// live database password, the Tranportal credentials and the CBK secrets.
// They exist ONLY on the server — there is no copy anywhere else — so an
// overwrite is not an inconvenience, it is a shop that stops taking money
// until the owner can find the values again. `get` is allowed; it is how you
// take a backup. Everything that writes is refused.
const PROTECTED = [
  'api/config.php', 'knet/config.php', 'pay/config.php', 'config.js',
]
// NORMALISE BEFORE COMPARING. The guard used to test the raw string, so
// /public_html/api//config.php slipped past it — a doubled slash the FTP
// server collapses back to one on the way in, which means the tool refused
// the path a person types and allowed the path a shell loop builds.
// posix.normalize collapses runs of slashes and resolves . and .., but keeps
// a trailing one, so that is stripped separately. Hand-rolled path parsing is
// the wrong thing to maintain in the guard standing between a typo and the
// only copy of the Tranportal credentials.
//
// The n === f test is not redundant with endsWith: config.js has no slash in
// it, and this tool accepts relative paths, so `ftp put evil.js config.js`
// normalises to exactly config.js and matches nothing else.
const isProtected = (p) => {
  const n = posix.normalize(String(p)).replace(/\/+$/, '')
  return PROTECTED.some((f) => n.endsWith('/' + f) || n === f)
}

const [cmd, ...args] = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('-')))
const rest = args.filter((a) => !a.startsWith('-'))

const host = process.env.FTP_HOST
const user = process.env.FTP_USER
const password = process.env.FTP_PASSWORD
const port = Number(process.env.FTP_PORT || 21)

// `--help` as the FIRST argument lands in `cmd`, not in `flags` — so it has to
// be tested in both places or `npm run ftp -- --help` asks for credentials it
// does not need in order to print a usage message.
if (!cmd || ['-h', '--help', 'help'].includes(cmd) || flags.has('-h') || flags.has('--help')) {
  console.log(`
  Sporta FTPS file manager — Hostinger, from the command line.

    ${GRN('ls')}    [-l] <dir>              list a directory
    ${GRN('cat')}   <file>                  print a remote file
    ${GRN('get')}   <remote> [local]        download
    ${GRN('put')}   <local> <remote>        upload
    ${GRN('mkdir')} <dir>                   create a directory (and parents)
    ${GRN('mv')}    <from> <to>             rename or move
    ${GRN('rm')}    <file>                  delete a file      ${DIM('(asks first)')}
    ${GRN('rmdir')} <dir>                   delete a directory ${DIM('(asks first, must be empty)')}
    ${GRN('chmod')} <mode> <path>           e.g. 600, 644, 755
    ${GRN('du')}    <dir>                   size of a directory tree
    ${GRN('find')}  <dir> <name>            find files by name fragment

  Credentials come from sporta-web/.env.deploy. Run ${GRN('npm run ftp:doctor')}
  if you do not have them yet.

  ${DIM('These are never overwritten or deleted: ' + PROTECTED.join(', '))}
`)
  process.exit(0)
}

if (!host || !user) {
  die('Set FTP_HOST and FTP_USER in sporta-web/.env.deploy — hPanel → Files → FTP Accounts.\n' +
      'Do not guess the host: run `npm run ftp:doctor`.')
}
if (!password) die('Set FTP_PASSWORD in sporta-web/.env.deploy. It is git-ignored; never commit it.')

const ask = async (q) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const a = (await rl.question(YEL(q + ' '))).trim().toLowerCase()
  rl.close()
  return a === 'y' || a === 'yes'
}

const human = (n) => n < 1024 ? `${n} B`
  : n < 1048576 ? `${(n / 1024).toFixed(1)} kB`
  : `${(n / 1048576).toFixed(1)} MB`

const client = new Client(30_000)
client.ftp.verbose = false

try {
  // Explicit FTPS (AUTH TLS), identical to publish-ftps.mjs. Plain FTP would
  // put the password and every byte on the wire in clear text.
  // A bare IP must not be sent as SNI — RFC 6066 forbids it.
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host)
  await client.access({
    host, port, user, password, secure: true,
    secureOptions: {
      ...(isIp ? {} : { servername: host }),
      rejectUnauthorized: process.env.FTP_INSECURE !== '1',
    },
  })

  switch (cmd) {
    case 'ls': {
      const dir = rest[0] || '/'
      const list = await client.list(dir)
      list.sort((a, b) => (b.isDirectory - a.isDirectory) || a.name.localeCompare(b.name))
      if (!flags.has('-l')) {
        console.log(list.map((f) => f.isDirectory ? GRN(f.name + '/') : f.name).join('  '))
      } else {
        for (const f of list) {
          const perm = f.rawModifiedAt ? '' : ''
          console.log(
            `${(f.permissions ? octal(f) : '   ').padEnd(4)} ` +
            `${human(f.size).padStart(9)}  ${(f.rawModifiedAt || '').padEnd(14)} ` +
            (f.isDirectory ? GRN(f.name + '/') : f.name) + perm)
        }
      }
      console.log(DIM(`\n${list.length} entries in ${dir}`))
      break
    }

    case 'cat': {
      if (!rest[0]) die('cat <remote file>')
      const chunks = []
      await client.downloadTo(
        // A writable that collects into memory — cat should not touch disk.
        new (await import('node:stream')).Writable({
          write(c, _e, cb) { chunks.push(c); cb() },
        }), rest[0])
      process.stdout.write(Buffer.concat(chunks).toString('utf8'))
      break
    }

    case 'get': {
      if (!rest[0]) die('get <remote> [local]')
      const local = rest[1] || basename(rest[0])
      await client.downloadTo(createWriteStream(local), rest[0])
      console.log(GRN(`downloaded → ${local} (${human(statSync(local).size)})`))
      break
    }

    case 'put': {
      if (rest.length < 2) die('put <local> <remote>')
      if (!existsSync(rest[0])) die(`no such local file: ${rest[0]}`)
      if (isProtected(rest[1])) {
        die(`Refusing to overwrite ${rest[1]}.\n` +
            'That file holds live credentials and exists ONLY on the server — there is no\n' +
            'copy to restore from. Take one first:  npm run ftp -- get ' + rest[1])
      }
      await client.ensureDir(dirname(rest[1]))
      await client.cd('/')
      await client.uploadFrom(createReadStream(rest[0]), rest[1])
      console.log(GRN(`uploaded → ${rest[1]} (${human(statSync(rest[0]).size)})`))
      break
    }

    case 'mkdir':
      if (!rest[0]) die('mkdir <dir>')
      await client.ensureDir(rest[0])
      console.log(GRN(`created ${rest[0]}`))
      break

    case 'mv':
      if (rest.length < 2) die('mv <from> <to>')
      if (isProtected(rest[0])) die(`Refusing to move ${rest[0]} — it holds live credentials.`)
      await client.rename(rest[0], rest[1])
      console.log(GRN(`${rest[0]} → ${rest[1]}`))
      break

    case 'rm': {
      if (!rest[0]) die('rm <file>')
      if (isProtected(rest[0])) {
        die(`Refusing to delete ${rest[0]}.\n` +
            'It holds live credentials and exists only here — deleting it takes the shop\n' +
            'offline until the values can be found again.')
      }
      // Deletes over FTP are not undoable and there is no trash. Ask, always,
      // unless -f is passed deliberately.
      if (!flags.has('-f') && !await ask(`Delete ${rest[0]} from the live server? [y/N]`)) {
        console.log('cancelled'); break
      }
      await client.remove(rest[0])
      console.log(GRN(`deleted ${rest[0]}`))
      break
    }

    case 'rmdir': {
      if (!rest[0]) die('rmdir <dir>')
      const inside = await client.list(rest[0])
      if (inside.length) die(`${rest[0]} is not empty (${inside.length} entries). Remove them first.`)
      if (!flags.has('-f') && !await ask(`Delete directory ${rest[0]}? [y/N]`)) {
        console.log('cancelled'); break
      }
      await client.removeDir(rest[0])
      console.log(GRN(`deleted ${rest[0]}`))
      break
    }

    case 'chmod': {
      if (rest.length < 2) die('chmod <mode> <path>   e.g. chmod 600 /public_html/api/config.php')
      // SITE CHMOD is an extension, not core FTP. Hostinger supports it; a
      // server that does not will answer 500 and the message says so rather
      // than pretending it worked.
      const res = await client.send(`SITE CHMOD ${rest[0]} ${rest[1]}`, true)
      if (res.code >= 400) die(`server refused: ${res.message.trim()}`)
      console.log(GRN(`${rest[1]} → ${rest[0]}`))
      break
    }

    case 'du': {
      const dir = rest[0] || '/'
      let files = 0, bytes = 0
      const walk = async (d) => {
        for (const f of await client.list(d)) {
          if (f.isDirectory) await walk(`${d}/${f.name}`)
          else { files++; bytes += f.size }
        }
      }
      await walk(dir)
      console.log(`${dir}: ${GRN(human(bytes))} in ${files} files`)
      break
    }

    case 'find': {
      if (rest.length < 2) die('find <dir> <name fragment>')
      const [dir, needle] = rest
      const hits = []
      const walk = async (d) => {
        for (const f of await client.list(d)) {
          const p = `${d}/${f.name}`
          if (f.name.toLowerCase().includes(needle.toLowerCase())) hits.push(p)
          if (f.isDirectory) await walk(p)
        }
      }
      await walk(dir)
      console.log(hits.length ? hits.join('\n') : DIM('nothing matched'))
      break
    }

    default:
      die(`unknown command: ${cmd}   (run with --help)`)
  }
} catch (e) {
  // basic-ftp puts the server's own sentence in .message; it is almost always
  // more useful than anything this file could say instead.
  die(`FTP: ${e.message}`)
} finally {
  client.close()
}

// basic-ftp exposes permissions as {user,group,world} letter sets.
function octal(f) {
  const bit = (s = '') => (s.includes('r') ? 4 : 0) + (s.includes('w') ? 2 : 0) + (s.includes('x') ? 1 : 0)
  const p = f.permissions
  return p ? `${bit(p.user)}${bit(p.group)}${bit(p.world)}` : ''
}
