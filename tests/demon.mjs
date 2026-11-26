// The Black Demon, checked the way it is sold and the way it is seen.
//
//   npm run dev
//   npm run test:demon
//
// This car is four claims and each one is a different kind of thing, so
// each is measured differently rather than all of them being read off
// the record:
//
//   rare      Two keys, not one bigger number. The showroom asks for
//             every legend AND for the GTR to already be in the
//             driveway, and the card says which one is missing. Driven
//             through the real UI, because "the rule returns 8" and
//             "the button is dead and says why" are different claims
//             and only the second is the game.
//   black     The paint, the glass and the wheels. Not sampled off the
//             record — that would only prove the record — but read off
//             the built car's own materials.
//   marked    Four demon marks, on four sides, each lying ON its panel
//             rather than in it or above it, and that nothing is on
//             top of it. Measured from the mark, along its own normal.
//   once      A car that also buys the rally pack does not end up with
//             two horned skulls 20 mm apart, and a car that buys gold
//             rims gets gold rims — which is the bug the one-place
//             wheel rule was extracted to fix, and it is here because a
//             refactor nobody tried to break is a comment.
//   moves     Driven in the real engine (a steady run, a 200 km/h stop,
//             full lock, a slide): every tyre lays the road at its own
//             radius, every hub stays on it, the nose tyre steers inside
//             its opening and stays under the bonnet, the rear tyres stay
//             clear of the cut body.
//   three     Three wheels, the nose one in view, and the rear pair 1.4
//             times the fleet's tyre, in proportion, standing in holes
//             cut for them, each with its own brake and its own rate of
//             roll — measured against the same body built with four
//             ordinary wheels in the same page.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}

const DEMON = "black-demon";
const GTR = "zeta-300-gtr";
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

/** The menu, with a save that has this much money, this much career
 *  behind it and these cars in the driveway — then the showroom open. */
const showroom = async (kd, beaten, cars) => {
  await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
  await page.evaluate(
    ([money, won, owned]) => {
      localStorage.clear();
      localStorage.setItem("gulf-road-nights-onboarded", "2");
      localStorage.setItem("gulf-road-nights-coach", "3");
      localStorage.setItem("gulf-road-nights-progress", String(won));
      localStorage.setItem(
        "gulf-road-nights-garage",
        JSON.stringify({ kd: money, cars: owned, car: owned[0], builds: {} })
      );
    },
    [kd, beaten, cars]
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.click("text=GARAGE");
  // Wait for the CARD, not for the word SHOWROOM. That word is on two
  // elements — a tab and a heading — and the first of them is not the
  // one that becomes visible, so the wait timed out on a garage that had
  // opened correctly. The card is also the thing every check below
  // reads, so waiting for it is waiting for the right event.
  await page.waitForSelector("text=Black Demon", { timeout: 60000 });
  await page.waitForTimeout(500);
};

const card = () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Black Demon")
    );
    if (!b) return null;
    return { disabled: b.disabled, text: b.textContent.replace(/\s+/g, " ").trim() };
  });

// ---- 1. Rare, and rare in a way the roster cannot already express ----
//
// Every legend beaten, all the money in the world, and it is still not
// for sale. That is the whole point of the second key: the first one
// has run out of room at eight, so a car behind eight is exactly as
// rare as the car already behind eight.
await showroom(9999999, 8, ["wain-special"]);
const done = await card();
console.log(
  `finished  ${check(
    done && done.disabled,
    !done
      ? "the Black Demon is not in the showroom at all — a car you cannot see is not rare, it is absent"
      : "a save that has beaten every legend can buy it, so it is exactly as rare as the GTR"
  )}  every legend beaten, ${done?.disabled ? "still not for sale" : "FOR SALE"}`
);
console.log(
  `says why  ${check(
    done && /own the Zeta 300 GTR first/i.test(done.text),
    `the card does not say what is missing: "${done?.text?.slice(0, 100)}"`
  )}  "${(done?.text ?? "").match(/Not for sale[^·]*/i)?.[0]?.trim() ?? "—"}"`
);
// And not money, which is the failure mode the GTR's own test found:
// a card that says "need N more" when money is not the missing piece.
console.log(
  `not money ${check(
    done && !/need .* more/i.test(done.text),
    "the card blames money for a lock that has nothing to do with money"
  )}  the card does not blame the wallet`
);

// ---- 2. And with the GTR in the driveway, it is for sale -------------
await showroom(9999999, 8, ["wain-special", GTR]);
const open = await card();
console.log(
  `unlocks   ${check(
    open && !open.disabled && /420,000 KD/.test(open.text),
    open?.disabled
      ? "owning the GTR does not open it, so nothing does"
      : `the card does not offer it: "${open?.text?.slice(0, 100)}"`
  )}  with the GTR owned: ${open?.disabled ? "STILL SHUT" : "for sale"}`
);

// The other half of the same rule still holds: the GTR in the driveway
// but the roster unfinished must not open it either.
await showroom(9999999, 3, ["wain-special", GTR]);
const half = await card();
console.log(
  `both keys ${check(
    half && half.disabled && /beat 5 more legends/i.test(half.text),
    `the GTR alone opened it, or the card said the wrong thing: "${half?.text?.slice(0, 100)}"`
  )}  GTR owned but 3 legends beaten: still shut`
);

// ---- 3. Black: the paint, the glass and the wheels -------------------
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnBuildCar, null, { timeout: 180000 });
await page.waitForTimeout(1200);

