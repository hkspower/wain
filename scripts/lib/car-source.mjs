// The car roster, as data you can read and as source you can change.
//
// The sixteen cars live in src/game/mods.ts as TypeScript object
// literals, and that is the right place for them: everything else in
// this repo is generated FROM there — the Unity data, the Unreal header,
// the public API, the Blender profiles. Moving the roster into a JSON
// file or a database to make it editable would create a second source of
// truth for the thing every port already agrees on, which is the one
// mistake this codebase spends most of its comments avoiding.
//
// So the editor edits the source. That is only safe if the writer is
// narrow, and this one is as narrow as it can be made:
//
//   * It locates the CARS array by its declaration and its matching
//     bracket, and will not look outside it.
//   * Inside it, it finds one car by its `id` literal.
//   * Inside that car, it replaces the VALUE of one named field, in
//     place, leaving the key, the comma, the comments and every other
//     line exactly as they were.
//   * The value it writes is re-serialised from a validated JavaScript
//     primitive. Nothing the caller sends is ever spliced into the file
//     as text, so there is no string a caller can send that becomes
//     code — which is the only property that makes an HTTP endpoint on
//     top of this defensible at all.
//   * It re-parses the result and refuses to save unless the file still
//     holds the same sixteen cars and the field now reads back as the
//     value asked for.
//
// It deliberately cannot add a car, delete one, reorder them, or add a
// field that was not already there. Those are changes with consequences
// across four ports and a save format, and they belong in a diff a
// person wrote.

import { readFileSync, writeFileSync } from "node:fs";

export const MODS = "src/game/mods.ts";

/** Fields this editor is allowed to touch, and what each one is.
 *
 *  Anything not named here is refused — including `id`, deliberately: an
 *  id is a foreign key. Saves reference it, the rivals reference it, the
 *  press images are named after it, and the ports index on it. Renaming
 *  one is a migration, not an edit. */
export const EDITABLE = {
  name: { kind: "string", max: 40 },
  ar: { kind: "string", max: 40 },
  desc: { kind: "string", max: 240 },
  price: { kind: "int", min: 0, max: 1_000_000 },
  power: { kind: "number", min: 0.1, max: 4 },
  topSpeedKmh: { kind: "int", min: 40, max: 500 },
  // 0-100 in seconds. The floor is 1.8 because nothing on four road
  // tyres has ever gone quicker and a smaller number would just be a
  // car the solver cannot build; the ceiling is a bus.
  zeroTo100s: { kind: "number", min: 1.8, max: 30 },
  grip: { kind: "number", min: 1, max: 40 },
  brake: { kind: "number", min: 1, max: 120 },
  tankLitres: { kind: "number", min: 1, max: 200 },
  lengthM: { kind: "number", min: 2.5, max: 7 },
  lockedRivals: { kind: "int", min: 0, max: 8 },
  cls: { kind: "enum", of: ["normal", "sport", "supercar"] },
  kit: { kind: "enum", of: ["street", "sport", "attack"] },
  drive: { kind: "enum", of: ["rwd", "fwd", "awd"] },
  style: { kind: "enum", of: ["sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super"] },
  finish: { kind: "enum", of: ["gloss", "satin", "matte"] },
  color: { kind: "hex" },
  accent: { kind: "hex" },
};

/**
 * Walk the source, calling `onCode` for every character that is actually
 * code — never one inside a string, a line comment or a block comment.
 *
 * This is not over-engineering, it is the first bug this file had. The
 * roster is thick with prose, and prose has apostrophes: "the car's own
 * length", "it doesn't". A scanner that treats `'` as a string opener
 * wherever it finds it swallows everything to the next apostrophe,
 * braces included, and the reader came back with three cars out of
 * sixteen. Comments have to be skipped as comments before quotes can be
 * treated as quotes.
 */
