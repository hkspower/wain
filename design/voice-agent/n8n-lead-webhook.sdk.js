// THE SAME WORKFLOW AS n8n-lead-webhook.json — and it has to be checked, not
// assumed. These two files drifted into being two different workflows while
// both claimed to be one: different names («المهلب — عملاء الوكيل الصوتي» vs
// «البحار — تسجيل العملاء المحتملين»), different webhook paths
// (almuhallab-voice-lead vs albahhar-lead), different source values, and a
// validation guard that differed in behaviour — the JSON answered 400 on a
// missing name, this file threw on `.length` of undefined and answered 500.
// Whichever you imported, you got a workflow the other file did not describe.
//
// They are reconciled here onto the JSON's identity, because the company owns
// the leads; البحار is the assistant that gathers them, and that is what the
// `source` column records.

import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

const receiveLead = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'استقبال من الوكيل الصوتي',
    parameters: {
      httpMethod: 'POST',
      path: 'almuhallab-voice-lead',
      responseMode: 'responseNode',
    },
  },
  output: [
    {
      headers: { 'x-lead-secret': 'the-value-of-ALMUHALLAB_LEAD_SECRET' },
      body: {
        name: 'عميل تجريبي',
        phone: '+96565894110',
        project_type: 'موقع',
        summary: 'متجر إلكتروني',
        conversation_id: 'conv_1',
      },
    },
  ],
});

// THE GATE. This endpoint had no authentication of any kind: anyone who knew
// the URL could write unbounded rows into the lead table. It is meant for one
// caller, the voice agent.
//
// The secret is not written here. It comes from the n8n variable
// ALMUHALLAB_LEAD_SECRET, so it never appears in an export or a version diff,
// and rotating it is a UI edit. It fails closed: an unset variable refuses
// every request rather than falling back to a default.
//
// A Code node rather than the webhook node's own header auth, deliberately:
// that would have meant writing an `authentication` parameter I could not
// verify against this instance's node definitions, and a wrong parameter name
// yields a workflow that imports and quietly authenticates nothing. This
// shape is one already running in this n8n account.
const checkSecret = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'تحقق السرّ',
    parameters: {
      jsCode: [
        "const SECRET = String(($vars && $vars.ALMUHALLAB_LEAD_SECRET) || '');",
        "if (!SECRET) throw new Error('server not configured: set the n8n variable ALMUHALLAB_LEAD_SECRET');",
        '',
        'const h = $json.headers || {};',
        "const given = String(h['x-lead-secret'] || h['X-Lead-Secret'] || '');",
        'let ok = given.length === SECRET.length;',
        'for (let i = 0; i < SECRET.length; i++) { if (given[i] !== SECRET[i]) ok = false; }',
        "if (!ok) throw new Error('unauthorized');",
        '',
        'return [{ json: $json }];',
      ].join('\n'),
    },
  },
});

// Every field is capped. Uncapped, one row carried whatever the caller sent,
// however long. And received_at is taken in UTC explicitly: $now follows the
// instance timezone, and this project's rule is that generated dates are
// computed in UTC — mixing the two is exactly the drift that rule exists for.
const normalise = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'توحيد الحقول',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'f-name', name: 'name', value: expr('{{ ($json.body?.name ?? $json.name ?? "").toString().trim().slice(0, 120) }}'), type: 'string' },
          { id: 'f-phone', name: 'phone', value: expr('{{ ($json.body?.phone ?? $json.phone ?? "").toString().trim().slice(0, 32) }}'), type: 'string' },
          { id: 'f-type', name: 'project_type', value: expr('{{ (($json.body?.project_type ?? $json.project_type ?? "").toString().trim() || "غير محدد").slice(0, 80) }}'), type: 'string' },
          { id: 'f-summary', name: 'summary', value: expr('{{ ($json.body?.summary ?? $json.summary ?? "").toString().trim().slice(0, 1200) }}'), type: 'string' },
          { id: 'f-conv', name: 'conversation_id', value: expr('{{ ($json.body?.conversation_id ?? $json.conversation_id ?? "").toString().trim().slice(0, 80) }}'), type: 'string' },
          { id: 'f-digits', name: 'phone_digits', value: expr('{{ ($json.body?.phone ?? $json.phone ?? "").toString().replace(/\\D/g, "").length }}'), type: 'number' },
          { id: 'f-at', name: 'received_at', value: expr('{{ $now.toUTC().toISO() }}'), type: 'string' },
          { id: 'f-src', name: 'source', value: 'البحار — الوكيل الصوتي', type: 'string' },
        ],
      },
    },
  },
  output: [
    {
      name: 'عميل تجريبي',
      phone: '+96565894110',
      project_type: 'موقع',
      summary: 'متجر إلكتروني',
      conversation_id: 'conv_1',
      phone_digits: 11,
      received_at: '2026-08-09T07:00:00.000Z',
      source: 'البحار — الوكيل الصوتي',
    },
  ],
});

