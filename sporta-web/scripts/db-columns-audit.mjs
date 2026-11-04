#!/usr/bin/env node
// DB COLUMNS AUDIT — every column the code touches versus every column the schema defines.
//
//   node scripts/db-columns-audit.mjs                       run everything on a private MariaDB, print the findings
//   node scripts/db-columns-audit.mjs --out DIR             also write the JSON + markdown tables into DIR
//   node scripts/db-columns-audit.mjs --quick               skip the migration-order shuffles and the real-route length probe
//   node scripts/db-columns-audit.mjs --no-routes           skip only the real-route length probe
//   node scripts/db-columns-audit.mjs --client DIR ...      extra directories of client JavaScript (compiled bundles) to read field names from
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
export function runExplains(inst, db, variants /* [{key, sql}] */) {
  const lines = []
  const rows = []
  for (const v of variants) {
    const bound = bindPlaceholders(v.sql)
    const verb = verbOf(bound)
    const text = ['select', 'insert', 'replace', 'update', 'delete', 'with'].includes(verb) ? `explain ${bound}` : bound
    lines.push(text.replace(/[\r\n]+/g, ' '))
    rows.push(v)
  }
  const input = lines.map((l) => `${l};`).join('\n') + '\n'
  const r = spawnSync('mariadb', ['--no-defaults', '-S', inst.sock, '-uroot', '--default-character-set=utf8mb4', '--force', '--batch', '--silent', db],
    { input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const errs = new Map()
  for (const m of (r.stderr || '').matchAll(/ERROR (\d+) \((\w+)\) at line (\d+): (.*)/g)) errs.set(Number(m[3]), { code: Number(m[1]), state: m[2], message: m[4] })
  return rows.map((v, k) => ({ ...v, bound: lines[k], error: errs.get(k + 1) ?? null }))
}

export function classifyError(e) {
  if (!e) return null
  const col = /Unknown column '([^']+)'/.exec(e.message)?.[1] ?? null
  const tbl = /Table '[^.']*\.?([^']+)' doesn't exist/.exec(e.message)?.[1] ?? null
  const kind = { 1054: 'unknown_column', 1146: 'unknown_table', 1064: 'syntax', 1052: 'ambiguous_column', 1136: 'column_count', 1222: 'union_columns', 1060: 'duplicate_column', 1110: 'duplicate_column' }[e.code] ?? 'other'
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
export function validateStatements(inst, db, stmts) {
  const flat = []
  for (const s of stmts) s.variants.forEach((sql, k) => {
    if (verbOf(sql) === 'explain') return
    flat.push({ id: s.id, k, sql })
  })
  const rows = runExplains(inst, db, flat)
  const by = new Map()
  for (const r of rows) { if (!by.has(r.id)) by.set(r.id, []); by.get(r.id).push(r) }
  return by
}

// Per statement: ok | guarded | failed. A statement is fine when at least one variant parses and every other
// variant fails only because of a syntax artefact of the combination or a column its own code guards.
export function judge(stmt, runs, ex) {
  const errs = runs.filter((r) => r.error).map((r) => ({ ...classifyError(r.error), sql: r.bound }))
  if (!errs.length) return { verdict: 'ok', errors: [] }
  const guards = (ex.guards ?? []).filter((g) => g.file === stmt.file)
  const showGuards = (ex.statements ?? []).filter((x) => x.file === stmt.file && verbOf(x.pieces[0]?.[1] ?? '') === 'show')
    .map((x) => /like\s+'(\w+)'/i.exec(x.pieces.map((p) => p[1]).join(''))?.[1]).filter(Boolean)
  const guardedCols = new Set([...guards.map((g) => g.column.toLowerCase()), ...showGuards.map((c) => c.toLowerCase())])
  const okVariants = runs.length - errs.length
  const real = []
  const guarded = []
  for (const e of errs) {
    if (e.kind === 'unknown_column') {
      const col = (e.column ?? '').split('.').pop().toLowerCase()
      if (guardedCols.has(col)) { guarded.push({ ...e, guard: col }); continue }
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

export async function runAudit({ inst: given, web = WEB, clientDirs = defaultClientDirs(), schemaDiff = null, log = () => {}, extraWriters = [] } = {}) {
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
    const addons = LIVE_ADDON_SQL()
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
      unresolved: stmts.filter((s) => s.unresolved.length).map((s) => ({ file: s.file, line: s.line, func: s.func, parts: s.unresolved })) }
    const runs = validateStatements(inst, 'canon', stmts)
    const runsPlus = validateStatements(inst, 'canon_plus', stmts)
    R.explain = { ok: 0, guarded: 0, failed: 0, failed_list: [], guarded_list: [], addon_fixes: [] }
    for (const s of stmts) {
      const rs = runs.get(s.id) ?? []
      if (!rs.length) continue
      const j = judge(s, rs, ex)
      const jPlus = judge(s, runsPlus.get(s.id) ?? [], ex)
      const rec = { file: s.file, line: s.line, func: s.func, verdict: j.verdict, verdict_with_addons: jPlus.verdict, errors: j.errors.map(({ sql, ...e }) => ({ ...e, sql: sql?.slice(0, 260) })), guarded: (j.guarded ?? []).map(({ sql, ...e }) => e) }
      R.explain[j.verdict === 'ok' ? 'ok' : j.verdict]++
      if (j.verdict === 'failed') { R.explain.failed_list.push(rec); if (jPlus.verdict !== 'failed') R.explain.addon_fixes.push(rec) }
      if (j.verdict === 'guarded') R.explain.guarded_list.push(rec)
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

$out = ['files' => [], 'statements' => [], 'funcvars' => [], 'fnreturns' => [], 'guards' => [], 'literals' => [], 'consts' => [], 'calls' => []];
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
        $ctx = $prev_sig($i, 3);
        $assigned = null;
        if (preg_match('/(\$\w+)\s*(?:\.?=)$/', $ctx, $m)) $assigned = $m[1];
        $call = null;
        if (preg_match('/->\s*(prepare|query|exec|execute)\s*\($/', $ctx, $m)) $call = $m[1];
        elseif (preg_match('/(\w+)\s*\($/', $ctx, $m)) $call = $m[1];
        $out['statements'][] = ['id' => ++$sid, 'file' => $rel, 'line' => $ln, 'end_line' => $T[$e - 1] && is_array($T[min($e, $n - 1)]) ? $T[min($e, $n - 1)][2] : $ln,
            'func' => $named($i), 'ctx' => $ctx, 'assigned' => $assigned, 'call' => $call, 'pieces' => $p];
        $i = max($i, $e - 1);
    }
}

echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR), "\n";
__PHP_EXTRACTOR_END__*/
