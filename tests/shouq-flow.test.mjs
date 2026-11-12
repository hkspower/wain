import { chromium } from 'playwright';

const B = process.env.WAIN_URL || 'http://localhost:4179';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
import { makeCheck, makeSection } from './harness/check.mjs';
const { ok, fails, counts } = makeCheck();
// Every part of this file runs inside one: a step that throws is a red in
// its own part, and the parts after it still run (harness/check.mjs).
const section = makeSection(ok);

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
 *
 * `heardNeverEnds` hears the question and then never decides the caller has
 * finished: only the call's own fifteen-second cap can end it.
 */
async function fresh({ transcript = 'قهوة هادية', error = null, errorFirst = false, hidden = false, noRecognition = false, stayOpen = false, heardNeverEnds = false, abortReportMs = 30, neverStarts = false, vendor = null, userAgent = null, at = null, viewport = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar-KW', ...(userAgent ? { userAgent } : {}) });
  await ctx.addInitScript(({ transcript, error, errorFirst, hidden, noRecognition, stayOpen, heardNeverEnds, abortReportMs, neverStarts, vendor }) => {
    window.__said = []; window.__primed = null; window.__gestureOver = false;
    // A page the phone has put away: the engine's error can arrive while
    // nothing on the screen is being looked at (the in-app browser case).
    if (hidden) Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    // Every focus() asked of a text field, whether or not it could take it.
    window.__inputFocus = 0;
    const inputFocus = HTMLInputElement.prototype.focus;
    HTMLInputElement.prototype.focus = function (...a) { window.__inputFocus++; return inputFocus.apply(this, a); };
    if (vendor) Object.defineProperty(navigator, 'vendor', { configurable: true, get: () => vendor });
    // Where the shared AudioContext was born: inside the tap, or after it.
    // Created outside a gesture, an iPhone keeps it suspended and the
    // ring-back plays to nobody.
    const AC = window.AudioContext;
    if (AC) window.AudioContext = class extends AC {
      // Kept, too: the ring-back's check suspends it, as Safari parks it.
      constructor(...a) { super(...a); window.__acEvent = window.event ? window.event.type : null; window.__ac = this; }
    };
    window.__vibrations = [];
    navigator.vibrate = (p) => { window.__vibrations.push(p); return true; };
    class Utt { constructor(t) { this.text = t; } }
    window.SpeechSynthesisUtterance = Utt;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speak(u) { if (u.text === '') window.__primed = window.__gestureOver ? 'late' : 'in-gesture';
                 else window.__said.push(u.text); setTimeout(() => u.onend?.(), 10); },
      cancel() { window.__cancels = (window.__cancels || 0) + 1; }, getVoices() { return [{ lang: 'ar-KW', name: 'stub' }]; } } });
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
          // WebKit's rule, which Chromium does not have: recognition starts
          // only from inside a user gesture, and is refused otherwise. The
          // call used to start it a lazy chunk and an effect after the tap —
          // fine in Chrome, «ما وصلنا صوتك» on every iPhone (3 October).
          const ev = window.event;
          window.__startInGesture = Boolean(ev && ev.isTrusted && /^(click|pointerup|mouseup|touchend|keydown|keyup)$/.test(ev.type));
          if (!window.__startInGesture) {
            setTimeout(() => { this.onerror?.({ error: 'not-allowed' }); this.onend?.(); }, 60);
            return;
          }
          // A microphone prompt left sitting on screen: accepted, then nothing.
          if (neverStarts) return;
          // The engine refused before it ever listened: no onstart, so the
          // microphone was never there (the case «ما لقينا مايك» is for).
          if (errorFirst) { setTimeout(() => this.onerror?.({ error }), 60); return; }
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
          if (heardNeverEnds) {
            setTimeout(() => this.onresult?.({ results: [[{ transcript: window.__nextTranscript ?? transcript }]] }), 400);
            return;
          }
          if (error) { setTimeout(() => this.onerror?.({ error }), 320); return; }
          // A later call in the same page can be given other words — the
          // follow-up sections ask a second question through the bar.
          const heard = window.__nextTranscript ?? transcript;
          setTimeout(() => this.onresult?.({ results: [[{ transcript: heard }]] }), 320);
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
  }, { transcript, error, errorFirst, hidden, noRecognition, stayOpen, heardNeverEnds, abortReportMs, neverStarts, vendor });
  const p = await ctx.newPage();
  // Her answer reads Kuwait's month and hour (3 October); a section asserting
  // on what she says pins them, or the season would move it.
  if (at) await p.clock.setFixedTime(at);
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  // A wait that times out is a failed step, not the end of the file. They used
  // to throw, and one throw took every section after it down with it — met
  // again on 3 October while proving the WebKit gesture rule could go red:
  // two reds, then a crash, and thirty assertions that never ran.
  for (const m of ['waitForFunction', 'waitForSelector']) {
    const orig = p[m].bind(p);
    p[m] = (...a) => orig(...a).catch(() => {
      console.log(`      (gave up waiting: ${m})`);
      return null;
    });
  }
  return { ctx, p, errors };
}
const fab = (p) => p.locator('button[aria-label*="وين AI"]');
/**
 * One tap places the call — from /find, the one call button on the site since
 * 1 October. The tap also carries the caller on to /search, where her answers
 * land, so a dial is: open /find, tap, wait for /search. Soft, so a tap that
 * never navigates is a red assertion further down, not a crash here.
 */
const onSearch = (u) => new URL(u).pathname.startsWith('/search');
const dial = async (p) => {
  await p.goto(B + '/find/', { waitUntil: 'networkidle' });
  await fab(p).click();
  return p.waitForURL(onSearch, { timeout: 6000 }).then(() => true, () => false);
};
const call = async (p) => {
  await dial(p);
  await p.waitForSelector('#wain-ai-panel', { timeout: 6000 });
};
/**
 * The button's own aria-expanded, recorded as it changes. The tap navigates
 * away and the button unmounts a moment later, so «read it after the tap» no
 * longer reads anything; what it said before it went is the evidence.
 */
const watchExpanded = (p) => p.evaluate(() => {
  window.__expanded = [];
  const b = document.querySelector('button[aria-label*="وين AI"]');
  new MutationObserver(() => window.__expanded.push(b.getAttribute('aria-expanded')))
    .observe(b, { attributes: true, attributeFilter: ['aria-expanded'] });
});
const sheet = (p) => p.locator('#wain-ai-panel');
const onCall = (p) =>
  p.waitForFunction(
    () => document.querySelector('#wain-ai-panel')?.textContent.includes('متصل'),
    null, { timeout: 6000 }
  );
// Soft for the same reason as the waits in fresh(): a button that is not
// there is a red further down, not a crash here.
const hangUp = (p) => p.locator('#wain-ai-panel button', { hasText: 'إنهاء المكالمة' }).click({ timeout: 5000 }).catch(() => {});
const callAgain = (p) => p.locator('#wain-ai-panel button', { hasText: 'اتصل مرة ثانية' }).click({ timeout: 5000 }).catch(() => {});

await section('the button is on /find, and nowhere else', async () => {
  /**
   * She used to be in the root layout, then in the /search query box, then in
   * the box AND the search dead end AND /find. Since 1 October she is on /find
   * alone, on request: one way to call her. /search names the call as a link
   * to /find rather than drawing a second button.
   *
   * Visibility, not presence. The call itself stays mounted above the router
   * so it survives the push to /search and `open_place` — the widget element is
   * created inside WainAiCall — and `isVisible()` is the assertion that cannot
   * be fooled by a hidden copy somebody put back in the layout.
   */
  const { ctx, p } = await fresh();
  await p.goto(B + '/find/', { waitUntil: 'networkidle' });
  ok('she is offered on /find', await fab(p).isVisible());

  const elsewhere = [];
  for (const path of ['/', '/search/', '/explore/', '/about/', '/privacy/', '/add/', '/places/kuwait-towers/']) {
    await p.goto(B + path, { waitUntil: 'networkidle' });
    if (await fab(p).first().isVisible()) elsewhere.push(path);
  }
  ok('and offered on none of the other seven routes, /search included', elsewhere.length === 0, elsewhere.join(', '));

  await p.goto(B + '/find/', { waitUntil: 'networkidle' });
  const label = await fab(p).getAttribute('aria-label');
  ok('its label says it places a call', /تكلّم شوق/.test(label), label);
  ok('and no longer asks for a three-second hold', !/ثواني/.test(label), label);
  ok('it reports collapsed state', (await fab(p).getAttribute('aria-expanded')) === 'false');
  ok('it points at the panel it controls', (await fab(p).getAttribute('aria-controls')) === 'wain-ai-panel');
  await ctx.close();
});

