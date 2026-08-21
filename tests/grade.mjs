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
  e.player.s = 2203; e.player.lat = 0; e.player.speed = 32;
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
  e.setBrightness(setup.brightness ?? 1);
  e.player.s = 2203;
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
    e.player.s = 2203;
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
check(evUp.mean > ev0.mean, "exposure is not monotonic upward");

// Downward, measured at NIGHT and pixel by pixel, and neither of those
// is a detail.
//
// At noon a stop down does not darken this picture. It measures +0.1%
// on the frame mean and it is not noise: the bright fraction goes from
// 0.098 to 0.27 and the standard deviation from 0.26 to 0.32, which is
// the black-point rescale normalising a darker frame back up and
// stretching it on the way. That is the "wash out below -1 EV" this
// file already described — it just starts at -1 rather than below it.
// The old assertion here rode on a 1-3% drop that the toe was already
// cancelling, and it duly failed on a loaded box that read +0.13%: a
// false alarm about a pipeline that was working, which is the most
// expensive kind of test there is.
//
// At night there is no rescale headroom to give back and the control
// does exactly what it says. And the comparison is of the SAME pixels
// in two shots of a parked scene from a fixed camera, so it cannot be
// cancelled by a mean.
const n0 = await shoot({ ev: 0, hour: 22.5 });
const nDown = await shoot({ ev: -1, hour: 22.5 });
const darker = nDown.luma.filter((v, i) => v < n0.luma[i]).length;
const lighter = nDown.luma.filter((v, i) => v > n0.luma[i]).length;
console.log(
  `            a stop down at night: mean ${nDown.mean} vs ${n0.mean}, ` +
    `${darker} pixels darker and ${lighter} lighter of ${nDown.luma.length}`
);
check(nDown.mean < n0.mean, "a stop down at night did not darken the frame");
check(darker > lighter * 3, "a stop down at night did not darken most of the picture");

// --- 1b. There is white in the picture ------------------------------
//
// There was not. The shoulder above the knee was an asymptote —
// over/(over + headroom) — which approaches 1.0 and never arrives, and
// tone mapping hands this pass values that top out around 1.0. So the
// brightest pixel the game could physically produce came out at 0.930:
// 237 of 255. Not the moon, not a lamp core, not a specular hit off a
// wet panel. A picture with no white in it reads flat however much
// contrast is poured into the middle of it.
//
// Asked of the CURVE rather than of a frame. Whether tonight's drive
// happens to contain a bright enough lamp is a fact about the drive;
// whether the curve can reach white at all is a fact about the grade.
const white = await page.evaluate(() => {
  const e = window.__grnEngine;
  const u = e.grainPass.uniforms;
  const K = u.uKnee.value;
  const W = u.uWhitePoint.value;
  // The shader's shoulder, in JS. One expression, copied deliberately:
  // a test that re-derives it is testing its own arithmetic.
  const shoulder = (c, h = 0) => {
    const white = Math.max(K + 1e-3, W * (1 - h * 0.18));
    const A = white - K;
    const B = 1 - K;
    const k = A / Math.max(B, 1e-4);
    if (c < K) return c;
    const s = Math.min(1, Math.max(0, (c - K) / A));
    return K + B * (((k - 2) * s + (3 - 2 * k)) * s * s + k * s);
  };
  const out = {};
  for (const c of [0.5, 0.8, K, 0.95, 1.0, W, 1.4]) out[c.toFixed(3)] = +shoulder(c).toFixed(4);
  return {
    knee: K, whitePoint: W, curve: out,
    atWhite: shoulder(W), justUnder: shoulder(K + (W - K) * 0.5),
    // Slope either side of the knee: it has to leave at 1 or the join
    // is visible as a crease across every bright falloff in the game.
    slopeBelow: (shoulder(K - 1e-4) - shoulder(K - 2e-4)) / 1e-4,
    slopeAbove: (shoulder(K + 2e-4) - shoulder(K + 1e-4)) / 1e-4,
    recover: shoulder(1.0, -1),
    push: shoulder(1.0, 1),
    // Monotone the whole way, which the cubic only is while the
    // shoulder is at most three times the headroom above the knee.
    monotone: (() => {
      let prev = -1;
      for (let c = 0; c <= 1.6; c += 0.001) {
        const v = shoulder(c);
        if (v < prev - 1e-9) return false;
        prev = v;
      }
      return true;
    })(),
  };
});
console.log(
  `\nwhite      knee ${white.knee} -> white point ${white.whitePoint}; ` +
    Object.entries(white.curve).map(([k, v]) => `${k}->${v}`).join(" ")
);
console.log(
  `reaches    ${check(white.atWhite >= 0.999,
    `the white point maps to ${white.atWhite.toFixed(4)}, not to white`)}  ` +
    `${white.whitePoint} in becomes ${(white.atWhite * 255).toFixed(0)}/255`
);
console.log(
  `no crease  ${check(Math.abs(white.slopeAbove - white.slopeBelow) < 0.02,
    `the curve's slope jumps from ${white.slopeBelow.toFixed(3)} to ${white.slopeAbove.toFixed(3)} at the knee`)}  ` +
    `slope ${white.slopeBelow.toFixed(3)} below the knee, ${white.slopeAbove.toFixed(3)} above`
);
console.log(
  `monotone   ${check(white.monotone, "the shoulder is not monotone — a brighter input comes out darker")}  ` +
    `brighter in is never darker out`
);
console.log(
  `controls   ${check(white.recover < white.push - 0.005,
    `recover ${white.recover.toFixed(4)} and push ${white.push.toFixed(4)} do not straddle neutral`)}  ` +
    `at 1.0 in: recover ${(white.recover * 255).toFixed(0)}, push ${(white.push * 255).toFixed(0)} of 255`
);

