import {
  FILS_PER_DINAR,
  formatKwd,
  parseKwd,
  lineTotal,
  orderTotal,
  pickupSlots,
  normalisePhone,
  validateOrder,
  orderReference,
  acceptsOrders,
} from "@/lib/orders";
import { parseMenu, menuToText } from "@/components/admin/PlaceForm";

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); }
};

console.log("\n── the dinar has three decimal places ──");
{
  ok("1000 fils is one dinar", FILS_PER_DINAR === 1000);
  ok("250 fils reads as ٠٫٢٥٠", formatKwd(250) === "٠٫٢٥٠ د.ك", formatKwd(250));
  ok("2750 fils reads as ٢٫٧٥٠", formatKwd(2750) === "٢٫٧٥٠ د.ك", formatKwd(2750));
  ok("a whole dinar keeps its zeros", formatKwd(1000) === "١٫٠٠٠ د.ك", formatKwd(1000));
  ok("five fils is not five hundred", formatKwd(5) === "٠٫٠٠٥ د.ك", formatKwd(5));
  ok("zero formats", formatKwd(0) === "٠٫٠٠٠ د.ك", formatKwd(0));
}

console.log("\n── parsing what an admin types ──");
{
  ok("«0.250» is 250 fils", parseKwd("0.250") === 250);
  ok("«1.5» is 1500 fils, not 15", parseKwd("1.5") === 1500, String(parseKwd("1.5")));
  ok("«2» is 2000 fils", parseKwd("2") === 2000);
  ok("«٢٫٧٥٠» in Arabic digits parses", parseKwd("٢٫٧٥٠") === 2750, String(parseKwd("٢٫٧٥٠")));
  ok("«1.2345» is refused, not rounded", parseKwd("1.2345") === null);
  ok("«abc» is refused", parseKwd("abc") === null);
  ok("«» is refused", parseKwd("") === null);
  ok("«-1.000» is refused", parseKwd("-1.000") === null);
  ok("a round trip survives", formatKwd(parseKwd("3.125")) === "٣٫١٢٥ د.ك");
}

console.log("\n── totals are exact, which floats would not be ──");
{
  // 0.1 + 0.2 !== 0.3 in binary floating point. In fils it is just integers.
  const lines = [
    { id: "a", nameAr: "أ", priceFils: 100, qty: 1 },
    { id: "b", nameAr: "ب", priceFils: 200, qty: 1 },
  ];
  ok("0.100 + 0.200 is exactly 0.300", orderTotal(lines) === 300 && formatKwd(orderTotal(lines)) === "٠٫٣٠٠ د.ك");
  ok("quantity multiplies exactly", lineTotal({ id: "c", nameAr: "ج", priceFils: 333, qty: 3 }) === 999);
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, nameAr: "x", priceFils: 1, qty: 20 }));
  ok("twenty lines of twenty stay integral", orderTotal(many) === 400);
  ok("an empty order totals zero", orderTotal([]) === 0);
  // The classic float failure, stated as money.
  const float = 0.1 + 0.2;
  ok("the float version really is wrong (so this matters)", float !== 0.3);
}

console.log("\n── Kuwaiti phone numbers ──");
{
  ok("«51234567» is fine", normalisePhone("51234567") === "51234567");
  ok("«+965 5123 4567» is normalised", normalisePhone("+965 5123 4567") === "51234567");
  ok("«00965-66112233» is normalised", normalisePhone("00965-66112233") === "66112233");
  ok("Arabic digits are accepted", normalisePhone("٩٩٨٨٧٧٦٦") === "99887766", String(normalisePhone("٩٩٨٨٧٧٦٦")));
  ok("a landline (2…) is refused", normalisePhone("22345678") === null);
  ok("seven digits is refused", normalisePhone("5123456") === null);
  ok("nine digits is refused", normalisePhone("512345678") === null);
  ok("letters are refused", normalisePhone("call me") === null);
}

