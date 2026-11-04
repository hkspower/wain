// file-audit.mjs, against fixture packages it builds itself.
//
//   npm run test:file-audit
//
// The audit is the last gate before a package is written (make-package.mjs)
// and before a deploy leaves this machine (vps-deploy.mjs stops at it). It
// had no test of its own, and the day it mattered it was WRONG in the safe
// direction: three comments that named a source file — `// … src/lib/cart.jsx`
// — read to its reference pattern like markup loading one, so it reported
// "referenced file missing: /lib/cart.jsx" as a HIGH and the release pipeline
// stopped over a note. A gate that refuses good packages is a gate people
// learn to step around, which is the same end as one that passes bad ones.
//
// So this holds both halves of the rule the fix drew:
//   * a path inside a COMMENT is not a reference (// and # at the start of a
//     line, /* … */ opened at the start of a line, <!-- … --> in markup), and
//   * a path in CODE or MARKUP still is — on the line after a comment, on the
//     same line after a closed comment, and when `//` or `/*` is part of a
//     URL or a string rather than a comment.
// Each fixture is a complete package (every REQUIRED file present as a stub),
// so the audit's exit code — the thing make-package and vps-deploy act on —
// is what is asserted, not a line grepped out of a tree that fails anyway.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = dirname(HERE)
const AUDIT = join(HERE, 'file-audit.mjs')

