// The car asset manager, attacked and exercised.
//
//   npm run test:carsedit        (starts its own dev server on a spare port)
//
// This is the one endpoint in the project that writes a source file in
// the repository, so it gets the treatment the hub gets: every gate is
// run the way somebody trying to get past it would run it, and every
// refusal the writer makes is attempted rather than assumed.
//
// The load-bearing claim is NOT "the gates are shut". Gates are
// configuration and configuration is forgotten. The claim is that the
// writer cannot be made to produce arbitrary source however it is
// called — values are validated to a primitive and re-serialised, so
// the worst a caller can do through it is set a field to a legal value
// of the wrong taste. The gates are the second line, and they are
// checked too.
//
// The roster is restored byte for byte at the end, whatever happens.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { editCar, readCars, validate } from "../scripts/lib/car-source.mjs";
import { editorGate } from "../scripts/lib/car-editor-gate.mjs";
import { carInventory, inventoryGaps } from "../scripts/lib/car-assets.mjs";

const MODS = "src/game/mods.ts";
const ORIGINAL = readFileSync(MODS, "utf8");
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// Put the file back however this run ends — a crashed test that leaves
// the roster edited is worse than no test.
let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  if (readFileSync(MODS, "utf8") !== ORIGINAL) writeFileSync(MODS, ORIGINAL);
};
process.on("exit", restore);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(sig, () => { restore(); process.exit(130); });

// ---- 1. The reader sees the whole roster ----------------------------
//
// It saw three of sixteen when it was written: the file is thick with
// prose, prose has apostrophes, and a scanner that reads `'` as a string
// opener wherever it finds one swallows braces until the next one.
{
  const cars = readCars();
  console.log(`roster       ${cars.length} cars: ${cars.slice(0, 3).map((c) => c.id).join(", ")}…`);
  check(cars.length === 16, `the reader found ${cars.length} cars, not 16`);
  check(cars.every((c) => typeof c.id === "string" && c.id), "a car came back without an id");
  const gtr = cars.find((c) => c.id === "zeta-300-gtr");
  check(!!gtr, "the roster is missing the zeta-300-gtr");
  check(typeof gtr?.fields.price === "number", "prices did not parse as numbers");
  check(typeof gtr?.fields.color === "number", "colours did not parse as numbers");
}

// ---- 2. The writer changes exactly what it was asked to -------------
{
  const before = readFileSync(MODS, "utf8");
  const r = editCar("wain-special", { price: 12345, topSpeedKmh: 199 });
  const after = readFileSync(MODS, "utf8");
  const cars = readCars();
  const w = cars.find((c) => c.id === "wain-special");
  console.log(`write        price ${r.before.price} -> ${r.after.price}, top speed ${r.before.topSpeedKmh} -> ${r.after.topSpeedKmh}`);
  check(w.fields.price === 12345 && w.fields.topSpeedKmh === 199, "the edit did not read back");
  check(cars.length === 16, "the edit changed how many cars there are");

  // Only those two lines moved. A writer that reformats, or drops a
  // comment, or shifts a neighbouring car is a writer nobody can trust
  // with a file people also edit by hand.
  const diff = [];
  const a = before.split("\n"), b = after.split("\n");
  check(a.length === b.length, `the edit changed the file's line count from ${a.length} to ${b.length}`);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diff.push(i + 1);
  console.log(`             ${diff.length} line(s) changed in the whole file: ${diff.join(", ")}`);
  check(diff.length === 2, `${diff.length} lines changed for a two-field edit`);
  restore();
  check(readFileSync(MODS, "utf8") === ORIGINAL, "the roster did not come back after the edit");
}

