'use strict';
/**
 * بيانات تجريبية للبدء السريع: مدير، خمسة مندوبين، وطلبات بحالات مختلفة.
 * التشغيل:  npm run seed          (يضيف فقط إذا كانت القاعدة فارغة)
 *           npm run reset         (يمسح كل شيء ويعيد البناء)
 */
require('./env').load();

const { db, now, logEvent, logAgentEvent } = require('./db');
const { hashPassword } = require('./auth');
const ar = require('arabic-kit');
const settings = require('./settings');

const RESET = process.argv.includes('--reset');

if (RESET) {
  db.exec(`DELETE FROM events; DELETE FROM agent_events; DELETE FROM setting_events;
           DELETE FROM settings; DELETE FROM transfers; DELETE FROM orders;
           DELETE FROM sessions; DELETE FROM agents;`);
  console.log('تم مسح البيانات السابقة.');
}

const existing = db.prepare('SELECT COUNT(*) AS n FROM agents').get().n;
if (existing > 0 && !RESET) {
  console.log(`القاعدة تحتوي على ${ar.plural(existing, 'account')} بالفعل — لم يُضف شيء. استخدم npm run reset لإعادة البناء.`);
  process.exit(0);
}

/* حالات الاعتماد الأربع ممثَّلة كلها ليمكن تجربة الشاشة فورًا.
   الممنوعون (غير مقبول / محظور) بلا طلبات لأن النظام يمنع منع حساب يحمل طلبًا نشطًا. */
const people = [
  { name: 'سعود العتيبي',   username: 'admin',  phone: '+96522220000', role: 'admin', vehicle: 'sedan',  governorate: 'العاصمة',      password: 'admin1234', approval: 'approved' },
  { name: 'أحمد الكندري',   username: 'ahmad',  phone: '+96590000001', role: 'agent', vehicle: 'sedan',  governorate: 'العاصمة',      password: 'agent1234', approval: 'approved' },
  { name: 'يوسف الرشيدي',   username: 'yousef', phone: '+96590000002', role: 'agent', vehicle: 'van',    governorate: 'حولي',         password: 'agent1234', approval: 'approved' },
  { name: 'فهد المطيري',    username: 'fahad',  phone: '+96590000003', role: 'agent', vehicle: 'reefer', governorate: 'الفروانية',    password: 'agent1234', approval: 'approved' },
  { name: 'بدر العنزي',     username: 'bader',  phone: '+96590000004', role: 'agent', vehicle: 'sedan',  governorate: 'الأحمدي',      password: 'agent1234', approval: 'under_test', note: 'انضم حديثًا — تحت التجربة لأول شهر' },
  { name: 'مشاري الشمري',   username: 'meshari',phone: '+96590000005', role: 'agent', vehicle: 'van',    governorate: 'مبارك الكبير', password: 'agent1234', approval: 'approved' },
  { name: 'ناصر الدوسري',   username: 'nasser', phone: '+96590000006', role: 'agent', vehicle: 'sedan',  governorate: 'الجهراء',      password: 'agent1234', approval: 'rejected',  note: 'لم تكتمل مستندات الرخصة المطلوبة' },
  { name: 'سالم الفضلي',    username: 'salem',  phone: '+96590000007', role: 'agent', vehicle: 'bike',   governorate: 'حولي',         password: 'agent1234', approval: 'blocked',   note: 'شكاوى تسليم متكرّرة — موقوف بانتظار التحقيق' },
];

const insertAgent = db.prepare(
  `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate,
                       availability, active, approval, approval_note, approval_at, created_at)
   VALUES (@name, @username, @phone, @hash, @role, @vehicle, @governorate,
           @availability, @active, @approval, @note, @ts, @ts)`
);

const WORKING = ['approved', 'under_test'];
const ids = {};
db.transaction(() => {
  for (const p of people) {
    const working = WORKING.includes(p.approval);
    const info = insertAgent.run({
      ...p,
      hash: hashPassword(p.password),
      note: p.note || '',
      active: working ? 1 : 0,
      availability: p.role === 'agent' && working ? 'available' : 'offline',
      ts: now(),
    });
    ids[p.username] = Number(info.lastInsertRowid);
  }
  // سجل قرار الاعتماد الأول لكل حساب حتى تظهر الشاشة بسجل حقيقي.
  // بلا `from` لأنه القرار الأول لا انتقالًا من حالة سابقة.
  for (const p of people) {
    logAgentEvent({
      agentId: ids[p.username], actorId: ids.admin,
      type: 'created', to: p.approval, note: p.note || '',
    });
  }
})();

