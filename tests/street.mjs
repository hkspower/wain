// The street at ground level — measured on the built world, not on the
// layout that built it.
//
//   npm run dev            # in another shell
//   npm run test:street
//
// src/game/street.ts lays the kerbs, the footway, the gullies, the
// manholes and the furniture out as pure numbers; this fires rays at the
// scene and reads the instance matrices back, and asks whether a kerb
// stands where a kerb-height camera will look for it, whether a cover
// ever sits on paint, whether the rail really opens at the junctions it
// says it does, and whether anything stands in the road.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug && !!window.__grnStreetDetail, null, { timeout: 180000 });

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const r = await page.evaluate(async () => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const track = e.track;
  const L = track.length;
  const scene = e.scene;
  const D = window.__grnStreetDetail;
  const J = window.__grnJunctions;
  const S = window.__grnStreets;
  const COAST = window.__grnCoastU;
  e.setPaused(true);
  scene.updateMatrixWorld(true);
  const hw = (s) => track.halfWidthAt(s);

  const byName = {};
  scene.traverse((o) => { if (o.name) (byName[o.name] ??= []).push(o); });
  const one = (n) => (byName[n] ?? [])[0] ?? null;

  // World (x, z) back to (s, lat): the nearest centreline sample, then a
  // fine search either side of it.
  const N = Math.ceil(L / 2);
  const cs = new Float64Array(N * 2);
  const pt = new THREE.Vector3(), sd = new THREE.Vector3();
  for (let i = 0; i < N; i++) { track.pointAt((i / N) * L, pt); cs[i * 2] = pt.x; cs[i * 2 + 1] = pt.z; }
  const toTrack = (x, z) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < N; i++) { const d = (cs[i * 2] - x) ** 2 + (cs[i * 2 + 1] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    let s = (best / N) * L, bs = s;
    bd = Infinity;
    for (let ds = -2.5; ds <= 2.5; ds += 0.05) {
      track.pointAt(s + ds, pt);
      const d = (pt.x - x) ** 2 + (pt.z - z) ** 2;
      if (d < bd) { bd = d; bs = s + ds; }
    }
    track.pointAt(bs, pt); track.sideAt(bs, sd);
    return { s: track.wrap(bs), lat: (x - pt.x) * sd.x + (z - pt.z) * sd.z };
  };
  const instances = (name) => {
    const m = one(name);
    if (!m) return null;
    const out = [];
    const M = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (let i = 0; i < m.count; i++) {
      m.getMatrixAt(i, M);
      // A hidden slot is a zero matrix. Read it raw: decompose() on a
      // zero scale gives NaN, and NaN < 0.5 is false, so a hidden slot
      // read through decompose counts as standing.
      const el = M.elements;
      const visible = !(el[0] === 0 && el[5] === 0 && el[10] === 0);
      M.decompose(p, q, sc);
      out.push({ i, x: el[12], y: el[13], z: el[14], visible, ...toTrack(el[12], el[14]) });
    }
    return out;
  };

  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  // Solid things only: the lamps' additive pools and the wet-road
  // streaks are planes on the road that a ray would otherwise hit first.
  const solids = [];
  scene.traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh) || !o.visible || o.isSprite) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.transparent || m.blending !== THREE.NormalBlending || m.depthWrite === false) return;
    solids.push(o);
  });
  const hitsAt = (s, lat, from = 5) => {
    track.pose(s, lat, pt, sd);
    ray.set(new THREE.Vector3(pt.x, from, pt.z), down);
    return ray.intersectObjects(solids, false).map((h) => ({ name: h.object.name, y: h.point.y }));
  };
  const first = (s, lat, from) => hitsAt(s, lat, from)[0] ?? null;

  const tunnelU = window.__grnTunnelU;
  const inTunnel = (s) => { const u = track.wrap(s) / L; return u > tunnelU.from - D.tunnelMarginU && u < tunnelU.to + D.tunnelMarginU; };
  const nearJ = (s, m) => J.some((j) => Math.abs(track.deltaAhead(j.s, s)) < m);
  const swollen = (s) => hw(s) > 7 + D.swellTol;
  const onCoast = (s) => { const u = track.wrap(s) / L; return u >= COAST.from && u <= COAST.to; };

  // --- 1. The kerb, both sides, and the footway inland ------------------
  const kerb = { ok: 0, missing: [], footway: 0, footwayMissing: [], coastFootway: 0, strip: 0, stripBad: [] };
  const KERB_LAT = (D.kerb.inner + D.kerb.outer) / 2;
  let sampled = 0;
  for (let i = 0; i < 160 && sampled < 48; i++) {
    const s = (i / 160) * L + 7;
    if (inTunnel(s) || nearJ(s, 9) || swollen(s) || Math.abs(s % 42) < 1.5 || Math.abs((s % 42) - 42) < 1.5) continue;
    sampled++;
    for (const edge of [1, -1]) {
      const h = first(s, edge * (hw(s) + KERB_LAT), 1);
      if (h && (h.name === "kerb" || h.name === "kerb-paint") && h.y > D.kerb.top - 0.012 && h.y < D.kerb.top + 0.012) kerb.ok++;
      else kerb.missing.push(`${s.toFixed(0)}:${edge}:${h ? `${h.name}@${h.y.toFixed(3)}` : "nothing"}`);
      // The strip inboard of the kerb is still asphalt.
      const st = first(s, edge * (hw(s) + 0.4), 1);
      if (st && (st.name === "road" || st.name === "plaza-kerb")) kerb.strip++; else kerb.stripBad.push(`${s.toFixed(0)}:${edge}:${st?.name}`);
    }
    const fw = first(s, hw(s) + (D.footway.inner + D.footway.outer) / 2, 1);
    // A bus shelter's plinth stands on the footway; beside one the slab
    // is what the ray finds, and that is right.
    if (fw && (fw.name === "footway" || fw.name === "bus-shelter") && Math.abs(fw.y - D.footway.y) < 0.03) kerb.footway++;
    else kerb.footwayMissing.push(`${s.toFixed(0)}:${fw ? `${fw.name}@${fw.y.toFixed(3)}` : "nothing"}`);
    if (!onCoast(s)) {
      const cf = hitsAt(s, -(hw(s) + (D.footway.inner + D.footway.outer) / 2), 1).some((h) => h.name === "footway");
      if (cf) kerb.coastFootway++;
    }
  }
  kerb.sampled = sampled;

  // --- 2. Gullies ---------------------------------------------------------
  const gullies = instances("kerb-gully") ?? [];
  const posts = instances("guardrail-post") ?? [];
  const gully = { visible: 0, offPhase: 0, offLat: 0, nearPost: 0, worstPost: Infinity };
  for (const g of gullies) {
    if (!g.visible) continue;
    gully.visible++;
    const ph = ((g.s - D.gully.phase) % D.gully.every + D.gully.every) % D.gully.every;
    if (Math.min(ph, D.gully.every - ph) > 0.05) gully.offPhase++;
    const off = Math.abs(g.lat) - hw(g.s);
    if (off < D.gully.lat - D.gully.size / 2 - 0.02 || off > D.gully.lat + D.gully.size / 2 + 0.02) gully.offLat++;
    let nearest = Infinity;
    for (const p of posts) if (p.visible && Math.sign(p.lat) === Math.sign(g.lat)) nearest = Math.min(nearest, Math.abs(track.deltaAhead(p.s, g.s)));
    gully.worstPost = Math.min(gully.worstPost, nearest);
    if (nearest < 1.9) gully.nearPost++;
  }

  // --- 3. Manholes ----------------------------------------------------------
  const manholes = instances("road-manhole") ?? [];
  const mh = { visible: 0, highway: 0, onPaint: [], offRoad: [] };
  const PAINT = /^(road-(line|dash|stop|approach|arrow|stud|legend|zebra)|street-(dash|stop))/;
  for (const m of manholes) {
    if (!m.visible) continue;
    mh.visible++;
    if (Math.abs(m.lat) < 7) mh.highway++;
    const rr = D.manhole.d / 2 + 0.02;
    for (const [ds, dl] of [[0, 0], [rr, 0], [-rr, 0], [0, rr], [0, -rr]]) {
      // Under a parked car or a passing one: only what lies on the road.
      const hs = hitsAt(m.s + ds, m.lat + dl, 1).filter((h) => h.y < 0.3);
      const paint = hs.find((h) => PAINT.test(h.name));
      if (paint) { mh.onPaint.push(`${m.s.toFixed(0)}@${m.lat.toFixed(2)}:${paint.name}`); break; }
      const f = hs.find((h) => h.name !== "road-manhole");
      if (!f || !(f.name === "road" || f.name === "streets")) { mh.offRoad.push(`${m.s.toFixed(0)}@${m.lat.toFixed(2)}:${f?.name}`); break; }
    }
  }

  // --- 4. The rail opens at the junctions, and only there --------------------
  const rail = { closed: [], open: [], flankMissing: [], postsInGap: 0, postsHiddenOutside: 0, gaps: 0 };
  for (const j of J) {
    for (const edge of [1, -1]) {
      const street = edge > 0 ? j.plus : j.minus;
      const shouldOpen = j.open && street;
      if (shouldOpen) rail.gaps++;
      // 40 mm outboard of the bolt line, on the beam's face: a ray down
      // the lip itself grazes it.
      const hit = hitsAt(j.s, edge * (hw(j.s) + 0.64), 2).some((h) => h.name === "guardrail");
      if (shouldOpen && hit) rail.closed.push(`${j.i}:${edge}`);
      if (!shouldOpen && !hit) rail.open.push(`${j.i}:${edge}`);
      for (const ds of [-9, 9]) {
        const s = j.s + ds;
        if (inTunnel(s)) continue;
        const fh = hitsAt(s, edge * (hw(s) + 0.64), 2);
        if (!fh.some((h) => h.name === "guardrail")) rail.flankMissing.push(`${j.i}:${edge}:${ds}:${fh.map((h) => `${h.name || "?"}@${h.y.toFixed(2)}`).slice(0, 3).join("/")}`);
      }
    }
  }
  for (const p of posts) {
    // The world hides a post within 0.3 m of a gap's end as well (its
    // 0.14 m body would stand in the terminal's flare).
    const inGap = J.some((j) => j.open && (p.lat > 0 ? j.plus : j.minus) && Math.abs(track.deltaAhead(j.s, p.s)) < D.railGap.half + 0.31);
    if (inGap && p.visible) rail.postsInGap++;
    if (!inGap && !p.visible) rail.postsHiddenOutside++;
  }

  // --- 5. Nothing stands in the road; the stops are inland ------------------
  const props = {};
  for (const name of ["bus-shelter", "utility-cabinet", "street-bin", "street-bollard", "speed-sign"]) {
    const list = instances(name);
    if (!list) { props[name] = null; continue; }
    const vis = list.filter((p) => p.visible);
    props[name] = {
      visible: vis.length,
      inRoad: vis.filter((p) => Math.abs(p.lat) < hw(p.s) + 0.8).length,
      inTunnel: vis.filter((p) => inTunnel(p.s)).length,
      swollen: vis.filter((p) => swollen(p.s)).length,
      seaward: vis.filter((p) => p.lat < 0).length,
    };
  }
  const columns = instances("street-columns") ?? [];
  const shelters = (instances("bus-shelter") ?? []).filter((p) => p.visible);
  const shelter = { count: shelters.length, nearColumn: 0, nearJunction: 0, worstColumn: Infinity };
  for (const sh of shelters) {
    let nearest = Infinity;
    for (const c of columns) if (c.visible && c.lat > 0) nearest = Math.min(nearest, Math.abs(track.deltaAhead(c.s, sh.s)));
    shelter.worstColumn = Math.min(shelter.worstColumn, nearest);
    if (nearest < D.shelter.columnClear + D.shelter.length / 2 - 0.1) shelter.nearColumn++;
    if (nearJ(sh.s, D.shelter.junctionClear + D.shelter.length / 2 - 0.1)) shelter.nearJunction++;
  }

  // --- 6. Zebra crossings at the signalised junctions ------------------------
  const zebra = instances("road-zebra") ?? [];
  const sigOpen = J.filter((j) => j.signalised && j.open);
  const zb = { visible: zebra.filter((z) => z.visible).length, expected: sigOpen.length * 14, misplaced: 0 };
  const M = window.__grnMarkings;
  for (const z of zebra) {
    if (!z.visible) continue;
    const j = J.reduce((b, jj) => (Math.abs(track.deltaAhead(jj.s, z.s)) < Math.abs(track.deltaAhead(b.s, z.s)) ? jj : b), J[0]);
    const d = track.deltaAhead(j.s, z.s);
    const stopDown = -M.stop.setback + M.stop.width / 2;
    if (d - M.zebra.length / 2 < stopDown + 1.1 - 0.02 || d + M.zebra.length / 2 > -S.half + 0.02) zb.misplaced++;
  }

  return { L, kerb, gully, mh, rail, props, shelter, zb, kerbPaint: !!one("kerb-paint"), drops: (instances("kerb-drop") ?? []).filter((d) => d.visible).length };
});