await section('one tap places the call', async () => {
  const { ctx, p } = await fresh();
  await p.goto(B + '/find/', { waitUntil: 'networkidle' });
  await watchExpanded(p);
  await fab(p).click();
  // The sheet has to be up immediately: the whole point of replacing the hold
  // is that the tap does something you can see at once.
  // The wait's own answer: it gives up with null (fresh), so a sheet that
  // never opened printed ✓ here when this was `ok(…, true)`.
  const opened = await p.waitForSelector('#wain-ai-panel', { timeout: 1500 });
  ok('the call sheet opens on the first tap', !!opened);
  ok('it is a labelled dialog', (await p.locator('#wain-ai-panel[role=dialog]').count()) === 1);
  const label = await sheet(p).getAttribute('aria-label');
  ok('announced as the call centre', /مركز اتصال وين/.test(label), label);
  ok('it starts out ringing', (await sheet(p).textContent()).includes('يرن'));
  ok('and says what to ask her while it rings', (await sheet(p).textContent()).includes('قول لي وش تبي'));
  // The dialog takes focus: the button it was opened from leaves with /find a
  // moment later, so focus used to fall to the body under an aria-modal
  // dialog and a screen reader went on reading the page the sheet covered.
  await p.waitForFunction(() => document.querySelector('#wain-ai-panel')?.contains(document.activeElement), null, { timeout: 2000 });
  ok('and the dialog takes focus', await p.evaluate(() => document.querySelector('#wain-ai-panel')?.contains(document.activeElement) === true),
    await p.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`));
  // Was read off the button after the tap; the button leaves with /find now.
  ok('the button reported expanded before it handed over',
    (await p.evaluate(() => window.__expanded)).includes('true'),
    JSON.stringify(await p.evaluate(() => window.__expanded)));
  const landed = await p.waitForURL(onSearch, { timeout: 6000 }).then(() => true, () => false);
  ok('the tap carries the caller on to /search, where her answers land', landed, p.url());
  ok('and the call survives the route change', await sheet(p).isVisible());
  await ctx.close();
});

await section('ringing becomes connected, with a running timer', async () => {
  const { ctx, p } = await fresh({ stayOpen: true });
  await call(p);
  await p.waitForFunction(
    () => document.querySelector('#wain-ai-panel')?.textContent.includes('متصل'),
    null, { timeout: 6000 }
  );
  const t = await sheet(p).textContent();
  ok('the status says connected', t.includes('متصل'));
  ok('with a call timer in Arabic-Indic digits', /[٠-٩]{2}:[٠-٩]{2}/.test(t), t.slice(0, 120));
  ok('and a hang-up button', t.includes('إنهاء المكالمة'));
  // The pick-up's own buzz, read where nothing else can make it. `success` —
  // [12, 45, 22] — is buzzed by the pick-up and by an answer, and this call
  // (stayOpen) never answers. The check this stands in for counted two buzzes
  // after a dial, which the dial makes on its own; see «the tap buzzes» below.
  const buzzed = await p.evaluate(() => window.__vibrations.filter((v) => Array.isArray(v)).map((v) => v.join(','))).catch(() => []);
  ok('picking up buzzes, in a pattern of its own', buzzed.includes('12,45,22'), JSON.stringify(buzzed));
  // A timer that renders ٠٠:٠٠ and never moves would pass the shape check
  // above while telling the caller nothing.
  await p.waitForTimeout(1400);
  ok('and the timer actually counts', /٠٠:٠[١٢]/.test(await sheet(p).textContent()),
    (await sheet(p).textContent()).slice(0, 120));
  await ctx.close();
});

await section('hanging up ends the call and reports how long it ran', async () => {
  const { ctx, p } = await fresh({ stayOpen: true });
  await call(p);
  await p.waitForFunction(
    () => document.querySelector('#wain-ai-panel')?.textContent.includes('متصل'),
    null, { timeout: 6000 }
  );
  await hangUp(p);
  await p.waitForTimeout(200);
  const t = await sheet(p).textContent();
  ok('the call is reported ended', t.includes('انتهت المكالمة'));
  ok('the duration is still shown', /[٠-٩]{2}:[٠-٩]{2}/.test(t), t.slice(0, 120));
  ok('the recogniser is released, not left listening', (await p.evaluate(() => window.__aborted)) === true);
  ok('and she can be called again', t.includes('اتصل مرة ثانية'));
  await ctx.close();
});

await section('the sheet sits where it can be read and dismissed', async () => {
  /**
   * This used to measure the sheet against the floating launcher: it was
   * anchored above the button, so moving one without the other buried it —
   * 52 of the button's 60 pixels went under the sheet, and with them the ring
   * pulse that existed precisely to show a live call from behind it.
   *
   * Both the floating launcher AND the small floating card it anchored above
   * are gone now. A call takes over the whole screen — `fixed inset-0` in
   * `WainAiCall.tsx` — the way a phone's own call screen does, which means
   * it now DELIBERATELY covers the installed app's tab bar rather than
   * clearing it; the old assertion here (`panel.bottom <= tabTop`) asserted
   * the opposite of what shipped on purpose and had to be rewritten, not
   * just re-passed. What is worth measuring instead: the sheet fills the
   * viewport exactly, in both modes, because the two layouts still differ
   * elsewhere in globals.css (body padding, overscroll) even though the
   * sheet itself no longer does.
   */
  const { ctx, p } = await fresh({ stayOpen: true });
  for (const installed of [false, true]) {
    if (installed) {
      await p.evaluate(() => document.documentElement.setAttribute('data-standalone', 'true'));
      await p.waitForTimeout(120);
    }
    if (!(await sheet(p).count())) await call(p);
    const box = await p.evaluate(() => {
      const e = document.querySelector('#wain-ai-panel');
      const b = e.getBoundingClientRect();
      return { top: b.top, left: b.left, bottom: b.bottom, right: b.right, vw: innerWidth, vh: innerHeight };
    });
    const where = installed ? 'installed' : 'in a browser';
    ok(`${where}: the sheet covers the top edge`, box.top === 0, `top ${box.top}`);
    ok(`${where}: the full width`, box.left === 0 && box.right === box.vw,
      `left ${box.left} right ${box.right} vs vw ${box.vw}`);
    ok(`${where}: and the bottom edge, tab bar included`, box.bottom === box.vh,
      `bottom ${box.bottom} vs vh ${box.vh}`);
    // Covering the tab bar's area is not the same as being OVER it: the
    // sheet and the bar were both z-50 and the bar is mounted after the
    // sheet, so in the installed app the bar painted over the foot of the
    // call. Measured where the bar is: what a finger finds there must be
    // the sheet. (A first version tested the hang-up's own centre, which sat
    // just above the bar, and passed against the bug — so it tests the bar.)
    const hit = await p.evaluate(() => {
      const bar = document.querySelector('nav.app-chrome');
      if (!bar || getComputedStyle(bar).display === 'none') return 'no bar shown';
      const r = bar.getBoundingClientRect();
      // The page behind the sheet is inert while it is up (10 November), and
      // hit-testing skips an inert element: asked as it stands, the bar is
      // never found whatever is painted on top, and this could not fail. It
      // is lifted for the one read, so the answer is the paint order again.
      const was = bar.inert;
      bar.inert = false;
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      bar.inert = was;
      return document.querySelector('#wain-ai-panel')?.contains(at) ? 'sheet' : (at?.closest('nav') ? 'tab bar' : at?.tagName ?? 'nothing');
    });
    if (installed) ok(`${where}: where the tab bar is, a finger finds the call, not the bar`, hit === 'sheet', hit);
  }
  await ctx.close();
});

await section('the page behind the call stays where it was', async () => {
  // The sheet scrolls only when its own content overflows, and on a phone it
  // mostly does not — so a drag on it scrolled the document behind, and on an
  // iPhone slid Safari's toolbar in and out under the finger (8 October). A
  // wheel stands in for the drag: the scroll chain is the same one.
  const { ctx, p } = await fresh({ stayOpen: true });
  await call(p);
  await onCall(p);
  const tall = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  ok('the page behind is long enough to scroll, so the check means something', tall > 200, `overflow ${tall}px`);
  const before = await p.evaluate(() => scrollY);
  await p.mouse.move(195, 420);
  await p.mouse.wheel(0, 900);
  await p.waitForTimeout(500);
  const during = await p.evaluate(() => scrollY);
  ok('scrolling on the call does not scroll the page behind it', during === before, `${before} → ${during}`);
  await p.locator('#wain-ai-panel button[aria-label="إغلاق"]').click({ timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(300);
  await p.mouse.wheel(0, 900);
  await p.waitForTimeout(500);
  ok('and once the call is closed the page scrolls again', (await p.evaluate(() => scrollY)) > before,
    String(await p.evaluate(() => scrollY)));
  await ctx.close();
});

await section('turned sideways, the call stays out of the notch', async () => {
  // viewport-fit=cover gives the page the whole screen, and a sideways iPhone
  // takes 47px off each side for the notch and the corners. The sheet's p-4
  // put her name and the hang-up 16px from an edge the notch covers
  // (8 October). DevTools makes env(safe-area-inset-*) read as an iPhone's.
  const { ctx, p } = await fresh({ stayOpen: true, viewport: { width: 844, height: 390 } });
  const cdp = await ctx.newCDPSession(p);
  const emulated = await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 47, right: 47, bottom: 21 } }).then(() => true, () => false);
  ok('this Chromium can stand in for a notched phone', emulated);
  await call(p);
  await onCall(p);
  const under = await p.evaluate(() => {
    const out = [];
    const sheet = document.querySelector('#wain-ai-panel');
    if (!sheet) return ['no sheet'];
    const range = document.createRange();
    const walk = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.trim() || n.parentElement.closest('.sr-only')) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 1) continue;
        if (r.left < 46 || innerWidth - r.right < 46) { out.push(`«${n.textContent.trim().slice(0, 20)}» ${Math.round(r.left)}|${Math.round(innerWidth - r.right)}`); break; }
      }
    }
    for (const b of sheet.querySelectorAll('button, a')) {
      const r = b.getBoundingClientRect();
      if (r.width && (r.left < 46 || innerWidth - r.right < 46)) out.push(`${b.getAttribute('aria-label') || b.textContent.trim().slice(0, 20)} (control) ${Math.round(r.left)}|${Math.round(innerWidth - r.right)}`);
    }
    return out;
  });
  ok('nothing on the call sheet sits under the notch or a corner', under.length === 0, under.slice(0, 4).join(' · '));
  await ctx.close();
});

await section('the hang-up does not come back as a failure', async () => {
  // The red button abort()s the engine, and the engine answers that abort a
  // moment later through the same handlers. Nothing in this component may act
  // on a dead call's report: it used to, and «ما سمعناك» replaced the ended
  // call and its duration a fraction of a second after the caller hung up —
  // a hang-up presented to them as something having gone wrong.
  const { ctx, p, errors } = await fresh({ stayOpen: true });
  await call(p);
  await onCall(p);
  await hangUp(p);
  await p.waitForTimeout(400); // well past the engine's abort report
  const t = await sheet(p).textContent();
  ok('the ended call stays ended', t.includes('انتهت المكالمة'), t.slice(0, 140));
  ok('no error is invented from the abort', !t.includes('ما سمعناك') && !t.includes('ما قدرنا'), t.slice(0, 140));
  ok('and no page error', errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await section('hanging up and calling straight back', async () => {
  // The same report, arriving late enough to land on the *next* call. This is
  // the worse half of the same defect: the dying call cleared the live call's
  // recogniser handle, so the new call no longer recognised its own onstart
  // and rang until the caller gave up on it.
  const { ctx, p, errors } = await fresh({ stayOpen: true, abortReportMs: 700 });
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
});

await section('a call that never connects gives up on its own', async () => {
  // No handler ever fires, so only a timeout can end this. Before there was
  // one, the ring-back repeated every four seconds for as long as the sheet
  // was open — the caller's only way out was the button they were waiting on.
  const { ctx, p } = await fresh({ neverStarts: true });
  await call(p);
  // Safari parks a running context («interrupted») when another app takes the
  // audio, and a ring that held on to it rang into the parked context for the
  // rest of the dial. suspend() stands in for the interruption; the next burst
  // has to bring it back.
  const parked = await p.evaluate(() => window.__ac ? window.__ac.suspend().then(() => window.__ac.state) : 'no context').catch((e) => String(e));
  // Patient first, and only then impatient: a dial timeout that fires early is
  // worse than none, because it hangs up on the caller mid-permission-prompt.
  await p.waitForTimeout(10_000);
  ok('it is still ringing after ten seconds', (await sheet(p).textContent()).includes('يرن'));
  const state = await p.evaluate(() => window.__ac?.state ?? 'no context').catch((e) => String(e));
  ok('a ring parked mid-dial is woken by the next burst', parked === 'suspended' && state === 'running', `parked: ${parked}, then ${state}`);
  await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 25_000 });
  const t = await sheet(p).textContent();
  ok('it stops ringing and says so', !t.includes('يرن') && t.includes('طوّلنا نرن'), t.slice(0, 140));
  ok('and offers the call again', t.includes('اتصل مرة ثانية'));
  await ctx.close();
});

await section('the reason given matches the reason', async () => {
  // Every code but not-allowed used to be reported as «ما سمعناك». A vendor
  // speech service that is unreachable is not silence on the caller's end, and
  // telling them it is sends them back to speak louder into the same failure.
  for (const [err, expect, label] of [
    ['network', 'ما قدرنا نوصلك', 'the speech service is unreachable'],
    // `audio-capture` is not in this table: it depends on whether the engine
    // had started listening, and it has its own section below.
    // `service-not-allowed` is NOT the microphone: WebKit says it when
    // Siri/Dictation is off or the locale is one Apple lacks. It read «allow
    // the microphone» until 3 October, to callers whose microphone was on.
    ['service-not-allowed', 'التعرّف على الصوت مو شغّال', 'the speech service is switched off'],
    ['language-not-supported', 'التعرّف على الصوت مو شغّال', 'the language is not on this phone'],
  ]) {
    const { ctx, p } = await fresh({ error: err });
    await call(p);
    await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 });
    const t = await sheet(p).textContent();
    ok(`${label}: said as itself`, t.includes(expect), `${err} → ${t.slice(0, 110)}`);
    ok(`${label}: not reported as silence`, expect === 'ما سمعناك' || !t.includes('ما سمعناك'), t.slice(0, 110));
    await ctx.close();
  }
});

await section('a microphone that was there and went away is not reported as missing', async () => {
  /**
   * `audio-capture` is the engine losing its capture source. Before the engine
   * has started listening, the microphone was never there: «ما لقينا مايك»
   * and «وصّل مايك» are right. After it has started, the caller had a
   * microphone a moment ago, and it was muted or taken (an iPhone's switch, or
   * another app taking the audio) — «وصّل مايك» sends them to fix a thing that
   * is not broken. WebKit raises it on a mute mid-capture
   * (SpeechRecognitionCaptureSourceImpl.cpp). The same goes for a page the
   * phone has put away. The line for it is the one a caller with no answer
   * gets (C19, 15 October's sweep).
   */
  {
    const { ctx, p } = await fresh({ error: 'audio-capture' });
    await call(p);
    await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 }).catch(() => {});
    const t = await sheet(p).textContent({ timeout: 2000 }).catch(() => '');
    ok('lost after it started: not told to «وصّل مايك»', !t.includes('وصّل مايك'), t.slice(0, 140));
    ok('lost after it started: said as «ما سمعناك»', t.includes('ما سمعناك'), t.slice(0, 140));
    await ctx.close();
  }
  {
    // Before the engine starts, so only the hidden page can make this a
    // «ما سمعناك» and not the started-then-lost one: without the hidden check
    // the copy is «وصّل مايك» (15 October's sweep, C19; the reviewer's #3).
    const { ctx, p } = await fresh({ error: 'audio-capture', hidden: true, errorFirst: true });
    await call(p);
    await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 }).catch(() => {});
    const t = await sheet(p).textContent({ timeout: 2000 }).catch(() => '');
    ok('while the page is hidden: said as «ما سمعناك», not «وصّل مايك»', t.includes('ما سمعناك') && !t.includes('وصّل مايك'), t.slice(0, 140));
    await ctx.close();
  }
  {
    const { ctx, p } = await fresh({ error: 'audio-capture', errorFirst: true });
    await call(p);
    await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 }).catch(() => {});
    const t = await sheet(p).textContent({ timeout: 2000 }).catch(() => '');
    ok('control: missing from the start: still «ما لقينا مايك»', t.includes('ما لقينا مايك'), t.slice(0, 140));
    await ctx.close();
  }
});

await section('a browser that cannot listen is not told about its microphone', async () => {
  {
    const { ctx, p } = await fresh({ error: 'service-not-allowed' });
    await call(p);
    await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 });
    const link = p.locator('#wain-ai-panel a[href="/salem/"]', { hasText: 'اكتب لسالم' });
    ok('it offers typing to سالم instead', (await link.count()) === 1);
    await link.click({ timeout: 5000 }).catch(() => {});
    await p.waitForURL('**/salem/', { timeout: 5000 }).catch(() => {});
    ok('…which goes to /salem', new URL(p.url()).pathname === '/salem/', p.url());
    await ctx.close();
  }
  {
    // WhatsApp's own browser on Android: the API is there, the permission is
    // the host app's, and «allow the microphone» names a switch not there.
    const { ctx, p } = await fresh({ error: 'not-allowed', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 WhatsApp/2.24' });
    await call(p);
    await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 });
    const t = await sheet(p).textContent();
    ok('inside an app\'s browser, a refusal is not blamed on the microphone', t.includes('التعرّف على الصوت مو شغّال') && !t.includes('المايك مسموح للموقع'), t.slice(0, 120));
    await ctx.close();
  }
  {
    // An iPhone in Safari itself: Dictation off (or Safari's speech permission
    // refused) is `service-not-allowed`, and «open the site in Safari» told a
    // visitor already there to go where they were (8 October). The switch is
    // in Settings; typing to سالم is still offered.
    const { ctx, p } = await fresh({
      error: 'service-not-allowed',
      vendor: 'Apple Computer, Inc.',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    await call(p);
    await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 }).catch(() => {});
    const t = await sheet(p).textContent({ timeout: 2000 }).catch(() => '');
    ok('in Safari on an iPhone, a refusal says where the switch is', t.includes('الإملاء') && !t.includes('افتح الموقع بسفاري'), t.slice(0, 140));
    ok('…and still offers typing to سالم', (await p.locator('#wain-ai-panel a[href="/salem/"]', { hasText: 'اكتب لسالم' }).count()) === 1);
    await ctx.close();
  }
  {
    const { ctx, p } = await fresh({ vendor: 'Apple Computer, Inc.' });
    await call(p);
    ok('on Apple\'s recogniser it asks for the Arabic Apple has (ar-SA)', (await p.evaluate(() => window.__recLang)) === 'ar-SA', String(await p.evaluate(() => window.__recLang)));
    await ctx.close();
  }
});

await section('a call that hears nothing ends, instead of listening for ever', async () => {
  const { ctx, p } = await fresh({ stayOpen: true });
  await call(p);
  await onCall(p).catch(() => {});
  await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 12000 }).catch(() => {});
  const t = await sheet(p).textContent().catch(() => '');
  ok('after a silence the engine is stopped', (await p.evaluate(() => window.__stopped)) === true);
  ok('…and the caller is told nothing was heard', t.includes('ما سمعناك'), t.slice(0, 120));
  await ctx.close();
});

await section('the call connects her, and she answers', async () => {
  // January, two in the afternoon in Kuwait.
  const { ctx, p, errors } = await fresh({ transcript: 'قهوة هادية', at: new Date('2026-01-15T11:00:00Z') });
  await call(p);
  ok('audio is unlocked inside the gesture (iOS)', (await p.evaluate(() => window.__primed)) === 'in-gesture');
  ok('the microphone is asked for in Kuwaiti Arabic', (await p.evaluate(() => window.__recLang)) === 'ar-KW');
  ok('recognition starts inside the tap, as WebKit requires', (await p.evaluate(() => window.__startInGesture)) === true);
  ok('the call\'s sound is unlocked inside the tap too', (await p.evaluate(() => window.__acEvent)) === 'click', String(await p.evaluate(() => window.__acEvent)));
  // The call itself, not where focus ended up: /search is inert behind the
  // sheet now, and focus() on an inert field does nothing, so «the active
  // element is not an input» passed with /search's own guard taken out. The
  // guard still matters in the other order — /search arriving before the
  // sheet — where the keyboard opens under a call about to appear.
  ok('the search box does not ask for focus under the call', (await p.evaluate(() => window.__inputFocus)) === 0,
    `${await p.evaluate(() => window.__inputFocus)} focus() call(s) on a text field`);
  // The tap buzzes. This read «…and again when she picks up» on a count of
  // two, and said the second only exists once she is on the line. It does not:
  // the launcher's tap and startCall each buzz, so the dial alone makes two and
  // the check could not fail for a pick-up that never buzzed. The pick-up's
  // buzz is asserted in «ringing becomes connected», by its pattern.
  await p.waitForFunction(() => window.__vibrations.length >= 1, null, { timeout: 6000 }).catch(() => {});
  ok('the tap buzzes', (await p.evaluate(() => window.__vibrations.length)) >= 1);

  // Waiting for «/search» is not waiting for her: the tap on /find goes there
  // at once, before she has heard anything. The query is the event.
  await p.waitForURL((u) => decodeURIComponent(u.href).includes('قهوة هادية'), { timeout: 9000 }).catch(() => {});
  ok('what she heard becomes the search', decodeURIComponent(p.url()).includes('قهوة هادية'));
  await p.waitForFunction(() => window.__said.length > 0, null, { timeout: 8000 });
  const said = (await p.evaluate(() => window.__said)).join(' ');
  console.log(`      «${said}»`);
  ok('she repeats what she heard', said.includes('قهوة هادية؟'));
  // The short answer, 3 October: the place and where, then when — about
  // nine seconds. The tagline and a second place are on the screen behind her.
  ok('she recommends a place, «جرّب …»', said.includes('جرّب مقاهي المباركية'), said);
  ok('she says when to go', said.includes('روح العصر'), said);
  ok('and stops there — no tagline, no second place',
    !said.includes('حوش السوق') && !said.includes('وإذا تبي غيره'), said);
  ok('the results are on screen behind her', (await p.locator('a[href^="/places/"]').count()) > 0);
  ok('the voice toggle is left on', (await p.evaluate(() => localStorage.getItem('wain-voice-enabled'))) === '1');

  /**
   * «From your call» is a property of the arrival, not of the words. The
   * answer card hands the question to سالم as her call's (`from=call`), and it
   * used to do so again whenever the box held the spoken words — type
   * something else, type them back, and سالم was told «من مكالمتك مع شوق»
   * about a question that was typed (14 October).
   */
  const toSalem = () => p.locator('a[href*="/salem/"]', { hasText: 'كمّل مع سالم' }).first()
    .getAttribute('href', { timeout: 4000 }).then((h) => new URL(h ?? '', B).searchParams.get('from')).catch(() => null);
  ok('her answer card hands the spoken question to سالم as the call\'s', (await toSalem()) === 'call', String(await toSalem()));
  const box = p.locator('input[type="search"]').first();
  await box.fill('بحر');
  await p.waitForFunction(() => /بحر/.test(decodeURIComponent(location.search)), null, { timeout: 4000 });
  await box.fill('قهوة هادية');
  await p.waitForFunction(() => /قهوة هادية/.test(decodeURIComponent(location.search)), null, { timeout: 4000 });
  await p.waitForTimeout(400);
  ok('typed back after an edit, the same words are no longer «from the call»', (await toSalem()) === 'shouq', String(await toSalem()));
  ok('no page errors during the whole flow', errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await section('after the answer, the call waits for the next question', async () => {
  /**
   * One question per call, then a walk back to /find for the next — that was
   * the free call until 14 October, and the owner asked for follow-ups without
   * a limit. The sheet shrinks to a bar over the results the moment the answer
   * lands: the page is the answer, so it has to be seen and scrolled; the one
   * thing left to press is «اسأل مرة ثانية», and it is a tap of its own
   * because WebKit starts recognition only inside a gesture.
   */
  const { ctx, p, errors } = await fresh({ transcript: 'قهوة هادية', at: new Date('2026-01-15T11:00:00Z') });
  await call(p);
  await p.waitForURL((u) => decodeURIComponent(u.href).includes('قهوة هادية'), { timeout: 9000 }).catch(() => {});
  const bar = p.locator('#wain-ai-bar');
  await bar.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  ok('the call becomes a bar over the results', await bar.isVisible().catch(() => false));
  ok('and the full sheet is gone', (await p.locator('#wain-ai-panel').count()) === 0);
  const barText = (await bar.textContent().catch(() => '')) ?? '';
  ok('it names her and what she searched for', barText.includes('شوق') && barText.includes('قهوة هادية'), barText.slice(0, 120));
  ok('and offers the next question', barText.includes('اسأل مرة ثانية'), barText.slice(0, 120));
  ok('the page behind it is not locked', await p.evaluate(() => !document.documentElement.hasAttribute('data-call-open')));
  // Nor out of reach: the full sheet makes the page inert, and the bar must
  // give it back, or the answer is a page nobody can press.
  ok('and can be used again', (await p.evaluate(() => document.getElementById('main-content')?.inert === false).catch(() => null)) === true);
  ok('and is given room for the bar', await p.evaluate(() => document.documentElement.hasAttribute('data-call-bar')));
  ok('the results are there to see', (await p.locator('a[href^="/places/"]').count()) > 0);
  // Not a launcher: /search keeps its one-call-button count of zero (find.test).
  ok('the bar is not a second call button', (await p.locator('button[aria-controls="wain-ai-panel"]:visible').count()) === 0);
  // The sheet comes out from under the bar: the bar's bottom edge is the
  // viewport's, in both modes, so nothing the page draws there (the tab bar in
  // the installed app) paints over it.
  const under = await p.evaluate(() => {
    const r = document.querySelector('#wain-ai-bar')?.getBoundingClientRect();
    return r ? { bottom: r.bottom, vh: innerHeight, h: r.height } : null;
  });
  ok('the bar sits at the foot of the screen', !!under && Math.abs(under.bottom - under.vh) < 1 && under.h >= 48, JSON.stringify(under));

  await p.evaluate(() => { window.__startInGesture = null; window.__nextTranscript = 'بحر'; });
  await bar.getByRole('button', { name: 'اسأل مرة ثانية' }).click({ timeout: 4000 }).catch(() => {});
  await p.waitForSelector('#wain-ai-panel', { timeout: 4000 }).catch(() => {});
  ok('«اسأل مرة ثانية» brings the sheet back, ringing', (await p.locator('#wain-ai-panel').textContent().catch(() => '')).includes('يرن'));
  ok('and starts listening inside its own tap, as WebKit requires', (await p.evaluate(() => window.__startInGesture)) === true,
    String(await p.evaluate(() => window.__startInGesture)));
  await p.waitForURL((u) => decodeURIComponent(u.href).includes('بحر'), { timeout: 9000 }).catch(() => {});
  ok('the second question becomes the search', decodeURIComponent(p.url()).includes('بحر'), p.url());
  await bar.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  ok('and the bar is back, naming it', ((await bar.textContent().catch(() => '')) ?? '').includes('بحر'));

  // Leaving the results is leaving the call: a bar that followed the caller
  // round the site would be a call nobody is on.
  await p.locator('a[href^="/places/"]').first().click({ timeout: 4000 }).catch(() => {});
  await p.waitForURL((u) => new URL(u).pathname.startsWith('/places/'), { timeout: 6000 }).catch(() => {});
  await p.waitForTimeout(300);
  ok('tapping a result takes the bar down', (await p.locator('#wain-ai-bar').count()) === 0);
  ok('and the room under the page with it', await p.evaluate(() => !document.documentElement.hasAttribute('data-call-bar')));
  ok('no page errors through it', errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await section('the bar can be closed, and the close is quiet', async () => {
  const { ctx, p } = await fresh({ transcript: 'قهوة هادية' });
  await call(p);
  const bar = p.locator('#wain-ai-bar');
  await bar.waitFor({ state: 'visible', timeout: 9000 }).catch(() => {});
  // Both checks below also hold when no bar ever came: nothing to take down,
  // nothing pressed, nothing buzzed. So the bar is asked for first.
  ok('the bar is up before it is closed', await bar.isVisible().catch(() => false));
  const before = (await p.evaluate(() => window.__vibrations)).length;
  await bar.getByRole('button', { name: 'إغلاق' }).click({ timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(200);
  ok('إغلاق takes the bar down', (await p.locator('#wain-ai-bar').count()) === 0);
  ok('without a hang-up buzz — there was no call to end', (await p.evaluate(() => window.__vibrations)).length === before);
  await ctx.close();
});

await section('Escape in the search box does not take the call bar down', async () => {
  /**
   * The bar is not a dialog: it sits over a page the caller is using, and its
   * × is how it closes. Escape is the full sheet's key. Listened for on the
   * bar too, one Escape in /search's box cleared the query and took the bar
   * with it (14 October, 15 October's sweep).
   */
  const { ctx, p, errors } = await fresh({ transcript: 'قهوة هادية', at: new Date('2026-01-15T11:00:00Z') });
  await call(p);
  await p.waitForURL((u) => decodeURIComponent(u.href).includes('قهوة هادية'), { timeout: 9000 }).catch(() => {});
  const bar = p.locator('#wain-ai-bar');
  await bar.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  ok('the bar is up before Escape', await bar.isVisible().catch(() => false));
  const box = p.locator('input[type="search"]').first();
  const before = (await box.inputValue({ timeout: 2000 }).catch(() => '')) ?? '';
  ok('control: the search box holds the question', before.includes('قهوة'), before);
  await box.focus({ timeout: 3000 }).catch(() => {});
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok('control: Escape reached the box and cleared it', (await box.inputValue({ timeout: 2000 }).catch(() => 'x')) === '');
  ok('and the bar is still up', await bar.isVisible().catch(() => false));
  ok('no page errors through it', errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await section("سالم's free call with no speech input stays on his chat", async () => {
  /**
   * His call from his header in a browser with no recogniser (Firefox). The
   * no-support branch used to push /search whatever the persona, so a caller
   * who had asked سالم was moved to her results page to be told to type (C21,
   * 15 October's sweep). The alert is the same line as on /find; the page is
   * his chat.
   */
  const { ctx, p } = await fresh({ noRecognition: true });
  await p.goto(B + '/salem/', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'كلّم سالم' }).click({ timeout: 4000 }).catch(() => {});
  await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 }).catch(() => {});
  const why = (await p.locator('#wain-ai-panel [role=alert]').first().textContent({ timeout: 2000 }).catch(() => '')) ?? '';
  ok('control: the sheet says the browser cannot listen', why.includes('ما يدعم الإدخال الصوتي'), why);
  await p.waitForTimeout(800);
  ok('and the caller stays on his chat', new URL(p.url()).pathname === '/salem/', p.url());
  await ctx.close();
});

await section("سالم's call hears a spoken follow-up as a follow-up to what his chat showed", async () => {
  /**
   * The caller types «قهوة» into his chat, then calls him from its header and
   * says «الثاني». The second place of the typed answer is what is meant. The
   * spoken words used to be filed as a new question with no places, and the
   * chat answered «عن شنو؟» — and the job its next agent would be told lost the
   * four places (14 October's handover sweep, #2).
   */
  const { ctx, p, errors } = await fresh({ transcript: 'الثاني', at: new Date('2026-01-15T11:00:00Z') });
  await p.goto(B + '/salem/', { waitUntil: 'networkidle' });
  const box = p.locator('#salem-q');
  await box.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  await box.fill('قهوة');
  await box.press('Enter');
  const log = p.locator('[role="log"]');
  await log.locator('a[href^="/places/"]').first().waitFor({ state: 'attached', timeout: 9000 }).catch(() => {});
  ok('control: the typed «قهوة» is answered with places', (await log.locator('a[href^="/places/"]').count()) >= 2);
  await p.waitForTimeout(400);
  const before = await p.evaluate(() => JSON.parse(sessionStorage.getItem('wain:job:v1') ?? 'null'));
  ok('control: the chat holds its four places as the job', before?.shown?.length >= 2, JSON.stringify(before)?.slice(0, 160));
  await p.getByRole('button', { name: 'كلّم سالم' }).click({ timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(2500);
  await p.locator('#wain-ai-bar').waitFor({ state: 'visible', timeout: 9000 }).catch(() => {});
  const agentLines = (await log.locator('p').allTextContents().catch(() => [])).join(' | ');
  ok('the spoken «الثاني» is not answered with «عن شنو»', !agentLines.includes('عن شنو'), agentLines.slice(0, 200));
  const job = await p.evaluate(() => JSON.parse(sessionStorage.getItem('wain:job:v1') ?? 'null'));
  ok('the job still holds the places the chat showed', !!before && job?.shown?.length === before.shown.length && job.shown.length >= 2, JSON.stringify(job)?.slice(0, 200));
  ok('and the question it was typed under', job?.asked === 'قهوة', String(job?.asked));
  ok('no page errors through it', errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await section("سالم's free call lands on his chat, not on her card", async () => {
  /**
   * His call from his header, with no agent: the phone's recogniser and our
   * search, as hers. It used to end on /search — her answer card, her name —
   * so a caller who had asked سالم was answered by شوق (14 October). His chat
   * answers the question in his name instead.
   */
  const { ctx, p, errors } = await fresh({ transcript: 'قهوة هادية', at: new Date('2026-01-15T11:00:00Z') });
  await p.goto(B + '/salem/', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'كلّم سالم' }).click({ timeout: 4000 }).catch(() => {});
  await p.waitForSelector('#wain-ai-panel', { timeout: 6000 }).catch(() => {});
  const ringing = (await p.locator('#wain-ai-panel').textContent().catch(() => '')) ?? '';
  ok('the sheet rings in his name', ringing.includes('سالم') && !ringing.includes('شوق'), ringing.slice(0, 120));
  // His chat is already the page, so nothing navigates: it used to push
  // /salem/?q=… there, which remounts nothing, and the chat — reading ?q= only
  // at mount — never asked it; the old check here passed on his greeting
  // alone (14 October). The question has to appear as the caller's own line
  // and be answered with places.
  const log = p.locator('[role="log"]');
  const asked = await log.locator('.justify-end p', { hasText: 'قهوة هادية' }).first()
    .waitFor({ state: 'visible', timeout: 9000 }).then(() => true, () => false);
  ok('the question lands on his chat, as the caller\'s own line', asked);
  ok('and is answered there with places', await log.locator('a[href^="/places/"]').first()
    .waitFor({ state: 'attached', timeout: 9000 }).then(() => true, () => false));
  const text = (await log.textContent().catch(() => '')) ?? '';
  ok('as a question, not as «from her call»', !text.includes('من مكالمتك مع شوق'), text.slice(0, 160));
  ok('on the same page', new URL(p.url()).pathname === '/salem/', p.url());
  const bar = p.locator('#wain-ai-bar');
  await bar.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  ok('and the bar waits there in his name', ((await bar.textContent().catch(() => '')) ?? '').includes('سالم'));
  // The bar is not the dialog: there is no #wain-ai-panel while it is up, and
  // his pill used to report aria-expanded="true" over it all the same.
  const pillExpanded = await p.getByRole('button', { name: 'كلّم سالم' }).first()
    .getAttribute('aria-expanded', { timeout: 3000 }).catch(() => null);
  const panelThere = (await p.locator('#wain-ai-panel').count()) > 0;
  ok('his pill does not report a dialog open that is not on the page', pillExpanded === 'false' || (pillExpanded === 'true' && panelThere),
    `aria-expanded=${pillExpanded}, panel ${panelThere ? 'there' : 'absent'}`);

  /**
   * The next step after his call is typing a follow-up, and the bar sat on the
   * box: 61px at z-60 over the chat's form, so a tap on the input landed on
   * the bar — at 320×568 on «اسأل مرة ثانية», which rang again (15 October).
   * The page-room rule for the bar pads <main>, and this chat is a fixed frame.
   */
  // A home bar under all of it (34px, an iPhone's), so each mode's own inset
  // padding is part of what is measured.
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 0, bottom: 34 } }).catch(() => {});
  await p.waitForTimeout(200);
  const reachable = () => p.evaluate(() => {
    const hit = (el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!at && (at === el || el.contains(at));
    };
    const box = document.getElementById('salem-q');
    const send = box?.form?.querySelector('button[type="submit"]');
    const bar = document.getElementById('wain-ai-bar')?.getBoundingClientRect();
    return {
      box: !!box && hit(box), send: !!send && hit(send),
      // Clear of the bar, not only hit at its centre.
      clear: !!box && !!bar && box.getBoundingClientRect().bottom <= bar.top,
    };
  }).catch(() => null);
  const fine = (r) => !!r?.box && !!r?.send && !!r?.clear;
  const stillUp = () => p.locator('#wain-ai-bar').isVisible().catch(() => false);
  let reach = await reachable();
  ok('390: with his bar up, the chat\'s box and send button take a tap', fine(reach) && await stillUp(), JSON.stringify(reach));
  await p.setViewportSize({ width: 320, height: 568 });
  await p.waitForTimeout(300);
  reach = await reachable();
  ok('320: …and on a small phone', fine(reach) && await stillUp(), JSON.stringify(reach));
  await p.evaluate(() => { document.documentElement.dataset.standalone = 'true'; });
  await p.waitForTimeout(300);
  reach = await reachable();
  ok('320 installed: …and over the tab bar', fine(reach) && await stillUp(), JSON.stringify(reach));
  // Installed, the tab bar steps aside while the box has focus and the chat
  // takes its room; the bar has to come down with it, or it sits on the form.
  await p.locator('#salem-q').focus({ timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(300);
  reach = await reachable();
  ok('320 installed, typing: …and still with the tab bar stepped aside', fine(reach) && await stillUp(), JSON.stringify(reach));
  ok('no page errors through it', errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await section('a call whose code cannot be loaded does not take the site down', async () => {
  /**
   * The call sits outside <main> in the root layout, so the route's error
   * boundary never sees it: a chunk that failed to load replaced the WHOLE
   * tree with Next's bare «Application error» — the page, the tab bar and the
   * way out, gone for one call that could not start (14 October).
   */
  const { ctx, p } = await fresh();
  // Failing only until the line comes back, below.
  let failing = true;
  await ctx.route('**/_next/static/chunks/*.js', async (route) => {
    if (!failing) return route.fallback();
    const r = await route.fetch();
    const body = await r.text();
    if (body.includes('wain-ai-panel')) return route.abort('failed');
    return route.fulfill({ response: r, body });
  });
  await dial(p);
  await p.waitForSelector('[data-call-failed]', { timeout: 8000 }).catch(() => {});
  ok('the page is still there', (await p.locator('main#main-content').count()) === 1);
  ok('and not Next\'s error page', !(await p.locator('body').textContent()).includes('Application error'));
  ok('no sheet opened', (await p.locator('#wain-ai-panel').count()) === 0);
  const said = (await p.locator('[data-call-failed]').textContent().catch(() => '')) ?? '';
  ok('the caller is told in one line', said.includes('ما قدرنا نشغّل المكالمة'), said);
  // The tap started listening inside the gesture, for a call that never
  // loaded: nothing stopped it, so the microphone stayed open behind the line.
  ok('the recogniser the tap started is let go, not left listening', (await p.evaluate(() => window.__aborted).catch(() => null)) === true);

  /**
   * And the site has to survive the NEXT step too. The rejected chunk was an
   * error thrown in render while the tap's own push to /search was in flight,
   * and that left Next's router broken: the page stayed up only until the
   * next navigation — an ordinary link, or the retry — replaced the whole
   * site with «Application error» (10 November; the 14 October boundary and
   * the first repair of the retry both had it). So one ordinary step is
   * taken, and the page is looked at again. Same document throughout, so a
   * window mark is kept: a reload is the control, not the test.
   */
  await p.evaluate(() => { window.__samePage = true; }).catch(() => {});
  const where = () => new URL(p.url()).pathname;
  const alive = async () =>
    (await p.locator('main#main-content').count().catch(() => 0)) === 1 &&
    !(((await p.locator('body').textContent().catch(() => '')) ?? '').includes('Application error'));
  const from = where();
  // Whichever page the failure left the caller on: /find's link to سالم, or
  // the back button every other page has.
  const step = from.startsWith('/find') ? p.locator('a[href="/salem/"]').first() : p.locator('button[aria-label="رجوع"]').first();
  await step.click({ timeout: 4000 }).catch(() => {});
  await p.waitForURL((u) => new URL(u).pathname !== from, { timeout: 4000 }).catch(() => {});
  ok('an ordinary step after the failure still goes somewhere', where() !== from, `still on ${where()}`);
  ok('and the site is still there after it, not taken down one step later', await alive());

  /**
   * And the line's own advice — «جرّب مرة ثانية» — has to work. The failed
   * load was kept by React.lazy and thrown again on every later render, so
   * every tap in the same page showed the line again while the chunk itself
   * now arrived (10 November).
   */
  failing = false;
  if (!new URL(p.url()).pathname.startsWith('/find')) {
    await p.evaluate(() => history.back()).catch(() => {});
    await p.waitForURL((u) => new URL(u).pathname.startsWith('/find'), { timeout: 4000 }).catch(() => {});
  }
  await fab(p).click({ timeout: 4000 }).catch(() => {});
  const reopened = await p.waitForSelector('#wain-ai-panel', { timeout: 8000 });
  ok('the next tap tries again, and the call opens', !!reopened);
  ok('and the failure line is gone', (await p.locator('[data-call-failed]').count()) === 0);
  ok('with the site still under it', await alive());
  ok('in the same page, not a reload', (await p.evaluate(() => window.__samePage === true).catch(() => false)) === true);
  await ctx.close();
});

await section('starting a call stops whatever is being read aloud', async () => {
  // The header launcher on /salem is the same button as /find's, so one tap
  // there covers both. A reply is spoken first (read-aloud is on), then the
  // tap: the device voice must be cancelled in the tap itself, or the call's
  // ring-back and her answer overlap for the whole first second.
  const { ctx, p, errors } = await fresh({ at: new Date('2026-01-15T11:00:00Z') });
  await p.goto(B + '/salem/', { waitUntil: 'networkidle' });
  // Read-aloud is the chat's own switch, pressed the way a visitor presses it
  // (the press is also what unlocks audio on iOS). Setting its storage key
  // directly would not reach the chat's state until a reload.
  const readAloud = p.getByRole('button', { name: 'اقرا لي الردود', exact: true });
  await readAloud.click();
  ok('the read-aloud switch is on', (await readAloud.getAttribute('aria-pressed')) === 'true');
  await p.fill('#salem-q', 'قهوة هادية');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => window.__said.length > 0, null, { timeout: 12000 }).catch(() => {});
  ok('a reply is being read aloud before the call starts', (await p.evaluate(() => window.__said.length)) > 0);
  const before = await p.evaluate(() => window.__cancels || 0);
  await p.locator('button[aria-controls="wain-ai-panel"]').first().click();
  const during = await p.evaluate(() => window.__cancels || 0);
  ok('the tap cancels the device voice, in the gesture', during > before, `cancel() calls: ${before} before the tap, ${during} after`);
  ok('no page errors during the whole flow', errors.length === 0, errors.join(' | '));
  await ctx.close();
});

await section('when it goes wrong, she says why', async () => {
  // The distinctive half of each sentence, read off the ALERT. The first was
  // «المايك», read off the whole sheet — which prints «يحتاج إذن المايك» on
  // every screen, so it passed whatever error was shown.
  for (const [err, expect, label] of [
    ['not-allowed', 'المايك مسموح', 'microphone refused'],
    ['no-speech', 'ما سمعناك', 'nothing heard'],
  ]) {
    const { ctx, p } = await fresh({ error: err });
    await call(p);
    // The failure arrives after the microphone prompt is answered, so the
    // sheet is still ringing when call() returns. Waiting for the alert is
    // the difference between testing the error and testing the ring.
    await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 });
    const t = await p.locator('#wain-ai-panel').textContent();
    const alert = (await p.locator('#wain-ai-panel [role=alert]').first().textContent({ timeout: 2000 }).catch(() => '')) ?? '';
    ok(`${label}: explained in Arabic`, alert.includes(expect), alert.slice(0, 90));
    ok(`${label}: offers to call again`, t.includes('اتصل مرة ثانية'));
    ok(`${label}: the message is announced, not just shown`, (await p.locator('#wain-ai-panel [role=alert]').count()) === 1);
    /**
     * And announced once. The header's status is a live region too, and on a
     * failure it fell back to her role line at the instant the alert spoke: two
     * announcements for one event, one of them not news. What the region
     * exposes is read here — its text without anything `aria-hidden` — and the
     * words themselves stay on screen.
     */
    const exposed = () => p.evaluate(() => {
      const region = document.querySelector('#wain-ai-panel header [aria-live]');
      if (!region) return '(no region)';
      const copy = region.cloneNode(true);
      copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      return copy.textContent.trim();
    }).catch(() => '(unread)');
    ok(`${label}: the header does not announce her role beside the failure`, (await exposed()) === '', await exposed());
    ok(`${label}: and her role is still on screen there`,
      ((await p.locator('#wain-ai-panel header').textContent({ timeout: 2000 }).catch(() => '')) ?? '').includes('دليلتك في الكويت'));
    // The redial is news again, and has to be heard: the region was never
    // switched off, so «يرن…» arrives in it as a change.
    await p.locator('#wain-ai-panel').getByRole('button', { name: 'اتصل مرة ثانية' }).click({ timeout: 4000 }).catch(() => {});
    const rang = await p.waitForFunction(() => {
      const region = document.querySelector('#wain-ai-panel header [aria-live]');
      return !!region && !region.querySelector('[aria-hidden="true"]') && region.textContent.includes('يرن');
    }, null, { timeout: 3000 });
    ok(`${label}: the redial's ringing is announced in the same region`, !!rang);
    await ctx.close();
  }
  // Heard nothing at all
  const { ctx, p } = await fresh({ transcript: '   ' });
  await call(p);
  await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 });
  // «Did it stay off /search» used to be the evidence. The tap itself lands
  // on /search now, so the query is: nothing heard, nothing searched for.
  ok('an empty transcript does not search for nothing', !p.url().includes('q='), p.url());
  await ctx.close();
});