// The record is read IN the page, out of the module the game itself
// reads, so none of what follows can pass against a car that only
// exists in this file.
const look = await page.evaluate(async (id) => {
  const THREE = window.__grnThree;
  const car = window.__grnShowroom.car(id);
  const g = window.__grnBuildCar({
    body: car.color,
    style: car.style,
    kit: car.kit,
    raceKit: car.kit === "attack",
    finish: car.finish,
    lengthM: car.lengthM,
    tint: car.glass?.tint,
    tintFilm: car.glass?.film,
    rims: car.rims,
    livery: car.livery,
    // Three wheels. Passing everything that decides the look EXCEPT
    // this is how every claim below came to be made against a car the
    // game does not build — the record has said trike since the day it
    // grew a third wheel, and this call had never asked for it.
    trike: car.trike,
  });
  // The car the game DRAWS, not the one createCar hands back. The authored
  // body is fetched and swapped in underneath the decals a moment after
  // the build, and it is not the shape the build measured: the extrusion
  // tucks in under the shoulder and the loft does not, so a mark that
  // clears the one is buried in the other. This measured the extrusion
  // and called the Demon's flank mark 99% visible while the game showed
  // 26% of it. Every slot's verdict is written in the same tick, so the
  // last slot being there means the swap has been decided.
  for (let i = 0; i < 600 && g.userData.shellSwap?.roof === undefined && g.userData.shellSwap?.all === undefined; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const shellSwap = { ...(g.userData.shellSwap ?? {}) };
  g.updateMatrixWorld(true);

  const hex = (c) => "#" + c.getHexString();
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

  // Paint: the body material the builder handed back.
  const paint = g.userData.bodyMat;

  // Glass, measured rather than named. tintedGlass CLONES the shared
  // pane, so the name is "glass" either way and reading it proves
  // nothing — the first version of this check called the car naked
  // because the material it was holding was the tinted one all along.
  // What separates them is what they do to the light, so the same car
  // is built again without the film and the two panes are compared.
  const pane = (grp) => {
    let m = null;
    grp.traverse((o) => { if (o.userData?.shell === "canopy") m = o.material; });
    return m;
  };
  const glass = pane(g);
  const bare = pane(window.__grnBuildCar({ body: car.color, style: car.style, kit: car.kit, lengthM: car.lengthM }));

  // Wheels: the SPOKE of each of the four. A wheel carries three metals
  // — the spoke face, the dark barrel behind it and the lugs — so
  // "every material with rim in its name" answers a different question
  // from "what is this wheel", and answers it with a list.
  const spokes = [];
  for (const w of g.userData.wheels ?? []) {
    w.traverse((o) => {
      if (o.userData?.wheelPart === "alloy") spokes.push(o.material?.name || "(unnamed)");
    });
  }

  // The marks, by the tag the builder puts on them.
  const marks = [];
  g.traverse((o) => {
    if (!o.userData?.decal?.startsWith("demon-")) return;
    o.updateMatrix();
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    // The plane's own size, then the size it ends up on the car: the
    // shell is scaled to the record's length after the decals are
    // placed, so texels per metre have to be counted on the fitted car.
    // Height, not the largest span: a flank ribbon's z extent is the
    // length it runs along the car and its x extent is only how much
    // the panel curves, so "the biggest dimension" is a different
    // number for a ribbon than for a plane. Height is the same
    // measurement on both, and it is what the texture is squared to.
    const local = bb.max.y - bb.min.y;
    const scale = o.getWorldScale(new THREE.Vector3()).x;
    const size = local * scale;
    const img = o.material?.map?.image;
    // The world centre of the actual geometry, not of the node. Two of
    // these marks are flat planes centred on their node and two are
    // ribbons whose vertices follow the bodywork with the node left at
    // the origin — reading o.position for those puts the measurement in
    // the middle of the car.
    const box = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    const mid = box.getCenter(new THREE.Vector3());
    // A point ON the decal, not the centre of the box around it. A flat
    // plane's box centre is on the plane; a ribbon that follows a
    // curving panel has its box centre inboard of every vertex it owns,
    // and measuring the gap from there added 20 mm of curvature to a
    // 12 mm standoff and reported it as float.
    const pa = o.geometry.getAttribute("position");
    const v = new THREE.Vector3();
    const w = new THREE.Vector3();
    let best = Infinity;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
      const dd = v.distanceToSquared(mid);
      if (dd < best) { best = dd; w.copy(v); }
    }
    const q = o.getWorldQuaternion(new THREE.Quaternion());
    // Which way the sticker faces, taken from the geometry's own
    // normals rather than from the node's rotation — again because a
    // ribbon carries its facing in its vertices and its node is
    // unrotated, so the node would claim every ribbon faces forward.
    const na = o.geometry.getAttribute("normal");
    const nv = new THREE.Vector3();
    for (let i = 0; i < na.count; i++) nv.add(new THREE.Vector3().fromBufferAttribute(na, i));
    nv.divideScalar(na.count || 1).applyQuaternion(q).normalize();
    marks.push({
      tag: o.userData.decal,
      wx: w.x, wy: w.y, wz: w.z,
      size,
      px: img?.width ?? 0,
      n: nv.toArray().map((v) => +v.toFixed(3)),
      // And which way is up in the picture, so a mark is not upside down
      // to whoever reads it.
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(q).toArray().map((v) => +v.toFixed(3)),
    });
  });

  // Both questions asked FROM the mark, along its own normal.
  //
  //   standoff  how far it is off the bodywork it lies on. Cast inward.
  //   covered   whether anything is between it and the outside world.
  //             Cast outward.
  //
  // Both were asked from 1.2 m away first, and at that range the ray is
  // a different measurement: these decals are pitched to the panel they
  // sit on, so 1.2 m along a tilted normal lands the origin most of a
  // metre to one side and the ray comes back through whatever bodywork
  // is in the way. It reported the deck mark buried under paint that a
  // ray dropped straight onto it could not find. Cast from the mark and
  // the ray stays on the mark.
  //
  // And the surface it is measured against is whatever is actually
  // there, not the shell: the bonnet mark lies on the attack kit's
  // power bulge, so against the bare shell it reads 122 mm proud while
  // being 20 mm off the panel it is stuck to.
  //
  // `covered` is asked over the WHOLE mark rather than from one point on
  // it, and that is the second thing this measurement got wrong. It used
  // to fire a single outward ray from the vertex nearest the bounding
  // box centre — and on a ribbon every vertex is on the top or the
  // bottom EDGE of the band, two rows equidistant from that centre, so
  // which one won was a tie-break. From an edge the ray grazes the panel
  // the mark is stuck to, and a surface that curves away underneath it
  // is 17 mm "outside" the sticker a few millimetres along. The verdict
  // therefore flipped between "ok" and "a sticker nobody can see" on
  // changes that moved the paint by a millimetre, while the sticker
  // itself was exactly as visible either way: 38.3% of the Demon's
  // quarter mark, measured both before and after the crown was
  // smoothed, to the same three digits.
  //
  // So: sample the mark by AREA — a fixed number of points per square
  // metre of artwork, spread over its triangles — and report the share
  // of it that something else is standing in front of. That is
  // tessellation-independent (the ribbon's row count does not move it)
  // and it is the question worth asking, because a decal is not a point.
  const solid = [];
  // Not the tail lamps' glow cards: additive light, no depth write, hung
  // 0.12 m behind each lamp. They stand in front of the tail mark's outer
  // edge and in front of nothing anyone can see through.
  g.traverse((o) => { if (o.isMesh && o.visible && !o.userData?.decal && !o.userData?.noShadow) solid.push(o); });
  // The outward rays are cast against double-sided copies. The paint and
  // the glass are front-face-only, which a ray fired from INSIDE a closed
  // shell passes straight through, so a sticker buried in the bodywork
  // read as uncovered here: nothing it could see was in its way.
  const solidBoth = solid.map((o) => {
    const c = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, name: o.material?.name ?? "" }));
    c.matrixWorld.copy(o.matrixWorld);
    c.userData = { shell: o.userData.shell };
    return c;
  });
  const REACH = 0.4;
  const standoff = {}, covered = {};
  const meshFor = {};
  g.traverse((o) => { if (o.isMesh && o.userData?.decal) (meshFor[o.userData.decal] ??= []).push(o); });
  const taken = {};
  for (const m of marks) {
    const dir = new THREE.Vector3(...m.n).normalize();
    const at = new THREE.Vector3(m.wx, m.wy, m.wz).addScaledVector(dir, 0.002);
    const inward = new THREE.Raycaster(at, dir.clone().negate(), 0, REACH).intersectObjects(solid, false)[0];
    standoff[m.tag] = inward ? +(inward.distance + 0.002).toFixed(4) : null;

    // The two flanks share a tag, so hand each `marks` row the next mesh
    // carrying it rather than measuring the same one twice.
    const o = (meshFor[m.tag] ?? [])[(taken[m.tag] = (taken[m.tag] ?? -1) + 1)];
    covered[m.tag] = null;
    if (!o) continue;
    const pa = o.geometry.getAttribute("position");
    const index = o.geometry.getIndex();
    const tri = index ? index.count / 3 : pa.count / 3;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const p = new THREE.Vector3();
    const PER_M2 = 4000;
    let hidden = 0, seen = 0;
    const by = {};
    for (let t = 0; t < tri; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pa, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pa, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pa, i2).applyMatrix4(o.matrixWorld);
      const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
      const n = Math.max(1, Math.round(area * PER_M2));
      for (let k = 0; k < n; k++) {
        // A deterministic spread inside the triangle — no rng, so the
        // number this prints is the same number tomorrow.
        const u = ((k + 0.5) / n) * 0.62 + 0.19;
        const v = (((k * 7) % n) + 0.5) / n * (1 - u) * 0.9 + 0.05 * (1 - u);
        p.copy(a).addScaledVector(b.clone().sub(a), u).addScaledVector(c.clone().sub(a), v);
        p.addScaledVector(dir, 0.002);
        const out = new THREE.Raycaster(p, dir, 0, REACH).intersectObjects(solidBoth, false)[0];
        if (out) {
          hidden++;
          const k2 = out.object.material?.name ?? out.object.userData?.shell ?? "something";
          by[k2] = (by[k2] ?? 0) + 1;
        } else seen++;
      }
    }
    const share = hidden / Math.max(1, hidden + seen);
    covered[m.tag] = { share: +share.toFixed(3), by, samples: hidden + seen };
  }

  const clearance = standoff;

  return {
    paint: hex(paint.color),
    paintLum: +lum(paint.color).toFixed(4),
    glassOpacity: glass ? +glass.opacity.toFixed(3) : null,
    bareOpacity: bare ? +bare.opacity.toFixed(3) : null,
    glassLum: glass ? +lum(glass.color).toFixed(4) : null,
    bareLum: bare ? +lum(bare.color).toFixed(4) : null,
    spokes: [...new Set(spokes)],
    marks: marks.sort((a, b) => a.tag.localeCompare(b.tag)),
    clearance,
    covered,
    shellSwap,
  };
}, DEMON);