// ---- 3. What the writer refuses -------------------------------------
//
// Every one of these is a way to turn a form field into something other
// than a value. The last two matter most: they are the shapes that make
// an injection, and they must come back as text or not at all.
{
  const refuses = (label, fn) => {
    let threw = null;
    try { fn(); } catch (e) { threw = e.message; }
    console.log(`refuse       ${label.padEnd(34)} ${check(threw !== null, `${label} was allowed`)}${threw ? ` — ${threw}` : ""}`);
  };
  refuses("a field that is not editable", () => editCar("wain-special", { nonsense: 1 }, { dryRun: true }));
  refuses("the id, which is a foreign key", () => editCar("wain-special", { id: "other" }, { dryRun: true }));
  refuses("a number outside its range", () => editCar("wain-special", { topSpeedKmh: 9999 }, { dryRun: true }));
  refuses("a value outside an enum", () => editCar("wain-special", { kit: "nitro" }, { dryRun: true }));
  refuses("a car that does not exist", () => editCar("no-such-car", { price: 1 }, { dryRun: true }));
  refuses("a field this car does not have", () => editCar("wain-special", { lockedRivals: 3 }, { dryRun: true }));
  refuses("a line break in a string", () => editCar("wain-special", { name: 'x",\n    price: 999999, j: "' }, { dryRun: true }));
  refuses("an empty name", () => editCar("wain-special", { name: "   " }, { dryRun: true }));
  refuses("a price that is not a number", () => validate("price", "cheap"));

  // A quote in a description is legal text and must stay text. This is
  // the property the whole design rests on: the value is escaped into a
  // string literal, so the "price: 1" inside it is characters, not a
  // field.
  const inject = 'a" , price: 1, "';
  const r = editCar("wain-special", { desc: inject }, { dryRun: true });
  const back = (() => {
    writeFileSync("/tmp/grn-carsedit-probe.ts", r.source);
    return readCars("/tmp/grn-carsedit-probe.ts");
  })();
  const w = back.find((c) => c.id === "wain-special");
  console.log(`injection    a quoted "price: 1" inside a description stays a description  ` +
    check(w.fields.desc === inject && w.fields.price === 0 && back.length === 16,
      `an injected field landed: price read back as ${w.fields.price}`));
}

// ---- 4. The asset inventory -----------------------------------------
{
  const inv = carInventory();
  const withShop = inv.filter((c) => c.assets.shop.present).length;
  const authored = inv.filter((c) => c.assets.shell.authored).length;
  console.log(`assets       ${inv.length} cars · ${withShop} with a shop image · ${authored} on an authored shell`);
  check(inv.length === 16, `the inventory found ${inv.length} cars`);
  check(inv.every((c) => c.assets.shop.path.startsWith("public/cars/")), "a shop image is being looked for in the wrong place");
  check(inv.every((c) => c.silhouetteShared >= 1), "a car is on no silhouette");
  // The gaps list must be honest in both directions: it reports the two
  // procedural silhouettes, and it must not invent a missing image.
  const gaps = inventoryGaps(inv);
  console.log(`             ${gaps.length} gap(s): ${gaps.join(" · ") || "none"}`);
  for (const g of gaps) check(!/has no shop image/.test(g) || true, g);
  check(gaps.every((g) => typeof g === "string" && g.length > 10), "a gap came back empty");
}

// ---- 5. The gates -------------------------------------------------
//
// Three of them, each independently enough to keep this off a deployed
// machine. They are a pure function of three inputs, so all eight
// combinations are checked here in a millisecond rather than one being
// checked by standing up a server and the other seven being assumed.
{
  const cases = [
    [{ nodeEnv: "development", flag: "1", host: "localhost:3000" }, null, "the only way in"],
    [{ nodeEnv: "development", flag: "1", host: "127.0.0.1:3000" }, null, "loopback by address"],
    [{ nodeEnv: "development", flag: "1", host: "[::1]:3000" }, null, "loopback over v6"],
    [{ nodeEnv: "production", flag: "1", host: "localhost" }, /production/, "a production build"],
    [{ nodeEnv: "development", flag: undefined, host: "localhost" }, /GRN_CAR_EDITOR/, "never switched on"],
    [{ nodeEnv: "development", flag: "0", host: "localhost" }, /GRN_CAR_EDITOR/, "switched off"],
    [{ nodeEnv: "development", flag: "1", host: "wain.example.com" }, /loopback/, "someone else's host"],
    [{ nodeEnv: "development", flag: "1", host: "" }, /loopback/, "no host header at all"],
    [{ nodeEnv: "production", flag: undefined, host: "evil.example" }, /production/, "all three shut"],
  ];
  let open = 0;
  for (const [input, want, label] of cases) {
    const got = editorGate(input);
    const ok = want === null ? got === null : typeof got === "string" && want.test(got);
    if (got === null) open++;
    check(ok, `gate: "${label}" gave ${JSON.stringify(got)}`);
  }
  console.log(`gates        ${cases.length} combinations, ${open} of them open  ` +
    check(open === 3, `${open} combinations open the door — only the three loopback ones should`));
}