await section('a browser with no speech input still gets somewhere', async () => {
  /**
   * «Did it land on /search» used to be the whole assertion. Every tap on /find
   * lands there now, so it proves nothing about the fallback — a test that
   * passes for the wrong reason is worse than one that fails. What still
   * distinguishes it is that she SAYS why instead of going quiet: the panel
   * raises an alert naming the missing speech support, and the typed box is
   * right there behind it.
   */
  const { ctx, p } = await fresh({ noRecognition: true });
  await dial(p);
  await p.waitForSelector('#wain-ai-panel [role=alert]', { timeout: 6000 });
  const why = await p.locator('#wain-ai-panel [role=alert]').first().textContent();
  ok('it says the browser has no microphone input rather than dead-ending',
    /متصفح|صوت|ما يدعم/.test(why || ''), why);
  // Waited for, not counted at once: the alert is up ~200ms after the tap on
  // /find, while /search is still arriving (0 inputs at 200ms, 1 at 600ms,
  // measured). A count taken in that gap read as «no box».
  // The wait is soft in fresh() and answers null when it gives up, so
  // `.then(() => true)` read «never found» as found. The answer itself is kept.
  ok('and the typed box it points at is on the page',
    !!(await p.waitForSelector('input[aria-label*="بحث"], input[type="search"]', { timeout: 6000 })));
  await ctx.close();
});

