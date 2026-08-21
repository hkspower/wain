import { chromium } from 'playwright';

const B = process.env.WAIN_URL || 'http://127.0.0.1:4194';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const ctx = await browser.newContext({ locale: 'ar-KW' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));

/**
 * The fake Supabase. Every request to it is recorded, and `plan` decides what
 * happens to each one in turn — fail in transit, stall, or answer. A plan
 * entry is consumed per request, and once the plan runs out everything
 * succeeds, so a test only has to describe the part it cares about.
 */
const seen = [];
let plan = [];
await p.route('**/sb/**', async (route) => {
  const req = route.request();
  seen.push({ url: req.url(), method: req.method(), body: req.postData() });
  const step = plan.shift() ?? { kind: 'ok' };
  if (step.kind === 'fail') return route.abort('failed');
  if (step.kind === 'stall') return new Promise(() => {});   // never answers
  return route.fulfill({
    status: step.status ?? 201,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: step.body ?? '[]',
  });
});
const reset = (steps = []) => { seen.length = 0; plan = steps; };

/**
 * Wait until the fake server has actually seen `n` requests.
 *
 * Needed because a phase can finish before its own traffic has been recorded.
 * The abort test is the case: it cancels the request the instant it is made,
 * so `evaluate` resolves and the next phase calls `reset()` — and then the
 * route handler finally runs and pushes into the freshly-cleared list, failing
 * whichever assertion came next. That made "no request was put on the wire"
 * fail perhaps one run in three, on a phase that had done nothing wrong.
 */
const settle = async (n = 1, ms = 3000) => {
  const started = Date.now();
  while (seen.length < n && Date.now() - started < ms) await p.waitForTimeout(25);
};

await p.goto(B + '/net.html', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.wain);

const ORDER = {
  placeSlug: 'deera-cafe', placeNameAr: 'مقهى الديرة',
  lines: [{ id: 'a', nameAr: 'چاي كرك', priceFils: 250, qty: 2 }],
  pickupAt: '18:30', customerName: 'سالم', customerPhone: '51234567', noteAr: '',
};

console.log('\n── one request in, one request out ──');
// deadlineFetch deliberately does not retry: postgrest-js already retries the
// requests that are safe to repeat, and a second loop here would multiply with
// it rather than add to it. What it must do is classify the failure.
reset([{ kind: 'fail' }]);
let r = await p.evaluate(async (u) => {
  try { await window.wain.deadlineFetch(u + '/x'); return 'resolved'; }
  catch (e) { return window.wain.classifyError(e); }
}, process.env.WAIN_SB);
ok('a failed request is sent exactly once', seen.length === 1, `saw ${seen.length}`);
ok('and is classified as a network failure', r === 'network', String(r));

console.log('\n── a response is handed back untouched ──');
reset([{ kind: 'ok', status: 400 }]);
r = await p.evaluate(async (u) => (await window.wain.deadlineFetch(u + '/x')).status, process.env.WAIN_SB);
ok('a 400 is returned as a 400, not thrown', r === 400, String(r));
ok('and only once', seen.length === 1, `saw ${seen.length}`);

console.log('\n── the caller can still cancel ──');
reset([{ kind: 'stall' }]);
r = await p.evaluate(async (u) => {
  const ac = new AbortController();
  const promise = window.wain.deadlineFetch(u + '/x', { signal: ac.signal });
  ac.abort();
  try { await promise; return 'resolved'; }
  catch (e) { return e.name; }
}, process.env.WAIN_SB);
ok('an abort by the caller stays an AbortError, not a timeout', r === 'AbortError', String(r));
// Let this phase's own request be recorded before the next one clears the log.
await settle();

console.log('\n── offline is answered without touching the network ──');
reset();
await p.evaluate(() => Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }));
const startedOffline = Date.now();
r = await p.evaluate(async (u) => {
  try { await window.wain.deadlineFetch(u + '/x'); return 'resolved'; }
  catch (e) { return window.wain.classifyError(e); }
}, process.env.WAIN_SB);
const offlineMs = Date.now() - startedOffline;
ok('it says offline, not "network"', r === 'offline', String(r));
ok('no request was put on the wire', seen.length === 0, `saw ${seen.length}: ${seen.map((x) => x.url).join(' | ')}`);
ok('and it did not wait for the deadline first', offlineMs < 12000, `${offlineMs}ms`);
await p.evaluate(() => Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }));