if (r.missing) { console.log(`missing: ${r.missing}`); process.exit(1); }

console.log(`kerb        ${r.kerb.ok} of ${r.kerb.sampled * 2} samples stand at ${r.kerb.ok ? "kerb height" : "?"}; footway inland at ${r.kerb.footway} of ${r.kerb.sampled}; strip asphalt at ${r.kerb.strip}  ` +
  check(r.kerb.missing.length === 0, `no kerb at: ${r.kerb.missing.slice(0, 6).join(", ")}`) + " " +
  check(r.kerb.footwayMissing.length === 0, `no footway at: ${r.kerb.footwayMissing.slice(0, 6).join(", ")}`) + " " +
  check(r.kerb.stripBad.length === 0, `the strip is not asphalt at: ${r.kerb.stripBad.slice(0, 6).join(", ")}`) + " " +
  check(r.kerb.coastFootway === 0, `${r.kerb.coastFootway} footway hits on the seaward side`) + " " +
  check(r.kerbPaint && r.drops > 0, `kerb paint ${r.kerbPaint}, ${r.drops} dropped kerbs`));
console.log(`gullies     ${r.gully.visible} visible, nearest post ${r.gully.worstPost.toFixed(2)} m  ` +
  check(r.gully.visible > r.L / 30, `${r.gully.visible} gullies on ${r.L.toFixed(0)} m`) + " " +
  check(r.gully.offPhase === 0, `${r.gully.offPhase} gullies off the 24 m phase`) + " " +
  check(r.gully.offLat === 0, `${r.gully.offLat} gullies off the kerb foot`) + " " +
  check(r.gully.nearPost === 0, `${r.gully.nearPost} gullies within 1.9 m of a rail post`));