const adminId = ids.admin;

const orders = [
  { customer_name: 'نورة العجمي',    customer_phone: '+96599110022', pickup: 'السالمية، قطعة ٤، شارع ١ — مطعم البيت الشامي', dropoff: 'الجابرية، قطعة ٧، منزل ١٢',       gov: 'حولي',         vehicle: 'sedan',  cod: 8.5,  fee: 1.5,  priority: 'urgent', status: 'on_the_way', agent: 'yousef', notes: 'الطلب ساخن — يُفضّل التسليم خلال ٢٠ دقيقة' },
  { customer_name: 'عبدالله الرشيد', customer_phone: '+96599110033', pickup: 'شرق، برج الحمرا، الدور ١٤ — مكتب محاماة',       dropoff: 'الفحيحيل، قطعة ٣، مبنى المحكمة',  gov: 'الأحمدي',      vehicle: 'sedan',  cod: 0,    fee: 2.25, priority: 'urgent', status: 'picked_up',  agent: 'bader',  notes: 'وثائق رسمية — تسليم باليد للأستاذ خالد' },
  { customer_name: 'دلال المطيري',   customer_phone: '+96599110044', pickup: 'الفروانية، قطعة ١، محل حلا بيتي',                dropoff: 'العارضية، قطعة ٥، منزل ٨',        gov: 'الفروانية',    vehicle: 'reefer', cod: 22,   fee: 2.25,  priority: 'normal', status: 'accepted',   agent: 'fahad',  notes: 'حلويات — الحفاظ على التبريد ضروري' },
  { customer_name: 'منى الصباح',     customer_phone: '+96599110055', pickup: 'القبلة، صيدلية النيل',                           dropoff: 'الدسمة، قطعة ٢، منزل ٣٠',         gov: 'العاصمة',      vehicle: 'sedan',  cod: 4.75, fee: 1.5,  priority: 'normal', status: 'assigned',   agent: 'ahmad',  notes: 'دواء يحتاج توقيع المستلم' },
  { customer_name: 'خالد الهاجري',   customer_phone: '+96599110066', pickup: 'الشويخ الصناعية، مستودع رقم ١٧',                 dropoff: 'صباح السالم، قطعة ٩، منزل ٤١',    gov: 'مبارك الكبير', vehicle: 'van',    cod: 145,  fee: 2.0,  priority: 'normal', status: 'assigned',   agent: 'meshari',notes: 'قطعتان كبيرتان — يحتاج مساعدة في التنزيل' },
  { customer_name: 'هيا العجمي',     customer_phone: '+96599110077', pickup: 'حولي، مجمع السلام، محل ورد',                     dropoff: 'بيان، قطعة ١١، منزل ٥',           gov: 'حولي',         vehicle: 'sedan',  cod: 12,   fee: 1.5,  priority: 'normal', status: 'delivered',  agent: 'yousef', notes: 'باقة ورد — تم التسليم للمستلم مباشرة' },
  { customer_name: 'سارة البحر',     customer_phone: '+96599110088', pickup: 'المهبولة، سوبرماركت المدينة',                    dropoff: 'المنقف، قطعة ٤، منزل ٢٢',         gov: 'الأحمدي',      vehicle: 'sedan',  cod: 31.25,fee: 2.25, priority: 'normal', status: 'delivered',  agent: 'bader',  notes: '' },
  { customer_name: 'محمد الفضلي',    customer_phone: '+96599110099', pickup: 'الجهراء، القصر، محل قطع غيار',                   dropoff: 'سعد العبدالله، قطعة ٣، منزل ٩',   gov: 'الجهراء',      vehicle: 'van',    cod: 68,   fee: 2.5,  priority: 'normal', status: 'new',        agent: null,     notes: 'بانتظار إسناد مندوب لمنطقة الجهراء' },
  { customer_name: 'عائشة السالم',   customer_phone: '+96599111010', pickup: 'الشامية، مخبز الصباح',                           dropoff: 'القيروان، قطعة ٢، منزل ١٧',       gov: 'العاصمة',      vehicle: 'sedan',  cod: 6,    fee: 1.5,  priority: 'normal', status: 'new',        agent: null,     notes: '' },
  { customer_name: 'طلال العنزي',    customer_phone: '+96599112020', pickup: 'مشرف، عيادة الأسنان',                            dropoff: 'سلوى، قطعة ٦، منزل ٣',            gov: 'حولي',         vehicle: 'sedan',  cod: 0,    fee: 1.5,  priority: 'normal', status: 'failed',     agent: 'ahmad',  notes: 'المستلم غير متواجد بعد انتظار ١٠ دقائق' },
];

