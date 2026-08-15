import * as THREE from "three";
import { createCar, type CarColors } from "./cars";
import { nightEnvironment } from "./env";

// The main menu's turntable.
//
// A menu that opens on a flat gradient tells you nothing; a menu that
// opens on YOUR car, the one you bought and modified, lit like a
// showroom at 2 a.m., is the game introducing itself. This is a small
// self-contained scene — one car, a pool of light, a ring of lamps —
// not the race world, so the menu appears immediately and costs a
// fraction of a frame instead of the full city.
//
// It shares the race's environment map (env.ts), so the paint here
// mirrors the same night you are about to drive into.

export interface AttractHandle {
  /** Rebuild the car — the garage changed underneath the menu. */
  setCar(colors: CarColors): void;
  resize(): void;
  /** Frames drawn so far. The menu test watches this to prove the
   *  turntable is live rather than a still — reading the canvas back
   *  cannot prove it, since WebGL discards the drawing buffer on
   *  composite and hands a scripted readPixels a screenful of zeros. */
  readonly frames: number;
  /** Triangles submitted by the last frame: nonzero means the car is
   *  genuinely in front of the camera and not merely built. */
  readonly triangles: number;
  /** Turntable angle, for a test that wants to see it actually turn. */
  readonly angle: number;
  dispose(): void;
}

/** A soft round pool of light for the car to stand in. */
function poolTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  g.addColorStop(0, "rgba(120,140,170,0.5)");
  g.addColorStop(0.35, "rgba(70,90,120,0.22)");
  g.addColorStop(0.72, "rgba(30,40,60,0.06)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Build the menu turntable on its own canvas.
 *
 * `reduced` draws a single frame and stops — the same courtesy the
 * versus film pays to prefers-reduced-motion, and the reason the
 * headless test suite never pays for this scene.
 */
export function buildAttract(
  canvas: HTMLCanvasElement,
  colors: CarColors,
  reduced = false
): AttractHandle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    // The race asks for low-power because it runs for minutes on end.
    // A menu is a single still-ish frame of one object; ask for the
    // real GPU and spend it on looking right.
    powerPreference: "high-performance",
  });
  // A real contact shadow under the car. Without one the turntable was
  // a car floating a few centimetres over a painted pool of light —
  // the single thing that most gave away that it was not a photograph.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.environment = nightEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);

  // The car sits on a turntable rather than the camera orbiting it: the
  // horizon band in the environment map then sweeps along the flank,
  // which is the whole reason the paint reads as lacquer.
  const table = new THREE.Group();
  scene.add(table);

  let car: THREE.Group | null = null;
  const buildCar = (c: CarColors) => {
    if (car) {
      table.remove(car);
      car.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
    car = createCar(c);
    car.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    // Parked, not running. The headlight halo and diffraction star are
    // sized for an oncoming car at night; at showroom range they blow a
    // white smear across half the menu. Sidelights only.
    for (const m of (car.userData.headGlowMats as THREE.SpriteMaterial[]) ?? []) {
      m.opacity *= 0.18;
    }
    table.add(car);
  };
  buildCar(colors);

  // Ground: a dark disc with a pool of light under the car, fading out
  // before it reaches an edge the camera could catch.
  const pool = poolTexture();
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(14, 48),
    new THREE.MeshBasicMaterial({ map: pool, transparent: true, depthWrite: false })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.005;
  scene.add(ground);
  // The pool of light is unlit basic material and cannot take a shadow,
  // so the shadow lands on its own catcher just beneath it.
  const catcher = new THREE.Mesh(
    new THREE.CircleGeometry(9, 40),
    new THREE.ShadowMaterial({ opacity: 0.5 })
  );
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.004;
  catcher.receiveShadow = true;
  scene.add(catcher);

  // Lighting: warm sodium key from behind one shoulder, cool gulf fill
  // from the other, and a tight top light to put a line down the roof.
  const key = new THREE.DirectionalLight(0xffcf8a, 2.6);
  key.position.set(-5, 5.5, -3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  // A tight frustum around the car: the whole shadow budget spent on
  // the only object that casts one.
  const sc = key.shadow.camera;
  sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4;
  sc.near = 0.5; sc.far = 22;
  key.shadow.bias = -0.0016;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x5fc9ee, 1.5);
  fill.position.set(5.5, 2.6, 4.5);
  scene.add(fill);
  const top = new THREE.SpotLight(0xdfe9ff, 34, 22, 0.55, 0.65, 1.6);
  top.position.set(0.6, 8.5, 1.2);
  scene.add(top);
  scene.add(new THREE.AmbientLight(0x2b3a58, 0.8));

  // Stars, so the space above the car is night rather than nothing
  {
    const n = 220;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // Deterministic scatter: a menu that twinkles differently on every
      // reload is a menu whose screenshots never match.
      const a = i * 2.39996;
      const r = 40 + ((i * 7919) % 30);
      const y = 6 + ((i * 6151) % 34);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    scene.add(
      new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color: 0x9fb6d8, size: 0.22, sizeAttenuation: true })
      )
    );
  }

  let raf = 0;
  let frames = 0;
  let disposed = false;
  let t = 0;
  let last = 0;

  // How far the shot is pushed left of the car, so the car sits in the
  // clear right-hand side of the frame with the menu down the left.
  // A narrow screen has no clear side, so there the car centres and
  // retreats behind the scrim instead.
  let offsetX = -2.6;
  let dist = 10.4;

  const resize = () => {
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    // Render at the display's real density, up to 2x.
    //
    // This used to cap at 1.25 to save cost, and that cap was the whole
    // reason the menu looked soft: on any retina panel the turntable was
    // being drawn at roughly half the resolution of the text sitting on
    // top of it, so the one 3D thing on the screen was the blurriest
    // thing on the screen. The menu renders ONE car against a flat
    // ground with no post chain — it can afford the pixels the race
    // cannot, and this is the screen a player looks at longest before
    // deciding what they think of the game.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    camera.aspect = aspect;
    const wide = aspect >= 1.15;
    camera.fov = wide ? 34 : 42;
    // Enough push to clear the menu column, not so much that the nose
    // runs off the edge — the car turns, so the silhouette it has to
    // fit inside is its diagonal, not its length.
    offsetX = wide ? -1.8 : 0;
    dist = wide ? 12 : 13.5;
    camera.updateProjectionMatrix();
  };

  const draw = (dt: number) => {
    t += dt;
    // A slow three-quarter sweep, easing at the ends rather than
    // spinning like a display stand in a shop window.
    table.rotation.y = 0.55 + Math.sin(t * 0.12) * 0.85;
    // The camera breathes a little so the shot is never dead still
    const h = 1.9 + Math.sin(t * 0.19) * 0.12;
    camera.position.set(offsetX * 0.35, h, dist + Math.sin(t * 0.09) * 0.4);
    // Aiming left of the car pushes it into the right of the frame
    camera.lookAt(offsetX, 0.72, 0);
    renderer.render(scene, camera);
    frames++;
  };

  resize();
  if (reduced) {
    draw(0);
  } else {
    const loop = (now: number) => {
      if (disposed) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      draw(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  return {
    setCar(c) {
      buildCar(c);
    },
    resize,
    get frames() {
      return frames;
    },
    get triangles() {
      return renderer.info.render.triangles;
    },
    get angle() {
      return table.rotation.y;
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh || (o as THREE.Points).isPoints) m.geometry?.dispose();
      });
      pool.dispose();
      scene.environment?.dispose();
      renderer.dispose();
    },
  };
}