await section('keyboard and screen-reader users place the same call', async () => {
  // stayOpen: a call that waits on the line, so what it announces there can be
  // read before the answer moves it on.
  const { ctx, p } = await fresh({ stayOpen: true });
  await p.goto(B + '/find/', { waitUntil: 'networkidle' });
  await watchExpanded(p);
  await fab(p).focus();
  await p.keyboard.press('Enter');
  // The wait's own answer, not `ok(…, true)`: the wait gives up with null.
  const placed = await p.waitForSelector('#wain-ai-panel', { timeout: 6000 });
  ok('Enter places the call, same as a tap', !!placed);
  ok('the panel is a labelled dialog', (await p.locator('#wain-ai-panel[role=dialog]').count()) === 1);
  /**
   * One announcer while she is on the line: the status in the header. This
   * read «the live transcript is announced» with a count of one or more, which
   * the header met on its own — and which a headline given `aria-live` again,
   * the double announcement taken out on 23 September, met as well.
   */
  await onCall(p);
  const announcers = await p.evaluate(() => [...document.querySelectorAll('#wain-ai-panel [aria-live]')]
    .map((e) => (e.closest('header') ? 'header' : e.tagName))).catch(() => ['(unread)']);
  ok('the status line is the one announcer on the line', announcers.length === 1 && announcers[0] === 'header', announcers.join(', '));
  ok('and the line under her face is not a second one', (await p.locator('#wain-ai-panel p.font-display[aria-live]').count()) === 0);
  /**
   * `aria-modal` is a promise, not a mechanism. Tab walked out of the sheet
   * and into the page it covers, so a keyboard caller stood on links they
   * could not see (measured: the fourth Tab). The page is inert while the
   * full sheet is up. Focus may rest on the body between laps, as it does
   * round any modal; what it may never do is land on the page.
   */
  const pageInert = () => p.evaluate(() => document.getElementById('main-content')?.inert === true).catch(() => null);
  ok('the page behind the sheet is out of reach while it is up', (await pageInert()) === true);
  const strayed = [];
  for (const key of [...Array(10).fill('Tab'), ...Array(4).fill('Shift+Tab')]) {
    await p.keyboard.press(key);
    const where = await p.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return 'body';
      return document.querySelector('#wain-ai-panel')?.contains(a) ? 'sheet' : `${a.tagName}${a.id ? '#' + a.id : ''}`;
    }).catch(() => '(unread)');
    if (where !== 'sheet' && where !== 'body') strayed.push(`${key}→${where}`);
  }
  ok('Tab and Shift+Tab never land on the page behind it', strayed.length === 0, strayed.join(', '));
  // Recorded as it changed: Enter, like a tap, moves on to /search and the
  // button unmounts, so there is nothing left to read afterwards.
  ok('the button reported expanded', (await p.evaluate(() => window.__expanded)).includes('true'),
    JSON.stringify(await p.evaluate(() => window.__expanded)));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  // One Escape, all the way out. A dialog that hangs up but stays on screen
  // is a dialog Escape did not close, which is the thing Escape is for.
  ok('Escape hangs up and closes in one press', (await p.locator('#wain-ai-panel').count()) === 0);
  ok('the recogniser is stopped, not left listening', (await p.evaluate(() => window.__aborted)) === true);
  ok('and the page is given back', (await pageInert()) === false);
  await ctx.close();
});

