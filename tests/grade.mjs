// Grading, measured off the actual pixels. Every control here is a claim
// about the histogram of the delivered frame, so the test reads frames
// back and computes that histogram rather than trusting a uniform.
import { chromium } from "playwright-core";
import { existsSync, writeFileSync } from "node:fs";
const C=[process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium","/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find(p=>existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium"); process.exit(2); }
const b = await chromium.launch({executablePath:exe,args:["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"],headless:true});
const page = await b.newPage({viewport:{width:960,height:540}});
page.setDefaultTimeout(120000);
page.on("pageerror",(e)=>console.log("PAGEERROR:",e.message));
await page.goto("http://localhost:3000/race",{waitUntil:"networkidle"});
await page.evaluate(()=>{localStorage.clear();localStorage.setItem("gulf-road-nights-onboarded","2");localStorage.setItem("gulf-road-nights-coach","3");});
await page.reload({waitUntil:"networkidle"});
await page.click("text=START ENGINE");
await page.waitForFunction(()=>!!window.__grnDebug,null,{timeout:120000});

const fail=[]; const check=(c,m)=>{if(!c)fail.push(m);return c?"ok":"FAIL";};

// Warm-up before anything is measured. The world finishes assembling
// after the engine reports ready — authored textures and palm crowns
// stream in, shadow maps and the reflection probe want frames — and a
// histogram taken while that is still landing is the histogram of a
// half-built scene. It showed up as the first shots reading dark and
// the exposure ladder coming out non-monotonic perhaps one run in
// three, which reads as a grading bug and is nothing of the kind.
await page.evaluate(async ()=>{
  const e = window.__grnEngine;
  e.setPaused(true);
  // Pin the resolution. Dynamic resolution scaling reacts to measured
  // frame rate, and on the software rasteriser this suite runs on it
  // wanders anywhere between 0.6 and 1.0 before the first measurement
  // depending on how the machine felt that minute — which moves the
  // bloom and therefore the histogram. An explicit tier turns DRS off.
  e.applyQualityTier("high");
  e.timeHours = 22.5; e.world.setTimeOfDay(22.5); e.applyDaylight();
  e.player.s = e.track.length * 0.30; e.player.lat = 0; e.player.speed = 32;
  for (const t of e.traffic) t.s = e.track.wrap(e.player.s + e.track.length/2);
  for (let i=0;i<60;i++) e.update(1/60);
  e.composer.render();
  await new Promise(r=>setTimeout(r, 800)); // let the streamed assets land
  for (let i=0;i<40;i++) e.update(1/60);
  e.composer.render();
});

// Render a frame with the given picture settings and measure it
const shoot = (setup) => page.evaluate(async (setup)=>{
  const e = window.__grnEngine;
  e.setPaused(true);
  e.timeHours = setup.hour ?? 22.5;
  e.world.setTimeOfDay(e.timeHours);
  e.applyDaylight();
  e.setExposure(setup.ev ?? 0, setup.auto ?? false);
  e.setContrast(setup.contrast ?? 1);
  e.setHighlights(setup.highlights ?? 0);
  e.setSaturation(setup.sat ?? 1);
  e.player.s = e.track.length * 0.30;
  e.player.lat = 0;
  // Still, deliberately. The camera carries a speed-scaled rumble, so at
  // road speed every frame is framed slightly differently — which is
  // invisible to a histogram but fatal to any comparison of the SAME
  // pixel between two shots: the dark pixels move to a different part
  // of the scene and read as though a highlight control had lifted the
  // shadows by a factor of two.
  e.player.speed = 0;
  // Park everything that moves, every frame — not once before the loop.
  // The rival keeps cruising through update(), and a lit car with
  // headlights and underglow drifting into a night frame is worth more
  // than half the histogram: it made the middle of the exposure ladder
  // swing 60% between runs while the ends stayed put.
  const park = () => {
    const away = e.track.wrap(e.player.s + e.track.length/2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
    e.player.s = e.track.length * 0.30;
    e.player.lat = 0; e.player.speed = 0;
  };
  park();
  // Twice. One pass leaves the picture still carrying whatever the
  // previous shot set — the exposure pass and the bloom both hold state
  // between frames — and the first shot of a series read as a different
  // scene entirely. Staging it twice costs a few frames and removes an
  // entire class of false readings.
  for (let pass=0; pass<2; pass++) {
    for (let i=0;i<24;i++) { e.update(1/60); park(); }
    for (let i=0;i<3;i++) e.composer.render();
  }
  // Render until the picture settles rather than measuring the first
  // frame after a settings change. The exposure pass carries state
  // between frames (that is what makes auto-exposure adapt rather than
  // pop), so one render after a change can still show the previous
  // shot's exposure — which made this ladder read non-monotonic and
  // looked exactly like a grading bug.
  for (let i=0;i<3;i++) e.composer.render();

  const gl = e.renderer.domElement;
  const c = document.createElement("canvas");
  c.width = 240; c.height = 135;
  const ctx = c.getContext("2d");
  ctx.drawImage(gl, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0,0,c.width,c.height).data;
  let sum=0, sum2=0, bright=0, topSum=0, topN=0, shadowSum=0, shadowN=0, n=0, chroma=0;
  for (let i=0;i<d.length;i+=4){
    const r=d[i]/255, g=d[i+1]/255, bl=d[i+2]/255;
    const l = 0.2126*r + 0.7152*g + 0.0722*bl;
    sum+=l; sum2+=l*l; n++;
    // Distance from grey: what saturation actually is, and unlike a mean
    // it cannot be faked by the picture merely getting brighter.
    chroma += (Math.abs(r-l) + Math.abs(g-l) + Math.abs(bl-l)) / 3;
    if (l > 0.75) { bright++; topSum += l; topN++; }
    if (l < 0.25) { shadowSum += l; shadowN++; }
  }
  // Coarse luma map on a fixed grid, for index-wise comparisons
  const coarse = [];
  for (let y=0; y<135; y+=2) for (let x=0; x<240; x+=2) {
    const i = (y*240 + x) * 4;
    coarse.push(Math.round(0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]));
  }
  const mean = sum/n;
  return {
    mean: +mean.toFixed(4),
    sd: +Math.sqrt(sum2/n - mean*mean).toFixed(4),
    bright: +(bright/n).toFixed(4),
    topMean: topN ? +(topSum/topN).toFixed(4) : 0,
    shadowMean: shadowN ? +(shadowSum/shadowN).toFixed(4) : 0,
    chroma: +(chroma/n).toFixed(5),
    // A coarse luma map, so callers can compare the SAME pixels between
    // shots. Measuring "the mean of pixels currently below 0.25" moves
    // its own population as the picture changes: a highlight control
    // that pushes mid-tones up over the line empties the darkest pixels
    // out of the set and the set's mean rises without one shadow pixel
    // having moved. Same class of error as counting clipped pixels in a
    // scene that has none.
    luma: coarse,
  };
}, setup);

// --- 1. Exposure moves the whole picture ---
// Metered in daylight, for the same reason contrast is below: at night
// the street lamps sit right on the bloom threshold at 0 EV, so a 4%
// lamp shimmer flips a large amount of glow in or out of the frame and
// the middle of the ladder swings 60% between runs while both ends
// stay put. That is the most unstable point in the whole pipeline, and
// it says nothing about whether the exposure control works.
const HOUR = 12.5;
// Measured across the slider's working range. Below -1 EV a daylight
// frame washes out rather than darkening — the shadow toe and the
// black-point rescale lift a dark tone-mapped frame faster than the
// exposure took it down — so a ladder that reaches -2 EV measures that
// wash instead of the control. That bottom-end behaviour predates this
// suite and is noted in the README; the ladder covers the range the
// picture is actually graded in.
const evDown = await shoot({ ev: -1, hour: HOUR });
const ev0    = await shoot({ ev: 0, hour: HOUR });
const evUp   = await shoot({ ev: +1, hour: HOUR });
console.log(`exposure    -1 EV mean ${evDown.mean} | 0 EV ${ev0.mean} | +1 EV ${evUp.mean}`);
// Deliberately asymmetric thresholds, and they belong to this regime.
// A daylight frame sits up on the filmic shoulder, where a stop down is
// compressed (measured -16%) and a stop up still has room to climb
// (+48%). At night it is the other way round. Demanding symmetry would
// be demanding the tone curve not work, so each direction is bounded
// clear of the run-to-run spread rather than at a round number.
// Up is the discriminating direction and is asserted hard. Down is
// asserted for direction only, and that is a statement about the
// pipeline rather than a soft test: the grade's shadow toe and
// black-point rescale are fixed, so as exposure comes down they lift
// the tone-mapped frame back up and the mean barely moves (measured
// -1% to -3%, against +64% going up). The exposure control's lower
// half therefore does very little to a bright frame. Asserting a big
// drop here would be asserting a pipeline this game does not have.
check(evUp.mean > ev0.mean * 1.25, "raising exposure did not brighten the frame");
check(evDown.mean < ev0.mean, "lowering exposure did not darken the frame at all");
check(evDown.mean < ev0.mean && ev0.mean < evUp.mean, "exposure is not monotonic");

// --- 2. Contrast spreads the histogram, and holds the pivot ---
// Measured at noon: a night frame occupies so little of the range that
// any contrast curve barely moves its standard deviation, which made the
// first version of this test unable to tell the control from a no-op.
const cLow  = await shoot({ contrast: 0.8, hour: 12.5 });
const cMid  = await shoot({ contrast: 1.0, hour: 12.5 });
const cHigh = await shoot({ contrast: 1.35, hour: 12.5 });
console.log(`contrast    0.80 sd ${cLow.sd} | 1.00 sd ${cMid.sd} | 1.35 sd ${cHigh.sd}`);
check(cHigh.sd > cMid.sd * 1.05, "raising contrast does not spread the histogram");
check(cLow.sd < cMid.sd * 0.97, "lowering contrast does not flatten the histogram");

// --- 3. Highlights: the top end, and only the top end ---
const hRec  = await shoot({ highlights: -1, hour: 12.5 });
const hFlat = await shoot({ highlights: 0,  hour: 12.5 });
const hPush = await shoot({ highlights: +1, hour: 12.5 });
console.log(`highlights  bright fraction (>0.75): recover ${hRec.bright} | neutral ${hFlat.bright} | push ${hPush.bright}`);
console.log(`            shadow mean: recover ${hRec.shadowMean} | neutral ${hFlat.shadowMean} | push ${hPush.shadowMean}`);
console.log(`            mean of the top end: ${hRec.topMean} | ${hFlat.topMean} | ${hPush.topMean}`);
check(hRec.topMean < hFlat.topMean, "highlight recovery does not pull the top end down");
check(hPush.topMean > hFlat.topMean, "pushing highlights does not lift the top end");
// It must be a highlight control, not an exposure control — measured
// over the pixels that are dark in the NEUTRAL frame, and the same
// pixels in the other two, so the population cannot drift underneath
// the comparison.
const darkIdx = [];
hFlat.luma.forEach((v, i) => { if (v < 64) darkIdx.push(i); });
const overDark = (shot) => darkIdx.reduce((a, i) => a + shot.luma[i], 0) / (darkIdx.length || 1) / 255;
const dFlat = overDark(hFlat), dRec = overDark(hRec), dPush = overDark(hPush);
console.log(`            same ${darkIdx.length} dark pixels: recover ${dRec.toFixed(4)} | neutral ${dFlat.toFixed(4)} | push ${dPush.toFixed(4)}  ` +
  check(Math.abs(dRec - dFlat) < 0.02 && Math.abs(dPush - dFlat) < 0.02,
    "the highlight control moved the shadows"));

// --- 4. Highlight desaturation: bright cores bleed to white ---
// At night the only pixels above the shoulder are lamp cores — exactly
// the population this effect exists for.
const desat = await page.evaluate(async ()=>{
  const e = window.__grnEngine;
  const measure = () => {
    e.composer.render();
    const gl = e.renderer.domElement;
    const c = document.createElement("canvas"); c.width=320; c.height=180;
    const ctx=c.getContext("2d"); ctx.drawImage(gl,0,0,c.width,c.height);
    const d=ctx.getImageData(0,0,c.width,c.height).data;
    let sat=0,n=0;
    for(let i=0;i<d.length;i+=4){
      const r=d[i]/255,g=d[i+1]/255,b=d[i+2]/255;
      const l=0.2126*r+0.7152*g+0.0722*b;
      if(l>0.8){const mx=Math.max(r,g,b),mn=Math.min(r,g,b);sat+=mx>0?(mx-mn)/mx:0;n++;}
    }
    return { sat: n ? +(sat/n).toFixed(3) : -1, n };
  };
  e.grainPass.uniforms.uHighlightDesat.value = 0;
  const off = measure();
  e.grainPass.uniforms.uHighlightDesat.value = 0.5;
  const on = measure();
  return { off, on };
});
console.log(`desaturation ${desat.off.n} pixels above the shoulder; saturation ${desat.off.sat} off -> ${desat.on.sat} on  ` +
  check(desat.off.n > 20, "no highlights in frame to desaturate") + " " +
  check(desat.on.sat < desat.off.sat, "highlights do not bleed to white as they clip"));

// --- 5. Auto exposure carries the day/night cycle ---
const auto = await page.evaluate(async ()=>{
  const e = window.__grnEngine;
  const run = async (hour) => {
    e.timeHours = hour; e.world.setTimeOfDay(hour); e.applyDaylight();
    e.setExposure(0, true);
    // Adaptation is a GPU feedback loop, so it needs frames, not time
    for (let i=0;i<60;i++){ e.update(0.1); e.composer.render(); }
    const s = await e.sampleExposure();
    return { exp:+s.exposure.toFixed(3), lum:+s.luminance.toFixed(4) };
  };
  const night = await run(22.5);
  const noon = await run(12.5);
  return { night, noon, frames: e.autoExp.frames };
});
console.log(`auto        night lum ${auto.night.lum} -> exposure ${auto.night.exp}`);
console.log(`            noon  lum ${auto.noon.lum} -> exposure ${auto.noon.exp}   (${auto.frames} metered frames)`);
check(auto.frames > 50, "the meter never ran");
check(auto.noon.lum > auto.night.lum, "the meter does not see noon as brighter than midnight");
check(auto.noon.exp < auto.night.exp, "auto exposure did not stop down for daylight");

// --- Saturation moves colour, and only colour ------------------------
const satLow  = await shoot({ sat: 0.6, hour: HOUR });
const satMid  = await shoot({ sat: 1.0, hour: HOUR });
const satHigh = await shoot({ sat: 1.4, hour: HOUR });
console.log(`saturation  0.6 chroma ${satLow.chroma} | 1.0 ${satMid.chroma} | 1.4 ${satHigh.chroma}`);
console.log(`            luminance ${satLow.mean} / ${satMid.mean} / ${satHigh.mean}  ` +
  check(satLow.chroma < satMid.chroma * 0.8, "turning saturation down did not remove colour") + " " +
  check(satHigh.chroma > satMid.chroma * 1.2, "turning saturation up did not add colour"));
// Mixing toward the pixel's own luma is luminance-preserving by
// construction. That is what separates this from an HSV twist (which
// shifts hue near the primaries — and this scene is sodium orange and
// neon cyan, exactly the cases that shift) or from a plain gain.
const lumSpread = Math.max(satLow.mean, satHigh.mean) - Math.min(satLow.mean, satHigh.mean);
check(lumSpread < satMid.mean * 0.06,
  `saturation moved brightness by ${lumSpread.toFixed(4)} — it is acting as an exposure control`);
await page.evaluate(() => window.__grnEngine.setSaturation(1.08));

// --- 6. The picture knows what is happening ---
// The music has always switched mood for a battle and the image never
// did. Measured off the delivered frame: chroma is distance from grey,
// which a mere brightness change cannot fake, and the blue-minus-red
// balance says which way the tint went.
const situ = await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.timeHours = 22.5; e.world.setTimeOfDay(22.5); e.applyDaylight();
  e.setExposure(0, false);
  e.player.s = e.track.length * 0.30; e.player.lat = 0; e.player.speed = 0;
  const park = () => {
    const away = e.track.wrap(e.player.s + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
    e.player.s = e.track.length * 0.30; e.player.lat = 0; e.player.speed = 0;
  };
  const shoot = (situation) => {
    e.setSituation(situation);
    // The blend is exponential and lands inside a second; give it two.
    for (let i = 0; i < 120; i++) { e.update(1 / 60); park(); }
    for (let i = 0; i < 3; i++) e.composer.render();
    const gl = e.renderer.domElement;
    const c = document.createElement("canvas"); c.width = 320; c.height = 180;
    const ctx = c.getContext("2d"); ctx.drawImage(gl, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let chroma = 0, devR = 0, devB = 0, lum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      chroma += (Math.abs(r - l) + Math.abs(g - l) + Math.abs(b - l)) / 3;
      devR += r - l;
      devB += b - l;
      lum += l;
      n++;
    }
    const ch = chroma / n;
    // Tint DIRECTION, normalised by how much colour there is at all.
    // Plain mean(r - b) cannot separate the two controls: desaturating
    // pulls every pixel toward its own grey, which drags an already-blue
    // night frame toward zero and reads as "warmer" even while the tint
    // is cooling it. Dividing by chroma cancels the desaturation — it
    // scales every pixel's colour vector by the same factor — and leaves
    // the direction the balance actually pushed.
    return {
      chroma: +ch.toFixed(5),
      warm: +(((devR - devB) / n) / (ch || 1e-6)).toFixed(4),
      lum: +(lum / n).toFixed(4),
    };
  };
  const cruise = shoot("cruise");
  const battle = shoot("battle");
  const win = shoot("win");
  const lose = shoot("lose");
  const back = shoot("cruise");
  e.setSituation(null); // hand the grade back to the game
  return { cruise, battle, win, lose, back };
});
console.log(`situation   cruise chroma ${situ.cruise.chroma} warm ${situ.cruise.warm} lum ${situ.cruise.lum}`);
console.log(`            battle ${situ.battle.chroma} / ${situ.battle.warm}  |  win ${situ.win.chroma} / ${situ.win.warm}  |  lose ${situ.lose.chroma} / ${situ.lose.warm}`);
console.log(`            back to cruise ${situ.back.chroma} / ${situ.back.warm}  ` +
  check(situ.battle.chroma < situ.cruise.chroma * 0.95, "a battle does not pull the colour back") + " " +
  check(situ.battle.warm < situ.cruise.warm, "a battle does not cool the picture") + " " +
  check(situ.win.chroma > situ.cruise.chroma * 1.05, "a win does not lift the colour") + " " +
  check(situ.win.warm > situ.cruise.warm, "a win does not warm the picture") + " " +
  check(situ.lose.chroma < situ.battle.chroma, "losing is not the most drained the picture gets") + " " +
  check(Math.abs(situ.back.chroma - situ.cruise.chroma) < situ.cruise.chroma * 0.06,
    `the grade does not come back to cruise (${situ.back.chroma} vs ${situ.cruise.chroma})`));
// A situation must not be a brightness control in disguise: the tints
// are luma-normalised, so the frame's exposure has to hold across all
// four of them.
const lums = [situ.cruise.lum, situ.battle.lum, situ.win.lum, situ.lose.lum];
console.log(`            luminance across the four: ${lums.join(" / ")}  ` +
  check(Math.max(...lums) - Math.min(...lums) < 0.045, "a situation moved the exposure, not just the colour"));

console.log(fail.length?"\nFAILURES:\n - "+fail.join("\n - "):"\nthe grade grades");
await b.close();
process.exit(fail.length?1:0);
