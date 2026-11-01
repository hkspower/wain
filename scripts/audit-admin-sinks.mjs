#!/usr/bin/env node
/**
 * Does any code the admin board can load write HTML from a string?
 *   node scripts/audit-admin-sinks.mjs [root] [--list]
 *
 * Why: the admin board keeps its token in sessionStorage, and the site's CSP allows
 * 'unsafe-inline', because output: 'export' has no server to mint a per-request nonce.
 * A script that got into /admin could read the token and place orders, publish places
 * and approve photos. Nothing stopped a sink from being added to admin code until this
 * check (the 14 October login scan, finding C).
 *
 * Scope: every .ts .tsx .js .jsx .mjs .cjs .mts .cts under src/. The admin page is the
 * root layout plus whatever the admin route imports, all on one origin, so a sink in any
 * module that can load is as much a sink on /admin as one in src/components/admin/. The
 * first version listed the admin files and three src/lib modules, and a sink appended to
 * the root layout or to WainAiCall passed. The layout imports AppShell, WainAi and
 * OrdersLink, none of which was read. Symbolic links are followed, so a link cannot name
 * a file that is not read.
 *
 * What counts as a sink, in code only:
 *   - the identifiers dangerouslySetInnerHTML, innerHTML, outerHTML, insertAdjacentHTML,
 *     createContextualFragment, setHTMLUnsafe, parseHTMLUnsafe and parseFromString; and
 *     srcdoc in any case (JSX writes it srcDoc)
 *   - a string literal with one of those values, including one built from adjacent
 *     literals: window['inner' + 'HTML'], el?.['setAttribute']
 *   - document.write and document.writeln, dotted or bracketed
 *   - eval as a bare name, and .eval on any receiver: (window as any).eval, top!.eval
 *   - Function after `new`, before `(`, or as any .Function member
 *   - setAttribute whose name is a literal starting with "on"
 *
 * How the code is read, in two steps:
 *   1. The TypeScript parser finds every JSX text span and blanks it, keeping the
 *      newlines so every line keeps its number. Copy is not code. A lexer cannot tell
 *      the two apart: a `//` in copy hides the rest of its line, sink included, and an
 *      apostrophe in copy reads as an unterminated string. A file with a syntax error
 *      fails the audit with its line.
 *   2. The lexer below reads what is left. It strips comments and never emits them.
 *      Optional chaining is read as the plain access it stands for: window?.eval is
 *      window.eval, and el?.(x) is el(x).
 *
 * Naive, where a sink can still hide:
 *   - Regex or division is decided by the previous token. After `}` a slash is division,
 *     so a regex literal that opens a statement after a block is read as code. The regex
 *     reader gives up at the end of a line.
 *   - Folding joins only adjacent string literals joined by `+`. 'inner' + key + 'HTML'
 *     and 'inner'.concat('HTML') are not joined.
 *   - No types and no aliases. A method reached through a variable (const d = document;
 *     d.write(...)), a sink held in a variable (const set = el.setAttribute), a
 *     constructor reached through a value ([].constructor.constructor(...)), and a name
 *     built from a variable (el[key], 'inner' + key) cannot be named.
 *   - Strings are decoded (\x, \u, \u{}, line continuations), and an identifier may spell
 *     a letter with \u. Legacy octal escapes are not decoded.
 *
 * Failing closed: a file the parser or the lexer cannot read to the end (an unterminated
 * block comment, string or template literal, or a syntax error) fails the audit with its
 * line. JSX copy is the one region it does not read, on purpose: copy cannot run.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const LIST = args.includes("--list");
const ROOT = resolve(args.find((a) => !a.startsWith("--")) ?? DEFAULT_ROOT);

const SCAN_DIRS = ["src"];
// src/app/layout.tsx is scanned, with its one sink counted: its before-paint script is the
// site's one inline script that writes HTML (CSP 'unsafe-inline' lets it run), it runs on
// every route including /admin, and it is not admin code. A second sink there fails.
const ALLOWED = { "src/app/layout.tsx": { dangerouslySetInnerHTML: 1 } };
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const SCRIPT_KIND = {
  ".ts": ts.ScriptKind.TS, ".mts": ts.ScriptKind.TS, ".cts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX, ".jsx": ts.ScriptKind.JSX,
  ".js": ts.ScriptKind.JS, ".mjs": ts.ScriptKind.JS, ".cjs": ts.ScriptKind.JS,
};

// The HTML-from-string entry points. The first version had only the first four names.
const DOM_SINKS = new Set([
  "dangerouslySetInnerHTML", "innerHTML", "outerHTML", "insertAdjacentHTML",
  "createContextualFragment", "setHTMLUnsafe", "parseHTMLUnsafe", "parseFromString",
]);
const DOCUMENT_WRITERS = new Set(["write", "writeln"]);
// After these words a `/` starts a regex literal; after any other word it divides.
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw",
  "case", "do", "else", "yield", "await",
]);
const IDENT_START = /[\p{ID_Start}$_]/u;
const IDENT_PART = /[\p{ID_Continue}$‌‍]/u;
const SIMPLE_ESCAPES = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v" };

const isPunct = (t, v) => t?.kind === "punct" && t.value === v;

/**
 * The comment stripper, which is also the tokenizer. It emits identifiers, strings,
 * numbers and punctuation, and never emits a comment. JSX copy has already been blanked
 * by blankJsxText, so the regex and division rules below only see code.
 */
