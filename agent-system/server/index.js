'use strict';
/**
 * خادم نظام موصول — HTTP بلا أطر عمل خارجية.
 * يقدّم واجهة برمجية تحت /api وملفات الواجهة من public/.
 */
require('./env').load();   // يجب أن يسبق قراءة أي متغيّر بيئة

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const { routes } = require('./api');
const auth = require('./auth');
const perms = require('./perms');

/* المجموعتان المدمجتان تُنشآن عند الإقلاع، والحسابات القائمة تُلحق بمجموعة
   دورها — فلا يتغيّر لأحد شيء بمجرّد الترقية. */
perms.ensureGroups();
const location = require('./location');
const H = require('./lib/http');

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/* ------------------------- مطابقة المسارات ------------------------- */

function compile(pattern) {
  const names = [];
  const source = pattern
    .split('/')
    .map((seg) => {
      if (!seg.startsWith(':')) return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(seg.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { re: new RegExp(`^${source}$`), names };
}

const compiled = routes.map((r) => ({ ...r, ...compile(r.pattern) }));

function match(method, pathname) {
  for (const route of compiled) {
    if (route.method !== method) continue;
    const m = route.re.exec(pathname);
    if (!m) continue;
    const params = {};
    route.names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
    return { route, params };
  }
  return null;
}

/* --------------------------- الملفات الثابتة --------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * ترويسات أمن لصفحات HTML.
 *
 * اللوحة تُحمّل ملفّاتها من أصلها وحده — لا سكربت مضمّن في الصفحة ولا مورد
 * من نطاق خارجي — فسياسة `'self'` صارمة لا تكسر شيئًا. تبقى `style-src`
 * متساهلة مع المضمّن لأن اللوحة تكتب `style="..."` في مواضع معدودة.
 *
 * `frame-ancestors 'none'` تمنع وضع اللوحة داخل إطار في صفحة أخرى، وهي
 * الحيلة التي تُخدع بها ضغطة المدير فتنفّذ إجراءً لم يقصده.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

const HTML_SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Frame-Options': 'DENY',          // للمتصفّحات التي لا تعرف frame-ancestors
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(PUBLIC_DIR, rel);

  // منع الخروج خارج مجلد public عبر مسارات مثل ../
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      /* مسار بامتداد ملف مفقود يردّ ٤٠٤ صريحًا. إعادة index.html مكانه تجعل
         ملفًّا ناقصًا يصل كصفحة HTML بحالة ٢٠٠، فيفشل بصمت ويصعب تشخيصه.
         الاحتياط للمسارات بلا امتداد فقط — وهي مسارات تطبيق الصفحة الواحدة. */
      if (path.extname(rel)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
        return;
      }
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      return fs.readFile(fallback, (e2, buf) => {
        if (e2) { res.writeHead(404).end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache',
                             ...HTML_SECURITY_HEADERS });
        res.end(buf);
      });
    }

    const ext = path.extname(target).toLowerCase();
    const immutable = ['.woff2', '.png', '.ico', '.svg', '.jpg'].includes(ext);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': immutable ? 'public, max-age=604800' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ...(ext === '.html' ? HTML_SECURITY_HEADERS : {}),
    });
    fs.createReadStream(target).pipe(res);
  });
}

/* ------------------------------ عنوان العميل ------------------------------ */

/**
 * `X-Forwarded-For` ترويسة يكتبها العميل، ولا تصير موثوقة إلا إذا كان أمام
 * النظام وسيط يعيد كتابتها. الأخذ بها بلا شرط يُفرغ حدّ محاولات الدخول من
 * معناه: مفتاح الحدّ هو «العنوان|المستخدم»، فيكفي تغيير الترويسة كل محاولة
 * ليصير لكل تخمين مفتاح جديد ولا يُحجب أبدًا — تخمين بلا سقف على حساب المدير،
 * وكل تخمين يكلّف الخادم عملية scrypt كاملة.
 *
 * لذلك لا تُقرأ إلا حين يُعلن المشغّل صراحةً أنه خلف وسيط:
 *   MAWSOOL_TRUST_PROXY=1
 * وهو ما يصفه DEPLOY.md في إعداد nginx.
 */
