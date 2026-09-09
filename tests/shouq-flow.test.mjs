import { chromium } from 'playwright';

const B = process.env.WAIN_URL || 'http://localhost:4179';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

/**
 * A page with a scripted speech recogniser and a captured synthesiser.
 *
 * `abortReportMs` is the interesting knob. A real engine does not go quiet when
 * you abort() it — it reports the abort back through the very handlers the call
 * is still wired to, one or two ticks later. The stub used to fire nothing at
 * all from abort(), which is precisely why every teardown defect in this
 * component was invisible to this suite: hanging up looked clean because the
 * hang-up had nothing to come back from.
 *
 * `neverStarts` is the microphone prompt nobody answers: start() accepted, and
 * then silence for ever. No handler fires, so nothing but a timeout can end it.
 */
async function fresh({ transcript = 'قهوة هادية', error = null, noRecognition = false, stayOpen = false, abortReportMs = 30, neverStarts = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar-KW' });
  await ctx.addInitScript(({ transcript, error, noRecognition, stayOpen, abortReportMs, neverStarts }) => {
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
          // A microphone prompt left sitting on screen: accepted, then nothing.
          if (neverStarts) return;
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
        abort() {
          window.__aborted = true;
          // What Chrome actually does: onerror('aborted'), then onend, both
          // asynchronously, on the handlers the aborted call installed.
          setTimeout(() => { this.onerror?.({ error: 'aborted' }); this.onend?.(); }, abortReportMs);
        }
      }
      window.SpeechRecognition = Rec;
    }
  }, { transcript, error, noRecognition, stayOpen, abortReportMs, neverStarts });
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
const onCall = (p) =>
  p.waitForFunction(
    () => document.querySelector('#wain-ai-panel')?.textContent.includes('متصل'),
    null, { timeout: 6000 }
  );
const hangUp = (p) => p.locator('#wain-ai-panel button', { hasText: 'إنهاء المكالمة' }).click();
const callAgain = (p) => p.locator('#wain-ai-panel button', { hasText: 'اتصل مرة ثانية' }).click();

