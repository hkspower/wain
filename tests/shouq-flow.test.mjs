import { chromium } from 'playwright';

const B = process.env.WAIN_URL || 'http://localhost:4179';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

/** A page with a scripted speech recogniser and a captured synthesiser. */
async function fresh({ transcript = 'قهوة هادية', error = null, noRecognition = false, stayOpen = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar-KW' });
  await ctx.addInitScript(({ transcript, error, noRecognition, stayOpen }) => {
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
        constructor() { this.onstart = null; this.onresult = null; this.onerror = null; this.onend = null; window.__rec = this; }
        start() {
          window.__recLang = this.lang; window.__recStarted = true;
          // The real API fires onstart only once the microphone has been
          // granted, and that is what the component treats as the call
          // connecting. Delayed here so the ringing state is observable
          // rather than skipped over in the same tick.
          setTimeout(() => this.onstart?.(), 120);
          // stayOpen: connect and then just listen. Real engines end
          // recognition on a pause, and that pause is what ends the call — so
          // a test that wants to observe a *connected* call has to be given
          // one that is not about to end on its own, or it races the teardown.
          if (stayOpen) return;
          if (error) { setTimeout(() => this.onerror?.({ error }), 320); return; }
          setTimeout(() => this.onresult?.({ results: [[{ transcript }]] }), 320);
          setTimeout(() => { window.__gestureOver = true; this.onend?.(); }, 720);
        }
        stop() { window.__stopped = true; this.onend?.(); }
        abort() { window.__aborted = true; }
      }
      window.SpeechRecognition = Rec;
    }
  }, { transcript, error, noRecognition, stayOpen });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  return { ctx, p, errors };
}
const fab = (p) => p.locator('button[aria-label*="وين AI"]');
/** One tap places the call. */
const call = async (p) => {
  await fab(p).click();
  await p.waitForSelector('#wain-ai-panel', { timeout: 6000 });
};
const sheet = (p) => p.locator('#wain-ai-panel');

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
  ok('its label says it places a call', /تكلّم شوق/.test(label), label);
  ok('and no longer asks for a three-second hold', !/ثواني/.test(label), label);
  ok('it reports collapsed state', (await fab(p).getAttribute('aria-expanded')) === 'false');
  ok('it points at the panel it controls', (await fab(p).getAttribute('aria-controls')) === 'wain-ai-panel');
  await ctx.close();
}

console.log('\n── one tap places the call ──');
{
  const { ctx, p } = await fresh();
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await fab(p).click();
  // The sheet has to be up immediately: the whole point of replacing the hold
  // is that the tap does something you can see at once.
  await p.waitForSelector('#wain-ai-panel', { timeout: 1500 });
  ok('the call sheet opens on the first tap', true);
  ok('it is a labelled dialog', (await p.locator('#wain-ai-panel[role=dialog]').count()) === 1);
  const label = await sheet(p).getAttribute('aria-label');
  ok('announced as the call centre', /مركز اتصال وين/.test(label), label);
  ok('it starts out ringing', (await sheet(p).textContent()).includes('يرن'));
  ok('and says what to ask her while it rings', (await sheet(p).textContent()).includes('قول لي وش تبي'));
  ok('the button reports expanded', (await fab(p).getAttribute('aria-expanded')) === 'true');
  await ctx.close();
}

console.log('\n── ringing becomes connected, with a running timer ──');
{
  const { ctx, p } = await fresh({ stayOpen: true });
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await call(p);
  await p.waitForFunction(
    () => document.querySelector('#wain-ai-panel')?.textContent.includes('متصل'),
    null, { timeout: 6000 }
  );
  const t = await sheet(p).textContent();
  ok('the status says connected', t.includes('متصل'));
  ok('with a call timer in Arabic-Indic digits', /[٠-٩]{2}:[٠-٩]{2}/.test(t), t.slice(0, 120));
  ok('and a hang-up button', t.includes('إنهاء المكالمة'));
  // A timer that renders ٠٠:٠٠ and never moves would pass the shape check
  // above while telling the caller nothing.
  await p.waitForTimeout(1400);
  ok('and the timer actually counts', /٠٠:٠[١٢]/.test(await sheet(p).textContent()),
    (await sheet(p).textContent()).slice(0, 120));
  await ctx.close();
}

