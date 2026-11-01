#!/usr/bin/env node
/**
 * The customer's tracking token, and the attempt that carries it:
 *   node tests/tracking-token.test.mjs
 *
 * The token is the only proof a customer holds of an order or a queue ticket,
 * so it comes from the browser's random source or not at all. Math.random was
 * the fallback for a browser without one, and it is not built to resist
 * prediction. These checks take the random source away and hold three things:
 * the constructors a panel calls while it renders never throw, no token is
 * made for an attempt that cannot have one, and nothing reaches the network or
 * the device's memory for it. Math.random is never used for a token or an id.
 * The retry backoff in net.ts still uses it for jitter, which is not a credential.
 *
 * Bundled with the local esbuild, the way tests/agent-job.test.mjs does it.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The back end's switch is read when the bundle loads. Unset means on. A shell
// that exported "none" would turn every send into the disabled path, and the
// refusals below would then pass for the wrong reason.
delete process.env.NEXT_PUBLIC_WAIN_BACKEND;

const tmp = mkdtempSync(join(tmpdir(), "wain-tracking-token-"));
const entry = join(tmp, "entry.ts");
writeFileSync(
  entry,
  `export * as orders from ${JSON.stringify(join(ROOT, "src/lib/orders.ts"))};\n` +
    `export * as queue from ${JSON.stringify(join(ROOT, "src/lib/queue.ts"))};\n` +
    `export * as backend from ${JSON.stringify(join(ROOT, "src/lib/backend.ts"))};\n`
);
const bundle = join(tmp, "entry.mjs");
execFileSync(
  join(ROOT, "node_modules/.bin/esbuild"),
  [entry, "--bundle", "--format=esm", `--alias:@=${join(ROOT, "src")}`, `--outfile=${bundle}`, "--log-level=error"],
  { cwd: ROOT, stdio: "pipe" }
);
const { orders: O, queue: Q, backend: B } = await import(pathToFileURL(bundle).href);
rmSync(tmp, { recursive: true, force: true });

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); }
};

const HEX32 = /^[0-9a-f]{32}$/;
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ARABIC = /[؀-ۿ]/;

/** Replace a global, and put back exactly what was there — including nothing. */
function swapGlobal(name, value) {
  const had = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true, enumerable: false });
  return () => {
    if (had) Object.defineProperty(globalThis, name, had);
    else delete globalThis[name];
  };
}

/** Math.random, counted. The original is called through, so values still flow. */
function countRandom() {
  const real = Math.random;
  const spy = { calls: 0, restore: () => { Math.random = real; } };
  Math.random = () => { spy.calls++; return real(); };
  return spy;
}