function tokenize(src) {
  const toks = [];
  const errors = [];
  const n = src.length;
  let i = 0;

  const pushPunct = (value, pos) => toks.push({ kind: "punct", value, pos });

  function regexAllowed() {
    const p = toks[toks.length - 1];
    if (!p) return true;
    if (p.kind === "punct" && p.value === ">") {
      // Only `=>` opens an expression here. A `>` that closes a JSX tag is followed by
      // copy, which is blanked now, but a slash after it still must not open a regex.
      const q = toks[toks.length - 2];
      return q?.kind === "punct" && q.value === "=" && q.pos + 1 === p.pos;
    }
    if (p.kind === "punct") return ![")", "]", "}", "<"].includes(p.value);
    if (p.kind === "id") return REGEX_AFTER_WORD.has(p.value);
    return false;
  }

  function readRegex() {
    let k = i + 1;
    let inClass = false;
    while (k < n) {
      const c = src[k];
      if (c === "\n" || c === "\r") return false;
      if (c === "\\") { k += 2; continue; }
      if (inClass) {
        if (c === "]") inClass = false;
      } else if (c === "[") {
        inClass = true;
      } else if (c === "/") {
        k++;
        while (k < n && /[A-Za-z]/.test(src[k])) k++;
        toks.push({ kind: "regex", value: "", pos: i });
        i = k;
        return true;
      }
      k++;
    }
    return false;
  }

  function readString(start) {
    const quote = src[start];
    i = start + 1;
    let value = "";
    while (i < n) {
      const c = src[i];
      if (c === quote) {
        i++;
        toks.push({ kind: "str", value, pos: start });
        return;
      }
      if (c === "\n" || c === "\r") break;
      if (c === "\\") {
        const e = escapeAt(src, i);
        value += e.text;
        i = e.next;
        continue;
      }
      value += c;
      i++;
    }
    errors.push({ pos: start, what: "unterminated string (strings end at the line)" });
    toks.push({ kind: "str", value, pos: start });
  }

  function readTemplate(start) {
    i = start + 1;
    let value = "";
    let substituted = false;
    for (;;) {
      if (i >= n) {
        errors.push({ pos: start, what: "unterminated template literal" });
        break;
      }
      const c = src[i];
      if (c === "`") { i++; break; }
      if (c === "\\") {
        const e = escapeAt(src, i);
        value += e.text;
        i = e.next;
        continue;
      }
      if (c === "$" && src[i + 1] === "{") {
        substituted = true;
        i += 2;
        lexCode(true);
        continue;
      }
      value += c;
      i++;
    }
    if (substituted) toks.push({ kind: "tpl", value: "", pos: start });
    else toks.push({ kind: "str", value, pos: start });
  }

  function readIdent() {
    const start = i;
    let value = "";
    let first = true;
    while (i < n) {
      if (src[i] === "\\" && src[i + 1] === "u") {
        const e = unicodeEscapeAt(src, i);
        if (!e) break;
        value += e.text;
        i = e.next;
        first = false;
        continue;
      }
      const ch = String.fromCodePoint(src.codePointAt(i));
      if (first ? !IDENT_START.test(ch) : !IDENT_PART.test(ch)) break;
      value += ch;
      i += ch.length;
      first = false;
    }
    if (value === "") {
      pushPunct("\\", start);
      i = start + 1;
      return;
    }
    toks.push({ kind: "id", value, pos: start });
  }

  function readNumber() {
    const start = i;
    while (i < n && /[0-9A-Za-z_.]/.test(src[i])) i++;
    toks.push({ kind: "num", value: src.slice(start, i), pos: start });
  }

  /** Lex code until the end of input, or until the `}` that closes a `${`. */
  function lexCode(untilBrace) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      const d = src[i + 1];
      if (/\s/.test(c)) { i++; continue; }
      if (c === "/" && d === "/") {
        while (i < n && src[i] !== "\n" && src[i] !== "\r") i++;
        continue;
      }
      if (c === "/" && d === "*") {
        const end = src.indexOf("*/", i + 2);
        if (end < 0) {
          errors.push({ pos: i, what: "unterminated block comment (everything after it would be hidden)" });
          i = n;
          return;
        }
        i = end + 2;
        continue;
      }
      if (c === '"' || c === "'") { readString(i); continue; }
      if (c === "`") { readTemplate(i); continue; }
      if (c === "/" && regexAllowed() && readRegex()) continue;
      if (c === "{") { depth++; pushPunct("{", i); i++; continue; }
      if (c === "}") {
        if (untilBrace && depth === 0) { i++; return; }
        depth--;
        pushPunct("}", i);
        i++;
        continue;
      }
      if ((c === "\\" && d === "u") || IDENT_START.test(String.fromCodePoint(src.codePointAt(i)))) {
        readIdent();
        continue;
      }
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(d ?? ""))) { readNumber(); continue; }
      // `?.` is optional chaining. `?.5` is a ternary with a number, so it is not one.
      if (c === "?" && d === "." && !/[0-9]/.test(src[i + 2] ?? "")) { pushPunct("?.", i); i += 2; continue; }
      pushPunct(c, i);
      i++;
    }
  }

  lexCode(false);
  return { tokens: fold(unOptional(toks)), errors };
}

