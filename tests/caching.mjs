// Storage, caching and DNS — the three things that decide whether the
// game is fast on a second visit and whether it remembers anything.
//
//   npm run test:caching      (no browser, no dev server)
//
// All three were measured before they were changed, and the numbers are
// in the assertions rather than in a commit message nobody re-reads.

import { readFileSync } from "node:fs";
import { hubHintOrigin } from "../src/game/net.ts";
import { fingerprint } from "../src/game/models.ts";
import { GRN_CACHE_CONTROL } from "../src/game/api.ts";
import {
  readJSON, writeJSON, storageHealth, onStorageTrouble, __resetStorageHealth,
} from "../src/game/storage.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };

// --- 1. public/ is no longer revalidated on every load ---------------
// Next serves public/ with `Cache-Control: public, max-age=0` and there
// was no override, so 11 MB of car geometry — 2.8 MB a model, four of
// them — was re-checked with the server on every single page load before
// the game could swap in one piece of geometry.
{
  const cfg = readFileSync("next.config.ts", "utf8");
  check(/headers/.test(cfg), "next.config.ts must set headers for public/");
  check(/max-age=31536000, immutable/.test(cfg), "the .glb models must be cached immutably");
  check(/\/models\/build\.json[\s\S]{0,200}no-cache/.test(cfg),
    "build.json is the index that busts the models — it must never be held");
  check(/stale-while-revalidate/.test(cfg), "unversioned assets need a non-blocking refresh");
  // The one that makes immutability safe. Caching car-gtr.glb for a year
  // under a stable filename serves last month's geometry forever.
  check(/isExport/.test(cfg) && /output: "export"/.test(cfg),
    "the static export must not claim headers it cannot send");
  console.log("public/: models immutable, manifest no-cache, the rest a day with SWR");
}

// --- 2. ...because the model URLs are content-addressed --------------
{
  const src = readFileSync("src/game/models.ts", "utf8");
  check(/\?v=\$\{v\}/.test(src), "the .glb URL must carry the build fingerprint");
  const a = fingerprint('{"assets":{"car-gtr":{"tris":156472}}}');
  const b = fingerprint('{"assets":{"car-gtr":{"tris":156473}}}');
  check(a !== b, "one triangle of difference must change the fingerprint");
  check(fingerprint("x") === fingerprint("x"), "the fingerprint must be stable");
  check(a.length > 0 && !/[^a-z0-9]/.test(a), `the fingerprint must be URL-safe, got "${a}"`);
  // A manifest that cannot be read must fall back to the bare path, not
  // to the string "undefined".
  check(/v \? `\?v=\$\{v\}` : ""/.test(src),
    "an unreadable manifest must request the bare path, as it always did");
  console.log(`model URLs are content-addressed: one triangle moves ${a} -> ${b}`);
}

// --- 3. Every API route sends one header, from one place -------------
// Five routes each carried the same string typed out separately, which
// is how four agree and the fifth quietly does not.
{
  check(/stale-while-revalidate=86400/.test(GRN_CACHE_CONTROL),
    "build-static data should refresh behind the player, not in front");
  const routes = ["cars", "gamedata", "manifest", "rivals", "track"];
  for (const r of routes) {
    const src = readFileSync(`src/app/api/grn/v1/${r}/route.ts`, "utf8");
    check(src.includes("GRN_CACHE_CONTROL"), `${r} must use the shared cache header`);
    check(!/max-age=\d+/.test(src), `${r} still has a cache header typed into it`);
    check(/force-static/.test(src), `${r} must stay statically generated`);
  }
  console.log(`all ${routes.length} v1 routes send one shared header: ${GRN_CACHE_CONTROL}`);
}

