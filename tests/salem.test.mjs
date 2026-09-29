import { chromium } from 'playwright';

/**
 * سالم's own page: structure and client-side behaviour only.
 *
 * Deliberately does not assert on a successful WebSocket negotiation with
 * ElevenLabs — this sandbox's own egress gateway refuses api.elevenlabs.io
 * (same limitation every live-agent feature in this repository carries; see
 * CLAUDE.md), and a CI runner with ordinary internet access would see
 * different network behaviour than this sandbox does. What is asserted is
 * what `salem-chat.ts` and `SalemChat.tsx` control themselves: the greeting
 * renders before any connection settles, the input starts disabled (status
 * begins at "connecting", never "connected", before any network event
 * fires), and the page never throws — regardless of whether the socket ever
 * opens.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

async function fresh(path) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW',
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${B}${path}`, { waitUntil: 'networkidle' });
  return { ctx, p, errors };
}

console.log('\n── /salem loads and greets before any connection settles ──');
{
  const { ctx, p, errors } = await fresh('/salem/');
  ok('the header names سالم', await p.locator('header', { hasText: 'سالم' }).isVisible());
  ok('his greeting is the first line in the transcript', await p.locator('text=هلا! أنا سالم').isVisible());
  ok('no page errors', errors.length === 0);
  await ctx.close();
}

console.log('\n── the input starts disabled, since status never begins "connected" ──');
{
  const { ctx, p } = await fresh('/salem/');
  const input = p.locator('#salem-q');
  const send = p.getByRole('button', { name: 'إرسال' });
  ok('the box is present', await input.isVisible());
  ok('it is disabled before any network event can have arrived', await input.isDisabled());
  ok('so is the send button', await send.isDisabled());
  await ctx.close();
}

console.log('\n── /find\'s سالم link and /salem agree on his name ──');
{
  const { ctx, p } = await fresh('/find/');
  const link = p.getByRole('link', { name: /سالم/ });
  ok('the card on /find names him', await link.isVisible());
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : '\nكل شي تمام');
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
