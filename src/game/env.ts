import * as THREE from "three";

/**
 * The night this game reflects.
 *
 * Car paint is only convincing when there is something for the
 * clearcoat to mirror: a gradient dome so a horizon band sweeps across
 * the bodywork as the car turns, dark ground below and dark sky above,
 * plus the LED streetlights as discrete hot spots so the lacquer
 * picks up long travelling streaks instead of one flat sheen.
 *
 * Baked once into a PMREM cubemap. Shared by the race and the main
 * menu's turntable — two recipes would mean the car you pick in the
 * menu is lit by a different city than the one you drive into.
 */
export function nightEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();

  // Gradient dome: asphalt below, a bright haze band at the horizon,
  // a dark, nearly neutral night above.
  //
  // The band was sodium amber (#e8b070, B/R 0.20 in linear light) and
  // the stop under it brown (#3a2a1c), long after the street was re-lit
  // with white LED — so the city every car was lit by was orange. That
  // mattered more than a reflection's hue would suggest. Integrated
  // cosine-weighted over a vertical surface's hemisphere, lamps, moon and
  // towers included, the band is 43-47% of this bake's diffuse light, so
  // every flank, tyre and facade in the shadow of the key read warm (the
  // 4K stills' facades B/R 0.6, tyres down to 0.3) under a sky that read
  // blue: two casts in one frame.
  //
  // Now the white-LED hue the lamps below already have, at EQUAL
  // LUMINANCE: the band #bfbbad is linear Y 0.4963 against 0.4938 at B/R
  // 0.80 against 0.20, and the ground stop #2e2d2a is Y 0.0262 against
  // 0.0264 at B/R 0.85 against 0.27. The clearcoat streak keeps its
  // brightness and its job — check:paint was calibrated on that
  // luminance — and only its colour moves, amber to warm white. The two
  // zenith stops lose their blue (B/R about 6 to about 2) and some light
  // with it, Y 0.0056 -> 0.0041 and 0.0173 -> 0.0104, in step with the
  // darker night sky in world.ts. Integrated the same way, a vertical's
  // light goes about -2% at B/R 0.7 -> 1.0, the road's -4% at
  // 1.37 -> 1.22, and an undertray's is unchanged in level at B/R 0.99
  // instead of 0.46. A creamier #d6c3a6 was considered: 14% brighter
  // (Y 0.561), which is a brighter streak and a moved paint check.
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, "#0b0d14"); // zenith
  g.addColorStop(0.42, "#161a24");
  g.addColorStop(0.5, "#bfbbad"); // the horizon band — the money stripe, LED-white haze
  g.addColorStop(0.56, "#2e2d2a");
  g.addColorStop(0.72, "#0b0c10");
  g.addColorStop(1.0, "#050506"); // ground
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  const domeTex = new THREE.CanvasTexture(c);
  domeTex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(60, 24, 16),
    new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide })
  );
  env.add(dome);

  // Streetlights: a ring of emitters at lamp height, so the clearcoat
  // picks up travelling highlights instead of one flat sheen. 11 to 17 m
  // up, which brackets the columns' 12 m lens.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 8, 6),
      // White LED, matching the columns the world actually builds. Left
      // warm, every chrome and clearcoat in the game kept reflecting a
      // sodium street that is no longer there.
      // Brighter than they were (8.2, 8.6, 9.4). "Shine" on a moving car
      // is the STREAK a lamp draws along the shoulder, and that comes
      // from the point sources in this bake, not from envMapIntensity —
      // turning the whole environment up makes the body wet all over
      // (the note beside the paint's 2.1 records 2.4 doing exactly
      // that). Turning the lamps up brightens the streak and leaves the
      // panel between streaks where it was. Measured on check:paint.
      new THREE.MeshBasicMaterial({ color: new THREE.Color(11.5, 12.0, 13.2) })
    );
    lamp.position.set(Math.cos(a) * 34, 11 + (i % 3) * 3, Math.sin(a) * 34);
    env.add(lamp);
  }

  // The moon, high and cool — a small hard highlight
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(3.4, 12, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(9.5, 10, 12) })
  );
  moon.position.set(-34, 38, -14);
  env.add(moon);

  // The city, which was not in here at all.
  //
  // Everything above is sky, ground and point sources — so a car driving
  // between towers on Gulf Road reflected a gradient and eight lamps and
  // nothing else. What a flank actually does in a city at night is carry
  // the buildings: dark slabs with lit windows sliding along it, broken
  // by the gaps between them. That travelling break is most of what
  // reads as "reflective" on a moving car, and a smooth gradient cannot
  // produce it at any resolution or any envMapIntensity.
  //
  // Cheap, because this is baked once into a cubemap and never drawn:
  // boxes of window texture on a ring well outside the lamps. They are
  // DARKER than the sky behind them, which is the point — a reflection
  // is a pattern, not a brightness, and the pattern here is black tower
  // against the horizon's haze.
  //
  // HOW FAR OUT is the whole of it, and the first version got it wrong.
  // Twenty towers on a 46 m ring subtend about eighteen degrees each,
  // and twenty times eighteen is three hundred and sixty: they enclosed
  // the horizon completely and ate the band the dome exists to provide.
  // Measured on check:paint, that halved the highlight on the bodywork —
  // 4.7% of the panel down to 2.3% under the lamps, 5.7% to 3.6% in the
  // dark — and tripled the dead fraction. A reflection of a city with no
  // sky in it is duller than no city at all.
  //
  // At 95 m and beyond, fourteen of them subtend about seven degrees
  // each: a quarter of the ring is tower and three quarters is still
  // sky, which is what a skyline looks like from a road and what leaves
  // the band somewhere to sweep.
  const winC = document.createElement("canvas");
  winC.width = 32;
  winC.height = 64;
  const wc = winC.getContext("2d")!;
  wc.fillStyle = "#07080c";
  wc.fillRect(0, 0, 32, 64);
  // A deterministic window grid — the same city every bake, because a
  // reflection that reshuffles between the menu and the road is two
  // cities.
  for (let r = 0; r < 16; r++) {
    for (let cIdx = 0; cIdx < 6; cIdx++) {
      const lit = ((r * 7 + cIdx * 13) % 11) < 4;
      if (!lit) continue;
      // Two window colours: warm interior and cool screen glow. Lifted
      // from the first version's near-black, because a tower that is
      // only a hole in the sky subtracts from the reflection instead of
      // adding a pattern to it.
      wc.fillStyle = (r + cIdx) % 3 === 0 ? "#6b5a34" : "#3d4759";
      wc.fillRect(3 + cIdx * 5, 2 + r * 4, 3, 2);
    }
  }
  const winTex = new THREE.CanvasTexture(winC);
  winTex.colorSpace = THREE.SRGBColorSpace;
  const winMat = new THREE.MeshBasicMaterial({ map: winTex });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.16;
    // Heights from one repeating pattern rather than a random draw, for
    // the same reason the windows are: one city.
    const h = 26 + ((i * 37) % 5) * 11;
    const w = 9 + ((i * 17) % 4) * 3;
    const r = 95 + ((i * 23) % 3) * 13;
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), winMat);
    block.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    block.rotation.y = a;
    env.add(block);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  // far: the dome is at 60 and the towers stand at 95 to 121, so the
  // default 100 would clip most of the skyline out of the bake.
  const tex = pmrem.fromScene(env, 0.02, 0.1, 320).texture;
  pmrem.dispose();
  domeTex.dispose();
  return tex;
}