// --- 4. DNS hints point at the hub, and only when worth it -----------
{
  check(hubHintOrigin("ws://localhost:8787") === null, "localhost needs no lookup");
  check(hubHintOrigin("ws://127.0.0.1:8787") === null, "loopback needs no lookup");
  check(hubHintOrigin("ws://hub.local:8787") === null, ".local is resolved by mDNS");
  check(hubHintOrigin("wss://hub.example.com") === "https://hub.example.com",
    "a wss hub must hint at its https origin");
  check(hubHintOrigin("ws://hub.example.com:8787") === "http://hub.example.com:8787",
    "the port is part of the origin");
  check(hubHintOrigin("not a url") === null, "an unparseable hub must not emit a malformed link");
  check(hubHintOrigin("https://hub.example.com") === null, "only ws/wss are hub URLs");
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  check(/rel="dns-prefetch"/.test(layout) && /rel="preconnect"/.test(layout),
    "the layout must emit both hints");
  check(/hubOrigin &&/.test(layout), "no hints when there is nothing to resolve");
  // The fonts are self-hosted by next/font, so a hint for them would be
  // markup for a request that never happens.
  // Matched on an actual href, not on prose: the comment above those
  // links explains why the fonts need no hint, and an earlier version of
  // this check failed on its own explanation.
  check(!/href="https:\/\/fonts\.(gstatic|googleapis)/.test(layout),
    "next/font self-hosts: a <link> to Google Fonts would warm a connection nothing makes");
  console.log("hub hints emitted for a remote hub, suppressed for localhost and loopback");
}

// --- 5. Storage failure is observable ---------------------------------
// The defect this replaces: every save was `try { setItem } catch {}`, so
// a player in a private window earned KD, bought parts and beat rivals
// for an hour with every write failing and nothing anywhere saying so.
{
  __resetStorageHealth();
  const store = new Map();
  let mode = "ok";
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (mode === "throw") throw new Error("denied");
      if (mode === "quota") { const e = new Error("full"); e.name = "QuotaExceededError"; throw e; }
      if (mode === "silent") return; // accepted and discarded
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k),
  };

  check(storageHealth() === "ok", "a working store must probe ok");
  check(writeJSON("k", { a: 1 }) === true, "a good write must report success");
  check(readJSON("k", null).a === 1, "what was written must read back");
  check(readJSON("missing", "fb") === "fb", "a missing key falls back");
  store.set("bad", "{not json");
  check(readJSON("bad", "fb") === "fb", "corrupt JSON falls back rather than throwing");
  // An array is a real stored shape in this game — community.ts keeps
  // the paid-referral list as one — so readJSON must hand it back rather
  // than deciding on the caller's behalf that it is corrupt.
  store.set("arr", "[1,2]");
  check(Array.isArray(readJSON("arr", "fb")), "a stored array must read back as an array");
  store.set("num", "42");
  check(readJSON("num", "fb") === "fb", "a bare number is not a shape any caller here stores");

  // The probe must catch a store that accepts writes and discards them —
  // setItem alone reports success there.
  __resetStorageHealth(); mode = "silent";
  check(storageHealth() === "unavailable",
    "a store that accepts writes and drops them must not read as ok");

  __resetStorageHealth(); mode = "quota";
  check(storageHealth() === "full", "a quota error must be told apart from a refusal");

  __resetStorageHealth(); mode = "ok";
  check(storageHealth() === "ok", "back to a working store");
  let told = null, calls = 0;
  onStorageTrouble((h) => { told = h; calls++; });
  mode = "throw";
  check(writeJSON("k", { a: 2 }) === false, "a failed write must report failure");
  check(told === "unavailable", `the listener must be told what went wrong, got ${told}`);
  check(writeJSON("k", { a: 3 }) === false, "a second failure still reports false");
  check(calls === 1, `the player is told once, not once per save (told ${calls}x)`);

  delete globalThis.localStorage;
  console.log("storage: probe catches silent discards, quota is told apart, the player is warned once");
}

// --- 6. The saves that are the player's progress go through it -------
{
  for (const [f, what] of [
    ["src/game/mods.ts", "the garage — KD, cars, parts, fuel"],
    ["src/game/profile.ts", "the profile"],
    ["src/game/settings.ts", "the settings"],
  ]) {
    const src = readFileSync(f, "utf8");
    check(/writeJSON\(/.test(src), `${what} must save through storage.ts`);
    check(!/localStorage\.setItem\([A-Z_]*KEY, JSON\.stringify/.test(src),
      `${what} still writes straight to localStorage, so a failure is silent again`);
  }
  const client = readFileSync("src/app/race/RaceClient.tsx", "utf8");
  check(/onStorageTrouble/.test(client) && /storageHealth\(\)/.test(client),
    "the race has to surface it, or nothing is observable after all");
  console.log("garage, profile and settings all report a failed save; the race surfaces it");
}

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nall green");
process.exit(fail.length ? 1 : 0);