console.log('\n── a stalled request gives up instead of hanging forever ──');
reset([{ kind: 'stall' }]);
const startedStall = Date.now();
r = await p.evaluate(async (u) => {
  try { await window.wain.deadlineFetch(u + '/x', { method: 'POST', body: '{}' }); return 'resolved'; }
  catch (e) { return window.wain.classifyError(e); }
}, process.env.WAIN_SB);
const stallMs = Date.now() - startedStall;
ok('it gives up, and calls it a timeout', r === 'timeout', String(r));
ok('at about the deadline, not never', stallMs > 13000 && stallMs < 25000, `${stallMs}ms`);

console.log('\n── every failure has an Arabic sentence ──');
const said = await p.evaluate(() => {
  const d = window.wain.describeNetError;
  return {
    offline: d(new Error('wain/offline'), 'FALLBACK'),
    timeout: d(new Error('wain/timeout'), 'FALLBACK'),
    network: d(new Error('Failed to fetch'), 'FALLBACK'),
    other: d({ code: '23514', message: 'check constraint' }, 'FALLBACK'),
  };
});
ok('offline says there is no connection', said.offline.includes('اتصال بالإنترنت'), said.offline);
ok('a timeout says it took too long', said.timeout.includes('طوّل'), said.timeout);
ok('a dropped connection is recognised from the browser wording', said.network.includes('انقطع'), said.network);
ok('a database refusal keeps the caller sentence', said.other === 'FALLBACK', said.other);

console.log('\n── placing an order over a bad network ──');
reset([{ kind: 'fail' }]);
r = await p.evaluate(async (input) => {
  const attempt = window.wain.newOrderAttempt();
  const res = await window.wain.submitOrder(input, attempt);
  return { ok: res.ok, reference: res.reference, id: attempt.id };
}, ORDER);
ok('one dropped request does not lose the order', r.ok === true, JSON.stringify(r));
ok('it was sent again', seen.filter((s) => s.method === 'POST').length === 2, `${seen.length} requests`);
const bodies = seen.filter((s) => s.method === 'POST').map((s) => JSON.parse(s.body).id ?? JSON.parse(s.body)[0]?.id);
ok('and both attempts carried the same order id', bodies[0] === bodies[1] && bodies[0] === r.id, JSON.stringify(bodies));

console.log('\n── the same basket sent twice is one order ──');
// The first send lands. Its reply is lost, so the customer presses again — and
// the database refuses the duplicate primary key, which is the proof that the
// order is already there.
reset([
  { kind: 'ok', status: 201 },
  { kind: 'ok', status: 409, body: JSON.stringify({ code: '23505', message: 'duplicate key' }) },
]);
const twice = await p.evaluate(async (input) => {
  const attempt = window.wain.newOrderAttempt();
  const a = await window.wain.submitOrder(input, attempt);
  const b = await window.wain.submitOrder(input, attempt);
  return { a: a.ok && a.reference, b: b.ok && b.reference };
}, ORDER);
ok('the first send succeeds', !!twice.a, JSON.stringify(twice));
ok('the second reports success too, not an error', !!twice.b, JSON.stringify(twice));
ok('and it is the same order, same reference', twice.a === twice.b, JSON.stringify(twice));

console.log('\n── a duplicate key is read as "already placed" ──');
reset([{ kind: 'ok', status: 409, body: JSON.stringify({ code: '23505', message: 'duplicate key' }) }]);
r = await p.evaluate(async (input) => {
  const res = await window.wain.submitOrder(input, window.wain.newOrderAttempt());
  return { ok: res.ok, reference: res.reference, reason: res.reason };
}, ORDER);
ok('a 23505 is a success, not a failure', r.ok === true, JSON.stringify(r));
ok('and it still hands back a reference to say at the counter', !!r.reference, JSON.stringify(r));

console.log('\n── a refusal is reported, and not retried ──');
reset([{ kind: 'ok', status: 400, body: JSON.stringify({ code: '23514', message: 'violates check' }) }]);
r = await p.evaluate(async (input) => {
  const res = await window.wain.submitOrder(input, window.wain.newOrderAttempt());
  return { ok: res.ok, reason: res.reason, message: res.message };
}, ORDER);
ok('a check violation fails', r.ok === false, JSON.stringify(r));
ok('it is called invalid, not a network problem', r.reason === 'invalid', JSON.stringify(r));
ok('and the request went out exactly once', seen.filter((s) => s.method === 'POST').length === 1, `${seen.length}`);

