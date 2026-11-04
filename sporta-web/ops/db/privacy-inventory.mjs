#!/usr/bin/env node
// Renders the generated inventory block of DATA-PROTECTION.md from data-protection.mjs.
//
//   node ops/db/privacy-inventory.mjs            rewrite the block between the GENERATED markers
//   node ops/db/privacy-inventory.mjs --check    exit 1 when the block is stale
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIVE_ONLY, POLICY, TABLES } from './data-protection.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILE = join(HERE, 'DATA-PROTECTION.md')
const BEGIN = '<!-- GENERATED:INVENTORY:BEGIN (node ops/db/privacy-inventory.mjs) -->'
const END = '<!-- GENERATED:INVENTORY:END -->'
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function renderInventory() {
  let o = `${BEGIN}\n\n`
  const counts = { personal: 0, staff: 0, secret: 0, pseudonym: 0, operational: 0 }
  for (const spec of Object.values(TABLES)) {
    for (const m of Object.values(spec.columns || {})) counts[m.class]++
    counts.operational += (spec.operational || []).length
  }
  o += `${Object.keys(TABLES).length} tables in the repo schema. Columns: ${counts.personal} personal, ${counts.staff} staff, ${counts.secret} secret, ${counts.pseudonym} pseudonym, ${counts.operational} operational (no personal data). Default retention policy: ${Object.entries(POLICY).map(([k, v]) => `${k} = ${v}`).join(', ')}.\n\n`
  for (const [table, spec] of Object.entries(TABLES)) {
    const cols = Object.entries(spec.columns || {})
    if (!cols.length) continue
    o += `#### \`${table}\`: ${spec.purpose}\n\n| Column | Class | Needed? | Retention | Who reads it | Stored as | Where else it shows |\n|---|---|---|---|---|---|---|\n`
    for (const [c, m] of cols) o += `| \`${c}\` | ${m.class} | ${esc(m.needed)} | ${esc(m.retention)} | ${esc(m.readers)} | ${esc(m.storage)} | ${esc(m.exposure)} |\n`
    if (spec.note) o += `\n${spec.note}\n`
    o += '\n'
  }
  const noPii = Object.entries(TABLES).filter(([, s]) => !Object.keys(s.columns || {}).length).map(([t]) => t)
  o += `Tables with no personal or secret column: ${noPii.map((t) => `\`${t}\``).join(', ')}.\n\n`
  o += `#### Tables the live database holds that the repo schema does not create\n\n| Table | What it holds | What to do |\n|---|---|---|\n`
  for (const x of LIVE_ONLY) o += `| ${esc(x.table)} | ${esc(x.holds)} | ${esc(x.action)} |\n`
  return `${o}\n${END}`
}

function splice(doc, block) {
  const a = doc.indexOf(BEGIN), b = doc.indexOf(END)
  if (a < 0 || b < 0) throw new Error('GENERATED markers not found in DATA-PROTECTION.md')
  return doc.slice(0, a) + block + doc.slice(b + END.length)
}

if (process.argv[1] && process.argv[1].endsWith('privacy-inventory.mjs')) {
  const doc = readFileSync(FILE, 'utf8')
  const next = splice(doc, renderInventory())
  if (process.argv.includes('--check')) {
    if (next !== doc) { console.log('STALE DATA-PROTECTION.md inventory block'); process.exit(1) }
    console.log('ok    DATA-PROTECTION.md inventory block is current'); process.exit(0)
  }
  writeFileSync(FILE, next); console.log('wrote DATA-PROTECTION.md inventory block')
}
