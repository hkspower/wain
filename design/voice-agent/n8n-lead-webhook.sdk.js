import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

const receiveLead = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'استقبال من الوكيل الصوتي',
    parameters: {
      httpMethod: 'POST',
      path: 'albahhar-lead',
      responseMode: 'responseNode',
    },
  },
  output: [
    {
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
          { id: 'name', name: 'name', value: expr('{{ ($json.body?.name ?? $json.name ?? "").trim() }}'), type: 'string' },
          { id: 'phone', name: 'phone', value: expr('{{ ($json.body?.phone ?? $json.phone ?? "").trim() }}'), type: 'string' },
          { id: 'project_type', name: 'project_type', value: expr('{{ ($json.body?.project_type ?? $json.project_type ?? "غير محدد").trim() }}'), type: 'string' },
          { id: 'summary', name: 'summary', value: expr('{{ ($json.body?.summary ?? $json.summary ?? "").trim() }}'), type: 'string' },
          { id: 'conversation_id', name: 'conversation_id', value: expr('{{ $json.body?.conversation_id ?? $json.conversation_id ?? "" }}'), type: 'string' },
          { id: 'received_at', name: 'received_at', value: expr('{{ $now.toISO() }}'), type: 'string' },
          { id: 'source', name: 'source', value: 'البحار — الوكيل الصوتي', type: 'string' },
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
      received_at: '2026-08-09T07:00:00.000Z',
      source: 'البحار — الوكيل الصوتي',
    },
  ],
});

const isComplete = ifElse({
  version: 2.3,
  config: {
    name: 'الاسم والهاتف موجودان؟',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        combinator: 'and',
        conditions: [
          {
            id: 'name-length',
            leftValue: expr('{{ $json.name.length }}'),
            rightValue: 2,
            operator: { type: 'number', operation: 'gte' },
          },
          {
            id: 'phone-length',
            leftValue: expr('{{ $json.phone.length }}'),
            rightValue: 6,
            operator: { type: 'number', operation: 'gte' },
          },
        ],
      },
    },
  },
});

const saveLead = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'حفظ العميل المحتمل',
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

const replySaved = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'ردّ النجاح للوكيل',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ JSON.stringify({ ok: true, message: "سجّلت طلبك يا " + $(\'توحيد الحقول\').item.json.name + "، والفريق بيتواصل معك قريباً. وتقدر تراسلنا واتساب على ٩٦٥٦٥٨٩٤١١٠+." }) }}'),
      options: { responseCode: 200 },
    },
  },
});

const replyIncomplete = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'ردّ النقص للوكيل',
    parameters: {
      respondWith: 'json',
      responseBody: expr('{{ JSON.stringify({ ok: false, message: "ما وصلني الاسم أو رقم الهاتف كاملاً — اسأل العميل مرة ثانية وأعد المحاولة." }) }}'),
      options: { responseCode: 400 },
    },
  },
});

export default workflow('albahhar-lead-webhook', 'البحار — تسجيل العملاء المحتملين')
  .add(receiveLead)
  .to(normalise)
  .to(isComplete.onTrue(saveLead.to(replySaved)).onFalse(replyIncomplete));