/**
 * `?.` is read as the access it stands for: `.` before a name, and nothing before `(` or
 * `[`, where the `(` or `[` that follows is already the call or index.
 */
function unOptional(toks) {
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (!isPunct(t, "?.")) { out.push(t); continue; }
    const after = toks[k + 1];
    if (isPunct(after, "(") || isPunct(after, "[")) continue;
    out.push({ kind: "punct", value: ".", pos: t.pos });
  }
  return out;
}

/** Escape at src[i] === "\\". Returns the decoded text and where the escape ends. */
function escapeAt(src, i) {
  const c = src[i + 1];
  if (c === undefined) return { text: "", next: i + 1 };
  if (Object.hasOwn(SIMPLE_ESCAPES, c)) return { text: SIMPLE_ESCAPES[c], next: i + 2 };
  if (c === "0" && !/[0-9]/.test(src[i + 2] ?? "")) return { text: "\0", next: i + 2 };
  if (c === "x" && /^[0-9a-fA-F]{2}$/.test(src.slice(i + 2, i + 4))) {
    return { text: String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16)), next: i + 4 };
  }
  if (c === "u") {
    const e = unicodeEscapeAt(src, i);
    if (e) return e;
  }
  if (c === "\r") return { text: "", next: src[i + 2] === "\n" ? i + 3 : i + 2 };
  if (c === "\n") return { text: "", next: i + 2 };
  return { text: c, next: i + 2 };
}

