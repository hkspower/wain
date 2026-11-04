// sql-privileges.mjs — turn the SQL the PHP can send into "which table needs
// which privilege", per entry point.
//
// Two inputs: the output of scripts/lib/php-sql-map.php (every string
// expression, per function, with the function calls) and the list of tables the
// repo's migrations define. A string is only counted when it starts like a SQL
// statement AND names a real table, so an error message that says "update your
// browser" is never a privilege.
//
// The result for an entry point is the UNION over every function it can reach
// by name (calls followed through the whole code base, `require` edges
// included). That over-approximates (a route that is never taken still counts),
// which is the safe direction for a privilege list: the grant may be a little
// wider than a given request needs, never narrower than the code can use.
//
// Shapes:   privs = { [table]: { select, insert, update:Set<col|'*'>, delete, lock, show } }
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------- the tables
// Every `create table [if not exists] name` in the migrations: the universe the
// application is allowed to know about. The live database also holds ~40 tables
// from the old build that NO code here reads; they are not in this list on
// purpose, so no account is ever granted them.
export function schemaTables(sqlDirs) {
  const names = new Set()
  for (const dir of sqlDirs) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.mysql.sql') && n !== 'install.mysql.sql')) {
      const text = readFileSync(join(dir, f), 'utf8').replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      for (const m of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?`?([a-z_][a-z0-9_]*)`?/gi)) names.add(m[1].toLowerCase())
    }
  }
  return names
}

