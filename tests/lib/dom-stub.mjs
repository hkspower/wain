// Just enough DOM for src/game/cars.ts to build a car in node.
//
// createCar makes canvas textures — plates, tyre sidewalls, decals,
// headlamp glare — and a canvas needs a document. None of that paint is
// ever sampled by a test that measures GEOMETRY, so the textures only
// have to exist, not to draw. Everything here returns something inert
// and correctly shaped.
//
// This is a deliberate trade. The alternative is a browser, and a
// browser costs a dev server, a WebGL context, and on this box about
// fifteen minutes per run of software rasterising — for measurements
// that are pure raycasts against BufferGeometry and want none of it.
// With the stub the same measurements take a couple of seconds, which
// is the difference between a check you run and a check you mean to.
//
// If cars.ts ever reaches for a DOM API that is not here, the failure
// is loud and immediate (a ReferenceError naming the call), never a
// wrong number. That is the property that makes this safe: a stub which
// silently answered wrong would be worse than no stub at all.
const noop = () => {};
const gradient = { addColorStop: noop };
const ctx2d = new Proxy(
  {},
  {
    get(_t, k) {
      if (k === "createRadialGradient" || k === "createLinearGradient" || k === "createPattern")
        return () => gradient;
      // Real backing stores: tyreSurface writes straight into .data.
      if (k === "createImageData" || k === "getImageData")
        return (_x, _y, w, h) => ({
          data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)),
          width: w | 0,
          height: h | 0,
        });
      if (k === "measureText") return () => ({ width: 10 });
      return typeof k === "string" ? noop : undefined;
    },
    set() {
      return true;
    },
  }
);
const makeCanvas = () => ({
  width: 64,
  height: 64,
  style: {},
  getContext: () => ctx2d,
  toDataURL: () => "data:image/png;base64,",
  addEventListener: noop,
  removeEventListener: noop,
});

globalThis.document = {
  createElement: (tag) =>
    tag === "canvas" ? makeCanvas() : { style: {}, appendChild: noop, addEventListener: noop },
  createElementNS: () => makeCanvas(),
  body: { appendChild: noop },
  documentElement: { style: {} },
  addEventListener: noop,
  removeEventListener: noop,
};
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop }),
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "", fontFamily: "sans-serif" });
globalThis.Image = class {
  set src(_v) {}
  addEventListener() {}
};
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close: noop });
globalThis.navigator ??= { userAgent: "node" };
globalThis.self ??= globalThis;

// An empty asset manifest, so createCar's own model fetch stops before
// it reaches a loader. models.ts asks build.json what shipped and skips
// any file the manifest does not list (that is its 404 guard), so an
// empty `assets` makes every shell resolve to "nothing to load" and the
// procedural build simply stands — which is the fallback the whole
// module is designed around, and the state a caller measuring the
// EXTRUSION wants anyway.
//
// Without this the fetch succeeds far enough to hand GLTFLoader a
// root-relative URL, which node cannot resolve, and the rejection
// surfaces as an unhandled error after the test has already passed.
// A test that reads green and exits non-zero is worse than one that
// fails honestly. Anything wanting the authored shells loads them from
// disk itself, which is what tests/glassfit.mjs does.
globalThis.fetch = async () => ({
  ok: true,
  text: async () => JSON.stringify({ assets: {} }),
  json: async () => ({ assets: {} }),
});