console.log('\n── hanging up ends the call and reports how long it ran ──');
{
  const { ctx, p } = await fresh({ stayOpen: true });
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await call(p);
  await p.waitForFunction(
    () => document.querySelector('#wain-ai-panel')?.textContent.includes('متصل'),
    null, { timeout: 6000 }
  );
  await p.locator('#wain-ai-panel button', { hasText: 'إنهاء المكالمة' }).click();
  await p.waitForTimeout(200);
  const t = await sheet(p).textContent();
  ok('the call is reported ended', t.includes('انتهت المكالمة'));
  ok('the duration is still shown', /[٠-٩]{2}:[٠-٩]{2}/.test(t), t.slice(0, 120));
  ok('the recogniser is released, not left listening', (await p.evaluate(() => window.__aborted)) === true);
  ok('and she can be called again', t.includes('اتصل مرة ثانية'));
  await ctx.close();
}

console.log('\n── the call connects her, and she answers ──');
{
  const { ctx, p, errors } = await fresh({ transcript: 'قهوة هادية' });
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await call(p);
  ok('audio is unlocked inside the gesture (iOS)', (await p.evaluate(() => window.__primed)) === 'in-gesture');
  ok('the microphone is asked for in Kuwaiti Arabic', (await p.evaluate(() => window.__recLang)) === 'ar-KW');
  // Two buzzes, and the second only exists once she is on the line — so this
  // has to wait for that, or it counts the dial and calls it a connection.
  await p.waitForFunction(() => window.__vibrations.length >= 2, null, { timeout: 6000 }).catch(() => {});
  ok('the tap buzzes, and again when she picks up', (await p.evaluate(() => window.__vibrations.length)) >= 2);

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
    await call(p);
    // The failure arrives after the microphone prompt is answered, so the
    // sheet is still ringing when call() returns. Waiting for the alert is
    // the difference between testing the error and testing the ring.
    await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 });
    const t = await p.locator('#wain-ai-panel').textContent();
    ok(`${label}: explained in Arabic`, t.includes(expect), t.slice(0, 90));
    ok(`${label}: offers to call again`, t.includes('اتصل مرة ثانية'));
    ok(`${label}: the message is announced, not just shown`, (await p.locator('#wain-ai-panel [role=alert]').count()) === 1);
    await ctx.close();
  }
  // Heard nothing at all
  const { ctx, p } = await fresh({ transcript: '   ' });
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await call(p);
  await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 });
  ok('an empty transcript does not search for nothing', !p.url().includes('/search'));
  await ctx.close();
}

console.log('\n── a browser with no speech input still gets somewhere ──');
{
  const { ctx, p } = await fresh({ noRecognition: true });
  await p.goto(B + '/', { waitUntil: 'networkidle' });
  await fab(p).click();
  await p.waitForTimeout(1500);
  ok('it falls back to the typed search rather than dead-ending', p.url().includes('/search'));
  await ctx.close();
}

console.log('\n── keyboard and screen-reader users place the same call ──');
{
  const { ctx, p } = await fresh();
  await p.goto(B + '/about/', { waitUntil: 'networkidle' });
  await fab(p).focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector('#wain-ai-panel', { timeout: 6000 });
  ok('Enter places the call, same as a tap', true);
  ok('the panel is a labelled dialog', (await p.locator('#wain-ai-panel[role=dialog]').count()) === 1);
  ok('the live transcript is announced', (await p.locator('#wain-ai-panel [aria-live]').count()) >= 1);
  ok('the button now reports expanded', (await fab(p).getAttribute('aria-expanded')) === 'true');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  // One Escape, all the way out. A dialog that hangs up but stays on screen
  // is a dialog Escape did not close, which is the thing Escape is for.
  ok('Escape hangs up and closes in one press', (await p.locator('#wain-ai-panel').count()) === 0);
  ok('the recogniser is stopped, not left listening', (await p.evaluate(() => window.__aborted)) === true);
  await ctx.close();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