await section('a hang-up from the keyboard leaves focus in the sheet', async () => {
  // The hang-up button exists only while the call is up, so pressing it from
  // the keyboard took the focused element away with the call, and focus fell
  // to the body behind the aria-modal dialog.
  const { ctx, p } = await fresh({ stayOpen: true });
  await call(p);
  await onCall(p);
  await p.locator('#wain-ai-panel button', { hasText: 'إنهاء المكالمة' }).first().focus({ timeout: 4000 }).catch(() => {});
  ok('control: the hang-up button has focus', await p.evaluate(() =>
    (document.activeElement?.textContent ?? '').includes('إنهاء المكالمة')).catch(() => false));
  await p.keyboard.press('Enter');
  // The wait's own answer is the control: it is soft, and with no hang-up the
  // focus is still on the hang-up button, inside the dialog, and the check
  // below passed on a call that never ended.
  const ended = await p.waitForFunction(() => document.querySelector('#wain-ai-panel')?.textContent.includes('انتهت المكالمة'), null, { timeout: 4000 });
  ok('control: the keyboard hang-up ended the call', !!ended);
  const focused = () => p.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`).catch(() => '(unread)');
  const inDialog = () => p.evaluate(() => document.querySelector('#wain-ai-panel')?.contains(document.activeElement) === true).catch(() => false);
  ok('after it, focus is still in the dialog, not on the page behind it', await inDialog(), await focused());
  /**
   * And one key press later. «اتصل مرة ثانية» lives on the ended screen only,
   * so the redial takes the focused button away exactly as the hang-up did,
   * and focus fell to the body again — the same fault, one step on.
   */
  await p.locator('#wain-ai-panel button', { hasText: 'اتصل مرة ثانية' }).first().focus({ timeout: 4000 }).catch(() => {});
  ok('control: the redial button has focus', await p.evaluate(() =>
    (document.activeElement?.textContent ?? '').includes('اتصل مرة ثانية')).catch(() => false));
  await p.keyboard.press('Enter');
  const rang = await p.waitForFunction(() => !document.querySelector('#wain-ai-panel')?.textContent.includes('اتصل مرة ثانية'), null, { timeout: 4000 });
  ok('control: the keyboard redial left the ended screen', !!rang);
  ok('and a redial from the keyboard keeps focus in the dialog too', await inDialog(), await focused());
  await ctx.close();
});

await section('the bar waits for the page its answer is going to', async () => {
  /**
   * The answer sets «answered» and pushes /search in the same moment, and the
   * path moves only once /search's payload has arrived. On a slow line the bar
   * met /find, the page it was leaving, and closed itself at once: the answer
   * arrived with no way to ask the next question (measured with the payload
   * 3s late). Without the delay this passes either way.
   */
  const { ctx, p } = await fresh({ transcript: 'قهوة هادية' });
  // Counted: the section proves nothing unless a payload was actually held.
  let held = 0;
  await ctx.route((url) => url.pathname === '/search/index.txt', async (route) => {
    held++;
    await new Promise((r) => setTimeout(r, 3000));
    await route.fallback().catch(() => {});
  });
  await p.goto(B + '/find/', { waitUntil: 'networkidle' });
  await fab(p).click({ timeout: 4000 }).catch(() => {});
  const landed = await p.waitForURL((u) => decodeURIComponent(u.href).includes('قهوة هادية'), { timeout: 15000 }).then(() => true, () => false);
  ok('control: the answer reaches /search', landed, p.url());
  ok("control: and /search's payload was held back on the way", held > 0, `${held} request(s) held`);
  ok('and the bar is there for the next question',
    await p.locator('#wain-ai-bar').waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false));
  await ctx.close();
});

await section('a caller who keeps talking is stopped at the cap, and answered', async () => {
  /**
   * «8s with nothing heard, 15s in all» (3 October). The silence half has its
   * section above; this is the other half. An engine that hears a question and
   * never decides it is over held the microphone on a live call for as long
   * as the cap was not there, and nothing here noticed.
   */
  const { ctx, p } = await fresh({ heardNeverEnds: true, transcript: 'قهوة هادية' });
  await call(p);
  await onCall(p);
  // Past the silence mark, short of the cap: something was heard, so the
  // silence rule must not cut it.
  await p.waitForTimeout(9000);
  const header = (await p.locator('#wain-ai-panel header').textContent({ timeout: 2000 }).catch(() => '')) ?? '';
  const early = await p.evaluate(() => window.__stopped === true).catch(() => null);
  ok('a caller still speaking is not cut at the silence mark', header.includes('متصل') && early === false, `${header.slice(0, 60)} · stopped: ${early}`);
  const answered = await p.waitForURL((u) => decodeURIComponent(u.href).includes('قهوة هادية'), { timeout: 9000 }).then(() => true, () => false);
  ok('but is stopped at the cap and answered with what was heard',
    answered && (await p.evaluate(() => window.__stopped === true).catch(() => false)), p.url());
  await ctx.close();
});

await section('شوق has a face, and it is alive', async () => {
  // She was five vertical bars — a picture of audio, on a button whose own
  // label says «اضغط عشان تكلّم شوق». The mark is a smiling face now, and
  // these hold the two things that make a face read as a person rather than
  // a sticker: she blinks while she waits, and her mouth only moves once
  // somebody has actually picked up.
  const { ctx, p } = await fresh({ stayOpen: true });
  await p.goto(B + '/find/', { waitUntil: 'networkidle' });

  // This read the small launcher in the /search box (a handset with voice
  // arcs), then — from 1 October — /find's portrait button, her photo filling
  // the circle. Since 2 October (on request: one big call button on a drawn
  // phone) her photo is on the PHONE'S SCREEN and the button is a phone's
  // call button: a handset, no photo, no arcs. At rest it is still.
  const launcher = fab(p);
  ok('the one launcher is a call button on the phone, her photo on the screen above it',
    (await launcher.locator('img').count()) === 0 &&
    (await launcher.locator('svg').count()) === 1 &&
    (await launcher.locator('[data-part="waves"]').count()) === 0 &&
    (await p.locator('[data-phone] img[src*="shouq-face"]').count()) === 1);
  ok('and it is still while nothing is happening: no ring pulse',
    (await launcher.locator('.animate-ping').count()) === 0);

  await call(p);
  await p.waitForFunction(
    () => document.querySelector('#wain-ai-panel')?.textContent.includes('متصل'),
    null, { timeout: 6000 }
  );
  ok('the call sheet shows her face, built from the icon set',
    (await p.locator('.shouq [data-part="eyes"]').count()) >= 1 &&
    (await p.locator('.shouq [data-part="mouth"]').count()) >= 1);

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

  /**
   * This section used to assert «once she is connected, EVERY face starts
   * speaking», and that assertion was encoding the bug.
   *
   * `live` is the state where she is listening — it is the caller's turn —
   * and in agent mode it is the whole call from the moment the widget mounts
   * to the moment it is hung up. So the mouth moved continuously over a
   * conversation the interface could not hear, and the test held it there.
   * Measured before the fix on a built agent-mode export: 2 of 2 faces
   * carried `shouq--talking` for the full call.
   *
   * The widget cannot be asked: `isSpeaking` and `mode` live in its own
   * Preact state and the only thing it dispatches is
   * `elevenlabs-convai:call` — read out of the published 0.18.1 bundle
   * rather than assumed. So the honest rule is that the mouth moves only in
   * `answering`, which exists in local mode alone and is the one phase that
   * genuinely means «she is producing speech».
   */
  const live = await p.evaluate(() => {
    const all = [...document.querySelectorAll('.shouq')];
    return {
      n: all.length,
      talking: all.filter((f) => f.classList.contains('shouq--talking')).length,
      mouth: getComputedStyle(all[0].querySelector('[data-part="mouth"]')).animationName,
    };
  });
  ok('connected is her LISTENING, so her mouth is still', live.n >= 1 && live.talking === 0,
    `${live.talking}/${live.n} talking`);
  ok('and no mouth animation is running yet', live.mouth === 'none', live.mouth);

  // Now the phase that does mean speech. `answering` is entered when the
  // recogniser delivers a final result, and it lasts ANSWER_MS — long enough
  // to catch, which is why this waits on the class rather than on a timer.
  /**
   * `stayOpen` connects and then just listens, so nothing ends on its own —
   * drive the two events the real engine sends, in order.
   *
   * BOTH are needed and that is the part worth writing down: `onresult` only
   * records what was heard, and it is `onend` that calls `finishWith` and
   * moves the call to «answering». Firing the result alone leaves the sheet
   * showing the transcript on a call that is still `live` — which is exactly
   * what it did here, and read as «the mouth still is not moving» rather
   * than «the phase never changed».
   */
  await p.evaluate(() => {
    window.__rec.onresult({ results: [[{ transcript: 'قهوة' }]] });
    window.__rec.onend();
  });
  const spoke = await p.waitForFunction(
    () => {
      const all = [...document.querySelectorAll('.shouq')];
      const talking = all.filter((f) => f.classList.contains('shouq--talking')).length;
      return talking === all.length && all.length >= 1 ? { n: all.length, talking } : null;
    },
    null, { timeout: 4000 }
  ).then((h) => h.jsonValue()).catch(() => null);
  ok('but when she answers, every face speaks', spoke !== null,
    'no face started talking on «شوق ترد…»');
  // Was «the launcher's arcs sound with her». No launcher follows the call to
  // /search any more, so the faces in the sheet are the only thing that may.
  ok('and no launcher is left on /search to claim it', (await fab(p).count()) === 0);
  await ctx.close();
});

await section('a call that fails says so, in the hand and in the ear', async () => {
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
  await call(p);
  // The alert's own words. «المايك» anywhere on the sheet is on every screen
  // (the standing «يحتاج إذن المايك» note), so waiting for it waited for
  // nothing and the check under it could not fail.
  await p.waitForFunction(
    () => document.querySelector('#wain-ai-panel [role=alert]')?.textContent.includes('المايك مسموح'),
    null, { timeout: 8000 }
  );
  ok('the refusal is explained on screen',
    ((await p.locator('#wain-ai-panel [role=alert]').first().textContent({ timeout: 2000 }).catch(() => '')) ?? '').includes('المايك مسموح'));

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
  // Waited for: placed from /find, the refusal's words can be on screen a
  // moment before the error phase that buzzes (measured: «8, 8» read at the
  // words, the [24,55,24] ~200ms later). The pattern is the event, not the text.
  await p.waitForFunction(() => Array.isArray(window.__vibrations.at(-1)) &&
    window.__vibrations.at(-1).length === 3 && window.__vibrations.at(-1)[0] === 24,
    null, { timeout: 4000 }).catch(() => {});
  const buzz = await p.evaluate(() => window.__vibrations);
  const last = buzz.at(-1);
  console.log(`      vibrations: ${JSON.stringify(buzz)}`);
  ok('the failure buzzes rather than going quiet', Array.isArray(last), JSON.stringify(last));
  ok('with a pattern of its own, not the tap and not success',
    Array.isArray(last) && last.length === 3 && JSON.stringify(last) !== JSON.stringify([12, 45, 22]),
    JSON.stringify(last));
  await ctx.close();
});

await section('the call is not paid for until it is placed', async () => {
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
    // What the CALL ships: the sheet (its talking face is the one string only
    // WainAiCall carries) and the agent's element. It used to look for
    // `webkitSpeechRecognition`, and since 3 October /find ships exactly that
    // on purpose — a few lines in lib/speech that start listening inside the
    // tap, because WebKit refuses a start that comes a chunk later.
    return ['shouq--talking', 'createElement("elevenlabs-convai")']
      .filter((s) => bodies.some((b) => b.includes(s)));
  });
  ok('the privacy page does not ship the call machinery', early.length === 0, early.join(' | '));

  /**
   * And it does not offer the call either any more.
   *
   * The claim used to be «the button is there, the call it opens is not». The
   * call is still mounted — it has to be, so it outlives `open_place` — but its
   * one button is on /find, so the privacy policy no longer invites anybody
   * into a feature whose only move from this page was to leave it.
   */
  ok('nor offers the call from here',
    !(await p.locator('button[aria-label*="وين AI"]').first().isVisible()));

  const shipped = () => p.evaluate(async () => {
    const srcs = [...document.querySelectorAll('script[src]')].map((s) => s.src);
    const bodies = await Promise.all(srcs.map((u) => fetch(u).then((r) => r.text()).catch(() => '')));
    // What the CALL ships: the sheet (its talking face is the one string only
    // WainAiCall carries) and the agent's element. It used to look for
    // `webkitSpeechRecognition`, and since 3 October /find ships exactly that
    // on purpose — a few lines in lib/speech that start listening inside the
    // tap, because WebKit refuses a start that comes a chunk later.
    return ['shouq--talking', 'createElement("elevenlabs-convai")']
      .filter((s) => bodies.some((b) => b.includes(s)));
  });
  // /search legitimately ships the search index, and is where every call
  // ends — so the question is whether it ships the CALL before one is placed.
  await p.goto(B + '/search/', { waitUntil: 'networkidle' });
  const onSearchPage = await shipped();
  ok('the search page does not ship it either', onSearchPage.length === 0, onSearchPage.join(' | '));

  // The launcher was read on /search; it is /find's alone since 1 October.
  await p.goto(B + '/find/', { waitUntil: 'networkidle' });
  const btn = p.locator('button[aria-label*="وين AI"]').first();
  ok('the launcher is on /find', (await btn.count()) > 0);
  ok('and still carries its accessible name',
    ((await btn.getAttribute('aria-label')) || '').includes('شوق'));

  // Read again HERE: the page that holds the button must not ship what it opens.
  const beforeTap = await shipped();
  ok('/find does not ship it before the tap either',
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

  // The sheet's own marker, as `shipped()` reads above. It looked for
  // `webkitSpeechRecognition` until 7 October, when سالم's header got the call
  // button too: the button and the few lines of lib/speech it starts inside
  // the tap became a chunk /find and /salem both load up front, so the tap no
  // longer fetches that string — while the call it opens is still fetched on
  // the tap, which is the claim.
  const late = await p.evaluate(async (urls) => {
    const bodies = await Promise.all(urls.map((u) => fetch(u).then((r) => r.text()).catch(() => '')));
    return bodies.some((b) => b.includes('shouq--talking'));
  }, fetched);
  ok(`the tap fetched the call machinery (${fetched.length} chunk(s))`, late, fetched.join(', '));
  await ctx.close();
});

console.log(`\n${counts.pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
