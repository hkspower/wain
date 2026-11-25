const fs = require('fs')
const cp = require('child_process')
const CFG = '/sporta/private/api-config.php'
const text = fs.readFileSync(CFG, 'utf8')
const pick = (k) => {
  const lit = text.match(new RegExp("['\"]" + k + "['\"]\\s*=>\\s*['\"]([^'\"]*)['\"]"))
  if (lit) return lit[1]
  const f = text.match(new RegExp("['\"]" + k + "['\"]\\s*=>[^\\n]*?file_get_contents\\(\\s*['\"]([^'\"]+)['\"]"))
  if (f) { for (const cand of [f[1], '/sporta/private/' + k]) { try { return fs.readFileSync(cand, 'utf8').trim() } catch (e) { /* try the next */ } } console.log('FAIL cannot read the file named for ' + k); process.exit(1) }
  return null
}
const keysSeen = (text.match(/['\"][a-z_]*(db|mysql)[a-z_]*['\"]\s*(=>|:|=)/gi) || []).map((k) => k.replace(/\s*(=>|:|=)$/, '')).join(' ')
console.log('CFG_KEYS ' + keysSeen)
for (const k of ['db_host','db_name','db_user','db_pass']) { const m = text.match(new RegExp('.*' + k + '.*')); console.log('SHAPE ' + (m ? m[0].replace(/[A-Za-z0-9]/g, 'x') : 'none')) }
const host = pick('db_host'), name = pick('db_name'), user = pick('db_user'), pass = pick('db_pass')
const dbHost = host === 'mariadb' ? '127.0.0.1' : host   // the job shares the database container's network namespace
if (!host || !name || !user || pass === null) { console.log('FAIL config keys missing (names above, no values printed)'); process.exit(1) }
fs.writeFileSync('/tmp/my.cnf', '[client]\nhost=' + dbHost + '\nuser=' + user + '\npassword=' + pass + '\ndatabase=' + name + '\n', { mode: 0o600 })
console.log('DB ' + host + ' ' + name)
const tryRun = (fn, label) => { try { return fn() } catch (e) { console.log('FAIL ' + label + ': ' + String(e.stderr || e.message).split('\n').slice(0, 3).join(' | ').slice(0, 400)); process.exit(1) } }
const q = (sql) => tryRun(() => cp.execFileSync('mariadb', ['--defaults-extra-file=/tmp/my.cnf', '-N', '-B', '-e', sql], { encoding: 'utf8' }), 'query')
const want = {
  'cagliari-calcio-sweatshirt-navy': { S: 0, M: 12, L: 9, XL: 16, '2XL': 20, '3XL': 3, '4XL': 1, '5XL': 3 },
  'sgomma-t-shirt-navy': { S: 1 },
  'tekno-shorts-black': { S: 1, L: 1, '2XL': 1 },
  'vanquish-tank-navy': { '3XL': 1 }
}
const slugs = Object.keys(want).map((s) => "'" + s + "'").join(',')
const rows = q('SELECT sku, slug, size, stock, inventory_version FROM product_variants WHERE slug IN (' + slugs + ') ORDER BY slug, size').trim().split('\n').filter(Boolean).map((l) => l.split('\t'))
console.log('CURRENT ' + rows.length + ' rows')
for (const r of rows) console.log('  ' + r.join(' '))
const plan = []
for (const slug of Object.keys(want)) {
  const have = rows.filter((r) => r[1] === slug)
  for (const size of Object.keys(want[slug])) {
    const r = have.find((x) => x[2] === size)
    if (!r) { console.log('FAIL no SKU for ' + slug + ' ' + size); process.exit(1) }
    plan.push({ sku: r[0], slug, size, before: Number(r[3]), after: want[slug][size], ver: Number(r[4]) })
  }
  for (const r of have) if (!(r[2] in want[slug])) plan.push({ sku: r[0], slug, size: r[2], before: Number(r[3]), after: 0, ver: Number(r[4]) })
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
const bk = '/bk/inv-backup-' + stamp + '.sql'
cp.execFileSync('mariadb-dump', ['--defaults-extra-file=/tmp/my.cnf', '--single-transaction', name, 'product_variants', 'inventory_movements'], { encoding: 'utf8', stdio: ['ignore', fs.openSync(bk, 'w'), 'inherit'] })
const bsize = fs.statSync(bk).size
console.log('BACKUP ' + bk + ' ' + bsize + ' bytes')
if (bsize < 500) { console.log('FAIL backup too small'); process.exit(1) }
const sqlFor = (p) => {
  const note = 'Physical count, workbook 2026-11-25 (owner)'
  const s = []
  s.push("UPDATE product_variants SET stock = " + p.after + ", inventory_version = inventory_version + 1 WHERE sku = '" + p.sku + "' AND inventory_version = " + p.ver + " AND stock = " + p.before + ";")
  s.push("INSERT INTO inventory_movements (sku, type, before_stock, after_stock, delta, before_low_stock_threshold, after_low_stock_threshold, inventory_version, note, actor_email) SELECT sku, 'count', " + p.before + ", " + p.after + ", " + (p.after - p.before) + ", low_stock_threshold, low_stock_threshold, inventory_version, '" + note + "', 'owner-direct' FROM product_variants WHERE sku = '" + p.sku + "' AND inventory_version = " + (p.ver + 1) + " AND stock = " + p.after + ";")
  return s.join('\n')
}
const verify = "SELECT COUNT(*) FROM product_variants WHERE sku IN (" + plan.map((p) => "'" + p.sku + "'").join(',') + ") AND stock NOT IN (0);"
const body = plan.map(sqlFor).join('\n')
const run = (commit) => cp.execFileSync('mariadb', ['--defaults-extra-file=/tmp/my.cnf', '-N', '-B'], { encoding: 'utf8', input: 'START TRANSACTION;\n' + body + '\nSELECT ROW_COUNT() AS dummy;\nSELECT COUNT(*) AS movements FROM inventory_movements WHERE type = ' + "'count'" + ' AND note LIKE ' + "'Physical count, workbook 2026-11-25%'" + ';\n' + (commit ? 'COMMIT;' : 'ROLLBACK;') + '\n' })
const dry = tryRun(() => run(false), 'dry run')
console.log('DRY ' + dry.trim().split('\n').join(' | '))
const expectUpdates = plan.filter((p) => p.before !== p.after).length
const expectRows = plan.length
const movementsDry = Number(dry.trim().split('\n').pop())
if (movementsDry !== expectUpdates) { console.log('FAIL dry run would write ' + movementsDry + ' movements, expected ' + expectUpdates + ' (a version or stock moved since the read)'); process.exit(1) }
tryRun(() => run(true), 'commit run')
const after = q('SELECT sku, slug, size, stock, inventory_version FROM product_variants WHERE slug IN (' + slugs + ') ORDER BY slug, size').trim().split('\n').filter(Boolean).map((l) => l.split('\t'))
console.log('AFTER ' + after.length + ' rows')
for (const r of after) console.log('  ' + r.join(' '))
const bad = plan.filter((p) => { const r = after.find((x) => x[0] === p.sku); return !r || Number(r[3]) !== p.after })
console.log(bad.length === 0 ? 'STOCK_OK all ' + plan.length + ' sizes match the workbook' : 'STOCK_MISMATCH ' + bad.length)