console.log(`paint     ${look.paint}, luminance ${look.paintLum}  ` +
  check(look.paintLum > 0.002 && look.paintLum < 0.03,
    `the paint is ${look.paintLum > 0.03 ? "not black" : "true black, which has no shading left to show the car's shape with"}`));
console.log(`glass     opacity ${look.glassOpacity} vs ${look.bareOpacity} bare, ` +
  `luminance ${look.glassLum} vs ${look.bareLum}  ` +
  check(
    look.glassOpacity !== null && look.bareOpacity !== null &&
      (look.glassOpacity > look.bareOpacity + 0.05 || look.glassLum < look.bareLum - 0.05),
    "the car is not delivered behind its own black glass — its windows are the factory pane every other car has"
  ));
console.log(`rims      ${look.spokes.join(", ") || "none"}  ` +
  check(look.spokes.length === 1 && look.spokes[0] === "rim-black",
    `the wheels are ${look.spokes.join("/") || "unreadable"}, not the black forged set the car is sold on`));

// ---- 4. Four marks, four sides, each lying on its panel --------------
// On the body the game wears. If the loft was refused (a stale file) the
// extrusion is what is drawn and what is measured, which is still right;
// but it is said, because it is the other half of what this used to hide.
console.log(`body      ${look.shellSwap.body ?? look.shellSwap.all ?? "undecided"}  ` +
  check(look.shellSwap.body === "authored",
    `the authored body was not what got measured (${look.shellSwap.body ?? look.shellSwap.all ?? "no verdict"}), ` +
    "so the marks below were measured on the shell the game does not draw"));
const tags = look.marks.map((m) => m.tag);
console.log(`marks     ${tags.join(", ") || "none"}  ` +
  check(look.marks.length === 4 &&
    ["demon-flank", "demon-flank", "demon-hood", "demon-tail"].join() === tags.join(),
    `the livery put ${look.marks.length} marks on the car, not one on each side`));

for (const m of look.marks) {
  const c = look.clearance[m.tag];
  const texels = m.px / m.size;
  const over = look.covered[m.tag];
  // A quarter of a sticker behind a wing mirror is a car; most of one
  // behind a tyre is a mistake. The line is at a third.
  const HIDDEN_MAX = 0.34;
  const buried = over !== null && over.share > HIDDEN_MAX;
  const worst = over
    ? Object.entries(over.by).sort((x, y) => y[1] - x[1])[0]
    : null;
  console.log(
    `  ${m.tag.replace("demon-", "").padEnd(6)} ${m.size.toFixed(2)} m, ${Math.round(texels)} texels/m, ` +
    `${c === null ? "no panel under it" : `${(c * 1000).toFixed(0)} mm off the paint`}` +
    `${over ? `, ${(over.share * 100).toFixed(0)}% hidden` : ""}` +
    `${worst ? ` (mostly ${worst[0]})` : ""}  ` +
    check(
      c !== null && c > 0.004 && c < 0.04 && texels > 500 && !buried,
      c === null
        ? `${m.tag} has no bodywork under it — it is hung in the air`
        : c <= 0.004
          ? `${m.tag} is ${(c * 1000).toFixed(0)} mm off the panel: it will z-fight the paint`
          : c >= 0.04
            ? `${m.tag} floats ${(c * 1000).toFixed(0)} mm above the panel`
            : buried
              ? `${(over.share * 100).toFixed(0)}% of ${m.tag} is behind the car's own ` +
                `${worst ? worst[0] : "bodywork"} — that much of it nobody can see`
              : `${m.tag} is ${Math.round(texels)} texels/m, which is the density the flag read as a smear at`
    )
  );
}
// The two flanks are the same mark on opposite sides, so they must be
// mirror images and not two copies pointing the same way.
const flanks = look.marks.filter((m) => m.tag === "demon-flank");
console.log(`mirrored  ${check(
  flanks.length === 2 &&
    // Same distance out on opposite sides, and each facing away from
    // the centreline. Not "the same x negated" — the two ribbons sample
    // the shell independently and land a fraction of a millimetre
    // apart, which is the body being measured rather than asymmetry.
    Math.abs(Math.abs(flanks[0].wx) - Math.abs(flanks[1].wx)) < 0.005 &&
    flanks[0].wx * flanks[1].wx < 0 &&
    flanks.every((f) => f.wx * f.n[0] > 0.5),
  `the two flank marks are not mirrored: x ${flanks.map((f) => f.wx.toFixed(3))}, ` +
    `normals ${flanks.map((f) => f.n[0])}`
)}  ${flanks.map((f) => f.wx.toFixed(3)).join(" and ")} m out, both facing away from the car`);
// And the rear mark faces the car behind it, horns up. It was on the boot
// lid with its top at the nose, which read upright from straight above and
// not at all from behind: the wing's plane and uprights stand over the lid.
// It is on the tail panel now, a vertical face, so "the right way up" is
// "faces aft, top up". The projection check from a camera behind and above
// is in tests/demonmarks.mjs, which can place one.
const tail = look.marks.find((m) => m.tag === "demon-tail");
console.log(`tail up   ${check(
  tail && tail.n[2] < -0.9 && tail.up[1] > 0.9,
  "the tail mark does not face the car behind it with its horns up"
)}  ${tail ? `faces ${tail.n[2] < 0 ? "aft" : "forward"} (${tail.n[2]}), its top points ${tail.up[1] > 0 ? "up" : "down"}` : "no tail mark"}`);

