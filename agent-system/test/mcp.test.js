'use strict';
/**
 * خادم MCP — يُقاس كما يستعمله عميلٌ حقيقيّ: عمليةٌ منفصلة، ومصافحةٌ على
 * stdio، ورسائل JSON-RPC سطرًا سطرًا.
 *
 * ولا يُقاس باستدعاء دوالّه من داخل العملية: أكثر ما يُخطأ فيه في خوادم
 * stdio ليس منطق الأدوات بل **القناة** — سطرٌ تشخيصيّ في stdout يُفسد
 * الرسالة التي بعده، أو ردٌّ على إشعارٍ لا ردّ له. وذلك لا يظهر إلّا
 * بتشغيل العملية والاستماع إليها.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-mcp-'));
process.env.MAWSOOL_DATA_DIR = TMP;
process.env.MAWSOOL_DB = path.join(TMP, 'test.db');

const { db } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { server } = require('../server/index');

const SERVER = path.join(__dirname, '..', 'mcp', 'server.js');
let base;
let client;

/** عميل MCP على عمليةٍ منفصلة — كما يفعل Claude */
function connect(username, password) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      MAWSOOL_MCP_URL: base,
      MAWSOOL_MCP_USERNAME: username,
      MAWSOOL_MCP_PASSWORD: password,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stray = [];                       // ما خرج في stdout وليس ردًّا
  const pending = new Map();
  let nextId = 1;
  child.stderr.resume();                  // التشخيص يُستهلك ولا يُقاس
  readline.createInterface({ input: child.stdout, terminal: false }).on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { stray.push(line.slice(0, 80)); return; }
    const resolve = pending.get(msg.id);
    if (resolve) { pending.delete(msg.id); resolve(msg); }
    else stray.push('ردٌّ بلا طلب: ' + line.slice(0, 60));
  });

  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.delete(id)) reject(new Error('لا ردّ على ' + method)); }, 20_000);
  });

  return {
    child, stray, rpc,
    notify: (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'),
    callTool: (name, args) => rpc('tools/call', { name, arguments: args || {} }),
    stop: () => child.stdin.end(),
  };
}

const textOf = (r) => (r.result?.content || []).map((c) => c.text).join('\n');
const jsonOf = (r) => { try { return JSON.parse(textOf(r)); } catch { return null; } };

test.before(async () => {
  db.exec('DELETE FROM events; DELETE FROM agent_events; DELETE FROM transfers; DELETE FROM orders; DELETE FROM sessions; DELETE FROM agents;');
  const ins = db.prepare(
    `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate, availability, active, approval, created_at)
     VALUES (?, ?, '', ?, ?, 'sedan', 'العاصمة', 'available', 1, 'approved', datetime('now'))`
  );
  ins.run('المدير', 'admin', hashPassword('pass1234'), 'admin');
  ins.run('كابتن', 'cap', hashPassword('pass1234'), 'agent');

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  client = connect('admin', 'pass1234');
});

test.after(() => {
  client?.stop();
  server.close();
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

/* ---------------------------- البروتوكول ---------------------------- */

test('المصافحة تردّ بنسخة العميل وباسم الخادم وقدراته', async () => {
  const r = await client.rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  });
  assert.equal(r.error, undefined, JSON.stringify(r.error));
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.equal(r.result.serverInfo.name, 'mawsool');
  assert.ok(r.result.capabilities.tools, 'لا يعلن أدواتٍ في capabilities');
  assert.match(r.result.instructions, /موصول/);
});

test('نسخةٌ لا يعرفها الخادم تُقابَل بأحدث ما عنده لا بخطأ', async () => {
  const r = await client.rpc('initialize', { protocolVersion: '1999-01-01', capabilities: {} });
  assert.equal(r.error, undefined);
  assert.equal(r.result.protocolVersion, '2025-06-18');
});

/* الردّ على إشعارٍ يُفسد المجرى: العميل ينتظر رسالةً بمعرّفٍ لا هذه */
test('الإشعار لا يُردّ عليه، وstdout يبقى بروتوكولًا خالصًا', async () => {
  client.notify('notifications/initialized');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(client.stray, [], 'خرج في stdout ما ليس ردًّا على طلب');
});

test('طريقة غير معروفة تردّ ‎-32601 ولا تُسقط الاتّصال', async () => {
  const r = await client.rpc('لا/توجد');
  assert.equal(r.result, undefined);
  assert.equal(r.error.code, -32601);
  const after = await client.rpc('ping');           // والاتّصال باقٍ بعدها
  assert.deepEqual(after.result, {});
});

/* ------------------------------ الأدوات ------------------------------ */

test('كل أداة معروضة بوصفٍ ومخطّط مدخلات، ولا يُسرَّب تنفيذها', async () => {
  const { result } = await client.rpc('tools/list');
  const tools = result.tools;
  assert.ok(tools.length >= 8, `أدوات قليلة: ${tools.length}`);
  const names = tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'اسمُ أداةٍ مكرَّر');
  /* ولا يُتحقَّق هنا من أنّ دالّة التنفيذ لا تُسرَّب: جُرّب فلم يسقط —
     `JSON.stringify` يُسقط الدوالّ من نفسه، فالتحقّق يقيس المُسلسِل لا
     الخادم، ولا يمكن أن يفشل. وحارسٌ لا يسقط أبدًا طمأنينةٌ كاذبة. */
  for (const t of tools) {
    assert.ok(t.description && t.description.length >= 40, `«${t.name}» وصفه أقصر من أن يُقرَّر به`);
    assert.equal(t.inputSchema?.type, 'object', `«${t.name}» بلا مخطّط مدخلات`);
  }
  /* الأدوات التي تكتب تقول ذلك في وصفها — النموذج يقرّر بالوصف */
  for (const w of ['create_order', 'price_order', 'assign_order']) {
    const t = tools.find((x) => x.name === w);
    assert.match(t.description, /يكتب/, `«${w}» لا يقول إنه يكتب`);
  }
});