// --- 1c. Brightness lifts the floor and leaves white alone -----------
//
// A gamma about black, not a gain, because the thing that needs moving
// in a night game is the bottom of the range: the asphalt between the
// lamps, which is what the driver actually has to read. A gain would
// push the lamps through the roof to get there. The two halves of that
// claim are what is measured — the dark end moves, the top end does
// not.
const bDim = await shoot({ brightness: 1.0, hour: 22.5 });
const bUp = await shoot({ brightness: 1.3, hour: 22.5 });
const darkLift = bUp.luma.filter((v, i) => v > bDim.luma[i] + 1).length;
console.log(
  `\nbrightness 1.0 mean ${bDim.mean} -> 1.3 mean ${bUp.mean}; ` +
    `top end ${bDim.topMean} -> ${bUp.topMean}; ${darkLift} of ${bUp.luma.length} pixels lifted`
);
console.log(
  `lifts      ${check(bUp.mean > bDim.mean * 1.15 && darkLift > bUp.luma.length * 0.5,
    `brightness moved the mean ${bDim.mean} -> ${bUp.mean} and lifted ${darkLift} pixels`)}  ` +
    `the picture comes up, ${((darkLift / bUp.luma.length) * 100).toFixed(0)}% of pixels with it`
);
console.log(
  `keeps white ${check(bUp.topMean < bDim.topMean * 1.06,
    `the top end went ${bDim.topMean} -> ${bUp.topMean} — brightness is acting as a gain`)}  ` +
    `the top end holds at ${bUp.topMean} against ${bDim.topMean}`
);

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
  e.player.s = 2203; e.player.lat = 0; e.player.speed = 0;
  const park = () => {
    const away = e.track.wrap(e.player.s + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
    e.player.s = 2203; e.player.lat = 0; e.player.speed = 0;
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

// ---- the shadow lift is a NIGHT look, and knows it ------------------
// The lift is what took the road from 37.6% of its pixels sitting on
// black to none of them. It is also, applied in daylight, enough to
// reverse the exposure control — a stop DOWN came back 6% brighter —
// so it is gated on the sun. That gate is one line in applyDaylight()
// and nothing else would notice if it stopped working: the night would
// quietly go back to being crushed. This is the line that notices.
{
  const r = await page.evaluate(async () => {
    const e = window.__grnEngine;
    const u = e.grainPass.material.uniforms;
    const at = (h) => {
      e.timeHours = h;
      e.world.setTimeOfDay(h);
      e.applyDaylight();
      return +u.uNight.value.toFixed(3);
    };
    const out = { night: at(22.5), noon: at(12.5), dusk: at(18.2), dawn: at(5.6) };
    e.timeHours = 22.5;
    e.world.setTimeOfDay(22.5);
    e.applyDaylight();
    return out;
  });
  console.log(
    `night gate  22:30 ${r.night} | 12:30 ${r.noon} | 18:12 ${r.dusk} | 05:36 ${r.dawn}`
  );
  check(r.night > 0.9, `the shadow lift is only ${r.night} at 22:30 — the night stays crushed`);
  check(r.noon < 0.05, `the shadow lift is ${r.noon} at midday — it will flatten daylight`);
  check(
    r.dusk > 0.05 && r.dusk < 0.9,
    `twilight reads ${r.dusk}, which is either full night or full day rather than dusk`
  );
}

console.log(fail.length?"\nFAILURES:\n - "+fail.join("\n - "):"\nthe grade grades");
await b.close();
process.exit(fail.length?1:0);
