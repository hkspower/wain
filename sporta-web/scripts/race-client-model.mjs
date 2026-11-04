// Model check of the bag guard in public/birthday.js (the RACES block that wraps localStorage "sporta_cart"). Lane K3 review, 2026-11-04.
//
// Rig-free and browser-free: the guard's own source is run in a vm sandbox per "tab" (a stub window with a Storage whose data is
// shared), so the CODE under test is the shipped code, not a copy. Two tabs behave like the compiled app: each keeps its own array
// (its "view"), writes the WHOLE array after every user action, and never reads another tab's lines. A random sequence of user
// actions (add, +, remove, reload) is applied to both the tabs and ONE canonical bag, and after every action what is stored must
// equal the canonical bag. Actions with no unambiguous meaning for both (pressing + on a line the other tab removed) are not chosen.
//
//   node scripts/race-client-model.mjs            (RUNS=3000 STEPS=25 SEED=1; GUARD_JS=<another copy of the guard to test>)
// Exit 0 = no run diverged; 1 = diverged (the first divergence is printed); 2 = no guard block in that file.
// Part of scripts/race-client-test.mjs (section M). Mutation: a guard that is never installed diverges in about 99% of 3000 runs,
// one that puts removed lines back in 54%, one that replaces instead of adds quantities in 69%.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(process.env.GUARD_JS || new URL('../public/birthday.js', import.meta.url), 'utf8')
const start = SRC.indexOf(";(function () {\n  'use strict'\n  try {\n    var KEY = 'sporta_cart'")
const end = SRC.indexOf('\n;(function () {', start + 10)
if (start < 0 || end < 0) { console.log('guard block not found (this is the unguarded file?)'); process.exit(2) }
const GUARD = SRC.slice(start, end)

function makeTab(shared) {
  const listeners = {}
  class Storage {}
  const mk = () => Object.create(Storage.prototype)
  Storage.prototype.getItem = function (k) { return shared.has(String(k)) ? shared.get(String(k)) : null }
  Storage.prototype.setItem = function (k, v) { shared.set(String(k), String(v)) }
  const localStorage = mk(), sessionStorage = mk()
  const win = { Storage, localStorage, sessionStorage, addEventListener: (t, f) => { (listeners[t] ||= []).push(f) } }
  const ctx = vm.createContext({
    window: win, location: { pathname: '/shop', reload() { ctx.__reloaded = true } },
    document: { hidden: false, addEventListener() {}, querySelectorAll: () => [] }, JSON, Math, Number, String, Object, Array, isFinite,
  })
  vm.runInContext(GUARD, ctx)
  return { win, ctx, localStorage, listeners }
}

const keys = ['a', 'b', 'c', 'd']
const L = (key, qty) => ({ key, slug: key, size: 'M', fit: null, name: { en: key, ar: key }, price: 5, image: '', qty })
let seed = Number(process.env.SEED || 1)
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const asMap = (bag) => Object.fromEntries((bag || []).map((l) => [l.key, l.qty]))
const same = (x, y) => JSON.stringify(Object.entries(x).sort()) === JSON.stringify(Object.entries(y).sort())

let bad = 0, runs = Number(process.env.RUNS || 3000), steps = Number(process.env.STEPS || 25), first = null
const byKind = {}
for (let r = 0; r < runs; r++) {
  const shared = new Map()
  const tabs = [makeTab(shared), makeTab(shared)]
  const canon = {}      // key -> qty
  const view = [[], []] // each tab's React state (an array of lines)
  const write = (i) => tabs[i].localStorage.setItem('sporta_cart', JSON.stringify(view[i]))
  const log = []
  for (let s = 0; s < steps; s++) {
    const i = Math.floor(rnd() * 2)
    const v = view[i], has = (k) => v.find((l) => l.key === k), op = pick(['add', 'add', 'inc', 'remove', 'reload'])
    const k = pick(keys)
    if (op === 'add') {
      if (has(k) && !(k in canon)) continue
      if (has(k)) has(k).qty++; else v.push(L(k, 1))
      canon[k] = (canon[k] || 0) + 1
      write(i)
    } else if (op === 'inc') {
      if (!has(k) || !(k in canon)) continue
      has(k).qty++; canon[k]++; write(i)
    } else if (op === 'remove') {
      if (!has(k) || !(k in canon)) continue
      view[i] = v.filter((l) => l.key !== k); delete canon[k]; write(i)
    } else { // reload: a new page; the guard starts again and the app reads what is stored
      tabs[i] = makeTab(shared)
      let st = []
      try { st = JSON.parse(shared.get('sporta_cart') || '[]') } catch { st = [] }
      view[i] = st.map((l) => ({ ...l }))
      continue
    }
    log.push(`${i}:${op}:${k}`)
    const got = asMap(JSON.parse(shared.get('sporta_cart') || '[]'))
    if (!same(got, canon)) {
      bad++
      byKind[op] = (byKind[op] || 0) + 1
      if (!first) first = { run: r, step: s, log: log.slice(), canon: { ...canon }, got }
      break
    }
  }
}
console.log(`${runs} runs x up to ${steps} operations: ${bad} runs diverged from the oracle`, JSON.stringify(byKind))
if (first) console.log('first divergence:', JSON.stringify(first))
process.exit(bad ? 1 : 0)
