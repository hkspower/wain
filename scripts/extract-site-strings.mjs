/**
 * Every string the storefront can say, read out of the bundle itself.
 *
 *   npm run make:site-strings     write assets/site-strings.json
 *   npm run test:site-strings     fail if it has drifted from the bundle
 *
 * WHY THIS EXISTS. The website is a prebuilt bundle with no source in this
 * repository, and its whole vocabulary lives in one object inside it:
 *
 *     var g = { en: { dir: `ltr`, nav: { home: `Home`, … } }, ar: { … } }
 *
 * — about 420 strings per language across 56 groups, every heading, button,
 * empty state and error message on the site. It is a rolldown-scoped `var`
 * inside the module's IIFE, attached to no global and exported nowhere, so
 * nothing at runtime can read it. The panel's text editor needs that
 * vocabulary to offer, and this is the only way to get it: statically, from
 * the file, at tooling time.
 *
 * WHY acorn AND NOT A REGULAR EXPRESSION. The bundle is one 143 kB line of
 * minified JavaScript in which every value is a template literal, some
 * containing braces of their own ("Show {n} more"). A regex that walks that
 * looking for matching braces gets it wrong on the first string containing
 * one, and gets it wrong SILENTLY — a truncated dictionary is a smaller
 * number, not an error. Parsing is exact, and the parser is already here.
 *
 * WHY IT REFUSES RATHER THAN SKIPS. Every value it cannot represent as a
 * plain string stops the run and names its path. A value quietly dropped is a
 * key missing from the editor, which reads to the owner as a string the shop
 * does not have — and this repository has the lesson written down twice
 * already, about an extractor whose character class dropped a route name and
 * an extractor whose two halves shared a term. An extractor that finds fewer
 * things than it should looks exactly like a smaller shop.
 *
 * WHY IT IS CHECKED IN AND CHECKED. The generated file is the panel's whole
 * catalogue, and it also supplies the ORIGINAL text that the storefront
 * overlay matches on. If the bundle is ever rebuilt and this is not
 * regenerated, every override the owner saves will match nothing and change
 * nothing — silently. `--check` is what makes that a failing test rather than
 * a mystery, the same argument make-brand-tokens.mjs and make-file-manifest
 * both make for themselves.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as acorn from 'acorn';

const ASSETS = 'sporta-site/public_html/assets';
const OUT = join(ASSETS, 'site-strings.json');
const check = process.argv.includes('--check');

/** The one bundle. Named by hash, so it is found rather than written down. */
function bundlePath() {
  const hits = readdirSync(ASSETS).filter((f) => /^index-.*\.js$/.test(f));
  if (hits.length !== 1) {
    throw new Error(`expected exactly one index-*.js in ${ASSETS}, found ${hits.length}: ${hits.join(', ')}`);
  }
  return join(ASSETS, hits[0]);
}

/**
 * An AST node as plain data, or a thrown error naming where it gave up.
 *
 * Template literals are the bundle's string form and are accepted only when
 * they interpolate nothing: `Show {n} more` is a literal brace and fine,
 * `${x} left` is a value that depends on something this file cannot see, and
 * pretending otherwise would put a broken string in front of the owner.
 */
/** A value the shop works out rather than states. See the function cases. */
const COMPUTED = { computed: true };

function plain(node, path) {
  switch (node.type) {
    case 'Literal':
      if (typeof node.value !== 'string') throw new Error(`${path}: ${typeof node.value}, not a string`);
      return node.value;
    case 'TemplateLiteral':
      if (node.expressions.length > 0) throw new Error(`${path}: interpolates \${…}`);
      return node.quasis.map((q) => q.value.cooked).join('');
    case 'ObjectExpression': {
      const out = {};
      for (const p of node.properties) {
        if (p.type !== 'Property') throw new Error(`${path}: a spread or getter`);
        const key = p.key.type === 'Identifier' ? p.key.name : p.key.value;
        out[String(key)] = plain(p.value, `${path}.${key}`);
      }
      return out;
    }
    case 'ArrayExpression':
      return node.elements.map((e, i) => {
        if (e === null) throw new Error(`${path}[${i}]: a hole`);
        return plain(e, `${path}[${i}]`);
      });
    // SOME ENTRIES ARE FUNCTIONS. `a11y.bagCount` is an arrow taking a count
    // and returning a sentence — pluralisation, which Arabic needs more of
    // than English does. There is no fixed line to match on and nothing to
    // swap, so it is recorded as a leaf and marked in the catalogue rather
    // than thrown away: an owner searching for the text they can see on screen
    // should be told why it is not here, not left to conclude the editor is
    // missing things.
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return COMPUTED;
    default:
      throw new Error(`${path}: ${node.type}, which this cannot represent`);
  }
}

/** `{nav:{home:'Home'}}` -> `{'nav.home': 'Home'}`. Arrays keep their index,
 *  so a hero slide is `heroSlides.0.title` and stays stable as long as the
 *  order does. */
function flatten(value, prefix, into) {
  if (typeof value === 'string' || value === COMPUTED) { into[prefix] = value; return into; }
  for (const [k, v] of Object.entries(value)) {
    flatten(v, prefix ? `${prefix}.${k}` : k, into);
  }
  return into;
}