console.log('\n── the button is on the page her answers land on, and nowhere else ──');
{
  /**
   * She used to be in the root layout, so this asked for her on all seven
   * routes. She is on /search now, mounted by SearchClient, because that is
   * where every call already ended: dictation pushes /search?q=…, show_places
   * pushes /search?q=… and then reports what that page found, and a browser
   * with no speech recognition is sent to /search to type instead. On the
   * privacy policy the launcher's only power was to navigate away from the
   * privacy policy.
   *
   * Visibility, not presence. The component stays mounted above the router so
   * that a call survives `open_place` navigating to a place page — the widget
   * element is created inside WainAiCall, so a call the search page owned
   * would be torn down by its own tool. What moves is the offer: the button
   * hides itself off /search, and `isVisible()` is the only assertion that can
   * tell that from «somebody put it back in the layout».
   */
  const { ctx, p } = await fresh();
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
  ok('she is offered on the search page', await fab(p).isVisible());

  const elsewhere = [];
  for (const path of ['/', '/explore/', '/about/', '/privacy/', '/add/', '/places/kuwait-towers/']) {
    await p.goto(B + path, { waitUntil: 'networkidle' });
    if (await fab(p).isVisible()) elsewhere.push(path);
  }
  ok('and offered on none of the other six routes', elsewhere.length === 0, elsewhere.join(', '));

  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
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
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
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
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
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
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
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

console.log('\n── the sheet sits where it can be read and dismissed ──');
{
  /**
   * This used to measure the sheet against the floating launcher: it was
   * anchored above the button, so moving one without the other buried it —
   * 52 of the button's 60 pixels went under the sheet, and with them the ring
   * pulse that existed precisely to show a live call from behind it.
   *
   * There is no floating launcher any more. شوق is a button inside the query
   * box, in normal flow near the top of the page, and the sheet is a fixed
   * panel over it — covering it is correct now, not a bug. What is still
   * worth measuring is the sheet itself: fully on screen, and clear of the
   * tab bar that appears when the site is installed. Both modes, because the
   * two layouts are written twice in globals.css — once as a media query,
   * once as an attribute for iOS — and the comment there says the two lists
   * must stay identical.
   */
  const { ctx, p } = await fresh({ stayOpen: true });
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
  for (const installed of [false, true]) {
    if (installed) {
      await p.evaluate(() => document.documentElement.setAttribute('data-standalone', 'true'));
      await p.waitForTimeout(120);
    }
    if (!(await sheet(p).count())) await call(p);
    const box = await p.evaluate(() => {
      const e = document.querySelector('#wain-ai-panel');
      const b = e.getBoundingClientRect();
      // In a browser the tab bar is display:none, and a hidden element still
      // has a rect — an all-zero one. Reading .top off it says the tab bar is
      // at the top of the screen, which failed this check against a layout
      // that was correct. Absent means zero-sized, not missing from the DOM.
      const tab = document.querySelector('.app-chrome.fixed.bottom-0');
      const tb = tab?.getBoundingClientRect();
      return { panel: { top: b.top, bottom: b.bottom },
               tabTop: tb && tb.height > 0 ? tb.top : Infinity, vh: innerHeight };
    });
    const where = installed ? 'installed' : 'in a browser';
    ok(`${where}: the sheet is fully on screen`, box.panel.top >= 0,
      `panel top ${Math.round(box.panel.top)}`);
    ok(`${where}: and clears the tab bar`, box.panel.bottom <= box.tabTop,
      `panel bottom ${Math.round(box.panel.bottom)} vs tab bar top ${Math.round(box.tabTop)}`);
  }
  await ctx.close();
}

console.log('\n── the hang-up does not come back as a failure ──');
{
  // The red button abort()s the engine, and the engine answers that abort a
  // moment later through the same handlers. Nothing in this component may act
  // on a dead call's report: it used to, and «ما سمعناك» replaced the ended
  // call and its duration a fraction of a second after the caller hung up —
  // a hang-up presented to them as something having gone wrong.
  const { ctx, p, errors } = await fresh({ stayOpen: true });
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
  await call(p);
  await onCall(p);
  await hangUp(p);
  await p.waitForTimeout(400); // well past the engine's abort report
  const t = await sheet(p).textContent();
  ok('the ended call stays ended', t.includes('انتهت المكالمة'), t.slice(0, 140));
  ok('no error is invented from the abort', !t.includes('ما سمعناك') && !t.includes('ما قدرنا'), t.slice(0, 140));
  ok('and no page error', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── hanging up and calling straight back ──');
{
  // The same report, arriving late enough to land on the *next* call. This is
  // the worse half of the same defect: the dying call cleared the live call's
  // recogniser handle, so the new call no longer recognised its own onstart
  // and rang until the caller gave up on it.
  const { ctx, p, errors } = await fresh({ stayOpen: true, abortReportMs: 700 });
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
  await call(p);
  await onCall(p);
  await hangUp(p);
  await callAgain(p);
  await onCall(p).catch(() => {});
  await p.waitForTimeout(900); // let the first call's abort report land
  const t = await sheet(p).textContent();
  ok('the second call connects', t.includes('متصل'), t.slice(0, 140));
  ok('the first call cannot end it', !t.includes('انتهت المكالمة') && !t.includes('ما سمعناك'), t.slice(0, 140));
  ok('its timer is running', /[٠-٩]{2}:[٠-٩]{2}/.test(t), t.slice(0, 140));
  ok('and no page error', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── a call that never connects gives up on its own ──');
{
  // No handler ever fires, so only a timeout can end this. Before there was
  // one, the ring-back repeated every four seconds for as long as the sheet
  // was open — the caller's only way out was the button they were waiting on.
  const { ctx, p } = await fresh({ neverStarts: true });
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
  await call(p);
  // Patient first, and only then impatient: a dial timeout that fires early is
  // worse than none, because it hangs up on the caller mid-permission-prompt.
  await p.waitForTimeout(10_000);
  ok('it is still ringing after ten seconds', (await sheet(p).textContent()).includes('يرن'));
  await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 25_000 });
  const t = await sheet(p).textContent();
  ok('it stops ringing and says so', !t.includes('يرن') && t.includes('طوّلنا نرن'), t.slice(0, 140));
  ok('and offers the call again', t.includes('اتصل مرة ثانية'));
  await ctx.close();
}

console.log('\n── the reason given matches the reason ──');
{
  // Every code but not-allowed used to be reported as «ما سمعناك». A vendor
  // speech service that is unreachable is not silence on the caller's end, and
  // telling them it is sends them back to speak louder into the same failure.
  for (const [err, expect, label] of [
    ['network', 'ما قدرنا نوصلك', 'the speech service is unreachable'],
    ['audio-capture', 'ما قدرنا نوصلك', 'there is no usable microphone'],
    // Not just «المايك» — that word is in the footer of every call sheet, so
    // matching it would pass on any message at all. The sentence, or nothing.
    ['service-not-allowed', 'المايك مسموح للموقع', 'the microphone is blocked by policy'],
  ]) {
    const { ctx, p } = await fresh({ error: err });
    await p.goto(B + '/search/', { waitUntil: 'networkidle' });
    await call(p);
    await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 });
    const t = await sheet(p).textContent();
    ok(`${label}: said as itself`, t.includes(expect), `${err} → ${t.slice(0, 110)}`);
    ok(`${label}: not reported as silence`, expect === 'ما سمعناك' || !t.includes('ما سمعناك'), t.slice(0, 110));
    await ctx.close();
  }
}

console.log('\n── the call connects her, and she answers ──');
{
  const { ctx, p, errors } = await fresh({ transcript: 'قهوة هادية' });
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
  await call(p);
  ok('audio is unlocked inside the gesture (iOS)', (await p.evaluate(() => window.__primed)) === 'in-gesture');
  ok('the microphone is asked for in Kuwaiti Arabic', (await p.evaluate(() => window.__recLang)) === 'ar-KW');
  // Two buzzes, and the second only exists once she is on the line — so this
  // has to wait for that, or it counts the dial and calls it a connection.
  await p.waitForFunction(() => window.__vibrations.length >= 2, null, { timeout: 6000 }).catch(() => {});
  ok('the tap buzzes, and again when she picks up', (await p.evaluate(() => window.__vibrations.length)) >= 2);

  // Waiting for «/search» is no longer waiting for anything — the call was
  // placed FROM /search. The query is the event now, so wait for that.
  await p.waitForURL((u) => decodeURIComponent(u.href).includes('قهوة هادية'), { timeout: 9000 });
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
    await p.goto(B + '/search/', { waitUntil: 'networkidle' });
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
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
  await call(p);
  await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 });
  // «Did it stay off /search» used to be the evidence. The call is placed
  // from /search now, so the query is: nothing heard, nothing searched for.
  ok('an empty transcript does not search for nothing', !p.url().includes('q='), p.url());
  await ctx.close();
}

