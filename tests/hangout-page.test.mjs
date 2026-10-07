import { chromium } from 'playwright';

/**
 * «رسّلها للربع» on a real place page.
 *
 * The logic tests cover what the message says. This covers the part that only
 * exists in a browser: whether the thing a visitor taps actually reaches
 * WhatsApp. That is a chain of three fallbacks — the native share sheet, then
 * wa.me, then the clipboard — and on any one device only one link of it runs,
 * so the other two are exactly the kind of code that is wrong for a year.
 *
 * Every layer is removed in turn and the next one is checked to catch it.
 */
const B = process.env.WAIN_URL || 'http://127.0.0.1:4207';
const PLACE = '/places/kuwait-towers/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

/**
 * A page with the three share mechanisms replaced by spies.
 * `share` decides what navigator.share does: "ok", "cancel", "throw", or
 * "absent" (the property is deleted, as on desktop Firefox).
 */
async function fresh({ share = 'ok', canOpen = true, clipboard = true, at = null, open = true } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ar-KW',
  });
  await ctx.addInitScript(({ share, canOpen, clipboard }) => {
    window.__shared = [];
    window.__opened = [];
    window.__copied = [];
    if (share === 'absent') {
      delete Navigator.prototype.share;
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    } else {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (data) => {
          window.__shared.push(data);
          if (share === 'cancel') {
            const e = new Error('cancelled'); e.name = 'AbortError'; return Promise.reject(e);
          }
          if (share === 'throw') return Promise.reject(new Error('not allowed'));
          return Promise.resolve();
        },
      });
    }
    window.open = (url) => { window.__opened.push(url); return canOpen ? {} : null; };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (t) => {
          if (!clipboard) return Promise.reject(new Error('denied'));
          window.__copied.push(t); return Promise.resolve();
        },
      },
    });
  }, { share, canOpen, clipboard });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  // A controllable clock, when a scenario needs the hour to pass. Installed
  // before navigation so the component's very first `new Date()` is the fake
  // one; `at` is a Kuwait wall-clock time, which is the only clock this
  // feature reasons in.
  if (at) {
    await p.clock.install({ time: new Date(Date.UTC(2026, 7, 21, at[0] - 3, at[1])) });
  }
  await p.goto(B + PLACE, { waitUntil: 'networkidle' });
  // The chips sit behind «غيّر» since 7 October; the sections below are
  // about the chips, so they open it. The closed panel has its own section.
  if (open) await panel(p).getByRole('button', { name: 'غيّر' }).click({ timeout: 6000 }).catch(() => {});
  return { ctx, p, errors };
}

const panel = (p) => p.locator('section', { has: p.locator('h2', { hasText: 'رسّلها للربع' }) }).last();
const sendButton = (p) => panel(p).locator('button', { hasText: /^رسّلها$|لحظة/ });

console.log('\n── closed, it is the plan in one line and a send button (7 October) ──');
{
  const { ctx, p } = await fresh({ open: false });
  await panel(p).waitFor({ timeout: 6000 });
  const what = await panel(p).locator('[data-plan-what]').textContent({ timeout: 4000 }).catch(() => '');
  ok('the line names the place', what.includes('أبراج الكويت'), what);
  const when = await panel(p).locator('[data-plan-when]').textContent({ timeout: 4000 }).catch(() => '');
  ok('and says when, in words', /الحين|بعد ساعة|الليلة|باچر|الويكند|عقب المغرب/.test(when), when);
  const visibleChips = await panel(p).locator('fieldset button:visible').count();
  ok('no chips until «غيّر»', visibleChips === 0, `${visibleChips} visible`);
  ok('the send button is right there', await sendButton(p).isVisible());
  const height = (await panel(p).boundingBox())?.height ?? 999;
  ok('the closed panel is short (under 260px at 390)', height < 260, `${Math.round(height)}px`);
  await panel(p).getByRole('button', { name: 'غيّر' }).click();
  ok('«غيّر» opens the chips', (await panel(p).locator('fieldset button:visible').count()) >= 3);
  ok('and says it is open', (await panel(p).getByRole('button', { name: /تمام/ }).getAttribute('aria-expanded')) === 'true');
  const chips = panel(p).locator('fieldset button');
  const last = (await chips.last().textContent()).trim();
  await chips.last().click();
  const after = await panel(p).locator('[data-plan-when]').textContent();
  ok('a chip changes the line', after.includes(last.replace(/ مساءً$/, '')) || /باچر|الويكند/.test(after), `${last} → ${after}`);
  await ctx.close();
}