const file = bundlePath();
const src = readFileSync(file, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });

/**
 * The dictionary: the one object whose `en` and `ar` are both OBJECTS of
 * strings.
 *
 * FOUND BY SHAPE, not by name. It is `g` in this build and will be a
 * different letter in the next one — a minifier's choice is the last thing to
 * hard-code.
 *
 * THE `en`/`ar` KEYS ALONE WERE NOT ENOUGH, and the first version of this
 * found two: the dictionary, and `Ke = {en: \`…\`, ar: \`…\`}` — one string per
 * language, somebody's date format or aria label. Requiring both halves to be
 * objects separates them. The "two candidates" guard stays: picking the first
 * match would have produced a catalogue of one string and reported success.
 */
let found = null;
let foundName = null;
const visit = (node) => {
  if (!node || typeof node.type !== 'string') return;
  if (node.type === 'VariableDeclarator' && node.init?.type === 'ObjectExpression') {
    const props = node.init.properties.filter((p) => p.type === 'Property');
    const byName = new Map(props.map((p) => [p.key.type === 'Identifier' ? p.key.name : p.key.value, p.value]));
    if (byName.get('en')?.type === 'ObjectExpression' && byName.get('ar')?.type === 'ObjectExpression') {
      if (found) throw new Error('two objects look like the dictionary — narrow the test');
      found = node.init;
      foundName = node.id?.name ?? '?';
    }
  }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v);
  }
};
visit(ast);

if (!found) {
  console.error('FAIL  no en/ar dictionary found in ' + file);
  console.error('      The bundle was rebuilt into a shape this does not recognise.');
  console.error('      Nothing is written; the site text editor is offering a stale catalogue.');
  process.exit(1);
}

const dict = plain(found, foundName);
const en = flatten(dict.en, '', {});
const ar = flatten(dict.ar, '', {});

/* A KEY IS ONLY USEFUL IF BOTH LANGUAGES HAVE IT. The overlay swaps whichever
   language is on screen, so a key present in one and not the other is an
   override that works half the time — worse than one that does not exist,
   because it looks like it worked. */
const has = (side, k) => typeof side[k] === 'string' || side[k] === COMPUTED;
const keys = Object.keys(en).filter((k) => has(ar, k)).sort();
const onlyEn = Object.keys(en).filter((k) => !has(ar, k));
const onlyAr = Object.keys(ar).filter((k) => !has(en, k));

/* A string carrying {n} or {total} reaches the page ALREADY INTERPOLATED —
   "Show 12 more", never "Show {n} more" — so a literal match on the template
   can never fire. They are kept in the catalogue and marked, because an owner
   searching for "Show" should find it and be told why it is not editable
   rather than concluding the editor is broken. */
const HOLE = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/;

const strings = {};
for (const k of keys) {
  if (en[k] === COMPUTED || ar[k] === COMPUTED) {
    strings[k] = { fixed: 'the shop works this line out from a number' };
  } else if (HOLE.test(en[k]) || HOLE.test(ar[k])) {
    strings[k] = { en: en[k], ar: ar[k], fixed: 'carries a value the page fills in' };
  } else {
    strings[k] = { en: en[k], ar: ar[k] };
  }
}

const editable = keys.filter((k) => !strings[k].fixed).length;

/* A SUSPICIOUSLY SHORT LIST IS A BUG, NOT A SMALL SHOP. make-file-manifest
   carries the same guard for the same reason: an almost-empty catalogue would
   be written out, committed, and report a clean run for ever after. */
if (keys.length < 300) {
  console.error(`FAIL  only ${keys.length} strings found — the dictionary is far smaller than this bundle should hold`);
  process.exit(1);
}

const payload = {
  _: 'GENERATED by scripts/extract-site-strings.mjs from the bundle. Do not hand-edit — run npm run make:site-strings.',
  bundle: file.split('/').pop(),
  count: keys.length,
  editable,
  strings,
};
const text = JSON.stringify(payload, null, 1) + '\n';

if (check) {
  let have = null;
  try { have = readFileSync(OUT, 'utf8'); } catch { /* not written yet */ }
  if (have === text) {
    console.log(`ok   site-strings.json matches the bundle   ${keys.length} strings, ${editable} editable`);
    process.exit(0);
  }
  console.error('FAIL site-strings.json has drifted from the bundle');
  console.error(have === null
    ? '     It does not exist. Run: npm run make:site-strings'
    : '     The bundle changed and the catalogue did not. Every override the owner\n' +
      '     has saved is matching text the site no longer says, silently.\n' +
      '     Run: npm run make:site-strings');
  process.exit(1);
}

writeFileSync(OUT, text);
console.log(`wrote ${OUT}`);
console.log(`     ${keys.length} strings from ${file.split('/').pop()}, ${editable} editable`);
if (onlyEn.length || onlyAr.length) {
  console.log(`     skipped ${onlyEn.length + onlyAr.length} present in one language only` +
    (onlyEn.length ? `\n       en only: ${onlyEn.slice(0, 5).join(', ')}${onlyEn.length > 5 ? '…' : ''}` : '') +
    (onlyAr.length ? `\n       ar only: ${onlyAr.slice(0, 5).join(', ')}${onlyAr.length > 5 ? '…' : ''}` : ''));
}