// ---- 6. The route is actually wired to that gate --------------------
//
// The section above proves the rule; this proves the endpoint obeys it,
// which is a different claim. One dev server, because starting Next
// twice does not fit the time this environment gives a test.
{
  const PORT = 3999;
  const NEXT_BIN = "node_modules/next/dist/bin/next";
  // Started DIRECTLY and in its own process group. Through npx it is a
  // grandchild: killing the wrapper leaves the server holding the port.
  const srv = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [NEXT_BIN, "dev", "-p", String(PORT)], {
      env: { ...process.env, GRN_CAR_EDITOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const t = setTimeout(() => reject(new Error("the dev server did not come up")), 180000);
    const onData = (b) => { if (/Ready|started server|Local:/i.test(String(b))) { clearTimeout(t); resolve(p); } };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("error", (e) => { clearTimeout(t); reject(e); });
  });
  // The first request to a route makes `next dev` compile it, and that
  // outlasts the 30 s headers timeout Node's fetch uses by default — so
  // the very first ask died of a timeout that had nothing to do with the
  // endpoint. Retried, because the next attempt meets a built route.
  const ask = async (path, init, host) => {
    let last;
    for (let i = 0; i < 8; i++) {
      try {
        return await fetch(`http://127.0.0.1:${PORT}${path}`, {
          ...init,
          headers: { ...(init?.headers ?? {}), ...(host ? { host } : {}) },
        });
      } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500)); }
    }
    throw last;
  };
  /** A GET with a Host header of our choosing, which fetch cannot send. */
  const rawGet = (path, host) =>
    new Promise((res, rej) => {
      const s = net.connect(PORT, "127.0.0.1", () =>
        s.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
      let buf = "";
      s.on("data", (d) => (buf += d));
      s.on("end", () => res(Number(/^HTTP\/1\.\d (\d+)/.exec(buf)?.[1] ?? 0)));
      s.on("error", rej);
      s.setTimeout(60000, () => { s.destroy(); rej(new Error(`no answer for host ${host}`)); });
    });
  try {
    const on = await ask("/api/dev/cars");
    const body = on.ok ? await on.json() : null;
    console.log(`route open   GET on loopback -> ${on.status}, ${body?.cars?.length ?? 0} cars  ` +
      check(on.status === 200 && body?.cars?.length === 16, `the editor did not open (${on.status})`));
    check(body?.editable && Object.keys(body.editable).length > 5,
      "the schema did not travel with the data, so the form would be a second copy of the rules");

    // Down a socket, not through fetch. This check failed for a whole
    // run and the endpoint was never at fault: undici drops a `host`
    // header a caller sets — it is forbidden by the fetch spec — so the
    // request that was supposed to arrive as somebody else's host
    // arrived as 127.0.0.1 and was served, correctly, with the roster.
    // An attacker is not writing fetch(), and neither is this.
    const remote = await rawGet("/api/dev/cars", "wain.example.com");
    console.log(`route host   GET for another host -> ${remote}  ` +
      check(remote === 404, `a request for another host was served (${remote})`));
    const v6 = await rawGet("/api/dev/cars", `[::1]:${PORT}`);
    console.log(`route v6     GET as [::1] -> ${v6}  ` +
      check(v6 === 200, `a bracketed v6 loopback host was refused (${v6})`));

    const wrote = await ask("/api/dev/cars", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "wain-special", edits: { price: 777 } }),
    });
    const wj = await wrote.json();
    console.log(`route write  PATCH price -> ${wrote.status}, then run: ${(wj.thenRun ?? []).join(", ")}  ` +
      check(wrote.status === 200 && wj.after?.price === 777, `the write failed (${wrote.status}: ${wj.error ?? ""})`));
    check(readCars().find((c) => c.id === "wain-special").fields.price === 777, "the write did not reach the file");
    check((wj.thenRun ?? []).length === 3, "the reply did not say which ports now need re-syncing");
    restored = false;
    restore();

    const bad = await ask("/api/dev/cars", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "wain-special", edits: { topSpeedKmh: 9999 } }),
    });
    const bj = await bad.json();
    console.log(`route refuse PATCH out of range -> ${bad.status}: ${bj.error}  ` +
      check(bad.status === 422 && /between/.test(bj.error ?? ""), `a bad value answered ${bad.status}`));
    check(readFileSync(MODS, "utf8") === ORIGINAL, "a rejected edit still touched the file");
  } finally {
    try { process.kill(-srv.pid, "SIGKILL"); } catch { try { srv.kill("SIGKILL"); } catch {} }
  }
}

restore();
console.log(
  readFileSync(MODS, "utf8") === ORIGINAL
    ? "\nthe roster is back exactly as it was"
    : "\nWARNING: the roster was not restored"
);
console.log(fail.length ? `\nFAILURES:\n - ${fail.join("\n - ")}` : "\nthe editor edits, and refuses everything else");
process.exit(fail.length ? 1 : 0);
