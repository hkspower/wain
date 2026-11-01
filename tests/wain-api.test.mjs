#!/usr/bin/env node
/**
 * scripts/publish/wain-api.php, against a real PHP server on SQLite:
 *   npm run test:wain-api
 *
 * This is the back end the site runs on now, so every rule the Postgres schema
 * used to enforce has to be proved here on the engine that replaced it — not
 * read off the source. Every negative is a request that must be refused with
 * the named error, every write is read back, and the things a token protects
 * (an order, a ticket) are asked for with the wrong token to prove the answer
 * is silence rather than «no such order».
 *
 * MySQL is not here — the sandbox has no server — so the dialect subset is
 * proved by `php wain.php selftest` on the account's own database, and only
 * there. What this file proves is the SQLite half and every line of PHP above
 * the driver.
 */
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync,
  statSync, utimesSync, chmodSync,
} from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 4219;
const ORIGIN = "https://www.wainkw.com";
const SECRET = "test-admin-secret-" + "x".repeat(24);

const dir = mkdtempSync(join(tmpdir(), "wain-api-"));
const web = join(dir, "public_html");
const api = join(web, "api");
const storage = join(dir, "storage");
mkdirSync(api, { recursive: true });
mkdirSync(join(web, "data"), { recursive: true });
mkdirSync(storage, { recursive: true });
const PHP_FILE = join(api, "wain.php");
writeFileSync(PHP_FILE, readFileSync(new URL("../scripts/publish/wain-api.php", import.meta.url)));

/* Three places in placeToRow() shape — what `data/places.json` carries. One
   takes orders and queue, one is published and takes neither, one is not
   published at all. */
const basePlace = (over) => ({
  slug: "x", name: "X", name_ar: "إكس", category: "coffee", area: "Kuwait City", area_ar: "مدينة الكويت",
  lat: 29.37, lng: 47.97, rating: 4.4, price_level: 2, emoji: "☕", tagline_ar: "شاي وقهوة",
  description_ar: "وصف قصير.", highlights_ar: ["شاي"], best_time_ar: "عقب المغرب", setting: "mixed",
  season_ar: "", tags_ar: ["هدوء"], logo_url: null, bio_ar: "", image_urls: [], phone: "", instagram: "",
  website: "", products_ar: [], menu_ar: [], accepts_orders: false, order_note_ar: "", order_prep_minutes: 30,
  order_whatsapp: "", salon_kind: "", takes_queue: false, queue_service_minutes: 20, featured: false,
  published: true, sort_order: 0, ...over,
});
const SEED = [
  basePlace({
    slug: "tea-house", name: "Tea House", name_ar: "بيت الشاي", sort_order: 1,
    menu_ar: [{ id: "m1", nameAr: "چاي كرك", priceFils: 250 }, { id: "m2", nameAr: "قهوة", priceFils: 500, soldOut: true }],
    accepts_orders: true, order_prep_minutes: 15, order_whatsapp: "51234567",
    salon_kind: "men", takes_queue: true, queue_service_minutes: 10,
  }),
  basePlace({ slug: "quiet-cafe", name: "Quiet Cafe", name_ar: "كافيه هادي", sort_order: 2, rating: null }),
  basePlace({ slug: "hidden-one", name: "Hidden", name_ar: "مخفي", sort_order: 3, published: false }),
];
writeFileSync(join(web, "data", "places.json"), JSON.stringify(SEED));

/* Raised for the suite (Apache never sets the seam): the sections above the
   cap test make ~60 public writes, and the cap has to stay above them so that
   the last section is the only one that meets it. */
const WRITES_PER_MIN = 100;
const php = spawn("php", ["-S", `127.0.0.1:${PORT}`, "-t", web], {
  stdio: "ignore",
  env: { ...process.env, WAIN_API_WRITES_PER_MIN: String(WRITES_PER_MIN), WAIN_API_RATE_PER_MIN: "5000",
         // The order email is written here instead of sent (a test seam).
         WAIN_API_MAIL_DIR: join(dir, "mail") },
});
await new Promise((r) => setTimeout(r, 700));

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); }
};
const j = (x) => JSON.stringify(x);

const BASE = `http://127.0.0.1:${PORT}/api/wain.php`;