console.log('\n── the time this device sends is the next one offered (7 October) ──');
{
  const { ctx, p } = await fresh({ share: 'ok' });
  await panel(p).waitFor({ timeout: 6000 });
  const chips = panel(p).locator('fieldset button');
  const target = chips.filter({ hasText: 'الويكند' });
  await target.click({ timeout: 4000 }).catch(() => {});
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 6000 }).catch(() => {});
  await p.reload({ waitUntil: 'networkidle' });
  const line = await panel(p).locator('[data-plan-when]').textContent({ timeout: 4000 }).catch(() => '');
  ok('after sending «الويكند», the next plan starts at the weekend', line.includes('الويكند'), line);
  await ctx.close();
}

console.log('\n── the panel is on the page, with a time already chosen ──');
{
  const { ctx, p, errors } = await fresh();
  await panel(p).waitFor({ timeout: 6000 });
  ok('the panel renders', await panel(p).isVisible());
  const chips = panel(p).locator('button[aria-pressed]');
  const n = await chips.count();
  ok('it offers time chips', n >= 3, `${n} chips`);
  ok('exactly one is preselected', (await panel(p).locator('button[aria-pressed="true"]').count()) === 1);
  ok('the send button is there', await sendButton(p).isVisible());
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log('\n── with a share sheet, that is what gets used ──');
{
  const { ctx, p } = await fresh({ share: 'ok' });
  await panel(p).waitFor({ timeout: 6000 });
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 6000 });
  const [data] = await p.evaluate(() => window.__shared);
  ok('the share sheet is opened', !!data);
  ok('the message names the place', data.text.includes('أبراج الكويت'), data.text.slice(0, 60));
  ok('and carries a time', /الحين|بعد ساعة|الليلة الساعة|باچر|الويكند/.test(data.text), data.text);
  ok('and the page link', data.text.includes('/places/kuwait-towers/'), data.text.slice(-80));
  // Passing url alongside text makes several Android browsers drop the text.
  ok('url is not passed alongside text', data.url === undefined, JSON.stringify(Object.keys(data)));
  ok('no WhatsApp tab was opened as well', (await p.evaluate(() => window.__opened.length)) === 0);
  ok('and nothing was copied', (await p.evaluate(() => window.__copied.length)) === 0);
  await ctx.close();
}

console.log('\n── changing the chip changes the message ──');
{
  const { ctx, p } = await fresh({ share: 'ok' });
  await panel(p).waitFor({ timeout: 6000 });
  const chips = panel(p).locator('button[aria-pressed]');
  const chosen = await chips.last().textContent();
  await chips.last().click();
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 6000 });
  const [data] = await p.evaluate(() => window.__shared);
  ok(`picking «${chosen.trim()}» puts it in the message`,
    data.text.includes(chosen.trim().replace(/^٧ مساءً$/, 'الساعة ٧')) ||
    data.text.includes(chosen.trim()) ||
    /الساعة|باچر|الويكند|الحين|بعد ساعة/.test(data.text), data.text.split('\n')[1]);
  ok('that chip is the pressed one', (await chips.last().getAttribute('aria-pressed')) === 'true');
  await ctx.close();
}

console.log('\n── no share sheet: WhatsApp directly ──');
{
  const { ctx, p } = await fresh({ share: 'absent' });
  await panel(p).waitFor({ timeout: 6000 });
  await sendButton(p).click();
  await p.waitForFunction(() => window.__opened.length > 0, null, { timeout: 6000 });
  const [url] = await p.evaluate(() => window.__opened);
  ok('wa.me is opened', url.startsWith('https://wa.me/?text='), url.slice(0, 40));
  ok('with the message encoded into it', decodeURIComponent(url).includes('أبراج الكويت'), decodeURIComponent(url).slice(0, 60));
  await p.waitForSelector('[role=status]', { timeout: 4000 });
  ok('and it says so', (await panel(p).textContent()).includes('واتساب'));
  await ctx.close();
}

