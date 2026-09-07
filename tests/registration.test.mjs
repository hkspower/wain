import { fillWhatTheOwnerNeedNotWrite } from "@/lib/submissions";

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); }
};

/** Everything the form asks for, filled the way a careful owner would. */
const full = {
  name: "Deera Cafe", nameAr: "مقهى الديرة", category: "coffee",
  areaAr: "السالمية", addressAr: "", lat: null, lng: null, priceLevel: 2,
  taglineAr: "قهوة مختصة وجلسة هادية على البحر.", descriptionAr: "",
  bioAr: "", productsAr: [], logoPath: null, imagePaths: [],
  phone: "", instagram: "", website: "",
  contactName: "سالم", contactEmail: "s@example.com", contactPhone: "",
};

console.log("\n── what the owner wrote is what gets sent ──");
{
  const r = fillWhatTheOwnerNeedNotWrite(full);
  ok("the English name is kept", r.name === "Deera Cafe", r.name);
  ok("the tagline is kept", r.taglineAr === full.taglineAr, r.taglineAr);
}

console.log("\n── the English name is optional, and never invented ──");
{
  const r = fillWhatTheOwnerNeedNotWrite({ ...full, name: "" });
  ok("a blank English name falls back to the Arabic one", r.name === "مقهى الديرة", r.name);
  ok("and clears the table's two-character floor", r.name.trim().length >= 2);
  const spaces = fillWhatTheOwnerNeedNotWrite({ ...full, name: "   " });
  ok("whitespace counts as blank", spaces.name === "مقهى الديرة", spaces.name);
}

console.log("\n── the tagline is optional, and the fallback is a fact ──");
{
  const r = fillWhatTheOwnerNeedNotWrite({ ...full, taglineAr: "" });
  ok("a blank tagline becomes «الاسم في المنطقة»",
    r.taglineAr === "مقهى الديرة في السالمية", r.taglineAr);
  // The table's own floor. A two-character name in a two-character area is
  // the shortest thing the form will accept, and it still has to clear four.
  const tiny = fillWhatTheOwnerNeedNotWrite({ ...full, nameAr: "به", areaAr: "بر", taglineAr: "" });
  ok("even the shortest allowed name and area clear the four-character floor",
    tiny.taglineAr.trim().length >= 4, `${tiny.taglineAr} (${tiny.taglineAr.trim().length})`);
  // The longest name and area the form and table both allow are 120 and 80,
  // which is 204 characters once joined — over the 160 the tagline column
  // accepts. Unclamped, the easier form would have started failing at the
  // database for exactly the businesses with the longest names.
  const long = fillWhatTheOwnerNeedNotWrite({
    ...full, nameAr: "م".repeat(120), areaAr: "ا".repeat(80), taglineAr: "",
  });
  ok("a long name and area are clamped to the 160 the table allows",
    long.taglineAr.length <= 160, `${long.taglineAr.length} characters`);
  ok("and the clamp does not leave a trailing space",
    long.taglineAr === long.taglineAr.trimEnd());
}

console.log("\n── a tagline too short to be meant is not padded out ──");
{
  // Three characters is a slip, and validate() in the form rejects it rather
  // than letting this quietly replace it with something the owner did not say.
  const r = fillWhatTheOwnerNeedNotWrite({ ...full, taglineAr: "قهو" });
  ok("a too-short tagline is replaced rather than sent and rejected",
    r.taglineAr === "مقهى الديرة في السالمية", r.taglineAr);
}

console.log("\n── it reads what it was given, and changes nothing else ──");
{
  const input = { ...full, name: "", taglineAr: "" };
  const copy = JSON.parse(JSON.stringify(input));
  fillWhatTheOwnerNeedNotWrite(input);
  ok("the input is not mutated", JSON.stringify(input) === JSON.stringify(copy));
  ok("names are trimmed on the way out",
    fillWhatTheOwnerNeedNotWrite({ ...full, name: "  Deera Cafe  " }).name === "Deera Cafe");
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