console.log('\n── a browser with no speech input still gets somewhere ──');
{
  /**
   * «Did it land on /search» used to be the whole assertion, and from /search
   * it is true before the tap — a test that passes for the wrong reason is
   * worse than one that fails. What still distinguishes the fallback is that
   * she SAYS why instead of going quiet: the panel raises an alert naming the
   * missing speech support, and the typed box is right there behind it.
   */
  const { ctx, p } = await fresh({ noRecognition: true });
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
  await fab(p).click();
  await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 });
  const why = await p.locator('#wain-ai-panel [role=alert]').first().textContent();
  ok('it says the browser has no microphone input rather than dead-ending',
    /متصفح|صوت|ما يدعم/.test(why || ''), why);
  ok('and the typed box it points at is on the page',
    (await p.locator('input[aria-label*="بحث"], input[type="search"]').count()) > 0);
  await ctx.close();
}

console.log('\n── keyboard and screen-reader users place the same call ──');
{
  const { ctx, p } = await fresh();
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
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

console.log('\n── شوق has a face, and it is alive ──');
{
  // She was five vertical bars — a picture of audio, on a button whose own
  // label says «اضغط عشان تكلّم شوق». The mark is a smiling face now, and
  // these hold the two things that make a face read as a person rather than
  // a sticker: she blinks while she waits, and her mouth only moves once
  // somebody has actually picked up.
  const { ctx, p } = await fresh({ stayOpen: true });
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });

  const faces = () => p.locator('.shouq');
  ok('the launcher shows her face, not a handset', (await faces().count()) === 1);
  ok('and the face is built from the icon set, not drawn in place',
    (await p.locator('.shouq [data-part="eyes"]').count()) === 1 &&
    (await p.locator('.shouq [data-part="mouth"]').count()) === 1);

  const eyeAnim = await p.evaluate(() => {
    const e = document.querySelector('.shouq [data-part="eyes"]');
    const s = getComputedStyle(e);
    return { name: s.animationName, box: s.transformBox };
  });
  ok('she blinks while she is just sitting there', eyeAnim.name === 'shouq-blink', eyeAnim.name);
  // Without fill-box an SVG transform-origin resolves against the whole
  // 24-unit viewBox, so «scaleY about center» slides the eyes down her face
  // instead of closing them. The blink looks broken in a way no assertion on
  // the animation NAME would ever catch.
  ok('and the blink is anchored to the eyes, not the viewBox', eyeAnim.box === 'fill-box', eyeAnim.box);

  const mouthIdle = await p.evaluate(() =>
    getComputedStyle(document.querySelector('.shouq [data-part="mouth"]')).animationName);
  ok('her mouth is still while nobody is on the line', mouthIdle === 'none', mouthIdle);

  await call(p);
  await p.waitForFunction(
    () => document.querySelector('#wain-ai-panel')?.textContent.includes('متصل'),
    null, { timeout: 6000 }
  );
  const live = await p.evaluate(() => {
    const all = [...document.querySelectorAll('.shouq')];
    return {
      n: all.length,
      talking: all.filter((f) => f.classList.contains('shouq--talking')).length,
      mouth: getComputedStyle(all[0].querySelector('[data-part="mouth"]')).animationName,
    };
  });
  ok('once she is connected, every face starts speaking', live.n > 1 && live.talking === live.n,
    `${live.talking}/${live.n}`);
  ok('and the mouth animation is actually running', live.mouth === 'shouq-speak', live.mouth);

  await p.locator('#wain-ai-panel button', { hasText: 'إنهاء المكالمة' }).click();
  await p.waitForTimeout(250);
  const after = await p.evaluate(() =>
    [...document.querySelectorAll('.shouq')].filter((f) => f.classList.contains('shouq--talking')).length);
  ok('hanging up stops her talking', after === 0, `${after} still talking`);
  await ctx.close();
}