console.log('\n── no share sheet and a blocked popup: the clipboard ──');
{
  const { ctx, p } = await fresh({ share: 'absent', canOpen: false });
  await panel(p).waitFor({ timeout: 6000 });
  await sendButton(p).click();
  await p.waitForFunction(() => window.__copied.length > 0, null, { timeout: 6000 });
  const [text] = await p.evaluate(() => window.__copied);
  ok('the message is copied', text.includes('أبراج الكويت'), text.slice(0, 50));
  await p.waitForSelector('[role=status]', { timeout: 4000 });
  ok('and it tells them to paste it', (await panel(p).textContent()).includes('انتسخت'));
  await ctx.close();
}

console.log('\n── nothing works at all: it says so rather than going quiet ──');
{
  const { ctx, p } = await fresh({ share: 'absent', canOpen: false, clipboard: false });
  await panel(p).waitFor({ timeout: 6000 });
  await sendButton(p).click();
  await p.waitForSelector('[role=alert]', { timeout: 6000 });
  // It used to say «انسخ الرابط من فوق» — and on /search or in سالم's chat
  // the address bar holds no invitation. The message itself is what they
  // need, so it is on screen, with its own copy button.
  ok('an alert explains what to do instead', (await panel(p).textContent()).includes('انسخه'));
  const box = panel(p).locator('textarea');
  ok('the message is on screen to copy by hand', (await box.count()) === 1 && (await box.inputValue()).includes('أبراج الكويت'));
  ok('with a copy button beside it', (await panel(p).locator('button', { hasText: 'انسخ' }).count()) === 1);
  await ctx.close();
}

console.log('\n── the panel is in the HTML, not grown into the page later ──');
{
  // It rendered nothing until mount, so a place page drew its lower half and
  // then pushed it down by a panel. The shell is in the export; only the chip
  // row waits for the clock.
  const html = await (await fetch(B + PLACE)).text();
  ok('the export already carries «رسّلها للربع»', html.includes('رسّلها للربع'));
  ok('…with its chip row marked busy until the hour is known', html.includes('aria-busy="true"'));
}

console.log('\n── the link carries the day it was sent, on Kuwait\'s calendar ──');
{
  // 01:00 in Kuwait on 21 August is 22:00 UTC on the 20th. The day in the
  // link has to be the 21st: the plan is Kuwait's, not the server's.
  const { ctx, p } = await fresh({ share: 'ok', at: [1, 0] });
  await panel(p).waitFor({ timeout: 6000 });
  await p.waitForSelector('section:has(h2:text("رسّلها للربع")) fieldset button');
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 6000 });
  const [data] = await p.evaluate(() => window.__shared);
  const link = data.text.trim().split('\n').pop();
  ok('the invite link ends with the Kuwait day', /&d=2026-08-21$/.test(link), link);
  ok('and «باچر» in the message names its weekday', !data.text.includes('\nباچر\n'), data.text.split('\n')[1]);
  await ctx.close();
}

console.log('\n── after a send, the plan can go on the calendar ──');
{
  const { ctx, p } = await fresh({ share: 'ok', at: [15, 0] });
  await panel(p).waitFor({ timeout: 6000 });
  await p.waitForSelector('section:has(h2:text("رسّلها للربع")) fieldset button');
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 6000 });
  const cal = panel(p).locator('[data-calendar]');
  await cal.waitFor({ timeout: 4000 }).catch(() => {});
  ok('«أضفها للتقويم» appears once the plan has gone out', (await cal.count()) === 1);
  const google = await panel(p).locator('[data-calendar-google]').getAttribute('href').catch(() => '');
  ok('beside a Google Calendar link for the same plan', /calendar\.google\.com.*action=TEMPLATE.*dates=\d{8}T\d{6}Z/.test(google ?? ''), google);
  // Catch the file instead of letting the browser save it.
  await p.evaluate(() => {
    window.__file = null;
    URL.createObjectURL = (b) => { window.__file = b; return 'blob:caught'; };
    HTMLAnchorElement.prototype.click = function () { window.__download = this.download; };
  });
  await cal.click();
  await p.waitForFunction(() => window.__file !== null, null, { timeout: 4000 }).catch(() => {});
  const got = await p.evaluate(async () => ({ type: window.__file?.type, name: window.__download, text: window.__file ? await window.__file.text() : '' }));
  ok('the file is a calendar entry', got.type?.startsWith('text/calendar') && got.name?.endsWith('.ics'), `${got.type} ${got.name}`);
  ok('…with CRLF ends and a start time', got.text.includes('\r\nDTSTART:') && got.text.includes('END:VCALENDAR'), got.text.slice(0, 80));
  ok('…naming the place', got.text.replace(/\r\n /g, '').includes('أبراج الكويت'));
  await ctx.close();
}