const insertOrder = db.prepare(
  `INSERT INTO orders
    (code, customer_name, customer_phone, pickup_address, dropoff_address, governorate, vehicle,
     cod_amount, delivery_fee, priority, notes, status, agent_id, created_by, failure_reason,
     commission_type, commission_rate, commission_amount, agent_earning,
     created_at, updated_at, delivered_at)
   VALUES (@code, @customer_name, @customer_phone, @pickup, @dropoff, @gov, @vehicle,
     @cod, @fee, @priority, @notes, @status, @agent_id, @created_by, @failure_reason,
     @commission_type, @commission_rate, @commission_amount, @agent_earning,
     @created_at, @updated_at, @delivered_at)`
);

const orderIds = [];
db.transaction(() => {
  orders.forEach((o, i) => {
    const created = new Date(Date.now() - (orders.length - i) * 42 * 60_000).toISOString();
    const info = insertOrder.run({
      // نفس حساب الواجهة البرمجية، فتظهر الأرقام التجريبية بعمولة حقيقية
      ...settings.commissionFor(o.fee),
      code: 'MW-' + (4801 + i),
      customer_name: o.customer_name,
      customer_phone: o.customer_phone,
      pickup: o.pickup,
      dropoff: o.dropoff,
      gov: o.gov,
      vehicle: o.vehicle,
      cod: o.cod,
      fee: o.fee,
      priority: o.priority,
      notes: o.notes,
      status: o.status,
      agent_id: o.agent ? ids[o.agent] : null,
      created_by: adminId,
      failure_reason: o.status === 'failed' ? 'المستلم غير متواجد ولم يردّ على الاتصال' : '',
      created_at: created,
      updated_at: created,
      delivered_at: o.status === 'delivered' ? new Date().toISOString() : null,
    });
    const orderId = Number(info.lastInsertRowid);
    orderIds.push(orderId);

    logEvent({ orderId, actorId: adminId, type: 'created', to: 'MW-' + (4801 + i) });
    if (o.agent) {
      logEvent({ orderId, actorId: adminId, type: 'assigned', to: people.find((p) => p.username === o.agent).name });
    }
    if (o.status !== 'new' && o.status !== 'assigned') {
      logEvent({ orderId, actorId: ids[o.agent], type: 'status', from: 'assigned', to: o.status });
    }
  });
})();

// طلب تحويل معلّق جاهز للتجربة: أحمد يطلب تحويل طلب الصيدلية إلى يوسف
const pharmacyOrder = orderIds[3];
db.prepare(
  `INSERT INTO transfers (order_id, from_agent_id, to_agent_id, reason, status, created_at)
   VALUES (?, ?, ?, ?, 'pending', ?)`
).run(pharmacyOrder, ids.ahmad, ids.yousef, 'عندي طلب عاجل في منطقة ثانية، والعنوان أقرب لك', now());

logEvent({
  orderId: pharmacyOrder, actorId: ids.ahmad, type: 'transfer_requested',
  from: 'أحمد الكندري', to: 'يوسف الرشيدي',
  note: 'عندي طلب عاجل في منطقة ثانية، والعنوان أقرب لك',
});

console.log(`
تم إنشاء البيانات التجريبية:
  • ${ar.plural(people.length, 'account')} (مدير + ${ar.plural(people.length - 1, 'agent')})
    الاعتماد: ${ar.plural(people.filter((p) => p.approval === 'approved').length, 'account')} معتمدة · واحد تحت التجربة · واحد غير مقبول · واحد محظور
  • ${ar.plural(orders.length, 'order')} بحالات مختلفة
  • طلب تحويل معلّق واحد لتجربة القبول والرفض

بيانات الدخول:
  مدير العمليات   admin  / admin1234
  المندوبون       ahmad, yousef, fahad, bader, meshari  / agent1234

غيّر كلمات المرور هذه قبل أي استخدام حقيقي.
`);