const norm = (s) => String(s).replace(/`/g, '').replace(/\{\$[A-Za-z_]+\}/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
const ident = '([a-z_][a-z0-9_]*)'

function blank() { return { select: false, insert: false, update: new Set(), delete: false, lock: false, show: false, forUpdate: false } }
export function addPriv(into, table, kind, cols) {
  const t = (into[table] ??= blank())
  if (kind === 'update') { for (const c of cols?.length ? cols : ['*']) t.update.add(c) } else t[kind] = true
}
export function mergePrivs(into, from) {
  for (const [table, p] of Object.entries(from)) {
    const t = (into[table] ??= blank())
    for (const k of ['select', 'insert', 'delete', 'lock', 'show', 'forUpdate']) t[k] ||= p[k]
    for (const c of p.update) t.update.add(c)
  }
  return into
}

// Split "a = ?, b = coalesce(c, ?), d = d + 1" at top-level commas -> column names.
function setColumns(setClause) {
  const cols = []
  let depth = 0, start = 0
  const parts = []
  for (let i = 0; i <= setClause.length; i++) {
    const ch = setClause[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if ((ch === ',' && depth === 0) || i === setClause.length) { parts.push(setClause.slice(start, i)); start = i + 1 }
  }
  for (const p of parts) {
    const m = p.trim().match(/^(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s*=/)
    if (m) cols.push(m[1])
  }
  return cols
}

// One string -> { privs, stmt } or null when it is not a statement on a known table.
export function classify(text, tables) {
  const s = norm(text)
  const known = (t) => tables.has(t)
  const privs = {}
  let kind = null

  // Aliases: "from orders o", "join order_items oi" -> map alias -> table, so
  // `update orders o ... set o.col = ...` and `delete o from orders o` resolve.
  const alias = {}
  for (const m of s.matchAll(new RegExp(`\\b(?:from|join|update|into)\\s+${ident}(?:\\s+(?:as\\s+)?(?!set\\b|where\\b|on\\b|join\\b|left\\b|right\\b|inner\\b|cross\\b|group\\b|order\\b|limit\\b|values\\b|for\\b|using\\b|having\\b|union\\b)${ident})?`, 'g'))) {
    if (known(m[1]) && m[2]) alias[m[2]] = m[1]
    if (known(m[1])) alias[m[1]] = m[1]
  }

  const verb = s.match(/^(select|insert|replace|update|delete|show|lock|with)\b/)?.[1]
  if (!verb) return null

  const reads = new Set()
  const collectReads = (str) => {
    for (const m of str.matchAll(new RegExp(`\\b(?:from|join)\\s+${ident}`, 'g'))) if (known(m[1])) reads.add(m[1])
    // comma joins: "from a x, b y"
    for (const m of str.matchAll(new RegExp(`\\bfrom\\s+${ident}(?:\\s+(?:as\\s+)?${ident})?\\s*,\\s*${ident}`, 'g'))) if (known(m[3])) reads.add(m[3])
  }

  if (verb === 'show') {
    const m = s.match(new RegExp(`^show (?:full )?columns from ${ident}`))
    if (m && known(m[1])) addPriv(privs, m[1], 'show')
    else return null
    return { verb, privs }
  }
  if (verb === 'lock') return { verb, privs, lockTables: true }

  if (verb === 'insert' || verb === 'replace') {
    const m = s.match(new RegExp(`^(?:insert|replace)\\s+(?:low_priority |delayed |high_priority )?(?:ignore )?(?:into )?${ident}\\s*(?:\\(([^)]*)\\))?`))
    if (!m || !known(m[1])) return null
    addPriv(privs, m[1], 'insert')
    if (verb === 'replace') { addPriv(privs, m[1], 'delete') }
    collectReads(s.slice(m[0].length))
    for (const t of reads) addPriv(privs, t, 'select')
    const odk = s.match(/on duplicate key update (.*)$/)
    if (odk) addPriv(privs, m[1], 'update', setColumns(odk[1]))
    return { verb, privs }
  }

  if (verb === 'update') {
    const m = s.match(new RegExp(`^update\\s+(?:low_priority )?(?:ignore )?${ident}`))
    if (!m || !known(m[1])) return null
    const setAt = s.indexOf(' set ')
    const head = setAt > 0 ? s.slice(0, setAt) : s
    collectReads(head)
    const afterSet = setAt > 0 ? s.slice(setAt + 5) : ''
    // The SET list ends at WHERE (top level); a sub-select in it adds reads.
    const whereAt = afterSet.search(/\swhere\s|\sorder by\s|\slimit\s/)
    const setClause = whereAt >= 0 ? afterSet.slice(0, whereAt) : afterSet
    const cols = []
    // qualified columns `o.status = ...` resolve through the alias map.
    const parts = setColumns(setClause.replace(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*=/g, (_, a, c) => `${c} =@${alias[a] ?? a}@`))
    for (const c of parts) cols.push(c)
    addPriv(privs, m[1], 'update', cols)
    // multi-table update: another table named in the head with a qualified SET column
    for (const q of setClause.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*=/g)) {
      const tbl = alias[q[1]] ?? q[1]
      if (known(tbl) && tbl !== m[1]) addPriv(privs, tbl, 'update', [q[2]])
    }
    collectReads(afterSet)
    for (const t of reads) addPriv(privs, t, 'select')
    // the target is also read by its own WHERE: UPDATE needs SELECT on columns the WHERE reads
    addPriv(privs, m[1], 'select')
    return { verb, privs }
  }

  if (verb === 'delete') {
    // delete from t ... | delete a from a join b ...
    const m = s.match(new RegExp(`^delete\\s+(?:low_priority |quick |ignore )*(?:from\\s+${ident}|${ident}(?:\\s*,\\s*${ident})*\\s+from)`))
    if (!m) return null
    const target = known(m[1] ?? '') ? m[1] : (alias[m[2]] ?? m[2])
    if (!known(target)) return null
    addPriv(privs, target, 'delete')
    collectReads(s)
    for (const t of reads) addPriv(privs, t, 'select')
    addPriv(privs, target, 'select')
    return { verb, privs }
  }

  // select / with
  collectReads(s)
  for (const t of reads) addPriv(privs, t, 'select')
  if (/\bfor update\b/.test(s)) for (const t of reads) { privs[t].forUpdate = true }
  if (!Object.keys(privs).length) return null
  return { verb: 'select', privs }
}

// ------------------------------------------------------- reach from an entry
// map: output of php-sql-map.php. `files` is the set of map keys that make up
// the loaded program for this entry (the entry file plus every file it can
// include). Functions are resolved by NAME across `files`.
//
// A fragment that is not a statement of its own (`$sql .= ' join products ...'`)
// still names tables; those are counted as SELECT, the least a mention can mean
// (a write is always a full statement that starts with its verb).
export function programPrivileges(map, entryKey, tables, { files, extraCalls = [] }) {
  const funcs = new Map()      // name -> {file, def}
  for (const f of files) for (const [n, def] of Object.entries(map[f]?.funcs ?? {})) funcs.set(n, { file: f, def })
  const entry = map[entryKey]
  const out = {}
  const why = {}               // "table:priv" -> "file#func line N"  (first place that needs it)
  const seen = new Set()
  const statements = []
  const queue = [{ file: entryKey, name: '(top)', def: entry.top, from: null }]
  // an entry that includes another file at top level also runs that file's top level
  for (const inc of entry.top.includes ?? []) {
    const key = [...files].find((f) => f.endsWith('/' + inc.replace(/^.*\//, '')) || f === inc)
    if (key && key !== entryKey && map[key]) queue.push({ file: key, name: '(top)', def: map[key].top, from: entryKey })
  }
  for (const c of extraCalls) if (funcs.has(c)) queue.push({ file: funcs.get(c).file, name: c, def: funcs.get(c).def, from: 'extra' })
  const names = [...tables].join('|')
  const loose = names ? new RegExp(`\\b(?:from|join)\\s+\`?(${names})\\b`, 'gi') : null
  while (queue.length) {
    const { file, name, def, from } = queue.shift()
    const id = `${file}#${name}`
    if (seen.has(id)) continue
    seen.add(id)
    for (const frag of def.sql ?? []) {
      const c = classify(frag.text, tables)
      const where = `${file}#${name} line ${frag.line}${from ? ` (via ${from})` : ''}`
      if (c && !c.lockTables) {
        mergePrivs(out, c.privs)
        statements.push({ file, func: name, line: frag.line, verb: c.verb, tables: Object.keys(c.privs) })
        for (const [t, p] of Object.entries(c.privs)) {
          for (const k of ['select', 'insert', 'delete', 'forUpdate', 'show']) if (p[k]) why[`${t}:${k}`] ??= where
          for (const col of p.update) why[`${t}:update(${col})`] ??= where
        }
      } else if (c?.lockTables) {
        statements.push({ file, func: name, line: frag.line, verb: 'lock tables', tables: [] })
      } else if (loose) {
        for (const m of String(frag.text).replace(/\`/g, '').matchAll(loose)) {
          addPriv(out, m[1].toLowerCase(), 'select')
          why[`${m[1].toLowerCase()}:select`] ??= `${where} (fragment)`
          statements.push({ file, func: name, line: frag.line, verb: 'fragment', tables: [m[1].toLowerCase()] })
        }
      }
    }
    for (const callee of def.calls ?? []) {
      const hit = funcs.get(callee)
      if (hit) queue.push({ file: hit.file, name: callee, def: hit.def, from: name })
    }
  }
  return { privs: out, statements, why }
}

export function summarise(privs) {
  const rows = {}
  for (const [t, p] of Object.entries(privs)) {
    const v = []
    if (p.select) v.push('SELECT')
    if (p.insert) v.push('INSERT')
    if (p.update.size) v.push(p.update.has('*') ? 'UPDATE' : `UPDATE(${[...p.update].sort().join(',')})`)
    if (p.delete) v.push('DELETE')
    if (p.show && !v.length) v.push('(any, for SHOW COLUMNS)')
    rows[t] = v
  }
  return rows
}