// The phone is measured by how many digits it holds, not how long its string
// is: the previous test (length >= 6) accepted "aaaaaa" as a phone number.
// Eight is the length of a Kuwaiti number.
const isComplete = ifElse({
  version: 2.3,
  config: {
    name: 'بيانات صالحة؟',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        combinator: 'and',
        conditions: [
          {
            id: 'c-name',
            leftValue: expr('{{ ($json.name ?? "").toString().trim().length }}'),
            rightValue: 2,
            operator: { type: 'number', operation: 'gte' },
          },
          {
            id: 'c-phone',
            leftValue: expr('{{ $json.phone_digits }}'),
            rightValue: 8,
            operator: { type: 'number', operation: 'gte' },
          },
        ],
      },
    },
  },
});

// The error output is wired. A failed insert — a missing table, a full quota —
// used to end the run with a 500: the lead was gone with no record of it, and
// the agent had nothing it could say to the caller. This project has paid for
// that lesson once already ("a storage write that fails silently is data loss
// with a success message"); here it was data loss with an error code.
const saveLead = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'حفظ العميل المحتمل',
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'voice_leads' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          name: expr('{{ $json.name }}'),
          phone: expr('{{ $json.phone }}'),
          project_type: expr('{{ $json.project_type }}'),
          summary: expr('{{ $json.summary }}'),
          conversation_id: expr('{{ $json.conversation_id }}'),
          received_at: expr('{{ $json.received_at }}'),
          source: expr('{{ $json.source }}'),
        },
        matchingColumns: [],
        schema: [
          { id: 'name', displayName: 'name', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'phone', displayName: 'phone', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'project_type', displayName: 'project_type', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'summary', displayName: 'summary', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'conversation_id', displayName: 'conversation_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'received_at', displayName: 'received_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'source', displayName: 'source', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
        ],
      },
    },
  },
  output: [{ id: 1, createdAt: '2026-08-09T07:00:00.000Z', updatedAt: '2026-08-09T07:00:00.000Z' }],
});

// The name comes from «توحيد الحقول», not from $json: this node runs after the
// insert, whose output is the stored row (its id and timestamps) and not the
// lead — so $json.name here is empty, and the agent would greet nobody.
const replySaved = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'ردّ النجاح',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ JSON.stringify({ ok: true, message: "سجّلت طلبك يا " + $(\'توحيد الحقول\').item.json.name + "، وفريق المهلب يتواصل معك قريباً." }) }}'),
      options: { responseCode: 200 },
    },
  },
});

const replyUnsaved = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'ردّ تعذّر الحفظ',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ JSON.stringify({ ok: false, message: "ما قدرت أحفظ الطلب الآن. اعتذر للعميل واطلب منه مراسلتنا واتساب على +965 6589 4110." }) }}'),
      options: { responseCode: 503 },
    },
  },
});

const replyIncomplete = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'ردّ الرفض',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ JSON.stringify({ ok: false, message: "ما وصلني الاسم أو رقم الهاتف كاملاً — اسأل العميل مرّة ثانية وأعد المحاولة." }) }}'),
      options: { responseCode: 400 },
    },
  },
});

// STILL OPEN: no de-duplication. conversation_id is stored but the insert does
// not match on it, so a retry from the agent records the same lead twice —
// and ElevenLabs tools do retry. Fixing it means an upsert, and the parameter
// shape for that on the dataTable node could not be verified against this
// instance; a guessed parameter name imports cleanly and does nothing.
// NOT VALIDATED. validate_workflow and get_workflow_sdk_reference were both
// refused by this session's tool permissions, so `.onError(...)` below is the
// one construct here written from expectation rather than from the reference.
// Run validate_workflow on this file before create_workflow_from_code; if
// `.onError` is not the SDK's spelling, the rest of the chain is unaffected —
// drop that call and wire «حفظ العميل المحتمل» error output → «ردّ تعذّر
// الحفظ» by hand, exactly as n8n-lead-webhook.json already does.
//
// The JSON is the artefact to trust until then: its structure was checked
// here — every connection resolves to a node that exists, and no node is
// left unreachable.
export default workflow('almuhallab-voice-lead', 'المهلب — عملاء الوكيل الصوتي')
  .add(receiveLead)
  .to(checkSecret)
  .to(normalise)
  .to(
    isComplete
      .onTrue(saveLead.to(replySaved).onError(replyUnsaved))
      .onFalse(replyIncomplete),
  );