console.log('\n── a call that fails says so, in the hand and in the ear ──');
{
  /**
   * Hanging up deliberately buzzes and plays the tone that says the line is
   * down. Six different failures did neither — the ring-back just stopped and
   * some text appeared. After ringing, silence is the one thing that means
   * «keep waiting», so the interface was saying the opposite of what had
   * happened, exactly when the visitor most needs telling.
   *
   * The microphone being refused is the failure a real visitor hits most.
   */
  const { ctx, p } = await fresh({ error: 'not-allowed' });
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
  await call(p);
  await p.waitForFunction(
    () => document.querySelector('#wain-ai-panel')?.textContent.includes('المايك'),
    null, { timeout: 8000 }
  );
  ok('the refusal is explained on screen',
    (await sheet(p).textContent()).includes('المايك'));

  /**
   * Assert the pattern, not a count.
   *
   * The first version of this read the vibration count before and after the
   * failure and expected it to grow. It reported 4 → 4 and looked like the
   * haptic was missing — but the microphone is refused 320ms in, and the
   * round trip to read the "before" count is slower than that, so the buzz
   * had already happened. The measurement was late, not absent.
   *
   * The log itself is unambiguous. `tap` is the scalar 8; `success` and
   * `error` are three-pulse arrays, and they differ from each other — so a
   * failure that buzzed like a tap, or like a success, is visible here.
   */
  const buzz = await p.evaluate(() => window.__vibrations);
  const last = buzz.at(-1);
  console.log(`      vibrations: ${JSON.stringify(buzz)}`);
  ok('the failure buzzes rather than going quiet', Array.isArray(last), JSON.stringify(last));
  ok('with a pattern of its own, not the tap and not success',
    Array.isArray(last) && last.length === 3 && JSON.stringify(last) !== JSON.stringify([12, 45, 22]),
    JSON.stringify(last));
  await ctx.close();
}