/** \uXXXX or \u{X...} at src[i] === "\\". Null when it is not a valid escape. */
function unicodeEscapeAt(src, i) {
  if (src[i + 2] === "{") {
    const close = src.indexOf("}", i + 3);
    if (close < 0) return null;
    const hex = src.slice(i + 3, close);
    if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) return null;
    const cp = parseInt(hex, 16);
    if (cp > 0x10ffff) return null;
    return { text: String.fromCodePoint(cp), next: close + 1 };
  }
  const hex = src.slice(i + 2, i + 6);
  if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
  return { text: String.fromCharCode(parseInt(hex, 16)), next: i + 6 };
}

/** 'inner' + 'HTML' is one string literal to the rules below. Only literal runs fold. */
function fold(toks) {
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind !== "str") { out.push(t); continue; }
    let value = t.value;
    let j = k;
    while (
      toks[j + 1]?.kind === "punct" && toks[j + 1].value === "+" &&
      toks[j + 2]?.kind === "str"
    ) {
      value += toks[j + 2].value;
      j += 2;
    }
    out.push({ kind: "str", value, pos: t.pos });
    k = j;
  }
  return out;
}

/** The rules. Each hit is a token position and the name that matched. */
function findHits(toks) {
  const hits = [];
  const hit = (pos, token) => hits.push({ pos, token });
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    const prev = toks[k - 1];
    const next = toks[k + 1];
    const next2 = toks[k + 2];

    if (t.kind === "str") {
      if (DOM_SINKS.has(t.value)) hit(t.pos, `"${t.value}"`);
      else if (t.value.toLowerCase() === "srcdoc") hit(t.pos, `"${t.value}"`);
      else if ((t.value === "eval" || t.value === "Function") && isPunct(prev, "[")) hit(t.pos, `["${t.value}"]`);
      else if (
        t.value === "setAttribute" && isPunct(prev, "[") && isPunct(next, "]") && isPunct(next2, "(") &&
        toks[k + 3]?.kind === "str" && toks[k + 3].value.toLowerCase().startsWith("on")
      ) hit(t.pos, `["setAttribute"]("${toks[k + 3].value}")`);
      continue;
    }
    if (t.kind !== "id") continue;

    // The receiver is not checked for eval and Function. (window as any).eval, top!.eval
    // and a variable holding window cannot be told apart from an object's method without
    // types, and no admin file has a member named eval or Function.
    const afterDot = isPunct(prev, ".");
    if (DOM_SINKS.has(t.value)) {
      hit(t.pos, t.value);
    } else if (t.value.toLowerCase() === "srcdoc") {
      hit(t.pos, t.value);
    } else if (t.value === "document" && isPunct(next, ".") && next2?.kind === "id" && DOCUMENT_WRITERS.has(next2.value)) {
      hit(t.pos, `document.${next2.value}`);
    } else if (t.value === "document" && isPunct(next, "[") && next2?.kind === "str" && DOCUMENT_WRITERS.has(next2.value)) {
      hit(t.pos, `document["${next2.value}"]`);
    } else if (t.value === "eval") {
      if (afterDot || !isPunct(next, ":")) hit(t.pos, afterDot ? ".eval" : "eval");
    } else if (
      t.value === "Function" &&
      (afterDot || isPunct(next, "(") || (prev?.kind === "id" && prev.value === "new"))
    ) {
      hit(t.pos, afterDot ? ".Function" : "Function");
    } else if (t.value === "setAttribute" && isPunct(next, "(") && next2?.kind === "str" && next2.value.toLowerCase().startsWith("on")) {
      hit(t.pos, `setAttribute("${next2.value}")`);
    }
  }
  return hits;
}

/**
 * Blanks JSX text so the lexer never reads it: every character of a JsxText node becomes a
 * space, and its newlines stay, so line numbers do not move. A syntax error from the
 * parser is a problem, not a silent pass.
 */