// ---- 5. One mark per panel, and a bought wheel still wins ------------
const both = await page.evaluate((id) => {
  const car = window.__grnShowroom.car(id);
  const mk = (extra) => {
    const g = window.__grnBuildCar({
      body: car.color, style: car.style, kit: car.kit, raceKit: car.kit === "attack",
      lengthM: car.lengthM, rims: car.rims, livery: car.livery, trike: car.trike, ...extra,
    });
    g.updateMatrixWorld(true);
    let marks = 0;
    const spokes = new Set();
    g.traverse((o) => {
      // Every horned skull on the car, however it got there: the livery
      // tags its four, the rally pack tags the crew badge it adds.
      const tag = o.userData?.decal ?? "";
      if (tag.startsWith("demon-") || tag === "crew-mark") marks++;
      if (o.userData?.wheelPart === "alloy") spokes.add(o.material?.name || "(unnamed)");
    });
    return { marks, spokes: [...spokes] };
  };
  return { pack: mk({ stickers: true }), gold: mk({ goldRims: true }) };
}, DEMON);
console.log(`with pack ${both.pack.marks} horned marks  ` +
  check(both.pack.marks === 4,
    `buying the rally pack for a car that already wears the mark leaves ${both.pack.marks} of them`));
console.log(`gold wins ${both.gold.spokes.join(", ")}  ` +
  check(both.gold.spokes.length === 1 && both.gold.spokes[0] === "rim-gold",
    `bought gold rims lost to the factory black (${both.gold.spokes.join("/")}) — a purchase the player made and cannot see`));

// ---- 6. Three wheels, and the front one steers ----------------------
//
// The fifth thing this car is, and the last to be checked. `trike` moved
// the wheel layout, the steering and the arches when it landed, and
// nothing anywhere tested any of it — this suite included, because its
// own build call did not pass the field. So: count them off the built
// car, and read the plan the builder records for the engine to steer by.
const wheels = await page.evaluate((id) => {
  const car = window.__grnShowroom.car(id);
  const g = window.__grnBuildCar({
    body: car.color, style: car.style, kit: car.kit, raceKit: car.kit === "attack",
    lengthM: car.lengthM, rims: car.rims, livery: car.livery, trike: car.trike,
  });
  g.updateMatrixWorld(true);
  const hubs = (g.userData.wheels ?? []);
  // An arch per wheel, except over the single front one — a centre wheel
  // has no wing to flare.
  let arches = 0;
  g.traverse((o) => { if ((o.userData?.decal ?? o.name ?? "").includes("arch")) arches++; });
  return {
    count: hubs.length,
    plan: g.userData.wheelPlan ?? null,
    xs: hubs.map((w) => +w.position.x.toFixed(3)),
    arches,
  };
}, DEMON);

console.log(`wheels    ${wheels.count}  plan ${JSON.stringify(wheels.plan)}  ` +
  check(wheels.count === 3,
    `the Black Demon built with ${wheels.count} wheels — it is a three-wheeler and every port and press shot has drawn it otherwise`));
console.log(`front     ${wheels.plan?.front ?? "?"}  ` +
  check(wheels.plan?.front === 1,
    `wheelPlan.front is ${wheels.plan?.front}, so the engine steers it like a two-wheel axle`));
// The single front wheel is on the centreline; the rears are not.
{
  const centred = wheels.xs.filter((x) => Math.abs(x) < 0.02).length;
  console.log(`centreline ${wheels.xs.join(", ")}  ` +
    check(centred === 1,
      `${centred} wheels sit on the centreline — the front one should, and only it`));
}

