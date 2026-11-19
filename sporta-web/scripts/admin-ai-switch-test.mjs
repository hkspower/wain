// The Sporta AI on / off switch on /backends (sporta-admin-brands.js, block 14).
//
//   npm run test:admin-ai-switch     (no sandbox, no browser)
//
// The switch changes one saved value. These checks read the block's source and hold the rules it must keep:
//   - it reads the saved state with GET assistant_settings and writes ONLY { enabled } with assistant_settings_save,
//     so a save can never carry or touch the AI key (the server keeps every field the body does not carry);
//   - every request carries X-Sporta-Admin, like the admin's own, and the block is /backends-only and runs once;
//   - it does not depend on SPORTA_AI_ADMIN_HIDDEN, so it stays on the screen while the setup page is hidden;
//   - it is built with createElement and textContent, never innerHTML, and it never logs;
//   - it is placed after the Settings screen header and the block ends with its own end marker.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'public', 'sporta-admin-brands.js'), 'utf8')

const start = src.indexOf('/* ===== ADMIN SPORTA AI SWITCH - begin')
const endMark = '/* ===== ADMIN SPORTA AI SWITCH - end'
const end = src.indexOf(endMark)
const block = start >= 0 && end > start ? src.slice(start, src.indexOf('\n', end) + 1) : ''
// The rules below are about CODE. The block's comments explain the design and name things on purpose (the hidden flag,
// the key), so comments are removed before the negative checks run.
const code = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')

let ok = 0
let fail = 0
const check = (name, cond) => {
  if (cond) {
    ok++
    console.log(`ok   ${name}`)
  } else {
    fail++
    console.log(`FAIL ${name}`)
  }
}

check('the switch block is in the add-on file', start >= 0 && end > start)
check('the block ends with its own end marker', block.trimEnd().endsWith('ADMIN SPORTA AI SWITCH - end ========================================= */'))

// ---- what it reads and writes
check('reads the saved state with GET assistant_settings', /request\('assistant_settings'\)/.test(block))
check('writes with assistant_settings_save', /request\('assistant_settings_save', \{ enabled: next \}\)/.test(block))
check('the only key in a save is enabled (no ai_key, no ai_key_clear, no other field)',
  !/ai_key|ai_key_clear|ai_model|welcome_|late_hours|handoff_|ai_enabled/.test(code))
check('the save body is built from one boolean', /var next = !enabled/.test(code))
check('a save only changes the switch when the server answers ok', /if \(r\.ok\) \{[\s\S]*?enabled = r\.body/.test(block))

// ---- transport
check('every request sends X-Sporta-Admin and the same-origin cookie',
  /headers: Object\.assign\(\{ 'X-Sporta-Admin': '1' \}/.test(block) && /credentials: 'same-origin'/.test(block))
check('the API is the admin route', /var API = '\/api\/admin\.php'/.test(block))

// ---- scope and safety
check('runs on /backends only', /location\.pathname\.indexOf\('\/backends'\) !== 0/.test(block))
check('guards against a second copy', /window\.__sportaAiSwitch/.test(block))
check('does not depend on the hidden-screen flag', !/SPORTA_AI_ADMIN_HIDDEN/.test(code))
check('built with createElement and textContent, never innerHTML', /createElement/.test(code) && !/innerHTML|outerHTML|insertAdjacentHTML/.test(code))
check('no console output in the block', !/console\./.test(code))
check('no interval and no observer in the block (one-shot timers only, after a click or a route change)',
  !/setInterval/.test(code) && !/MutationObserver/.test(code))
check('the switch is disabled while a save is in flight', /btn\.disabled = enabled === null \|\| busy/.test(block))
check('placed after the Settings screen header', /closest\('\.admin-page-header'\)/.test(block) && /insertBefore\(row, header\.nextSibling\)/.test(block))
check('the switch is a real switch control (role switch, aria-checked)',
  /setAttribute\('role', 'switch'\)/.test(block) && /aria-checked/.test(block))

// ---- the block is whole inside the file. It used to be the LAST block of the add-on (the check was endsWith); later screens are appended after it by design
// (live data, site icon, CRM interests, SEO live check ...), so what is asserted now is that its end marker is there, exactly once, and that nothing was cut.
check('the add-on file carries the block\'s end marker, once',
  src.split('ADMIN SPORTA AI SWITCH - end ========================================= */').length === 2)

console.log(`\n${ok} ok, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