function scanCode(src, from, to, onCode) {
  for (let i = from; i < to; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) return;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) return;
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < to && src[i] !== q) i += src[i] === "\\" ? 2 : 1;
      continue;
    }
    if (onCode(c, i) === false) return;
  }
}

/** The CARS array's own span: everything between the `[` that opens it
 *  and the bracket that closes it, counted rather than matched, so a
 *  nested array inside a car does not end it early. */
function carsSpan(src) {
  const decl = src.indexOf("export const CARS");
  if (decl < 0) throw new Error(`${MODS} has no "export const CARS"`);
  // After the `=`, not after the name: the declaration is
  // `export const CARS: CarModel[] = [`, and the first bracket in that
  // is the one in the TYPE. Taking it found an empty array and reported
  // a roster of zero cars.
  const eq = src.indexOf("=", decl);
  const open = eq < 0 ? -1 : src.indexOf("[", eq);
  if (open < 0) throw new Error("the CARS declaration has no opening bracket");
  let depth = 0, close = -1;
  scanCode(src, open, src.length, (c, i) => {
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) { close = i; return false; }
    }
  });
  if (close < 0) throw new Error("the CARS array is not closed");
  return { from: open + 1, to: close };
}

/** Each car's own span inside the array, at brace depth 1. */
function carBlocks(src, span) {
  const out = [];
  let depth = 0, start = -1;
  scanCode(src, span.from, span.to, (c, i) => {
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0) out.push({ from: start, to: i + 1 }); }
  });
  return out;
}

/** One `key: value` inside a block, with the value's own span so a write
 *  can replace exactly that and nothing else. Only top-level fields of
 *  the car — a key nested inside `factory: { ... }` is not matched,
 *  because the search is anchored to a two-space indent. */
function fieldAt(src, block, key) {
  const body = src.slice(block.from, block.to);
  const re = new RegExp(`(\\n    ${key}:\\s*)([^\\n]*?)(,?)(?=\\s*(?://[^\\n]*)?\\n)`);
  const m = re.exec(body);
  if (!m) return null;
  const valueFrom = block.from + m.index + m[1].length;
  return { from: valueFrom, to: valueFrom + m[2].length, raw: m[2] };
}

/** A source literal as a JavaScript value. Only the shapes a car field
 *  actually uses; anything else comes back as the raw text so a reader
 *  can show it without this pretending to understand it. */
function literal(raw) {
  const t = raw.trim();
  if (/^0x[0-9a-fA-F]+$/.test(t)) return parseInt(t, 16);
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "true" || t === "false") return t === "true";
  if (/^"(?:[^"\\]|\\.)*"$/.test(t)) { try { return JSON.parse(t); } catch { return t; } }
  return t;
}

/** Every car, as {id, fields:{key:value}}, in roster order. */
export function readCars(path = MODS) {
  const src = readFileSync(path, "utf8");
  const span = carsSpan(src);
  return carBlocks(src, span).map((block) => {
    const body = src.slice(block.from, block.to);
    const fields = {};
    for (const m of body.matchAll(/\n    (\w+):\s*([^\n]*?),?(?=\s*(?:\/\/[^\n]*)?\n)/g)) {
      fields[m[1]] = literal(m[2]);
    }
    return { id: fields.id, fields };
  });
}

/** Serialise a validated value back to source, in the shape the file
 *  already uses for that field. Colours are hex because every one of
 *  them in this file is, and a colour written as 15922935 would be a
 *  correct number nobody could read. */
function serialise(spec, value) {
  if (spec.kind === "hex") return `0x${value.toString(16).padStart(6, "0")}`;
  if (spec.kind === "string" || spec.kind === "enum") return JSON.stringify(value);
  return String(value);
}

/** Check a value against its field's spec. Returns the value to write,
 *  or throws with a message meant to be shown to whoever typed it. */