// ---- 7. The front wheel can be SEEN ----------------------------------
//
// Section 6 counted the wheels and passed for as long as the car's one
// front tyre stood on the centreline INSIDE the nose: a centre wheel has no
// flank to show through, the shell is solid, and every picture of the car
// drew a machine with a rear axle and no front tyre — with two teal brake
// calipers floating in the flanks where the front wheels would have been.
// Counting wheels cannot see that. This asks what a camera would: fire rays
// at the tyre from in front of the car and ask what they meet first, and
// ask the shell and the parts built on the nose whether anything of theirs
// is left standing in the tyre's footprint.
const seen = await page.evaluate(async (id) => {
  const THREE = window.__grnThree;
  const car = window.__grnShowroom.car(id);
  const g = window.__grnBuildCar({
    body: car.color, style: car.style, kit: car.kit, raceKit: car.kit === "attack",
    lengthM: car.lengthM, rims: car.rims, livery: car.livery, trike: car.trike,
  });
  // The authored shell arrives asynchronously; the opening has to be there
  // on it as well as on the extruded body the car is first built with.
  const t0 = performance.now();
  while (!(g.userData.shellSwap && g.userData.shellSwap.body) && performance.now() - t0 < 90000) {
    await new Promise((r) => setTimeout(r, 200));
  }
  g.updateMatrixWorld(true);
  const wheels = g.userData.wheels ?? [];
  const front = wheels[0];
  const isWheel = (o) => { for (let p = o; p; p = p.parent) if (wheels.includes(p)) return true; return false; };
  const fbox = new THREE.Box3().setFromObject(front);
  const c = fbox.getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster();
  // The solid parts only: the beams and flares are not what hides a tyre,
  // and a sprite cannot be raycast without a camera.
  const solids = [];
  g.traverse((o) => { if (o.isMesh && !o.material?.transparent && !o.userData.noShadow) solids.push(o); });
  let rays = 0, onTyre = 0;
  const blockers = {};
  for (const dx of [-0.07, 0, 0.07]) {
    for (const fy of [0.3, 0.5, 0.7]) {
      const y = fbox.min.y + (fbox.max.y - fbox.min.y) * fy;
      ray.set(new THREE.Vector3(c.x + dx, y, fbox.max.z + 3), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObjects(solids, false)[0];
      rays++;
      if (hit && isWheel(hit.object)) onTyre++;
      else { const k = hit?.object?.material?.name || hit?.object?.name || "nothing"; blockers[k] = (blockers[k] ?? 0) + 1; }
    }
  }
  // Shell triangles left in the tyre's own footprint (the group's units).
  const lbox = fbox.clone().applyMatrix4(new THREE.Matrix4().copy(g.matrixWorld).invert());
  let inFootprint = 0;
  let body = null;
  g.traverse((o) => { if (o.isMesh && o.userData.shell === "body") body = o; });
  const geo = body.geometry, p = geo.attributes.position, ix = geo.index;
  const n = ix ? ix.count : p.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  for (let t = 0; t < n; t += 3) {
    const i = (j) => (ix ? ix.getX(t + j) : t + j);
    a.fromBufferAttribute(p, i(0)); b.fromBufferAttribute(p, i(1)); d.fromBufferAttribute(p, i(2));
    const cx = (a.x + b.x + d.x) / 3, cy = (a.y + b.y + d.y) / 3, cz = (a.z + b.z + d.z) / 3;
    if (Math.abs(cx) < (lbox.max.x - lbox.min.x) / 2 && cy > lbox.min.y + 0.05 && cy < lbox.max.y - 0.05 && cz > lbox.min.z) inFootprint++;
  }
  // Calipers belong to wheels: one each, near it.
  const calipers = [];
  g.traverse((o) => { if (o.isMesh && /^caliper/.test(o.material?.name ?? "")) calipers.push(o); });
  const near = calipers.filter((cp) => {
    const q = cp.getWorldPosition(new THREE.Vector3());
    return wheels.some((w) => { const wp = w.getWorldPosition(new THREE.Vector3()); return Math.hypot(wp.x - q.x, wp.z - q.z) < 0.35; });
  }).length;
  let frontPlates = 0;
  g.traverse((o) => { if (o.isMesh && o.material?.name === "plate" && o.getWorldPosition(new THREE.Vector3()).z > 0) frontPlates++; });
  return { rays, onTyre, blockers, inFootprint, calipers: calipers.length, near, frontPlates,
    shell: g.userData.shellSwap?.body, tyreZ: +c.z.toFixed(2), wheelbase: g.userData.wheelPlan?.wheelbase };
}, DEMON);

console.log(`tyre seen  ${seen.onTyre} of ${seen.rays} rays from the front reach the tyre first` +
  (seen.onTyre === seen.rays ? "" : `; blocked by ${JSON.stringify(seen.blockers)}`) + "  " +
  check(seen.onTyre === seen.rays,
    `only ${seen.onTyre} of ${seen.rays} rays from in front of the car reach the front tyre — ${JSON.stringify(seen.blockers)} is in the way, so the tyre is hidden`));
console.log(`shell      ${seen.inFootprint} triangles in the tyre's footprint (shell: ${seen.shell})  ` +
  check(seen.shell === "authored", `the authored shell was not accepted (${seen.shell}) — the opening was cut in a body that is not the one drawn`) + " " +
  check(seen.inFootprint === 0, `${seen.inFootprint} shell triangles stand where the front tyre does`));
console.log(`calipers   ${seen.calipers}, ${seen.near} beside a wheel  ` +
  check(seen.calipers === 3 && seen.near === 3,
    `${seen.calipers} brake calipers, ${seen.near} of them beside a wheel — a three-wheeler has three, each on its wheel (the old list put two in the flanks at the front axle)`));
console.log(`plate      ${seen.frontPlates} on the nose  ` +
  check(seen.frontPlates === 0, "a front plate hangs where the front wheel stands"));
check(seen.wheelbase > 3.0, `the wheelbase is ${seen.wheelbase}: the front axle did not move to the nose`);

// ---- 8. The rear tyres: big, in proportion, in a hole cut for them ---
//
// The car is a delta: one small steering tyre at the nose and two big
// driving ones at the back, 1.4 times the fleet's wheel (0.95 m across,
// taller than the body behind them). Everything that goes with that is
// measured against the SAME body built with four ordinary wheels in the
// same page, so a number here is "how much bigger than the fleet's wheel",
// not a figure copied out of the source it is meant to be checking:
//
//   size      rear 1.4x and front 0.86x the fleet's tyre, in width as well
//             as diameter (this was 0.24 m wide on a 0.81 m tyre: the
//             length fit's width correction overwrote the multiplier)
//   ground    all three stand on the road
//   fitment   the rear tyre's OUTER wall is where the fleet's is, not 80 mm
//             further out because it grew sideways
//   hole      no vertex of the body is inside either rear tyre: the shell
//             is cut for it, not pierced by it
//   brakes    three calipers that are really there, one inside each wheel
//             (the nose wheel's was cut to nothing by its own opening)
//   shadow    the contact shadow is not the four-wheeler's, which is a
//             silhouette's cached material that the Zeta 300 GTR shares
const rear = await page.evaluate(async (id) => {
  const THREE = window.__grnThree;
  const car = window.__grnShowroom.car(id);
  const mk = (trike) => window.__grnBuildCar({
    body: car.color, style: car.style, kit: car.kit, raceKit: car.kit === "attack",
    lengthM: car.lengthM, rims: car.rims, livery: car.livery, trike,
  });
  const settle = async (g) => {
    const t0 = performance.now();
    const pending = () => {
      const v = g.userData.shellSwap ?? {};
      let n = v.body ? 0 : 1;
      g.traverse((o) => {
        if (o.isMesh && o.userData.wheelPart === "tire" && (o.parent?.userData.spokes ?? 0) > 0 && !o.geometry.userData.authored) n++;
      });
      return n;
    };
    while (pending() && performance.now() - t0 < 90000) await new Promise((r) => setTimeout(r, 200));
    g.updateMatrixWorld(true);
  };
  const g = mk(true);
  const twin = mk(false);
  await settle(g);
  await settle(twin);
  const tyre = (w) => {
    const b = new THREE.Box3();
    w.traverse((o) => { if (o.isMesh && o.userData.wheelPart === "tire") b.expandByObject(o); });
    return b;
  };
  const m = (b) => ({ dia: b.max.y - b.min.y, width: b.max.x - b.min.x, bottom: b.min.y, outer: Math.max(Math.abs(b.min.x), Math.abs(b.max.x)),
    cx: (b.min.x + b.max.x) / 2, cy: (b.min.y + b.max.y) / 2, cz: (b.min.z + b.max.z) / 2 });
  const wheels = g.userData.wheels.map((w) => m(tyre(w)));
  const fleet = m(tyre(twin.userData.wheels[2]));
  // The body shell's vertices inside each rear tyre's own cylinder.
  let body = null;
  g.traverse((o) => { if (o.isMesh && o.userData.shell === "body") body = o; });
  const pa = body.geometry.getAttribute("position");
  const v = new THREE.Vector3();
  const inside = [];
  for (const w of wheels.slice(1)) {
    let n = 0;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(body.matrixWorld);
      if (Math.abs(v.x - w.cx) < w.width / 2 * 0.99 && Math.hypot(v.y - w.cy, v.z - w.cz) < w.dia / 2 * 0.995) n++;
    }
    inside.push(n);
  }
  // The flares over the openings: each stays under the body's own top skin
  // at the wheel (a hoop over the tyre's crown would stand in the air above
  // the car, behind a tyre that is already taller than the body), and each
  // is a real flare, as proud of the flank as every other car's.
  let deckTop = 0;
  for (let i = 0; i < pa.count; i++) {
    v.fromBufferAttribute(pa, i).applyMatrix4(body.matrixWorld);
    if (Math.abs(v.z - wheels[1].cz) < 0.5 && Math.abs(Math.abs(v.x) - Math.abs(wheels[1].cx)) < 0.3) deckTop = Math.max(deckTop, v.y);
  }
  const flares = [];
  g.traverse((o) => {
    if (!o.isMesh || !o.userData.archFlare) return;
    const b = new THREE.Box3().setFromObject(o);
    if (b.max.z < 0) flares.push({ top: b.max.y, out: Math.max(Math.abs(b.min.x), Math.abs(b.max.x)) });
  });
  const flareOut = flares.length ? Math.max(...flares.map((f) => f.out)) : 0;
  const twinFlareOut = (() => {
    let m = 0;
    twin.traverse((o) => {
      if (!o.isMesh || !o.userData.archFlare) return;
      const b = new THREE.Box3().setFromObject(o);
      if (b.max.z < 0) m = Math.max(m, Math.abs(b.min.x), Math.abs(b.max.x));
    });
    return m;
  })();
  // Calipers: the ones with triangles in them, and where they are.
  const cals = [];
  g.traverse((o) => { if (o.isMesh && /^caliper/.test(o.material?.name ?? "")) cals.push(o); });
  const drawn = cals.filter((c) => c.geometry.getAttribute("position").count > 0);
  const homes = drawn.map((c) => {
    const p = c.getWorldPosition(new THREE.Vector3());
    return wheels.some((w) => Math.hypot(p.y - w.cy, p.z - w.cz) < w.dia / 2 && Math.abs(p.x - w.cx) < w.width / 2);
  });
  return {
    wheels, fleet, inside,
    deckTop, flares, flareOut, twinFlareOut,
    calipers: cals.length, drawn: drawn.length, homes: homes.filter(Boolean).length,
    ownShadow: g.userData.contact.material !== twin.userData.contact.material &&
      g.userData.contact.material.map !== twin.userData.contact.material.map,
  };
}, DEMON);