console.log(`manholes    ${r.mh.visible} visible, ${r.mh.highway} on the highway  ` +
  check(r.mh.highway >= r.L / 100, `${r.mh.highway} highway covers on ${r.L.toFixed(0)} m — one per 100 m at least`) + " " +
  check(r.mh.onPaint.length === 0, `covers on paint: ${r.mh.onPaint.slice(0, 5).join(", ")}`) + " " +
  check(r.mh.offRoad.length === 0, `covers off the tarmac: ${r.mh.offRoad.slice(0, 5).join(", ")}`));
console.log(`rail gaps   ${r.rail.gaps} open arms  ` +
  check(r.rail.gaps > 100, `only ${r.rail.gaps} open arms`) + " " +
  check(r.rail.closed.length === 0, `rail across an open mouth at: ${r.rail.closed.slice(0, 6).join(", ")}`) + " " +
  check(r.rail.open.length === 0, `no rail at a closed junction: ${r.rail.open.slice(0, 6).join(", ")}`) + " " +
  check(r.rail.flankMissing.length === 0, `rail missing 9 m from a junction: ${r.rail.flankMissing.slice(0, 6).join(", ")}`) + " " +
  check(r.rail.postsInGap === 0, `${r.rail.postsInGap} posts standing in a gap`) + " " +
  check(r.rail.postsHiddenOutside === 0, `${r.rail.postsHiddenOutside} posts hidden outside any gap`));