const TRUST_PROXY = process.env.MAWSOOL_TRUST_PROXY === '1';

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || '';
}

/* ------------------------------- الخادم ------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return H.sendJson(res, 405, { error: 'طريقة غير مدعومة' });
    }
    // ‎/l/<token> صفحة الكابتن المستقلّة — ليست جزءًا من تطبيق اللوحة
    if (pathname === '/l' || pathname.startsWith('/l/')) {
      return serveStatic(req, res, '/link.html');
    }
    return serveStatic(req, res, pathname);
  }

  const cookies = H.parseCookies(req.headers.cookie);
  const setCookies = [];

  const ctx = {
    req,
    res,
    query: Object.fromEntries(url.searchParams),
    params: {},
    body: {},
    token: cookies.mw_session || '',
    agent: null,
    ip: clientIp(req),
    setCookie: (name, value, opts) => setCookies.push(H.cookie(name, value, opts)),
  };

  try {
    const hit = match(req.method, pathname);
    if (!hit) throw H.notFound('المسار غير موجود');

    ctx.params = hit.params;

    if (hit.route.auth) {
      ctx.agent = auth.agentFromToken(ctx.token);
      if (!ctx.agent) throw H.unauthorized();
    } else if (ctx.token) {
      ctx.agent = auth.agentFromToken(ctx.token);
    }

    if (req.method !== 'GET') {
      if (hit.route.raw) {
        // رفع ثنائي (تسجيل صوتي): جسم خام بحدّ حجم خاص، بلا تحليل JSON
        ctx.rawBody = await H.readRawBody(req, hit.route.raw);
      } else {
        ctx.body = await H.readBody(req);
      }
    }

    const payload = await hit.route.handler(ctx);
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);

    // ردّ يبثّ ملفًا من القرص بدل JSON (الملاحظات الصوتية)
    if (payload && payload.__stream) {
      const file = payload.__stream;
      res.writeHead(200, {
        'Content-Type': file.mime || 'application/octet-stream',
        'Content-Length': file.bytes,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });
      return fs.createReadStream(file.path).pipe(res);
    }

    H.sendJson(res, 200, payload ?? { ok: true });
  } catch (err) {
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);

    if (err instanceof H.HttpError) {
      return H.sendJson(res, err.status, { error: err.message, code: err.code || undefined });
    }
    // قيود قاعدة البيانات تصل كأخطاء SqliteError
    if (err && String(err.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return H.sendJson(res, 409, { error: 'تعارض في البيانات، حدّث الصفحة وحاول مجددًا' });
    }
    console.error('[خطأ غير متوقع]', err);
    H.sendJson(res, 500, { error: 'حدث خطأ غير متوقع في الخادم' });
  }
});

/* تنظيف دوري كل ساعة.
   نقاط الموقع كانت تُحذف عرضًا عند فتح شاشة المتابعة فقط. مدة الحفظ وعدٌ
   للكابتن بألّا يُخزَّن مساره أكثر منها، فلا يصحّ أن يتوقّف الوفاء به على
   دخول أحد شاشةً بعينها: ليلة بلا متابعة تُبقي مسارات اليوم كلها. */
const pruner = setInterval(() => {
  try { auth.pruneSessions(); } catch (e) { console.error('فشل تنظيف الجلسات', e); }
  try { location.purgeExpired(); } catch (e) { console.error('فشل تنظيف نقاط الموقع', e); }
}, 3600_000);
pruner.unref();

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`نظام موصول يعمل على http://localhost:${PORT}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log('\nإيقاف الخادم…');
      server.close(() => process.exit(0));
    });
  }
}

module.exports = { server };