function blankJsxText(src, rel, starts, problems) {
  const { diagnostics = [] } = ts.transpileModule(src, {
    fileName: rel,
    reportDiagnostics: true,
    compilerOptions: { allowJs: true, jsx: ts.JsxEmit.Preserve, noEmit: true },
  });
  for (const d of diagnostics) {
    if (d.category === ts.DiagnosticCategory.Error && d.file) {
      problems.push(`${rel}:${lineOf(starts, d.start ?? 0)}: cannot parse: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    }
  }
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, false, SCRIPT_KIND[extname(rel)]);
  const out = src.split("");
  const blank = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.JsxTextAllWhiteSpaces) {
      for (let k = node.pos; k < node.end; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
    ts.forEachChild(node, blank);
  };
  blank(sf);
  return out.join("");
}

/** Line numbers from byte offsets, so a token reports where it is. */
function lineStartsOf(src) {
  const starts = [0];
  for (let k = 0; k < src.length; k++) if (src.charCodeAt(k) === 10) starts.push(k + 1);
  return starts;
}
function lineOf(starts, pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// ---- main ----

const problems = [];

/** Every file under dir, following symbolic links. A link to nothing is a problem. */
function walk(dir, seen = new Set()) {
  const real = realpathSync(dir);
  if (seen.has(real)) return [];
  seen.add(real);
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    let st;
    try {
      st = statSync(path);
    } catch {
      problems.push(`${relative(ROOT, path)}: symbolic link to nothing, so nothing was read`);
      continue;
    }
    if (st.isDirectory()) out.push(...walk(path, seen));
    else if (st.isFile() && EXTENSIONS.has(extname(entry.name))) out.push(path);
  }
  return out;
}

const files = [];
for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) problems.push(`${dir}: directory not found, so nothing in it was checked`);
  else files.push(...walk(abs));
}
files.sort();
if (files.length === 0) problems.push("no files to check");

const hits = [];
for (const abs of files) {
  const rel = relative(ROOT, abs);
  const src = readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
  const starts = lineStartsOf(src);
  const { tokens, errors } = tokenize(blankJsxText(src, rel, starts, problems));
  for (const e of errors) problems.push(`${rel}:${lineOf(starts, e.pos)}: cannot read: ${e.what}`);
  for (const h of findHits(tokens)) hits.push({ rel, line: lineOf(starts, h.pos), token: h.token });
}

// Counted per file and token. A group within its allowance is not a hit; an allowance the
// code no longer uses is a problem, so a sink that moved or went has to be recounted.
const groups = new Map();
for (const h of hits) {
  const key = `${h.rel} ${h.token}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(h);
}
const reported = [];
const allowedNote = [];
for (const group of groups.values()) {
  const { rel, token } = group[0];
  const allowed = ALLOWED[rel]?.[token] ?? 0;
  if (group.length > allowed) reported.push(...group);
  else if (allowed > 0) allowedNote.push(`${rel} ${token} x${group.length}`);
}
for (const [rel, counts] of Object.entries(ALLOWED)) {
  for (const [token, n] of Object.entries(counts)) {
    const found = groups.get(`${rel} ${token}`)?.length ?? 0;
    if (found < n) problems.push(`${rel}: allows ${n} ${token}, found ${found}; update ALLOWED`);
  }
}
reported.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);

if (LIST) for (const f of files) console.log(`  ${relative(ROOT, f)}`);
for (const h of reported) console.log(`  ✗ ${h.rel}:${h.line}  ${h.token}`);
for (const p of problems) console.log(`  ✗ ${p}`);

if (reported.length === 0 && problems.length === 0) {
  const allowed = allowedNote.length ? `; allowed: ${allowedNote.join(", ")}` : "";
  console.log(`  ✓ no HTML sink in code the admin board can load (${files.length} files checked${allowed})`);
} else {
  console.log(`  ${reported.length} hit(s), ${problems.length} problem(s) (${files.length} files checked)`);
  process.exitCode = 1;
}
