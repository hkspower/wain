// The storefront shows the same sizes as the stock screen, and the item code (SKU) of the size in hand.
//
//   npm run test:storefront-sku-size     (no sandbox, no browser: pure functions and the source of the screens)
//
// What is proved:
//   1. normalizeSize (src/lib/options.js) spells a size the way the shop writes it: XXL is 2XL, case and spaces do not matter;
//   2. the alias table of normalizeSize is the SAME table as the server's (STORE_SIZE_ALIASES in dropin/php-store/store.php),
//      so a size is one spelling on the stock screen, in the feed and on the product page;
//   3. the stock table keys every row on normalizeSize(size) (src/lib/stock.js), so a size button always finds its row;
//   4. the product page shows the item code of the size chosen, under the size chips, from the stock row (AHED code as the
//      fallback), and puts the same code on the bag line; the AHED block no longer repeats it;
//   5. the bag, the cart page and the checkout summary show the item code of each line; the line keeps it from the add;
//   6. MUTATION: with the spelling table changed on one side, check 2 fails.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

const OPTIONS = read('src/lib/options.js')
const STOCK = read('src/lib/stock.js')
const PRODUCT = read('src/pages/ProductDetail.jsx')
const AHED = read('src/components/AhedSpec.jsx')
const CART = read('src/lib/cart.jsx')
const CART_PAGE = read('src/pages/Cart.jsx')
const CART_DRAWER = read('src/components/CartDrawer.jsx')
const CHECKOUT = read('src/pages/Checkout.jsx')
const STORE = read('dropin/php-store/store.php')

// ---------------------------------------------------------------------------------------- 1. the spelling
head('1. normalizeSize spells the size the shop way')
// options.js uses extensionless imports (the Vite build resolves them, plain Node does not), so the function is taken
// from its own source text: the alias table and normalizeSize, nothing else, evaluated as they are written.
const block = (OPTIONS.match(/const SIZE_ALIASES = \{[\s\S]*?\n\}\s*export const normalizeSize = \(s\) => \{[\s\S]*?\n\}/) || [])[0] || ''
is(block.length > 0, 'the normalizeSize block is found in src/lib/options.js')
const normalizeSize = block ? new Function(block.replace('export const normalizeSize', 'const normalizeSize') + '\nreturn normalizeSize')() : () => ''
const CASES = [['xxl', '2XL'], [' XXXL ', '3XL'], ['xxxxl', '4XL'], ['XXXXXL', '5XL'], ['l', 'L'], ['one', 'ONE'], ['2xl', '2XL'], [null, '']]
for (const [raw, want] of CASES) is(normalizeSize(raw) === want, `normalizeSize(${JSON.stringify(raw)}) is ${JSON.stringify(want)}`, String(normalizeSize(raw)))

// ---------------------------------------------------------------------------------------- 2. one table, both sides
head('2. the storefront and the server use the same spelling table')
const jsTable = (OPTIONS.match(/const SIZE_ALIASES = \{([^}]*)\}/) || [])[1] || ''
const jsPairs = [...jsTable.matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => `${m[1]}=${m[2]}`).sort()
const phpTable = (STORE.match(/const STORE_SIZE_ALIASES = \[([^\]]*)\]/) || [])[1] || ''
const phpPairs = [...phpTable.matchAll(/'(\w+)'\s*=>\s*'(\w+)'/g)].map((m) => `${m[1]}=${m[2]}`).sort()
is(jsPairs.length === 4 && phpPairs.length === 4, 'both tables are found and hold four aliases', `js ${jsPairs.join(',')} php ${phpPairs.join(',')}`)
is(JSON.stringify(jsPairs) === JSON.stringify(phpPairs), 'the storefront table equals the server table (XXL, XXXL, XXXXL, XXXXXL)', `js ${jsPairs.join(' ')} | php ${phpPairs.join(' ')}`)
// MUTATION: one alias changed on a copy of the storefront table; the same comparison must now find the difference
is(OPTIONS.includes("XXL: '2XL'"), 'the mutation target (XXL: 2XL) is in options.js')
const mutTable = (OPTIONS.replace("XXL: '2XL'", "XXL: '2X'").match(/const SIZE_ALIASES = \{([^}]*)\}/) || [])[1] || ''
const mutPairs = [...mutTable.matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => `${m[1]}=${m[2]}`).sort()
is(JSON.stringify(mutPairs) !== JSON.stringify(phpPairs), 'MUTATION: with XXL changed on one side, the table comparison fails')

// ---------------------------------------------------------------------------------------- 3. stock rows
head('3. the stock table keys every row on the shop spelling')
is(/import \{ normalizeSize \} from '\.\/options'/.test(STOCK), 'stock.js imports normalizeSize')
is(/\[normalizeSize\(r\.size\)\]\s*=\s*\{\s*sku: r\.sku/.test(STOCK), 'shape() keys each row on normalizeSize(r.size), with its sku')

// ---------------------------------------------------------------------------------------- 4. the product page
head('4. the product page shows the item code of the size in hand')
is(/const itemCode = size \? stock\?\.\[size\]\?\.sku \?\? ahed\?\.skus\?\.\[size\] \?\? null : null/.test(PRODUCT),
  'itemCode is the stock row\'s sku for the size, the AHED code as the fallback, null with no size')
is(/\{itemCode && \(\s*<p[^>]*>\s*\{t\.spec\.sku\}:\s*<span[^>]*data-item-code[^>]*>\{itemCode\}<\/span>/.test(PRODUCT),
  'it is drawn under the size chips with the label t.spec.sku ("Item code")')
is(/\{sizeErr && <p[^>]*>\{t\.size\.pick\}<\/p>\}\s*\{itemCode && \(/.test(PRODUCT), 'and it sits right after the size chips and the "pick a size" line')
is(/add\(product, qty, size, fit, itemCode\)/.test(PRODUCT), 'the add-to-bag call carries the same item code')
is(!/t\.spec\.sku/.test(AHED) && !/skus\?\.\[size\]/.test(AHED), 'the AHED block no longer draws its own item code (no duplicate)')
is(/export default function AhedSpec\(\{ detail \}\)/.test(AHED), 'AhedSpec takes no size prop any more')

// ---------------------------------------------------------------------------------------- 5. the bag and the checkout
head('5. the bag, the cart page and the checkout show the item code of each line')
is(/sku = null\) =>/.test(CART) && /\n\s*sku,\n\s*name: product\.name,/.test(CART), 'the bag stores the item code of each line when it is added')
is(/\{i\.sku && \(\s*<p[^>]*>\s*\{t\.spec\.sku\}:\s*<span[^>]*data-item-code[^>]*>\{i\.sku\}<\/span>/.test(CART_PAGE), 'the cart page shows it under the size, with its label')
is(/\{i\.sku && <p[^>]*data-item-code[^>]*>\{i\.sku\}<\/p>\}/.test(CART_DRAWER), 'the bag drawer shows it under the price')
is(/\{i\.sku && <span[^>]*>\s*\{i\.sku\}<\/span>\}/.test(CHECKOUT), 'the checkout summary shows it on the line')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
