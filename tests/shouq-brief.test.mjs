#!/usr/bin/env node
/**
 * The knowledge base شوق is briefed on.
 *
 * docs/wain-ai-agent.md is what gets pasted into the ElevenLabs console, so it
 * is not documentation — it is the agent's entire model of the world. Two ways
 * it can be wrong, and neither shows up anywhere else:
 *
 *   - it drifts from src/lib/places.ts, and she states facts the site no
 *     longer has, confidently, out loud;
 *   - it omits something the site can do, and she never offers it. Ordering
 *     and the queue both shipped without a word of it reaching her.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); }
};

const tmp = mkdtempSync(join(tmpdir(), "wain-brief-"));
const regenerate = (placesFile) => {
  const out = join(tmp, `brief-${Math.random().toString(36).slice(2)}.md`);
  execFileSync("node", ["scripts/wain-ai-brief.mjs"], {
    env: { ...process.env, WAIN_PLACES_FILE: placesFile, WAIN_BRIEF_OUT: out },
    stdio: "pipe",
  });
  return readFileSync(out, "utf8");
};

const committed = readFileSync("docs/wain-ai-agent.md", "utf8");
const places = readFileSync("src/lib/places.ts", "utf8");

console.log("\n── the committed brief matches the data ──");
{
  const fresh = regenerate("src/lib/places.ts");
  ok("docs/wain-ai-agent.md is in sync with places.ts", fresh === committed,
    "run: npm run ai:brief");
  // Every place must actually be in there. A generator that silently drops
  // one leaves شوق denying a place the site shows.
  const slugs = [...places.matchAll(/slug: "([^"]+)"/g)].map((m) => m[1]);
  const missing = slugs.filter((s) => !committed.includes(`\`${s}\``));
  ok("every shipped place is in the knowledge base", missing.length === 0, missing.join(", "));
  ok("and the count in the heading agrees",
    committed.includes(`(${slugs.length} مكان)`), `expected ${slugs.length}`);
}

console.log("\n── she is told what the site can actually do ──");
{
  ok("the brief has a services section", committed.includes("## الخدمات"));
  ok("ordering is described", committed.includes("طلب مسبق"));
  ok("the queue is described", committed.includes("الطابور"));
  ok("both client tools are still documented",
    committed.includes("show_places") && committed.includes("open_place"));
}

console.log("\n── with nothing switched on, she is told not to offer it ──");
{
  // This is the state that ships today: the features exist, no business has
  // turned either on. An agent told merely that "no place accepts orders"
  // will still cheerfully suggest ordering ahead, so the brief has to forbid
  // it rather than describe it.
  const anyOrders = /acceptsOrders: true/.test(places);
  const anyQueue = /takesQueue: true/.test(places);
  ok("no shipped place takes orders or turns yet", !anyOrders && !anyQueue,
    `orders:${anyOrders} queue:${anyQueue}`);
  ok("so she is told not to offer ordering", committed.includes("لا تعرضين على أحد يطلب"));
  ok("and not to offer a turn", committed.includes("لا تعرضين على أحد ياخذ دور"));
  ok("she is given the sentence to say if asked", committed.includes("للحين ما فيه محل مفعّلها"));
  ok("the word «مدفوع» never reaches her", !committed.includes("مدفوع"));
}

console.log("\n── and when a business does switch them on ──");
{
  // The branch that has never shipped. Without exercising it, the day someone
  // turns ordering on is the day it runs for the first time.
  const fixture = join(tmp, "places-fixture.ts");
  writeFileSync(
    fixture,
    places
      .replace(
        /(slug: "kuwait-towers",)/,
        '$1\n    acceptsOrders: true,\n    menuAr: [{ id: "m1", nameAr: "چاي", priceFils: 250 }],'
      )
      .replace(
        /(slug: "souq-al-mubarakiya",)/,
        '$1\n    takesQueue: true,\n    salonKind: "men",'
      )
  );
  const brief = regenerate(fixture);

  ok("the ordering place is named", brief.includes("`kuwait-towers`"), "");
  ok("and listed under ordering, not the queue",
    brief.split("### الطابور")[0].includes("`kuwait-towers`"));
  ok("she is no longer told to refuse ordering", !brief.includes("لا تعرضين على أحد يطلب"));
  ok("payment on collection is spelled out", brief.includes("الدفع عند الاستلام"));
  ok("and she is told never to say «مدفوع»", brief.includes("لا تقولين «مدفوع»"));

  ok("the salon is named", brief.includes("`souq-al-mubarakiya`"));
  ok("with its kind, so nobody is sent to the wrong one", brief.includes("(رجالي)"));
  ok("she is no longer told to refuse turns", !brief.includes("لا تعرضين على أحد ياخذ دور"));
  ok("the wait is framed as an estimate", brief.includes("تقديري"));

  // A menu without the switch is not consent to take orders. The site enforces
  // that; the brief must agree, or she offers ordering somewhere it is off.
  const menuOnly = join(tmp, "places-menu-only.ts");
  writeFileSync(
    menuOnly,
    places.replace(
      /(slug: "kuwait-towers",)/,
      '$1\n    menuAr: [{ id: "m1", nameAr: "چاي", priceFils: 250 }],'
    )
  );
  const b2 = regenerate(menuOnly);
  ok("a menu without the switch does not make her offer ordering",
    b2.includes("لا تعرضين على أحد يطلب"));

  // Likewise a salon that has not switched the queue on.
  const salonOnly = join(tmp, "places-salon-only.ts");
  writeFileSync(
    salonOnly,
    places.replace(/(slug: "souq-al-mubarakiya",)/, '$1\n    salonKind: "men",')
  );
  ok("being a salon is not the same as running a queue",
    regenerate(salonOnly).includes("لا تعرضين على أحد ياخذ دور"));
}

console.log("\n── the fields cannot slip against each other ──");
{
  // The generator once scraped the Place *interface* as if it were a place,
  // which shifted every value by one and told شوق the wrong price for all of
  // them. It throws on misalignment now; this proves the guard still fires.
  const broken = join(tmp, "places-broken.ts");
  writeFileSync(broken, places.replace(/ {2}category: "coffee",\n/, ""));
  let threw = false;
  try { regenerate(broken); } catch { threw = true; }
  ok("a place missing a field stops the build instead of shifting the columns", threw);
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
