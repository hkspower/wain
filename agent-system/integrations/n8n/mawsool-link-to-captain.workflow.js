/**
 * n8n — «موصول: إرسال رابط المهمّة للكابتن»
 *
 * يستقبل حدث `link.created` الذي يدفعه النظام لحظة إنشاء رابط المهمّة،
 * ويرسل الرابط للكابتن على واتساب. قبله كان المدير ينسخ الرابط ويرسله بيده
 * في أكثر لحظة استعجالًا في الطلب.
 *
 * ── الربط ───────────────────────────────────────────────────────────
 *  ١. أنشئ سير العمل من هذا الملف (SDK: create_workflow_from_code) أو
 *     استورده من واجهة n8n.
 *  ٢. عقدة «رقم المرسِل»: ضع Phone Number ID من Meta.
 *  ٣. اعتماد Header Auth في n8n: الاسم `Authorization`، والقيمة رمز عشوائي
 *     بحروف ASCII (مثال: `openssl rand -hex 24`).
 *  ٤. في النظام (.env):
 *        MAWSOOL_WEBHOOK_URL=<رابط ويبهوك n8n>
 *        MAWSOOL_WEBHOOK_AUTH_VALUE=<نفس الرمز>
 *        MAWSOOL_WEBHOOK_SECRET=<سرّ التوقيع>
 *        MAWSOOL_PUBLIC_URL=<العنوان العام للنظام>
 *
 * ── لماذا المصادقة بالترويسة لا بالتوقيع داخل n8n ──────────────────
 * التحقّق من HMAC داخل عقدة شيفرة يوجب وضع السرّ في تعريف سير العمل نصًّا
 * ظاهرًا. المصادقة بترويسة يتحقّق منها n8n نفسه تُبقي الرمز في خزنة
 * الاعتمادات. النظام يوقّع كل حدث على أي حال (`X-Mawsool-Signature`) لمن
 * أراد تحقّقًا أعمق من مجرّد هوية الطالب.
 *
 * ما تفحصه العقدة على أي حال: الطابع الزمني (يُرفض ما تجاوز خمس دقائق منعًا
 * لإعادة البثّ)، ونوع الحدث، ووجود هاتف الكابتن والرابط — فلا تُرسل رسالة
 * ناقصة ولا تُستدعى واجهة واتساب بلا مستلم.
 */
import { workflow, node, trigger, sticky, placeholder, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

const receiveEvent = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'استقبال حدث موصول',
    parameters: {
      httpMethod: 'POST',
      path: 'mawsool-link',
      authentication: 'headerAuth',
      responseMode: 'responseNode',
      // الجسم الخام يُحفظ ليبقى التحقّق من التوقيع ممكنًا بايتًا ببايت
      options: { rawBody: true },
    },
    credentials: { httpHeaderAuth: newCredential('Header Auth account') },
    position: [0, 0],
  },
  output: [{
    headers: { 'x-mawsool-event': 'link.created', 'x-mawsool-timestamp': '1755300000000' },
    body: {},
  }],
});

const settings = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'رقم المرسِل',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'phoneNumberId',
            name: 'phoneNumberId',
            value: placeholder('معرّف رقم واتساب المرسِل — Phone Number ID من Meta'),
            type: 'string',
          },
        ],
      },
    },
    position: [220, 0],
  },
  output: [{ phoneNumberId: '123456789012345' }],
});

/* المبالغ بأرقام عربية-هندية وفاصلة عشرية «٫» كبقية النظام، بينما يبقى رمز
   الطلب والهاتف والرابط لاتينيًّا لأنها معرّفات تُنسخ وتُفتح لا تُقرأ. */