/**
 * The day this game reflects, and is lit by in the shade.
 *
 * The night bake above used to stand in at every hour, so at noon a
 * shaded surface was lit by a sodium-orange city at about a tenth of
 * the sky's real strength: the cabin, the tyres and every tower's shade
 * side went black under a bright sky, and the driver's visor mirrored a
 * night street. This is the same recipe for daylight: the day sky's own
 * gradient (setTimeOfDay's noon keyframes, in sRGB), sunlit ground
 * below, and the skyline as pale blocks rather than lit windows.
 *
 * No sun in it. The sun is the key light, which moves with the clock;
 * a sun baked into a fixed cube would put a second, wrong highlight on
 * every clearcoat for most of the day.
 */
export function dayEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, "#5a95e6"); // zenith
  g.addColorStop(0.36, "#8fbaf0");
  g.addColorStop(0.49, "#cfe0f5"); // the horizon haze
  g.addColorStop(0.53, "#a89c88"); // sand and the far shore
  g.addColorStop(0.7, "#6e665c"); // sunlit asphalt
  g.addColorStop(1.0, "#5a544c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  const domeTex = new THREE.CanvasTexture(c);
  domeTex.colorSpace = THREE.SRGBColorSpace;
  env.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(60, 24, 16),
      new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide })
    )
  );
  // The skyline, on the same ring and in the same pattern as the night
  // bake's, so the reflection sweeps the same city: sun-faded concrete
  // and glass rather than dark slabs with windows.
  const blockMat = new THREE.MeshBasicMaterial({ color: 0x8a8f96 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.16;
    const h = 26 + ((i * 37) % 5) * 11;
    const w = 9 + ((i * 17) % 4) * 3;
    const r = 95 + ((i * 23) % 3) * 13;
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), blockMat);
    block.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    block.rotation.y = a;
    env.add(block);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02, 0.1, 320).texture;
  pmrem.dispose();
  domeTex.dispose();
  return tex;
}