console.log("\n── pickup slots ──");
{
  const at = new Date("2026-08-20T18:05:00");
  const slots = pickupSlots(at, 4);
  ok("the first slot is not in the past", slots[0].value > "18:05", slots[0].value);
  ok("slots land on the half hour", slots.every((s) => /:(00|30)$/.test(s.value)));
  ok("slots are in order", slots.map((s) => s.value).join() === [...slots.map((s) => s.value)].sort().join());
  ok("labels are Arabic with ص/م", /[صم]$/.test(slots[0].labelAr), slots[0].labelAr);
  ok("asking for four gives four", slots.length === 4);
  // Same input, same output — the panel must not re-roll slots on re-render.
  ok("it is deterministic", JSON.stringify(pickupSlots(at, 4)) === JSON.stringify(slots));
}

console.log("\n── the order is checked before it is sent ──");
{
  const base = {
    placeSlug: "deera-cafe", placeNameAr: "مقهى الديرة",
    lines: [{ id: "a", nameAr: "كرك", priceFils: 250, qty: 2 }],
    pickupAt: "18:30", customerName: "سالم", customerPhone: "51234567", noteAr: "",
  };
  ok("a good order passes", validateOrder(base).length === 0, validateOrder(base).join(" | "));
  ok("an empty basket is caught", validateOrder({ ...base, lines: [] }).length === 1);
  ok("a bad phone is caught", validateOrder({ ...base, customerPhone: "123" }).length === 1);
  ok("a missing name is caught", validateOrder({ ...base, customerName: "" }).length === 1);
  ok("a missing time is caught", validateOrder({ ...base, pickupAt: "" }).length === 1);
  ok("a zero quantity is caught", validateOrder({ ...base, lines: [{ ...base.lines[0], qty: 0 }] }).length === 1);
  ok("21 of one item is caught", validateOrder({ ...base, lines: [{ ...base.lines[0], qty: 21 }] }).length === 1);
  ok("a fractional price is caught", validateOrder({ ...base, lines: [{ ...base.lines[0], priceFils: 1.5 }] }).length === 1);
  ok("a negative price is caught", validateOrder({ ...base, lines: [{ ...base.lines[0], priceFils: -100 }] }).length === 1);
  ok("every message is in Arabic", validateOrder({ ...base, lines: [], customerName: "" }).every((m) => /[؀-ۿ]/.test(m)));
}

console.log("\n── the menu an admin types ──");
{
  const menu = parseMenu("چاي كرك | 0.250\nقهوة عربية | 0.500\nكيك | 1.750 خلص\n\nمالها سعر");
  ok("three priced items parse", menu.length === 3, JSON.stringify(menu.map((m) => m.nameAr)));
  ok("prices become fils", menu[0].priceFils === 250 && menu[2].priceFils === 1750);
  ok("«خلص» marks an item unavailable", menu[2].soldOut === true);
  ok("a line with no price is dropped, not sold for free", !menu.some((m) => m.nameAr === "مالها سعر"));
  ok("ids are unique", new Set(menu.map((m) => m.id)).size === menu.length);
  ok("a round trip through text survives", JSON.stringify(parseMenu(menuToText(menu))) === JSON.stringify(menu));
  ok("60 items is the ceiling", parseMenu(Array.from({ length: 80 }, (_, i) => `صنف ${i} | 1.000`).join("\n")).length === 60);
}

console.log("\n── ordering is off unless a business turned it on ──");
{
  const withMenu = { acceptsOrders: true, menuAr: [{ id: "a", nameAr: "كرك", priceFils: 250 }] };
  ok("a menu plus consent opens ordering", acceptsOrders(withMenu) === true);
  ok("a menu alone does not", acceptsOrders({ menuAr: withMenu.menuAr }) === false);
  ok("consent with no menu does not", acceptsOrders({ acceptsOrders: true, menuAr: [] }) === false);
  ok("a plain seeded place does not", acceptsOrders({}) === false);
}

console.log("\n── the order reference ──");
{
  const ref = orderReference("3f8a1c2d-4e5b-6789-abcd-ef0123456789");
  ok("it is six characters", ref.length === 6, ref);
  ok("it is upper case and readable", /^[0-9A-F]{6}$/.test(ref), ref);
  ok("it is stable for one id", ref === orderReference("3f8a1c2d-4e5b-6789-abcd-ef0123456789"));
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
