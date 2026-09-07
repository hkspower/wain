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
const look = await page.evaluate((id) => {
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
  });
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
      // And which way is up in the picture, so a mark on the deck is not
      // upside down to the car behind it.
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
  const solid = [];
  g.traverse((o) => { if (o.isMesh && o.visible && !o.userData?.decal) solid.push(o); });
  const REACH = 0.4;
  const standoff = {}, covered = {};
  for (const m of marks) {
    const dir = new THREE.Vector3(...m.n).normalize();
    const at = new THREE.Vector3(m.wx, m.wy, m.wz).addScaledVector(dir, 0.002);
    const inward = new THREE.Raycaster(at, dir.clone().negate(), 0, REACH).intersectObjects(solid, false)[0];
    standoff[m.tag] = inward ? +(inward.distance + 0.002).toFixed(4) : null;
    const outward = new THREE.Raycaster(at, dir, 0, REACH).intersectObjects(solid, false)[0];
    covered[m.tag] = outward
      ? outward.object.material?.name ?? outward.object.userData?.shell ?? "something"
      : null;
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
const tags = look.marks.map((m) => m.tag);
console.log(`marks     ${tags.join(", ") || "none"}  ` +
  check(look.marks.length === 4 &&
    ["demon-deck", "demon-flank", "demon-flank", "demon-hood"].join() === tags.join(),
    `the livery put ${look.marks.length} marks on the car, not one on each side`));

for (const m of look.marks) {
  const c = look.clearance[m.tag];
  const texels = m.px / m.size;
  const over = look.covered[m.tag];
  console.log(
    `  ${m.tag.replace("demon-", "").padEnd(6)} ${m.size.toFixed(2)} m, ${Math.round(texels)} texels/m, ` +
    `${c === null ? "no panel under it" : `${(c * 1000).toFixed(0)} mm off the paint`}` +
    `${over ? `, UNDER ${over}` : ""}  ` +
    check(
      c !== null && c > 0.004 && c < 0.04 && texels > 500 && !over,
      c === null
        ? `${m.tag} has no bodywork under it — it is hung in the air`
        : c <= 0.004
          ? `${m.tag} is ${(c * 1000).toFixed(0)} mm off the panel: it will z-fight the paint`
          : c >= 0.04
            ? `${m.tag} floats ${(c * 1000).toFixed(0)} mm above the panel`
            : over
              ? `${m.tag} is underneath the car's own ${over} — a sticker nobody can see`
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
// And the deck mark reads from behind rather than from the driver's seat,
// which is the only reason to put one back there.
const deck = look.marks.find((m) => m.tag === "demon-deck");
console.log(`deck up   ${check(
  deck && deck.up[2] < -0.5,
  "the mark on the boot is upside down to the car behind it"
)}  its top points at the tail`);

// ---- 5. One mark per panel, and a bought wheel still wins ------------
const both = await page.evaluate((id) => {
  const car = window.__grnShowroom.car(id);
  const mk = (extra) => {
    const g = window.__grnBuildCar({
      body: car.color, style: car.style, kit: car.kit, raceKit: car.kit === "attack",
      lengthM: car.lengthM, rims: car.rims, livery: car.livery, ...extra,
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

await browser.close();
if (fail.length) {
  console.log(`\nFAILURES:\n${fail.map((f) => ` - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nthe Black Demon is black, marked on four sides, and behind two locks");