{
  const [f, r1, r2] = rear.wheels;
  const fl = rear.fleet;
  const ratio = (a, b) => a / b;
  const rs = [ratio(r1.dia, fl.dia), ratio(r2.dia, fl.dia)];
  const ws = [ratio(r1.width, fl.width), ratio(r2.width, fl.width)];
  console.log(`rear size  ${rs.map((x) => x.toFixed(2)).join(" / ")}x the fleet's tyre across, ${ws.map((x) => x.toFixed(2)).join(" / ")}x wide  ` +
    check(rs.every((x) => Math.abs(x - 1.4) < 0.02) && ws.every((x) => Math.abs(x - 1.4) < 0.03),
      `the rear tyres are ${rs.map((x) => x.toFixed(2))}x across and ${ws.map((x) => x.toFixed(2))}x wide, not 1.4x both ways`));
  console.log(`front size ${ratio(f.dia, fl.dia).toFixed(2)}x across, ${ratio(f.width, fl.width).toFixed(2)}x wide  ` +
    check(Math.abs(ratio(f.dia, fl.dia) - 0.86) < 0.02 && Math.abs(ratio(f.width, fl.width) - 0.86) < 0.03,
      `the nose tyre is ${ratio(f.dia, fl.dia).toFixed(2)}x across and ${ratio(f.width, fl.width).toFixed(2)}x wide, not 0.86x both ways`));
  const worstGround = Math.max(...rear.wheels.map((w) => Math.abs(w.bottom)));
  console.log(`ground     the lowest tyre is ${(worstGround * 1000).toFixed(1)} mm off the road  ` +
    check(worstGround < 0.004, `a tyre is ${(worstGround * 1000).toFixed(0)} mm off the road: the hub was not raised with the tyre`));
  const poke = Math.max(r1.outer, r2.outer) - fl.outer;
  console.log(`fitment    rear outer wall ${(poke * 1000).toFixed(1)} mm past the fleet's  ` +
    check(Math.abs(poke) < 0.006, `the rear tyres stand ${(poke * 1000).toFixed(0)} mm past where a standard wheel's outer wall is — they grew outward, not inward`));
  console.log(`hole       body vertices inside the rear tyres: ${rear.inside.join(", ")}  ` +
    check(rear.inside.every((n) => n === 0), `${rear.inside} body vertices stand inside the rear tyres: the shell is pierced, not cut`));
  const flareHigh = Math.max(0, ...rear.flares.map((f) => f.top - rear.deckTop));
  // One mesh a side (two pieces in it, either side of the opening). Allowed
  // 15 mm over the deck: it tapers to nothing there, and its tube has a
  // thickness the deck height is measured to the centre of.
  console.log(`flares     ${rear.flares.length} over the rear openings, ${(flareHigh * 1000).toFixed(0)} mm above the deck at most, ` +
    `${((rear.flareOut - rear.twinFlareOut) * 1000).toFixed(0)} mm out past the fleet's  ` +
    check(rear.flares.length === 2 && flareHigh < 0.015,
      `${rear.flares.length} flares over the rear openings (want one a side), standing ${(flareHigh * 1000).toFixed(0)} mm above the deck: a hoop in the air over the tyre`) + " " +
    check(Math.abs(rear.flareOut - rear.twinFlareOut) < 0.01,
      `the rear flares reach ${((rear.flareOut - rear.twinFlareOut) * 1000).toFixed(0)} mm past a standard car's: the flare is not the flare every other car wears`));
  console.log(`brakes     ${rear.drawn} of ${rear.calipers} calipers drawn, ${rear.homes} inside a tyre  ` +
    check(rear.calipers === 3 && rear.drawn === 3 && rear.homes === 3,
      `${rear.drawn} of ${rear.calipers} calipers have any triangles and ${rear.homes} are inside a tyre: one is cut away or floating`));
  console.log(`shadow     ${rear.ownShadow ? "its own, three patches" : "shared with a four-wheeler"}  ` +
    check(rear.ownShadow, "the trike's contact shadow is the four-wheeler's: phantom patches at the old front axle and none under the nose tyre"));
}