console.log('\n── "cannot ask" and "not there" are different answers ──');
reset([{ kind: 'ok', status: 200, body: '[]' }]);
r = await p.evaluate(async () => {
  const res = await window.wain.fetchOrderState('11111111-1111-4111-8111-111111111111', 'a'.repeat(32));
  return { ok: res.ok, state: res.state };
});
ok('an empty answer means the order is not there', r.ok === true && r.state === null, JSON.stringify(r));
reset([{ kind: 'fail' }, { kind: 'fail' }, { kind: 'fail' }]);
r = await p.evaluate(async () => {
  const res = await window.wain.fetchOrderState('11111111-1111-4111-8111-111111111111', 'a'.repeat(32));
  return { ok: res.ok, offline: res.offline };
});
ok('a failed request says so instead of claiming the order is gone', r.ok === false, JSON.stringify(r));

console.log('\n── an RPC read is retried, so a blip is invisible ──');
// PostgREST calls a function over POST, so postgrest-js will not retry it.
// order_status is `stable` and reads one row, which is why fetchOrderState is
// allowed to ask again itself.
reset([{ kind: 'fail' }, { kind: 'ok', status: 200, body: JSON.stringify([{ status: 'ready', place_slug: 'deera-cafe', place_name_ar: 'مقهى الديرة', lines: [], total_fils: 500, pickup_at: '18:30', note_ar: '', created_at: '2026-08-21T10:00:00Z', ready_at: '2026-08-21T10:20:00Z', collected_at: null, cancelled_at: null }]) }]);
r = await p.evaluate(async () => {
  const res = await window.wain.fetchOrderState('11111111-1111-4111-8111-111111111111', 'a'.repeat(32));
  return { ok: res.ok, status: res.state?.status };
});
ok('one failure then an answer still reads the order', r.ok === true && r.status === 'ready', JSON.stringify(r));

console.log('\n── calling the order off ──');
// cancel_order answers with the status the order ended up in, so the screen can
// tell "cancelled" from "too late" without a second round trip.
reset([{ kind: 'ok', status: 200, body: '"cancelled"' }]);
r = await p.evaluate(async () => {
  const res = await window.wain.cancelOrder('11111111-1111-4111-8111-111111111111', 'a'.repeat(32));
  return { ok: res.ok, reason: res.reason };
});
ok('a placed order cancels', r.ok === true, JSON.stringify(r));

reset([{ kind: 'ok', status: 200, body: '"ready"' }]);
r = await p.evaluate(async () => {
  const res = await window.wain.cancelOrder('11111111-1111-4111-8111-111111111111', 'a'.repeat(32));
  return { ok: res.ok, reason: res.reason, status: res.status, message: res.message };
});
ok('a ready order does not cancel', r.ok === false, JSON.stringify(r));
ok('and it is called too-late, not a failure', r.reason === 'too-late', JSON.stringify(r));
ok('the message sends them to the phone', r.message.includes('اتصل'), r.message);

reset([{ kind: 'ok', status: 200, body: '"collected"' }]);
r = await p.evaluate(async () => {
  const res = await window.wain.cancelOrder('11111111-1111-4111-8111-111111111111', 'a'.repeat(32));
  return { ok: res.ok, message: res.message };
});
ok('a collected order says so plainly', r.ok === false && r.message.includes('متسلّم'), JSON.stringify(r));

reset([{ kind: 'ok', status: 200, body: 'null' }]);
r = await p.evaluate(async () => {
  const res = await window.wain.cancelOrder('11111111-1111-4111-8111-111111111111', 'f'.repeat(32));
  return { ok: res.ok, reason: res.reason };
});
ok('a token that matches nothing is not reported as cancelled', r.ok === false, JSON.stringify(r));
ok('it is called unknown, not a network problem', r.reason === 'unknown', JSON.stringify(r));

reset([{ kind: 'fail' }]);
r = await p.evaluate(async () => {
  const res = await window.wain.cancelOrder('11111111-1111-4111-8111-111111111111', 'a'.repeat(32));
  return { ok: res.ok, reason: res.reason };
});
ok('a failed cancel is a network failure, not a silent success', r.ok === false && r.reason === 'network', JSON.stringify(r));
ok('and a write is not replayed on its own', seen.filter((s) => s.method === 'POST').length === 1, `${seen.length}`);

console.log('\n── terminal statuses are recognised ──');
const terminal = await p.evaluate(() => ({
  placed: window.wain.isTerminalStatus('placed'),
  ready: window.wain.isTerminalStatus('ready'),
  collected: window.wain.isTerminalStatus('collected'),
  cancelled: window.wain.isTerminalStatus('cancelled'),
}));
ok('placed and ready are not final', !terminal.placed && !terminal.ready, JSON.stringify(terminal));
ok('collected and cancelled are', terminal.collected && terminal.cancelled, JSON.stringify(terminal));

