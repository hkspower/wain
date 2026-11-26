#!/usr/bin/env node
// ASSISTANT-ASK: put questions to Sporta AI from the command line and read what it answers.
//
//   node scripts/assistant-ask.mjs "do you ship to Saudi" "وين طلبي"         each argument is one question
//   node scripts/assistant-ask.mjs --file questions.json                     a file of questions (see below)
//   node scripts/assistant-ask.mjs --file questions.json --json              one JSON object per line instead of text
//   options:  --lang ar|en    the page language for questions given as arguments (default: Arabic when the question
//                             has an Arabic letter, else English)
//             --cfg '{"ai_key":"..."}'   config keys laid over the rig's config for this run
//
// The file is a JSON array; an entry is a string, or [question, lang], or { "q": question, "lang": "ar" | "en", ... }
// (any other keys of an object are copied to the output, so a bank can carry its own ids and expectations).
//
// It calls assistant_answer() and assistant_route() straight in PHP on the test rig's database (npm run sandbox):
// no HTTP, so the 30-per-minute limit of the public route is not in the way, and everything runs inside one
// transaction that is rolled back (a hand-off is never sent: the rig has no n8n webhook). Never point it at a
// live database: it is a development tool.
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'

const run = promisify(execFile)
const AP = new URL('../dropin/php-store/assistant.php', import.meta.url).pathname
const SP = new URL('../dropin/php-store/store.php', import.meta.url).pathname

export const askAll = async (rows, cfg = {}) => {
  const msgs = rows.map((r) => [r.q, r.lang])
  const code = `require ${JSON.stringify(SP)}; require ${JSON.stringify(AP)};
    $in = json_decode($argv[1], true); $db = store_db(); $cfg = assistant_effective_config($db, array_merge(store_config(), $in['cfg']));
    $db->beginTransaction();
    try { $out = []; foreach ($in['msgs'] as [$m, $l]) { $a = assistant_answer($db, $cfg, $m, $l); $a['route'] = assistant_route(assistant_redact($m)); $out[] = $a; } }
    finally { $db->rollBack(); }
    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);`
  const { stdout } = await run('php', ['-r', code, '--', JSON.stringify({ msgs, cfg })], { maxBuffer: 64 << 20 })
  const out = JSON.parse(stdout)
  return rows.map((r, i) => ({
    ...r,
    intent: out[i].intent,
    topic: out[i].route?.[1] ?? null,
    source: out[i].source,
    reply: out[i].reply,
    items: (out[i].data?.items ?? []).map((p) => p.slug),
    order: out[i].data?.order ? true : undefined,
  }))
}

const isMain = import.meta.url === new URL(process.argv[1], 'file:').href
if (isMain) {
  const argv = process.argv.slice(2)
  const take = (name) => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v }
  const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true }
  const file = take('--file'), lang = take('--lang'), cfg = JSON.parse(take('--cfg') || '{}'), asJson = flag('--json')
  const auto = (q) => lang || (/[؀-ۿ]/.test(q) ? 'ar' : 'en')
  let rows = argv.map((q) => ({ q, lang: auto(q) }))
  if (file) {
    rows = rows.concat(JSON.parse(readFileSync(file, 'utf8')).map((e) =>
      typeof e === 'string' ? { q: e, lang: auto(e) } : Array.isArray(e) ? { q: e[0], lang: e[1] || auto(e[0]) } : { ...e, lang: e.lang || auto(e.q) }))
  }
  if (!rows.length) { console.error('usage: node scripts/assistant-ask.mjs "question" ... | --file questions.json [--json] [--lang ar|en]'); process.exit(1) }
  const out = await askAll(rows, cfg)
  for (const r of out) {
    if (asJson) { console.log(JSON.stringify(r)); continue }
    console.log(`[${r.lang}] ${r.q}\n   -> ${r.intent}${r.topic ? ' / ' + r.topic : ''}${r.items.length ? ' (' + r.items.length + ' items)' : ''}: ${r.reply}\n`)
  }
}