async function call(action, body = undefined, { admin = false, method, origin = ORIGIN, raw, token, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (origin) headers.Origin = origin;
  if (admin) headers["X-Wain-Admin"] = token ?? SECRET;
  let url = `${BASE}?a=${action}`;
  let m = method ?? (body === undefined ? "GET" : "POST");
  let payload;
  if (raw !== undefined) { m = "POST"; payload = raw; headers["Content-Type"] = "application/json"; }
  else if (m === "GET" && body) url += "&" + new URLSearchParams(body).toString();
  else if (body !== undefined) { payload = JSON.stringify(body); headers["Content-Type"] = "application/json"; }
  const res = await fetch(url, { method: m, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON: the host's own page */ }
  return { status: res.status, json, text, headers: res.headers };
}

const cli = (...args) =>
  JSON.parse(execFileSync("php", [PHP_FILE, ...args], { encoding: "utf8", env: { ...process.env, HOME: dir } }));

const uuid = () => crypto.randomUUID();
const tok = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

const order = (over = {}) => ({
  id: uuid(), track_token: tok(), place_slug: "tea-house", place_name_ar: "بيت الشاي",
  lines: [{ id: "m1", nameAr: "چاي كرك", priceFils: 250, qty: 2 }], total_fils: 500, pickup_at: "18:30",
  customer_name: "سالم", customer_phone: "51234567", note_ar: "", ...over,
});
const ticket = (over = {}) => ({
  id: uuid(), track_token: tok(), place_slug: "tea-house", place_name_ar: "بيت الشاي",
  customer_name: "زبون", customer_phone: "", source: "online", ...over,
});
const submission = (over = {}) => ({
  name: "New Shop", name_ar: "محل جديد", category: "shopping", area_ar: "السالمية", address_ar: "شارع سالم المبارك",
  lat: 29.33, lng: 48.07, price_level: 2, tagline_ar: "محل للهدايا", description_ar: "", phone: "", instagram: "",
  website: "", contact_name: "مالك", contact_email: "owner@example.com", contact_phone: "", logo_path: null,
  image_paths: [], bio_ar: "", products_ar: ["هدايا"], ...over,
});

try {
  console.log("\n── install-time CLI: migrate, seed, version ──");
  {
    const m = cli("migrate");
    ok("migrate creates the seven tables on SQLite", m.ok && m.engine === "sqlite" && m.tables.length === 7, j(m));
    ok("the database file is 0600", (await import("node:fs")).statSync(join(storage, "wain.sqlite")).mode.toString(8).endsWith("600"));
    const s1 = cli("seed");
    ok("seed inserts the three rows of data/places.json", s1.ok && s1.inserted === 3 && s1.skipped === 0 && s1.total === 3, j(s1));
    const s2 = cli("seed");
    ok("a second seed inserts nothing — it never overwrites a live edit", s2.ok && s2.inserted === 0 && s2.skipped === 3, j(s2));
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify([basePlace({ slug: "Bad Slug" })]));
    const s3 = cli("seed", bad);
    ok("a row the schema would refuse is reported, not inserted", s3.ok && s3.inserted === 0 && s3.refused.length === 1 && s3.refused[0].field === "slug", j(s3));
    const v = cli("version");
    ok("version reports the engine, the empty secret and the stage", v.engine.driver === "sqlite" && v.adminSecret === "ABSENT" && v.stage === "production", j(v));
  }

  console.log("\n── what it refuses before touching a table ──");
  {
    const u = await call("nope", {});
    ok("an unknown action is 400", u.status === 400 && u.json?.error === "unknown_action", j(u.json));
    const g = await call("order_place", undefined, { method: "GET" });
    ok("GET on a write is 405", g.status === 405 && g.json?.error === "method_not_allowed", String(g.status));
    const evil = await call("ping", undefined, { origin: "https://evil.example" });
    ok("an origin outside the allowlist is 403", evil.status === 403 && evil.json?.error === "origin_not_allowed", j(evil.json));
    const noOrigin = await call("ping", undefined, { origin: "" });
    ok("no Origin at all is allowed, as on the other bridges", noOrigin.status === 200, j(noOrigin.json));
    const self = await call("order_cancel", { id: uuid(), token: tok() }, { origin: `http://127.0.0.1:${PORT}` });
    ok("the page's own host is allowed whatever it is — a same-origin POST always carries one", self.status === 200, j(self.json));
    const opts = await fetch(`${BASE}?a=ping`, { method: "OPTIONS", headers: { Origin: ORIGIN } });
    ok("OPTIONS preflight is 204 with the admin header allowed", opts.status === 204 && /X-Wain-Admin/.test(opts.headers.get("access-control-allow-headers") ?? ""));
    const badJson = await call("order_place", undefined, { raw: "{not json" });
    ok("a body that is not JSON is 400 bad_json", badJson.status === 400 && badJson.json?.error === "bad_json", j(badJson.json));
    const big = await call("order_place", undefined, { raw: JSON.stringify({ pad: "x".repeat(70000) }) });
    ok("a body over 64K is 413", big.status === 413 && big.json?.error === "body_too_large", String(big.status));
    const p = await call("ping");
    ok("ping says which stage and engine, and that admin is unset", p.json?.ok && p.json.stage === "production" && p.json.engine === "sqlite" && p.json.admin === "unset", j(p.json));
    ok("every JSON answer is no-store", p.headers.get("cache-control") === "no-store");
  }

  console.log("\n── admin fails closed until the secret is pasted ──");
  {
    const a = await call("whoami", undefined, { admin: true });
    ok("with no secret on disk an admin header is 503 admin_unset", a.status === 503 && a.json?.error === "admin_unset", j(a.json));
    const b = await call("orders_list");
    ok("an admin action with no header is 503 admin_unset too — not 403, so the board can say what is missing", b.status === 503 && b.json?.error === "admin_unset", j(b.json));
    writeFileSync(join(storage, "admin.secret"), "");
    const c = await call("whoami", undefined, { admin: true });
    ok("an EMPTY secret file is still unset — trim(), not is_file", c.status === 503, String(c.status));
    // A short secret is refused even with the matching token: `1234` was
    // accepted before (the 14 October login scan, finding 2).
    writeFileSync(join(storage, "admin.secret"), "1234\n");
    const weak = await call("whoami", undefined, { admin: true, token: "1234" });
    ok("a four-character secret refuses even its own token: 503 admin_weak", weak.status === 503 && weak.json?.error === "admin_weak", j(weak.json));
    const weakPing = await call("ping");
    ok("ping says the secret is weak, so the board can say why", weakPing.json?.admin === "weak", j(weakPing.json));
    const weakNoHeader = await call("orders_list");
    ok("an admin action with no header is 503 admin_weak too", weakNoHeader.status === 503 && weakNoHeader.json?.error === "admin_weak", j(weakNoHeader.json));
    writeFileSync(join(storage, "admin.secret"), "y".repeat(31));
    const short = await call("whoami", undefined, { admin: true, token: "y".repeat(31) });
    ok("31 characters is still weak", short.status === 503 && short.json?.error === "admin_weak", j(short.json));
    writeFileSync(join(storage, "admin.secret"), "y".repeat(32));
    const edge = await call("whoami", undefined, { admin: true, token: "y".repeat(32) });
    ok("32 characters is the floor and is accepted", edge.status === 200 && edge.json?.admin === true, j(edge.json));
    writeFileSync(join(storage, "admin.secret"), SECRET + "\n");
    const t0 = Date.now();
    const wrong = await call("whoami", undefined, { admin: true, token: "guess" });
    ok("a wrong token is 403 admin_forbidden", wrong.status === 403 && wrong.json?.error === "admin_forbidden", j(wrong.json));
    ok("and it cost at least a quarter second", Date.now() - t0 >= 240, `${Date.now() - t0}ms`);
    const noHeader = await call("orders_list");
    ok("an admin action without the header is 403 admin_required once the secret exists", noHeader.status === 403 && noHeader.json?.error === "admin_required", j(noHeader.json));
    const right = await call("whoami", undefined, { admin: true });
    ok("the right token (the file's trimmed content) is admin", right.status === 200 && right.json?.admin === true, j(right.json));
  }

  console.log("\n── places: the public read, in PlaceRow shape ──");
  {
    const r = await call("places");
    const rows = r.json?.places ?? [];
    ok("published rows only, in sort order", rows.length === 2 && rows[0].slug === "tea-house" && rows[1].slug === "quiet-cafe", j(rows.map((x) => x.slug)));
    const tea = rows[0];
    ok("booleans are booleans, not 0/1", tea.accepts_orders === true && tea.takes_queue === true && tea.featured === false && tea.published === true);
    ok("JSON columns come back as arrays", Array.isArray(tea.menu_ar) && tea.menu_ar[1].soldOut === true && Array.isArray(tea.highlights_ar) && tea.highlights_ar[0] === "شاي");
    ok("numbers are numbers, and a missing rating is null", typeof tea.lat === "number" && tea.price_level === 2 && tea.rating === 4.4 && rows[1].rating === null);
    ok("every row carries an id", typeof tea.id === "string" && /^[0-9a-f-]{36}$/.test(tea.id));
    const all = await call("places_all", undefined, { admin: true });
    ok("places_all includes the unpublished row", all.json?.places?.length === 3 && all.json.places.some((p) => p.slug === "hidden-one"));
  }

  console.log("\n── the shop hears about an order by email (7 October) ──");
  {
    const mailDir = join(dir, "mail");
    const mails = () => (existsSync(mailDir) ? readdirSync(mailDir).map((f) => JSON.parse(readFileSync(join(mailDir, f), "utf8"))) : []);
    const none = await call("order_place", order());
    ok("a shop with no address on file gets nothing, and the order still goes", none.status === 200 && mails().length === 0, j(none.json));
    const bad = cli("order-email", "tea-house", "not-an-email");
    ok("order-email refuses a malformed address", bad.ok === false && bad.error === "bad_email", j(bad));
    const ghost = cli("order-email", "no-such-place", "shop@example.com");
    ok("…and a slug that is not a place", ghost.ok === false && ghost.error === "no_such_place", j(ghost));
    const set = cli("order-email", "tea-house", "shop@example.com");
    ok("order-email sets the shop's address", set.ok === true && set.order_email === "shop@example.com", j(set));
    const o = order({ note_ar: "بدون سكر", total_fils: 500 });
    await call("order_place", o);
    const [m] = mails();
    ok("the order sends one email, to the shop", mails().length === 1 && m.to === "shop@example.com", j(mails()));
    const ref = o.id.replace(/-/g, "").slice(0, 6).toUpperCase();
    ok("the subject carries the order's reference", m?.subject.includes(ref), m?.subject);
    ok("the body has the line, the total, the time, the name, the phone and the note, in the site's formats",
      m?.body.includes("٢× چاي كرك — ٠٫٥٠٠ د.ك") && m.body.includes("المجموع التقريبي: ٠٫٥٠٠ د.ك") &&
      m.body.includes("الساعة ٦:٣٠ م") && m.body.includes("الاسم: سالم") && m.body.includes("51234567") && m.body.includes("ملاحظة: بدون سكر"), m?.body);
    await call("order_place", o);
    ok("a retry that meets its own order sends nothing more", mails().length === 1, String(mails().length));
    const places = (await call("places")).json.places;
    ok("the address is in no public answer", !JSON.stringify(places).includes("shop@example.com"));
    const cleared = cli("order-email", "tea-house", "none");
    ok("«none» clears it", cleared.ok === true && cleared.order_email === null, j(cleared));
    await call("order_place", order());
    ok("…and the next order sends nothing", mails().length === 1, String(mails().length));
  }

  console.log("\n── sync-orders: a menu sent later reaches rows that already exist (7 October) ──");
  {
    const file = join(dir, "later.json");
    const later = SEED.map((p) => (p.slug === "quiet-cafe"
      ? { ...p, accepts_orders: true, menu_ar: [{ id: "m1", nameAr: "لاتيه", priceFils: 1250 }], order_whatsapp: "61234567" }
      : p));
    writeFileSync(file, JSON.stringify(later));
    const before = await call("order_place", order({ place_slug: "quiet-cafe", place_name_ar: "كافيه هادي",
      lines: [{ id: "m1", nameAr: "لاتيه", priceFils: 1250, qty: 1 }], total_fils: 1250 }));
    ok("before the sync the server refuses it: seed never overwrites", before.status === 409 && before.json?.error === "closed", j(before.json));
    const sync = cli("sync-orders", file);
    ok("sync-orders updates exactly the row whose ordering changed", sync.ok === true && j(sync.updated) === j(["quiet-cafe"]), j(sync));
    const after = await call("order_place", order({ place_slug: "quiet-cafe", place_name_ar: "كافيه هادي",
      lines: [{ id: "m1", nameAr: "لاتيه", priceFils: 1250, qty: 1 }], total_fils: 1250 }));
    ok("…and the order goes", after.status === 200 && after.json?.status === "placed", j(after.json));
    const again = cli("sync-orders", file);
    ok("a second sync changes nothing", again.ok === true && again.updated.length === 0, j(again));
    const tagline = (await call("places")).json.places.find((p) => p.slug === "quiet-cafe").tagline_ar;
    ok("and nothing outside ordering was touched", tagline === "شاي وقهوة", tagline);
    // And back: a menu withdrawn from the catalogue stops orders the same way.
    writeFileSync(file, JSON.stringify(SEED));
    const back = cli("sync-orders", file);
    ok("syncing the original catalogue takes it back", back.ok === true && j(back.updated) === j(["quiet-cafe"]), j(back));
  }

  console.log("\n── orders ──");
  {
    const o = order();
    const placed = await call("order_place", o);
    ok("a valid order is placed", placed.status === 200 && placed.json?.status === "placed" && placed.json.again === false, j(placed.json));
    const again = await call("order_place", o);
    ok("the same id and token again is the retry after a timeout — ok, again:true", again.status === 200 && again.json?.again === true, j(again.json));
    const stolen = await call("order_place", { ...o, track_token: tok() });
    ok("the same id with another token is 409 duplicate", stolen.status === 409 && stolen.json?.error === "duplicate", j(stolen.json));

    const st = await call("order_status", { id: o.id, token: o.track_token });
    ok("order_status returns the order without name or phone", st.json?.order?.status === "placed" && st.json.order.lines[0].qty === 2 && !("customer_phone" in st.json.order) && !("customer_name" in st.json.order) && !("track_token" in st.json.order), j(st.json));
    const stGet = await call("order_status", { id: o.id, token: o.track_token }, { method: "GET" });
    ok("and it answers a GET with query parameters too", stGet.json?.order?.status === "placed");
    const wrongTok = await call("order_status", { id: o.id, token: tok() });
    ok("a wrong token gets order:null — the same answer as no such order", wrongTok.status === 200 && wrongTok.json?.order === null, j(wrongTok.json));
    const noOrder = await call("order_status", { id: uuid(), token: tok() });
    ok("an unknown id gets order:null", noOrder.json?.order === null);

    const badPhone = await call("order_place", order({ customer_phone: "12345678" }));
    ok("a phone not starting 5/6/9 is 422 invalid, naming the field", badPhone.status === 422 && badPhone.json?.error === "invalid" && badPhone.json.field === "customer_phone", j(badPhone.json));
    const noLines = await call("order_place", order({ lines: [] }));
    ok("an empty basket is 422 lines", noLines.status === 422 && noLines.json?.field === "lines");
    const tooMuch = await call("order_place", order({ total_fils: 50001 }));
    ok("a total over 50 KWD is 422 total_fils", tooMuch.status === 422 && tooMuch.json?.field === "total_fils");
    const badTime = await call("order_place", order({ pickup_at: "6:30 pm" }));
    ok("a pickup time not HH:MM is 422", badTime.status === 422 && badTime.json?.field === "pickup_at");
    const shortName = await call("order_place", order({ customer_name: "س" }));
    ok("a one-letter name is 422", shortName.status === 422 && shortName.json?.field === "customer_name");
    const longNote = await call("order_place", order({ note_ar: "ن".repeat(201) }));
    ok("a note over 200 characters is 422 — counted in characters, not bytes", longNote.status === 422 && longNote.json?.field === "note_ar");
    const okNote = await call("order_place", order({ note_ar: "ن".repeat(200) }));
    ok("…and exactly 200 Arabic characters is fine", okNote.status === 200, j(okNote.json));
    const badId = await call("order_place", order({ id: "not-a-uuid" }));
    ok("an id that is not a uuid is 422", badId.status === 422 && badId.json?.field === "id");
    const shortToken = await call("order_place", order({ track_token: "short" }));
    ok("a token under 20 characters is 422", shortToken.status === 422 && shortToken.json?.field === "track_token");
    const closed = await call("order_place", order({ place_slug: "quiet-cafe", place_name_ar: "كافيه هادي" }));
    ok("a place that does not take orders is 409 closed", closed.status === 409 && closed.json?.error === "closed", j(closed.json));
    const unknown = await call("order_place", order({ place_slug: "no-such-place" }));
    ok("an unknown place is 409 closed too", unknown.status === 409 && unknown.json?.error === "closed");
    const hidden = await call("order_place", order({ place_slug: "hidden-one", place_name_ar: "مخفي" }));
    ok("an unpublished place is closed even if it took orders", hidden.status === 409 && hidden.json?.error === "closed");

    const c1 = await call("order_cancel", { id: o.id, token: o.track_token });
    ok("cancelling a placed order answers cancelled", c1.json?.status === "cancelled", j(c1.json));
    const c2 = await call("order_cancel", { id: o.id, token: o.track_token });
    ok("cancelling twice is still cancelled, not an error", c2.json?.status === "cancelled");
    const after = await call("order_status", { id: o.id, token: o.track_token });
    ok("the cancellation is stamped", after.json?.order?.status === "cancelled" && typeof after.json.order.cancelled_at === "string");
    const cWrong = await call("order_cancel", { id: okNote.json ? order().id : o.id, token: tok() });
    ok("cancelling with a wrong token answers null", cWrong.status === 200 && cWrong.json?.status === null, j(cWrong.json));

    const o2 = order();
    await call("order_place", o2);
    const list = await call("orders_list", undefined, { admin: true });
    const row = list.json?.orders?.find((r) => r.id === o2.id);
    ok("orders_list carries the customer's name and phone and never the token", row && row.customer_name === "سالم" && row.customer_phone === "51234567" && !("track_token" in row) && Array.isArray(row.lines), j(row));
    ok("newest first", list.json?.orders?.[0]?.id === o2.id);
    const ready = await call("order_set_status", { id: o2.id, status: "ready" }, { admin: true });
    ok("the board marks an order ready", ready.json?.status === "ready");
    const st2 = await call("order_status", { id: o2.id, token: o2.track_token });
    ok("…and ready_at is stamped once", st2.json?.order?.status === "ready" && typeof st2.json.order.ready_at === "string");
    const late = await call("order_cancel", { id: o2.id, token: o2.track_token });
    ok("the customer cannot cancel a ready order — the answer is its status", late.json?.status === "ready", j(late.json));
    const badStatus = await call("order_set_status", { id: o2.id, status: "eaten" }, { admin: true });
    ok("an unknown status is 422", badStatus.status === 422);
    const gone = await call("order_set_status", { id: uuid(), status: "ready" }, { admin: true });
    ok("an unknown order is 404", gone.status === 404);
    const notAdmin = await call("order_set_status", { id: o2.id, status: "collected" });
    ok("order_set_status without the admin header is refused", notAdmin.status === 403);
  }

  console.log("\n── the queue ──");
  {
    const size0 = await call("queue_size", { place_slug: "tea-house" });
    ok("queue_size before anyone joins: 0 waiting, nobody serving, the salon's minutes", size0.json?.waiting === 0 && size0.json.now_serving === null && size0.json.service_minutes === 10, j(size0.json));
    const t1 = ticket({ customer_phone: "55555555" });
    const t2 = ticket({ customer_phone: "66666666" });
    const j1 = await call("queue_join", t1);
    const j2 = await call("queue_join", t2);
    ok("two joiners get 1 and 2", j1.json?.number === 1 && j2.json?.number === 2, j([j1.json, j2.json]));
    ok("the day is Kuwait's calendar day", /^\d{4}-\d{2}-\d{2}$/.test(j1.json?.day ?? ""));
    const dup = await call("queue_join", ticket({ customer_phone: "55555555" }));
    ok("the same phone twice while live is 409 duplicate", dup.status === 409 && dup.json?.error === "duplicate", j(dup.json));
    const sameId = await call("queue_join", { ...t1, customer_phone: "99999999" });
    ok("the same ticket id again is 409 duplicate", sameId.status === 409 && sameId.json?.error === "duplicate", j(sameId.json));
    const noPhoneA = await call("queue_join", ticket());
    const noPhoneB = await call("queue_join", ticket());
    ok("two tickets with no phone are allowed (3 and 4)", noPhoneA.json?.number === 3 && noPhoneB.json?.number === 4, j([noPhoneA.json, noPhoneB.json]));
    const walkPublic = await call("queue_join", ticket({ source: "walk_in" }));
    ok("a walk-in without the admin header is 403 admin_required", walkPublic.status === 403 && walkPublic.json?.error === "admin_required", j(walkPublic.json));
    const walk = await call("queue_join", ticket({ source: "walk_in", customer_name: "زبون عند الكاونتر" }), { admin: true });
    ok("a walk-in by staff takes the next number", walk.json?.number === 5, j(walk.json));
    const closed = await call("queue_join", ticket({ place_slug: "quiet-cafe", place_name_ar: "كافيه هادي" }));
    ok("a place without the queue is 409 closed", closed.status === 409 && closed.json?.error === "closed");
    const badPhone = await call("queue_join", ticket({ customer_phone: "+96555555555" }));
    ok("a phone with a country code is 422 — the client normalises, the server checks", badPhone.status === 422 && badPhone.json?.field === "customer_phone");

    const s2 = await call("queue_status", { id: t2.id, token: t2.track_token });
    ok("the second ticket sees one ahead and nobody serving", s2.json?.ticket?.ahead === 1 && s2.json.ticket.now_serving === null && s2.json.ticket.number === 2 && s2.json.ticket.service_minutes === 10, j(s2.json));
    ok("queue_status never returns the customer's name or phone", s2.json?.ticket && !("customer_name" in s2.json.ticket) && !("customer_phone" in s2.json.ticket) && !("track_token" in s2.json.ticket));
    const sWrong = await call("queue_status", { id: t2.id, token: tok() });
    ok("a wrong token gets ticket:null", sWrong.json?.ticket === null);

    const called = await call("queue_set_status", { id: t1.id, status: "called" }, { admin: true });
    ok("the counter calls number 1", called.json?.status === "called");
    const s2b = await call("queue_status", { id: t2.id, token: t2.track_token });
    ok("…so number 2 sees now_serving 1 and nobody ahead", s2b.json?.ticket?.ahead === 0 && s2b.json.ticket.now_serving === 1, j(s2b.json?.ticket));
    const size = await call("queue_size", { place_slug: "tea-house" });
    ok("queue_size agrees: 4 waiting, serving 1", size.json?.waiting === 4 && size.json.now_serving === 1, j(size.json));
    const rejoin = await call("queue_join", ticket({ customer_phone: "55555555" }));
    ok("a called ticket still counts as live for its phone", rejoin.status === 409);

    const left = await call("queue_leave", { id: t2.id, token: t2.track_token });
    ok("leaving while waiting answers left", left.json?.status === "left");
    const leftAgain = await call("queue_leave", { id: t2.id, token: t2.track_token });
    ok("leaving twice is still left", leftAgain.json?.status === "left");
    const served = await call("queue_set_status", { id: t1.id, status: "served" }, { admin: true });
    ok("the counter marks 1 served", served.json?.status === "served");
    const leaveServed = await call("queue_leave", { id: t1.id, token: t1.track_token });
    ok("leaving a served ticket answers its status, not left", leaveServed.json?.status === "served");
    const afterServed = await call("queue_join", ticket({ customer_phone: "55555555" }));
    ok("once served, the phone may take a new number", afterServed.status === 200 && afterServed.json?.number === 6, j(afterServed.json));

    const list = await call("queue_list", undefined, { admin: true });
    const rows = list.json?.tickets ?? [];
    ok("queue_list is today's tickets in number order, with names and no tokens", rows.length === 6 && rows[0].number === 1 && rows[0].status === "served" && typeof rows[0].served_at === "string" && rows[0].customer_name === "زبون" && rows.every((r) => !("track_token" in r)), j(rows.map((r) => [r.number, r.status])));
    ok("the walk-in is marked as one", rows.find((r) => r.number === 5)?.source === "walk_in");
    const other = await call("queue_list", { day: "2020-01-01" }, { admin: true });
    ok("another day is empty", other.json?.tickets?.length === 0);
  }

  console.log("\n── submissions ──");
  {
    const s = await call("submit", submission());
    ok("a valid submission is accepted with a server-made id", s.status === 200 && /^[0-9a-f-]{36}$/.test(s.json?.id ?? "") && s.json.status === "pending", j(s.json));
    const dup = await call("submit", submission({ name_ar: "محل جديد ", area_ar: "السالمية" }));
    ok("the same business while pending is 409 duplicate (case- and space-insensitive)", dup.status === 409 && dup.json?.error === "duplicate", j(dup.json));
    const badMail = await call("submit", submission({ name_ar: "محل ثاني", contact_email: "not-an-email" }));
    ok("a bad email is 422 contact_email", badMail.status === 422 && badMail.json?.field === "contact_email");
    const farAway = await call("submit", submission({ name_ar: "محل ثالث", lat: 25.2, lng: 55.3 }));
    ok("coordinates outside Kuwait are 422", farAway.status === 422 && farAway.json?.field === "lat", j(farAway.json));
    const noCoords = await call("submit", submission({ name_ar: "محل رابع", lat: null, lng: null }));
    ok("no coordinates at all is allowed", noCoords.status === 200);
    const badTag = await call("submit", submission({ name_ar: "محل خامس", tagline_ar: "قص" }));
    ok("a tagline under four characters is 422", badTag.status === 422 && badTag.json?.field === "tagline_ar");
    const js = await call("submit", submission({ name_ar: "محل سادس", website: "javascript:alert(1)" }));
    ok("a non-http website is 422 — stored XSS refused at rest", js.status === 422 && js.json?.field === "website");
    const badPath = await call("submit", submission({ name_ar: "محل سابع", logo_path: "../../etc/passwd" }));
    ok("a media path that is not media.php's shape is 422", badPath.status === 422 && badPath.json?.field === "image_paths");
    const tooMany = await call("submit", submission({ name_ar: "محل ثامن", image_paths: Array.from({ length: 13 }, (_, i) => `draftid-${i}/photo-${i}.jpg`) }));
    ok("13 photos is 422", tooMany.status === 422 && tooMany.json?.field === "image_paths");

    const list = await call("submissions_list", undefined, { admin: true });
    ok("submissions_list (pending) shows two and counts two", list.json?.submissions?.length === 2 && list.json.pending === 2, j(list.json?.pending));
    const row = list.json.submissions.find((r) => r.id === s.json.id);
    ok("the row carries the contact details for the reviewer, with arrays decoded", row?.contact_email === "owner@example.com" && Array.isArray(row.products_ar) && row.products_ar[0] === "هدايا" && row.lat === 29.33, j(row));
    const rej = await call("submission_reject", { id: s.json.id, admin_note: "ما فيه صور" }, { admin: true });
    ok("rejecting records the note", rej.json?.status === "rejected");
    const again = await call("submit", submission());
    ok("once rejected, the business may submit again", again.status === 200, j(again.json));
    const approve = await call("submission_approve", { id: again.json.id, published_slug: "new-shop" }, { admin: true });
    ok("approving records the slug it became", approve.json?.status === "approved" && approve.json.published_slug === "new-shop");
    const all = await call("submissions_list", { status: "all" }, { admin: true });
    const byStatus = Object.fromEntries((all.json?.submissions ?? []).map((r) => [r.id, r.status]));
    ok("the full list shows rejected and approved with reviewed_at stamped", byStatus[s.json.id] === "rejected" && byStatus[again.json.id] === "approved" && all.json.submissions.every((r) => r.status === "pending" || typeof r.reviewed_at === "string"), j(byStatus));
    ok("pending count is down to one", all.json?.pending === 1);
    const pub = await call("submissions_list");
    ok("submissions are admin-only", pub.status === 403);
  }

  console.log("\n── places: the admin's writes ──");
  {
    const created = await call("place_save", { place: basePlace({ slug: "new-shop", name: "New Shop", name_ar: "محل جديد", published: false }) }, { admin: true });
    ok("place_save without an id inserts and returns the row with its id", created.status === 200 && /^[0-9a-f-]{36}$/.test(created.json?.place?.id ?? "") && created.json.place.slug === "new-shop" && created.json.place.published === false, j(created.json));
    const newId = created.json.place.id;
    const collide = await call("place_save", { place: basePlace({ slug: "tea-house" }) }, { admin: true });
    ok("a second place with a taken slug is 409 duplicate on slug", collide.status === 409 && collide.json?.field === "slug", j(collide.json));
    const badCat = await call("place_save", { place: basePlace({ slug: "z", category: "bars" }) }, { admin: true });
    ok("an unknown category is 422", badCat.status === 422 && badCat.json?.field === "category");
    const badMenu = await call("place_save", { place: basePlace({ slug: "z", menu_ar: [{ id: "m1", nameAr: "x", priceFils: -5 }] }) }, { admin: true });
    ok("a negative menu price is 422 menu_ar", badMenu.status === 422 && badMenu.json?.field === "menu_ar");
    const badWa = await call("place_save", { place: basePlace({ slug: "z", order_whatsapp: "1234567" }) }, { admin: true });
    ok("a seven-digit WhatsApp number is 422", badWa.status === 422 && badWa.json?.field === "order_whatsapp");
    const badPrep = await call("place_save", { place: basePlace({ slug: "z", order_prep_minutes: 3 }) }, { admin: true });
    ok("prep under 5 minutes is 422", badPrep.status === 422 && badPrep.json?.field === "order_prep_minutes");
    const upd = await call("place_save", { id: newId, place: basePlace({ slug: "new-shop", name: "New Shop", name_ar: "محل جديد ٢", published: false, rating: 3.8 }) }, { admin: true });
    ok("place_save with an id updates in place", upd.json?.place?.name_ar === "محل جديد ٢" && upd.json.place.rating === 3.8 && upd.json.place.id === newId, j(upd.json));
    const rename = await call("place_save", { id: newId, place: basePlace({ slug: "tea-house", name_ar: "x" }) }, { admin: true });
    ok("renaming onto another place's slug is 409", rename.status === 409);
    const missing = await call("place_save", { id: uuid(), place: basePlace({ slug: "ghost" }) }, { admin: true });
    ok("updating an unknown id is 404", missing.status === 404);
    const hiddenPub = await call("places");
    ok("the public list still hides it while unpublished", !hiddenPub.json.places.some((p) => p.slug === "new-shop"));
    const pubOn = await call("place_publish", { id: newId, published: true }, { admin: true });
    ok("place_publish turns it on", pubOn.json?.published === true);
    const shown = await call("places");
    ok("…and the public list shows it", shown.json.places.some((p) => p.slug === "new-shop"));
    const loc = await call("place_location", { id: newId, lat: 29.3, lng: 47.9 }, { admin: true });
    ok("place_location moves the pin", loc.json?.lat === 29.3);
    const row = (await call("places_all", undefined, { admin: true })).json.places.find((p) => p.id === newId);
    ok("…read back", row?.lat === 29.3 && row.lng === 47.9);
    const del = await call("place_delete", { id: newId }, { admin: true });
    ok("place_delete removes it", del.json?.deleted === newId);
    const delAgain = await call("place_delete", { id: newId }, { admin: true });
    ok("deleting twice is 404", delAgain.status === 404);
    const asVisitor = await call("place_save", { place: basePlace({ slug: "sneak" }) });
    ok("a visitor cannot save a place", asVisitor.status === 403);
  }

  console.log("\n── media: signed reads of pending files, publishing, discarding ──");
  {
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const draft = "draft-abc123";
    mkdirSync(join(storage, "business-pending", draft), { recursive: true });
    writeFileSync(join(storage, "business-pending", draft, "logo-0.png"), PNG);
    const path = `${draft}/logo-0.png`;

    const asVisitor = await call("media_sign", { path });
    ok("media_sign is admin-only", asVisitor.status === 403);
    const signed = await call("media_sign", { path }, { admin: true });
    ok("media_sign answers a relative signed URL with an expiry", signed.status === 200 && /^\/api\/wain\.php\?a=media_get&p=.*&exp=\d+&sig=[0-9a-f]{64}$/.test(signed.json?.url ?? ""), j(signed.json));
    const got = await fetch(`http://127.0.0.1:${PORT}${signed.json.url}`);
    const bytes = Buffer.from(await got.arrayBuffer());
    ok("the signed URL serves the bytes as image/png, no admin header needed", got.status === 200 && got.headers.get("content-type") === "image/png" && bytes.equals(PNG), String(got.status));
    const tampered = signed.json.url.replace(/sig=[0-9a-f]{4}/, "sig=0000");
    const bad = await fetch(`http://127.0.0.1:${PORT}${tampered}`);
    ok("a tampered signature is 403", bad.status === 403 && (await bad.json()).error === "bad_signature");
    const expiredUrl = signed.json.url.replace(/exp=\d+/, "exp=1000000000");
    const exp = await fetch(`http://127.0.0.1:${PORT}${expiredUrl}`);
    ok("an expired URL is 403 before the signature is even checked", exp.status === 403 && (await exp.json()).error === "expired");
    const traversal = await fetch(`${BASE}?a=media_get&p=${encodeURIComponent("../admin.secret")}&exp=9999999999&sig=x`);
    ok("a path outside media.php's shape is 400", traversal.status === 400);
    const missing = await call("media_sign", { path: `${draft}/photo-3.jpg` }, { admin: true });
    ok("signing a file that is not there is 404", missing.status === 404);

    const pub = await call("media_publish", { path, slug: "tea-house", name: "logo" }, { admin: true });
    ok("media_publish copies into the docroot's images/business and answers the URL", pub.json?.url === "/images/business/tea-house/logo.png" && existsSync(join(web, "images/business/tea-house/logo.png")), j(pub.json));
    ok("…byte for byte", readFileSync(join(web, "images/business/tea-house/logo.png")).equals(PNG));
    const badName = await call("media_publish", { path, slug: "tea-house", name: "../x" }, { admin: true });
    ok("a name that is not a short slug is 422", badName.status === 422);
    const disc = await call("media_discard", { paths: [path, `${draft}/photo-1.jpg`] }, { admin: true });
    ok("media_discard removes what exists and counts it", disc.json?.removed === 1 && !existsSync(join(storage, "business-pending", draft)), j(disc.json));
    ok("the published copy survives the discard", existsSync(join(web, "images/business/tea-house/logo.png")));
  }

  console.log("\n── the log ──");
  {
    const log = cli("log", "500");
    ok("every request wrote a line", log.lines > 50, String(log.lines));
    const text = log.tail.join("\n");
    ok("no customer name, phone, email or note is in it", !/سالم|51234567|owner@example|زبون/.test(text));
    ok("a refusal names the action and the reason", /wain 422 a=order_place why=invalid/.test(text));
    ok("a write names the row by its first eight characters only", /wain ok a=order_place id=[0-9a-f]{8} mail=(none|sent|failed) ms=/.test(text));
    ok("the address is eight hex characters", /ip=[0-9a-f]{8}\b/.test(text) && !/127\.0\.0\.1/.test(text));
    ok("the log file is 0600", (await import("node:fs")).statSync(join(storage, "logs", "wain.log")).mode.toString(8).endsWith("600"));
  }

  console.log("\n── a shortlist's vote: cast, change, count ──");
  {
    const poll = "abc123def456";
    const options = ["tea-house", "beach", "museum"];
    const voterA = tok(), voterB = tok();
    const a = await call("vote_cast", { poll, voter: voterA, place_slug: "beach", options });
    ok("a vote is cast and the tally comes back with it", a.status === 200 && a.json.vote === "cast" && a.json.tally.beach === 1 && a.json.total === 1, j(a.json));
    ok("every option is in the tally, zeros included", Object.keys(a.json.tally).join(",") === options.join(","), j(a.json));
    const b = await call("vote_cast", { poll, voter: voterB, place_slug: "beach", options });
    ok("a second voter adds to it", b.json.tally.beach === 2 && b.json.total === 2, j(b.json));
    const c = await call("vote_cast", { poll, voter: voterA, place_slug: "museum", options });
    ok("the same voter changing their mind moves the vote, it does not add one", c.json.vote === "changed" && c.json.tally.beach === 1 && c.json.tally.museum === 1 && c.json.total === 2, j(c.json));
    const g = await call("votes_get", { poll, options: options.join(",") });
    ok("anyone with the link reads the same tally", g.status === 200 && g.json.tally.museum === 1 && g.json.tally.beach === 1 && g.json.total === 2, j(g.json));
    const other = await call("votes_get", { poll: "zzz999zzz999", options: options.join(",") });
    ok("another poll counts nothing of this one", other.json.total === 0, j(other.json));
    const bad = await call("vote_cast", { poll, voter: tok(), place_slug: "elsewhere", options });
    ok("a vote for a place the link does not offer is refused", bad.status === 422 && bad.json.field === "place_slug", j(bad.json));
    const one = await call("vote_cast", { poll, voter: tok(), place_slug: "beach", options: ["beach"] });
    ok("a poll of one place is not a poll", one.status === 422, j(one.json));
    const badPoll = await call("vote_cast", { poll: "x", voter: tok(), place_slug: "beach", options });
    ok("a malformed poll id is refused", badPoll.status === 422 && badPoll.json.field === "poll", j(badPoll.json));
    ok("casting is POST only", (await call("vote_cast", { poll, voter: tok(), place_slug: "beach" }, { method: "GET" })).status === 405);
    const log = readFileSync(join(storage, "logs", "wain.log"), "utf8");
    ok("the log names the poll by six characters and never the voter", /a=vote_cast poll=abc123 v=cast/.test(log) && !log.includes(voterA), "");
  }

  console.log("\n── a question wain could not answer (gap_report) ──");
  {
    // An ASCII word on purpose: logline() drops every non-ASCII byte, so an
    // Arabic question could never reach the log and the check below would pass
    // by accident. «sushi» can, if the question were ever logged.
    const asked = "أبي مطعم ياباني يقدّم sushi";
    const r = await call("gap_report", { asked, area: "السالمية", offered: "", source: "call" });
    ok("a gap is reported, and the reply is ok and nothing else", r.status === 200 && r.json.ok === true && Object.keys(r.json).join() === "ok", j(r.json));
    const one = await call("gap_report", { asked: "أ" });
    ok("a question of one character is refused", one.status === 422 && one.json.field === "asked", j(one.json));
    const long = await call("gap_report", { asked: "س".repeat(121) });
    ok("a question over 120 characters is refused", long.status === 422 && long.json.field === "asked", j(long.json));
    const src = await call("gap_report", { asked: "قهوة بالمريخ", source: "email" });
    ok("the source is one the server knows", src.status === 422 && src.json.field === "source", j(src.json));
    ok("reporting is POST only", (await call("gap_report", { asked }, { method: "GET" })).status === 405);
    const masked = await call("gap_report", { asked: "رقمي 9651 2345 678 وإيميلي a.b@example.com" });
    ok("a question with a number and an address is still answered", masked.status === 200, j(masked.json));
    const anon = await call("gaps_list", {});
    ok("the gaps are the admin's to read", anon.status === 403 && anon.json.error === "admin_required", j(anon.json));
    const list = await call("gaps_list", {}, { admin: true });
    const mine = list.json.gaps?.find((g) => g.asked === asked);
    ok("the admin reads the question back, with its area and source", list.status === 200 && mine?.area === "السالمية" && mine?.source === "call", j(list.json).slice(0, 300));
    ok("a number and an address are masked before they are stored", list.json.gaps?.some((g) => g.asked === "رقمي [رقم] وإيميلي [بريد]") === true, j(list.json.gaps?.map((g) => g.asked)));
    ok("the newest gap comes first", list.json.gaps?.[0]?.created_at >= list.json.gaps?.at(-1)?.created_at, "");
    // A row older than GAP_KEEP_DAYS, written straight into the database the
    // server uses; the next report is what deletes it, as the votes do.
    const old = "سؤال قديم جداً";
    execFileSync("php", ["-r", `$p = new PDO("sqlite:" . ${JSON.stringify(join(storage, "wain.sqlite"))}); $p->exec("INSERT INTO gaps (id, asked, area, offered, source, created_at) VALUES ('0123456789abcdef01234567', '${old}', '', '', 'call', '2001-01-01T00:00:00.000000Z')");`]);
    await call("gap_report", { asked: "سؤال جديد بعد القديم" });
    const after = await call("gaps_list", {}, { admin: true });
    ok("a gap older than thirty days goes when the next one comes in", !after.json.gaps.some((g) => g.asked === old) && after.json.gaps.some((g) => g.asked === "سؤال جديد بعد القديم"), j(after.json.gaps.map((g) => g.asked)));
    const log = readFileSync(join(storage, "logs", "wain.log"), "utf8");
    ok("the log names a gap by eight characters and its source, never the question", /a=gap_report id=[0-9a-f]{8} src=call/.test(log) && !log.includes("sushi"), "");
  }

  console.log("\n── selftest on this engine ──");
  {
    const st = cli("selftest");
    ok("selftest passes on SQLite and cleans up", st.ok === true && st.cleaned === true && st.steps.length === 10, j(st));
    const places = (await call("places")).json.places;
    ok("…leaving no selftest row behind", !places.some((p) => p.slug.startsWith("selftest-")));
  }

  console.log("\n── the public write cap trips, and the admin is exempt ──");
  {
    const rateFile = readdirSync(join(storage, "wain-rate")).find((f) => f.startsWith("write-"));
    const n = JSON.parse(readFileSync(join(storage, "wain-rate", rateFile), "utf8")).n;
    ok(`writes so far are under the test cap (${n} < ${WRITES_PER_MIN})`, n < WRITES_PER_MIN, String(n));
    let last = { status: 0 };
    for (let i = n; i < WRITES_PER_MIN; i++) last = await call("order_cancel", { id: uuid(), token: tok() });
    ok("the last allowed write still answers", last.status === 200, String(last.status));
    const over = await call("order_cancel", { id: uuid(), token: tok() });
    ok("the next public write is 429", over.status === 429 && over.json?.error === "rate_limited", j(over.json));
    const read = await call("places");
    ok("reads are not caught by the write cap", read.status === 200);
    const adminWrite = await call("order_set_status", { id: uuid(), status: "ready" }, { admin: true });
    ok("an authenticated admin is exempt (404 for the fake id, not 429)", adminWrite.status === 404, String(adminWrite.status));
  }

  console.log("\n── behind a proxy: the header is believed only from a proxy the operator listed ──");
  {
    /* This server sees every request from 127.0.0.1 — what a reverse proxy in
       front looks like to PHP. The cap above has just tripped for it. Trust is
       OFF until storage/trusted-proxies.txt names the proxy: a range-based
       first draft believed every private address, and review showed that makes
       the limit easier to step around than the shared bucket it replaced. */
    const sha = (s) => createHash("sha256").update(s).digest("hex");
    const writes = (ip) => {
      const f = join(storage, "wain-rate", `write-${sha(ip)}.json`);
      return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).n : 0;
    };
    const cancel = (xff) => call("order_cancel", { id: uuid(), token: tok() }, xff === undefined ? {} : { headers: { "X-Forwarded-For": xff } });
    const trusted = join(storage, "trusted-proxies.txt");

    ok("control: with no header the proxy's own bucket is still capped", (await cancel()).status === 429);
    ok("with NO list the header is not believed (off by default)",
      !existsSync(trusted) && (await cancel("203.0.113.7")).status === 429 && writes("203.0.113.7") === 0);
    writeFileSync(trusted, "# Traefik, on the Docker network\n172.18.0.0/16\n");
    ok("a list that does not name this peer: the header is still not believed",
      (await cancel("203.0.113.7")).status === 429 && writes("203.0.113.7") === 0);

    writeFileSync(trusted, "127.0.0.1\n");
    const one = await cancel("203.0.113.7");
    ok("once the peer is listed, a visitor behind it is not caught by the proxy's cap", one.status === 200, String(one.status));
    const two = await cancel("198.51.100.1, 203.0.113.7");
    ok("an address the client typed to the left buys no fresh bucket (same visitor, second write)",
      two.status === 200 && writes("203.0.113.7") === 2 && writes("198.51.100.1") === 0,
      `${two.status} 203.0.113.7=${writes("203.0.113.7")} 198.51.100.1=${writes("198.51.100.1")}`);
    const other = await cancel("203.0.113.8");
    ok("another visitor behind the same proxy has a bucket of their own", other.status === 200 && writes("203.0.113.8") === 1);
    ok("a header that is not an address falls back to the proxy's bucket", (await cancel("not-an-address")).status === 429);
    ok("so does one whose every hop is listed", (await cancel("127.0.0.1")).status === 429);

    const log = readFileSync(join(storage, "logs", "wain.log"), "utf8");
    ok("the log carries the forwarded visitor's hash, not the raw address",
      log.includes(`ip=${sha("203.0.113.7").slice(0, 8)}`) && !log.includes("203.0.113.7"));
    /* IPv6: a visitor is a /64, so two addresses in one /64 are one bucket. Filed
       under the /64 itself: the address's own file does not exist. */
    await cancel("2001:db8:1:2::5");
    await cancel("2001:db8:1:2::9");
    ok("two IPv6 addresses in one /64 share one bucket, filed under the /64",
      writes("2001:db8:1:2::/64") === 2 && writes("2001:db8:1:2::5") === 0 && writes("2001:db8:1:2::9") === 0,
      `/64=${writes("2001:db8:1:2::/64")}`);
    await cancel("2001:db8:1:3::5");
    ok("another /64 is another visitor", writes("2001:db8:1:3::/64") === 1);
    rmSync(trusted);
    ok("with the list removed the proxy's bucket is the visitor again", (await cancel("203.0.113.9")).status === 429 && writes("203.0.113.9") === 0);
  }

  console.log("\n── an unused counter is removed after an hour, and a live one is not ──");
  {
    const rateDir = join(storage, "wain-rate");
    const sha = (x) => createHash("sha256").update(x).digest("hex");
    const hourAgo = new Date(Date.now() - 2 * 3600_000);
    const now = Math.floor(Date.now() / 1000);
    const stale = join(rateDir, `all-${sha("198.51.100.99")}.json`);
    writeFileSync(stale, JSON.stringify({ start: now - 7200, n: 500 }));
    utimesSync(stale, hourAgo, hourAgo);
    const live = join(rateDir, `write-${sha("198.51.100.98")}.json`);
    writeFileSync(live, JSON.stringify({ start: now, n: 3 }));
    const clock = join(rateDir, ".swept");
    writeFileSync(clock, "");
    utimesSync(clock, hourAgo, hourAgo);
    const r = await call("places");
    ok("a request is served while the sweep runs", r.status === 200, String(r.status));
    ok("the counter nobody has written for an hour is gone", !existsSync(stale));
    ok("a counter written just now is kept", existsSync(live));
    ok("the sweep stamps its clock, so the next one waits ten minutes",
      statSync(clock).mtimeMs > Date.now() - 60_000);
  }

  console.log("\n── a wrong admin guess spends the visitor's allowance before the sleep ──");
  {
    /* The suite's cap is 5000 a minute (WAIN_API_RATE_PER_MIN, above). A dedicated
       visitor behind a listed proxy is filled to three below it, so three wrong
       guesses are answered 403 and the fourth is refused before any sleep. */
    const sha = (x) => createHash("sha256").update(x).digest("hex");
    const trusted = join(storage, "trusted-proxies.txt");
    const visitor = "198.51.100.77";
    writeFileSync(trusted, "127.0.0.1\n");
    writeFileSync(join(storage, "wain-rate", `all-${sha(visitor)}.json`),
      JSON.stringify({ start: Math.floor(Date.now() / 1000), n: 5000 - 3 }));
    const via = { "X-Forwarded-For": visitor };
    const guess = (headers) => call("whoami", undefined, { admin: true, token: "not-the-secret", headers });
    const g = [await guess(via), await guess(via), await guess(via)];
    ok("three wrong guesses are still answered 403, as before", g.every((x) => x.status === 403 && x.json?.error === "admin_forbidden"),
      g.map((x) => x.status).join(","));
    const fourth = await guess(via);
    ok("the fourth is refused 429 before the sleep: the wrong guesses spent the allowance",
      fourth.status === 429 && fourth.json?.error === "rate_limited", `${fourth.status} ${j(fourth.json)}`);
    const pub = await call("places", undefined, { headers: via });
    ok("and the same visitor's public requests are refused too (14 October login scan, finding 1)",
      pub.status === 429, String(pub.status));
    const neighbour = await call("places", undefined, { headers: { "X-Forwarded-For": "198.51.100.78" } });
    ok("another visitor is not caught by it", neighbour.status === 200, String(neighbour.status));
    const rightSecret = await call("whoami", undefined, { admin: true, headers: via });
    ok("the right secret is exempt even from a visitor over the limit", rightSecret.status === 200, String(rightSecret.status));
    rmSync(trusted);
  }

  console.log("\n── a short admin secret is admin_weak, before any guess is compared or counted ──");
  {
    /* The length is measured in BYTES after trim(), the way the endpoint reads
       the file. The 4-character and 31-byte secrets exist only to be refused:
       the suite's shared SECRET stays 42 bytes, so every section above still
       reaches the comparison. Each wrong guess below comes from a visitor of its
       own, so no two guesses share a counter. */
    const sha = (x) => createHash("sha256").update(x).digest("hex");
    const secretPath = join(storage, "admin.secret");
    const counter = (ip) => join(storage, "wain-rate", `all-${sha(ip)}.json`);
    const trusted = join(storage, "trusted-proxies.txt");
    const setSecret = (text) => { writeFileSync(secretPath, text); chmodSync(secretPath, 0o600); };
    const from = (ip) => ({ "X-Forwarded-For": ip });
    writeFileSync(trusted, "127.0.0.1\n");

    setSecret("Zq9-\n");
    const v1 = "192.0.2.61";
    ok("no counter exists for the visitor before the guess", !existsSync(counter(v1)));
    const wrong = await call("whoami", undefined, { admin: true, token: "guess", headers: from(v1) });
    ok("a wrong header against a 4-character secret is 503 admin_weak, not 403 admin_forbidden",
      wrong.status === 503 && wrong.json?.error === "admin_weak", `${wrong.status} ${j(wrong.json)}`);
    ok("and that wrong guess created no counter for the visitor", !existsSync(counter(v1)));
    const right = await call("whoami", undefined, { admin: true, token: "Zq9-", headers: from(v1) });
    ok("the right 4-character header is refused too: a short secret never becomes a login",
      right.status === 503 && right.json?.error === "admin_weak", `${right.status} ${j(right.json)}`);
    const bare = await call("orders_list");
    ok("an admin action with no header is 503 admin_weak as well, as admin_unset is",
      bare.status === 503 && bare.json?.error === "admin_weak", `${bare.status} ${j(bare.json)}`);

    const v2 = "192.0.2.62";
    writeFileSync(counter(v2), JSON.stringify({ start: Math.floor(Date.now() / 1000), n: 5 }));
    await call("whoami", undefined, { admin: true, token: "guess", headers: from(v2) });
    const n2 = JSON.parse(readFileSync(counter(v2), "utf8")).n;
    ok("a wrong guess does not raise a live counter that is already running (still 5)", n2 === 5, String(n2));

    setSecret("x".repeat(31) + "\n");
    const v3 = "192.0.2.63";
    const w31 = await call("whoami", undefined, { admin: true, token: "y".repeat(31), headers: from(v3) });
    ok("31 bytes is still short: a wrong header is 503 admin_weak", w31.status === 503 && w31.json?.error === "admin_weak", `${w31.status} ${j(w31.json)}`);
    const r31 = await call("whoami", undefined, { admin: true, token: "x".repeat(31), headers: from(v3) });
    ok("and the right 31-byte header is refused the same way", r31.status === 503 && r31.json?.error === "admin_weak", `${r31.status} ${j(r31.json)}`);

    setSecret("x".repeat(32) + "\n");
    const v4 = "192.0.2.64";
    const w32 = await call("whoami", undefined, { admin: true, token: "y".repeat(32), headers: from(v4) });
    ok("32 bytes reaches the comparison: a wrong header is 403 admin_forbidden", w32.status === 403 && w32.json?.error === "admin_forbidden", `${w32.status} ${j(w32.json)}`);
    const r32 = await call("whoami", undefined, { admin: true, token: "x".repeat(32), headers: from(v4) });
    ok("and the right 32-byte header is admin", r32.status === 200 && r32.json?.admin === true, `${r32.status} ${j(r32.json)}`);

    const cliText = (...args) => execFileSync("php", [PHP_FILE, ...args], { encoding: "utf8", env: { ...process.env, HOME: dir } });
    setSecret("Zq9-\n");
    const shortRaw = cliText("version");
    const short = JSON.parse(shortRaw);
    ok("version reports weak for a 4-character file", short.adminSecret === "weak", j(short.adminSecret));
    ok("version reports the file's mode as octal, 0600 here", short.adminSecretMode === "0600", j(short.adminSecretMode));
    ok("version never prints the secret", !shortRaw.includes("Zq9-"));
    setSecret("x".repeat(31) + "\n");
    ok("version reports weak at 31 bytes", JSON.parse(cliText("version")).adminSecret === "weak");
    setSecret("x".repeat(32) + "\n");
    const long = JSON.parse(cliText("version"));
    ok("version reports set for a 32-byte file", long.adminSecret === "set", j(long.adminSecret));
    chmodSync(secretPath, 0o640);
    ok("the mode is read from the file, not assumed: 0640 is reported as 0640",
      JSON.parse(cliText("version")).adminSecretMode === "0640", j(JSON.parse(cliText("version")).adminSecretMode));
    setSecret("");
    const blank = JSON.parse(cliText("version"));
    ok("a blank file is EMPTY, never present and never set (keyState's word)", blank.adminSecret === "EMPTY", j(blank.adminSecret));

    setSecret("Zq9-\n");
    const pWeak = await call("ping");
    ok("ping's admin field reads weak for a short secret", pWeak.json?.ok === true && pWeak.json.admin === "weak", j(pWeak.json));
    ok("and ping keeps every other field it has",
      pWeak.json?.service === "wain-api" && pWeak.json.stage === "production" && pWeak.json.engine === "sqlite" && typeof pWeak.json.time === "string",
      j(pWeak.json));
    const pubWeak = await call("places");
    ok("a public read is unaffected by a short secret", pubWeak.status === 200 && Array.isArray(pubWeak.json?.places), `${pubWeak.status}`);
    setSecret("x".repeat(32) + "\n");
    const pSet = await call("ping");
    ok("ping reads set for a 32-byte secret", pSet.json?.admin === "set", j(pSet.json));
    setSecret("");
    const pUnset = await call("ping");
    ok("ping still reads unset for a blank file", pUnset.json?.admin === "unset", j(pUnset.json));

    /* The signed media reads are keyed on the same secret, so a short one is a
       search an attacker can run offline: a four-character key was recovered from
       one signed URL in 17 seconds. The signed read is refused under the same rule
       as the admin gate. The signatures below are made by hand with the key a
       visitor would have to guess, which is the attack being tested. */
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const pendingPath = "weak-abc123/logo-0.png";
    mkdirSync(join(storage, "business-pending", "weak-abc123"), { recursive: true });
    writeFileSync(join(storage, "business-pending", "weak-abc123", "logo-0.png"), PNG);
    const signedRead = (key) => {
      const exp = Math.floor(Date.now() / 1000) + 600;
      const sig = createHmac("sha256", key).update(`${pendingPath}|${exp}`).digest("hex");
      return `${BASE}?a=media_get&p=${encodeURIComponent(pendingPath)}&exp=${exp}&sig=${sig}`;
    };
    setSecret("Zq9-\n");
    const forged = await fetch(signedRead("Zq9-"));
    const forgedBytes = Buffer.from(await forged.arrayBuffer());
    const forgedJson = (() => { try { return JSON.parse(forgedBytes.toString("utf8")); } catch { return null; } })();
    ok("a signed read made with a 4-character key is 503 admin_weak, not the file",
      forged.status === 503 && forgedJson?.error === "admin_weak", `${forged.status} ${forged.headers.get("content-type")}`);
    ok("and none of the pending photo's bytes are sent", !forgedBytes.equals(PNG), `${forgedBytes.length} bytes`);
    setSecret("x".repeat(32) + "\n");
    const strong = await fetch(signedRead("x".repeat(32)));
    const strongBytes = Buffer.from(await strong.arrayBuffer());
    ok("a signed read made with a 32-byte key still serves the file as image/png",
      strong.status === 200 && strong.headers.get("content-type") === "image/png" && strongBytes.equals(PNG), String(strong.status));
    rmSync(join(storage, "business-pending", "weak-abc123"), { recursive: true, force: true });

    setSecret(SECRET + "\n");
    rmSync(trusted);
  }
} finally {
  php.kill();
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
