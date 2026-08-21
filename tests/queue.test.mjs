import {
  SALON_LABEL,
  aheadAr,
  isFromToday,
  isTicketFinished,
  kuwaitToday,
  normalisePhone,
  takesQueue,
  validateJoin,
  waitEstimateAr,
} from "@/lib/queue";
import {
  DEFAULT_SERVICE_MINUTES,
  MAX_SERVICE_MINUTES,
  MIN_SERVICE_MINUTES,
  clampServiceMinutes,
} from "@/lib/places";

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); }
};

console.log("\n── a salon is one kind or the other ──");
{
  const salon = (extra) => ({ slug: "s", nameAr: "صالون", ...extra });
  ok("a men's salon with the queue on takes turns",
    takesQueue(salon({ salonKind: "men", takesQueue: true })));
  ok("a women's salon likewise",
    takesQueue(salon({ salonKind: "women", takesQueue: true })));
  ok("the switch alone is not enough — it has to be a salon",
    !takesQueue(salon({ takesQueue: true })));
  ok("being a salon is not consent to take turns",
    !takesQueue(salon({ salonKind: "men" })));
  ok("an ordinary place never does", !takesQueue(salon({})));
  ok("both kinds have an Arabic label", SALON_LABEL.men === "رجالي" && SALON_LABEL.women === "نسائي");
}

console.log("\n── the wait, said carefully ──");
{
  // Every one of these is hedged. It is position times an average that a salon
  // typed into a form once, and a number like «١٧ دقيقة» would imply a
  // precision that does not exist — which people then hold you to.
  ok("nobody ahead means it is your turn", waitEstimateAr(0, 20) === "دورك الحين تقريباً");
  ok("a negative count is treated the same", waitEstimateAr(-3, 20).includes("الحين"));
  ok("one ahead at 20 minutes is about twenty", waitEstimateAr(1, 20) === "تقريباً ٢٠ دقيقة",
    waitEstimateAr(1, 20));
  ok("it rounds to five minutes", waitEstimateAr(1, 17) === "تقريباً ١٥ دقيقة", waitEstimateAr(1, 17));
  ok("an hour is said as an hour", waitEstimateAr(3, 20) === "تقريباً ساعة", waitEstimateAr(3, 20));
  ok("two hours uses the dual", waitEstimateAr(6, 20) === "تقريباً ساعتين", waitEstimateAr(6, 20));
  ok("hours and minutes together read naturally",
    waitEstimateAr(4, 20) === "تقريباً ساعة و٢٠ دقيقة", waitEstimateAr(4, 20));
  ok("every estimate is hedged", [1, 2, 5, 9, 20].every((n) => waitEstimateAr(n, 20).startsWith("تقريباً")));
  ok("it never promises a time", ![1, 5, 20].some((n) => /الساعة|بالضبط/.test(waitEstimateAr(n, 20))));
}

console.log("\n── counting people in Arabic ──");
{
  ok("nobody", aheadAr(0) === "ما فيه أحد قدامك");
  ok("one uses the singular", aheadAr(1) === "واحد قدامك");
  ok("two uses the dual", aheadAr(2) === "اثنين قدامك");
  ok("more use the number", aheadAr(5) === "٥ قدامك", aheadAr(5));
  ok("digits are Arabic-Indic", /[٠-٩]/.test(aheadAr(12)), aheadAr(12));
}

console.log("\n── how long one customer takes ──");
{
  ok("below the floor is clamped", clampServiceMinutes(1) === MIN_SERVICE_MINUTES);
  ok("above the ceiling is clamped", clampServiceMinutes(9999) === MAX_SERVICE_MINUTES);
  ok("missing falls back to the default", clampServiceMinutes(undefined) === DEFAULT_SERVICE_MINUTES);
  ok("so does nonsense", clampServiceMinutes(NaN) === DEFAULT_SERVICE_MINUTES);
  ok("a sensible value is left alone", clampServiceMinutes(35) === 35);
  // The clamp and the CHECK on places.queue_service_minutes must agree, or the
  // form accepts a number the database then refuses.
  ok("the bounds match the database CHECK", MIN_SERVICE_MINUTES === 5 && MAX_SERVICE_MINUTES === 180);
}

console.log("\n── the day the numbering resets on ──");
{
  // Kuwait is UTC+3 all year and has no daylight saving, so this is exact.
  // Getting it wrong would restart the numbers at 3am, in the middle of a late
  // shift, with two customers holding «رقم ١».
  ok("22:00 UTC is already tomorrow in Kuwait",
    kuwaitToday(new Date("2026-08-20T22:00:00Z")) === "2026-08-21",
    kuwaitToday(new Date("2026-08-20T22:00:00Z")));
  ok("20:59 UTC is still today",
    kuwaitToday(new Date("2026-08-20T20:59:00Z")) === "2026-08-20",
    kuwaitToday(new Date("2026-08-20T20:59:00Z")));
  ok("midnight UTC is the same day in Kuwait",
    kuwaitToday(new Date("2026-08-20T00:00:00Z")) === "2026-08-20");
  ok("21:00 UTC is the turnover",
    kuwaitToday(new Date("2026-08-20T21:00:00Z")) === "2026-08-21");

  const now = new Date("2026-08-20T10:00:00Z");
  ok("today's ticket counts", isFromToday({ day: "2026-08-20" }, now));
  ok("yesterday's does not", !isFromToday({ day: "2026-08-19" }, now));
}

console.log("\n── what is over and what is not ──");
{
  ok("waiting is live", !isTicketFinished("waiting"));
  ok("called is live", !isTicketFinished("called"));
  ok("served is over", isTicketFinished("served"));
  ok("a no-show is over", isTicketFinished("no_show"));
  ok("leaving is over", isTicketFinished("left"));
}

console.log("\n── who is joining ──");
{
  const base = { placeSlug: "s", placeNameAr: "صالون", salonKind: "men", customerName: "سالم", customerPhone: "51234567" };
  ok("a good join passes", validateJoin(base).length === 0, validateJoin(base).join(" | "));
  ok("a missing name is caught", validateJoin({ ...base, customerName: "" }).length === 1);
  ok("a landline is refused", validateJoin({ ...base, customerPhone: "22345678" }).length === 1);
  ok("a Kuwaiti mobile with the country code is accepted", normalisePhone("+965 5123 4567") === "51234567");
  ok("Arabic digits are accepted", normalisePhone("٥١٢٣٤٥٦٧") === "51234567");
  ok("seven digits are refused", normalisePhone("5123456") === null);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