console.log('\n── a share sheet that throws falls through to WhatsApp ──');
{
  const { ctx, p } = await fresh({ share: 'throw' });
  await panel(p).waitFor({ timeout: 6000 });
  await sendButton(p).click();
  await p.waitForFunction(() => window.__opened.length > 0, null, { timeout: 6000 });
  ok('the next option is tried', (await p.evaluate(() => window.__opened.length)) === 1);
  await ctx.close();
}

console.log('\n── backing out of the share sheet is not an error ──');
{
  const { ctx, p } = await fresh({ share: 'cancel' });
  await panel(p).waitFor({ timeout: 6000 });
  await sendButton(p).click();
  await p.waitForFunction(() => window.__shared.length > 0, null, { timeout: 6000 });
  await p.waitForTimeout(500);
  // Changing your mind must not open WhatsApp behind your back, and must not
  // be reported back to you as a failure.
  ok('WhatsApp is not opened behind them', (await p.evaluate(() => window.__opened.length)) === 0);
  ok('nothing is copied', (await p.evaluate(() => window.__copied.length)) === 0);
  ok('and no error is shown', (await panel(p).locator('[role=alert]').count()) === 0);
  ok('and no success is claimed either', (await panel(p).locator('[role=status]').count()) === 0);
  await ctx.close();
}

console.log('\n── the offer expires while the page is still open ──');
{
  // The defect this exists for. hangout.ts drops each evening option as it
  // passes — «offering ٧ مساءً at nine o'clock is offering a plan that already
  // failed» — and the panel honoured that once, on mount, then never looked at
  // the clock again. A place page is exactly what somebody leaves open while
  // the group argues about it.
  //
  // Opened at 18:55 with «٧ مساءً» chosen, wound forward past seven: the chip
  // has to go, and the selection has to move off it, because the message is
  // composed from the selection and not from what is on screen.
  const { ctx, p, errors } = await fresh({ at: [18, 55] });
  const chips = () => panel(p).locator('fieldset button');
  const selected = () => panel(p).locator('fieldset button[aria-pressed="true"]').textContent();

  await p.waitForSelector('section:has(h2:text("رسّلها للربع")) fieldset button');
  const before = await chips().allTextContents();
  ok('at 18:55 «٧ مساءً» is on offer', before.includes('٧ مساءً'), before.join(' / '));
  await panel(p).locator('button', { hasText: '٧ مساءً' }).click();
  ok('and can be chosen', (await selected()).trim() === '٧ مساءً', await selected());

  // Past the hour. The panel sleeps until the boundary and no longer.
  await p.clock.fastForward('06:10');
  await p.waitForTimeout(300);

  const after = await chips().allTextContents();
  ok('after seven it is gone from the row', !after.includes('٧ مساءً'), after.join(' / '));
  ok('and something still ahead is selected instead',
    (await selected()).trim() !== '٧ مساءً', await selected());

  // The half that actually reaches the group. A chip vanishing from the row
  // while `when` still holds its id would send the failed plan anyway.
  await sendButton(p).click();
  await p.waitForTimeout(200);
  const sent = (await p.evaluate(() => window.__shared))[0]?.text ?? '';
  ok('and the message does not propose a time that has passed',
    !sent.includes('الساعة ٧'), sent.split('\n').slice(0, 2).join(' | '));
  ok('it proposes one that has not', /الساعة ٨|الساعة ٩|الساعة ١٠|باچر|الحين|بعد ساعة|الويكند/.test(sent),
    sent.split('\n').slice(0, 2).join(' | '));
  ok('no page errors while the clock moved', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