let fails = 0
const is = (c, n, d = '') => { if (!c) fails++; console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${d ? `  — ${d}` : ''}`) }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

// The REQUIRED list is READ from the audit, not retyped: a second copy is the
// drift this suite would otherwise fail on the day a file is added to one.
const src = readFileSync(AUDIT, 'utf8')
const reqStart = src.indexOf('const REQUIRED = ') + 'const REQUIRED = '.length
const reqEnd = src.indexOf('for (const r of REQUIRED)')
const REQUIRED = new Function(`return ${src.slice(reqStart, reqEnd)}`)()
is(Array.isArray(REQUIRED) && REQUIRED.includes('/index.html') && REQUIRED.length >= 30,
   'the audit\'s REQUIRED list was read from the audit', `${REQUIRED.length} files`)

// A stub for each path: unique content (identical files are a LOW finding
// that would only add noise), non-empty (zero bytes is a HIGH), and PHP that
// parses (the audit runs php -l on every .php).
const stub = (p) => {
  if (p.endsWith('.php')) return `<?php\n// stub ${p}\n`
  if (p.endsWith('/.htaccess') || p === '/.htaccess') return `# stub ${p}\n`
  if (p.endsWith('.webp')) return Buffer.concat([Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 '), Buffer.from(p)])
  if (p.endsWith('.html')) return '<!doctype html>\n<html lang="ar" dir="rtl">\n<head><title>stub</title></head>\n<body><div id="root"></div></body>\n</html>\n'
  if (p.endsWith('.js')) return `window.SPORTA_CONFIG = {} // ${p}\n`
  if (p.endsWith('.txt')) return 'User-agent: *\nDisallow: /backends\n'
  if (p.endsWith('.xml')) return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset></urlset>\n'
  if (p.endsWith('.webmanifest')) return `{"name":"stub ${p}"}\n`
  if (p.endsWith('.sql')) return `-- stub ${p}\n`
  return `stub ${p}\n`
}

// Build a complete package plus the files under test, audit it, tear it down.
const audit = (extra = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'file-audit-'))
  try {
    const files = { ...Object.fromEntries(REQUIRED.map((p) => [p, stub(p)])), ...extra }
    for (const [p, body] of Object.entries(files)) {
      mkdirSync(join(dir, dirname(p)), { recursive: true })
      writeFileSync(join(dir, p), body)
    }
    const r = spawnSync(process.execPath, [AUDIT, dir], { encoding: 'utf8', cwd: WEB })
    return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
const missing = (out, p) => out.includes(`referenced file missing: ${p}`)
const highs = (out) => out.match(/^(\d+) high/m)?.[1] ?? '?'

head('a complete package passes')
{
  const r = audit()
  is(r.status === 0 && highs(r.out) === '0', 'every REQUIRED file present as a stub: exit 0, 0 high',
     r.status === 0 ? `${highs(r.out)} high` : r.out.split('\n').filter((l) => /HIGH|absent|missing/.test(l)).slice(0, 4).join(' | '))
}

head('a path inside a comment is not a reference')
{
  // The three notes that stopped the release on 2026-11-04, verbatim.
  const assistant = '<?php\n// WITHDRAWING CONSENT OR ASKING FOR ONE\'S DATA — to stop messages. The shop messages its\n'
    + '// customers (order updates, a birthday email), and src/pages/Privacy.jsx tells them to ask on WhatsApp or by\n'
    + '// email; the assistant used to answer these as a failed product search.\nfunction assistant_privacy_request(string $t): bool { return false; }\n'
  const birthday = '/* ==== RACES: the bag between tabs (lane K3, 2026-11-04) ====\n'
    + ' * Each guard is its own block. The repo\'s own app does the first job itself\n'
    + ' * (src/lib/cart.jsx) and says so with window.__sportaCartOwn, which makes the first block stand down. Proven by\n'
    + ' * scripts/race-client-test.mjs against the captured live storefront.\n */\n(function () { window.__x = 1 })()\n'
  const brands = '(function () {\n  /** Arabic counts the noun, it does not just put a digit in front of the singular.\n'
    + '   *  -> many (back to the singular). The same five cases as arabicCount() in src/i18n/translations.js, which this file\n'
    + '   *  cannot import. */\n  function plural(s) { return s }\n})()\n'
  const r = audit({ '/api/assistant.php': assistant, '/birthday.js': birthday, '/sporta-admin-brands.js': brands })
  is(r.status === 0 && !missing(r.out, '/pages/Privacy.jsx'), 'a `//` line in PHP naming src/pages/Privacy.jsx: no finding', `${highs(r.out)} high`)
  is(!missing(r.out, '/lib/cart.jsx'), 'a ` * ` line inside a `/* … */` block in JS naming src/lib/cart.jsx: no finding')
  is(!missing(r.out, '/i18n/translations.js'), 'a `/** … */` block in JS naming src/i18n/translations.js: no finding')

  const r2 = audit({
    '/api/notes.php': '<?php\n# the old src/pages/Privacy.jsx did this with a hash comment\n  // and an indented slash comment names src/lib/cart.jsx\n$x = 1;\n',
    '/notes.css': '/* the tile art used to be url(/gone-art.png), see src/lib/tiles.js */\n.x { color: #fff }\n',
    '/index.html': '<!doctype html>\n<html><head>\n<!-- <link rel="stylesheet" href="/gone.css"> -->\n<!--\n  <img src="/gone2.png">\n-->\n</head><body><div id="root"></div></body></html>\n',
    '/robots.txt': '# the old sitemap lived at /old-sitemap.xml\nUser-agent: *\n',
  })
  is(r2.status === 0 && highs(r2.out) === '0', 'a `#` line and an indented `//` line in PHP: no finding', `${highs(r2.out)} high`)
  is(!missing(r2.out, '/gone-art.png'), 'a `/* … */` block in CSS holding url(…): no finding')
  is(!missing(r2.out, '/gone.css') && !missing(r2.out, '/gone2.png'), 'a one-line and a multi-line <!-- … --> in HTML: no finding')
}

head('a path in code or markup still is one')
{
  const r = audit({ '/index.html': '<!doctype html>\n<html><head><link rel="stylesheet" href="/gone.css"></head><body></body></html>\n' })
  is(r.status === 1 && missing(r.out, '/gone.css'), 'markup loading a missing stylesheet: HIGH, exit 1', `${highs(r.out)} high`)

  const after = audit({ '/a.js': '// the icon lives at the root\nvar i = new Image(); i.src = "/gone.png"\n' })
  is(after.status === 1 && missing(after.out, '/gone.png'), 'code on the line AFTER a `//` comment: still a reference')

  const sameLine = audit({ '/b.js': '/* the icon */ var i = new Image(); i.src = "/gone.png"\n' })
  is(sameLine.status === 1 && missing(sameLine.out, '/gone.png'), 'code on the same line after a closed `/* … */`: still a reference')

  const closed = audit({ '/c.js': '/* a block\n * that spans lines */ var i = new Image(); i.src = "/gone.png"\n' })
  is(closed.status === 1 && missing(closed.out, '/gone.png'), 'code after the `*/` that closes a multi-line block: still a reference')

  const inString = audit({ '/d.js': 'var glob = "**/*.js"; var i = new Image(); i.src = "/gone.png"\n' })
  is(inString.status === 1 && missing(inString.out, '/gone.png'), 'a `/*` inside a string mid-line does not open a comment')

  const url = audit({ '/index.html': '<!doctype html>\n<html><head>\n<script type="application/ld+json">{"@type":"Organization",\n"logo": "https://www.sporta.com.kw/Logo.png"}</script>\n</head><body></body></html>\n',
                      '/logo.png': 'not really a png but a file with that name\n' })
  is(url.status === 1 && /case mismatch: referenced \/Logo\.png, file is \/logo\.png/.test(url.out),
     'the `//` of https:// in the JSON-LD logo URL is not a comment: a case mismatch is still caught')

  const htmlInline = audit({ '/index.html': '<!doctype html>\n<html><head><link rel="stylesheet" href="/present.css"><!-- <link href="/gone.css"> --><link rel="stylesheet" href="/gone3.css"></head><body></body></html>\n',
                             '/present.css': 'body { margin: 0 }\n' })
  is(htmlInline.status === 1 && !missing(htmlInline.out, '/gone.css') && missing(htmlInline.out, '/gone3.css'),
     'markup before and after an inline <!-- … --> is read, the comment is not')

  const css = audit({ '/e.css': '/* url(/gone-art.png) */\n.tile { background: url(/gone-real.png) }\n' })
  is(css.status === 1 && !missing(css.out, '/gone-art.png') && missing(css.out, '/gone-real.png'),
     'CSS: the url() in the comment is ignored, the one in the rule is a reference')

  const php = audit({ '/api/page.php': '<?php\n// nothing here\necho \'<img src="/gone.png">\';\n' })
  is(php.status === 1 && missing(php.out, '/gone.png'), 'PHP: markup printed by code after a comment line is a reference')

  const hash = audit({ '/f.js': 'class A {\n  #n = 1; load(i) { this.#n++; i.src = "/gone.png" }\n}\n' })
  is(hash.status === 1 && missing(hash.out, '/gone.png'), 'JS: a line starting with a private field is not a `#` comment, its reference is read')
}

head('the rest of the audit is unchanged')
{
  const bom = audit({ '/api/bom.php': '﻿<?php\n// a byte-order mark before the open tag\n' })
  is(bom.status === 1 && /BOM before <\?php/.test(bom.out), 'a BOM before <?php is still HIGH')
  const empty = audit({ '/empty.css': '' })
  is(empty.status === 1 && /zero-byte file/.test(empty.out), 'a zero-byte file is still HIGH')
  const secret = audit({ '/api/config.php': '<?php return [];\n' })
  is(secret.status === 1 && /must never ship: \/api\/config\.php/.test(secret.out), 'a shipped api/config.php is still HIGH')
}

head('the three shipped files no longer name a source file')
{
  for (const [file, path] of [['dropin/php-store/assistant.php', 'src/pages/Privacy.jsx'],
                              ['public/birthday.js', 'src/lib/cart.jsx'],
                              ['public/sporta-admin-brands.js', 'src/i18n/translations.js']]) {
    const text = readFileSync(join(WEB, file), 'utf8')
    is(!text.includes(path), `${file} no longer says ${path}`)
  }
}

console.log(fails ? `\n${fails} problem(s) in file-audit.mjs` : '\nfile-audit.mjs: comments are not references, code and markup still are')
process.exit(fails ? 1 : 0)