console.log('\n── taking a number ──');
const JOIN = { placeSlug: 'salon-x', placeNameAr: 'صالون', salonKind: 'men', customerName: 'سالم', customerPhone: '51234567' };

reset([{ kind: 'ok', status: 200, body: '7' }]);
r = await p.evaluate(async (input) => {
  const res = await window.q.joinQueue(input, window.q.newQueueAttempt());
  return { ok: res.ok, number: res.number, day: res.ticket?.day };
}, JOIN);
ok('the number comes back from the database', r.ok === true && r.number === 7, JSON.stringify(r));
ok('and the ticket is stamped with Kuwait\'s day', /^\d{4}-\d{2}-\d{2}$/.test(r.day ?? ''), String(r.day));

reset([{ kind: 'ok', status: 409, body: JSON.stringify({ code: '23505', message: 'duplicate key' }) }]);
r = await p.evaluate(async (input) => {
  const res = await window.q.joinQueue(input, window.q.newQueueAttempt());
  return { ok: res.ok, reason: res.reason, message: res.message };
}, JOIN);
ok('a second ticket for the same phone is refused', r.ok === false, JSON.stringify(r));
ok('and it is called a duplicate, not a failure', r.reason === 'duplicate', JSON.stringify(r));
ok('the message points at the existing turn', r.message.includes('دوري'), r.message);

reset([{ kind: 'ok', status: 400, body: JSON.stringify({ code: '23514', message: 'queue is not open here' }) }]);
r = await p.evaluate(async (input) => {
  const res = await window.q.joinQueue(input, window.q.newQueueAttempt());
  return { ok: res.ok, reason: res.reason };
}, JOIN);
ok('a closed queue says so', r.ok === false && r.reason === 'closed', JSON.stringify(r));

reset([{ kind: 'fail' }]);
r = await p.evaluate(async (input) => {
  const res = await window.q.joinQueue(input, window.q.newQueueAttempt());
  return { ok: res.ok, reason: res.reason };
}, JOIN);
ok('a failed join is a network failure, not a silent success', r.ok === false && r.reason === 'network', JSON.stringify(r));
ok('and it is not retried into a second person in the line',
  seen.filter((s) => s.method === 'POST').length === 1, `${seen.length}`);

console.log('\n── where am I in the line ──');
reset([{ kind: 'ok', status: 200, body: JSON.stringify([{ status: 'waiting', number: 7, ahead: 3, now_serving: 4, place_slug: 'salon-x', place_name_ar: 'صالون', service_minutes: 20, day: '2026-08-21', created_at: '2026-08-21T09:00:00Z', called_at: null, served_at: null, ended_at: null }]) }]);
r = await p.evaluate(async () => {
  const res = await window.q.fetchTicketState('11111111-1111-4111-8111-111111111111', 'a'.repeat(32));
  return { ok: res.ok, ahead: res.state?.ahead, nowServing: res.state?.nowServing, number: res.state?.number };
});
ok('the position comes through', r.ok === true && r.ahead === 3, JSON.stringify(r));
ok('so does who they are serving now', r.nowServing === 4, JSON.stringify(r));

reset([{ kind: 'ok', status: 200, body: '[]' }]);
r = await p.evaluate(async () => {
  const res = await window.q.fetchTicketState('11111111-1111-4111-8111-111111111111', 'f'.repeat(32));
  return { ok: res.ok, state: res.state };
});
ok('a wrong token finds nothing, and says so as "not there"', r.ok === true && r.state === null, JSON.stringify(r));

reset([{ kind: 'fail' }, { kind: 'ok', status: 200, body: JSON.stringify([{ status: 'called', number: 7, ahead: 0, now_serving: 7, place_slug: 'salon-x', place_name_ar: 'صالون', service_minutes: 20, day: '2026-08-21', created_at: '2026-08-21T09:00:00Z', called_at: '2026-08-21T09:40:00Z', served_at: null, ended_at: null }]) }]);
r = await p.evaluate(async () => {
  const res = await window.q.fetchTicketState('11111111-1111-4111-8111-111111111111', 'a'.repeat(32));
  return { ok: res.ok, status: res.state?.status };
});
ok('a blip is retried away — the read is a stable one-row lookup',
  r.ok === true && r.status === 'called', JSON.stringify(r));

