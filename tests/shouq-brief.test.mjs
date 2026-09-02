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

console.log("\n── the agent the site actually calls is the one documented ──");
{
  // The call was not a call for as long as this id lived only in a repository
  // variable: the agent existed, the brief was written, and every visitor still
  // got the browser's one-question speech recognition. It is compiled in now,
  // which makes drift between the code and the brief the new way to break it —
  // a build pointing at one agent while the brief describes another.
  const src = readFileSync("src/lib/wain-ai.ts", "utf8");
  const inCode = (src.match(/DEFAULT_AGENT_ID = "([^"]+)"/) || [])[1];
  ok("the code ships a default agent id, not an empty string",
    !!inCode && inCode.startsWith("agent_"), String(inCode));
  ok("and the brief documents that same agent",
    !!inCode && committed.includes(inCode), `${inCode} not in docs/wain-ai-agent.md`);
  // An id is public by construction here — it reaches the browser — so what
  // keeps a copy from being useful is the origin lock, and the brief is where
  // that is written down.
  ok("the brief says why a public id is safe", committed.includes("require_origin_header"));
  // The off switch has to be a word the code knows. The deploy workflow tells
  // whoever reads the log that «none» ships the fallback; if that word is only
  // in the workflow, a build set to "none" calls an agent by that name.
  ok("«none» is the documented off switch, and the code implements it",
    /OFF = "none"/.test(src) && readFileSync(".github/workflows/deploy.yml", "utf8").includes('= "none"'),
    "the workflow and wain-ai.ts must agree on the sentinel");
}

console.log("\n── the two indexes cannot name a place the site does not have ──");
{
  // An index is a second copy of the catalogue in a different order, and a
  // second copy is a second thing that can be wrong. Both are generated, so
  // the only question worth asking is whether the generation still holds:
  // every name in them has to be a name in places.ts.
  const names = new Set([...places.matchAll(/nameAr: "([^"]+)"/g)].map((m) => m[1]));
  const section = (h) => {
    const a = committed.indexOf(`## ${h}`);
    const b = committed.indexOf("\n## ", a + 1);
    return committed.slice(a, b < 0 ? undefined : b);
  };
  const namesIn = (body) =>
    body.split("\n").filter((l) => l.startsWith("- **"))
      .flatMap((l) => l.slice(l.indexOf("\u2014") + 1).split("\u00b7").map((n) => n.trim()))
      .filter(Boolean);

  const interest = section("\u062d\u0633\u0628 \u0627\u0644\u0627\u0647\u062a\u0645\u0627\u0645");
  const area = section("\u062d\u0633\u0628 \u0627\u0644\u0645\u0646\u0637\u0642\u0629");
  ok("the interest index is there", interest.length > 200, String(interest.length));
  ok("the area index is there", area.length > 200, String(area.length));

  const strayInterest = namesIn(interest).filter((n) => !names.has(n));
  ok("every place named by an interest is a real place", strayInterest.length === 0,
    strayInterest.slice(0, 5).join(" | "));
  const strayArea = namesIn(area).filter((n) => !names.has(n));
  ok("every place named by an area is a real place", strayArea.length === 0,
    strayArea.slice(0, 5).join(" | "));

  // The stated rule of the interest index: nothing with only one place, since
  // that place's own row already says it. A singleton here means the filter
  // went away and the index doubled in size for no added answer.
  const singleton = interest.split("\n").filter((l) => /^- \*\*.+\*\* \(1\)/.test(l));
  ok("no interest is listed with a single place", singleton.length === 0,
    singleton.slice(0, 3).join(" | "));

  // Areas are data; governorates are not, and the brief says so rather than
  // guessing. If somebody adds a governorate grouping later, this fails and
  // they read the reason next to it.
  ok("it says why areas and not governorates",
    committed.includes("\u0645\u0646\u0627\u0637\u0642 \u0645\u0648 \u0645\u062d\u0627\u0641\u0638\u0627\u062a"));

  // The counts have to be the counts. `(23)` beside nineteen names is exactly
  // the sort of thing nobody reads closely and an agent quotes confidently.
  const badCount = [...interest.matchAll(/^- \*\*(.+?)\*\* \((\d+)\) \u2014 (.+)$/gm)]
    .filter((m) => m[3].split("\u00b7").length !== Number(m[2]))
    .map((m) => m[1]);
  ok("every interest count matches the list beside it", badCount.length === 0,
    badCount.slice(0, 3).join(" | "));
}

console.log("\n── she is told the local rules, and told what she cannot know ──");
{
  const cal = committed.slice(committed.indexOf("## \u0627\u0644\u0643\u0648\u064a\u062a \u2014 \u0627\u0644\u062a\u0642\u0648\u064a\u0645"));
  // Each of these changes an answer, and the answer is wrong without it. The
  // weekend is the clearest: recommending an outing on Friday morning sends
  // somebody to a closed door.
  for (const [needle, why] of [
    ["\u0627\u0644\u062c\u0645\u0639\u0629 \u0648\u0627\u0644\u0633\u0628\u062a", "the weekend is Friday-Saturday"],
    ["\u0631\u0645\u0636\u0627\u0646", "Ramadan turns the day around"],
    ["\u0665 \u0648\u0662\u0666 \u0641\u0628\u0631\u0627\u064a\u0631", "the national days"],
    ["\u0627\u0644\u0633\u0631\u0627\u064a\u0627\u062a", "the spring storms"],
    ["\u0627\u0644\u0643\u0634\u062a\u0629", "winter camping"],
  ]) ok(`she is told: ${why}`, cal.includes(needle), needle);

  // The honest half. She has a clock, not a calendar — Ramadan and Eid move,
  // and an agent that guesses will confidently tell somebody the restaurants
  // are shut in the middle of an ordinary March.
  ok("and told not to guess whether it is Ramadan or Eid",
    cal.includes("\u0645\u0627 \u0639\u0646\u062f\u0643 \u062a\u0642\u0648\u064a\u0645") && cal.includes("\u0644\u0627 \u062a\u062e\u0645\u0651\u0646\u064a\u0646"));

  const vocab = committed.slice(committed.indexOf("## \u0643\u0644\u0645\u0627\u062a \u0643\u0648\u064a\u062a\u064a\u0629"));
  for (const w of ["\u0643\u0634\u062a\u0629", "\u063a\u0628\u0642\u0629", "\u0627\u0644\u0631\u0628\u0639", "\u0645\u0686\u0628\u0648\u0633", "\u0643\u0631\u0643", "\u0627\u0644\u062f\u064a\u0648\u0627\u0646\u064a\u0629"])
    ok(`«${w}» is explained`, vocab.includes(w), w);
  // The one word in that list that is not a place and must not become one.
  ok("a diwaniya is named as a custom, not somewhere to be sent",
    vocab.includes("\u0645\u0648 \u0645\u0643\u0627\u0646 \u062a\u0642\u062f\u0631\u064a\u0646 \u062a\u0631\u0634\u0651\u062d\u064a\u0646\u0647"));
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