console.log('\n── the call is not paid for until it is placed ──');
{
  /**
   * WainAi is in the root layout, so whatever it imports, every page imports.
   * It used to import the whole call — ring-back tones, the speech-recognition
   * plumbing, the widget bridge, six phases of sheet markup — and that measured
   * 6.3K gzipped on every page in the site, including the privacy policy.
   *
   * Read the JavaScript, not the rendered HTML. The privacy page does not paint
   * a call sheet either way, so asking its innerHTML would pass for a reason
   * that has nothing to do with the claim. The sheet's strings travel in a
   * chunk; that is where they have to be looked for.
   */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-KW' });
  const p = await ctx.newPage();
  await p.goto(B + '/privacy/', { waitUntil: 'networkidle' });

  /**
   * The marker has to be something only the call has.
   *
   * The first version of this looked for «مركز اتصال وين» and «إنهاء
   * المكالمة» and failed — correctly. Those live in WAIN_AI_COPY, and the
   * launcher imports that object for its own label, so the whole copy table
   * ships on every page whatever happens to the sheet. The assertion would
   * have been measuring the wrong file.
   *
   * `webkitSpeechRecognition` is in WainAiCall and nowhere else: no launcher,
   * no copy table, no shared library.
   */
  const early = await p.evaluate(async () => {
    const srcs = [...document.querySelectorAll('script[src]')].map((s) => s.src);
    const bodies = await Promise.all(srcs.map((u) => fetch(u).then((r) => r.text()).catch(() => '')));
    return ['webkitSpeechRecognition', 'elevenlabs-convai']
      .filter((s) => bodies.some((b) => b.includes(s)));
  });
  ok('the privacy page does not ship the call machinery', early.length === 0, early.join(' | '));

  /**
   * And it does not offer the call either any more.
   *
   * The claim used to be «the button is there, the call it opens is not». The
   * button is still mounted — it has to be, so a call outlives `open_place` —
   * but it is hidden here, so the privacy policy no longer invites anybody
   * into a feature whose only move from this page was to leave it.
   */
  ok('nor offers the call from here',
    !(await p.locator('button[aria-label*="وين AI"]').first().isVisible()));

  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
  const btn = p.locator('button[aria-label*="وين AI"]').first();
  ok('the launcher is on the search page', (await btn.count()) > 0);
  ok('and still carries its accessible name',
    ((await btn.getAttribute('aria-label')) || '').includes('شوق'));

  // Read again HERE: /search legitimately ships the search index, so the
  // question is whether it ships the CALL before anybody places one.
  const beforeTap = await p.evaluate(async () => {
    const srcs = [...document.querySelectorAll('script[src]')].map((s) => s.src);
    const bodies = await Promise.all(srcs.map((u) => fetch(u).then((r) => r.text()).catch(() => '')));
    return ['webkitSpeechRecognition', 'elevenlabs-convai']
      .filter((s) => bodies.some((b) => b.includes(s)));
  });
  ok('the search page does not ship it before the tap either',
    beforeTap.length === 0, beforeTap.join(' | '));

  /**
   * Watch the responses, not the DOM.
   *
   * The obvious follow-up — re-read `script[src]` after the tap and look for
   * the marker — fails for a reason worth writing down: webpack removes the
   * script element once the chunk has executed, so by the time the panel is up
   * there is nothing left in the DOM to find. The fetch itself is the evidence.
   */
  const fetched = [];
  p.on('response', (r) => { if (/\.js(\?|$)/.test(r.url())) fetched.push(r.url()); });

  await btn.click();
  await p.locator('#wain-ai-panel').waitFor({ state: 'visible', timeout: 15000 });
  ok('and tapping it opens the call it did not ship',
    await p.locator('#wain-ai-panel').isVisible());

  const late = await p.evaluate(async (urls) => {
    const bodies = await Promise.all(urls.map((u) => fetch(u).then((r) => r.text()).catch(() => '')));
    return bodies.some((b) => b.includes('webkitSpeechRecognition'));
  }, fetched);
  ok(`the tap fetched the call machinery (${fetched.length} chunk(s))`, late, fetched.join(', '));
  await ctx.close();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