console.log('\n── giving up your place ──');
reset([{ kind: 'ok', status: 200, body: '"left"' }]);
r = await p.evaluate(async () => {
  const res = await window.q.leaveQueue('11111111-1111-4111-8111-111111111111', 'a'.repeat(32));
  return { ok: res.ok };
});
ok('a waiting turn can be given up', r.ok === true, JSON.stringify(r));

reset([{ kind: 'ok', status: 200, body: '"served"' }]);
r = await p.evaluate(async () => {
  const res = await window.q.leaveQueue('11111111-1111-4111-8111-111111111111', 'a'.repeat(32));
  return { ok: res.ok, reason: res.reason, message: res.message };
});
ok('a finished turn cannot', r.ok === false && r.reason === 'too-late', JSON.stringify(r));
ok('and it says so plainly', r.message.includes('خلص'), r.message);

reset([{ kind: 'ok', status: 200, body: 'null' }]);
r = await p.evaluate(async () => {
  const res = await window.q.leaveQueue('11111111-1111-4111-8111-111111111111', 'f'.repeat(32));
  return { ok: res.ok, reason: res.reason };
});
ok('a token matching nothing is not reported as left', r.ok === false && r.reason === 'unknown', JSON.stringify(r));

console.log('\n── how busy is it, before you commit ──');
reset([{ kind: 'ok', status: 200, body: JSON.stringify([{ waiting: 4, now_serving: 3, service_minutes: 15 }]) }]);
r = await p.evaluate(async () => await window.q.fetchQueueSize('salon-x'));
ok('the queue length is readable by anyone', r?.waiting === 4, JSON.stringify(r));
ok('with the salon\'s own service time', r?.serviceMinutes === 15, JSON.stringify(r));
ok('and nothing about the people in it',
  !('customer_name' in (r ?? {})) && Object.keys(r ?? {}).join() === 'waiting,nowServing,serviceMinutes',
  Object.keys(r ?? {}).join());

ok('no page errors in the network harness', errors.length === 0, errors.join(' | '));

// ---------------------------------------------------------------- polling --
console.log('\n── polling: a hidden tab is not asked ──');
const pp = await ctx.newPage();
const pollErrors = [];
pp.on('pageerror', (e) => pollErrors.push(e.message));
await pp.goto(B + '/poll.html', { waitUntil: 'load' });
await pp.waitForFunction(() => window.poll && window.poll.settled());

const hide = (hidden) => pp.evaluate((h) => {
  Object.defineProperty(document, 'hidden', { value: h, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

await pp.evaluate(() => window.poll.reset());
await hide(true);
await pp.waitForTimeout(900);          // several intervals go by, unseen
let calls = await pp.evaluate(() => window.poll.calls);
ok('nothing was asked while the tab was hidden', calls === 0, `${calls} calls`);

console.log('\n── and it catches up the instant it is looked at ──');
await hide(false);
await pp.waitForTimeout(150);
calls = await pp.evaluate(() => window.poll.calls);
ok('becoming visible asks straight away', calls >= 1, `${calls} calls`);

console.log('\n── it really is polling, not just firing once ──');
// Without this the two checks above would both pass on a hook that never
// polls at all: zero calls while hidden, one call on the visibility event.
await pp.evaluate(() => window.poll.reset());
await pp.waitForTimeout(750);
const repeated = await pp.evaluate(() => window.poll.calls);
ok('several polls happen over three intervals', repeated >= 2, `${repeated} calls in 750ms`);

console.log('\n── two requests are never in flight at once ──');
await pp.evaluate(() => window.poll.reset());
await pp.waitForTimeout(700);
const peak = await pp.evaluate(() => window.poll.peakConcurrent);
ok('requests do happen, and never overlap', peak === 1, `peak ${peak}`);

console.log('\n── a final answer stops the polling for good ──');
await pp.evaluate(() => { window.poll.reset(); window.poll.finishNext = true; });
await pp.waitForTimeout(400);
const atFinal = await pp.evaluate(() => window.poll.calls);
ok('the final answer was actually fetched', atFinal >= 1, `${atFinal} calls`);
await pp.waitForTimeout(900);
const afterFinal = await pp.evaluate(() => window.poll.calls);
ok('and nothing was asked after it', afterFinal === atFinal, `${atFinal} → ${afterFinal}`);
await hide(true); await hide(false);
await pp.waitForTimeout(200);
ok('and looking at the tab again does not restart it',
  (await pp.evaluate(() => window.poll.calls)) === afterFinal);

ok('no page errors in the poll harness', pollErrors.length === 0, pollErrors.join(' | '));

console.log(`\n${pass} passed, ${fails.length} failed`);
await browser.close();
if (fails.length) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
