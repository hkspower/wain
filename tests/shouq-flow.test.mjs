import { chromium } from 'playwright';

const B = process.env.WAIN_URL || 'http://localhost:4179';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

/** A page with a scripted speech recogniser and a captured synthesiser. */
async function fresh({ transcript = 'قهوة هادية', error = null, noRecognition = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar-KW' });
  await ctx.addInitScript(({ transcript, error, noRecognition }) => {
    window.__said = []; window.__primed = null; window.__gestureOver = false;
    window.__vibrations = [];
    navigator.vibrate = (p) => { window.__vibrations.push(p); return true; };
    class Utt { constructor(t) { this.text = t; } }
    window.SpeechSynthesisUtterance = Utt;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speak(u) { if (u.text === '') window.__primed = window.__gestureOver ? 'late' : 'in-gesture';
                 else window.__said.push(u.text); setTimeout(() => u.onend?.(), 10); },
      cancel() {}, getVoices() { return [{ lang: 'ar-KW', name: 'stub' }]; } } });
    if (noRecognition) {
      // Chromium ships webkitSpeechRecognition natively, so removing only the
      // unprefixed name leaves the real one in place and the no-support branch
      // is never reached. Firefox and older iOS Safari are the real cases.
      delete window.SpeechRecognition;
      delete window.webkitSpeechRecognition;
      Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined });
      Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined });
    }
    if (!noRecognition) {
      class Rec {
        constructor() { this.onresult = null; this.onerror = null; this.onend = null; window.__rec = this; }
        start() {
          window.__recLang = this.lang; window.__recStarted = true;
          if (error) { setTimeout(() => this.onerror?.({ error }), 200); return; }
          setTimeout(() => this.onresult?.({ results: [[{ transcript }]] }), 200);
          setTimeout(() => { window.__gestureOver = true; this.onend?.(); }, 600);
        }
        stop() { window.__stopped = true; this.onend?.(); }
        abort() { window.__aborted = true; }
      }
      window.SpeechRecognition = Rec;
    }
  }, { transcript, error, noRecognition });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  return { ctx, p, errors };
}
const fab = (p) => p.locator('button[aria-label*="وين AI"]');
const holdFor = async (p, ms, id = 1) => {
  await fab(p).dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, pointerId: id });
  await p.waitForTimeout(ms);
};

console.log('\n── the button is everywhere and correctly described ──');
{
  const { ctx, p } = await fresh();
  for (const path of ['/', '/explore/', '/search/', '/about/', '/privacy/', '/add/', '/places/kuwait-towers/']) {
    await p.goto(B + path, { waitUntil: 'domcontentloaded' });
    if ((await fab(p).count()) !== 1) { ok(`button present on ${path}`, false); break; }
  }
  ok('button present on all seven routes', true);
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  const label = await fab(p).getAttribute('aria-label');
  ok('its label explains the gesture', /٣ ثواني/.test(label), label);
  ok('it reports collapsed state', (await fab(p).getAttribute('aria-expanded')) === 'false');
  ok('it points at the panel it controls', (await fab(p).getAttribute('aria-controls')) === 'wain-ai-panel');
  await ctx.close();
}

console.log('\n── the hold has to be a real hold ──');
{
  const { ctx, p } = await fresh();
  await p.goto(B + '/', { waitUntil: 'networkidle' });

  await holdFor(p, 300);
  await fab(p).dispatchEvent('pointerup', { pointerId: 1 });
  await p.waitForTimeout(250);
  ok('a quick tap opens nothing', (await p.locator('#wain-ai-panel').count()) === 0);
  ok('a quick tap explains the gesture instead', /٣ ثواني/.test(await p.locator('[role=status]').textContent().catch(() => '')));

  await p.waitForTimeout(2400);
  await holdFor(p, 2700, 2);
  await fab(p).dispatchEvent('pointerup', { pointerId: 2 });
  await p.waitForTimeout(400);
  ok('releasing just before three seconds does not start a session', (await p.locator('#wain-ai-panel').count()) === 0);

  await holdFor(p, 1200, 3);
  await fab(p).dispatchEvent('pointercancel', { pointerId: 3 });
  await p.waitForTimeout(2500);
  ok('a cancelled pointer (finger dragged off) does not start a session', (await p.locator('#wain-ai-panel').count()) === 0);
  await ctx.close();
}

