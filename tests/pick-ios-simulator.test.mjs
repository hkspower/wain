/**
 * scripts/pick-ios-simulator.mjs against a recorded-shape listing: the newest
 * runtime wins even when an older one carries more phones, the large and small
 * picks differ, and the CLI prints what $GITHUB_OUTPUT expects.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pickSimulator, iosVersion } from "../scripts/pick-ios-simulator.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
const fails = [];
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); }
};

const dev = (name, udid, isAvailable = true) => ({ name, udid, isAvailable, state: "Shutdown" });
const listing = {
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-6": [
      dev("iPhone 16 Pro", "OLD-PRO"), dev("iPhone SE (3rd generation)", "OLD-SE"), dev("iPhone 16", "OLD-16"),
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-26-1": [
      dev("iPhone 17", "N-17"), dev("iPhone 17 Pro", "N-17PRO"), dev("iPhone 16 Pro", "N-16PRO"),
      dev("iPhone 16e", "N-16E"), dev("iPhone Air", "N-AIR"), dev("iPad Pro 13-inch (M5)", "N-IPAD"),
      dev("iPhone 17 Pro Max", "N-MAX"), dev("iPhone 15 Pro", "GONE", false),
    ],
    "com.apple.CoreSimulator.SimRuntime.watchOS-26-1": [dev("Apple Watch Ultra 3", "W")],
    "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [dev("iPhone 17 Pro", "N26-0")],
  },
};

console.log("\n── the picks ──");
const large = pickSimulator(listing, "large");
ok("large: the newest runtime's highest «iPhone N Pro»", large.udid === "N-17PRO" && large.runtime === "26.1", JSON.stringify(large));
const small = pickSimulator(listing, "small");
ok("small: no SE on the newest runtime, so the «e»", small.udid === "N-16E", JSON.stringify(small));
ok("an older runtime's SE does not win over the newest runtime", small.udid !== "OLD-SE");
ok("watchOS and iPads are never picked", ![large.udid, small.udid].some((u) => u === "W" || u === "N-IPAD"));
ok("iosVersion reads majors, minors, and ignores other platforms",
  String(iosVersion("com.apple.CoreSimulator.SimRuntime.iOS-26-1")) === "26,1,0" &&
    iosVersion("com.apple.CoreSimulator.SimRuntime.watchOS-26-1") === null);

const se = pickSimulator({ devices: { "com.apple.CoreSimulator.SimRuntime.iOS-18-6": listing.devices["com.apple.CoreSimulator.SimRuntime.iOS-18-6"] } }, "small");
ok("an SE is preferred when the newest runtime has one", se.udid === "OLD-SE");
let threw = false;
try { pickSimulator({ devices: {} }, "large"); } catch { threw = true; }
ok("no iPhone at all is an error, not undefined", threw);

console.log("\n── the CLI ──");
const out = execFileSync("node", [join(ROOT, "scripts/pick-ios-simulator.mjs"), "small"], { input: JSON.stringify(listing) }).toString();
ok("prints udid/name/runtime lines", out === "udid=N-16E\nname=iPhone 16e\nruntime=26.1\n", JSON.stringify(out));

console.log(`\n${fails.length ? "✗" : "✓"} pick-ios-simulator: ${pass} passed` + (fails.length ? `, ${fails.length} failed` : ""));
process.exit(fails.length ? 1 : 0);
