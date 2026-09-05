'use strict';
/**
 * يتحقّق من مسار الإرسال الفعلي مقابل خادم SMTP محلي صغير.
 * بلا هذا يبقى الإرسال مسارًا غير مجرَّب: الاختبارات الأخرى تتحقّق من الصندوق
 * فقط لأن SMTP غير مضبوط فيها.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-mail-'));
process.env.MAWSOOL_DATA_DIR = TMP;
process.env.MAWSOOL_DB = path.join(TMP, 'test.db');

const { db } = require('../server/db');
const M = require('../server/mailer');

/** خادم SMTP أدنى ما يكفي لاستقبال رسالة وتسجيلها */
function smtpCatcher() {
  const received = [];
  const server = net.createServer((sock) => {
    let data = '';
    let inData = false;
    sock.write('220 test ESMTP\r\n');
    sock.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (inData) {
        data += text;
        if (data.includes('\r\n.\r\n')) {
          received.push(data.split('\r\n.\r\n')[0]);
          inData = false;
          data = '';
          sock.write('250 OK queued\r\n');
        }
        return;
      }
      for (const raw of text.split('\r\n')) {
        const cmd = raw.trim();
        if (!cmd) continue;
        const verb = cmd.split(' ')[0].toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') sock.write('250-test\r\n250 8BITMIME\r\n');
        else if (verb === 'MAIL' || verb === 'RCPT') sock.write('250 OK\r\n');
        else if (verb === 'DATA') { inData = true; sock.write('354 Send data\r\n'); }
        else if (verb === 'QUIT') { sock.write('221 Bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
    sock.on('error', () => { /* إغلاق العميل لا يهمّ الاختبار */ });
  });
  return { server, received };
}

let catcher;

test.before(async () => {
  db.exec('DELETE FROM emails; DELETE FROM orders; DELETE FROM agents;');
  catcher = smtpCatcher();
  await new Promise((r) => catcher.server.listen(0, '127.0.0.1', r));
  const port = catcher.server.address().port;
  process.env.MAWSOOL_SMTP_URL = `smtp://127.0.0.1:${port}?ignoreTLS=true`;
  process.env.MAWSOOL_MAIL_TO = 'ops@example.test';
  process.env.MAWSOOL_MAIL_FROM = 'system@example.test';
});

test.after(() => {
  catcher.server.close();
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  delete process.env.MAWSOOL_SMTP_URL;
});

test('يُعتبر الإرسال مضبوطًا عند وجود SMTP ومستلم', () => {
  assert.equal(M.isConfigured(), true);
});

test('الرسالة تُرسل فعليًا وتصل الخادم', async () => {
  const r = await M.queueAndSend({
    subject: 'موصول — اختبار', body: 'سطر عربي في المتن.\nسطر ثانٍ.',
  });
  assert.equal(r.sent, true);
  assert.equal(r.status, 'sent');

  const row = M.getEmail(r.id);
  assert.equal(row.status, 'sent');
  assert.ok(row.sent_at);
  assert.equal(row.error, '');

  await new Promise((res) => setTimeout(res, 120));
  assert.equal(catcher.received.length, 1, 'وصلت رسالة واحدة للخادم');
  const raw = catcher.received[0];
  assert.match(raw, /To: ops@example\.test/);
  assert.match(raw, /From: system@example\.test/);
});

test('الرسالة نصّية بلا أي مرفق', async () => {
  const raw = catcher.received[0];
  assert.ok(!/Content-Disposition:\s*attachment/i.test(raw), 'لا مرفقات');
  assert.ok(!/audio\//i.test(raw), 'ولا نوع صوتي');
});

test('فشل الإرسال يُسجَّل ولا يرمي', async () => {
  const good = process.env.MAWSOOL_SMTP_URL;
  process.env.MAWSOOL_SMTP_URL = 'smtp://127.0.0.1:1?connectionTimeout=200';

  const r = await M.queueAndSend({ subject: 'رسالة فاشلة', body: 'متن' });
  assert.equal(r.sent, false);
  assert.equal(r.status, 'failed');
  assert.ok(M.getEmail(r.id).error.length > 0, 'سبب الفشل محفوظ');

  process.env.MAWSOOL_SMTP_URL = good;
});

test('إعادة المحاولة ترسل ما فشل سابقًا', async () => {
  const before = catcher.received.length;
  const results = await M.retryPending();
  assert.ok(results.some((r) => r.sent), 'أُرسلت رسالة على الأقل');
  await new Promise((res) => setTimeout(res, 120));
  assert.ok(catcher.received.length > before);

  const stuck = db.prepare("SELECT COUNT(*) AS n FROM emails WHERE status <> 'sent'").get().n;
  assert.equal(stuck, 0, 'لم تبقَ رسالة عالقة');
});
