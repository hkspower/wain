// The Unreal connector asks for fields the API actually sends.
//
//   npm run dev                       (or point it at a running build)
//   npm run check:connector
//   npm run check:connector -- --url http://192.168.1.20:3000
//
// WHY THIS IS ITS OWN CHECK
//
// GRNApi is built to fall back. If the fetch fails, or succeeds and the
// payload is not the shape it expected, it logs a warning and uses the
// tables baked into GRNTypes.h — and the game plays exactly as before.
// That is the right design and it is also the reason a broken connector
// is invisible: a Mac that cannot reach the server, a field that got
// renamed, and a perfectly working link all look identical from inside
// the game.
//
// check:unreal already compares the BAKED tables against the API. This
// compares the LIVE PATH: every JSON field GRNApi.cpp reads by name has
// to exist in the payload the server is serving right now.
//
// It runs from anywhere with a URL, which is the point — the same
// command answers "is my Mac's connector going to work" from the Mac,
// pointed at whichever machine is serving.
import { readFileSync } from "node:fs";

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const BASE = (arg("--url", process.env.GRN_API ?? "http://localhost:3000")).replace(/\/$/, "");
const SRC = "unreal/Source/GulfRoadNights/GRNApi.cpp";

const problems = [];
const bad = (m) => problems.push(m);

// ---- What the connector reads OUT OF THE GAMEDATA PAYLOAD -------------
//
// Scraped rather than listed here on purpose: a list in this file is a
// second copy of the contract, and a second copy is what drifts. If
// somebody adds a GetStringField the check learns about it for free.
//
// Scoped to ParseGameData, though, and that scoping is the whole
// difference between a useful check and a noisy one. GRNApi talks to
// TWO servers — the web build's /api/grn/v1 and the hub's /api/v1 — and
// the first version of this scraped the whole file, then reported
// "career", "kd" and "rivalIndex" as missing from the gamedata payload.
// They are not missing. They come back from the hub's career endpoint,
// which is a different server answering a different question.
const cpp = readFileSync(SRC, "utf8");
const parseFn = (() => {
  const start = cpp.indexOf("void UGRNApiSubsystem::ParseGameData");
  if (start < 0) return null;
  // To the next function at column 0, which is where this one ends.
  const rest = cpp.slice(start + 1);
  const end = rest.search(/\n(?:void|bool|int32|FGRN|const)\s+\w+\s+?UGRNApiSubsystem::|\n\w[\w:&<>\s*]*UGRNApiSubsystem::/);
  return end < 0 ? cpp.slice(start) : cpp.slice(start, start + 1 + end);
})();
if (!parseFn) {
  console.log(`\n${SRC} no longer has a ParseGameData to read — this check cannot say anything.`);
  process.exit(2);
}
const reads = new Set();
for (const m of parseFn.matchAll(
  /(?:Try)?Get(?:String|Number|Bool|Array|Object|Integer)Field\w*\(\s*TEXT\("([A-Za-z0-9_]+)"\)/g
)) {
  reads.add(m[1]);
}
console.log(`connector    ParseGameData reads ${reads.size} field names out of the payload`);

// ---- What the server is actually serving ------------------------------
let payload;
try {
  const r = await fetch(`${BASE}/api/grn/v1/gamedata`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  payload = await r.json();
} catch (e) {
  console.log(`\ncould not reach ${BASE}/api/grn/v1/gamedata: ${e.message}`);
  console.log(
    "\nThat is the same failure the game would have, and the game would not tell you:\n" +
      "  it logs a warning to LogTemp and plays on with the baked tables.\n" +
      "  Start the web build (npm run dev), or pass --url for the machine serving it."
  );
  process.exit(2);
}

// Every key present anywhere in the payload, at any depth. A field the
// connector reads out of a rival is not in the same object as one it
// reads out of a car, and this check is about NAMES existing, not about
// where they sit — the shape is check:unreal's job.
const present = new Set();
const walk = (v) => {
  if (Array.isArray(v)) return v.forEach(walk);
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      present.add(k);
      walk(x);
    }
  }
};
walk(payload);
console.log(`payload      ${BASE} serves apiVersion ${payload.apiVersion}, ${present.size} distinct field names`);

// ---- 1. Every field the connector names is in the payload -------------
{
  const missing = [...reads].filter((f) => !present.has(f)).sort();
  for (const f of missing) {
    bad(`GRNApi.cpp reads "${f}" and the payload has no such field — it will silently take the baked value`);
  }
  console.log(
    `fields       ${reads.size - missing.length}/${reads.size} of the connector's fields exist in the payload` +
      (missing.length ? `  MISSING: ${missing.join(", ")}` : "")
  );
}

// ---- 2. The version the connector understands is the one served -------
{
  const m = /#define\s+GRN_API_VERSION\s+(\d+)/.exec(
    readFileSync("unreal/Source/GulfRoadNights/GRNApi.h", "utf8")
  );
  const want = m ? +m[1] : null;
  if (want === null) bad("GRNApi.h no longer defines GRN_API_VERSION");
  else if (want !== payload.apiVersion) {
    bad(`the connector understands apiVersion ${want} and the server serves ${payload.apiVersion}`);
  }
  console.log(`version      connector ${want}, server ${payload.apiVersion}`);
}

// ---- 3. The tables it needs are non-empty -----------------------------
//
// A payload that parses but carries nothing takes the same silent
// fallback as no payload at all.
{
  // `track` is an OBJECT carrying controlPoints, not an array of them —
  // the first version of this looked for track.points, found nothing,
  // and reported an empty track on a payload with sixteen of them.
  const trackPoints = Array.isArray(payload.track)
    ? payload.track
    : payload.track?.controlPoints ?? [];
  const counts = { rivals: payload.rivals?.length ?? 0, cars: payload.cars?.length ?? 0, track: trackPoints.length };
  for (const [key, n] of Object.entries(counts)) {
    if (!n) bad(`the payload's ${key} is empty — the connector would fall back to the baked table`);
  }
  const nTrack = counts.track;
  console.log(
    `tables       ${payload.rivals?.length ?? 0} rivals, ${payload.cars?.length ?? 0} cars, ${nTrack} track points`
  );
}

// ---- 4. The hub is reachable, or says plainly that it is not ----------
//
// Reported, not failed. The hub is a separate server and a single-player
// session does not need it; what is not acceptable is not knowing.
{
  const hub = arg("--hub", process.env.GRN_HUB ?? "http://localhost:8787");
  try {
    const r = await fetch(`${hub.replace(/\/$/, "")}/api/v1/leaderboard`, {
      signal: AbortSignal.timeout(4000),
    });
    console.log(`hub          ${hub} answered ${r.status}`);
  } catch {
    console.log(`hub          ${hub} is not answering — lap upload and cloud careers will be off`);
  }
}

console.log(
  "\nchecked      the connector's field names, its API version, and that the\n" +
    "             tables it needs are not empty.\n" +
    "not checked  whether Unreal can reach this URL from where IT runs. On a Mac\n" +
    "             that is a different question — see unreal/README.md, macOS."
);

if (problems.length) {
  console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:\n`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log("\nthe Unreal connector and this server agree.");