for (const [name, p] of Object.entries(r.props)) {
  console.log(`${name.padEnd(12)}${p ? `${p.visible} standing` : "MISSING"}  ` +
    check(!!p, `${name} is not built`) + " " +
    check(p && p.visible > 0, `no ${name} stands anywhere`) + " " +
    check(p && p.inRoad === 0, `${p?.inRoad} ${name} stand in the road`) + " " +
    check(p && p.inTunnel === 0, `${p?.inTunnel} ${name} in the tunnel`) + " " +
    check(p && p.swollen === 0, `${p?.swollen} ${name} on swollen tarmac`) + " " +
    (name === "street-bollard" ? "" : check(p && p.seaward === 0, `${p?.seaward} ${name} on the seaward side`)));
}
console.log(`shelters    ${r.shelter.count}, nearest column ${r.shelter.worstColumn.toFixed(1)} m  ` +
  check(r.shelter.count >= 14 && r.shelter.count <= 25, `${r.shelter.count} shelters on ${r.L.toFixed(0)} m — one every 350-450 m, less the ones that cannot stand`) + " " +
  check(r.shelter.nearColumn === 0, `${r.shelter.nearColumn} shelters against a lamp column`) + " " +
  check(r.shelter.nearJunction === 0, `${r.shelter.nearJunction} shelters in a junction`));
console.log(`zebra       ${r.zb.visible} stripes for ${r.zb.expected} expected  ` +
  check(r.zb.visible === r.zb.expected, `${r.zb.visible} zebra stripes, expected ${r.zb.expected}`) + " " +
  check(r.zb.misplaced === 0, `${r.zb.misplaced} stripes outside the band between the stop line and the kerb`));

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe street has a kerb, a footway, drains, covers, open junctions, crossings and somewhere to wait for a bus");
await browser.close();
process.exit(fail.length ? 1 : 0);
