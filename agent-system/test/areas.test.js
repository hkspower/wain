'use strict';
/**
 * مناطق الكويت وقِطَعها.
 *
 * ما يستحقّ الاختبار ليس أن القائمة موجودة، بل أن النظام يرفض ما يجب رفضه:
 * منطقة من محافظة أخرى، وقطعة بلا منطقة، ورقم قطعة خارج المدى. ولأن الطلبات
 * القديمة بلا حقول مهيكلة، يجب أن يبقى النصّ الحرّ عاملًا كما كان.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-areas-'));
process.env.MAWSOOL_DATA_DIR = TMP;
process.env.MAWSOOL_DB = path.join(TMP, 'areas.db');

const { db } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { server } = require('../server/index');
const AREA = require('../server/areas');

let base;
const cookies = new Map();

async function call(as, method, p, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (as && cookies.has(as)) headers.Cookie = cookies.get(as);
  const res = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of res.headers.getSetCookie?.() || []) if (as) cookies.set(as, c.split(';')[0]);
  let data = {};
  try { data = await res.json(); } catch { /* بلا جسم */ }
  return { status: res.status, data };
}

const ORDER = {
  customer_name: 'منى الصباح', customer_phone: '+96599887766',
  pickup_address: 'عنوان حرّ للاستلام', dropoff_address: 'عنوان حرّ للتسليم',
  governorate: 'حولي', delivery_fee: 2,
};

test.before(async () => {
  db.exec('DELETE FROM events; DELETE FROM orders; DELETE FROM sessions; DELETE FROM agents;');
  db.prepare(
    `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate,
                         availability, active, approval, created_at)
     VALUES (?,?,'',?,'admin','sedan','حولي','available',1,'approved',datetime('now'))`
  ).run('سعود المدير', 'admin', hashPassword('pass1234'));

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('admin', 'POST', '/api/auth/login', { username: 'admin', password: 'pass1234' });
});

test.after(() => { server.close(); db.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

/* ------------------------------ القائمة ------------------------------ */

test('كل منطقة تنتمي إلى محافظة واحدة، ولا اسم مكرّر', () => {
  assert.equal(AREA.GOVERNORATES.length, 6);
  assert.ok(AREA.ALL_AREAS.length > 100, `عدد المناطق ${AREA.ALL_AREAS.length}`);
  assert.equal(new Set(AREA.ALL_AREAS).size, AREA.ALL_AREAS.length, 'يوجد اسم منطقة مكرّر');
  for (const g of AREA.GOVERNORATES) {
    assert.ok(AREA.AREAS[g].length > 0, `${g} بلا مناطق`);
    for (const a of AREA.AREAS[g]) assert.equal(AREA.AREA_TO_GOV[a], g);
  }
});

test('المحافظات في النظام هي نفسها في ملفّ المناطق — لا قائمتان', async () => {
  const meta = await call('admin', 'GET', '/api/meta');
  assert.deepEqual(meta.data.governorates, AREA.GOVERNORATES);
  assert.deepEqual(Object.keys(meta.data.areas), AREA.GOVERNORATES);
});

test('بناء نصّ العنوان يستعمل الأرقام العربية كبقية النظام', () => {
  assert.equal(
    AREA.composeAddress({ area: 'السالمية', block: 4, street: 'شارع سالم المبارك' }),
    'السالمية، قطعة ٤، شارع سالم المبارك'
  );
  assert.equal(AREA.composeAddress({ area: 'حولي' }), 'حولي');
});

/* ------------------------------ الرفض ------------------------------ */

test('يرفض منطقة من محافظة أخرى، ويسمّي المنطقة والمحافظة', async () => {
  const res = await call('admin', 'POST', '/api/orders', {
    ...ORDER, governorate: 'حولي', pickup_area: 'الجهراء', pickup_block: 1,
  });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /الجهراء/);
  assert.match(res.data.error, /حولي/);
});

test('يرفض قطعة بلا منطقة', async () => {
  const res = await call('admin', 'POST', '/api/orders', { ...ORDER, pickup_block: 5 });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /بلا منطقة/);
});

test('يقبل رقم القطعة مكتوبًا بالأرقام العربية كما تُكتب على لوحة عربية', async () => {
  const res = await call('admin', 'POST', '/api/orders', {
    ...ORDER, pickup_area: 'الرميثية', pickup_block: '٩',
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.order.pickup_block, '9');
  assert.equal(res.data.order.pickup_address, 'الرميثية، قطعة ٩');
});

test('يرفض رقم قطعة خارج المدى أو غير صحيح', async () => {
  for (const bad of [0, -3, 1000, 'أربعة', 2.5, '٠', '١٠٠٠']) {
    const res = await call('admin', 'POST', '/api/orders', {
      ...ORDER, pickup_area: 'السالمية', pickup_block: bad,
    });
    assert.equal(res.status, 400, `قُبلت القطعة ${bad}`);
    assert.match(res.data.error, /القطعة/);
  }
});

test('رسالة رفض القطعة بأرقام عربية كاملةً — لا «بين ١ و999»', async () => {
  const res = await call('admin', 'POST', '/api/orders', {
    ...ORDER, pickup_area: 'السالمية', pickup_block: 5000,
  });
  assert.equal(res.status, 400);
  assert.ok(!/[0-9]/.test(res.data.error), `الرسالة فيها رقم لاتيني: ${res.data.error}`);
  assert.match(res.data.error, /٩٩٩/);
});

/* ------------------------------ القبول ------------------------------ */

test('يقبل المنطقة والقطعة ويبني منهما نصّ العنوان', async () => {
  const res = await call('admin', 'POST', '/api/orders', {
    ...ORDER,
    pickup_area: 'السالمية', pickup_block: 4, pickup_street: 'شارع سالم المبارك',
    dropoff_governorate: 'العاصمة', dropoff_area: 'الشرق', dropoff_block: 7,
  });
  assert.equal(res.status, 200);
  const o = res.data.order;
  assert.equal(o.pickup_area, 'السالمية');
  assert.equal(o.pickup_block, '4');
  assert.equal(o.pickup_address, 'السالمية، قطعة ٤، شارع سالم المبارك');
  assert.equal(o.dropoff_governorate, 'العاصمة');
  assert.equal(o.dropoff_area, 'الشرق');
  assert.equal(o.dropoff_address, 'الشرق، قطعة ٧');
});

test('الطلب بلا حقول مهيكلة يبقى عاملًا بنصّه الحرّ', async () => {
  const res = await call('admin', 'POST', '/api/orders', ORDER);
  assert.equal(res.status, 200);
  assert.equal(res.data.order.pickup_address, 'عنوان حرّ للاستلام');
  assert.equal(res.data.order.pickup_area, null);
  assert.equal(res.data.order.pickup_block, null);
});

test('محافظة التسليم تُفترض محافظة الاستلام إن لم تُذكر', async () => {
  const res = await call('admin', 'POST', '/api/orders', {
    ...ORDER, governorate: 'حولي', dropoff_area: 'الرميثية',
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.order.dropoff_governorate, 'حولي');
  assert.equal(res.data.order.dropoff_area, 'الرميثية');
});