/** fetch, recorded. The reply is shaped so both the order and the queue read it as a success. */
function recordFetch() {
  const seen = [];
  const restore = swapGlobal("fetch", async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify({ ok: true, again: false, number: 1, day: "2026-11-01" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { seen, restore };
}

/** localStorage as a Map, so «nothing was remembered» can be read back. */
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: () => null,
    get length() { return m.size; },
  };
}

const order = {
  placeSlug: "deera-cafe",
  placeNameAr: "مقهى الديرة",
  lines: [{ id: "a", nameAr: "كرك", priceFils: 250, qty: 2 }],
  pickupAt: "18:30",
  customerName: "سالم",
  customerPhone: "51234567",
  noteAr: "",
};
const ticketInput = {
  placeSlug: "deera-salon",
  placeNameAr: "صالون الديرة",
  salonKind: "men",
  customerName: "سالم",
  customerPhone: "51234567",
};

console.log("\n── with a random source, the tokens look like tokens ──");
{
  const r = countRandom();
  try {
    const a = O.newTrackToken();
    const b = O.newTrackToken();
    ok("an order token is 32 hex characters", HEX32.test(a), a);
    ok("two order tokens differ", a !== b);
    const attempt = O.newOrderAttempt();
    ok("an order attempt has an id in UUID version-4 form", UUID4.test(attempt.id), attempt.id);
    ok("and a 32-character token", HEX32.test(attempt.token), attempt.token);
    const q = Q.newQueueAttempt();
    ok("a queue attempt has an id in UUID version-4 form", UUID4.test(q.id), q.id);
    ok("and a 32-character token", HEX32.test(q.token), q.token);
    ok("no Math.random on this path", r.calls === 0, `${r.calls} call(s)`);
  } finally {
    r.restore();
  }
}

console.log("\n── an older browser: getRandomValues, no randomUUID ──");
{
  const restoreCrypto = swapGlobal("crypto", { getRandomValues: (a) => webcrypto.getRandomValues(a) });
  const r = countRandom();
  try {
    const id = O.newOrderId();
    ok("the order id is still a version-4 UUID", UUID4.test(id), id);
    const qid = Q.newQueueAttempt().id;
    ok("and the queue's id is too", UUID4.test(qid), qid);
    ok("Math.random builds neither id", r.calls === 0, `${r.calls} call(s)`);
  } catch (err) {
    ok("the older-browser path runs to the end", false, String(err));
  } finally {
    r.restore();
    restoreCrypto();
  }
}

console.log("\n── a browser with no random source makes no token and sends nothing ──");
{
  const restoreCrypto = swapGlobal("crypto", undefined);
  const restoreStore = swapGlobal("localStorage", memoryStorage());
  const opened = [];
  const restoreWindow = swapGlobal("window", {
    location: { origin: "https://www.wainkw.com" },
    open: (...args) => { opened.push(args); return null; },
  });
  const net = recordFetch();
  const r = countRandom();
  try {
    ok("the back end is on, so the refusals below come from the attempt and not the switch", B.backendEnabled === true);

    // The panels call these while they render. A throw here is a crashed panel.
    let threw = null;
    let attempt = null;
    try { attempt = O.newOrderAttempt(); } catch (err) { threw = err; }
    ok("minting an order attempt does not throw", threw === null, String(threw));
    ok("the order attempt has no token", attempt !== null && attempt.token === "", JSON.stringify(attempt));
    ok("and no id", attempt !== null && attempt.id === "", JSON.stringify(attempt));

    let tokenError = null;
    try { O.newTrackToken(); } catch (err) { tokenError = err; }
    ok("the token function throws a named error", tokenError !== null && tokenError.name === "no_crypto",
      tokenError === null ? "returned a value" : `name=${tokenError.name}`);

    const placed = await O.submitOrder(order, attempt);
    // The reason is checked as well as ok: a validation failure is also ok:false,
    // and would pass these lines for the wrong cause.
    ok("submitOrder refuses an attempt with no token, as unsupported",
      placed.ok === false && placed.reason === "unsupported", JSON.stringify(placed).slice(0, 160));
    ok("and says so in Arabic, the way a failed save does",
      placed.ok === false && ARABIC.test(placed.message), placed.message);

    const byDefault = await O.submitOrder(order);
    ok("called without an attempt, it refuses the same way",
      byDefault.ok === false && byDefault.reason === "unsupported", JSON.stringify(byDefault).slice(0, 160));

    const wa = O.sendWhatsAppOrder(order, "96565551234", attempt ?? { id: "", token: "" },
      "https://www.wainkw.com/places/deera-cafe/");
    ok("the WhatsApp order is refused too, because its reference comes from the id",
      wa.ok === false && wa.reason === "unsupported", JSON.stringify(wa).slice(0, 160));
    ok("and opens no WhatsApp window", opened.length === 0, JSON.stringify(opened).slice(0, 160));

    let qAttempt = null;
    let qThrew = null;
    try { qAttempt = Q.newQueueAttempt(); } catch (err) { qThrew = err; }
    ok("minting a queue attempt does not throw", qThrew === null, String(qThrew));
    ok("the queue attempt has no token and no id", qAttempt !== null && qAttempt.token === "" && qAttempt.id === "",
      JSON.stringify(qAttempt));
    const took = await Q.joinQueue(ticketInput, qAttempt ?? { id: "", token: "" });
    ok("joinQueue refuses a ticket with no token, as unsupported",
      took.ok === false && took.reason === "unsupported", JSON.stringify(took).slice(0, 160));
    ok("and says so in Arabic", took.ok === false && ARABIC.test(took.message), took.message);

    ok("nothing is remembered as an order", O.listOrders().length === 0, JSON.stringify(O.listOrders()).slice(0, 160));
    ok("nothing is remembered as a ticket", Q.listTickets().length === 0, JSON.stringify(Q.listTickets()).slice(0, 160));
    ok("the network is never called", net.seen.length === 0, net.seen.join(" , "));
    ok("Math.random is never reached", r.calls === 0, `${r.calls} call(s)`);
  } catch (err) {
    ok("the no-random-source section runs to the end", false, String(err));
  } finally {
    r.restore();
    net.restore();
    restoreWindow();
    restoreStore();
    restoreCrypto();
  }
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