test('meta تعمل بلا حساب وتعيد مناطق الكويت بمحافظاتها', async () => {
  const r = await client.callTool('meta');
  const d = jsonOf(r);
  assert.ok(d.areas, textOf(r));
  const count = Object.values(d.areas).reduce((a, list) => a + list.length, 0);
  assert.ok(count > 100, `المناطق ${count} — أقلّ ممّا يجب`);
  assert.ok(d.areas['حولي'].includes('السالمية'));
});

test('يقرأ الطلب من كلام الزبون ولا ينشئ شيئًا', async () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  const r = await client.callTool('parse_order', {
    text: 'ابغى توصيل من السالمية قطعة اربعة الى الجابرية، اسمي بدر ورقمي ٥٥٥٠١٠٢٠',
  });
  const f = jsonOf(r).fields;
  assert.equal(f.customer_name, 'بدر');
  assert.equal(f.customer_phone, '+96555501020');
  assert.equal(f.pickup_area, 'السالمية');
  assert.equal(f.pickup_block, '4');
  assert.equal(f.dropoff_area, 'الجابرية');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, before, 'القراءة أنشأت طلبًا');
});

test('ينشئ طلبًا ثم يقرؤه برمزه لا بمعرّفه وحده', async () => {
  const made = await client.callTool('create_order', {
    customer_name: 'نورة', customer_phone: '55501020', governorate: 'حولي',
    pickup_area: 'السالمية', pickup_block: '4', dropoff_area: 'الجابرية',
  });
  const code = jsonOf(made)?.order?.code;
  assert.match(String(code), /^MW-\d+$/, textOf(made));

  /* النموذج يرى الرمز في كلام الموظّف لا الرقم — فالرمز يُقبل */
  const got = await client.callTool('get_order', { order: code });
  assert.equal(jsonOf(got).order.code, code);
  assert.equal(jsonOf(got).order.customer_name, 'نورة');
});

test('خطأ الأداة يعود نتيجةً بعلامة isError لا خطأً في البروتوكول', async () => {
  /* الفرق ليس شكليًّا: خطأ البروتوكول يراه العميل عطبًا فيقطع، وخطأ
     الأداة يراه النموذج جوابًا فيصحّح ويعيد. */
  const r = await client.callTool('get_order', { order: 'MW-0000' });
  assert.equal(r.error, undefined, 'عاد خطأ بروتوكول');
  assert.equal(r.result.isError, true);
  assert.match(textOf(r), /لا طلب برمز/);

  const unknown = await client.callTool('لا_توجد');
  assert.equal(unknown.error, undefined);
  assert.equal(unknown.result.isError, true);

  /* وتحقّق الواجهة يمرّ كما هو إلى النموذج */
  const bad = await client.callTool('create_order', {
    customer_name: 'ب', customer_phone: '1', governorate: 'المريخ',
  });
  assert.equal(bad.result.isError, true);
});

/* ----------------------------- الصلاحيات ----------------------------- */

/**
 * هذا حارسُ القرار المعماريّ كلّه.
 *
 * كان أقصرَ أن يفتح خادم MCP قاعدة البيانات مباشرةً. ولو فعل لصار بابًا
 * ثانيًا للكتابة يتخطّى مصفوفة الصلاحيات — فيسعّر نموذجٌ لغويّ طلبًا بلا
 * صلاحية تسعير. فهو زبونٌ للواجهة يدخل بحساب، وهذا يثبت أثر ذلك:
 * الحساب المحدود يُمنع، **وبالمعرّف الرقميّ المباشر أيضًا** لا بحلّ الرمز
 * وحده — وهما مساران مختلفان.
 */
test('الحساب المحدود يُمنع ممّا لا يملك، ولو نادى بالمعرّف الرقميّ', async () => {
  const admin = await client.callTool('create_order', {
    customer_name: 'سالم', customer_phone: '66778899', governorate: 'حولي',
    pickup_area: 'حولي', dropoff_area: 'السالمية',
  });
  const order = jsonOf(admin).order;

  const cap = connect('cap', 'pass1234');
  try {
    await cap.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });

    const priced = await cap.callTool('price_order', { order: String(order.id), delivery_fee: 9 });
    assert.equal(priced.result.isError, true, 'الكابتن سعّر الطلب');
    assert.match(textOf(priced), /صلاحية/);

    const created = await cap.callTool('create_order', {
      customer_name: 'خالد', customer_phone: '55667788', governorate: 'حولي',
      pickup_area: 'حولي', dropoff_area: 'السالمية',
    });
    assert.equal(created.result.isError, true, 'الكابتن أنشأ طلبًا');

    const read = await cap.callTool('get_order', { order: String(order.id) });
    assert.equal(read.result.isError, true, 'الكابتن قرأ طلب غيره');

    /* وما هو مسموحٌ يبقى مسموحًا، ونطاقه طلباته وحدها */
    const listed = await cap.callTool('list_orders', { scope: 'active', limit: 50 });
    const mine = jsonOf(listed).orders;
    assert.equal(mine.some((o) => o.code === order.code), false, 'يرى طلب غيره في السرد');
    assert.ok(jsonOf(await cap.callTool('meta')).areas, 'meta محجوبة عنه');
  } finally {
    cap.stop();
  }
});
