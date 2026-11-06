// The AHED purchase cost never reaches the browser (owner: "move all secret from frontend to backend").
//
//   npm run test:ahed-cost     (builds dist/ with the release settings; needs php on PATH; no sandbox)
//
// The cost table and the dirham rate used to sit in src/lib/ahed.js, which the storefront bundle carried. They now
// live in dropin/php-store/ahed-cost.php and are read by admin.php?r=ahed_cost, behind the admin session. This proves:
//   1. the storefront module has no cost, no rate and no cost function;
//   2. no built JavaScript file carries the cost table or the rate (the admin screen fetches them);
//   3. the PHP file answers nothing to a direct request, and returns the table only when admin.php has loaded it;
//   4. the admin route's KWD conversion matches the rounding the storefront module used (Math.round to 3 places);
//   5. the Inventory screen takes its cost from the server, not from a module.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

// 1. the storefront module
head('storefront module')
const mod = readFileSync(join(ROOT, 'src/lib/ahed.js'), 'utf8')
is(!/AHED_COST_AED|aedPerKwd|ahedCostKwd|AHED_FX/.test(mod), 'src/lib/ahed.js carries no cost, rate or cost function')
is(!/"A-CSJ-AR-L"\s*:\s*75|'A-CSJ-AR-L'\s*:\s*75/.test(mod), 'and no cost value for any SKU')

// 2. the built bundles
head('built bundles')
execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_PHP_API_URL: '' } })
const jsFiles = []
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) jsFiles.push(p) } }
walk(join(ROOT, 'dist'))
const leaks = jsFiles.filter((f) => {
  const s = readFileSync(f, 'utf8')
  // The VALUES must not be in any bundle: the rate 11.95 and the cost pairs. The property name "aedPerKwd" is only the
  // key the Inventory screen reads from the server's answer, and it carries no number.
  return /11\.95\b/.test(s) || /["']A-CSJ-AR-L["']\s*:\s*75/.test(s) || /AHED_COST_AED/.test(s)
})
is(jsFiles.length > 0 && leaks.length === 0, `no built JavaScript file (${jsFiles.length} checked) carries the cost table or the rate`, leaks.map((f) => f.split('/dist/')[1]).join(', '))

// 3. the PHP file
head('the PHP file')
const phpPath = join(ROOT, 'dropin/php-store/ahed-cost.php')
const direct = execFileSync('php', [phpPath], { encoding: 'utf8' })
is(direct.trim() === '', 'a direct request prints nothing (the file exits before it returns the table)')
const loaded = execFileSync('php', ['-r', `define('SPORTA_ADMIN_AHED_COST', true); $a = require '${phpPath}'; echo json_encode($a);`], { encoding: 'utf8' })
const table = JSON.parse(loaded)
is(table.fx && table.fx.aedPerKwd === 11.95 && typeof table.fx.asOf === 'string', 'with admin.php loaded, the file returns the rate and its date')
is(Object.keys(table.aed).length === 42, '42 SKUs carry a cost', String(Object.keys(table.aed).length))

// 4. the rounding the route applies, against the formula the storefront module used
head('KWD conversion')
const rate = table.fx.aedPerKwd
const phpKwd = JSON.parse(execFileSync('php', ['-r', `$r = ${rate}; $out = []; foreach (json_decode('${JSON.stringify(table.aed).replace(/'/g, "\\'")}', true) as $k => $v) { $out[$k] = floor(($v / $r) * 1000 + 0.5) / 1000; } echo json_encode($out);`], { encoding: 'utf8' }))
const jsKwd = Object.fromEntries(Object.entries(table.aed).map(([k, v]) => [k, Math.round((v / rate) * 1000) / 1000]))
const mismatches = Object.keys(jsKwd).filter((k) => Math.abs(jsKwd[k] - phpKwd[k]) > 1e-9)
is(mismatches.length === 0, 'the route and the old module agree on every SKU', mismatches.join(', '))

// 5. the Inventory screen
head('admin Inventory')
const inv = readFileSync(join(ROOT, 'src/admin/Inventory.jsx'), 'utf8')
is(!/ahedCostKwd|AHED_FX/.test(inv), 'Inventory.jsx no longer imports the cost from the module')
is(/fetchAhedCost/.test(inv), 'and takes the cost from the admin API')

console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
