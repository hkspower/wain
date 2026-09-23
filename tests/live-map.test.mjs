import { chromium } from 'playwright';

/**
 * The map you can move, and the map you get for free.
 *
 * Every map on this site is a fixed OpenStreetMap embed with our own pins
 * projected on top. `LiveMap` upgrades that on request: Leaflet takes over the
 * view and the pins are re-projected as it moves. The upgrade is opt-in and
 * costs 42.4K, so the two things worth proving are that it does not arrive
 * until somebody asks, and that once it does, the pins still belong to the
 * ground underneath them.
 *
 * TILES DO NOT LOAD HERE. `tile.openstreetmap.org` is refused by the sandbox
 * gateway, the same block the static embed already sits behind, so nothing in
 * this file can say the map LOOKS right. Leaflet itself is bundled, so
 * everything below — the panes, the projection, the pins following a pan — is
 * real and measured. What is not measured is a painted tile, and no assertion
 * here pretends otherwise.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const SEARCH = '/search/?q=' + encodeURIComponent('قهوة');
const MAP = 'section[aria-labelledby="search-map-heading"]';

async function open(path = SEARCH, selector = MAP) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'ar-KW' });
  const p = await ctx.newPage();
  const errors = [];
  const asked = [];
  p.on('pageerror', (e) => errors.push(e.message));
  // Every script the page fetches, so «did Leaflet arrive?» is answered by the
  // network rather than by whether something on screen looks different.
  p.on('request', (r) => { if (r.resourceType() === 'script') asked.push(r.url()); });
  await p.goto(B + path, { waitUntil: 'networkidle' });
  const map = p.locator(selector);
  await map.waitFor({ timeout: 8000 });
  return { ctx, p, map, errors, asked };
}

/** The chunk carrying Leaflet has a content-hashed name, so ask by weight. */
const leafletish = (urls) => urls.filter((u) => /_next\/static\/chunks\/[a-f0-9]{8}\./.test(u));