// The menu's own car: built with the layout it is sold with, and rolling
// each tyre at its own radius. Seeded as the player's car so this runs the
// real RaceClient path (it left `trike` out, and the menu built the Demon
// with four wheels the race and the shop had three of).
{
  await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
  await page.evaluate((id) => {
    localStorage.clear();
    localStorage.setItem("gulf-road-nights-onboarded", "2");
    localStorage.setItem("gulf-road-nights-coach", "3");
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify({ kd: 0, cars: [id], car: id, builds: {} }));
  }, DEMON);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__grnAttract && window.__grnAttract.cars.length > 0, null, { timeout: 120000 });
  const menu = await page.evaluate(async () => {
    const c = window.__grnAttract.cars[0];
    const w = c.userData.wheels;
    const a = w.map((x) => x.rotation.x);
    await new Promise((r) => setTimeout(r, 2000));
    const b = w.map((x) => x.rotation.x);
    return { count: w.length, turned: w.map((x, i) => b[i] - a[i]) };
  });
  const [t0, t1, t2] = menu.turned;
  const k = t2 / t0;
  console.log(`menu       ${menu.count} wheels, rears turn ${k.toFixed(2)}x the front's rate  ` +
    check(menu.count === 3, `the menu's Black Demon has ${menu.count} wheels`) + " " +
    check(Math.abs(k - 0.86 / 1.4) < 0.04 && Math.abs(t1 / t2 - 1) < 0.02,
      `the rear tyres turn ${k.toFixed(2)}x as fast as the front one (want ${(0.86 / 1.4).toFixed(2)}): a tyre ${(1.4 / 0.86).toFixed(2)}x the size turning at the small one's rate skates`));
}

