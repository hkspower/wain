// The add-on scripts are classic scripts made of top-level blocks, each one an immediately-invoked function: `;(function () { ... })()`.
// In a classic script an UNCAUGHT throw in one top-level statement stops the rest of that FILE, so a block that throws (a node the
// compiled build renamed, a storage call that a private window refuses) would silently switch off every block after it.
//
// The rule (JS-01, JS-SCAN-2026-11-19.md): every block's body, after its directive prologue ('use strict'), is ONE try statement with a catch.
// One failing block then costs that block and nothing else. This module reads the files with a real parser (rolldown's, already a
// dependency of the build) so the rule is checked on the syntax tree, not on text:
//   blocksOf(src)    the blocks, each with where its body starts and ends and whether it follows the rule
//   guardSource(src) the same source with the missing try { ... } catch (e) {} inserted, nothing else changed (idempotent)
import { parseAst } from 'rolldown/parseAst'

export const ADDON_FILES = ['boot.js', 'config.js', 'birthday.js', 'sporta-features.js', 'sporta-admin-brands.js', 'sporta-footer-call.js',
  'sporta-gov-autopick.js', 'sporta-clock.js', 'sporta-checkout-a11y.js', 'sporta-catalogue.js']

const isDirective = (s) => s.type === 'ExpressionStatement' && typeof s.directive === 'string'

export function blocksOf(src) {
  const ast = parseAst(src, { lang: 'js', sourceType: 'script' })
  const lineAt = (i) => src.slice(0, i).split('\n').length
  const blocks = []
  for (const st of ast.body) {
    if (st.type === 'EmptyStatement') continue
    const call = st.type === 'ExpressionStatement' ? st.expression : null
    // `window.SPORTA_CONFIG = { ... }` (config.js): an assignment of a literal cannot throw, so it needs no guard
    if (call && call.type === 'AssignmentExpression' && /^(ObjectExpression|Literal|ArrayExpression)$/.test(call.right.type)) {
      blocks.push({ kind: 'data', line: lineAt(st.start), guarded: true }); continue
    }
    const fn = call && call.type === 'CallExpression' ? call.callee : null
    if (!fn || (fn.type !== 'FunctionExpression' && fn.type !== 'ArrowFunctionExpression')) {
      blocks.push({ kind: 'other', line: lineAt(st.start), guarded: false, reason: 'a top-level statement that is not a function called at once (' + st.type + ')' })
      continue
    }
    if (!fn.body || fn.body.type !== 'BlockStatement') { blocks.push({ kind: 'other', line: lineAt(st.start), guarded: false, reason: 'an arrow function with an expression body' }); continue }
    const body = fn.body
    const stmts = body.body
    const directives = stmts.filter(isDirective)
    const rest = stmts.filter((s) => !isDirective(s))
    const guarded = rest.length === 1 && rest[0].type === 'TryStatement' && !!rest[0].handler
    // where `try {` goes: right after the directive prologue (or the `{`), but past a trailing `// comment` on that same line so the comment keeps its line
    const anchor = directives.length ? directives[directives.length - 1].end : body.start + 1
    const nl = src.indexOf('\n', anchor)
    const open = nl > anchor && /^[ \t]*(\/\/.*)?$/.test(src.slice(anchor, nl)) ? nl : anchor
    blocks.push({ kind: 'iife', line: lineAt(st.start), guarded, open, close: body.end - 1, async: !!fn.async, statements: rest.length })
  }
  return blocks
}

export function guardSource(src) {
  const todo = blocksOf(src).filter((b) => b.kind === 'iife' && !b.guarded)
  let out = src
  // from the last block to the first, and the closing before the opening, so earlier offsets stay true
  for (const b of todo.slice().reverse()) {
    const before = out.slice(0, b.close)
    const needNl = before.endsWith('\n') ? '' : '\n'
    out = before + needNl + '  } catch (e) {}\n' + out.slice(b.close)
    out = out.slice(0, b.open) + '\n  try {' + out.slice(b.open)
  }
  return { out, changed: todo.length }
}