console.log('\n── nobody pays for a map they did not ask to move ──');
{
  const { ctx, p, map, errors, asked } = await open();
  ok('the static basemap is an iframe, as it always was',
    (await map.locator('iframe').count()) === 1);
  ok('and Leaflet has not been fetched',
    (await p.locator('.leaflet-container').count()) === 0 && leafletish(asked).length === 0,
    leafletish(asked).join(' '));
  ok('the offer to move it is there', await map.getByRole('button', { name: /حرّك الخريطة/ }).isVisible());
  ok('and the tile host is not connected to either',
    (await p.locator('link[rel="preconnect"][href*="tile."]').count()) === 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  void p;
  await ctx.close();
}

/**
 * The approach pays for the tap.
 *
 * Measured on the built export at 390px, ×6 CPU, clock from the click: with
 * no warning at all the map is up at ~330ms, and with the 80ms a finger gives
 * between touching and letting go it is up at ~150. Most of that is not the
 * download — it is Leaflet parsing, which `import()` does before it resolves,
 * so priming the module moves the parse and not merely the bytes.
 *
 * What is asserted here is that the work STARTS on approach, which is the
 * mechanism. The saving itself is a stopwatch reading and would be a flaky
 * assertion on a shared runner.
 */
console.log('\n── but reaching for it starts the work the tap would ──');
{
  const { ctx, p, map, errors, asked } = await open();
  const btn = map.getByRole('button', { name: /حرّك الخريطة/ });
  await btn.scrollIntoViewIfNeeded();

  // A real pointer arriving, so the component's own handlers do the work —
  // calling the hook's warm() directly would prove the hook and not the wiring.
  const box = await btn.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(600);

  ok('a pointer on the button fetches Leaflet, before any click',
    leafletish(asked).length > 0, 'nothing was fetched on approach');
  ok('and the map has NOT been mounted by merely being approached',
    (await p.locator('.leaflet-container').count()) === 0);
  // Tiles are plain <img>, a no-CORS request: a preconnect carrying
  // `crossorigin` warms a pool entry the image cannot use. See warmTiles.
  // Read as a list rather than asked of `.first()`: an evaluate on a locator
  // that matches nothing THROWS, and an uncaught throw in a file like this
  // takes the process with it — so one red assertion would silently cancel
  // every section after it. That is the coverage hole CLAUDE.md records under
  // the shouq-flow correction, met here while proving this very test can fail.
  const pre = await p.locator('link[rel="preconnect"]').evaluateAll((els) =>
    els.filter((e) => e.href.includes('tile.')).map((e) => e.crossOrigin)
  );
  ok('the tile host is preconnected now', pre.length === 1, `${pre.length} found`);
  ok('without crossorigin, or the warmed connection is the wrong one',
    pre[0] === null, String(pre[0]));

  // The offer must still work after being warmed — an idempotent warm that
  // left `loading` set would disable the button it was meant to speed up.
  await btn.click();
  await p.locator('.leaflet-container').waitFor({ timeout: 15000 });
  ok('and the tap still opens the map after all that',
    (await map.locator('iframe').count()) === 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── tapping it swaps the frame for a real map ──');
{
  const { ctx, p, map, errors } = await open();
  const before = await map.locator('a[href^="/places/"]').count();

  await map.getByRole('button', { name: /حرّك الخريطة/ }).click();
  await p.locator('.leaflet-container').waitFor({ timeout: 15000 });

  ok('the iframe basemap is gone', (await map.locator('iframe').count()) === 0);
  ok('every pin came across', (await map.locator('a[href^="/places/"]').count()) === before,
    `${before} before`);
  ok('zoom is offered in the site\'s own controls',
    (await map.getByRole('button', { name: 'تكبير الخريطة' }).count()) === 1 &&
    (await map.getByRole('button', { name: 'تصغير الخريطة' }).count()) === 1);
  ok('the credit for the data is on the map itself',
    (await map.getByText(/OpenStreetMap/).count()) > 0);
  // Leaflet's own is English, in a Latin-first corner box, on an RTL page.
  ok('and it is ours, not Leaflet\'s own control',
    (await map.locator('.leaflet-control-attribution').count()) === 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── the pins belong to the ground, not to the frame ──');
{
  const { ctx, p, map, errors } = await open();
  await map.getByRole('button', { name: /حرّك الخريطة/ }).click();
  await p.locator('.leaflet-container').waitFor({ timeout: 15000 });
  await p.waitForTimeout(500);

  const pin = map.locator('a[href^="/places/"]').first();
  const at = async () => {
    const b = await pin.boundingBox();
    return b ? { x: Math.round(b.x), y: Math.round(b.y) } : null;
  };

  const start = await at();
  ok('a pin has a position to begin with', start !== null, JSON.stringify(start));

  // This is the assertion the whole component exists for. The static embed
  // could not be panned because the overlay had its own idea of where the map
  // was looking; moving the view here must move the pins with it.
  //
  // Dragged from the MAP's own centre, read at the moment of the drag. The
  // first version of this used fixed viewport coordinates and moved nothing —
  // /search puts the map well down the page, so (600,450) was over the result
  // list, and the assertion failed for pointing at the wrong element rather
  // than for anything the map did.
  await map.scrollIntoViewIfNeeded();
  await p.waitForTimeout(200);
  const box = await p.locator('.leaflet-container').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await p.mouse.move(cx, cy);
  await p.mouse.down();
  await p.mouse.move(cx - 140, cy, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(500);

  const moved = await at();
  ok('dragging the map carried the pin with it',
    moved !== null && start !== null && Math.abs(moved.x - start.x) > 20,
    `${JSON.stringify(start)} → ${JSON.stringify(moved)}`);

  const beforeZoom = await at();
  await map.getByRole('button', { name: 'تكبير الخريطة' }).click();
  await p.waitForTimeout(600);
  const afterZoom = await at();
  ok('zooming re-projects it too',
    afterZoom !== null && beforeZoom !== null &&
    (Math.abs(afterZoom.x - beforeZoom.x) > 4 || Math.abs(afterZoom.y - beforeZoom.y) > 4),
    `${JSON.stringify(beforeZoom)} → ${JSON.stringify(afterZoom)}`);

  ok('no page errors through all of it', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/**
 * How it follows, not just that it does.
 *
 * The section above passes under both implementations: it drags, waits half a
 * second and asks where the pin ended up, which was true when every frame was
 * a React render of all thirty pins. That cost one second of dragging 3.5
 * SECONDS of long tasks on a 6×-throttled phone — a 33ms median frame against
 * 60fps' 16.7 — and no assertion here could see it. So these two name the
 * mechanism instead of the outcome.
 */
console.log('\n── and it follows on the compositor, not through React ──');
{
  const { ctx, p, map, errors } = await open();
  await map.getByRole('button', { name: /حرّك الخريطة/ }).click();
  await p.locator('.leaflet-container').waitFor({ timeout: 15000 });
  await p.waitForTimeout(500);
  await map.scrollIntoViewIfNeeded();
  await p.waitForTimeout(200);

  // The <span> that carries the position; the link is its child.
  const pin = map.locator('a[href^="/places/"]').first().locator('xpath=..');
  const left = () => pin.evaluate((el) => el.style.left);
  const screenX = () => pin.evaluate((el) => Math.round(el.getBoundingClientRect().x));

  const box = await p.locator('.leaflet-container').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const leftBefore = await left();
  const xBefore = await screenX();

  await p.mouse.move(cx, cy);
  await p.mouse.down();
  await p.mouse.move(cx - 120, cy, { steps: 12 });

  const leftDuring = await left();
  const xDuring = await screenX();

  ok('mid-drag the pin has moved on screen',
    Math.abs(xDuring - xBefore) > 40, `${xBefore} → ${xDuring}`);
  // The whole point: its own `left` is untouched, so no render produced that
  // movement — the overlay rode one transform.
  ok('but its own left is untouched, so no render drew the move',
    leftDuring === leftBefore && leftBefore !== '', `${leftBefore} → ${leftDuring}`);

  // A pause before letting go, so Leaflet's inertia is not still carrying the
  // map when the settled position is read.
  await p.waitForTimeout(250);
  await p.mouse.up();
  await p.waitForTimeout(600);

  /**
   * And the transform is a loan, not a ledger.
   *
   * When the view settles the pins are re-projected for real and the offset is
   * re-based to zero, so the next drag starts from the truth. Without it the
   * transform would accumulate and every position handed to the callout logic
   * — which decides from `at[i].x` which way a callout may open — would be
   * one drag stale, for ever.
   */
  const leftAfter = await left();
  ok('and once it settles the pin carries its new position in its own left',
    leftAfter !== leftBefore, `${leftBefore} → ${leftAfter}`);
  ok('with the pan offset given back, not carried forward',
    (await pin.evaluate((el) => {
      const t = getComputedStyle(el.parentElement).transform;
      return t === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(t);
    })), 'the pin layer still holds a translate after the drag ended');

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── a place page gets the same upgrade ──');
{
  const { ctx, p, map: frame, errors } = await open('/places/kuwait-towers/', '[data-map-frame]');
  ok('it starts static', (await frame.locator('iframe').count()) === 1);

  await frame.getByRole('button', { name: /حرّك الخريطة/ }).click();
  await p.locator('.leaflet-container').waitFor({ timeout: 15000 });
  ok('and moves when asked', (await frame.locator('iframe').count()) === 0);
  // The page is about one place: its own marker is not a link, and it has to
  // survive the swap or the map stops answering the question the page asks.
  ok('the place it is about is still marked',
    (await frame.getByText('أبراج الكويت — هنا').count()) > 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
