#!/usr/bin/env node
// DB COLUMNS AUDIT — every column the code touches versus every column the schema defines.
//
//   node scripts/db-columns-audit.mjs                       run everything on a private MariaDB, print the findings
//   node scripts/db-columns-audit.mjs --out DIR             also write the JSON + markdown tables into DIR
//   node scripts/db-columns-audit.mjs --quick               skip the migration-order shuffles and the real-route length probe
//   node scripts/db-columns-audit.mjs --no-routes           skip only the real-route length probe
//   node scripts/db-columns-audit.mjs --client DIR ...      extra directories of client JavaScript (compiled bundles) to read field names from
//   node scripts/db-columns-audit.mjs --out DIR --reuse DIR recompute the findings from a previous run's schema diff and route probe
//
// The route probe needs scripts/lib/race-rig.mjs (its own MariaDB and PHP workers); everything else needs only mariadbd and php.
//
// WHY IT EXISTS. The proven failure of this project is column drift between the PHP and the database:
// on 2026-11-02 the live DB lacked inventory.mysql.sql, so a column the live code writes
// (product_variants.inventory_version) did not exist and every order answered 500 for 33 days; a
// Profiles screen answered 503 because a query named customer_accounts.last_login_at, which no
// migration ever created. A regex over the PHP cannot find those; MariaDB can. So this tool
//
//   A. builds the schema on a private MariaDB (db-schema-diff.mjs: install.mysql.sql, the migrations in
//      the tooling order and the docs order, twice, shuffled) and compares the results;
//   B. extracts EVERY SQL statement from the PHP with PHP's own tokenizer (token_get_all: concatenations,
//      heredocs, sprintf, implode column lists, ternaries, `$sql .= ...` continuations), enumerates what
//      each dynamic fragment can expand to, and asks MariaDB to EXPLAIN each expansion against the schema,
//      so "Unknown column", "Unknown table", a wrong column count and a syntax error all surface as
//      MariaDB's own errors; statements the code guards with store_column_exists() / SHOW COLUMNS are
//      checked for a guard that names the same column;
//   C. classifies every column the schema defines: used (read and written), write-only, read-only (never
//      written by this codebase: who writes it?), or dead, and says whether the compiled client or an
//      add-on mentions the field name, so a column a screen shows is never called dead;
//   D. compares every validation cap the PHP enforces with the column that stores the value (characters
//      AND bytes, utf8mb4), flags INSERTs that leave a NOT NULL column without a default to the server's
//      strict mode, and probes the real routes on a private stack with the longest accepted value under
//      the server's default (strict) sql_mode and under a lax one.
//
// NOTHING HERE TOUCHES A REAL DATABASE: it starts its own MariaDB (own datadir, own port from 34100,
// own socket), never connects to the shared test rig, never opens a repository file for writing, and
// removes everything it starts. The PHP extractor is embedded at the end of this file (so the tool is
// one file plus db-schema-diff.mjs) and run with `php` over stdin.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startPrivateMariadb } from './lib/private-mariadb.mjs'
import {
  SQLDIR, WEB, applyFile, applyAll, freshDb, snapshot, sqlInventory, toolingOrder, runSchemaDiff, summarise as summariseSchema,
} from './db-schema-diff.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(WEB, '..')
const SELF = fileURLToPath(import.meta.url)

// ================================================================= 1. extraction (PHP tokenizer)

// The embedded extractor lives after the marker line at the end of this file.
// the markers are built by concatenation so this function never matches its own source
const MARK_A = '/*__PHP_' + 'EXTRACTOR__'
const MARK_B = '__PHP_EXTRACTOR_' + 'END__*/'
export function phpExtractorSource() {
  const src = readFileSync(SELF, 'utf8')
  const a = src.indexOf(MARK_A)
  const b = src.indexOf(MARK_B)
  return src.slice(src.indexOf('\n', a) + 1, b)
}

export function extractStatements(web = WEB, extraFiles = []) {
  const dir = mkdtempSync(join(tmpdir(), 'dbcols-php-'))
  try {
    const file = join(dir, 'extract.php')
    writeFileSync(file, phpExtractorSource())
    const r = spawnSync('php', ['-d', 'display_errors=0', file, web, ...extraFiles], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    if (r.status !== 0) throw new Error(`the PHP extractor failed: ${(r.stderr || r.stdout).slice(0, 400)}`)
    return JSON.parse(r.stdout)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// ================================================================= 2. a small SQL lexer

const KW = new Set(('select from where join left right inner outer cross on using group by order having limit offset union all distinct as and or not in is null like between exists case when then else end '
  + 'insert into values update set delete replace ignore duplicate key for with recursive asc desc interval true false default current_timestamp now escape regexp rlike '
  + 'minute hour day second month year week skip locked lock share natural straight_join partition over unsigned signed char binary decimal date datetime time integer int separator '
  + 'any some div mod xor collate character charset elseif if').split(' '))
export const RESERVED_OPERAND = new Set(['null', 'true', 'false', 'default', 'current_timestamp', 'now', 'unsigned', 'signed', 'char', 'binary', 'decimal', 'date', 'datetime', 'time', 'integer', 'int',
  'minute', 'hour', 'day', 'second', 'month', 'year', 'week', 'asc', 'desc', 'separator', 'interval', 'escape', 'distinct', 'current_date', 'current_time', 'utf8mb4', 'values'])

export function lexSql(sql) {
  const out = []
  let i = 0
  const n = sql.length
  const push = (t, v, from, to, extra = {}) => out.push({ t, v, i: from, e: to, ...extra })
  while (i < n) {
    const c = sql[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '-' && sql[i + 1] === '-' && /\s/.test(sql[i + 2] ?? ' ')) { while (i < n && sql[i] !== '\n') i++; continue }
    if (c === '#') { while (i < n && sql[i] !== '\n') i++; continue }
    if (c === '/' && sql[i + 1] === '*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue }
    if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n) { if (sql[j] === '\\') { j += 2; continue } if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue } break } j++ }
      push('str', sql.slice(i, j + 1), i, j + 1); i = j + 1; continue
    }
    if (c === '`') { const e = sql.indexOf('`', i + 1); const j = e < 0 ? n : e; push('id', sql.slice(i + 1, j), i, j + 1, { q: true }); i = j + 1; continue }
    if (c === '?') { push('param', '?', i, i + 1); i++; continue }
    if (c === ':' && /[A-Za-z_]/.test(sql[i + 1] ?? '') && sql[i - 1] !== ':' && sql[i + 1] !== '=') {
      let j = i + 1; while (j < n && /\w/.test(sql[j])) j++
      push('param', sql.slice(i, j), i, j); i = j; continue
    }
    if (c === '@') { let j = i + 1; while (j < n && /[\w@.$]/.test(sql[j])) j++; push('var', sql.slice(i, j), i, j); i = j; continue }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      let j = i; while (j < n && /[0-9.]/.test(sql[j])) j++
      if (/[eE]/.test(sql[j] ?? '') && /[-+0-9]/.test(sql[j + 1] ?? '')) { j += 2; while (j < n && /[0-9]/.test(sql[j])) j++ }
      push('num', sql.slice(i, j), i, j); i = j; continue
    }
    if (/[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 127) {
      let j = i; while (j < n && (/[\w$]/.test(sql[j]) || sql.charCodeAt(j) > 127)) j++
      push('id', sql.slice(i, j), i, j); i = j; continue
    }
    const two = sql.slice(i, i + 3) === '<=>' ? '<=>' : sql.slice(i, i + 2)
    if (['<=>', '<=', '>=', '<>', '!=', ':=', '||', '&&', '<<', '>>'].includes(two)) { push('op', two, i, i + two.length); i += two.length; continue }
    push('op', c, i, i + 1); i++
  }
  return out
}
const up = (tok) => (tok && tok.t === 'id' && !tok.q ? tok.v.toUpperCase() : '')

// Replace placeholders with literals that keep the statement valid, drop comments and put it on one line.
export function bindPlaceholders(sql) {
  const toks = lexSql(sql)
  let out = ''
  let prevEnd = 0
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]
    const gap = sql.slice(prevEnd, tk.i)
    out += gap === '' ? '' : ' '
    if (tk.t === 'param') {
      const p1 = up(toks[k - 1]), p2 = up(toks[k - 2])
      const afterLimit = p1 === 'LIMIT' || p1 === 'OFFSET' || (toks[k - 1]?.v === ',' && (p2 === 'LIMIT' || up(toks[k - 3]) === 'LIMIT'))
      out += afterLimit || p1 === 'INTERVAL' ? '1' : 'NULL'
    } else out += sql.slice(tk.i, tk.e)
    prevEnd = tk.e
  }
  return out.replace(/[\r\n]+/g, ' ').trim()
}

// ================================================================= 3. expanding the dynamic fragments

const lit = (s) => [{ pieces: [['lit', s]] }]
const MAX_ALTS = 24

// Reaching definitions of $name at `line` inside one function (or the file scope).
function reaching(ex, st, name, line) {
  const defs = ex.funcvars[`${st.file}::${st.func}`]?.[name] ?? []
  const upto = defs.filter((d) => d.line <= line)
  let base = -1
  for (let k = upto.length - 1; k >= 0; k--) if (upto[k].op === '=' || upto[k].op === 'array') { base = k; break }
  if (base < 0) return { base: null, appends: upto.filter((d) => d.op !== '=' && d.op !== 'array') }
  return { base: upto[base], appends: upto.slice(base + 1) }
}

const cartesian = (lists, cap = MAX_ALTS) => {
  let acc = ['']
  for (const l of lists) {
    const next = []
    for (const a of acc) for (const b of l) { next.push(a + b); if (next.length >= cap) break }
    acc = next.length ? next : acc
  }
  return acc
}