// ---- 9. It moves ----------------------------------------------------
//
// Everything above was measured with the car standing still. This drives
// it, in the real engine, as the player's car, and measures the tyres in
// the BODY's own frame (the shell rolls and pitches on its springs, the
// hubs stay with the road), because that is where a tyre meets a panel:
//
//   rolling    each tyre lays the road at its own radius: 1.000 of the
//              distance, the rears at 0.61x the nose tyre's turns
//   contact    every hub at its own tyre's radius above the road, in a
//              steady run, a 200 km/h stop, full lock either way, a slide
//   lock       the nose tyre steers its lock and stays inside the opening
//              in the nose (TRIKE_NOSE.halfW) at full lock
//   bonnet     the nose tyre never stands above the bonnet's skin. It did:
//              the body dives, the tyre stays on the road and comes up
//              through the hood by (nose axle) x (dive), 43 mm above it in
//              a stop with the fleet's 2.6 degree dive limit. The Demon
//              dives to 1.3 now (mods.ts diveMaxFor), which is visual
//              only: the load transfer that decides grip is grip.ts's own
//   walls      the rear tyres stay inboard of the cut's flat back wall
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 600000 });
// The authored shells and tyres land minutes after boot on software GL; a
// drive of the procedural stand-in would be a drive of a different car.
{
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => {
      const e = window.__grnEngine;
      let shells = 0, authored = 0, tyres = 0, ta = 0;
      e.carBody.traverse((o) => {
        if (!o.isMesh) return;
        if (o.userData.shell) { shells++; if (o.geometry.userData.authored) authored++; }
        if (o.userData.wheelPart === "tire" && (o.parent?.userData.spokes ?? 0) > 0) { tyres++; if (o.geometry.userData.authored) ta++; }
      });
      return shells > 0 && authored === shells && ta === tyres;
    });
    if (st || Date.now() - t0 > 420000) break;
    await page.waitForTimeout(3000);
  }
}
const moving = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const THREE = window.__grnThree;
  e.skipCinematic?.();
  e.setPaused(true);
  const body = e.carBody;
  const wheels = body.userData.wheels;
  const R = body.userData.wheelR;
  const sc = body.scale;
  const ks = wheels.map((w) => w.userData.rMul ?? 1);
  // cars.ts's own numbers (TIRE_RADIUS, TIRE_HALF_W, TRIKE_NOSE.halfW).
  const TIRE_RADIUS = 0.375, TIRE_HALF_W = 0.1325, NOSE_HALF_W = 0.235;
  const tyreMeshes = wheels.map((w) => { const out = []; w.traverse((o) => { if (o.isMesh && o.userData.wheelPart === "tire") out.push(o); }); return out; });
  const V = new THREE.Vector3();
  const park = () => {
    const away = e.track.wrap(2400 + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
  };
  // The bonnet's top skin over the nose tyre, body frame, read with the body level.
  const shell = (() => { let m; body.traverse((o) => { if (o.isMesh && o.userData.shell === "body") m = o; }); return m; })();
  const skin = {};
  body.rotation.set(0, 0, 0);
  body.updateMatrixWorld(true);
  { const rc = new THREE.Raycaster();
    for (let zi = 180; zi <= 240; zi += 5) {
      const z = zi / 100;
      rc.set(new THREE.Vector3(0, 3, z).applyMatrix4(body.matrixWorld), new THREE.Vector3(0, -1, 0));
      const h = rc.intersectObject(shell, false)[0];
      skin[zi] = h ? (h.point.y - body.position.y) / sc.y : null;
    } }
  const skinAt = (z) => skin[Math.min(240, Math.max(180, Math.round(z * 20) * 5))] ?? null;
  const probe = (acc) => {
    body.updateMatrixWorld(true);
    wheels.forEach((w, i) => { w.getWorldPosition(V); acc.hub[i] = Math.max(acc.hub[i], Math.abs(V.y - body.position.y - R * ks[i])); });
    wheels.forEach((w, i) => {
      const xIn = Math.abs(w.position.x) - TIRE_HALF_W * w.scale.x - 0.03;
      for (const m of tyreMeshes[i]) {
        const pa = m.geometry.attributes.position;
        for (let k = 0; k < pa.count; k += 3) {
          V.fromBufferAttribute(pa, k).applyMatrix4(m.matrixWorld);
          body.worldToLocal(V);
          const ax = Math.abs(V.x);
          if (i === 0) {
            acc.noseX = Math.max(acc.noseX, ax);
            if (ax < 0.15 && V.z < 2.42) { const t = skinAt(V.z); if (t !== null) acc.noseOut = Math.max(acc.noseOut, V.y - t); }
          } else acc.wall = Math.min(acc.wall, ax - xIn);
        }
      }
    });
    acc.steer = Math.max(acc.steer, Math.abs(wheels[0].rotation.y));
    acc.pitch = Math.max(acc.pitch, Math.abs(e.pitch));
    acc.roll = Math.max(acc.roll, Math.abs(e.roll));
  };
  const newAcc = () => ({ hub: wheels.map(() => 0), noseX: 0, noseOut: -1e9, wall: 1e9, steer: 0, pitch: 0, roll: 0 });
  const drive = (n, input, hold, acc, every = 6) => {
    for (let i = 0; i < n; i++) {
      park();
      if (hold !== undefined) { e.player.speed = hold; e.prevSpeed = hold; }
      e.setTouchInput(input);
      e.update(1 / 60);
      if (window.__vclock) window.__vclock.t += 1000 / 60;
      if (acc && i % every === 0) probe(acc);
    }
  };
  const level = () => { e.roll = 0; e.pitch = 0; e.rollVel = 0; e.pitchVel = 0; e.heading = 0; e.driftYaw = 0; e.player.s = 2400; e.player.lat = 0; };
  const runs = {};
  // rest
  level(); e.player.speed = 0;
  drive(30, { throttle: 0, brake: 0, steer: 0 });
  runs.rest = newAcc(); probe(runs.rest);
  // a steady run: arc against road
  level();
  drive(600, { throttle: 1, brake: 0, steer: 0 });
  const s0 = e.player.s;
  const a0 = wheels.map((w) => w.rotation.x);
  runs.run = newAcc();
  drive(180, { throttle: 0.35, brake: 0, steer: 0 }, undefined, runs.run);
  const dS = e.track.deltaAhead(s0, e.player.s);
  const arcs = wheels.map((w, i) => ((w.rotation.x - a0[i]) * R * ks[i]) / dS);
  const turns = wheels.map((w, i) => w.rotation.x - a0[i]);
  // a stop from 200 km/h
  level(); e.player.speed = 200 / 3.6; e.prevSpeed = e.player.speed;
  drive(6, { throttle: 0, brake: 0, steer: 0 }, 200 / 3.6);
  runs.brake = newAcc();
  drive(150, { throttle: 0, brake: 1, steer: 0 }, undefined, runs.brake, 3);
  // full lock each way at 60 km/h
  for (const [name, dir] of [["lockL", 1], ["lockR", -1]]) {
    level();
    drive(30, { throttle: 0.4, brake: 0, steer: 0 }, 60 / 3.6);
    runs[name] = newAcc();
    drive(200, { throttle: 0.4, brake: 0, steer: dir }, 60 / 3.6, runs[name]);
  }
  // a slide
  level(); e.player.speed = 240 / 3.6; e.steerSmooth = 0; e.slipVel = 0;
  if (window.__grnDriftModel) Object.assign(e.ds, window.__grnDriftModel.newDriftState());
  e.touch.drift = true;
  runs.slide = newAcc();
  for (let f = 0; f < 360 && Math.abs(e.driftYaw) < 0.55; f++) {
    park();
    e.player.speed = Math.max(20, e.player.speed);
    e.setTouchInput({ steer: 1, throttle: 1, brake: 0 });
    e.update(1 / 60);
    if (window.__vclock) window.__vclock.t += 1000 / 60;
    if (f % 3 === 0) probe(runs.slide);
  }
  e.touch.drift = false;
  return { count: wheels.length, ks, scaleY: sc.y, arcs, turns, runs, skinNose: skinAt(2.25) };
});
{
  const m = moving;
  const mm = (g) => g * m.scaleY * 1000;
  const names = Object.keys(m.runs);
  console.log(`moving     ${m.count} wheels driven through ${names.join(", ")}`);
  const arcOk = m.arcs.every((a) => Math.abs(a - 1) < 0.005);
  const ratio = m.turns[1] / m.turns[0];
  console.log(`rolling    each tyre lays ${m.arcs.map((a) => a.toFixed(4)).join(" / ")} of the road; rears turn ${ratio.toFixed(3)}x the nose tyre ` +
    check(arcOk && Math.abs(ratio - m.ks[0] / m.ks[1]) < 0.01,
      `the tyres lay ${m.arcs.map((a) => a.toFixed(4))} of the road (want 1.000), rears ${ratio.toFixed(3)}x the nose tyre's turns (want ${(m.ks[0] / m.ks[1]).toFixed(3)})`));
  const hub = Math.max(...names.flatMap((n) => m.runs[n].hub));
  console.log(`contact    worst hub ${(hub * 1000).toFixed(1)} mm off its tyre's radius in every pose ` +
    check(hub < 0.005, `a hub is ${(hub * 1000).toFixed(1)} mm off the road: the suspension is not keeping a tyre on it`));
  const lockX = Math.max(m.runs.lockL.noseX, m.runs.lockR.noseX);
  const steer = Math.min(m.runs.lockL.steer, m.runs.lockR.steer);
  console.log(`lock       nose tyre steers ${(steer * 57.3).toFixed(0)} deg and reaches ${mm(lockX).toFixed(0)} mm out of the nose's ${mm(0.235).toFixed(0)} mm opening ` +
    check(steer > 0.4 && lockX <= 0.235,
      `the nose tyre steers ${(steer * 57.3).toFixed(0)} deg and reaches ${mm(lockX).toFixed(0)} mm: ${steer > 0.4 ? "past the opening in the nose, into the bodywork" : "it is not steering"}`));
  const out = Math.max(...names.map((n) => m.runs[n].noseOut));
  console.log(`bonnet     nose tyre ${out <= 0 ? `${(-mm(out)).toFixed(0)} mm under` : `${mm(out).toFixed(0)} mm ABOVE`} the bonnet's skin at its worst; the stop dives ${(m.runs.brake.pitch * 57.3).toFixed(2)} deg ` +
    check(out <= 0, `the nose tyre comes up ${mm(out).toFixed(0)} mm through the bonnet as the body dives ${(m.runs.brake.pitch * 57.3).toFixed(2)} deg: the dive limit is too large for it`));
  const wall = Math.min(...names.map((n) => m.runs[n].wall));
  console.log(`walls      rear tyres ${mm(wall).toFixed(0)} mm inboard of the cut's back wall at the closest ` +
    check(wall >= 0, `a rear tyre is ${(-mm(wall)).toFixed(0)} mm through the inboard wall of its opening`));
}

await browser.close();
if (fail.length) {
  console.log(`\nFAILURES:\n${fail.map((f) => ` - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nthe Black Demon is black, marked on four sides, on three wheels (the front one in view), and behind two locks");