const CODE = [
  "const hook = $('استقبال حدث موصول').first();",
  "const h = hook.json.headers || {};",
  "const ts = Number(h['x-mawsool-timestamp'] || 0);",
  '',
  'const rawB64 = hook.binary && hook.binary.data ? hook.binary.data.data : null;',
  "const raw = rawB64 ? Buffer.from(rawB64, 'base64').toString('utf8') : JSON.stringify(hook.json.body || {});",
  '',
  'const fail = (reason) => [{ json: { ok: false, reason } }];',
  '',
  "if (!Number.isFinite(ts) || ts <= 0) return fail('الحدث بلا طابع زمني');",
  "if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) return fail('طابع زمني خارج نافذة خمس دقائق');",
  '',
  'let payload;',
  "try { payload = JSON.parse(raw); } catch (e) { return fail('جسم الطلب ليس JSON صالحًا'); }",
  "if (payload.event !== 'link.created') return fail('حدث غير متوقّع: ' + payload.event);",
  '',
  'const d = payload.data || {};',
  'const order = d.order || {};',
  'const agent = d.agent || {};',
  'const link = d.link || {};',
  "if (!agent.phone) return fail('الكابتن بلا رقم هاتف مسجَّل');",
  "if (!link.url) return fail('الحدث بلا رابط مهمّة');",
  '',
  "const ARD = '٠١٢٣٤٥٦٧٨٩';",
  "const kd = (v) => Number(v || 0).toFixed(3).replace('.', '٫').replace(/[0-9]/g, (c) => ARD[+c]);",
  '',
  'const lines = [];',
  "lines.push('مهمّة توصيل جديدة — موصول');",
  "lines.push('');",
  "lines.push('الطلب: ' + order.code);",
  "lines.push('الاستلام: ' + order.pickup_address);",
  "lines.push('التسليم: ' + order.dropoff_address);",
  "lines.push('العميل: ' + order.customer_name + ' — ' + order.customer_phone);",
  "if (Number(order.cod_amount) > 0) lines.push('تحصيل من العميل: ' + kd(order.cod_amount) + ' د.ك');",
  "lines.push('مستحقّك على هذه المهمّة: ' + kd(order.agent_earning) + ' د.ك');",
  "if (order.notes) lines.push('ملاحظات: ' + order.notes);",
  "lines.push('');",
  "lines.push('افتح المهمّة من هنا:');",
  'lines.push(link.url);',
  '',
  'return [{ json: {',
  '  ok: true,',
  "  message: lines.join('\\n'),",
  "  phone: String(agent.phone).replace(/[^0-9+]/g, ''),",
  "  agent_name: agent.name || '',",
  '  order_code: order.code,',
  '} }];',
].join('\n');

const buildMessage = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'افحص الحدث وابنِ الرسالة',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: CODE },
    position: [440, 0],
  },
  output: [{ ok: true, message: 'نصّ الرسالة', phone: '+96590001111', agent_name: 'أحمد الكندري', order_code: 'MW-4001' }],
});

const isUsable = ifElse({
  version: 2.3,
  config: {
    name: 'الحدث صالح؟',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          { id: 'ok', leftValue: expr('{{ $json.ok }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: '' },
        ],
        combinator: 'and',
      },
    },
    position: [660, 0],
  },
});

const sendToCaptain = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'إرسال المهمّة للكابتن',
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: expr("{{ $('رقم المرسِل').item.json.phoneNumberId }}"),
      recipientPhoneNumber: expr('{{ $json.phone }}'),
      messageType: 'text',
      textBody: expr('{{ $json.message }}'),
      additionalFields: { previewUrl: true },
    },
    credentials: { whatsAppApi: newCredential('WhatsApp account') },
    onError: 'continueErrorOutput',
    position: [880, -110],
  },
  output: [{ messaging_product: 'whatsapp', messages: [{ id: 'wamid.HBg' }] }],
});

const replyDelivered = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'ردّ: وصلت الكابتن',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ JSON.stringify({ ok: true, wamid: $json.messages?.[0]?.id ?? null }) }}'),
      options: { responseCode: 200 },
    },
    position: [1100, -190],
  },
});

const replyWhatsappFailed = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'ردّ: تعذّر واتساب',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ JSON.stringify({ ok: false, stage: "whatsapp" }) }}'),
      options: { responseCode: 502 },
    },
    position: [1100, -30],
  },
});

const replyRejected = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'ردّ: حدث مرفوض',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ JSON.stringify({ ok: false, stage: "verify", reason: $json.reason }) }}'),
      options: { responseCode: 400 },
    },
    position: [880, 140],
  },
});

const note = sticky(
  '## موصول — إرسال رابط المهمّة للكابتن\n\n' +
  'يستقبل حدث link.created من نظام موصول لحظة إنشاء رابط المهمّة، ويرسل الرابط للكابتن على واتساب.\n\n' +
  'قبل التشغيل:\n' +
  '1. عقدة «رقم المرسِل»: ضع Phone Number ID من Meta.\n' +
  '2. اعتماد Header Auth: الاسم Authorization والقيمة رمز عشوائي (ASCII فقط).\n' +
  '3. في النظام: MAWSOOL_WEBHOOK_URL = رابط هذا الويبهوك، و MAWSOOL_WEBHOOK_AUTH_VALUE = نفس الرمز.\n\n' +
  'الرمز يبقى في خزنة اعتمادات n8n لا في تعريف سير العمل. وحدث أقدم من خمس دقائق يُرفض منعًا لإعادة البثّ.',
  [receiveEvent, settings, buildMessage],
  { color: 4 },
);

export default workflow('mawsool-link-to-captain', 'موصول — إرسال رابط المهمّة للكابتن')
  .add(receiveEvent)
  .to(settings)
  .to(buildMessage)
  .to(isUsable
    .onTrue(sendToCaptain.to(replyDelivered))
    .onFalse(replyRejected))
  .add(sendToCaptain.onError(replyWhatsappFailed))
  .add(note);