export function validate(key, value) {
  const spec = EDITABLE[key];
  if (!spec) throw new Error(`"${key}" is not an editable field`);
  if (spec.kind === "enum") {
    if (!spec.of.includes(value)) throw new Error(`${key} must be one of ${spec.of.join(", ")}`);
    return value;
  }
  if (spec.kind === "string") {
    if (typeof value !== "string") throw new Error(`${key} must be text`);
    if (!value.trim()) throw new Error(`${key} cannot be empty`);
    if (value.length > spec.max) throw new Error(`${key} is longer than ${spec.max} characters`);
    // A newline would end the line the value sits on and put the rest of
    // the string where the file expects the next field.
    if (/[\n\r]/.test(value)) throw new Error(`${key} cannot contain a line break`);
    return value;
  }
  if (spec.kind === "hex") {
    const n = typeof value === "string" ? parseInt(value.replace(/^#|^0x/, ""), 16) : value;
    if (!Number.isInteger(n) || n < 0 || n > 0xffffff) throw new Error(`${key} must be a colour from 000000 to ffffff`);
    return n;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  if (spec.kind === "int" && !Number.isInteger(n)) throw new Error(`${key} must be a whole number`);
  if (n < spec.min || n > spec.max) throw new Error(`${key} must be between ${spec.min} and ${spec.max}`);
  return n;
}

/**
 * Change one field of one car, in place.
 *
 * `edits` is {key: value}. Every one is validated first, then all are
 * applied to the source in one pass, then the result is re-parsed and
 * checked before anything is written — so a file is never left in a
 * state where some of an edit landed.
 *
 * Returns {before, after, path} for the fields that changed. Fields the
 * car does not already have are reported as unknown rather than added:
 * a car without a `finish` is a car that takes the default, and adding
 * the key would be a different change from setting it.
 */
export function editCar(id, edits, { path = MODS, dryRun = false } = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(edits)) clean[k] = validate(k, v);

  const src = readFileSync(path, "utf8");
  const span = carsSpan(src);
  const blocks = carBlocks(src, span);
  const cars = readCars(path);
  const index = cars.findIndex((c) => c.id === id);
  if (index < 0) throw new Error(`no car with id "${id}"`);
  const block = blocks[index];

  // Collect the replacements first, then apply them back to front so
  // earlier offsets stay valid.
  const patches = [];
  const before = {}, after = {};
  for (const [k, v] of Object.entries(clean)) {
    const f = fieldAt(src, block, k);
    if (!f) throw new Error(`the ${id} has no "${k}" field to change`);
    const text = serialise(EDITABLE[k], v);
    if (f.raw.trim() === text) continue;
    before[k] = literal(f.raw);
    after[k] = v;
    patches.push({ ...f, text });
  }
  if (!patches.length) return { before, after, path, changed: false };

  patches.sort((a, b) => b.from - a.from);
  let out = src;
  for (const p of patches) out = out.slice(0, p.from) + p.text + out.slice(p.to);

  // Read the result back before trusting it. A writer that reports
  // success from the fact that it ran is a writer that will one day
  // corrupt this file quietly.
  const check = () => {
    const span2 = carsSpan(out);
    const blocks2 = carBlocks(out, span2);
    if (blocks2.length !== blocks.length) {
      throw new Error(`the edit changed the roster from ${blocks.length} cars to ${blocks2.length}`);
    }
    const body = out.slice(blocks2[index].from, blocks2[index].to);
    const fields = {};
    for (const m of body.matchAll(/\n    (\w+):\s*([^\n]*?),?(?=\s*(?:\/\/[^\n]*)?\n)/g)) {
      fields[m[1]] = literal(m[2]);
    }
    if (fields.id !== id) throw new Error(`the edit landed on "${fields.id}" instead of "${id}"`);
    for (const [k, v] of Object.entries(after)) {
      if (fields[k] !== v) throw new Error(`${k} read back as ${JSON.stringify(fields[k])}, not ${JSON.stringify(v)}`);
    }
  };
  check();

  if (!dryRun) writeFileSync(path, out);
  return { before, after, path, changed: true, source: dryRun ? out : undefined };
}