export function makeExpander(ex, consts = ex.consts ?? {}) {
  const unresolved = new Set()
  let depth = 0
  const renderPieces = (st, pieces, line) => cartesian(pieces.map((p) => renderPiece(st, p, line)))
  const renderPiece = (st, p, line) => {
    const [kind, a, b, c] = p
    if (kind === 'lit') return [a]
    if (kind === 'alt') return [...new Set([...renderPieces(st, a, line), ...renderPieces(st, b, line)])]
    if (kind === 'var') return renderVar(st, a, line)
    if (kind === 'expr') return renderExpr(st, a, line)
    return ['']
  }
  const renderVar = (st, name, line) => {
    if (depth > 6) { unresolved.add(name); return ['1'] }
    const { base, appends } = reaching(ex, st, name, line)
    if (!base) {
      if (st.paramEmpty) return ['']
      const lv = loopVar(st, name, line)
      if (lv?.length) return lv.map((k) => k)
      return heuristic(name)
    }
    depth++
    try {
      let alts
      if (base.op === 'array') alts = [(base.items ?? []).map((it) => renderPieces(st, it, base.line)[0] ?? '').join(', ')]
      else alts = renderPieces(st, base.pieces, base.line)
      for (const ap of appends) {
        if (ap.op !== '.=') continue
        const extra = renderPieces(st, ap.pieces, ap.line)
        alts = cartesian([alts, extra])
      }
      return alts.slice(0, MAX_ALTS)
    } finally { depth-- }
  }
  // `foreach ($allowed as $k)`: a loop variable is the union of the column list the loop walks
  const loopVar = (st, name, line) => {
    if (!/^\$(k|key|col|column|c|f|field)$/.test(name)) return null
    for (const cand of ['$allowed', '$cols', '$columns', '$fields']) {
      const { base } = reaching(ex, st, cand, line)
      if (!base) continue
      if (base.op === 'array' && (base.keys.length || base.items.length)) return base.keys.length ? base.keys : base.items.map((it) => renderPieces(st, it, base.line)[0] ?? '')
      if (base.op === '=' && base.pieces?.length === 1 && base.pieces[0][0] === 'expr') {
        const m = /^array_merge\(\s*array_keys\(\s*(\$\w+)\s*\)\s*,\s*\[([^\]]*)\]\s*\)$/.exec(base.pieces[0][1])
        if (m) return [...arrayKeys(st, m[1], line), ...[...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1])]
      }
    }
    return null
  }
  const heuristic = (name) => {
    if (/^\$(marks?|markers?|ph|in|placeholders|qs)$/i.test(name)) return ['?,?']
    if (/^\$(limit|offset|n|count)$/i.test(name)) return ['1']
    if (/^\$ids$/i.test(name)) return ['1,2']
    unresolved.add(name)
    return ['1']
  }
  // the items an array variable can hold, as rendered strings
  const arrayItems = (st, name, line) => {
    const { base, appends } = reaching(ex, st, name, line)
    const items = []
    if (base?.op === 'array') for (const it of base.items) items.push(...renderPieces(st, it, base.line).slice(0, 1))
    else if (base?.op === '=' && base.pieces?.length === 1 && base.pieces[0][0] === 'expr') {
      const m = /^array_keys\(\s*(\$\w+)\s*\)$/.exec(base.pieces[0][1])
      if (m) return arrayKeys(st, m[1], base.line).map((k) => k)
    }
    for (const ap of appends) if (ap.op === '[]=') items.push(...renderPieces(st, ap.pieces, ap.line))
    return items
  }
  const arrayKeys = (st, name, line) => {
    const { base, appends } = reaching(ex, st, name, line)
    const keys = []
    if (base?.op === 'array') keys.push(...base.keys)
    for (const ap of appends) { const m = /^\['k'\]=(.*)$/.exec(ap.op); if (m) keys.push(m[1]) }
    return [...new Set(keys)]
  }
  const renderExpr = (st, text, line) => {
    const t = text.trim()
    let m
    if ((m = /^implode\(\s*(['"])(.*?)\1\s*,\s*([\s\S]+)\)$/.exec(t))) {
      const sep = m[2]; const arg = m[3].trim()
      let items = null
      let mm
      if ((mm = /^(\$\w+)$/.exec(arg))) items = arrayItems(st, mm[1], line)
      else if ((mm = /^array_keys\(\s*(\$\w+)\s*\)$/.exec(arg))) items = arrayKeys(st, mm[1], line)
      else if ((mm = /^array_fill\(\s*\d+\s*,\s*count\(\s*(\$\w+)\s*\)\s*,/.exec(arg))) {
        const n = Math.max(arrayItems(st, mm[1], line).length, arrayKeys(st, mm[1], line).length) || 2
        items = Array.from({ length: n }, () => '?')
      }
      else if (/^array_fill\(/.test(arg)) items = ['?', '?']
      else if ((mm = /^array_map\(\s*fn\s*\(\s*\$\w+\s*\)\s*=>\s*\(int\)/.exec(arg))) items = ['1', '2']
      else if ((mm = /^array_map\(\s*fn\s*\(\s*\$(\w+)\s*\)\s*=>\s*(['"])([\s\S]*?)\2\s*,\s*([\s\S]+)\)$/.exec(arg))) {
        const [, v, , body, over] = mm
        const keys = /^array_keys\(\s*(\$\w+)\s*\)$/.test(over.trim()) ? arrayKeys(st, /\$\w+/.exec(over)[0], line) : arrayItems(st, over.trim(), line)
        items = keys.map((k) => body.replace(new RegExp(`\\{?\\$${v}\\}?`, 'g'), k))
      }
      if (items && items.length) return [items.join(sep)]
      unresolved.add(t); return ['1']
    }
    if ((m = /^max\(\s*\d+\s*,\s*min\(\s*\d+\s*,.*\)\s*\)$/.exec(t))) return ['1']
    if (/^\(int\)/.test(t) || /^intval\(/.test(t)) return ['1']
    if (/^[A-Z][A-Z0-9_]+$/.test(t)) {
      if (typeof consts[t] === 'number') return [String(consts[t])]
      if (ex.constStrings?.[t]) return [ex.constStrings[t]]
      unresolved.add(t); return ['1']
    }
    if ((m = /^([A-Za-z_]\w*)\s*\(/.exec(t)) && ex.fnreturns) {
      const key = Object.keys(ex.fnreturns).find((k) => k.endsWith(`::${m[1]}`))
      if (key) return [...new Set(ex.fnreturns[key].flatMap((pcs) => renderPieces({ file: key.split('::')[0], func: m[1], paramEmpty: true }, pcs, 1e9)))].slice(0, MAX_ALTS)
    }
    unresolved.add(t)
    return ['1']
  }
  return { renderPieces, unresolved, reset: () => unresolved.clear(), take: () => { const u = [...unresolved]; unresolved.clear(); return u } }
}

// Constants whose value is a string (const X = "'a', 'b'"): read straight from the source.
function stringConsts(web) {
  const out = {}
  for (const d of ['php-store', 'php-knet', 'php-cbk']) {
    const dir = join(web, 'dropin', d)
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.php'))) {
      const s = readFileSync(join(dir, f), 'utf8')
      for (const m of s.matchAll(/\bconst\s+([A-Z][A-Z0-9_]+)\s*=\s*(["'])((?:\\.|(?!\2)[^\\])*)\2\s*;/g)) out[m[1]] = m[3]
    }
  }
  return out
}

// Every statement as concrete SQL variants. `variants` is a list of strings (with ? still in place).
export function expandStatements(ex, web = WEB) {
  ex.constStrings = { ...stringConsts(web), ...(ex.constStrings ?? {}) }
  const X = makeExpander(ex)
  const out = []
  for (const st of ex.statements) {
    X.reset()
    // `$sql = '...'; ... $sql .= '...'` : the continuations after the statement, up to the next plain assignment
    const notes = []
    let alts = X.renderPieces(st, st.pieces, st.end_line ?? st.line)
    let dynamic = st.pieces.some((p) => p[0] !== 'lit')
    if (st.assigned) {
      const defs = ex.funcvars[`${st.file}::${st.func}`]?.[st.assigned] ?? []
      const nextAssign = defs.find((d) => (d.op === '=' || d.op === 'array') && d.line > st.line)?.line ?? Infinity
      const apps = defs.filter((d) => d.op === '.=' && d.line >= (st.end_line ?? st.line) && d.line < nextAssign)
      for (const ap of apps) { alts = cartesian([alts, X.renderPieces(st, ap.pieces, ap.line)]); dynamic = true }
      if (apps.length) notes.push(`${apps.length} appended fragment(s)`)
    }
    const variants = [...new Set(alts)]
    const un = X.take()
    out.push({ ...st, variants, unresolved: un, dynamic, notes })
  }
  return out
}

// ================================================================= 4. MariaDB does the name resolution

const VERB_RE = /^\s*(select|insert|replace|update|delete|with|show|alter|create|drop|truncate|explain)\b/i
export const verbOf = (sql) => (VERB_RE.exec(sql)?.[1] ?? '').toLowerCase()

// Run `explain <statement>` for each variant, one per line, with --force so one error does not stop the rest.
export function runExplains(inst, db, variants /* [{key, sql}] */, { sqlMode = null } = {}) {
  const lines = []
  const rows = []
  for (const v of variants) {
    const bound = bindPlaceholders(v.sql)
    const verb = verbOf(bound)
    const text = ['select', 'insert', 'replace', 'update', 'delete', 'with'].includes(verb) ? `explain ${bound}` : bound
    lines.push(text.replace(/[\r\n]+/g, ' '))
    rows.push(v)
  }
  const pre = sqlMode ? 1 : 0
  const input = (sqlMode ? `set session sql_mode = '${sqlMode}';\n` : '') + lines.map((l) => `${l};`).join('\n') + '\n'
  const r = spawnSync('mariadb', ['--no-defaults', '-S', inst.sock, '-uroot', '--default-character-set=utf8mb4', '--force', '--batch', '--silent', db],
    { input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const errs = new Map()
  for (const m of (r.stderr || '').matchAll(/ERROR (\d+) \((\w+)\) at line (\d+): (.*)/g)) errs.set(Number(m[3]) - pre, { code: Number(m[1]), state: m[2], message: m[4] })
  return rows.map((v, k) => ({ ...v, bound: lines[k], error: errs.get(k + 1) ?? null }))
}

export function classifyError(e) {
  if (!e) return null
  const col = /Unknown column '([^']+)'/.exec(e.message)?.[1] ?? null
  const tbl = /Table '[^.']*\.?([^']+)' doesn't exist/.exec(e.message)?.[1] ?? null
  const kind = { 1054: 'unknown_column', 1146: 'unknown_table', 1064: 'syntax', 1052: 'ambiguous_column', 1136: 'column_count', 1222: 'union_columns', 1060: 'duplicate_column', 1110: 'duplicate_column', 1055: 'group_by' }[e.code] ?? 'other'
  return { kind, column: col, table: tbl, code: e.code, message: e.message.slice(0, 200) }
}

// ================================================================= 5. who uses which column

// A reasonably faithful statement reader: tables and aliases per (sub)select, and the role of every
// column reference (written, selected, filtered, read by its own assignment). MariaDB has already
// validated the names; this only decides WHICH table a name belongs to and WHAT the statement does to it.
export function analyseSql(sql, schema /* {table: Set(columns)} */) {
  const toks = lexSql(sql)
  const res = { kind: verbOf(sql), written: new Set(), selected: new Set(), filtered: new Set(), selfref: new Set(), stars: new Set(), positionalInsert: null,
    tables: new Set(), deleted: new Set(), unresolved: new Set(), ambiguous: new Set() }
  const ctxs = []
  const newCtx = (parent, kind) => { const c = { id: ctxs.length, parent, kind, tables: [], aliases: {}, outs: new Set() }; ctxs.push(c); return c }
  const root = newCtx(null, res.kind)
  // pass 1: a flat walk that assigns each token a context + clause, and discovers tables
  const stack = [{ ctx: root, clause: res.kind === 'select' || res.kind === 'with' ? 'select' : 'start' }]
  let top = stack[0]
  const info = new Array(toks.length)
  let lastKeyword = ''
  let setSide = null // 'lhs' | 'rhs' inside SET
  let insertTable = null, insertCols = null, insertParen = false
  const isTableName = (tok) => tok && tok.t === 'id' && (tok.q || !KW.has(tok.v.toLowerCase()) || (schema[tok.v.toLowerCase()] ?? schema[tok.v]))
  const lookupTable = (name) => (schema[name] ? name : Object.keys(schema).find((t) => t.toLowerCase() === name.toLowerCase()))
  const addTable = (ctx, name, alias) => {
    const real = lookupTable(name)
    if (!real) { if (!/^(dual|information_schema)$/i.test(name)) res.unresolved.add(`table:${name}`); return }
    ctx.tables.push({ name: real, alias: alias || real })
    ctx.aliases[(alias || real).toLowerCase()] = real
    ctx.aliases[real.toLowerCase()] = real
    res.tables.add(real)
  }
  const readTableRef = (k, ctx) => { // tok k is the first token after FROM/JOIN/UPDATE/INTO; returns next index
    const tk = toks[k]
    if (!tk) return k
    if (tk.v === '(') return k // derived table: its own SELECT context handles the inside
    if (tk.t !== 'id') return k
    let name = tk.v; let j = k + 1
    if (toks[j]?.v === '.') { name = toks[j + 1]?.v ?? name; j += 2 } // schema.table
    let alias = null
    if (up(toks[j]) === 'AS') { alias = toks[j + 1]?.v; j += 2 }
    else if (toks[j]?.t === 'id' && !['WHERE', 'SET', 'ON', 'USING', 'LEFT', 'RIGHT', 'INNER', 'JOIN', 'CROSS', 'NATURAL', 'STRAIGHT_JOIN', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'UNION', 'FOR', 'VALUES', 'SELECT', 'FORCE', 'USE', 'IGNORE', 'PARTITION', 'LOCK', 'ON', 'OFFSET', 'RETURNING'].includes(up(toks[j]))) { alias = toks[j].v; j++ }
    addTable(ctx, name, alias)
    return j - 1
  }
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]
    const u = up(tk)
    info[k] = { ctx: top.ctx, clause: top.clause, setSide }
    if (tk.v === '(' && tk.t === 'op') {
      const nxt = up(toks[k + 1])
      if (nxt === 'SELECT' || nxt === 'WITH') { const c = newCtx(top.ctx, 'select'); stack.push({ ctx: c, clause: 'select', paren: true }) }
      else stack.push({ ctx: top.ctx, clause: top.clause === 'insertcols-pending' ? 'insertcols' : top.clause, paren: true, setSide })
      top = stack[stack.length - 1]
      if (top.clause === 'insertcols') { insertParen = true; insertCols = [] }
      continue
    }
    if (tk.v === ')' && tk.t === 'op') {
      if (stack.length > 1) { const popped = stack.pop(); top = stack[stack.length - 1]; if (popped.clause === 'insertcols') { top.clause = 'insertdone'; res.insertCols = insertCols } setSide = top.setSide ?? setSide }
      continue
    }
    if (tk.t === 'id' && !tk.q) {
      const depthTop = top
      if (u === 'SELECT' && depthTop.clause !== 'values') { depthTop.clause = 'select' }
      else if (u === 'FROM') { depthTop.clause = 'from'; k = readTableRef(k + 1, depthTop.ctx) }
      else if (u === 'JOIN') { depthTop.clause = 'from'; k = readTableRef(k + 1, depthTop.ctx) }
      else if (u === 'UPDATE' && (res.kind === 'update' && k === 0 || lastKeyword === 'DUPLICATE')) {
        if (lastKeyword === 'DUPLICATE') { depthTop.clause = 'set'; setSide = 'lhs' } else { depthTop.clause = 'from'; k = readTableRef(k + 1, depthTop.ctx) }
      }
      else if (u === 'UPDATE') { /* FOR UPDATE */ depthTop.clause = 'lock' }
      else if (u === 'INTO' && (res.kind === 'insert' || res.kind === 'replace')) {
        k = readTableRef(k + 1, depthTop.ctx); insertTable = ctxs[depthTop.ctx.id].tables.at(-1)?.name ?? null; depthTop.clause = 'insertcols-pending'
      }
      else if (u === 'SET') { depthTop.clause = 'set'; setSide = 'lhs' }
      else if ((u === 'VALUES' || u === 'VALUE') && (res.kind === 'insert' || res.kind === 'replace') && toks[k + 1]?.v === '(' && lastKeyword !== 'DUPLICATE') { depthTop.clause = 'values' }
      else if (u === 'WHERE' || u === 'ON' || u === 'HAVING' || u === 'USING') { if (!(u === 'ON' && lastKeyword === 'DUPLICATE')) depthTop.clause = 'filter' }
      else if (u === 'GROUP' || u === 'ORDER') { depthTop.clause = 'filter'; if (up(toks[k + 1]) === 'BY') k++ }
      else if (u === 'LIMIT' || u === 'OFFSET') depthTop.clause = 'limit'
      else if (u === 'DELETE') { depthTop.clause = 'delete' }
      else if (u === 'DUPLICATE') { lastKeyword = 'DUPLICATE'; if (up(toks[k + 1]) === 'KEY') k += 1 }
      else if (u === 'UNION') { depthTop.clause = 'select' }
      if (['SELECT', 'FROM', 'WHERE', 'SET', 'VALUES', 'DUPLICATE', 'JOIN', 'INTO', 'UNION', 'GROUP', 'ORDER', 'HAVING', 'LIMIT'].includes(u) && u !== 'DUPLICATE') lastKeyword = u
      info[k] = { ctx: top.ctx, clause: top.clause, setSide }
      if (u === 'DELETE' && up(toks[k + 1]) === 'FROM') { k++; k = readTableRef(k + 1, top.ctx); res.deleted.add(ctxs[top.ctx.id].tables.at(-1)?.name); top.clause = 'from' }
    }
    if (tk.v === ',' && tk.t === 'op') {
      if (top.clause === 'set') setSide = 'lhs'
      if (top.clause === 'from' && toks[k + 1]?.t === 'id' && toks[k + 2] && (toks[k + 2].t === 'id' || ['WHERE', ',', 'ON'].includes(up(toks[k + 2])) || !toks[k + 2])) {
        k = readTableRef(k + 1, top.ctx); info[k] = { ctx: top.ctx, clause: top.clause, setSide }
      }
    }
    if (tk.v === '=' && tk.t === 'op' && top.clause === 'set' && setSide === 'lhs') setSide = 'rhs'
  }
  // pass 2: classify identifiers
  const resolveCtx = (ctx, col) => { // tables (in this and outer selects) that own the bare column
    for (let c = ctx; c; c = c.parent) {
      const hit = [...new Set(c.tables.map((t) => t.name))].filter((t) => schema[t]?.has(col.toLowerCase()))
      if (hit.length) return hit
    }
    return []
  }
  const tablesOf = (ctx) => { const s = new Set(); for (let c = ctx; c; c = c.parent) for (const t of c.tables) s.add(t.name); return s }
  // output aliases (`... as total`) are not columns
  for (let k = 0; k < toks.length; k++) if (up(toks[k]) === 'AS' && toks[k + 1]?.t === 'id') info[k].ctx.outs.add(toks[k + 1].v.toLowerCase())
  const roleOf = (inf) => {
    const c = inf.clause
    if (c === 'select' || c === 'delete') return 'selected'
    if (c === 'from' || c === 'filter' || c === 'limit') return 'filtered'
    if (c === 'set') return inf.setSide === 'lhs' ? 'written' : 'rhs'
    if (c === 'insertcols') return 'written'
    if (c === 'values') return 'ignore'
    return 'selected'
  }
  const mark = (role, table, col, ctxTables) => {
    const key = `${table}.${col.toLowerCase()}`
    if (role === 'written') res.written.add(key)
    else if (role === 'selected') res.selected.add(key)
    else if (role === 'filtered') res.filtered.add(key)
    else if (role === 'rhs') res.selfref.add(key)
  }
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]
    const inf = info[k]
    if (!inf) continue
    if (tk.t === 'op' && tk.v === '*' && inf.clause === 'select') {
      const prev = toks[k - 1]
      if (prev?.v === '.' ) {
        const a = toks[k - 2]?.v?.toLowerCase(); const real = inf.ctx && (() => { for (let c = inf.ctx; c; c = c.parent) if (c.aliases[a]) return c.aliases[a]; return null })()
        if (real) res.stars.add(real)
      } else if (prev?.v === ',' || up(prev) === 'SELECT' || up(prev) === 'DISTINCT') { // select * (not count(*): there the previous token is '(')
        for (const t of tablesOf(inf.ctx)) res.stars.add(t)
      }
      continue
    }
    if (tk.t !== 'id') continue
    if (!tk.q && (KW.has(tk.v.toLowerCase()) || RESERVED_OPERAND.has(tk.v.toLowerCase()))) { if (!(schema && toks[k + 1]?.v === '.' )) continue }
    if (toks[k + 1]?.v === '(' && !tk.q) continue // function call
    if (toks[k - 1]?.v === '.' ) continue // handled by the qualifier
    if (up(toks[k - 1]) === 'AS') continue // output alias
    if (inf.clause === 'from' || inf.clause === 'insertdone' || inf.clause === 'insertcols-pending' && toks[k - 1] && ['INTO'].includes(up(toks[k - 1]))) { if (inf.clause !== 'from') continue }
    // qualifier.column
    if (toks[k + 1]?.v === '.' && toks[k + 2]) {
      const q = tk.v.toLowerCase(); const colTok = toks[k + 2]
      if (colTok.v === '*') continue
      let real = null
      for (let c = inf.ctx; c && !real; c = c.parent) real = c.aliases[q] ?? null
      if (!real) { res.unresolved.add(`${tk.v}.${colTok.v}`); continue }
      if (inf.clause === 'from') { if (toks[k - 1] && ['FROM', 'JOIN', 'UPDATE', 'INTO'].includes(up(toks[k - 1]))) continue }
      const r = roleOf(inf)
      if (r !== 'ignore') mark(r, real, colTok.v, null)
      continue
    }
    if (inf.clause === 'from' && toks[k - 1] && ['FROM', 'JOIN', 'UPDATE', 'INTO'].includes(up(toks[k - 1]))) continue // table name
    if (inf.clause === 'from' && toks[k - 1]?.t === 'id' && !KW.has(up(toks[k - 1]).toLowerCase())) continue // alias
    const r = roleOf(inf)
    if (r === 'ignore') continue
    const col = tk.v
    const hit = resolveCtx(inf.ctx, col)
    if (hit.length === 0) {
      let own = false
      for (let c = inf.ctx; c; c = c.parent) if (c.outs.has(col.toLowerCase())) own = true
      if (!own) res.unresolved.add(col)
      continue
    }
    if (hit.length > 1) res.ambiguous.add(col.toLowerCase())
    for (const t of hit) mark(r, t, col, null)
  }
  // insert without a column list writes every column positionally
  if ((res.kind === 'insert' || res.kind === 'replace') && insertTable && !res.written.size) res.positionalInsert = insertTable
  res.insertTable = insertTable
  return res
}

// ================================================================= 6. the audit

const rel = (p) => relative(REPO, p)
const J = (o) => JSON.stringify(o)

// `schema` as {table: Set(lowercase column names)} from a snapshot
export const schemaSets = (snap) => Object.fromEntries(Object.entries(snap).map(([t, v]) => [t, new Set(Object.keys(v.columns).map((c) => c.toLowerCase()))]))

// Split a SQL file into statements the way the client does (a `;` outside strings and comments).
export function splitSql(text) {
  const toks = lexSql(text)
  const out = []
  let from = 0
  for (const tk of toks) if (tk.t === 'op' && tk.v === ';') { out.push(text.slice(from, tk.i).trim()); from = tk.e }
  const last = text.slice(from).trim()
  if (last && lexSql(last).length) out.push(last)
  return out.filter((x) => x && lexSql(x).length)
}

// DML (INSERT / UPDATE / REPLACE / DELETE) in the repository's SQL files: who writes a column besides the PHP.
export function sqlFileStatements(files) {
  const out = []
  for (const f of files) {
    if (!existsSync(f)) continue
    for (const stmt of splitSql(readFileSync(f, 'utf8'))) {
      if (/^\s*(insert|update|replace|delete)\b/i.test(stmt)) out.push({ file: rel(f), sql: stmt })
    }
  }
  return out
}

export function loadClientWords(dirs) {
  const words = new Map()
  const walk = (d) => {
    if (!existsSync(d)) return
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { if (name !== 'node_modules') walk(p); continue }
      if (!/\.(m?js|jsx|ts|tsx)$/.test(name)) continue
      const src = readFileSync(p, 'utf8')
      for (const m of src.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) words.set(m[0], (words.get(m[0]) ?? 0) + 1)
    }
  }
  for (const d of dirs) walk(d)
  return words
}

const camel = (c) => c.replace(/_([a-z0-9])/g, (_, x) => x.toUpperCase())

// ---------------------------------------------------------------- the audit proper

// Validate every expanded statement against the schema `db` of `inst`. Returns one record per statement.
export function validateStatements(inst, db, stmts, opt = {}) {
  const flat = []
  for (const s of stmts) s.variants.forEach((sql, k) => {
    if (verbOf(sql) === 'explain') return
    flat.push({ id: s.id, k, sql })
  })
  const rows = runExplains(inst, db, flat, opt)
  const by = new Map()
  for (const r of rows) { if (!by.has(r.id)) by.set(r.id, []); by.get(r.id).push(r) }
  return by
}

// Columns that one ALTER TABLE adds together: a guard on one of them protects the others (the migration is applied whole).
export function alterGroups(files) {
  const out = []
  for (const f of files) {
    if (!existsSync(f)) continue
    for (const stmt of splitSql(readFileSync(f, 'utf8'))) {
      const toks = lexSql(stmt)
      if (up(toks[0]) !== 'ALTER' || up(toks[1]) !== 'TABLE') continue
      const cols = new Set()
      for (let k = 3; k < toks.length; k++) {
        if (up(toks[k]) === 'ADD' && up(toks[k + 1]) === 'COLUMN') {
          let j = k + 2
          if (up(toks[j]) === 'IF' && up(toks[j + 1]) === 'NOT' && up(toks[j + 2]) === 'EXISTS') j += 3
          if (toks[j]?.t === 'id') cols.add(toks[j].v.toLowerCase())
        }
      }
      if (cols.size > 1) out.push({ table: toks[2].v, cols })
    }
  }
  return out
}

// Per statement: ok | guarded | failed. A statement is fine when at least one variant parses and every other
// variant fails only because of a syntax artefact of the combination or a column its own code guards.
export function judge(stmt, runs, ex, groups = []) {
  const errs = runs.filter((r) => r.error).map((r) => ({ ...classifyError(r.error), sql: r.bound }))
  if (!errs.length) return { verdict: 'ok', errors: [] }
  // A guard is a store_column_exists() call or a SHOW COLUMNS ... LIKE 'col'. It protects a statement when the guard is in
  // the statement's file, or sits in a helper function the statement's file calls (birthday_columns_ready()).
  const guards = []
  for (const g of ex.guards ?? []) guards.push({ column: g.column.toLowerCase(), file: g.file, func: g.func })
  for (const x of ex.statements ?? []) if (verbOf(x.pieces[0]?.[1] ?? '') === 'show') {
    const col = /like\s+'(\w+)'/i.exec(x.pieces.map((p) => p[1]).join(''))?.[1]
    if (col) guards.push({ column: col.toLowerCase(), file: x.file, func: x.func })
  }
  const calledHere = new Set()
  for (const [k, names] of Object.entries(ex.calls ?? {})) if (k.startsWith(`${stmt.file}::`)) for (const n of Object.keys(names)) calledHere.add(n)
  const guardedBy = new Map()
  for (const g of guards) {
    if (g.file === stmt.file) guardedBy.set(g.column, g.func === '(file)' ? `${g.file}` : `${g.func}()`)
    else if (g.func !== '(file)' && calledHere.has(g.func)) guardedBy.set(g.column, `${g.func}()`)
  }
  const okVariants = runs.length - errs.length
  const real = []
  const guarded = []
  for (const e of errs) {
    if (e.kind === 'unknown_column') {
      const col = (e.column ?? '').split('.').pop().toLowerCase()
      if (guardedBy.has(col)) { guarded.push({ ...e, guard: col, guard_by: guardedBy.get(col) }); continue }
      const sib = groups.find((g) => g.cols.has(col) && [...g.cols].some((x) => guardedBy.has(x)))
      if (sib) { const via = [...sib.cols].find((x) => guardedBy.has(x)); guarded.push({ ...e, guard: via, guard_by: guardedBy.get(via), sibling_of: col }); continue }
    }
    if (e.kind === 'syntax' && okVariants > 0) continue // a correlated-alternative artefact: another expansion of the same statement parses
    real.push(e)
  }
  if (real.length) return { verdict: 'failed', errors: real, guarded }
  if (guarded.length) return { verdict: 'guarded', errors: [], guarded }
  return { verdict: 'ok', errors: [], note: 'syntax artefact of a correlated alternative' }
}

// NOT NULL columns without a default that an INSERT leaves out: strict mode answers 1364 and the route fails.
export function insertGaps(stmts, snap) {
  const out = []
  for (const s of stmts) {
    for (const sql of s.variants) {
      if (!/^\s*(insert|replace)\b/i.test(sql)) continue
      const toks = lexSql(sql)
      const iInto = toks.findIndex((t) => up(t) === 'INTO')
      if (iInto < 0) continue
      const table = Object.keys(snap).find((t) => t.toLowerCase() === (toks[iInto + 1]?.v ?? '').toLowerCase())
      if (!table) continue
      let cols = null
      if (toks[iInto + 2]?.v === '(' && up(toks[iInto + 3]) !== 'SELECT') {
        cols = []
        for (let k = iInto + 3; k < toks.length && toks[k].v !== ')'; k++) if (toks[k].t === 'id') cols.push(toks[k].v.toLowerCase())
      }
      if (!cols) continue
      const missing = Object.entries(snap[table].columns).filter(([c, d]) => d.null === 'NO' && d.def === null && !/auto_increment/i.test(d.extra) && !d.gen
        && !cols.includes(c.toLowerCase())).map(([c]) => c)
      if (missing.length) out.push({ file: s.file, line: s.line, func: s.func, table, missing })
    }
  }
  return out
}

// string literals the code assigns to a column against the column's length and against CHECK lists
export function literalFits(stmts, snap) {
  const out = []
  const cap = (d) => { const m = /^(?:var)?char\((\d+)\)/.exec(d.type); return m ? Number(m[1]) : null }
  const decode = (lit) => lit.slice(1, -1).replace(/''/g, "'").replace(/\\(.)/g, '$1')
  for (const s of stmts) {
    for (const sql of s.variants) {
      const toks = lexSql(sql)
      const verb = verbOf(sql)
      const tbl = (() => {
        let i = toks.findIndex((t, k) => up(t) === (verb === 'update' ? 'UPDATE' : 'INTO'))
        return i < 0 ? null : Object.keys(snap).find((t) => t.toLowerCase() === (toks[i + 1]?.v ?? '').toLowerCase())
      })()
      if (!tbl) continue
      const check = (col, lit, line) => {
        const d = snap[tbl].columns[Object.keys(snap[tbl].columns).find((c) => c.toLowerCase() === col.toLowerCase())]
        if (!d) return
        const n = [...decode(lit)].length
        const c = cap(d)
        if (c !== null && n > c) out.push({ file: s.file, line: s.line, func: s.func, table: tbl, column: col, literal_len: n, column_chars: c, kind: 'too_long' })
      }
      if (verb === 'update') {
        const iSet = toks.findIndex((t) => up(t) === 'SET')
        for (let k = iSet + 1; k < toks.length - 2; k++) {
          if (toks[k].t === 'id' && toks[k + 1].v === '=' && toks[k + 2].t === 'str' && [',', 'WHERE'].includes(toks[k + 3]?.v === ',' ? ',' : up(toks[k + 3]) || ',')) check(toks[k].v, toks[k + 2].v)
        }
      } else if (verb === 'insert' || verb === 'replace') {
        const iv = toks.findIndex((t) => up(t) === 'VALUES')
        if (iv < 0 || toks[2 + toks.findIndex((t) => up(t) === 'INTO')]?.v !== '(') continue
        const iInto = toks.findIndex((t) => up(t) === 'INTO')
        const cols = []
        for (let k = iInto + 3; k < iv && toks[k].v !== ')'; k++) if (toks[k].t === 'id') cols.push(toks[k].v)
        let depth = 0, idx = 0
        for (let k = iv + 1; k < toks.length; k++) {
          const t = toks[k]
          if (t.v === '(') { depth++; if (depth === 1) idx = 0; continue }
          if (t.v === ')') { depth--; if (depth === 0) break; continue }
          if (depth === 1 && t.v === ',') { idx++; continue }
          if (depth === 1 && t.t === 'str' && (toks[k + 1]?.v === ',' || toks[k + 1]?.v === ')') && cols[idx]) check(cols[idx], t.v)
        }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- usage matrix

// Which statements write / select / filter each column. `schema` is {table: Set(columns)}.
export function usageMatrix({ stmts, extraSql = [], schema }) {
  const use = new Map()
  const slot = (t, c) => { const k = `${t}.${c}`; if (!use.has(k)) use.set(k, { written: new Set(), selected: new Set(), filtered: new Set(), selfref: new Set(), starred: new Set() }); return use.get(k) }
  const unresolved = new Map()
  const addAll = (site, an) => {
    for (const k of an.written) { const [t, c] = splitKey(k); slot(t, c).written.add(site) }
    for (const k of an.selected) { const [t, c] = splitKey(k); slot(t, c).selected.add(site) }
    for (const k of an.filtered) { const [t, c] = splitKey(k); slot(t, c).filtered.add(site) }
    for (const k of an.selfref) { const [t, c] = splitKey(k); slot(t, c).selfref.add(site) }
    for (const t of an.stars) for (const c of schema[t] ?? []) slot(t, c).starred.add(site)
    if (an.positionalInsert) for (const c of schema[an.positionalInsert] ?? []) slot(an.positionalInsert, c).written.add(site)
    for (const u of an.unresolved) { if (!unresolved.has(u)) unresolved.set(u, new Set()); unresolved.get(u).add(site) }
  }
  const splitKey = (k) => { const i = k.indexOf('.'); return [k.slice(0, i), k.slice(i + 1)] }
  for (const s of stmts) for (const sql of s.variants) {
    if (!['select', 'insert', 'replace', 'update', 'delete', 'with'].includes(verbOf(sql))) continue
    addAll(`${s.file}:${s.line}`, analyseSql(sql, schema))
  }
  for (const x of extraSql) addAll(x.file, analyseSql(x.sql, schema))
  return { use, unresolved }
}

export function classifyColumns({ snap, use, literals, clientWords }) {
  const lit = new Map()
  for (const f of Object.values(literals ?? {})) for (const [w, n] of Object.entries(f)) lit.set(w.toLowerCase(), (lit.get(w.toLowerCase()) ?? 0) + n)
  const rows = []
  for (const [table, T] of Object.entries(snap)) {
    const structural = new Set()
    for (const ix of Object.values(T.indexes)) for (const c of ix.cols) structural.add(c.replace(/\(\d+\)$/, '').toLowerCase())
    for (const fk of Object.values(T.fks)) for (const c of fk.cols) structural.add(c.toLowerCase())
    for (const [column, d] of Object.entries(T.columns)) {
      const u = use.get(`${table}.${column.toLowerCase()}`)
      const w = u ? [...u.written] : []
      const codeW = w.filter((x) => !x.endsWith('.sql'))
      const sqlW = w.filter((x) => x.endsWith('.sql'))
      const r = u ? [...u.selected] : []
      const f = u ? [...u.filtered] : []
      const sr = u ? [...u.selfref] : []
      const st = u ? [...u.starred] : []
      const auto = /auto_increment|on update|generated/i.test(d.extra) || d.gen !== '' || /current_timestamp/i.test(d.def ?? '')
      const mention = lit.get(column.toLowerCase()) ?? 0
      const client = clientWords ? Math.max(clientWords.get(column) ?? 0, clientWords.get(camel(column)) ?? 0) : null
      const read = r.length + st.length > 0
      const filtered = f.length > 0
      let cls
      if (!w.length && !read && !filtered && !sr.length) cls = structural.has(column.toLowerCase()) ? 'structural_only' : (mention || client ? 'named_only' : 'dead')
      else if (w.length && !read && !filtered) cls = structural.has(column.toLowerCase()) ? 'structural_write_only' : 'write_only'
      else if (!w.length) cls = auto ? 'read_only_db_assigned' : 'read_only_external'
      else cls = 'used'
      rows.push({ table, column, type: d.type, nullable: d.null === 'YES', default: d.def, extra: d.extra || undefined, class: cls,
        written_by_code: codeW.slice(0, 8), written_by_sql_files: sqlW.slice(0, 4), selected_by: r.slice(0, 8), filtered_by: f.slice(0, 6), starred_by: st.slice(0, 4),
        self_referenced_by: sr.slice(0, 3), php_literal_mentions: mention, client_mentions: client, structural: structural.has(column.toLowerCase()) })
    }
  }
  return rows
}

// ---------------------------------------------------------------- orchestration

export const LIVE_ADDON_SQL = () => {
  const dir = join(REPO, 'sporta-live')
  const out = []
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.mysql.sql')) out.push(p) } }
  if (existsSync(dir)) walk(dir)
  return out.sort()
}

export function defaultClientDirs() {
  const scratch = process.env.DBCOLS_CLIENT_DIRS ? process.env.DBCOLS_CLIENT_DIRS.split(':') : []
  return [join(WEB, 'src'), join(WEB, 'public'), join(REPO, 'sporta-live'), ...scratch]
}

// The repository's own SQL files with data statements, for "who else writes this column".
export function repoSqlFiles(dir = SQLDIR) {
  const mig = readdirSync(dir).filter((f) => f.endsWith('.mysql.sql') && f !== 'install.mysql.sql').map((f) => join(dir, f))
  return [...mig, ...LIVE_ADDON_SQL()]
}

// COVERAGE. The PHP extractor lists every ->prepare( / ->query( / ->exec( call and says whether it extracted a statement for
// it. A call without one is SQL the audit did not read (it ends right after the verb: "select {$cols} from ...", is built by
// sprintf() / a heredoc / a match / a loop, is returned by a function or comes from a file). Those are reported, never
// dropped. `session_only` marks the ones that name no column at all (ROLLBACK, SET SESSION, KILL, SELECT DATABASE()); `passthrough` marks a wrapper that
// hands on the SQL it was given (the connection pool's exec / query / prepare): the SQL is read where its caller writes it.
const SESSION_ONLY_CALL = /^['"]\s*(?:rollback\b|savepoint\b|set\s|start\s+transaction|begin\b|commit\b|release\b|kill\b|select\s+(?:database\(\)|get_lock|release_lock|connection_id|sleep)|do\s)/i
export function uncoveredCalls(ex) {
  return (ex.callsites ?? []).filter((c) => !c.covered)
    .map((c) => ({ file: c.file, line: c.line, func: c.func, call: c.call, arg: c.arg, passthrough: !!c.passthrough, session_only: SESSION_ONLY_CALL.test(String(c.arg)) }))
}

export async function runAudit({ inst: given, web = WEB, clientDirs = defaultClientDirs(), schemaDiff = null, log = () => {}, addonFiles = null } = {}) {
  const own = !given
  const inst = given ?? await startPrivateMariadb({ label: 'dc', portFrom: 34100 })
  const R = { server: inst.version, sql_mode: await inst.sql('select @@sql_mode') }
  try {
    const inv = sqlInventory(join(web, 'dropin/php-store'))
    const dirStore = join(web, 'dropin/php-store')
    await freshDb(inst, 'canon')
    R.apply_canon = applyAll(inst, 'canon', toolingOrder(inv), dirStore).filter((r) => !r.ok)
    await freshDb(inst, 'canon_plus')
    applyAll(inst, 'canon_plus', toolingOrder(inv), dirStore)
    const addons = addonFiles ?? LIVE_ADDON_SQL()
    R.addon_files = addons.map(rel)
    R.apply_addons = addons.map((f) => ({ file: rel(f), ...applyFile(inst, 'canon_plus', f) }))
    const snap = await snapshot(inst, 'canon')
    const snapPlus = await snapshot(inst, 'canon_plus')
    R.schema = { tables: Object.keys(snap).length, columns: Object.values(snap).reduce((n, t) => n + t.order.length, 0),
      tables_with_addons: Object.keys(snapPlus).length, columns_with_addons: Object.values(snapPlus).reduce((n, t) => n + t.order.length, 0) }

    // ---- B. statements
    const ex = extractStatements(web)
    const stmts = expandStatements(ex, web)
    R.statements = { total: stmts.length, by_verb: stmts.reduce((m, s) => { const v = verbOf(s.variants[0] ?? ''); m[v] = (m[v] ?? 0) + 1; return m }, {}),
      variants: stmts.reduce((n, s) => n + s.variants.length, 0), dynamic: stmts.filter((s) => s.dynamic).length,
      unresolved: stmts.filter((s) => s.unresolved.length).map((s) => ({ file: s.file, line: s.line, func: s.func, parts: s.unresolved })),
      call_sites: (ex.callsites ?? []).length, uncovered: uncoveredCalls(ex) }
    const runs = validateStatements(inst, 'canon', stmts)
    const runsPlus = validateStatements(inst, 'canon_plus', stmts)
    const groups = alterGroups([...repoSqlFiles(dirStore), ...addons])
    R.explain = { ok: 0, guarded: 0, failed: 0, unverified: 0, failed_list: [], guarded_list: [], unverified_list: [], addon_fixes: [] }
    for (const s of stmts) {
      const rs = runs.get(s.id) ?? []
      if (!rs.length) continue
      const j = judge(s, rs, ex, groups)
      const jPlus = judge(s, runsPlus.get(s.id) ?? [], ex, groups)
      // A statement built from fragments the expander could not resolve (a function that returns SQL, a list returned from a
      // function) and refused only with syntax errors is UNVERIFIED, not wrong: say so instead of raising a false alarm.
      if (j.verdict === 'failed' && s.unresolved.length && j.errors.every((e) => e.kind === 'syntax')) { j.verdict = 'unverified'; j.unverified_parts = s.unresolved }
      const rec = { file: s.file, line: s.line, func: s.func, verdict: j.verdict, unverified_parts: j.unverified_parts, verdict_with_addons: jPlus.verdict, errors: j.errors.map(({ sql, ...e }) => ({ ...e, sql: sql?.slice(0, 260) })), guarded: (j.guarded ?? []).map(({ sql, ...e }) => e) }
      R.explain[j.verdict === 'ok' ? 'ok' : j.verdict]++
      if (j.verdict === 'unverified') R.explain.unverified_list.push({ file: s.file, line: s.line, func: s.func, parts: s.unresolved })
      if (j.verdict === 'failed') { R.explain.failed_list.push(rec); if (jPlus.verdict !== 'failed') R.explain.addon_fixes.push(rec) }
      if (j.verdict === 'guarded') R.explain.guarded_list.push(rec)
    }
    // the sql_mode ops/db/sporta-db-hardening.cnf proposes (STRICT_ALL_TABLES ... ONLY_FULL_GROUP_BY): would it refuse a statement the default accepts?
    const cnf = join(web, 'ops/db/sporta-db-hardening.cnf')
    const hardened = existsSync(cnf) ? /^sql_mode\s*=\s*(\S+)/m.exec(readFileSync(cnf, 'utf8'))?.[1] ?? null : null
    R.explain_hardened = { sql_mode: hardened, new_failures: [] }
    if (hardened) {
      const runsH = validateStatements(inst, 'canon', stmts, { sqlMode: hardened })
      for (const s of stmts) {
        const base = runs.get(s.id) ?? []
        const hz = runsH.get(s.id) ?? []
        const was = new Set(base.filter((r) => r.error).map((r) => r.k)), now = hz.filter((r) => r.error && !was.has(r.k))
        if (now.length) R.explain_hardened.new_failures.push({ file: s.file, line: s.line, func: s.func, errors: [...new Set(now.map((r) => `${r.error.code} ${r.error.message.slice(0, 140)}`))], sql: now[0].bound.slice(0, 200) })
      }
    }
    // guards: do they name a column that exists?
    R.guards = (ex.guards ?? []).map((g) => ({ ...g, column_exists_in_schema: !!snap[g.table]?.columns[g.column], column_exists_with_addons: !!snapPlus[g.table]?.columns[g.column] }))
    for (const x of ex.statements.filter((x) => verbOf(x.pieces[0]?.[1] ?? '') === 'show')) {
      const text = x.pieces.map((p) => p[1]).join('')
      const m = /from\s+(\w+)\s+like\s+'(\w+)'/i.exec(text)
      if (m) R.guards.push({ file: x.file, line: x.line, func: x.func, kind: 'show_columns', table: m[1], column: m[2], column_exists_in_schema: !!snap[m[1]]?.columns[m[2]], column_exists_with_addons: !!snapPlus[m[1]]?.columns[m[2]] })
    }
    R.insert_gaps = insertGaps(stmts, snap)
    R.literal_fits = literalFits(stmts, snap)
    R.caps = judgeCaps(capInventory({ ex, stmts, snap, web }))
    R.numeric = numericAudit(snap); R.charset = charsetAudit(snap); R.keys = keyAudit(snap); R.drift = capacityDrift(snap)

    // ---- C. who uses which column (the schema WITH the add-on migrations, so a column an add-on defines is not "unknown")
    const schemaPlus = schemaSets(snapPlus)
    const sqlDml = sqlFileStatements(repoSqlFiles(dirStore))
    const { use, unresolved } = usageMatrix({ stmts, extraSql: sqlDml, schema: schemaPlus })
    const words = clientDirs.some((d) => existsSync(d)) ? loadClientWords(clientDirs.filter((d) => existsSync(d))) : null
    R.columns = classifyColumns({ snap: snapPlus, use, literals: ex.literals, clientWords: words })
    R.unresolved_identifiers = [...unresolved.entries()].map(([k, v]) => ({ name: k, sites: [...v].slice(0, 3) })).slice(0, 80)
    R.client = { dirs: clientDirs.filter((d) => existsSync(d)).map(rel), distinct_words: words ? words.size : 0 }

    R._ex = ex; R._stmts = stmts; R._snap = snap; R._snapPlus = snapPlus
    if (schemaDiff) R.schema_diff = schemaDiff
  } finally {
    for (const d of ['canon', 'canon_plus']) { try { await inst.sql(`drop database if exists ${d}`) } catch { /* ignore */ } }
    if (own) inst.stop()
  }
  return R
}

// ---------------------------------------------------------------- validation caps versus columns

// Capacity of a column in characters and bytes (utf8mb4: up to 4 bytes a character, Arabic letters take 2).
export function columnCapacity(d) {
  let m
  if ((m = /^(var)?char\((\d+)\)/.exec(d.type))) return { chars: Number(m[2]), bytes: Number(m[2]) * 4, kind: m[1] ? 'varchar' : 'char' }
  if (/^tinytext/.test(d.type)) return { chars: 63, bytes: 255, kind: 'tinytext', byteLimited: true }
  if (/^text/.test(d.type)) return { chars: 16383, bytes: 65535, kind: 'text', byteLimited: true }
  if (/^mediumtext/.test(d.type)) return { chars: 4194303, bytes: 16777215, kind: 'mediumtext', byteLimited: true }
  if (/^longtext/.test(d.type)) return { chars: 1073741823, bytes: 4294967295, kind: 'longtext', byteLimited: true }
  return null
}
export function numericRange(d) {
  const m = /^(tinyint|smallint|mediumint|int|bigint)\((\d+)\)(?: (unsigned))?/.exec(d.type)
  if (m) {
    const bits = { tinyint: 8, smallint: 16, mediumint: 24, int: 32, bigint: 64 }[m[1]]
    const big = (n) => BigInt(n)
    return m[3] ? { min: 0n, max: (1n << big(bits)) - 1n } : { min: -(1n << big(bits - 1)), max: (1n << big(bits - 1)) - 1n }
  }
  const dm = /^decimal\((\d+),(\d+)\)(?: (unsigned))?/.exec(d.type)
  if (dm) { const int = Number(dm[1]) - Number(dm[2]); const max = Number('9'.repeat(int) + (Number(dm[2]) ? '.' + '9'.repeat(Number(dm[2])) : '')); return { min: dm[3] ? 0 : -max, max } }
  return null
}

const NOT_TEXT = /^\s*(?:\(int\)|\(float\)|\(bool\)|\(double\)|intval\(|floatval\(|\(int\)\(|hash\(|bin2hex\(|sha1\(|md5\(|gmdate\(|date\(|time\(|json_encode\(|null$|true$|false$|[0-9.]+$|\$?(?:id|orderId|now)\b$)/i

// Every cap a PHP expression carries: helper calls (store_text ...), truncations, length comparisons on its variable.
export function capsFromExpr(src, ctx /* {assigns, fnSource, line} */, depth = 0) {
  const caps = []
  let m
  const re = [
    [/store_text\(\s*[\s\S]+?,\s*'(\w+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g, (x) => ({ n: +x[3], unit: 'chars', mode: 'reject', via: `store_text(${x[1]})`, min: +x[2] })],
    [/store_checkout_optional\(\s*[\s\S]+?,\s*'(\w+)'\s*,\s*(\d+)\s*\)/g, (x) => ({ n: +x[2], unit: 'chars', mode: 'reject', via: `store_checkout_optional(${x[1]})` })],
    [/store_utm\(\s*[\s\S]+?,\s*'(\w+)'\s*,\s*(\d+)\s*\)/g, (x) => ({ n: +x[2], unit: 'chars', mode: 'truncate', via: `store_utm(${x[1]})` })],
    [/store_opt\(/g, () => ({ n: 280, unit: 'chars', mode: 'truncate', via: 'store_opt' })],
    [/mb_substr\([^;]*?,\s*0\s*,\s*(\d+)\s*\)/g, (x) => ({ n: +x[1], unit: 'chars', mode: 'truncate', via: 'mb_substr' })],
    [/(?<![\w])substr\([^;]*?,\s*0\s*,\s*(\d+)\s*\)/g, (x) => ({ n: +x[1], unit: 'bytes', mode: 'truncate', via: 'substr' })],
    [/store_input_string\(\s*[\s\S]+?,\s*'(\w+)'\s*(?:,\s*(\d+))?\s*\)/g, (x) => ({ n: x[2] ? +x[2] : 4096, unit: 'bytes', mode: 'reject', via: `store_input_string(${x[1]})` })],
    [/store_phone\(/g, () => ({ n: 11, unit: 'chars', mode: 'reject', via: 'store_phone' })],
  ]
  for (const [rx, mk] of re) { rx.lastIndex = 0; while ((m = rx.exec(src))) caps.push(mk(m)) }
  // a bare variable: follow its assignment and the length checks the function makes on it
  const v = /^\s*(?:\(string\)\s*)?(\$\w+)\s*(?:\?\?\s*null)?\s*$/.exec(src) ?? /^\s*\$\w+\s*(?:===|!==)\s*''\s*\?\s*null\s*:\s*(\$\w+)\s*$/.exec(src)
  if (v && depth < 3) {
    const name = v[1]
    const defs = (ctx.assigns?.[name] ?? []).filter((d) => d.line <= ctx.line)
    const last = defs.at(-1)
    if (last) caps.push(...capsFromExpr(last.src, { ...ctx, line: last.line }, depth + 1))
    const body = ctx.fnSource ?? ''
    const q = name.replace('$', '\\$')
    for (const x of body.matchAll(new RegExp(`(?:mb_strlen|strlen)\\(\\s*${q}\\s*\\)\\s*>\\s*(\\d+)`, 'g'))) caps.push({ n: +x[1], unit: /^mb_/.test(x[0]) ? 'chars' : 'bytes', mode: 'reject', via: x[0].split('(')[0] })
    for (const x of body.matchAll(new RegExp(`preg_match\\(\\s*'[^']*\\{(\\d+),(\\d+)\\}[^']*'\\s*,\\s*${q}\\b`, 'g'))) caps.push({ n: +x[2], unit: 'chars', mode: 'reject', via: 'regex {m,n}' })
  }
  return caps
}

// Placeholder -> target column, for INSERT ... VALUES and UPDATE ... SET / ON DUPLICATE KEY UPDATE.
export function paramTargets(sql) {
  const toks = lexSql(sql)
  const verb = verbOf(sql)
  const out = []
  if (verb === 'insert' || verb === 'replace') {
    const iInto = toks.findIndex((t) => up(t) === 'INTO')
    const table = toks[iInto + 1]?.v
    let cols = null
    if (toks[iInto + 2]?.v === '(' && up(toks[iInto + 3]) !== 'SELECT') {
      cols = []
      for (let k = iInto + 3; k < toks.length && toks[k].v !== ')'; k++) if (toks[k].t === 'id') cols.push(toks[k].v)
    }
    const iv = toks.findIndex((t) => up(t) === 'VALUES' || up(t) === 'VALUE')
    if (cols && iv > 0) {
      let depth = 0, idx = 0
      for (let k = iv + 1; k < toks.length; k++) {
        const t = toks[k]
        if (t.v === '(') { depth++; if (depth === 1) idx = 0; continue }
        if (t.v === ')') { depth--; if (depth === 0 && toks[k + 1]?.v !== ',') { /* row done */ } continue }
        if (depth === 1 && t.v === ',') { idx++; continue }
        if (depth === 1 && t.t === 'param') out.push({ table, column: cols[idx] ?? null, order: out.length })
        else if (depth >= 1 && t.t === 'param') out.push({ table: null, column: null, order: out.length })
        if (depth > 1 && t.t !== 'param') continue
      }
      // parameters after VALUES (...) (ON DUPLICATE KEY UPDATE c = ?) are picked up below
      const end = (() => { let d = 0; for (let k = iv + 1; k < toks.length; k++) { if (toks[k].v === '(') d++; else if (toks[k].v === ')') { d--; if (d === 0) return k } } return toks.length })()
      for (let k = end + 1; k < toks.length; k++) if (toks[k].t === 'param') out.push({ table, column: toks[k - 1]?.v === '=' ? toks[k - 2]?.v : null, order: out.length })
      return out
    }
    for (const t of toks) if (t.t === 'param') out.push({ table, column: null, order: out.length })
    return out
  }
  if (verb === 'update') {
    const table = toks[1]?.v
    let inSet = false
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k]
      if (up(t) === 'SET') inSet = true
      else if (up(t) === 'WHERE') inSet = false
      if (t.t !== 'param') continue
      out.push({ table, column: inSet && toks[k - 1]?.v === '=' ? toks[k - 2]?.v : null, order: out.length, where: !inSet })
    }
    return out
  }
  for (const t of toks) if (t.t === 'param') out.push({ table: null, column: null, order: out.length })
  return out
}

// Whitelists: `in_array($v, CONST, true)` bounds a value by the longest member of CONST.
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\$]/g, '\\$&')
function whitelistMax(src, ctx) {
  const m = /^\s*(\$\w+)\s*$/.exec(src)
  if (!m || !ctx.fnSource) return null
  const inl = new RegExp('in_array\\(\\s*' + escRe(m[1]) + '\\s*,\\s*\\[([^\\]]*)\\]').exec(ctx.fnSource)
  if (inl) return Math.max(...[...inl[1].matchAll(/'([^']*)'/g)].map((x) => [...x[1]].length), 0)
  const w = new RegExp('in_array\\(\\s*' + escRe(m[1]) + '\\s*,\\s*([A-Z][A-Z0-9_]+)').exec(ctx.fnSource)
  if (!w) return null
  const def = new RegExp('const\\s+' + w[1] + '\\s*=\\s*\\[([^\\]]*)\\]')
  for (const d of ['php-store', 'php-knet', 'php-cbk']) {
    for (const f of readdirSync(join(WEB, 'dropin', d)).filter((x) => x.endsWith('.php'))) {
      const t = readFileSync(join(WEB, 'dropin', d, f), 'utf8')
      const mm = def.exec(t)
      if (mm) return Math.max(...[...mm[1].matchAll(/'([^']*)'/g)].map((x) => [...x[1]].length), 0)
    }
  }
  return null
}

// Integer clamps on a numeric expression: min(N, ...), max(N, ...), digit-count regexes, comparisons on its variable.
function numericBounds(src, ctx, depth = 0) {
  const b = { min: null, max: null, cast: /\(int\)|intval\(/.test(src) }
  for (const m of src.matchAll(/min\(\s*(-?\d+)\s*,/g)) b.max = b.max === null ? +m[1] : Math.min(b.max, +m[1])
  for (const m of src.matchAll(/max\(\s*(-?\d+)\s*,/g)) b.min = b.min === null ? +m[1] : Math.max(b.min, +m[1])
  const v = /^\s*(?:\(int\)\s*)?(\$\w+)\s*$/.exec(src)
  if (v && depth < 3) {
    const last = (ctx.assigns?.[v[1]] ?? []).filter((d) => d.line <= ctx.line).at(-1)
    if (last) { const r = numericBounds(last.src, { ...ctx, line: last.line }, depth + 1); b.max = b.max ?? r.max; b.min = b.min ?? r.min; b.cast = b.cast || r.cast }
    const q = escRe(v[1])
    for (const x of (ctx.fnSource ?? '').matchAll(new RegExp(q + '\\s*>\\s*(\\d+)', 'g'))) b.max = b.max === null ? +x[1] : Math.min(b.max, +x[1])
    const digits = new RegExp('\\[0-9\\]\\{1,(\\d+)\\}[^\']*\'[^;]*' + q).exec(ctx.fnSource ?? '')
    if (digits && b.max === null) b.max = Number('9'.repeat(+digits[1]))
  }
  return b
}

// What a bound expression carries for one column: text caps, or numeric clamps.
// Does the expression (or the variable it names) come from the request?
const REQ = /\$b\[|\$_(GET|POST|REQUEST|COOKIE)|\$body\b|\$input\b|\$in\[|\$data\[|\$payload\b|\$params\b/
export function fromRequest(src, ctx, depth = 0) {
  if (REQ.test(src)) return true
  const v = /\$\w+/.exec(src)
  if (v && depth < 3) {
    const last = (ctx.assigns?.[v[0]] ?? []).filter((d) => d.line <= ctx.line).at(-1)
    if (last && last.src !== src) return fromRequest(last.src, { ...ctx, line: last.line }, depth + 1)
  }
  return false
}

function capShape(def, src, ctx) {
  const cap = columnCapacity(def)
  if (cap) {
    const caps = capsFromExpr(src, ctx)
    const wl = whitelistMax(src, ctx)
    if (wl !== null) caps.push({ n: wl, unit: 'chars', mode: 'whitelist', via: 'in_array(list)' })
    return { caps, column_chars: cap.chars, column_bytes: cap.bytes, byte_limited: !!cap.byteLimited, stringy: !NOT_TEXT.test(src), from_request: fromRequest(src, ctx) }
  }
  const range = numericRange(def)
  if (range && /^\s*(?:\(int\)|intval\()|max\(|min\(/.test(src) && fromRequest(src, ctx)) {
    const nb = numericBounds(src, ctx)
    return { numeric: true, bounds: nb, column_min: String(range.min), column_max: String(range.max), caps: [], stringy: false }
  }
  return null
}

// The inventory: every bound value that lands in a text column, the caps its expression carries, the column capacity.
export function capInventory({ ex, stmts, snap, web = WEB }) {
  const fileCache = new Map()
  const fnSource = (file, func) => {
    const span = ex.funcspans?.[`${file}::${func}`]
    const dir = file.startsWith('php-store') ? 'php-store' : file.startsWith('php-knet') ? 'php-knet' : 'php-cbk'
    const path = join(web, 'dropin', dir, file.split('/')[1])
    if (!fileCache.has(path)) fileCache.set(path, readFileSync(path, 'utf8').split('\n'))
    const lines = fileCache.get(path)
    return span ? lines.slice(span[0] - 1, span[1]).join('\n') : lines.join('\n')
  }
  const items = []
  const colOf = (table, column) => {
    const t = Object.keys(snap).find((x) => x.toLowerCase() === (table ?? '').toLowerCase())
    if (!t) return null
    const c = Object.keys(snap[t].columns).find((x) => x.toLowerCase() === (column ?? '').toLowerCase())
    return c ? { table: t, column: c, def: snap[t].columns[c] } : null
  }
  const pieceSrc = (pcs) => pcs.map((p) => (p[0] === 'lit' ? JSON.stringify(p[1]) : p[0] === 'alt' ? p[3] : p[1])).join(' . ')
  for (const s of stmts) {
    if (!['insert', 'replace', 'update'].includes(verbOf(s.variants[0] ?? ''))) continue
    // `$fields = ['col' => expr, ...]` built into insert (cols) values (...) / update set col = ?: pair key and expression
    if (s.dynamic) {
      const sql0 = s.variants[0]
      const tbl = /^\s*(?:insert\s+(?:ignore\s+)?into|update)\s+`?(\w+)/i.exec(sql0)?.[1]
      const cols = (/^\s*insert[^(]*\(([^)]*)\)/i.exec(sql0)?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean)
      const setCols = [...sql0.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1])
      const want = cols.length ? cols : setCols
      const defs = (ex.funcvars?.[`${s.file}::${s.func}`]?.['$fields'] ?? []).filter((d) => d.op === 'array' && d.line <= s.line)
      const arr = defs.at(-1)
      if (arr && want.length && arr.keys.length && want.slice(0, arr.keys.length).join() === arr.keys.join()) {
        const body = fnSource(s.file, s.func)
        const assigns = ex.assigns?.[`${s.file}::${s.func}`] ?? {}
        arr.keys.forEach((key, k) => {
          const col = colOf(tbl, key)
          if (!col) return
          const src = pieceSrc(arr.items[k] ?? [])
          items.push({ file: s.file, line: arr.line, func: s.func, table: col.table, column: col.column, type: col.def.type, nullable: col.def.null === 'YES', dynamic_fields: true,
            expr: src.length > 110 ? src.slice(0, 107) + '...' : src, ...capShape(col.def, src, { assigns, fnSource: body, line: arr.line + 40 }) })
        })
      }
      continue
    }
    const sql = s.variants[0]
    const targets = paramTargets(sql)
    if (!targets.length) continue
    // the matching execute([...]) : chained, or the first call on the same variable after the statement
    const m = /(\$\w+)\s*=\s*\$\w+\s*->\s*prepare\s*\($/.exec(s.ctx ?? '')
    const recv = m ? m[1] : null
    let call = (ex.executes ?? []).find((e) => e.file === s.file && e.func === s.func && e.line >= s.end_line - 0 && e.line <= s.end_line + 3 && (e.recv === 'chain' || e.recv === recv))
    if (!call && recv) call = (ex.executes ?? []).filter((e) => e.file === s.file && e.func === s.func && e.recv === recv && e.line >= s.end_line).sort((a, b) => a.line - b.line)[0]
    if (!call) continue
    if (call.args.some((a) => a.startsWith('...')) || call.args.length !== targets.length) { items.push({ file: s.file, line: s.line, func: s.func, skipped: call.args.length === targets.length ? 'spread arguments' : `${targets.length} placeholders, ${call.args.length} arguments` }); continue }
    const body = fnSource(s.file, s.func)
    const assigns = ex.assigns?.[`${s.file}::${s.func}`] ?? {}
    targets.forEach((t, k) => {
      if (!t.column || t.where) return
      const col = colOf(t.table, t.column)
      if (!col) return
      const src = call.args[k]
      const shape = capShape(col.def, src, { assigns, fnSource: body, line: call.line })
      if (!shape) return
      items.push({ file: s.file, line: call.line, func: s.func, table: col.table, column: col.column, type: col.def.type, nullable: col.def.null === 'YES',
        expr: src.length > 110 ? src.slice(0, 107) + '...' : src, ...shape })
    })
  }
  return items
}

export function judgeCaps(items) {
  const out = []
  for (const it of items) {
    if (it.numeric) {
      const hi = it.bounds.max, lo = it.bounds.min
      let verdict = 'fits', note
      if (hi === null && it.bounds.cast) { verdict = 'unclamped'; note = `(int) cast with no ceiling; column holds up to ${it.column_max}` }
      else if (hi !== null && hi > Number(it.column_max)) { verdict = 'exceeds'; note = `ceiling ${hi} > column max ${it.column_max}` }
      if (lo !== null && lo < Number(it.column_min)) { verdict = 'exceeds'; note = `floor ${lo} < column min ${it.column_min}` }
      out.push({ ...it, verdict, note })
      continue
    }
    if (it.skipped || !it.stringy) continue
    const chars = it.caps.filter((c) => c.unit === 'chars').map((c) => c.n)
    const bytes = it.caps.filter((c) => c.unit === 'bytes').map((c) => c.n)
    const bound = chars.length ? Math.min(...chars) : (bytes.length ? Math.min(...bytes) : null)
    const rejecting = it.caps.some((c) => c.mode === 'reject')
    let verdict, note
    if (bound === null) { verdict = 'uncapped'; note = `no cap found in the code for a ${it.type} column` }
    else if (it.byte_limited) {
      const worst = chars.length ? bound * 4 : bound
      if (worst > it.column_bytes) { verdict = 'exceeds'; note = `${bound} ${chars.length ? 'chars (4 bytes each = ' + worst + ' bytes)' : 'bytes'} > ${it.column_bytes} bytes` }
      else verdict = 'fits'
    } else if (bound > it.column_chars) { verdict = 'exceeds'; note = `cap ${bound} ${chars.length ? 'chars' : 'bytes'} > column ${it.column_chars} chars` }
    else verdict = 'fits'
    out.push({ ...it, bound, bound_unit: chars.length ? 'chars' : bytes.length ? 'bytes' : null, rejecting, verdict, note })
  }
  return out
}

// Same column name, different capacity in two tables: where one is copied into the other, the smaller one loses data.
export function capacityDrift(snap) {
  const by = new Map()
  for (const [t, T] of Object.entries(snap)) for (const [c, d] of Object.entries(T.columns)) {
    const cap = columnCapacity(d)
    if (!cap || cap.byteLimited) continue
    if (!by.has(c)) by.set(c, [])
    by.get(c).push({ table: t, chars: cap.chars })
  }
  const out = []
  for (const [c, list] of by) {
    const sizes = new Set(list.map((x) => x.chars))
    if (sizes.size > 1) out.push({ column: c, tables: list.sort((a, b) => b.chars - a.chars) })
  }
  return out.sort((a, b) => a.column.localeCompare(b.column))
}

// ---------------------------------------------------------------- schema hygiene (numeric, charset, keys)

const MONEY_NAME = /(^|_)(amount|price|subtotal|total|fee|cost|value|min_order|discount_amount|delivery_fee|paid_total)(_|$)/i
export function numericAudit(snap) {
  const out = { money_columns: [], floats: [], range_notes: [] }
  for (const [t, T] of Object.entries(snap)) for (const [c, d] of Object.entries(T.columns)) {
    if (/^(float|double|real)/.test(d.type)) out.floats.push({ table: t, column: c, type: d.type })
    const dm = /^decimal\((\d+),(\d+)\)/.exec(d.type)
    if (dm && MONEY_NAME.test(c)) out.money_columns.push({ table: t, column: c, type: d.type, precision: +dm[1], scale: +dm[2], max: numericRange(d)?.max, unsigned: /unsigned/.test(d.type) })
  }
  return out
}
export function charsetAudit(snap) {
  const out = []
  for (const [t, T] of Object.entries(snap)) for (const [c, d] of Object.entries(T.columns)) {
    if (!d.cs) continue
    if (d.cs !== 'utf8mb4') out.push({ table: t, column: c, issue: `character set ${d.cs} (Arabic and emoji need utf8mb4)` })
    else if (d.coll !== T.collation && !/_bin$/.test(d.coll)) out.push({ table: t, column: c, issue: `collation ${d.coll} differs from the table's ${T.collation} (comparisons across tables need a COLLATE)` })
  }
  return out
}
export function keyAudit(snap) {
  const out = []
  for (const [t, T] of Object.entries(snap)) {
    if (!T.indexes.PRIMARY) out.push({ table: t, issue: 'no primary key' })
    const list = Object.entries(T.indexes).filter(([n]) => n !== 'PRIMARY')
    for (const [n, x] of list) for (const [m, y] of list) {
      if (n === m || x.unique) continue
      if (x.cols.length < y.cols.length && x.cols.every((c, k) => y.cols[k] === c)) out.push({ table: t, issue: `index ${n}(${x.cols.join(',')}) is a prefix of ${m}(${y.cols.join(',')}) and adds nothing` })
      if (n < m && x.cols.join() === y.cols.join() && x.unique === y.unique) out.push({ table: t, issue: `indexes ${n} and ${m} cover the same columns (${x.cols.join(',')})` })
    }
    for (const [n, fk] of Object.entries(T.fks)) {
      const covered = Object.values(T.indexes).some((x) => fk.cols.every((c, k) => x.cols[k] === c))
      if (!covered) out.push({ table: t, issue: `foreign key ${n} (${fk.cols.join(',')}) has no index to use` })
    }
  }
  return out
}

// ---------------------------------------------------------------- the real routes, on a private stack

// Runs `fn` for L = lo..hi looking for the largest L that satisfies `ok`, assuming ok is true up to a threshold and false after.
export async function largest(lo, hi, ok) {
  if (!(await ok(lo))) return lo - 1
  let a = lo, b = hi
  if (await ok(b)) return b
  while (b - a > 1) { const m = (a + b) >> 1; if (await ok(m)) a = m; else b = m }
  return a
}

const SP_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
export const SQL_MODES = {
  strict: 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION', // MariaDB 10.2.4+ / 11.8 default
  lax: 'NO_ENGINE_SUBSTITUTION',                                                                          // what a pre-strict host or a restored dump gives
}

// An email address of exactly L characters (local part <= 64, labels <= 63) that is unique per n.
export function emailOf(L, n) {
  const local = `u${n.toString(36)}`
  let rest = L - local.length - 1 // domain length
  if (rest < 6) return `${local}@a.io`
  const labels = []
  while (rest > 0) {
    if (rest <= 63) { labels.push(rest >= 4 ? 'b'.repeat(rest - 4) + '.com' : 'x'.repeat(rest)); rest = 0 }
    else { labels.push('d'.repeat(60) + '.'); rest -= 61 }
  }
  const dom = labels.join('')
  return `${local}@${dom.replace(/\.\./g, '.')}`
}

// Each case: a field of a route, the column it lands in, how to send a value of L characters and how to read back what was stored.
let SEQ = Date.now() % 100000000
const seq = () => ++SEQ
export function routeCases(rig, ctx) {
  const T = [] // cases
  const text = (L) => 'ع'.repeat(L)
  const ascii = (L) => 'a'.repeat(L)
  const uniq = () => seq().toString(36)
  const nextN = seq
  const order = (field, column, { min = 2, make = text, group = 'customer', extra = null } = {}) => ({
    id: `order.${group}.${field}`, route: 'api.php?r=order', column, min, max: 4000,
    send: (L) => rig.order({ track: `PB${uniq()}${'Z'.repeat(8)}`.slice(0, 20), items: ctx.items, method: 'cod', phone: rig.freshPhone(),
      customer: group === 'customer' ? { [field]: make(L) } : {}, extra: extra ? extra(make(L)) : {} }),
    stored: (col) => rig.one(`select char_length(${col.split('.')[1]}) from orders order by id desc limit 1`),
  })
  for (const [f, c, min] of [['name', 'customer_name', 2], ['area', 'customer_area', 2], ['block', 'customer_block', 1], ['street', 'customer_street', 1],
    ['building', 'customer_building', 1], ['floor', 'customer_floor', 1], ['flat', 'customer_flat', 1], ['note', 'customer_note', 1]]) T.push(order(f, `orders.${c}`, { min }))
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'referrer_host']) {
    T.push(order(k, `orders.${k}`, { min: 1, make: ascii, group: 'attribution', extra: (v) => ({ attribution: { [k]: v } }) }))
  }
  T.push({ id: 'order.track_id', route: 'api.php?r=order', column: 'orders.track_id', min: 8, max: 200,
    send: (L) => rig.order({ track: `Q${uniq()}`.padEnd(L, 'Q'), items: ctx.items, method: 'cod', phone: rig.freshPhone() }),
    stored: () => rig.one('select char_length(track_id) from orders order by id desc limit 1') })

  const cust = (path, body) => fetch(`${rig.SITE}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Customer': '1', 'X-Forwarded-For': rig.freshIp() }, body: JSON.stringify(body) })
    .then(async (r) => { const t = await r.text(); let b = null; try { b = JSON.parse(t) } catch { /* not json */ } return { status: r.status, body: b, text: t } })
  const PW = 'probe-password-0001'
  T.push({ id: 'register.name', route: 'customer.php?r=register', column: 'customer_accounts.name', min: 2, max: 400,
    send: (L) => cust('customer.php?r=register', { name: text(L), email: emailOf(30, nextN()), password: PW }),
    stored: () => rig.one('select char_length(name) from customer_accounts order by id desc limit 1') })
  T.push({ id: 'register.email', route: 'customer.php?r=register', column: 'customer_accounts.email', min: 12, max: 400,
    send: (L) => cust('customer.php?r=register', { name: 'Probe User', email: emailOf(L, nextN()), password: PW }),
    stored: () => rig.one('select char_length(email) from customer_accounts order by id desc limit 1') })
  const sup = (patch) => cust('api.php?r=support_create', { name: 'Probe User', email: emailOf(30, nextN()), subject: 'Probe subject', message: 'Probe message text', ...patch })
  T.push({ id: 'support.name', route: 'api.php?r=support_create', column: 'support_tickets.customer_name', min: 2, max: 400, send: (L) => sup({ name: text(L) }), stored: () => rig.one('select char_length(customer_name) from support_tickets order by id desc limit 1') })
  T.push({ id: 'support.subject', route: 'api.php?r=support_create', column: 'support_tickets.subject', min: 3, max: 600, send: (L) => sup({ subject: text(L) }), stored: () => rig.one('select char_length(subject) from support_tickets order by id desc limit 1') })
  T.push({ id: 'support.email', route: 'api.php?r=support_create', column: 'support_tickets.customer_email', min: 12, max: 400, send: (L) => sup({ email: emailOf(L, nextN()) }), stored: () => rig.one('select char_length(customer_email) from support_tickets order by id desc limit 1') })
  T.push({ id: 'support.message', route: 'api.php?r=support_create', column: 'support_messages.body', min: 5, max: 4000, send: (L) => sup({ message: text(L) }), stored: () => rig.one('select char_length(body) from support_messages order by id desc limit 1') })

  const adm = (route, body) => rig.admin(route, { method: 'POST', body })
  const prod = (patch) => adm('product_save', { id: 0, slug: `pb${uniq()}`, name_en: 'Probe Product', name_ar: 'منتج', price: '1.000', active: true, desc_en: '', desc_ar: '', category: 'probe', brand_slug: '', image: '', images: '', ...patch })
  const pstored = (c) => rig.one(`select char_length(${c}) from products order by id desc limit 1`)
  T.push({ id: 'product.slug', route: 'admin.php?r=product_save', column: 'products.slug', min: 12, max: 400, send: (L) => prod({ slug: `pb${uniq()}`.padEnd(L, 'a') }), stored: () => pstored('slug') })
  for (const [f, min] of [['name_en', 1], ['name_ar', 1], ['desc_en', 1], ['desc_ar', 1], ['category', 1]]) {
    T.push({ id: `product.${f}`, route: 'admin.php?r=product_save', column: `products.${f}`, min, max: 700, send: (L) => prod({ [f]: text(L) }), stored: () => pstored(f) })
  }
  T.push({ id: 'product.image', route: 'admin.php?r=product_save', column: 'products.image', min: 20, max: 1500, send: (L) => prod({ image: `/images/products/${'a'.repeat(Math.max(1, L - 21))}.jpg`.padEnd(L, 'a').slice(0, L) }), stored: () => pstored('image') })
  const brand = (patch) => adm('brand_save', { id: 0, name_en: 'Probe Brand', name_ar: 'علامة', slug: `pbb${uniq()}`, sort: 0, ...patch })
  const bstored = (c) => rig.one(`select char_length(${c}) from brands order by id desc limit 1`)
  T.push({ id: 'brand.name_en', route: 'admin.php?r=brand_save', column: 'brands.name_en', min: 1, max: 400, send: (L) => brand({ name_en: text(L), slug: `pbb${uniq()}` }), stored: () => bstored('name_en') })
  T.push({ id: 'brand.name_ar', route: 'admin.php?r=brand_save', column: 'brands.name_ar', min: 1, max: 400, send: (L) => brand({ name_ar: text(L) }), stored: () => bstored('name_ar') })
  T.push({ id: 'brand.slug', route: 'admin.php?r=brand_save', column: 'brands.slug', min: 12, max: 400, send: (L) => brand({ slug: `pbb${uniq()}`.padEnd(L, 'a') }), stored: () => bstored('slug') })
  const disc = (patch) => adm('discount_save', { id: 0, kind: 'code', code: `PB${uniq().toUpperCase()}`, label: 'Probe', type: 'percent', value: 10, min_order: 0, active: 0, ...patch })
  const dstored = (c) => rig.one(`select char_length(${c}) from discounts order by id desc limit 1`)
  T.push({ id: 'discount.code', route: 'admin.php?r=discount_save', column: 'discounts.code', min: 12, max: 100, send: (L) => disc({ code: `PB${uniq().toUpperCase()}`.padEnd(L, 'A') }), stored: () => dstored('code') })
  T.push({ id: 'discount.label', route: 'admin.php?r=discount_save', column: 'discounts.label', min: 2, max: 300, send: (L) => disc({ label: text(L) }), stored: () => dstored('label') })
  T.push({ id: 'discount.category', route: 'admin.php?r=discount_save', column: 'discounts.category', min: 1, max: 700, send: (L) => disc({ category: text(L) }), stored: () => dstored('category') })
  const slide = (patch) => adm('slide_save', { id: 0, image: SP_PNG, active: 0, sort: 90, ...patch })
  const sstored = (c) => rig.one(`select char_length(${c}) from hero_slides order by id desc limit 1`)
  for (const f of ['title_en', 'title_ar', 'subtitle_en', 'subtitle_ar', 'cta_label_en', 'cta_label_ar']) {
    T.push({ id: `slide.${f}`, route: 'admin.php?r=slide_save', column: `hero_slides.${f}`, min: 1, max: 700, send: (L) => slide({ [f]: text(L) }), stored: () => sstored(f) })
  }
  T.push({ id: 'slide.cta_href', route: 'admin.php?r=slide_save', column: 'hero_slides.cta_href', min: 2, max: 700, send: (L) => slide({ cta_href: `/${'a'.repeat(L - 1)}` }), stored: () => sstored('cta_href') })
  T.push({ id: 'block.reason', route: 'admin.php?r=block_customer', column: 'blocked_customers.reason', min: 1, max: 700, send: (L) => adm('block_customer', { phone: rig.freshPhone(), scope: 'cod', reason: text(L) }), stored: () => rig.one('select char_length(reason) from blocked_customers order by id desc limit 1') })
  return T
}

// numeric extremes through the admin routes
export function numericCases(rig) {
  const adm = (route, body) => rig.admin(route, { method: 'POST', body })
  const uniq = () => seq().toString(36)
  const disc = (patch) => adm('discount_save', { id: 0, kind: 'code', code: `PN${uniq().toUpperCase()}`, label: 'Probe', type: 'percent', value: 10, min_order: 0, active: 0, ...patch })
  const slide = (patch) => adm('slide_save', { id: 0, image: SP_PNG, active: 0, ...patch })
  return [
    { id: 'discount.min_order', column: 'discounts.min_order', values: [9999999.999, 10000000, 1e12], send: (v) => disc({ min_order: v }), stored: () => rig.one('select min_order from discounts order by id desc limit 1') },
    { id: 'discount.usage_limit', column: 'discounts.usage_limit', values: [4294967295, 4294967296, 5e9], send: (v) => disc({ usage_limit: v }), stored: () => rig.one('select usage_limit from discounts order by id desc limit 1') },
    { id: 'slide.sort', column: 'hero_slides.sort', values: [2147483647, 2147483648, 3e9], send: (v) => slide({ sort: v }), stored: () => rig.one('select sort from hero_slides order by id desc limit 1') },
    { id: 'brand.sort', column: 'brands.sort', values: [2147483647, 2147483648, 3e9], send: (v) => adm('brand_save', { id: 0, name_en: 'NB', name_ar: 'ن', slug: `nb${uniq()}`, sort: v }), stored: () => rig.one('select sort from brands order by id desc limit 1') },
    { id: 'product.featured_sort', column: 'products.featured_sort', values: [100000], send: (v) => adm('product_save', { id: 0, slug: `nf${uniq()}`, name_en: 'NF', name_ar: 'ن', price: '1.000', active: true, category: 'x', featured: true, featured_sort: v }), stored: () => rig.one('select featured_sort from products order by id desc limit 1') },
    { id: 'product.price', column: 'products.price', values: ['9999999.999'], send: (v) => adm('product_save', { id: 0, slug: `np${uniq()}`, name_en: 'NP', name_ar: 'ن', price: v, active: true, category: 'x' }), stored: () => rig.one('select price from products order by id desc limit 1') },
  ]
}

export async function probeRoutes({ snap, log = () => {}, only = null, tree = null, numeric = true, snapshotCase = true } = {}) {
  const { startRig } = await import('./lib/race-rig.mjs')
  const rig = await startRig({ dbPortFrom: 34100, sitePortFrom: 34300, workers: 6, ...(tree ? { tree } : {}) })
  if (rig.skip) return { skipped: rig.skip }
  const out = { sql_modes: SQL_MODES, cases: [], numeric: [], product_to_order_items: null, php_errors: '' }
  try {
    if (!(await rig.adminSignIn())) return { skipped: 'the admin could not sign in on the private stack' }
    const item = (await rig.sql("select concat(v.slug, '|', v.size) from product_variants v join products p on p.slug = v.slug where p.active = 1 and v.stock > 0 order by v.sku limit 1")).split('|')
    const ctx = { items: [{ slug: item[0], size: item[1], qty: 1 }] }
    const colChars = (col) => { const [t, c] = col.split('.'); const d = snap[t]?.columns[c]; const cap = d && columnCapacity(d); return cap ? cap.chars : null }
    const cases = routeCases(rig, ctx).filter((c) => !only || only.includes(c.id))
    for (const [mode, mysqlMode] of Object.entries(SQL_MODES)) {
      await rig.sql(`set global sql_mode = '${mysqlMode}'`, null)
      for (const c of cases) {
        const cls = async (L) => {
          const r = await c.send(L)
          if (r.status >= 200 && r.status < 300) {
            const st = Number(await c.stored(c.column))
            return { cls: st === L ? 'full' : 'truncated', status: r.status, stored: st }
          }
          return { cls: r.status >= 500 ? 'db_error' : 'reject', status: r.status, error: r.body?.error ?? null }
        }
        const base = await cls(c.min)
        const rec = out.cases.find((x) => x.id === c.id) ?? (out.cases.push({ id: c.id, route: c.route, column: c.column, column_chars: colChars(c.column), modes: {} }), out.cases.at(-1))
        if (base.cls !== 'full') { rec.modes[mode] = { setup_failed: base }; continue }
        const max2xx = await largest(c.min, c.max, async (L) => { const r = await cls(L); return r.cls === 'full' || r.cls === 'truncated' })
        const maxFull = await largest(c.min, Math.min(c.max, max2xx), async (L) => (await cls(L)).cls === 'full')
        const at = await cls(max2xx)
        const next = max2xx < c.max ? await cls(max2xx + 1) : null
        rec.modes[mode] = { accepts_up_to: max2xx, stored_in_full_up_to: maxFull, outcome_at_max: at, outcome_just_above: next }
        log(`${mode} ${c.id}: accepts ${max2xx}, full ${maxFull}, column ${rec.column_chars}`)
      }
    }
    // strict outcome at the length the lax run says the PHP accepts
    await rig.sql(`set global sql_mode = '${SQL_MODES.strict}'`, null)
    for (const c of cases) {
      const rec = out.cases.find((x) => x.id === c.id)
      const lax = rec.modes.lax
      if (!lax || lax.setup_failed || lax.accepts_up_to <= (rec.column_chars ?? Infinity)) continue
      const L = lax.accepts_up_to
      const r = await c.send(L)
      rec.strict_at_php_cap = { length: L, status: r.status, error: r.body?.error ?? null }
    }
    // numeric extremes, both modes
    for (const [mode, mysqlMode] of numeric ? Object.entries(SQL_MODES) : []) {
      await rig.sql(`set global sql_mode = '${mysqlMode}'`, null)
      for (const c of numericCases(rig)) {
        const rec = out.numeric.find((x) => x.id === c.id) ?? (out.numeric.push({ id: c.id, column: c.column, modes: {} }), out.numeric.at(-1))
        rec.modes[mode] = []
        for (const v of c.values) {
          const r = await c.send(v)
          const ok = r.status >= 200 && r.status < 300
          rec.modes[mode].push({ sent: v, status: r.status, error: r.body?.error ?? null, stored: ok ? await c.stored() : null })
        }
      }
    }
    // the snapshot of a product name into an order line (order_items.name_en / name_ar)
    if (snapshotCase) {
      const res = {}
      for (const [mode, mysqlMode] of Object.entries(SQL_MODES)) {
        await rig.sql(`set global sql_mode = '${mysqlMode}'`, null)
        const slug = `snap-${mode}-${Date.now().toString(36)}`
        const saved = await rig.admin('product_save', { method: 'POST', body: { id: 0, slug, name_en: 'E'.repeat(160), name_ar: 'ع'.repeat(160), price: '2.000', active: true, category: 'x' } })
        await rig.sql(`insert into product_variants (sku, slug, size, stock) values ('SN${mode.toUpperCase()}${Date.now().toString(36)}'.substring(0, 30), '${slug}', 'M', 5)`, null).catch(() => {})
        const o = await rig.order({ track: `SNAP${mode}${Date.now().toString(36)}`.slice(0, 24).toUpperCase(), items: [{ slug, size: 'M', qty: 1 }], method: 'cod', phone: rig.freshPhone() })
        res[mode] = { product_save: saved.status, order: o.status, order_error: o.body?.error ?? null,
          stored_len: o.status === 200 ? Number(await rig.one(`select char_length(name_en) from order_items order by id desc limit 1`)) : null }
      }
      out.product_to_order_items = res
    }
    out.php_errors = rig.phpErrors().split('\n').filter(Boolean).slice(-6).map((l) => l.replace(/\/tmp\/\S+/g, '<tmp>').slice(0, 220))
  } finally { rig.stop() }
  return out
}

// ---------------------------------------------------------------- findings

const SEV = { high: 0, medium: 1, low: 2 }
const tableOf = (sql, snap) => {
  const m = /\b(?:from|update|into|join)\s+`?(\w+)`?/i.exec(sql ?? '')
  return m && snap[m[1]] ? m[1] : (m ? m[1] : '?')
}

// The findings the tool can derive on its own. `R` is the result of runAudit() (+ optional R.probe and R.schema_diff).
export function buildFindings(R) {
  const F = []
  const add = (f) => F.push({ confidence: 'high', ...f })
  const snap = R._snap ?? {}
  const snapPlus = R._snapPlus ?? snap

  // ---- A. statements MariaDB refuses
  const byCol = new Map()
  for (const f of R.explain?.failed_list ?? []) for (const e of f.errors) {
    const key = `${e.kind}:${(e.column ?? e.table ?? e.message).toLowerCase()}`
    if (!byCol.has(key)) byCol.set(key, { e, sites: [], addon: f.verdict_with_addons !== 'failed' })
    byCol.get(key).sites.push(`${f.file}:${f.line}`)
  }
  for (const [, v] of byCol) {
    const { e, sites } = v
    const col = (e.column ?? '').split('.').pop()
    const table = Object.keys(snapPlus).find((t) => snapPlus[t].columns[col]) ?? tableOf(e.sql, snap)
    const inAddon = v.addon
    if (e.kind === 'unknown_column') {
      add({ severity: 'high', table, column: col, kind: 'code-refers-to-missing-column',
        evidence: `MariaDB ${e.code} "${e.message}" for ${[...new Set(sites)].slice(0, 6).join(', ')} against the schema every repository migration builds${inAddon ? '; the same statements parse once the sporta-live add-on migration ' + (R.addon_files ?? []).join(', ') + ' is applied' : ''}`,
        cause: inAddon ? `${table}.${col} is created only by an add-on migration kept outside dropin/php-store (sporta-live/), so install.mysql.sql and every dropin migration leave it out while the PHP in dropin/php-store reads and writes it, unguarded outside one SHOW COLUMNS check`
                      : `no migration or schema file creates ${table}.${col}`,
        fix: inAddon ? 'new additive migration dropin/php-store/birthday.mysql.sql (same idempotent statement as the add-on) plus a patch adding it to PARTS in scripts/make-install-sql.mjs' : 'a new additive migration that creates the column',
        confidence: inAddon ? 'high' : 'medium' })
    } else if (e.kind === 'unknown_table') {
      add({ severity: 'high', table: e.table ?? '?', column: '*', kind: 'code-refers-to-missing-column', evidence: `MariaDB ${e.code} "${e.message}" for ${sites.slice(0, 4).join(', ')}`, cause: 'no migration creates the table', fix: 'a new additive migration that creates the table' })
    } else {
      add({ severity: 'medium', table: '?', column: '*', kind: 'other', evidence: `MariaDB ${e.code} ${e.kind}: "${e.message}" for ${sites.slice(0, 4).join(', ')}`, cause: 'a statement the schema cannot run', fix: 'fix the statement', confidence: 'medium' })
    }
  }

  // ---- A2. statements the code guards, on a column only an add-on migration creates
  const offBy = new Map()
  for (const f of R.explain?.guarded_list ?? []) for (const e of f.guarded) {
    const col = (e.column ?? '').split('.').pop()
    const table = Object.keys(snapPlus).find((t) => snapPlus[t].columns[col]) ?? '?'
    if (!snapPlus[table]?.columns[col] || snap[table]?.columns[col]) continue
    const k = `${table}.${col}`
    if (!offBy.has(k)) offBy.set(k, { table, col, guard: e.guard_by, sites: [] })
    offBy.get(k).sites.push(`${f.file}:${f.line}`)
  }
  const byTable = new Map()
  for (const v of offBy.values()) { if (!byTable.has(v.table)) byTable.set(v.table, []); byTable.get(v.table).push(v) }
  for (const [table, list] of byTable) add({ severity: 'medium', table, column: list.map((v) => v.col).join(','), kind: 'drift',
    evidence: `MariaDB refuses ${[...new Set(list.flatMap((v) => v.sites))].slice(0, 8).join(', ')} against the schema every dropin migration builds (Unknown column ${list.map((v) => v.col).join(', ')}); the code guards them with ${[...new Set(list.map((v) => v.guard))].join(', ')} so they answer 503 / "STATE ready=0" instead of running, and they parse once ${(R.addon_files ?? []).join(', ')} is applied`,
    cause: `${list.map((v) => table + '.' + v.col).join(', ')} are created only by an add-on migration kept outside dropin/php-store (sporta-live/), so install.mysql.sql and the dropin migrations never create them: on an installation built from this folder the feature is silently off`,
    fix: 'new additive migration dropin/php-store/birthday.mysql.sql (the same idempotent statement) and add it to PARTS in scripts/make-install-sql.mjs (install-parts.patch)', confidence: 'high' })

  for (const f of R.explain_hardened?.new_failures ?? []) add({ severity: 'medium', table: tableOf(f.sql, snap), column: '*', kind: 'other', confidence: 'high',
    evidence: `${f.file}:${f.line} (${f.func}) is accepted by the default sql_mode but refused under the hardened mode ops/db/sporta-db-hardening.cnf proposes (${R.explain_hardened.sql_mode}): ${f.errors.join('; ')}`,
    cause: 'a query that relies on a lax SQL mode (e.g. a non-aggregated column in a GROUP BY query)', fix: 'fix the query before the hardened sql_mode is applied to the live server' })

  // ---- B. guards
  const guardSites = new Map()
  for (const g of R.guards ?? []) {
    if (g.column_exists_in_schema || g.column_exists_with_addons) continue
    const k = `${g.table}.${g.column}`
    if (!guardSites.has(k)) guardSites.set(k, { g, sites: [] })
    guardSites.get(k).sites.push(`${g.file}:${g.line}`)
  }
  for (const { g, sites } of guardSites.values()) {
    add({ severity: 'low', table: g.table, column: g.column, kind: 'dead-column',
      evidence: `${sites.join(', ')} (${g.kind}) ask whether ${g.table}.${g.column} exists; no migration, schema file or add-on creates it, so the guard answers "no" on every installation built from this repository`,
      cause: 'the code was written for a column that was never added; the guarded feature silently falls back (null / no lastmod)',
      fix: g.column === 'last_login_at' ? 'new additive migration customer-last-login.mysql.sql, and the guarded sign-in write in customer.php (customer-last-login-write.patch) so the Profiles column carries a value' : g.column === 'updated_at' ? 'new additive migration products-updated-at.mysql.sql so the sitemap can carry a real lastmod' : 'create the column or delete the guard',
      confidence: 'high' })
  }

  // ---- C. install order and idempotence
  const sd = R.schema_diff
  if (sd) {
    const reportedFiles = new Set()
    for (const k of ['docs', 'tooling', 'install']) for (const r of sd.apply?.[k] ?? []) if (!r.ok && !reportedFiles.has(r.file)) {
      reportedFiles.add(r.file)
      const missingCol = /Key column '(\w+)' doesn't exist/.exec(r.message ?? '')?.[1] ?? null
      const owner = missingCol ? Object.keys(snap).find((t) => snap[t].columns[missingCol]) ?? '-' : '-'
      add({ severity: k === 'docs' ? 'medium' : 'high', table: owner, column: missingCol ?? '-', kind: 'drift',
        evidence: `${r.file} failed in the "${k}" install order: ${r.message}; ${sd.diffs?.docs_vs_tooling?.length ?? 0} difference(s) against the tooling order remain (tables: ${[...new Set((sd.diffs?.docs_vs_tooling ?? []).filter((d) => d.scope === 'table').map((d) => d.table))].join(', ') || 'none'})`,
        cause: `${r.file} depends on a column or table an earlier-named file creates; the alphabetical order the repository's other tools avoid does not satisfy it`,
        fix: 'patch the migration so it creates what it needs (idempotently)' })
    }
    for (const r of sd.apply?.second_pass ?? []) if (!r.ok) add({ severity: 'medium', table: '-', column: '-', kind: 'drift', evidence: `${r.file} fails when applied a second time: ${r.message}`, cause: 'the file is not idempotent (a plain ADD COLUMN / CREATE without IF NOT EXISTS)', fix: 'use IF NOT EXISTS / guarded statements' })
    for (const r of sd.hardened?.apply ?? []) add({ severity: 'medium', table: '-', column: '-', kind: 'drift', evidence: `${r.file} fails under the sql_mode ops/db/sporta-db-hardening.cnf proposes (${sd.hardened.sql_mode}): ${r.message}`, cause: 'a zero-date default, an out-of-range literal or another statement the stricter mode refuses', fix: 'change the statement before the mode is applied to the live server, or an install or a re-run of this file fails' })
    for (const r of sd.apply?.second_pass_install ?? []) if (!r.ok) add({ severity: 'medium', table: '-', column: '-', kind: 'drift', evidence: `${r.file} fails when applied a second time: ${r.message}`, cause: 'not idempotent', fix: 'use IF NOT EXISTS' })
    if (sd.rows_changed_by_second_pass?.length) add({ severity: 'medium', table: sd.rows_changed_by_second_pass.map((x) => x.table).join(','), column: '-', kind: 'drift', evidence: `a second run changed row counts: ${JSON.stringify(sd.rows_changed_by_second_pass)}`, cause: 'a data statement is not idempotent', fix: 'insert ... on duplicate / where not exists' })
    for (const d of (sd.diffs?.install_vs_tooling ?? []).slice(0, 12)) {
      const onlyInTooling = d.issue === 'only_in_b'
      const detail = d.scope === 'table' ? '' : ` ${JSON.stringify(d.a ?? d.b ?? '').slice(0, 160)}`
      add({ severity: 'medium', table: d.table, column: d.scope === 'table' ? '*' : d.name, kind: 'drift',
        evidence: `install.mysql.sql alone builds a schema that differs from schema.mysql.sql + the parts + every other additive file: ${d.scope} ${d.table}${d.scope === 'table' ? '' : '.' + d.name} is ${onlyInTooling ? 'created only by the additive files' : d.issue.replace('only_in_a', 'created only by install.mysql.sql')}${detail}. A database installed from the one file does not have it; the rigs (sandbox.sh, race-rig, pool-rig) apply every other file after install, so they do not notice.`,
        cause: onlyInTooling ? 'a migration file that is not one of the PARTS in scripts/make-install-sql.mjs and is not repeated in schema.mysql.sql (a header comment may say it is)' : 'install.mysql.sql was generated from a different part list or is stale',
        fix: onlyInTooling ? 'add the file to PARTS in scripts/make-install-sql.mjs and regenerate install.mysql.sql, or repeat the statement in schema.mysql.sql' : 'node scripts/make-install-sql.mjs' })
    }
    for (const sh of sd.order?.shuffles ?? []) for (const x of sh.failed) {
      const key = `order:${x.file}`
      if (!reportedFiles.has(x.file) && !F.some((f) => f.key === key)) add({ key, severity: 'low', table: '-', column: '-', kind: 'drift', evidence: `${x.file} failed in ${sd.order.shuffles.filter((s) => s.failed.some((y) => y.file === x.file)).length} of ${sd.order.shuffles.length} shuffled orders: ${x.error}; a second pass over the failed files repairs every order (${sh.still_failing_after_retry.length} still failing)`, cause: 'ordering dependency between migrations', fix: 'make the dependent file self-sufficient' })
    }
    // the structure dump of 2026-11-01
    const live = sd.diffs?.live_vs_tooling
    if (live?.length) {
      const liveOnlyTables = live.filter((d) => d.scope === 'table' && d.issue === 'only_in_a').map((d) => d.table)
      const repoOnlyTables = live.filter((d) => d.scope === 'table' && d.issue === 'only_in_b').map((d) => d.table)
      const conflicts = [...new Set(live.filter((d) => d.scope === 'column' && d.issue.startsWith('differs')).map((d) => d.table))]
      const legacy = ['return_requests', 'return_request_items', 'admin_password_resets'].filter((t) => !liveOnlyTables.includes(t) && live.some((d) => d.table === t))
      if (legacy.length) add({ severity: 'medium', table: legacy.join(','), column: '-', kind: 'drift', confidence: 'low',
        evidence: `docs/live-schema-structure.sql (production dump of 2026-11-01) has these tables in an older layout than the repository (e.g. return_requests has ref/kind/phone/status default 'new', the repository's has reference/eligibility/contact_phone/status default 'submitted'); every repository migration for them is CREATE TABLE IF NOT EXISTS, so a database that already had them keeps the old layout`,
        cause: 'the live database predates the repository tables; DATA-SCAN-2026-11-02 records "three *_legacy_2026102x tables" and "nothing the repo defines is missing", which fits a rename of exactly these three, but only a live information_schema read can show it',
        fix: 'run the read-only live schema diff (scripts/db-schema-diff.mjs --print-queries / --against, ops/db/SCHEMA-AUDIT.md) before any deploy that touches returns or admin password reset' })
      const notNullLiveOnly = live.filter((d) => d.scope === 'column' && d.issue === 'only_in_a' && !liveOnlyTables.includes(d.table) && d.a?.null === 'NO' && d.a?.def === null && !legacy.includes(d.table))
      for (const d of notNullLiveOnly) add({ severity: 'high', table: d.table, column: d.name, kind: 'nullability-default', confidence: 'medium', evidence: `the 2026-11-01 dump has ${d.table}.${d.name} ${d.a.type} NOT NULL with no default; no repository INSERT names it, so under strict mode every insert into ${d.table} fails with 1364`, cause: 'column from the old build', fix: 'give it a default or drop the NOT NULL (new migration), after reading the live column' })
      const liveOnlyCols = live.filter((d) => d.scope === 'column' && d.issue === 'only_in_a' && !liveOnlyTables.includes(d.table) && !legacy.includes(d.table))
      add({ severity: 'low', table: '*', column: '*', kind: 'drift', confidence: 'medium',
        evidence: `against the 2026-11-01 dump: ${liveOnlyTables.length} tables exist only live (${liveOnlyTables.slice(0, 40).join(', ')}) and ${liveOnlyCols.length} live-only columns sit on tables the repository also defines (${liveOnlyCols.map((d) => d.table + '.' + d.name).slice(0, 24).join(', ')}); ${repoOnlyTables.length} repository tables are absent from the dump (${repoOnlyTables.join(', ')})`,
        cause: 'the live database is the old build plus the repository migrations; the dump is five days old and records no keys', fix: 'none to apply: do not drop the old tables (DATA-SCAN-2026-11-02 section 7); confirm the repository tables exist with the read-only schema diff job' })
    }
  }

  // ---- D. INSERT gaps and literal fits
  for (const g of R.insert_gaps ?? []) add({ severity: 'high', table: g.table, column: g.missing.join(','), kind: 'nullability-default', evidence: `${g.file}:${g.line} (${g.func}) inserts into ${g.table} without ${g.missing.join(', ')}, which are NOT NULL with no default: strict mode answers 1364 and the route fails`, cause: 'the INSERT omits a required column', fix: 'name the column in the INSERT or give it a default' })
  for (const g of R.literal_fits ?? []) add({ severity: 'medium', table: g.table, column: g.column, kind: 'type-or-size-mismatch', evidence: `${g.file}:${g.line} (${g.func}) assigns a ${g.literal_len}-character literal to ${g.table}.${g.column} varchar(${g.column_chars})`, cause: 'a constant longer than its column', fix: 'widen the column or shorten the literal' })

  // ---- E. caps: what the PHP accepts against what the column holds. The measurement through the real route wins over the reading.
  const probe = R.probe && !R.probe.skipped ? R.probe : null
  const seen = new Set()
  const staticBy = new Map()
  for (const it of R.caps ?? []) if (!it.numeric && it.verdict === 'exceeds' && !staticBy.has(`${it.table}.${it.column}`)) staticBy.set(`${it.table}.${it.column}`, it)
  const strictName = SQL_MODES.strict.split(',')[0]
  for (const pc of probe?.cases ?? []) {
    const strict = pc.modes?.strict, lax = pc.modes?.lax
    if (!strict || !lax || strict.setup_failed || lax.setup_failed) continue
    const key = pc.column
    const [table, column] = key.split('.')
    const dbOverflow = strict.outcome_just_above?.cls === 'db_error'   // strict mode cannot truncate: an error there is the column refusing what the PHP let through
    const phpCut = !dbOverflow && lax.accepts_up_to > lax.stored_in_full_up_to && lax.stored_in_full_up_to < (pc.column_chars ?? 0) / 2
    const st = staticBy.get(key)
    if (dbOverflow) {
      seen.add(key)
      add({ severity: 'medium', table, column, kind: 'type-or-size-mismatch', confidence: 'high',
        evidence: `${st ? `${st.file}:${st.line} ${st.expr} - ${st.note}. ` : ''}Measured on the private stack through ${pc.route}: ${table}.${column} holds ${pc.column_chars} characters; the route accepted every length tried, up to ${lax.accepts_up_to}, in the lax run. Under the server default (${strictName}...) a value of ${strict.outcome_just_above?.length ?? (pc.column_chars + 1)} to ${pc.strict_at_php_cap?.length ?? lax.accepts_up_to} characters answers HTTP ${strict.outcome_just_above?.status ?? pc.strict_at_php_cap?.status ?? 500} "${strict.outcome_just_above?.error ?? pc.strict_at_php_cap?.error ?? 'failed'}" and stores nothing; under a lax sql_mode the same request returns 200 and stores ${pc.column_chars} characters (silent truncation).`,
        cause: `the PHP ${st ? `cuts at ${st.bound} characters (${st.caps.map((c) => c.via).join(', ')})` : 'has no cap'} but ${table}.${column} is narrower`,
        fix: 'cap the PHP at the column width so the admin gets a named 400 (admin-input-caps.patch), or widen the column in a new additive migration' })
    } else if (phpCut) {
      seen.add(key)
      add({ severity: 'low', table, column, kind: 'type-or-size-mismatch', confidence: 'medium',
        evidence: `through ${pc.route} a value of ${lax.accepts_up_to} characters is accepted (HTTP 200) and ${lax.stored_in_full_up_to} are stored, in both sql_modes: the PHP cuts the text silently at ${lax.stored_in_full_up_to} while ${table}.${column} holds ${pc.column_chars} characters`,
        cause: 'store_opt() cuts every optional field at 280 characters, the width of the checkout note, whatever the column is', fix: 'owner decision: a longer cap for descriptions, or an error instead of a silent cut' })
    }
  }
  for (const [key, it] of staticBy) {
    if (seen.has(key) || probe?.cases?.some((c) => c.column === key)) continue
    seen.add(key)
    add({ severity: 'medium', table: it.table, column: it.column, kind: 'type-or-size-mismatch', confidence: 'medium',
      evidence: `${it.file}:${it.line} ${it.expr} - ${it.note}`, cause: `the PHP truncates or accepts up to ${it.bound} ${it.bound_unit ?? ''} but ${it.table}.${it.column} is ${it.type}`, fix: 'cap the PHP at the column width (a clean 400 token) or widen the column in a new additive migration' })
  }
  for (const p of probe?.numeric ?? []) {
    const strict = p.modes.strict ?? [], lax = p.modes.lax ?? []
    const over = strict.filter((x) => x.status >= 500)
    if (over.length) add({ severity: 'low', table: p.column.split('.')[0], column: p.column.split('.')[1], kind: 'money-or-numeric', confidence: 'high',
      evidence: `through the admin route a value of ${over.map((x) => x.sent).join(' / ')} answers HTTP ${over[0].status} under the default sql_mode; under a lax mode it returns 200 and stores ${lax.filter((x) => x.stored).map((x) => x.stored).slice(-1)[0]} (clamped)`,
      cause: 'the PHP casts to int / formats the number without a ceiling that matches the column', fix: 'clamp in PHP to the column range, or refuse with a 400 token (admin-input-caps.patch)' })
  }
  const snapProbe = probe?.product_to_order_items
  if (snapProbe) {
    const st = snapProbe.strict, lx = snapProbe.lax
    if (st && st.order >= 500) add({ severity: 'high', table: 'order_items', column: 'name_en,name_ar', kind: 'type-or-size-mismatch', confidence: 'high',
      evidence: `product_save accepts a 160-character name (HTTP ${st.product_save}) and products.name_en/name_ar are varchar(160); the checkout copies the name into order_items.name_en/name_ar varchar(120). Measured through the real routes: under the default sql_mode an order containing that product answers HTTP ${st.order} "${st.order_error}" (no order is created); under a lax mode it answers ${lx?.order} and stores ${lx?.stored_len} characters (silent truncation of the name on the invoice)`,
      cause: 'order_items.name_en/name_ar were created at 120 (itemname.mysql.sql) while the catalogue allows 160', fix: 'new additive migration order-item-name-width.mysql.sql (widen both to 160) - PHP-SCAN-2026-11-03 money-5 reported this from reading; this is the measurement' })
  }
  const uncapped = (R.caps ?? []).filter((it) => it.verdict === 'uncapped' && /\$input\[|\$b\[|\$_(POST|GET)|\$message|\$name\b/.test(it.expr))
  for (const it of uncapped) {
    const key = `${it.table}.${it.column}`
    const pc = probe?.cases?.find((c) => c.column === key)
    if (!pc || seen.has(key)) continue
    seen.add(key)
    const lax = pc.modes?.lax, strict = pc.modes?.strict
    if (lax && !lax.setup_failed && lax.accepts_up_to > (pc.column_chars ?? Infinity)) add({ severity: 'medium', table: it.table, column: it.column, kind: 'type-or-size-mismatch', evidence: `${it.file}:${it.line} binds ${it.expr} with no cap in that function; measured through ${pc.route}: accepts ${lax.accepts_up_to}, column holds ${pc.column_chars}`, cause: 'validation is looser than the column', fix: 'cap the input at the column width' })
  }

  // ---- F. columns by usage
  const cls = (c) => (R.columns ?? []).filter((x) => x.class === c)
  const pii = /(^|_)(ip|email|phone|name|address)(_|$)/
  const wo = cls('write_only')
  if (wo.length) {
    const groups = new Map()
    for (const c of wo) { const k = c.table; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c) }
    for (const [t, list] of groups) add({ severity: 'low', table: t, column: list.map((c) => c.column).join(','), kind: list.some((c) => /ip$/.test(c.column)) ? 'privacy' : 'dead-column', confidence: 'high',
      evidence: `written by ${list.map((c) => c.column + ' ' + c.written_by_code.slice(0, 2).join('/')).join('; ')} and read by no statement in the repository (client mentions: ${list.map((c) => c.column + '=' + c.client_mentions).join(', ')})`,
      cause: 'stored for a future screen or for diagnostics that nothing reads', fix: list.some((c) => /ip$/.test(c.column)) ? 'none required; the request_ip columns hold a keyed hash, so decide how long to keep them' : 'none required; add the screen that reads it, or leave it as a record for the database administrator' })
  }
  const named = cls('named_only').filter((c) => !/_at$/.test(c.column))
  for (const c of named) add({ severity: 'low', table: c.table, column: c.column, kind: 'dead-column', confidence: 'medium', evidence: `no statement names ${c.table}.${c.column}; the name appears ${c.php_literal_mentions} time(s) as a PHP string and ${c.client_mentions ?? '?'} time(s) in client code`, cause: 'column kept for a feature that is not wired', fix: 'wire it or leave it' })
  for (const c of cls('dead')) add({ severity: 'low', table: c.table, column: c.column, kind: 'dead-column', evidence: `no statement, SQL file, PHP string or client file mentions ${c.table}.${c.column}`, cause: 'unused', fix: 'none (never drop a column on a live shop without the owner)' })
  for (const c of cls('read_only_external')) add({ severity: 'low', table: c.table, column: c.column, kind: 'dead-column', confidence: 'medium', evidence: `${c.table}.${c.column} is read (${c.selected_by.concat(c.filtered_by).slice(0, 2).join(', ')}) and no statement in this repository writes it, and it has no default`, cause: 'written by another system (OpenCart import, n8n, admin SQL) or never', fix: 'find the writer on the live side' })

  // ---- G. hygiene
  for (const x of R.charset ?? []) add({ severity: 'medium', table: x.table, column: x.column, kind: 'charset-collation', evidence: x.issue, cause: 'mixed character sets break Arabic text and cross-table comparisons', fix: 'convert to utf8mb4' })
  for (const x of R.numeric?.floats ?? []) add({ severity: 'medium', table: x.table, column: x.column, kind: 'money-or-numeric', evidence: `${x.type} stores binary fractions`, cause: 'floating point where money or counts live', fix: 'decimal(10,3)' })
  for (const x of R.keys ?? []) add({ severity: 'low', table: x.table, column: '-', kind: 'index', evidence: x.issue, cause: 'index hygiene', fix: 'drop the redundant index in a maintenance window', confidence: 'medium' })

  // ---- H. capacity drift
  const drift = (R.drift ?? []).filter((d) => !['name_en', 'name_ar'].includes(d.column))
  if (drift.length) add({ severity: 'low', table: '*', column: drift.map((d) => d.column).join(','), kind: 'naming', confidence: 'medium', evidence: `same column name, different width: ${drift.map((d) => d.column + ' ' + d.tables.map((t) => t.table + '=' + t.chars).join('/')).join('; ')}`, cause: 'columns copied between tables where the narrower one is the destination lose data (name_en/name_ar is reported separately)', fix: 'check each copy flow before widening' })

  F.sort((a, b) => SEV[a.severity] - SEV[b.severity] || String(a.table).localeCompare(String(b.table)) || String(a.column).localeCompare(String(b.column)))
  F.forEach((f, k) => { f.id = `S1-F${String(k + 1).padStart(2, '0')}`; delete f.key })
  return F.map((f) => ({ id: f.id, severity: f.severity, table: f.table, column: f.column, evidence: f.evidence, cause: f.cause, kind: f.kind, fix: f.fix, confidence: f.confidence }))
}

// ---------------------------------------------------------------- output

const tsv = (rows, cols) => [cols.join('\t'), ...rows.map((r) => cols.map((c) => String(Array.isArray(r[c]) ? r[c].join(' ') : (r[c] ?? '')).replace(/[\t\n]/g, ' ')).join('\t'))].join('\n') + '\n'

export function writeOutputs(R, outDir) {
  mkdirSync(outDir, { recursive: true })
  const { _ex, _stmts, _snap, _snapPlus, ...rest } = R
  writeFileSync(join(outDir, 'findings.json'), JSON.stringify(R.findings ?? [], null, 2))
  writeFileSync(join(outDir, 'audit.json'), JSON.stringify(rest, null, 1))
  writeFileSync(join(outDir, 'columns.tsv'), tsv(R.columns, ['table', 'column', 'type', 'nullable', 'default', 'class', 'written_by_code', 'written_by_sql_files', 'selected_by', 'filtered_by', 'starred_by', 'php_literal_mentions', 'client_mentions', 'structural']))
  writeFileSync(join(outDir, 'statements.tsv'), tsv((_stmts ?? []).map((s) => ({ id: s.id, site: `${s.file}:${s.line}`, func: s.func, verb: verbOf(s.variants[0] ?? ''), variants: s.variants.length, dynamic: s.dynamic ? 'yes' : '', unresolved: s.unresolved.join(' | '), sql: (s.variants[0] ?? '').replace(/\s+/g, ' ').slice(0, 300) })), ['id', 'site', 'func', 'verb', 'variants', 'dynamic', 'unresolved', 'sql']))
  writeFileSync(join(outDir, 'caps.json'), JSON.stringify({ static: R.caps, probe: R.probe ?? null }, null, 1))
  if (R.schema_diff) writeFileSync(join(outDir, 'schema-diff.json'), JSON.stringify(R.schema_diff, null, 1))
  if (_snap) writeFileSync(join(outDir, 'schema-snapshot-tooling.json'), JSON.stringify(_snap, null, 1))
  if (_snapPlus) writeFileSync(join(outDir, 'schema-snapshot-with-addons.json'), JSON.stringify(_snapPlus, null, 1))
  const L = []
  L.push('# Lane S1 - every column the code touches versus every column the schema defines', '')
  L.push(`Server ${R.server}; sql_mode of the private server: \`${R.sql_mode}\`.`, '')
  L.push('## Numbers', '')
  L.push(`- schema (tooling order): ${R.schema.tables} tables, ${R.schema.columns} columns; with the sporta-live add-on migrations ${R.schema.columns_with_addons} columns`)
  L.push(`- statements: ${R.statements.total} (${Object.entries(R.statements.by_verb).map(([k, v]) => `${v} ${k}`).join(', ')}); ${R.statements.variants} expansions, ${R.statements.dynamic} dynamic; ${R.statements.unresolved.length} not fully expandable (listed in audit.json)`)
  L.push(`- MariaDB EXPLAIN: ${R.explain.ok} ok, ${R.explain.guarded} guarded by the code, ${R.explain.failed} refused, ${R.explain.unverified ?? 0} unverified (SQL assembled by functions the expander cannot follow; listed in audit.json)`)
  L.push(`- coverage: ${R.statements.call_sites ?? 0} ->prepare/query/exec call sites, ${(R.statements.uncovered ?? []).length} without an extracted statement (${(R.statements.uncovered ?? []).filter((u) => u.session_only).length} name no column: ROLLBACK, SET SESSION, SELECT DATABASE() ...; ${(R.statements.uncovered ?? []).filter((u) => u.passthrough).length} pass a caller's SQL through; ${(R.statements.uncovered ?? []).filter((u) => !u.session_only && !u.passthrough).length} do name columns and are listed in audit.json under statements.uncovered: read them or EXPLAIN them by hand)`)
  L.push(`- INSERTs leaving a NOT NULL column without default: ${R.insert_gaps.length}; literals longer than their column: ${R.literal_fits.length}`)
  const cc = {}; for (const c of R.columns) cc[c.class] = (cc[c.class] ?? 0) + 1
  L.push(`- columns by use: ${Object.entries(cc).map(([k, v]) => `${v} ${k}`).join(', ')}`)
  L.push(`- cap inventory: ${R.caps.length} bound values mapped to a column; ${R.caps.filter((x) => x.verdict === 'fits').length} fit, ${R.caps.filter((x) => x.verdict === 'exceeds').length} exceed, ${R.caps.filter((x) => x.verdict === 'uncapped').length} carry no cap, ${R.caps.filter((x) => x.verdict === 'unclamped').length} unclamped integers`)
  if (R.probe && !R.probe.skipped) L.push(`- real routes probed: ${R.probe.cases.length} text fields, ${R.probe.numeric.length} numeric columns, in two sql_modes`)
  L.push('', '## Findings', '', '| id | sev | table | column | kind | confidence | fix |', '|---|---|---|---|---|---|---|')
  for (const f of R.findings ?? []) L.push(`| ${f.id} | ${f.severity} | ${f.table} | ${String(f.column).slice(0, 60)} | ${f.kind} | ${f.confidence} | ${f.fix.replace(/\|/g, '/').slice(0, 140)} |`)
  L.push('')
  for (const f of R.findings ?? []) L.push(`### ${f.id} (${f.severity}) ${f.table}.${f.column}`, '', `- evidence: ${f.evidence}`, `- cause: ${f.cause}`, `- fix: ${f.fix}`, '')
  writeFileSync(join(outDir, 'README.md'), L.join('\n'))
}

export function summary(R) {
  const f = R.findings ?? []
  const sev = { high: 0, medium: 0, low: 0 }
  for (const x of f) sev[x.severity]++
  return [`${R.statements.total} statements, ${R.statements.variants} expansions: EXPLAIN ${R.explain.ok} ok / ${R.explain.guarded} guarded / ${R.explain.failed} refused`,
    `${R.schema.columns} columns classified; ${R.caps.length} bound values checked against their column`,
    `${R.statements.call_sites ?? 0} query call sites: ${(R.statements.uncovered ?? []).length} not read by the extractor (${(R.statements.uncovered ?? []).filter((u) => !u.session_only && !u.passthrough).length} name columns and need a human look; listed in audit.json)`,
    `${f.length} finding(s): ${sev.high} high, ${sev.medium} medium, ${sev.low} low`].join('\n')
}

/*__CLI__*/
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
  const outDir = arg('--out', null)
  const extra = []
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--client') extra.push(resolve(argv[i + 1]))
  const quick = argv.includes('--quick')
  const reuse = arg('--reuse', null)   // a previous --out directory: reuse its schema-diff.json and probe instead of repeating the slow phases
  const log = (m) => console.error(m)
  const inst = await startPrivateMariadb({ label: 'dc', portFrom: 34100 })
  let R
  try {
    const reused = reuse && existsSync(join(resolve(reuse), 'audit.json')) ? JSON.parse(readFileSync(join(resolve(reuse), 'audit.json'), 'utf8')) : null
    const schemaDiff = reused?.schema_diff ?? await runSchemaDiff({ inst, shuffles: quick ? 0 : Number(arg('--shuffles', 6)), quick, log })
    if (reused?.probe) argv.push('--reuse-probe')
    R = await runAudit({ inst, schemaDiff, clientDirs: [...defaultClientDirs(), ...extra], log })
  } finally { inst.stop() }
  if (reuse && argv.includes('--reuse-probe')) R.probe = JSON.parse(readFileSync(join(resolve(reuse), 'audit.json'), 'utf8')).probe
  else if (!quick && !argv.includes('--no-routes')) {
    try { R.probe = await probeRoutes({ snap: R._snap, log }) } catch (e) { R.probe = { skipped: `the route probe failed: ${String(e.message).slice(0, 200)}` } }
  }
  const { snapshots, ...sdRest } = R.schema_diff ?? {}
  R.schema_diff = sdRest
  R.findings = buildFindings(R)
  if (outDir) writeOutputs(R, resolve(outDir))
  console.log(summary(R))
  for (const f of R.findings) console.log(`${f.id} ${f.severity.padEnd(6)} ${String(f.table).padEnd(22)} ${String(f.column).slice(0, 40).padEnd(40)} ${f.kind}`)
  process.exit(0)
}

/*__PHP_EXTRACTOR__
<?php
// Statement extractor (dev copy; the shipped copy is embedded in scripts/db-columns-audit.mjs).
//
//   php extract.php <repo web root> [more files...]   > statements.json
//
// token_get_all based. For every PHP file under dropin/php-store, php-knet, php-cbk it records
//   * every string expression that STARTS like SQL, as a list of pieces: literal text, a variable,
//     a call, a ternary with its alternatives (so an expansion can be enumerated, not guessed),
//   * per function, every assignment to a variable whose right-hand side holds a string literal
//     (= and .= and []= and ['k']= and array literals), which is how `$sets[] = 'a = ?'` and
//     `$sql .= ' where x = ?'` are followed,
//   * per function, the literal strings it returns (a helper that returns a column expression),
//   * schema guards (store_column_exists(), SHOW COLUMNS ... LIKE),
//   * every identifier-like string literal in the file (weak evidence that a column name is
//     mentioned by the code even when no statement names it),
//   * integer constants (const X = 5; define('X', 5)).
declare(strict_types=1);

$root = $argv[1] ?? '';
if ($root === '' || !is_dir($root)) { fwrite(STDERR, "usage: php extract.php <sporta-web dir>\n"); exit(2); }
$files = [];
foreach (['dropin/php-store', 'dropin/php-knet', 'dropin/php-cbk'] as $d) {
    foreach (glob("$root/$d/*.php") ?: [] as $f) {
        $b = basename($f);
        if ($b === 'config.php' || $b === 'config.example.php') continue;
        $files[] = $f;
    }
}
foreach (array_slice($argv, 2) as $extra) $files[] = $extra;

const VERB = '/^\s*(select|insert|replace|update|delete|with|alter\s+table|create\s+(?:unique\s+)?(?:table|index)|drop\s+(?:table|index)|truncate|show\s+(?:columns|tables|index|create)|explain)\b/i';

function tid($t) { return is_array($t) ? $t[0] : null; }
function ttext($t) { return is_array($t) ? $t[1] : $t; }
function is_ws($t) { $i = tid($t); return $i === T_WHITESPACE || $i === T_COMMENT || $i === T_DOC_COMMENT; }

$out = ['assigns' => [], 'executes' => [], 'funcspans' => [], 'files' => [], 'statements' => [], 'funcvars' => [], 'fnreturns' => [], 'guards' => [], 'literals' => [], 'consts' => [], 'calls' => [], 'callsites' => []];
$sid = 0;

foreach ($files as $path) {
    $src = file_get_contents($path);
    $rel = basename(dirname($path)) . '/' . basename($path);
    $T = token_get_all($src);
    $n = count($T);
    $out['files'][] = $rel;

    // ---- function spans
    $funcs = [];
    $stack = []; $depth = 0; $pending = null; $line = 1;
    for ($i = 0; $i < $n; $i++) {
        $t = $T[$i];
        if (is_array($t)) $line = $t[2];
        if (tid($t) === T_FUNCTION) {
            $j = $i + 1;
            while ($j < $n && (is_ws($T[$j]) || ttext($T[$j]) === '&')) $j++;
            $name = (tid($T[$j]) === T_STRING) ? $T[$j][1] : '{closure}';
            $pending = [$name, $line, $i];
        }
        if ($t === '{' || tid($t) === T_CURLY_OPEN || tid($t) === T_DOLLAR_OPEN_CURLY_BRACES) {
            $depth++;
            if ($pending !== null && $t === '{') { $stack[] = [$pending, $depth]; $pending = null; }
        } elseif ($t === '}') {
            if ($stack && end($stack)[1] === $depth) { [$pf] = array_pop($stack); $funcs[] = [$pf[0], $pf[1], $line, $pf[2], $i]; }
            $depth--;
        } elseif ($t === ';' && $pending !== null) { $pending = null; }
    }
    foreach ($funcs as $f) if ($f[0] !== '{closure}') $out['funcspans'][$rel . '::' . $f[0]] = [$f[1], $f[2]];
    $named = function (int $idx) use ($funcs): string {
        $best = null;
        foreach ($funcs as $f) {
            if ($f[0] === '{closure}') continue;
            if ($f[3] <= $idx && $idx <= $f[4] && ($best === null || ($f[4] - $f[3]) < ($best[4] - $best[3]))) $best = $f;
        }
        return $best ? $best[0] : '(file)';
    };

    $skip = function (int $i) use ($T, $n): int { while ($i < $n && is_ws($T[$i])) $i++; return $i; };
    $src_of = function (int $a, int $b) use ($T): string {   // compact source text of tokens [a, b)
        $s = '';
        for ($k = $a; $k < $b; $k++) { if (is_ws($T[$k])) { $s .= ' '; continue; } $s .= ttext($T[$k]); }
        return trim(preg_replace('/\s+/', ' ', $s));
    };
    $match_close = function (int $i) use ($T, $n): int {      // $i at an opening ( [ {; returns the index of its closer
        $open = ttext($T[$i]); $close = ['(' => ')', '[' => ']', '{' => '}'][$open] ?? ')';
        $d = 0;
        for ($k = $i; $k < $n; $k++) {
            $x = $T[$k];
            if ($x === $open || (tid($x) === T_CURLY_OPEN && $open === '{')) $d++;
            elseif ($x === $close) { $d--; if ($d === 0) return $k; }
        }
        return $n - 1;
    };

    $parse_chain = null;
    // ---- interpolated string pieces from tokens in (a, b)
    $interp = function (int $a, int $b) use ($T, $src_of): array {
        $pieces = [];
        for ($k = $a; $k < $b; $k++) {
            $x = $T[$k]; $id = tid($x);
            if ($id === T_ENCAPSED_AND_WHITESPACE) { $pieces[] = ['lit', stripcslashes($x[1])]; }
            elseif ($id === T_VARIABLE) {
                // "$a[0]" / "$a->b" simple syntax: keep the variable, the tail is rare in SQL
                $pieces[] = ['var', $x[1]];
            }
            elseif ($id === T_CURLY_OPEN || $id === T_DOLLAR_OPEN_CURLY_BRACES) {
                $d = 1; $s = $k + 1;
                for ($m = $s; $m < count($T) && $d > 0; $m++) { if ($T[$m] === '{' || tid($T[$m]) === T_CURLY_OPEN) $d++; elseif ($T[$m] === '}') $d--; }
                $inner = $src_of($s, $m - 1);
                $pieces[] = preg_match('/^\$\w+$/', $inner) ? ['var', $inner] : ['expr', $inner];
                $k = $m - 1;
            }
            elseif ($id === T_STRING_VARNAME) { $pieces[] = ['var', '$' . $x[1]]; }
        }
        return $pieces;
    };

    // returns [pieces, nextIndex]; pieces may be empty when the operand is not understood
    $parse_operand = function (int $i) use (&$parse_operand, &$parse_chain, $T, $n, $skip, $src_of, $match_close, $interp): array {
        $i = $skip($i);
        if ($i >= $n) return [[['expr', '']], $i];
        $t = $T[$i]; $id = tid($t);
        if ($id === T_CONSTANT_ENCAPSED_STRING) {
            $s = $t[1];
            $v = $s[0] === "'" ? str_replace(["\\'", '\\\\'], ["'", '\\'], substr($s, 1, -1)) : stripcslashes(substr($s, 1, -1));
            return [[['lit', $v]], $i + 1];
        }
        if ($t === '"') {
            $j = $i + 1; while ($j < $n && $T[$j] !== '"') $j++;
            return [$interp($i + 1, $j), $j + 1];
        }
        if ($id === T_START_HEREDOC) {
            $j = $i + 1; while ($j < $n && tid($T[$j]) !== T_END_HEREDOC) $j++;
            $nowdoc = strpos($t[1], "'") !== false;
            $p = $nowdoc ? [['lit', implode('', array_map(fn ($k) => ttext($T[$k]), range($i + 1, $j - 1)))]] : $interp($i + 1, $j);
            // the closing label's indentation is stripped by PHP; the SQL does not care
            return [$p, $j + 1];
        }
        if ($t === '(') {
            $c = $match_close($i);
            // a ternary inside the parentheses?  (cond ? A : B)
            $d = 0; $q = -1; $col = -1;
            for ($k = $i + 1; $k < $c; $k++) {
                $x = $T[$k];
                if ($x === '(' || $x === '[' || $x === '{') { $k = $match_close($k); continue; }
                if ($x === '?' && $d === 0 && $q < 0) $q = $k;
                elseif ($x === ':' && $q >= 0 && $col < 0) $col = $k;
            }
            if ($q >= 0 && $col >= 0) {
                [$a] = $parse_chain($q + 1, $col);
                [$b] = $parse_chain($col + 1, $c);
                return [[['alt', $a, $b, $src_of($i, $c + 1)]], $c + 1];
            }
            [$inner] = $parse_chain($i + 1, $c);
            return [$inner, $c + 1];
        }
        // variable / constant / call / property chain: take tokens until a top-level `.` or terminator
        $k = $i;
        while ($k < $n) {
            $x = $T[$k];
            if (is_ws($x)) { $k++; continue; }
            if ($x === '(' || $x === '[') { $k = $match_close($k) + 1; continue; }
            if ($x === '.' || $x === ',' || $x === ';' || $x === ')' || $x === ']' || $x === '?' || $x === ':' || $x === '=' || $x === '}') break;
            if (in_array(tid($x), [T_VARIABLE, T_STRING, T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR, T_DOUBLE_COLON, T_NS_SEPARATOR, T_LNUMBER, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED, T_STATIC, T_NEW], true)) { $k++; continue; }
            if ($x === '-' || tid($x) === T_ARRAY || tid($x) === T_FN || tid($x) === T_FUNCTION || tid($x) === T_ARRAY_CAST || tid($x) === T_INT_CAST || tid($x) === T_STRING_CAST || tid($x) === T_DOUBLE_CAST) { $k++; continue; }
            break;
        }
        if ($k === $i) return [[['expr', ttext($T[$i])]], $i + 1];
        $text = $src_of($i, $k);
        if (preg_match('/^\$\w+$/', $text)) return [[['var', $text]], $k];
        if (preg_match('/^(?:\\\\?[A-Za-z_]\w*)\s*\(/', $text, $m) && strtolower(substr($text, 0, 7)) === 'sprintf') {
            // sprintf('fmt %s', a, b): the format literal with its arguments in place
            $o = $i; while ($T[$o] !== '(') $o++;
            $c = $match_close($o);
            [$fmt, $after] = $parse_operand($o + 1);
            if (count($fmt) === 1 && $fmt[0][0] === 'lit') {
                $args = []; $s = $skip($after);
                if ($T[$s] === ',') {
                    $a0 = $s + 1; $d0 = 0;
                    for ($q = $a0; $q <= $c; $q++) {
                        $x = $T[$q];
                        if ($x === '(' || $x === '[') { $q = $match_close($q); continue; }
                        if ($x === ',' || $q === $c) { $args[] = $src_of($a0, $q); $a0 = $q + 1; }
                    }
                }
                $parts = preg_split('/(%(?:\d+\$)?[sdfuxXeEgGbcoi])/', $fmt[0][1], -1, PREG_SPLIT_DELIM_CAPTURE);
                $res = []; $ai = 0;
                foreach ($parts as $part) {
                    if ($part === '') continue;
                    if (preg_match('/^%(?:(\d+)\$)?[sdfuxXeEgGbcoi]$/', $part, $mm)) {
                        $idx = isset($mm[1]) && $mm[1] !== '' ? (int)$mm[1] - 1 : $ai++;
                        $res[] = ['expr', $args[$idx] ?? ''];
                    } else $res[] = ['lit', str_replace('%%', '%', $part)];
                }
                return [$res, $c + 1];
            }
        }
        return [[['expr', $text]], $k];
    };

    // a concatenation chain between token indices [a, b); stops early at a non-`.` token
    $parse_chain = function (int $a, int $b) use (&$parse_operand, $T, $skip): array {
        $pieces = []; $i = $a;
        while (true) {
            [$p, $i] = $parse_operand($i);
            foreach ($p as $x) $pieces[] = $x;
            $i = $skip($i);
            if ($i < $b && $T[$i] === '.') { $i++; continue; }
            break;
        }
        return [$pieces, $i];
    };

    // an expression from $a up to $b (exclusive): a concatenation chain, or `cond ? A : B` with both arms parsed
    $parse_expr = function (int $a, int $b) use (&$parse_chain, $T, $skip, $match_close, $src_of): array {
        $q = -1; $col = -1;
        for ($k = $a; $k < $b; $k++) {
            $x = $T[$k];
            if ($x === '(' || $x === '[' || $x === '{') { $k = $match_close($k); continue; }
            if ($x === '?' && $q < 0) $q = $k;
            elseif ($x === ':' && $q >= 0 && $col < 0) { $col = $k; break; }
        }
        if ($q >= 0 && $col >= 0) {
            [$pa] = $parse_chain($q + 1, $col);
            [$pb] = $parse_chain($col + 1, $b);
            return [[['alt', $pa, $pb, $src_of($a, $b)]], $b];
        }
        return $parse_chain($a, $b);
    };
    // index of the `;` ending the statement that starts at $a (brackets respected)
    $stmt_end = function (int $a) use ($T, $n, $match_close): int {
        for ($k = $a; $k < $n; $k++) {
            $x = $T[$k];
            if ($x === '(' || $x === '[' || $x === '{') { $k = $match_close($k); continue; }
            if ($x === ';') return $k;
        }
        return $n;
    };

    $prev_sig = function (int $i, int $count = 3) use ($T, $src_of): string {
        $out2 = []; $k = $i - 1;
        while ($k >= 0 && count($out2) < $count) { if (!is_ws($T[$k])) array_unshift($out2, ttext($T[$k])); $k--; }
        return implode(' ', $out2);
    };

    $flat_first = function (array $pieces): string { return ($pieces && $pieces[0][0] === 'lit') ? $pieces[0][1] : ''; };

    $last_stmt_end = -1; $curLine = 1;
    for ($i = 0; $i < $n; $i++) {
        $t = $T[$i]; $id = tid($t);
        if (is_array($t)) $curLine = $t[2];
        $ln = $curLine;

        // ---- constants
        if ($id === T_CONST) {
            $j = $skip($i + 1);
            if (tid($T[$j]) === T_STRING) { $nm = $T[$j][1]; $j = $skip($j + 1); if ($T[$j] === '=') { $v = $skip($j + 1); if (tid($T[$v]) === T_LNUMBER) $out['consts'][$nm] = (int)$T[$v][1]; } }
        }
        if ($id === T_STRING && $t[1] === 'define') {
            $j = $skip($i + 1);
            if ($T[$j] === '(') { $k = $skip($j + 1); if (tid($T[$k]) === T_CONSTANT_ENCAPSED_STRING) { $nm = trim($T[$k][1], "'\""); $k = $skip($k + 1); if ($T[$k] === ',') { $v = $skip($k + 1); if (tid($T[$v]) === T_LNUMBER) $out['consts'][$nm] = (int)$T[$v][1]; } } }
        }

        // ---- schema guards
        if ($id === T_STRING && $t[1] === 'store_column_exists') {
            $j = $skip($i + 1);
            if ($T[$j] === '(') {
                $c = $match_close($j); $lits = [];
                for ($k = $j + 1; $k < $c; $k++) if (tid($T[$k]) === T_CONSTANT_ENCAPSED_STRING) $lits[] = trim($T[$k][1], "'\"");
                if (count($lits) >= 2) $out['guards'][] = ['file' => $rel, 'line' => $ln, 'func' => $named($i), 'kind' => 'store_column_exists', 'table' => $lits[0], 'column' => $lits[1]];
            }
        }

        // ---- function returns of string literals
        if ($id === T_RETURN) {
            $j = $skip($i + 1);
            if (in_array(tid($T[$j]), [T_CONSTANT_ENCAPSED_STRING], true) || $T[$j] === '"' || $T[$j] === '(' || tid($T[$j]) === T_VARIABLE) {
                [$p] = $parse_expr($j, $stmt_end($j));
                if ($p) $out['fnreturns'][$rel . '::' . $named($i)][] = $p;
            }
        }

        // ---- call names (for `which function calls which`)
        if ($id === T_STRING) {
            $j = $skip($i + 1);
            if ($j < $n && $T[$j] === '(' && $i > 0 && tid($T[$i - 1]) !== T_FUNCTION && tid($T[$i - 1]) !== T_OBJECT_OPERATOR) $out['calls'][$rel . '::' . $named($i)][$t[1]] = true;
        }

        // ---- ->execute([ a, b, c ])
        if ($id === T_OBJECT_OPERATOR) {
            $j = $skip($i + 1);
            if (tid($T[$j]) === T_STRING && $T[$j][1] === 'execute') {
                $k = $skip($j + 1);
                if ($T[$k] === '(') {
                    $c = $match_close($k);
                    $a = $skip($k + 1);
                    if ($T[$a] === '[') {
                        $ac = $match_close($a);
                        $args = []; $a0 = $a + 1;
                        for ($q = $a + 1; $q <= $ac; $q++) {
                            $x = $T[$q];
                            if ($x === '(' || $x === '[' || $x === '{') { $q = $match_close($q); continue; }
                            if ($x === ',' || $q === $ac) { $txt = $src_of($a0, $q); if ($txt !== '') $args[] = $txt; $a0 = $q + 1; }
                        }
                        $pp = $i - 1; while ($pp >= 0 && is_ws($T[$pp])) $pp--;
                        $recv = (tid($T[$pp]) === T_VARIABLE) ? $T[$pp][1] : 'chain';
                        $out['executes'][] = ['file' => $rel, 'func' => $named($i), 'line' => $ln, 'recv' => $recv, 'args' => $args];
                    }
                }
            }
        }

        // ---- identifier-like string literals (weak mention evidence)
        if ($id === T_CONSTANT_ENCAPSED_STRING) {
            $v = substr($t[1], 1, -1);
            if (strlen($v) <= 64 && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $v)) $out['literals'][$rel][$v] = ($out['literals'][$rel][$v] ?? 0) + 1;
        }

        // ---- assignments:  $v = chain | $v .= chain | $v[] = chain | $v['k'] = chain | $v = [ ... ]
        if ($id === T_VARIABLE) {
            $j = $skip($i + 1); $key = null; $op = null;
            if ($T[$j] === '[') {
                $c = $match_close($j);
                $inner = $src_of($j + 1, $c);
                $key = $inner === '' ? '[]' : trim($inner, "'\"");
                $j = $skip($c + 1);
            }
            $nt = $T[$j];
            if ($nt === '=' || tid($nt) === T_CONCAT_EQUAL) {
                $op = tid($nt) === T_CONCAT_EQUAL ? '.=' : '=';
                $rhs = $skip($j + 1);
                $fn = $rel . '::' . $named($i);
                if ($op === '=' && $key === null) {
                    $rsrc = $src_of($rhs, $stmt_end($rhs));
                    if (strlen($rsrc) < 600) $out['assigns'][$fn][$t[1]][] = ['line' => $ln, 'src' => $rsrc];
                }
                if (($T[$rhs] === '[' || tid($T[$rhs]) === T_ARRAY) && $key === null && $op === '=') {
                    $o = $T[$rhs] === '[' ? $rhs : $skip($rhs + 1);
                    $c = $match_close($o);
                    // array literal items
                    $items = []; $keys = []; $a0 = $o + 1;
                    for ($q = $o + 1; $q <= $c; $q++) {
                        $x = $T[$q];
                        if ($x === '(' || $x === '[' || $x === '{') { $q = $match_close($q); continue; }
                        if ($x === ',' || $q === $c) {
                            if ($q > $a0 && $skip($a0) < $q) {
                                // key => value ?
                                $arrow = -1;
                                for ($z = $a0; $z < $q; $z++) { if (tid($T[$z]) === T_DOUBLE_ARROW) { $arrow = $z; break; } if ($T[$z] === '(' || $T[$z] === '[') $z = $match_close($z); }
                                if ($arrow >= 0) { $kk = $skip($a0); if (tid($T[$kk]) === T_CONSTANT_ENCAPSED_STRING) $keys[] = trim($T[$kk][1], "'\""); [$p] = $parse_chain($arrow + 1, $q); $items[] = $p; }
                                else { [$p] = $parse_chain($a0, $q); $items[] = $p; }
                            }
                            $a0 = $q + 1;
                        }
                    }
                    $out['funcvars'][$fn][$t[1]][] = ['op' => 'array', 'keys' => $keys, 'items' => $items, 'line' => $ln];
                } elseif ($op !== null) {
                    [$p, $e] = $parse_expr($rhs, $stmt_end($rhs));
                    $hasLit = false; foreach ($p as $x) if ($x[0] === 'lit' && trim($x[1]) !== '') $hasLit = true;
                    if ($hasLit || ($key !== null && $key !== '[]') || ($p && $p[0][0] === 'alt') || ($p && $p[0][0] === 'expr' && preg_match('/^[A-Za-z_]\w*\s*\(/', $p[0][1]))) {
                        $out['funcvars'][$fn][$t[1]][] = ['op' => $key === null ? $op : ($key === '[]' ? '[]=' : "['k']=$key"), 'pieces' => $p, 'line' => $ln];
                    }
                }
            }
        }

        // ---- a statement chain starts at a string-ish token that is not the right operand of `.`
        $startsString = $id === T_CONSTANT_ENCAPSED_STRING || $t === '"' || $id === T_START_HEREDOC;
        if (!$startsString) continue;
        $pp = $i - 1; while ($pp >= 0 && is_ws($T[$pp])) $pp--;
        if ($pp >= 0 && $T[$pp] === '.') continue;
        [$p, $e] = $parse_chain($i, $n);
        $first = $flat_first($p);
        if (!preg_match(VERB, $first) || strlen(trim($first)) < 6) { $i = max($i, $e - 1) === $i ? $i : $i; continue; }
        // not a UI sentence: a SQL verb must be followed by more than prose ("Update your ..." is not SQL)
        $w = strtolower(strtok(trim($first), " \t\n"));
        $okish = match ($w) {
            'select' => (bool)preg_match('/^\s*select\s+(?:distinct\s+|sql_calc_found_rows\s+)?[\w`\*\(\{]/i', $first) && (stripos($first, ' from ') !== false || count($p) > 1 || preg_match('/^select\s+(?:count|max|min|sum|coalesce|get_lock|release_lock|1|now|@|last_insert_id)/i', trim($first))),
            'insert', 'replace' => (bool)preg_match('/^\s*(insert|replace)\s+(?:ignore\s+)?into\s+`?\w+/i', $first),
            'update' => (bool)preg_match('/^\s*update\s+(?:ignore\s+)?`?\w+`?(?:\s+\w+)?\s+(?:set|left|inner|join)\b/i', $first),
            'delete' => (bool)preg_match('/^\s*delete\s+(?:\w+\s+)?from\s+`?\w+/i', $first),
            'with' => (bool)preg_match('/^\s*with\s+(?:recursive\s+)?\w+\s+as\s*\(/i', $first),
            'alter', 'create', 'drop', 'truncate', 'show', 'explain' => true,
            default => false,
        };
        if (!$okish) continue;
        // context: what precedes the chain
        $ctx = $prev_sig($i, 8);
        $assigned = null;
        if (preg_match('/(\$\w+)\s*(?:\.?=)$/', $ctx, $m)) $assigned = $m[1];
        $call = null;
        if (preg_match('/->\s*(prepare|query|exec|execute)\s*\($/', $ctx, $m)) $call = $m[1];
        elseif (preg_match('/(\w+)\s*\($/', $ctx, $m)) $call = $m[1];
        $out['statements'][] = ['id' => ++$sid, 'file' => $rel, 'line' => $ln, 'end_line' => (function () use ($T, $e, $ln) { for ($z = min($e, count($T)) - 1; $z >= 0; $z--) { if (is_array($T[$z])) { $nl = substr_count($T[$z][1], "\n"); return max($ln, $T[$z][2] + $nl); } } return $ln; })(),
            'func' => $named($i), 'ctx' => $ctx, 'assigned' => $assigned, 'call' => $call, 'pieces' => $p];
        $i = max($i, $e - 1);
    }

    // ---- COVERAGE. Every ->prepare( / ->query( / ->exec( call in this file, and whether a statement was extracted for it:
    // one whose text starts inside the first argument, or, for a bare variable argument, one assigned to that variable in
    // the same function. A call that is NOT covered is SQL this extractor did not read (the string ends right after the
    // verb: "select {$cols} from ...", sprintf() / heredoc / match / loop assembled SQL, SQL returned by a function or read
    // from a file). The audit lists those as unverified: nothing may be dropped without a trace.
    $fileStatements = array_values(array_filter($out['statements'], fn ($s) => $s['file'] === $rel));
    // the variables a function receives as parameters: a call whose argument IS one of them passes the caller's SQL through
    // (a PDO wrapper); the SQL itself is read where the caller writes it
    $paramsOf = function (int $idx) use ($funcs, $T): array {
        $best = null;
        foreach ($funcs as $f) {
            if ($f[0] === '{closure}') continue;
            if ($f[3] <= $idx && $idx <= $f[4] && ($best === null || ($f[4] - $f[3]) < ($best[4] - $best[3]))) $best = $f;
        }
        if (!$best) return [];
        $vars = []; $depth = 0;
        for ($k = $best[3]; $k < $best[4]; $k++) {
            $x = $T[$k];
            if ($x === '(') $depth++;
            elseif ($x === ')') { $depth--; if ($depth === 0) break; }
            elseif ($depth === 1 && tid($x) === T_VARIABLE) $vars[] = $x[1];
        }
        return $vars;
    };
    for ($i = 0; $i < $n; $i++) {
        if (!is_array($T[$i]) || $T[$i][0] !== T_STRING || !in_array($T[$i][1], ['prepare', 'query', 'exec'], true)) continue;
        $j = $i - 1; while ($j >= 0 && is_ws($T[$j])) $j--;
        if (!in_array(ttext($T[$j]), ['->', '::', '?->'], true)) continue;
        $k = $skip($i + 1);
        if (($T[$k] ?? null) !== '(') continue;
        $d = 0; $argTokens = []; $lineA = null; $lineE = null;
        for ($m = $k + 1; $m < $n; $m++) {
            $x = $T[$m];
            if ($x === '(' || $x === '[' || $x === '{' || tid($x) === T_CURLY_OPEN || tid($x) === T_DOLLAR_OPEN_CURLY_BRACES) $d++;
            elseif ($x === ')' || $x === ']' || $x === '}') { if ($d === 0) break; $d--; }
            elseif ($x === ',' && $d === 0) break;
            if (!is_ws($x)) { $argTokens[] = $m; if (is_array($x)) { $lineA ??= $x[2]; $lineE = $x[2] + substr_count($x[1], "\n"); } }
        }
        $bare = (count($argTokens) === 1 && tid($T[$argTokens[0]]) === T_VARIABLE) ? $T[$argTokens[0]][1] : null;
        $func = $named($i);
        $covered = false;
        foreach ($fileStatements as $st) {
            if ($lineA !== null && $st['line'] >= $lineA && $st['line'] <= $lineE) { $covered = true; break; }
            if ($bare !== null && $st['func'] === $func && $st['assigned'] === $bare) { $covered = true; break; }
        }
        $passthrough = !$covered && $bare !== null && in_array($bare, $paramsOf($i), true);
        $out['callsites'][] = ['file' => $rel, 'line' => $T[$i][2], 'call' => $T[$i][1], 'func' => $func, 'covered' => $covered, 'passthrough' => $passthrough,
            'arg' => $bare ?? mb_substr($argTokens ? $src_of($argTokens[0], end($argTokens) + 1) : '', 0, 160)];
    }
}

echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR), "\n";
__PHP_EXTRACTOR_END__*/
