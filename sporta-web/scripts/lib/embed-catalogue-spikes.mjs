/*
 * Builds the two blocks that public/sporta-catalogue.js embeds from the spike modules, and keeps them in step.
 *   node scripts/lib/embed-catalogue-spikes.mjs --write   rewrite the blocks inside the engine
 *   node scripts/lib/embed-catalogue-spikes.mjs --check   exit 1 when the engine's copy differs from the modules (used by test:qr / test:pdf-text-layer)
 * The modules (scripts/lib/qr-spike.mjs, scripts/lib/pdf-text-layer-spike.mjs) are the tested sources; the engine holds a verbatim copy with
 * the `export` keywords removed, each inside its own function scope and its own try/catch, so a defect there can never stop the page.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ENGINE = path.join(here, '..', '..', 'public', 'sporta-catalogue.js')

export function qrBlock() {
  let s = fs.readFileSync(path.join(here, 'qr-spike.mjs'), 'utf8')
  s = s.replace(/^export \{[^}]*\};?\s*$/m, '').replace(/^export default qr;?\s*$/m, '')
  return [
    '  /* >>> EMBED qr-spike.mjs (verbatim, exports removed; `node scripts/lib/embed-catalogue-spikes.mjs --check`) */',
    '  var qrEncode = null',
    '  try {',
    '    qrEncode = (function () {',
    s.trim().split('\n').map((l) => '      ' + l).join('\n'),
    '      return qr',
    '    })()',
    '  } catch (e) { qrEncode = null }',
    '  /* <<< EMBED qr-spike.mjs */'
  ].join('\n')
}
export function textLayerBlock() {
  let s = fs.readFileSync(path.join(here, 'pdf-text-layer-spike.mjs'), 'utf8')
  const cut = s.indexOf('// ================================================================================================ SELF-TEST')
  if (cut < 0) throw new Error('self-test marker not found')
  s = s.slice(0, cut).replace(/^export /gm, '')
  return [
    '  /* >>> EMBED pdf-text-layer-spike.mjs (verbatim up to its self-test, exports removed; `node scripts/lib/embed-catalogue-spikes.mjs --check`) */',
    '  var textLayerLib = null',
    '  try {',
    '    textLayerLib = (function () {',
    s.trim().split('\n').map((l) => '      ' + l).join('\n'),
    '      return { createTextLayer: createTextLayer, textOps: textOps, characters: characters, DEFAULT_MODE: DEFAULT_MODE }',
    '    })()',
    '  } catch (e) { textLayerLib = null }',
    '  /* <<< EMBED pdf-text-layer-spike.mjs */'
  ].join('\n')
}
const pairs = () => [['qr-spike.mjs', qrBlock()], ['pdf-text-layer-spike.mjs', textLayerBlock()]]
function re(name) { return new RegExp('  /\\* >>> EMBED ' + name.replace(/\./g, '\\.') + '[\\s\\S]*?  /\\* <<< EMBED ' + name.replace(/\./g, '\\.') + ' \\*/') }

export function engineInSync() {
  const src = fs.readFileSync(ENGINE, 'utf8'), bad = []
  for (const [name, block] of pairs()) { const m = re(name).exec(src); if (!m) bad.push(name + ' (missing)'); else if (m[0] !== block) bad.push(name + ' (differs)') }
  return bad
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    let src = fs.readFileSync(ENGINE, 'utf8')
    for (const [name, block] of pairs()) {
      if (!re(name).test(src)) throw new Error('no marker for ' + name + ' in the engine')
      src = src.replace(re(name), () => block)
    }
    fs.writeFileSync(ENGINE, src); console.log('written')
  } else {
    const bad = engineInSync(); console.log(bad.length ? 'OUT OF STEP: ' + bad.join(', ') : 'in step'); process.exit(bad.length ? 1 : 0)
  }
}
