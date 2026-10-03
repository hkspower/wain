import { chromium } from 'playwright';

const B = process.env.WAIN_URL || 'http://127.0.0.1:4194';
const API = process.env.WAIN_API || `${B}/api/wain.php`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0;
const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`); } };

const ctx = await browser.newContext({ locale: 'ar-KW' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));

/**
 * The fake back end. Every request to `/api/` is recorded, and `plan` decides
 * what happens to each one in turn — fail in transit, stall, or answer. A plan
 * entry is consumed per request, and once the plan runs out everything
 * answers `{ok:true}`, so a test only has to describe the part it cares about.
 *
 * Answers are the real server's shapes (tests/wain-api.test.mjs proves those
 * against the PHP), so what is checked here is the client's reading of them.
 */
const seen = [];
let plan = [];
const okBody = (extra = {}) => JSON.stringify({ ok: true, ...extra });
const failBody = (error, extra = {}) => JSON.stringify({ ok: false, error, ...extra });
await p.route('**/api/**', async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  seen.push({ url: req.url(), action: u.searchParams.get('a'), method: req.method(), body: req.postData(), headers: req.headers() });
  const step = plan.shift() ?? { kind: 'ok' };
  if (step.kind === 'fail') return route.abort('failed');
  if (step.kind === 'stall') return new Promise(() => {});   // never answers
  return route.fulfill({
    status: step.status ?? 200,
    contentType: step.contentType ?? 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: step.body ?? okBody(),
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
const ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(32);

console.log('\n── one request in, one request out ──');
// deadlineFetch deliberately does not retry: what it must do is classify the
// failure, and leave repeating to a caller that knows whether that is safe.
reset([{ kind: 'fail' }]);
let r = await p.evaluate(async (u) => {
  try { await window.wain.deadlineFetch(u + '?a=ping'); return 'resolved'; }
  catch (e) { return window.wain.classifyError(e); }
}, API);
ok('a failed request is sent exactly once', seen.length === 1, `saw ${seen.length}`);
ok('and is classified as a network failure', r === 'network', String(r));

console.log('\n── a response is handed back untouched ──');
reset([{ kind: 'ok', status: 400 }]);
r = await p.evaluate(async (u) => (await window.wain.deadlineFetch(u + '?a=ping')).status, API);
ok('a 400 is returned as a 400, not thrown', r === 400, String(r));
ok('and only once', seen.length === 1, `saw ${seen.length}`);

console.log('\n── the caller can still cancel ──');
reset([{ kind: 'stall' }]);
r = await p.evaluate(async (u) => {
  const ac = new AbortController();
  const promise = window.wain.deadlineFetch(u + '?a=ping', { signal: ac.signal });
  ac.abort();
  try { await promise; return 'resolved'; }
  catch (e) { return e.name; }
}, API);
ok('an abort by the caller stays an AbortError, not a timeout', r === 'AbortError', String(r));
// Let this phase's own request be recorded before the next one clears the log.
await settle();

console.log('\n── offline is answered without touching the network ──');
reset();
await p.evaluate(() => Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }));
const startedOffline = Date.now();
r = await p.evaluate(async (u) => {
  try { await window.wain.deadlineFetch(u + '?a=ping'); return 'resolved'; }
  catch (e) { return window.wain.classifyError(e); }
}, API);
const offlineMs = Date.now() - startedOffline;
ok('it says offline, not "network"', r === 'offline', String(r));
ok('no request was put on the wire', seen.length === 0, `saw ${seen.length}: ${seen.map((x) => x.url).join(' | ')}`);
ok('and it did not wait for the deadline first', offlineMs < 12000, `${offlineMs}ms`);
await p.evaluate(() => Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }));

console.log('\n── a stalled request gives up instead of hanging forever ──');
reset([{ kind: 'stall' }]);
const startedStall = Date.now();
r = await p.evaluate(async (u) => {
  try { await window.wain.deadlineFetch(u + '?a=ping', { method: 'POST', body: '{}' }); return 'resolved'; }
  catch (e) { return window.wain.classifyError(e); }
}, API);
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
    other: d({ code: 'invalid', message: 'a rule' }, 'FALLBACK'),
  };
});
ok('offline says there is no connection', said.offline.includes('اتصال بالإنترنت'), said.offline);
ok('a timeout says it took too long', said.timeout.includes('طوّل'), said.timeout);
ok('a dropped connection is recognised from the browser wording', said.network.includes('انقطع'), said.network);
ok('a server refusal keeps the caller sentence', said.other === 'FALLBACK', said.other);

console.log('\n── call(): the shape of a request and of an answer ──');
reset([{ kind: 'ok', body: okBody({ service: 'wain-api', stage: 'production' }) }]);
r = await p.evaluate(async () => await window.wain.backend.call('ping'));
ok('a read with no body is a GET to ?a=<action>', seen[0].method === 'GET' && seen[0].action === 'ping', JSON.stringify(seen[0]));
ok('and the server\'s object comes back as it came, ok and all', r.ok === true && r.stage === 'production', JSON.stringify(r));
reset([{ kind: 'ok', status: 422, body: failBody('invalid', { field: 'customer_phone', message: 'eight digits' }) }]);
r = await p.evaluate(async () => await window.wain.backend.call('order_place', { x: 1 }));
ok('a body makes it a POST of JSON', seen[0].method === 'POST' && seen[0].headers['content-type'] === 'application/json' && JSON.parse(seen[0].body).x === 1, JSON.stringify(seen[0]));
ok('a refusal is returned, not thrown, with its field and status', r.ok === false && r.error === 'invalid' && r.field === 'customer_phone' && r.status === 422, JSON.stringify(r));
reset([{ kind: 'ok', status: 404, contentType: 'text/html', body: '<html>Not Found</html>' }]);
r = await p.evaluate(async () => await window.wain.backend.call('places'));
ok('the host\'s own 404 page reads as not_installed', r.ok === false && r.error === 'not_installed' && r.status === 404, JSON.stringify(r));
reset();
r = await p.evaluate(async () => await window.wain.backend.call('orders_list', undefined, { admin: true }));
ok('an admin call with no token stored is refused before any request', r.ok === false && r.error === 'admin_required' && seen.length === 0, JSON.stringify(r) + ` saw ${seen.length}`);
reset();
r = await p.evaluate(async () => {
  window.wain.backend.setAdminToken('secret-for-the-test');
  const res = await window.wain.backend.call('orders_list', undefined, { admin: true });
  window.wain.backend.setAdminToken(null);
  return res.ok;
});
ok('with a token the header travels and nothing else does', r === true && seen[0].headers['x-wain-admin'] === 'secret-for-the-test' && !seen[0].url.includes('secret'), JSON.stringify(seen[0]?.headers));
ok('and it is gone from the tab once cleared', (await p.evaluate(() => window.wain.backend.adminToken())) === '');
reset([{ kind: 'fail' }]);
r = await p.evaluate(async () => {
  const res = await window.wain.backend.callSafe('ping');
  return { ok: res.ok, error: res.error, message: res.message };
});
ok('callSafe turns a transport failure into a value with its sentence', r.ok === false && r.error === 'network' && /انقطع|اتصال/.test(r.message ?? ''), JSON.stringify(r));

console.log('\n── placing an order over a bad network ──');
reset([{ kind: 'fail' }]);
r = await p.evaluate(async (input) => {
  const attempt = window.wain.newOrderAttempt();
  const res = await window.wain.submitOrder(input, attempt);
  return { ok: res.ok, reference: res.reference, id: attempt.id };
}, ORDER);
ok('one dropped request does not lose the order', r.ok === true, JSON.stringify(r));
ok('it was sent again', seen.filter((s) => s.action === 'order_place').length === 2, `${seen.length} requests`);
const bodies = seen.filter((s) => s.action === 'order_place').map((s) => JSON.parse(s.body).id);
ok('and both attempts carried the same order id', bodies[0] === bodies[1] && bodies[0] === r.id, JSON.stringify(bodies));
const sent = JSON.parse(seen[0].body);
ok('the body is the server\'s own column names', sent.track_token?.length === 32 && sent.place_slug === 'deera-cafe' && sent.customer_phone === '51234567' && sent.total_fils === 500 && sent.pickup_at === '18:30', JSON.stringify(sent));

console.log('\n── the same basket sent twice is one order ──');
// The first send lands. Its reply is lost, so the customer presses again — and
// the server recognises the id and token and answers «placed, again», which is
// the proof that the order is already there.
reset([
  { kind: 'ok', body: okBody({ id: 'x', status: 'placed', again: false }) },
  { kind: 'ok', body: okBody({ id: 'x', status: 'placed', again: true }) },
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

console.log('\n── a duplicate is read as "already placed" ──');
reset([{ kind: 'ok', status: 409, body: failBody('duplicate') }]);
r = await p.evaluate(async (input) => {
  const res = await window.wain.submitOrder(input, window.wain.newOrderAttempt());
  return { ok: res.ok, reference: res.reference, reason: res.reason };
}, ORDER);
ok('a duplicate is a success, not a failure', r.ok === true, JSON.stringify(r));
ok('and it still hands back a reference to say at the counter', !!r.reference, JSON.stringify(r));

console.log('\n── a refusal is reported, and not retried ──');
reset([{ kind: 'ok', status: 422, body: failBody('invalid', { field: 'customer_phone' }) }]);
r = await p.evaluate(async (input) => {
  const res = await window.wain.submitOrder(input, window.wain.newOrderAttempt());
  return { ok: res.ok, reason: res.reason, message: res.message };
}, ORDER);
ok('a rule violation fails', r.ok === false, JSON.stringify(r));
ok('it is called invalid, not a network problem', r.reason === 'invalid', JSON.stringify(r));
ok('and the request went out exactly once', seen.filter((s) => s.action === 'order_place').length === 1, `${seen.length}`);

console.log('\n── a place that stopped taking orders, and a server that is not there ──');
reset([{ kind: 'ok', status: 409, body: failBody('closed') }]);
r = await p.evaluate(async (input) => {
  const res = await window.wain.submitOrder(input, window.wain.newOrderAttempt());
  return { ok: res.ok, reason: res.reason, message: res.message };
}, ORDER);
ok('closed is reported as disabled, with a sentence that sends them to the shop', r.ok === false && r.reason === 'disabled' && r.message.includes('اتصل'), JSON.stringify(r));
reset([{ kind: 'ok', status: 404, contentType: 'text/html', body: '<html>Not Found</html>' }]);
r = await p.evaluate(async (input) => {
  const res = await window.wain.submitOrder(input, window.wain.newOrderAttempt());
  return { ok: res.ok, reason: res.reason, message: res.message };
}, ORDER);
ok('a 404 page is a plain «not available now», not a retry storm', r.ok === false && r.message.includes('مو متاحة') && seen.length === 1, JSON.stringify(r) + ` saw ${seen.length}`);
reset([{ kind: 'ok', status: 503, body: failBody('db_unavailable') }, { kind: 'ok', body: okBody({ id: 'x', status: 'placed', again: false }) }]);
r = await p.evaluate(async (input) => {
  const res = await window.wain.submitOrder(input, window.wain.newOrderAttempt());
  return { ok: res.ok };
}, ORDER);
ok('the server unable to reach its own database IS retried — the id makes that safe', r.ok === true && seen.length === 2, `${seen.length} requests`);

console.log('\n── "cannot ask" and "not there" are different answers ──');
reset([{ kind: 'ok', body: okBody({ order: null }) }]);
r = await p.evaluate(async ([id, t]) => {
  const res = await window.wain.fetchOrderState(id, t);
  return { ok: res.ok, state: res.state };
}, [ID, TOKEN]);
ok('order:null means the order is not there', r.ok === true && r.state === null, JSON.stringify(r));
ok('the read carried the id and the token', JSON.parse(seen[0].body).token === TOKEN && JSON.parse(seen[0].body).id === ID, seen[0].body);
reset([{ kind: 'fail' }, { kind: 'fail' }, { kind: 'fail' }]);
r = await p.evaluate(async ([id, t]) => {
  const res = await window.wain.fetchOrderState(id, t);
  return { ok: res.ok, offline: res.offline };
}, [ID, TOKEN]);
ok('a failed request says so instead of claiming the order is gone', r.ok === false, JSON.stringify(r));

console.log('\n── a status read is retried, so a blip is invisible ──');
reset([{ kind: 'fail' }, { kind: 'ok', body: okBody({ order: { status: 'ready', place_slug: 'deera-cafe', place_name_ar: 'مقهى الديرة', lines: [], total_fils: 500, pickup_at: '18:30', note_ar: '', created_at: '2026-08-21T10:00:00Z', ready_at: '2026-08-21T10:20:00Z', collected_at: null, cancelled_at: null } }) }]);
r = await p.evaluate(async ([id, t]) => {
  const res = await window.wain.fetchOrderState(id, t);
  return { ok: res.ok, status: res.state?.status, readyAt: res.state?.readyAt };
}, [ID, TOKEN]);
ok('one failure then an answer still reads the order', r.ok === true && r.status === 'ready' && r.readyAt === '2026-08-21T10:20:00Z', JSON.stringify(r));

console.log('\n── calling the order off ──');
// order_cancel answers with the status the order ended up in, so the screen can
// tell "cancelled" from "too late" without a second round trip.
reset([{ kind: 'ok', body: okBody({ status: 'cancelled' }) }]);
r = await p.evaluate(async ([id, t]) => {
  const res = await window.wain.cancelOrder(id, t);
  return { ok: res.ok, reason: res.reason };
}, [ID, TOKEN]);
ok('a placed order cancels', r.ok === true, JSON.stringify(r));

reset([{ kind: 'ok', body: okBody({ status: 'ready' }) }]);
r = await p.evaluate(async ([id, t]) => {
  const res = await window.wain.cancelOrder(id, t);
  return { ok: res.ok, reason: res.reason, status: res.status, message: res.message };
}, [ID, TOKEN]);
ok('a ready order does not cancel', r.ok === false, JSON.stringify(r));
ok('and it is called too-late, not a failure', r.reason === 'too-late', JSON.stringify(r));
ok('the message sends them to the phone', r.message.includes('اتصل'), r.message);

reset([{ kind: 'ok', body: okBody({ status: 'collected' }) }]);
r = await p.evaluate(async ([id, t]) => {
  const res = await window.wain.cancelOrder(id, t);
  return { ok: res.ok, message: res.message };
}, [ID, TOKEN]);
ok('a collected order says so plainly', r.ok === false && r.message.includes('متسلّم'), JSON.stringify(r));

reset([{ kind: 'ok', body: okBody({ status: null }) }]);
r = await p.evaluate(async ([id]) => {
  const res = await window.wain.cancelOrder(id, 'f'.repeat(32));
  return { ok: res.ok, reason: res.reason };
}, [ID]);
ok('a token that matches nothing is not reported as cancelled', r.ok === false, JSON.stringify(r));
ok('it is called unknown, not a network problem', r.reason === 'unknown', JSON.stringify(r));

reset([{ kind: 'fail' }]);
r = await p.evaluate(async ([id, t]) => {
  const res = await window.wain.cancelOrder(id, t);
  return { ok: res.ok, reason: res.reason };
}, [ID, TOKEN]);
ok('a failed cancel is a network failure, not a silent success', r.ok === false && r.reason === 'network', JSON.stringify(r));
ok('and a write is not replayed on its own', seen.filter((s) => s.action === 'order_cancel').length === 1, `${seen.length}`);

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

reset([{ kind: 'ok', body: okBody({ id: 'x', number: 7, day: '2026-08-21' }) }]);
r = await p.evaluate(async (input) => {
  const res = await window.q.joinQueue(input, window.q.newQueueAttempt());
  return { ok: res.ok, number: res.number, day: res.ticket?.day };
}, JOIN);
ok('the number comes back from the server', r.ok === true && r.number === 7, JSON.stringify(r));
ok('and the ticket is stamped with the SERVER\'s day', r.day === '2026-08-21', String(r.day));
const joined = JSON.parse(seen[0].body);
ok('the body names the place, the customer and «online»', joined.place_slug === 'salon-x' && joined.customer_phone === '51234567' && joined.source === 'online' && joined.track_token.length === 32, seen[0].body);

reset([{ kind: 'ok', status: 409, body: failBody('duplicate') }]);
r = await p.evaluate(async (input) => {
  const res = await window.q.joinQueue(input, window.q.newQueueAttempt());
  return { ok: res.ok, reason: res.reason, message: res.message };
}, JOIN);
ok('a second ticket for the same phone is refused', r.ok === false, JSON.stringify(r));
ok('and it is called a duplicate, not a failure', r.reason === 'duplicate', JSON.stringify(r));
ok('the message points at the existing turn', r.message.includes('دوري'), r.message);

reset([{ kind: 'ok', status: 409, body: failBody('closed') }]);
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
  seen.filter((s) => s.action === 'queue_join').length === 1, `${seen.length}`);

console.log('\n── where am I in the line ──');
reset([{ kind: 'ok', body: okBody({ ticket: { status: 'waiting', number: 7, ahead: 3, now_serving: 4, place_slug: 'salon-x', place_name_ar: 'صالون', service_minutes: 20, day: '2026-08-21', created_at: '2026-08-21T09:00:00Z', called_at: null, served_at: null, ended_at: null } }) }]);
r = await p.evaluate(async ([id, t]) => {
  const res = await window.q.fetchTicketState(id, t);
  return { ok: res.ok, ahead: res.state?.ahead, nowServing: res.state?.nowServing, number: res.state?.number };
}, [ID, TOKEN]);
ok('the position comes through', r.ok === true && r.ahead === 3, JSON.stringify(r));
ok('so does who they are serving now', r.nowServing === 4, JSON.stringify(r));

reset([{ kind: 'ok', body: okBody({ ticket: null }) }]);
r = await p.evaluate(async ([id]) => {
  const res = await window.q.fetchTicketState(id, 'f'.repeat(32));
  return { ok: res.ok, state: res.state };
}, [ID]);
ok('a wrong token finds nothing, and says so as "not there"', r.ok === true && r.state === null, JSON.stringify(r));

reset([{ kind: 'fail' }, { kind: 'ok', body: okBody({ ticket: { status: 'called', number: 7, ahead: 0, now_serving: 7, place_slug: 'salon-x', place_name_ar: 'صالون', service_minutes: 20, day: '2026-08-21', created_at: '2026-08-21T09:00:00Z', called_at: '2026-08-21T09:40:00Z', served_at: null, ended_at: null } }) }]);
r = await p.evaluate(async ([id, t]) => {
  const res = await window.q.fetchTicketState(id, t);
  return { ok: res.ok, status: res.state?.status };
}, [ID, TOKEN]);
ok('a blip is retried away — the read is a one-row lookup',
  r.ok === true && r.status === 'called', JSON.stringify(r));

console.log('\n── giving up your place ──');
reset([{ kind: 'ok', body: okBody({ status: 'left' }) }]);
r = await p.evaluate(async ([id, t]) => {
  const res = await window.q.leaveQueue(id, t);
  return { ok: res.ok };
}, [ID, TOKEN]);
ok('a waiting turn can be given up', r.ok === true, JSON.stringify(r));

reset([{ kind: 'ok', body: okBody({ status: 'served' }) }]);
r = await p.evaluate(async ([id, t]) => {
  const res = await window.q.leaveQueue(id, t);
  return { ok: res.ok, reason: res.reason, message: res.message };
}, [ID, TOKEN]);
ok('a finished turn cannot', r.ok === false && r.reason === 'too-late', JSON.stringify(r));
ok('and it says so plainly', r.message.includes('خلص'), r.message);

reset([{ kind: 'ok', body: okBody({ status: null }) }]);
r = await p.evaluate(async ([id]) => {
  const res = await window.q.leaveQueue(id, 'f'.repeat(32));
  return { ok: res.ok, reason: res.reason };
}, [ID]);
ok('a token matching nothing is not reported as left', r.ok === false && r.reason === 'unknown', JSON.stringify(r));

console.log('\n── how busy is it, before you commit ──');
reset([{ kind: 'ok', body: okBody({ waiting: 4, now_serving: 3, service_minutes: 15 }) }]);
r = await p.evaluate(async () => await window.q.fetchQueueSize('salon-x'));
ok('the queue length is readable by anyone', r?.waiting === 4, JSON.stringify(r));
ok('with the salon\'s own service time', r?.serviceMinutes === 15, JSON.stringify(r));
ok('and nothing about the people in it',
  !('customer_name' in (r ?? {})) && Object.keys(r ?? {}).join() === 'waiting,nowServing,serviceMinutes',
  Object.keys(r ?? {}).join());
ok('asked with the slug the server expects', JSON.parse(seen[0].body).place_slug === 'salon-x', seen[0].body);

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