console.log('\n── a full hold starts her, and she answers ──');
{
  const { ctx, p, errors } = await fresh({ transcript: 'قهوة هادية' });
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await holdFor(p, 3300);
  ok('audio is unlocked inside the gesture (iOS)', (await p.evaluate(() => window.__primed)) === 'in-gesture');
  ok('the microphone is asked for in Kuwaiti Arabic', (await p.evaluate(() => window.__recLang)) === 'ar-KW');
  ok('the hold buzzes at press and at activation', (await p.evaluate(() => window.__vibrations.length)) >= 2);

  await p.waitForURL('**/search**', { timeout: 9000 });
  ok('what she heard becomes the search', decodeURIComponent(p.url()).includes('قهوة هادية'));
  await p.waitForFunction(() => window.__said.length > 0, null, { timeout: 8000 });
  const said = (await p.evaluate(() => window.__said)).join(' ');
  console.log(`      «${said}»`);
  ok('she repeats what she heard', said.includes('قهوة هادية؟'));
  ok('she recommends with a reason', said.includes('أقترح عليك') && said.includes('حوش السوق'));
  ok('she says when to go', said.includes('أحلى وقت'));
  ok('she offers one alternative', said.includes('وإذا تبي غيره'));
  ok('the results are on screen behind her', (await p.locator('a[href^="/places/"]').count()) > 0);
  ok('the voice toggle is left on', (await p.evaluate(() => localStorage.getItem('wain-voice-enabled'))) === '1');
  ok('no page errors during the whole flow', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── when it goes wrong, she says why ──');
{
  for (const [err, expect, label] of [
    ['not-allowed', 'المايك', 'microphone refused'],
    ['no-speech', 'ما سمعناك', 'nothing heard'],
  ]) {
    const { ctx, p } = await fresh({ error: err });
    await p.goto(B + '/', { waitUntil: 'networkidle' });
    await holdFor(p, 3300);
    await p.waitForSelector('#wain-ai-panel', { timeout: 6000 });
    const t = await p.locator('#wain-ai-panel').textContent();
    ok(`${label}: explained in Arabic`, t.includes(expect), t.slice(0, 90));
    ok(`${label}: offers to try again`, t.includes('جرّب مرة ثانية'));
    ok(`${label}: the message is announced, not just shown`, (await p.locator('#wain-ai-panel [role=alert]').count()) === 1);
    await ctx.close();
  }
  // Heard nothing at all
  const { ctx, p } = await fresh({ transcript: '   ' });
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await holdFor(p, 3300);
  await p.waitForSelector('#wain-ai-panel', { timeout: 6000 });
  ok('an empty transcript does not search for nothing', !p.url().includes('/search'));
  await ctx.close();
}

console.log('\n── a browser with no speech input still gets somewhere ──');
{
  const { ctx, p } = await fresh({ noRecognition: true });
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await holdFor(p, 3300);
  await p.waitForTimeout(1500);
  ok('it falls back to the typed search rather than dead-ending', p.url().includes('/search'));
  await ctx.close();
}

console.log('\n── keyboard and screen-reader users are not asked to hold ──');
{
  const { ctx, p } = await fresh();
  await p.goto(B + '/about/', { waitUntil: 'networkidle' });
  await fab(p).focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector('#wain-ai-panel', { timeout: 6000 });
  ok('Enter opens her immediately, no hold', true);
  ok('the panel is a labelled dialog', (await p.locator('#wain-ai-panel[role=dialog]').count()) === 1);
  ok('the live transcript is announced', (await p.locator('#wain-ai-panel [aria-live]').count()) >= 1);
  ok('the button now reports expanded', (await fab(p).getAttribute('aria-expanded')) === 'true');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok('Escape closes her', (await p.locator('#wain-ai-panel').count()) === 0);
  ok('the recogniser is stopped, not left listening', (await p.evaluate(() => window.__aborted)) === true);
  await ctx.close();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
