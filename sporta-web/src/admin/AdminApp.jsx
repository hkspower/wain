import { useEffect, useState } from 'react'
import { useAdminMeta } from './useAdminMeta'
import ScreenHost from './ScreenHost'
import { loadScreen, warmProps } from './screens'
import { IconUsers } from './icons'
import { IconBag, IconTruck, IconStar, IconLock, IconBox, IconImage, IconHeart, IconPlus } from '../components/icons'
import { phpAdmin } from '../lib/backend'
import { useLang } from '../i18n/LanguageContext'
// Admin-only styles. Imported here so they ship with the /backends chunk and
// never reach a storefront visitor (they were global before).
import '../styles/admin.css'
import '../styles/admin-mobile.css'

// Every string the shell shows is written twice, Arabic and English, and read
// with the language the storefront chose (LanguageContext: a saved tap, then
// ?lang=, then Arabic). A visitor sees one language, never a mix.
function tx(copy, lang) {
  return copy?.[lang] ?? copy?.en ?? ''
}

const BRAND = { ar: 'إدارة سبورتا', en: 'Sporta Backends' }

const COPY = {
  loading: { ar: 'جارٍ التحميل…', en: 'Loading…' },
  checkAgain: { ar: 'تحقق مرة أخرى', en: 'Check again' },
  goLive: { ar: 'يشرح ملف GO-LIVE.md كل هذه الخطوات بالترتيب.', en: 'GO-LIVE.md walks through all of this in order.' },
  signInLead: { ar: 'سجّل الدخول بالبريد الإلكتروني وكلمة المرور الخاصين بمدير هذا المتجر.', en: 'Sign in with the admin email and password for this shop.' },
  email: { ar: 'البريد الإلكتروني', en: 'Email' },
  password: { ar: 'كلمة المرور', en: 'Password' },
  showPassword: { ar: 'إظهار كلمة المرور', en: 'Show password' },
  hidePassword: { ar: 'إخفاء كلمة المرور', en: 'Hide password' },
  signIn: { ar: 'تسجيل الدخول', en: 'Sign in' },
  signingIn: { ar: 'جارٍ تسجيل الدخول…', en: 'Signing in…' },
  lockNote: { ar: 'خمس كلمات مرور خاطئة تقفل الحساب لمدة خمس عشرة دقيقة.', en: 'Five wrong passwords lock the account for fifteen minutes.' },
  passcodeTitle: { ar: 'أدخل رمز المرور', en: 'Enter your passcode' },
  passcodeLabel: { ar: 'رمز المرور المكوّن من ستة أرقام', en: 'Six-digit passcode' },
  unlock: { ar: 'فتح', en: 'Unlock' },
  unlocking: { ar: 'جارٍ الفتح…', en: 'Unlocking…' },
  usePasswordInstead: { ar: 'استخدم كلمة المرور بدلاً من ذلك', en: 'Use my password instead' },
  signOut: { ar: 'تسجيل الخروج', en: 'Sign out' },
  thisScreen: { ar: 'هذه الشاشة', en: 'This screen' },
}

// The messages the sign-in and session can show. They are constants, not text,
// so the form can tell which one it is showing by identity (see SignIn) rather
// than by matching English words.
const MSG = {
  wrong: { ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', en: 'Wrong email or password.' },
  locked: { ar: 'محاولات كثيرة جدًا. هذا الحساب مقفل لمدة 15 دقيقة.', en: 'Too many attempts — this account is locked for 15 minutes.' },
  // A request that never completed. It used to fall into the "not on the
  // server" setup screen, which told the owner to re-upload files.
  network: {
    ar: 'تعذّر الوصول إلى الخادم. تحقق من اتصال الإنترنت ثم حاول مرة أخرى. هذا ليس خطأ في كلمة المرور.',
    en: 'Could not reach the server. Check your connection and try again. This is not your password.',
  },
  server: {
    ar: 'الخادم لم يُجب بشكل صحيح. هذا ليس خطأ في كلمة المرور. تحقق من أن إعدادات المتجر صحيحة وأن قاعدة البيانات تعمل.',
    en: 'The server failed to answer. This is not your password — check that the store config is correct and that the database is running.',
  },
  // The password was right, and the server stopped at a second step. The
  // screen does not offer that step yet, so it must say so, not "wrong password".
  secondStep: {
    ar: 'يطلب حسابك خطوة ثانية (رمز من تطبيق المصادقة). هذه الشاشة لا تدعم هذه الخطوة بعد، لذلك لا يمكن إكمال تسجيل الدخول هنا.',
    en: 'This account needs a second step, an authenticator code. This screen does not offer that step yet, so sign-in cannot be finished here.',
  },
  passwordChange: {
    ar: 'كلمة المرور المؤقتة لهذا الحساب يجب تغييرها أولًا. هذه الشاشة لا تدعم تغيير كلمة المرور بعد.',
    en: 'This account has a temporary password that must be changed first. This screen does not offer that step yet.',
  },
  signOutFailed: {
    ar: 'تعذّر تسجيل الخروج. تحقق من اتصال الإنترنت ثم حاول مرة أخرى.',
    en: 'Could not sign out. Check your connection and try again.',
  },
  passcodeWrong: { ar: 'رمز المرور غير صحيح.', en: 'That passcode is not right.' },
  passcodeLocked: { ar: 'رمز المرور خاطئ عدة مرات. سجّل الدخول بكلمة المرور.', en: 'Too many wrong passcodes. Sign in with your password.' },
  usePassword: { ar: 'سجّل الدخول بكلمة المرور من هذا المتصفح.', en: 'Sign in with your password on this browser.' },
  passcodeServer: { ar: 'لم يُجب الخادم. حاول مرة أخرى، أو سجّل الدخول بكلمة المرور.', en: 'The server failed to answer. Try again, or sign in with your password.' },
}

// The three ways the backends screen can be unreachable that are NOT a wrong
// password. Each names the one file or action that fixes it, because "check
// your configuration" is what you say when you do not know which part is
// wrong — and here the server has already told us.
//
// The store's config is NOT in the web root on the VPS (config-path.php): it is
// /docker/sporta/private/api-config.php, and the gateways read
// /docker/sporta/private/config/knet-config.php and pay-config.php.
function setupReason(status, data) {
  const token = data?.error ?? ''
  // 404 = the api/ folder never arrived. Only a 404 means "not installed". A
  // request that never completed is a dropped connection and has its own message.
  if (status === 404) {
    return {
      title: { ar: 'واجهة البرمجة غير موجودة على الخادم', en: 'The backend is not on the server' },
      lead: {
        ar: 'لا يوجد ما يستجيب على المسار /api. لم يُنشر مجلد api/ مع الموقع.',
        en: 'Nothing is answering at /api. The API was not deployed with the site.',
      },
      steps: [
        {
          ar: 'انشر مجلد api/ على الخادم (scripts/vps-deploy.mjs مع --only api، راجع GO-LIVE.md، قسم "Deploying to the VPS").',
          en: 'Deploy the api/ folder to the VPS (scripts/vps-deploy.mjs with --only api; see GO-LIVE.md, "Deploying to the VPS").',
        },
        {
          ar: 'يقرأ المتجر إعداداته من الملف /docker/sporta/private/api-config.php على الخادم. هذا الملف خارج مجلد الموقع العام ولا يُرفع إلى المستودع أبدًا.',
          en: 'The store reads its config from /docker/sporta/private/api-config.php on the VPS. It is outside the web root and is never committed.',
        },
      ],
      note: {
        ar: 'طالما أن /api غير موجود، لا يعرض المتجر أي كتالوج، ويرفض كل عملية شراء، وليس لوحة الإدارة وحدها.',
        en: 'While /api is missing the shop shows no catalogue and refuses every checkout, not just the admin.',
      },
    }
  }
  if (token === 'not_configured') {
    return {
      title: { ar: 'الواجهة الخلفية غير مُهيّأة بعد', en: 'The backend is not configured yet' },
      lead: {
        ar: 'الموقع موجود على الخادم، لكن لم يُحدَّد له بعد أي قاعدة بيانات يستخدم.',
        en: 'The site is on the server, but nothing has told it which database to use.',
      },
      steps: [
        {
          ar: 'أنشئ قاعدة بيانات MySQL ومستخدمًا لها، وامنح هذا المستخدم كل الصلاحيات (ALL PRIVILEGES) عليها.',
          en: 'Create a MySQL database and a database user, and give that user ALL PRIVILEGES on it.',
        },
        {
          ar: 'اضبط db_host و db_name و db_user و db_pass في الملف /docker/sporta/private/api-config.php، ثم اجعل الملف قابلًا للقراءة من الخادم فقط (chmod 600).',
          en: 'Set db_host, db_name, db_user and db_pass in /docker/sporta/private/api-config.php, then make that file readable by the server only (chmod 600).',
        },
      ],
      note: {
        ar: 'ملفا الإعدادات knet-config.php و pay-config.php في المجلد /docker/sporta/private/config/ يحتاجان القيم الأربع نفسها، بالأسماء mysql_host و mysql_name و mysql_user و mysql_pass. حتى يكتمل ذلك، ترفض كل عملية دفع بالبطاقة.',
        en: 'The gateway configs in /docker/sporta/private/config/ (knet-config.php and pay-config.php) need the SAME four values, spelled mysql_host / mysql_name / mysql_user / mysql_pass. Until they have them, every card payment is refused.',
      },
    }
  }
  if (token === 'no_table') {
    return {
      title: { ar: 'قاعدة البيانات فارغة', en: 'The database is empty' },
      lead: {
        ar: 'إعدادات المتجر تعمل والخادم متصل، لكن الجداول غير موجودة بعد.',
        en: 'The store config is working and the server connected — the tables just are not there yet.',
      },
      steps: [
        {
          ar: 'شغّل ملف api/install.mysql.sql مرة واحدة على قاعدة البيانات المذكورة في الإعدادات. هذا هو التثبيت الكامل في ملف واحد: كل الجداول والأعمدة والفهارس والبيانات الأولية، بالترتيب الصحيح.',
          en: 'Run api/install.mysql.sql once against the database named in the config. It is the one complete install: every table, column, index and seed, in dependency order.',
        },
      ],
      note: {
        ar: 'الملف آمن لإعادة التشغيل: ينشئ ما هو ناقص، ولا يحذف الطلبات الموجودة ولا يكتب فوقها. لا تشغّل أجزاءه واحدًا تلو الآخر.',
        en: 'The file is safe to re-run: it creates what is missing and does not delete or overwrite existing orders. Do not run its parts one by one.',
      },
    }
  }
  if (token === 'db_unreachable') {
    const cause = data?.cause
    return {
      title: { ar: 'قاعدة البيانات ترفض الاتصال', en: 'The database is refusing the connection' },
      lead: {
        ar: `إعدادات المتجر على الخادم، لكن MySQL لا يقبل ما فيها — ${cause ?? 'إحدى القيم الأربع'} غير صحيحة.`,
        en: `The store config is on the server, but MySQL will not accept what is in it — ${cause ?? 'one of the four values'} is wrong.`,
      },
      steps: [
        {
          ar: 'تحقق من اسم قاعدة البيانات واسم المستخدم كما هما على خادم قاعدة البيانات، حرفًا بحرف.',
          en: 'Check the database name and the user name exactly as the database server has them, character for character.',
        },
        {
          ar: 'اضبط كلمة مرور جديدة لهذا المستخدم، وضعها نفسها في الملف /docker/sporta/private/api-config.php باسم db_pass.',
          en: 'Set a fresh password on that user, and put the same one in /docker/sporta/private/api-config.php as db_pass.',
        },
        {
          ar: 'تأكد أن المستخدم يملك ALL PRIVILEGES على قاعدة البيانات تلك.',
          en: 'Make sure the user has ALL PRIVILEGES on that database.',
        },
        {
          ar: 'قيمة db_host هي المضيف الذي يتصل به الواجهة البرمجية: localhost عندما تعمل قاعدة البيانات على الخادم نفسه.',
          en: 'db_host is the host the API connects to: localhost when the database runs on the same server.',
        },
      ],
      note: {
        ar: 'ملفا الإعدادات في المجلد /docker/sporta/private/config/ يحملان القيم الأربع نفسها بالأسماء mysql_host و mysql_name و mysql_user و mysql_pass. إذا كانت هذه خاطئة فغالبًا تلك خاطئة أيضًا، وحتى تُصحَّح ترفض كل عملية دفع بالبطاقة.',
        en: 'The gateway configs in /docker/sporta/private/config/ carry the same four values under mysql_host / mysql_name / mysql_user / mysql_pass. If this one is wrong they usually are too, and until they are fixed every card payment is refused.',
      },
    }
  }
  if (token === 'no_admin_account') {
    return {
      title: { ar: 'لم يُنشأ تسجيل دخول بعد', en: 'No sign-in has been created yet' },
      lead: {
        ar: 'قاعدة البيانات جاهزة، لكن لا يوجد حساب لتسجيل الدخول به، لذلك لا توجد كلمة مرور يمكن أن تكون صحيحة.',
        en: 'The database is set up. There is simply nobody to sign in as — so no password can be correct.',
      },
      steps: [
        {
          ar: 'افتح الرابط https://www.sporta.com.kw/api/setup-admin.php',
          en: 'Open https://www.sporta.com.kw/api/setup-admin.php',
        },
        {
          ar: 'يطلب الصفحة المفتاح cron_key من إعدادات المتجر، ثم بريدك الإلكتروني وكلمة مرور من 12 حرفًا على الأقل.',
          en: 'It asks for the cron_key from the store config, then your email and a password of at least 12 characters.',
        },
        {
          ar: 'احذف api/setup-admin.php من الخادم بعد ذلك.',
          en: 'Delete api/setup-admin.php from the server afterwards.',
        },
      ],
      note: {
        ar: 'يعمل فقط طالما لا يوجد أي حساب، لذلك ينشئ الحساب الأول، ولا يمكنه إنشاء ثانٍ أبدًا.',
        en: 'It only works while no account exists, so it can create the first one and never a second.',
      },
    }
  }
  return null
}

// Deliberately plain: this screen is read on a phone, in hPanel, by someone who
// is mid-task and stuck.
function SetupNeeded({ title, lead, steps, note }) {
  const { lang } = useLang()
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-xl rounded-2xl border border-slate-300 bg-white p-8">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white">S</div>
          <span className="font-bold text-slate-800">{tx(BRAND, lang)}</span>
        </div>
        <h1 className="text-lg font-bold text-slate-900">{tx(title, lang)}</h1>
        <p className="mt-1.5 text-sm text-slate-600">{tx(lead, lang)}</p>
        <ol className="mt-5 space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm text-slate-700">
              <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-700">
                {i + 1}
              </span>
              <span>{tx(s, lang)}</span>
            </li>
          ))}
        </ol>
        {note && (
          <p className="mt-5 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">{tx(note, lang)}</p>
        )}
        <button
          onClick={() => window.location.reload()}
          className="mt-6 w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"
        >
          {tx(COPY.checkAgain, lang)}
        </button>
        <p className="mt-3 text-center text-sm text-slate-500">
          {tx(COPY.goLive, lang)}
        </p>
      </div>
    </div>
  )
}

// The backends screen.
//
// The session cookie is the whole story: HttpOnly, SameSite=Strict, throttled
// at the login, five failures and the account waits fifteen minutes. What used
// to sit here instead was a hosted-auth orchestration — a session, a
// per-device passcode, an idle lock, an allowlist table — three screens and
// two RPCs to decide whether to show a dashboard. One server, one session,
// one answer.
// The admin is an installable app on a phone: its own manifest (name, icons, standalone display), its own home-screen
// title, and noindex. The page's head is set for the storefront, so the admin switches it while it is open and puts the
// storefront values back when it closes. Nothing here changes what the shop serves.
function useAdminAppHead() {
  useEffect(() => {
    const restore = []
    const link = document.querySelector('link[rel="manifest"]')
    if (link) { restore.push(() => link.setAttribute('href', link.dataset.prev ?? '/site.webmanifest')); link.dataset.prev = link.getAttribute('href') ?? ''; link.setAttribute('href', '/backends.webmanifest') }
    const title = document.querySelector('meta[name="apple-mobile-web-app-title"]')
    if (title) { const prev = title.getAttribute('content'); restore.push(() => title.setAttribute('content', prev)); title.setAttribute('content', 'Sporta Admin') }
    const robots = document.querySelector('meta[name="robots"]')
    if (robots) { const prev = robots.getAttribute('content'); restore.push(() => robots.setAttribute('content', prev)); robots.setAttribute('content', 'noindex, nofollow, noarchive') }
    return () => restore.forEach((fn) => fn())
  }, [])
}

export default function AdminApp() {
  useAdminMeta()
  useAdminAppHead()
  const { lang } = useLang()
  const [session, setSession] = useState(undefined) // undefined = checking
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState(null) // one of MSG, shown above the sign-in form
  const [signOutError, setSignOutError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(null) // a SETUP step, not a bad password
  // The email of a browser that has a passcode set (device passcode, quick unlock). Null = password sign-in.
  const [passcodeFor, setPasscodeFor] = useState(null)

  // Ask, once the browser is known to be signed out, whether the last email here can unlock with a passcode.
  // The server answers "enabled" only for a browser that has signed in before (its device cookie).
  useEffect(() => {
    if (session !== null || blocked) return undefined
    const last = rememberedEmail()
    if (!last) return undefined
    let alive = true
    phpAdmin(`passcode_status&email=${encodeURIComponent(last)}`)
      .then(({ status, data }) => { if (alive && status === 200 && data?.enabled) setPasscodeFor(last) })
      .catch(() => {})
    return () => { alive = false }
  }, [session, blocked])

  // Ask the server how it is BEFORE offering a password box.
  //
  // Every setup failure used to arrive as "Wrong email or password", because
  // that was the only branch the login had. So a server with no api/config.php,
  // a database with no tables, and a genuine typo all looked identical — and
  // the one thing they have in common is that the password is fine. The owner
  // retypes it, gets the same lie back, and eventually locks the account.
  useEffect(() => {
    // Start the first tab's chunk NOW, beside the session check, instead of
    // after it. Without this the page waits for AdminApp, then for `me`, then
    // starts fetching Overview: three round trips in a row on a phone. Whether
    // or not this browser is still signed in, the next thing it shows is that
    // screen, and it is the one chunk the split must not make slower.
    loadScreen(FIRST_TAB).catch(() => {})
    phpAdmin('me')
      .then(({ status, data }) => {
        const reason = setupReason(status, data)
        if (reason) setBlocked(reason)
        // A 202 is a sign-in that stopped at a second step (a code, or a new
        // password). Say so: a bare form with no reason is what it used to show
        // after a reload in the middle of that step.
        if (status === 202) setError(data?.need_password_change ? MSG.passwordChange : MSG.secondStep)
        // ONLY a 200 is a session. This was `data ?? null`, and every error
        // response has a body — so {"error":"db_unreachable"} was truthy, the
        // app decided somebody was signed in, and rendered the whole dashboard
        // shell around the words "Cannot load the dashboard". A failure that
        // dresses itself as a working screen is worse than a blank one: there
        // is nothing on it to act on and no way back to the sign-in form.
        setSession(status === 200 ? data : null)
      })
      // A rejected fetch means the request never completed. Without this the
      // promise rejects unhandled and the screen sits on "Loading…" forever.
      // It is a dropped connection, so the sign-in form stays, with that reason.
      .catch(() => {
        setError(MSG.network)
        setSession(null)
      })
  }, [])

  async function login(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { status, data } = await phpAdmin('login', { method: 'POST', body: form })
      .catch(() => ({ status: 0, data: null }))
    const reason = setupReason(status, data)
    if (status === 200) {
      rememberEmail(form.email)
      // The password has done its job. Drop it from state, so it is not left
      // in the form for whoever uses this screen next.
      setForm((f) => ({ ...f, password: '' }))
      setSession(data)
    }
    else if (status === 202) {
      // The password was right; the server wants a second step this screen
      // does not offer. Never report that as a wrong password.
      setForm((f) => ({ ...f, password: '' }))
      setError(data?.need_password_change ? MSG.passwordChange : MSG.secondStep)
    }
    else if (reason) setBlocked(reason)
    else if (status === 429 || data?.error === 'locked') setError(MSG.locked)
    // status 0 = the request never completed. It is not a missing server and
    // not a bad password, so it gets its own message and the form stays.
    else if (status === 0) setError(MSG.network)
    else if (status >= 500) {
      // A server error is not a bad password, and saying it is costs the owner
      // five attempts and a fifteen-minute lock. Anything 5xx that setupReason
      // could not name is still the server's fault, and is reported as such.
      setError(MSG.server)
    }
    else setError(MSG.wrong)
    setBusy(false)
  }

  if (session === undefined) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">{tx(COPY.loading, lang)}</div>
  }

  if (blocked) return <SetupNeeded {...blocked} />

  if (!session) {
    return (
      <SignIn
        form={form} setForm={setForm} error={error} busy={busy} onSubmit={login}
        passcodeFor={passcodeFor}
        onUsePassword={() => { setPasscodeFor(null); setError(null) }}
        onPasscode={async (passcode) => {
          setBusy(true)
          setError(null)
          const { status, data } = await phpAdmin('passcode_login', { method: 'POST', body: { email: passcodeFor, passcode } })
            .catch(() => ({ status: 0, data: null }))
          if (status === 200) setSession(data)
          else if (status === 423 && data?.error === 'passcode_locked') {
            setPasscodeFor(null)
            setError(MSG.passcodeLocked)
          } else if (status === 423 || data?.error === 'locked') {
            setError(MSG.locked)
          } else if (status === 403) {
            setPasscodeFor(null)
            setError(MSG.usePassword)
          } else if (status === 401 || data?.error === 'wrong_passcode') {
            setError(MSG.passcodeWrong)
          } else setError(MSG.passcodeServer)
          setBusy(false)
        }}
      />
    )
  }

  return (
    <Dashboard
      email={session.email}
      signOutError={signOutError}
      onSignOut={async () => {
        setSignOutError(null)
        try {
          const { status } = await phpAdmin('logout', { method: 'POST' })
          // 200: the session is ended here and on the server. 401: it was
          // already gone. Anything else, the server may still hold a valid
          // session, so the dashboard stays and says why, instead of showing a
          // sign-in form that a reload would sign straight back in.
          if (status === 200 || status === 401) {
            setForm((f) => ({ ...f, password: '' }))
            setError(null)
            setSession(null)
          } else setSignOutError(MSG.signOutFailed)
        } catch {
          // The request never completed (no signal): nothing was ended, so the
          // dashboard stays put.
          setSignOutError(MSG.signOutFailed)
        }
      }}

      canLock={false}
    />
  )
}


// The last email signed in on THIS browser, for the passcode step. Only the address is kept (never the password), and a
// browser that blocks storage simply shows the password form.
function rememberedEmail() {
  try { return localStorage.getItem('sporta.admin.email') || null } catch { return null }
}
function rememberEmail(email) {
  try { localStorage.setItem('sporta.admin.email', String(email).trim().toLowerCase()) } catch { /* storage blocked */ }
}

// The admin has no header of its own where the storefront's language button sits,
// so the sign-in screen, the sidebar and the phone header each carry one. It is
// the same choice: a tap is stored under the key the storefront reads.
function LangToggle({ className = '' }) {
  const { lang, toggle } = useLang()
  return (
    <button
      type="button" onClick={toggle} lang={lang === 'ar' ? 'en' : 'ar'}
      className={`min-h-11 rounded-lg px-2 text-sm font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-900 focus-visible:outline-2 focus-visible:outline-indigo-600 ${className}`}
    >
      {lang === 'ar' ? 'English' : 'العربية'}
    </button>
  )
}

// The sign-in form. Behaviour is unchanged: the same request, the same setup
// gate above it. What changed is how it is read: visible labels (placeholders
// vanish once typing starts), an error that is announced to a screen reader and
// points at the field, a password show/hide control, 44px targets, and the
// email field focused on arrival. Every label and message is in both languages,
// and the direction follows the language the storefront chose. Email, password
// and passcode fields stay left-to-right whatever the language.
function SignIn({ form, setForm, error, busy, onSubmit, passcodeFor, onUsePassword, onPasscode }) {
  const { lang } = useLang()
  const [showPassword, setShowPassword] = useState(false)
  const [passcode, setPasscode] = useState('')
  if (passcodeFor) {
    // The quick unlock: the browser already knows this account, so it asks for the six-digit passcode only.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-5 py-10">
        <div className="flex w-full max-w-sm justify-end"><LangToggle /></div>
        <form onSubmit={(e) => { e.preventDefault(); if (/^\d{6}$/.test(passcode)) onPasscode(passcode) }} aria-labelledby="passcode-title" aria-busy={busy}
          className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-300 bg-white p-7 shadow-sm sm:p-8">
          <div className="text-center">
            <div aria-hidden="true" className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">S</div>
            <h1 id="passcode-title" className="text-xl font-bold text-slate-900">{tx(COPY.passcodeTitle, lang)}</h1>
            <p dir="ltr" className="mt-1 text-sm text-slate-600">{passcodeFor}</p>
          </div>
          <div role="alert" aria-live="assertive" className="empty:hidden">
            {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-800">{tx(error, lang)}</p>}
          </div>
          <div>
            <label htmlFor="admin-passcode" className="block text-sm font-bold text-slate-800">{tx(COPY.passcodeLabel, lang)}</label>
            <input
              id="admin-passcode" type="password" dir="ltr" required autoFocus inputMode="numeric" autoComplete="one-time-code"
              pattern="\d{6}" maxLength={6} aria-invalid={error === MSG.passcodeWrong || undefined}
              value={passcode} onChange={(e) => setPasscode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="mt-1.5 w-full rounded-xl border border-slate-400 bg-white px-3 py-2.5 text-center text-lg tracking-[0.4em] text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <button type="submit" disabled={busy || passcode.length !== 6}
            className="min-h-11 w-full rounded-xl bg-indigo-600 py-2.5 text-base font-bold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60">
            {busy ? tx(COPY.unlocking, lang) : tx(COPY.unlock, lang)}
          </button>
          <button type="button" onClick={onUsePassword}
            className="min-h-11 w-full rounded-lg text-sm font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-900 focus-visible:outline-2 focus-visible:outline-indigo-600">
            {tx(COPY.usePasswordInstead, lang)}
          </button>
        </form>
      </div>
    )
  }
  const credentialError = error === MSG.wrong || error === MSG.locked
  const field = 'mt-1.5 w-full rounded-xl border border-slate-400 bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 aria-[invalid=true]:border-rose-600'
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-5 py-10">
      <div className="flex w-full max-w-sm justify-end"><LangToggle /></div>
      <form onSubmit={onSubmit} aria-labelledby="sign-in-title" aria-busy={busy}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-300 bg-white p-7 shadow-sm sm:p-8">
        <div className="text-center">
          <div aria-hidden="true" className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">S</div>
          <h1 id="sign-in-title" className="text-xl font-bold text-slate-900">{tx(BRAND, lang)}</h1>
          <p className="mt-1 text-sm text-slate-600">{tx(COPY.signInLead, lang)}</p>
        </div>

        <div role="alert" aria-live="assertive" className="empty:hidden">
          {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-800">{tx(error, lang)}</p>}
        </div>

        <div>
          <label htmlFor="admin-email" className="block text-sm font-bold text-slate-800">{tx(COPY.email, lang)}</label>
          <input
            id="admin-email" type="email" dir="ltr" required autoFocus autoComplete="username" inputMode="email"
            spellCheck={false} autoCapitalize="none"
            aria-invalid={credentialError || undefined}
            value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className={field}
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="admin-password" className="block text-sm font-bold text-slate-800">{tx(COPY.password, lang)}</label>
            <button type="button" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword}
              className="min-h-11 rounded-lg px-2 text-sm font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-900 focus-visible:outline-2 focus-visible:outline-indigo-600">
              {showPassword ? tx(COPY.hidePassword, lang) : tx(COPY.showPassword, lang)}
            </button>
          </div>
          <input
            id="admin-password" type={showPassword ? 'text' : 'password'} dir="ltr" required autoComplete="current-password"
            spellCheck={false} autoCapitalize="none"
            aria-invalid={credentialError || undefined}
            value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className={field}
          />
        </div>

        <button type="submit" disabled={busy}
          className="min-h-11 w-full rounded-xl bg-indigo-600 py-2.5 text-base font-bold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60">
          {busy ? tx(COPY.signingIn, lang) : tx(COPY.signIn, lang)}
        </button>

        <p className="text-center text-sm text-slate-600">{tx(COPY.lockNote, lang)}</p>
      </form>
    </div>
  )
}

// Responsive admin: desktop sidebar (hidden < 768px) + mobile sticky header and
// bottom tab bar (.m-header / .m-tabbar from admin-mobile.css). Data tables show
// as .admin-table on desktop and .m-list/.m-row card rows on mobile.
// Emoji were replaced with the site's own SVG set: they render differently on
// every OS and cannot take the accent colour.
const ADMIN_TABS = [
  { id: 'overview', label: { ar: 'نظرة عامة', en: 'Overview' }, Icon: IconStar },
  { id: 'orders',   label: { ar: 'الطلبات', en: 'Orders' }, Icon: IconBag },
  { id: 'profiles', label: { ar: 'العملاء', en: 'Profiles' }, Icon: IconUsers },
  { id: 'catalog',  label: { ar: 'الكتالوج', en: 'Catalogue' }, Icon: IconTruck },
  { id: 'brands',   label: { ar: 'العلامات التجارية', en: 'Brands' }, Icon: IconStar },
  { id: 'slides',   label: { ar: 'الشرائح', en: 'Slides' }, Icon: IconImage },
  { id: 'promos',   label: { ar: 'العروض', en: 'Promotions' }, Icon: IconHeart },
  { id: 'discounts', label: { ar: 'الخصومات', en: 'Discounts' }, Icon: IconPlus },
  { id: 'stock',    label: { ar: 'المخزون', en: 'Inventory' }, Icon: IconBox },
  { id: 'settings', label: { ar: 'الإعدادات', en: 'Settings' }, Icon: IconLock },
]

const FIRST_TAB = 'overview'

function Dashboard({ email, onSignOut, signOutError }) {
  const { lang } = useLang()
  const [tab, setTab] = useState(FIRST_TAB)
  // Lets the Overview alerts deep-link into a filtered Orders view.
  const [orderFilter, setOrderFilter] = useState('all')
  // Every tab press starts that screen fresh. A filter from an Overview alert
  // belongs to the navigation that set it, so the sidebar must not keep it.
  const goto = (id, filter) => {
    setOrderFilter(filter ?? 'all')
    setTab(id)
  }
  const tabName = ADMIN_TABS.find((t) => t.id === tab)?.label

  return (
    <div className="admin-shell min-h-screen bg-slate-50 md:flex">
      {/* Desktop sidebar — hidden on mobile via .admin-sidebar */}
      <aside className="admin-sidebar w-60 shrink-0 border-e border-slate-300 bg-white p-4 md:min-h-screen">
        <div className="mb-6 flex items-center gap-3 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white">S</span>
          <span className="font-bold text-slate-800">{tx(BRAND, lang)}</span>
        </div>
        <nav className="flex flex-col gap-1">
          {ADMIN_TABS.map((tb) => (
            <button
              key={tb.id}
              onClick={() => goto(tb.id)}
              {...warmProps(tb.id)}
              aria-current={tab === tb.id ? 'page' : undefined}
              className={`flex min-h-11 items-center rounded-lg px-3 py-2 text-start text-sm font-semibold ${
                tab === tb.id ? 'bg-indigo-50 text-indigo-600' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <tb.Icon size={17} />
                {tx(tb.label, lang)}
              </span>
            </button>
          ))}
        </nav>
        <div className="mt-6 border-t border-slate-100 pt-4">
          {email && <p dir="ltr" className="truncate px-3 text-sm text-slate-600" title={email}>{email}</p>}
          <button onClick={onSignOut} className="mt-1 flex min-h-11 items-center rounded-lg px-3 py-2 text-start text-sm font-semibold text-slate-500 hover:text-rose-600">
            {tx(COPY.signOut, lang)}
          </button>
          <div className="mt-1 px-1"><LangToggle /></div>
        </div>
      </aside>

      {/* Mobile sticky header */}
      <header className="m-header">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">S</span>
        <span className="m-header__title min-w-0 truncate">{tx(tabName, lang)}</span>
        <LangToggle />
        <button onClick={onSignOut} className="min-h-11 px-2 text-sm font-semibold text-slate-500">{tx(COPY.signOut, lang)}</button>
      </header>

      <main className="admin-content flex-1 px-4 py-6 md:px-8 md:py-10">

        {/* A failed sign-out is said here, and the dashboard stays. */}
        {signOutError && (
          <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-800">
            {tx(signOutError, lang)}
          </p>
        )}

        {/* One screen at a time, each its own chunk (see screens.js). Orders is
            keyed by its filter so a deep link from the Overview alerts opens it
            on that filter, as it did when it was a static import. */}
        <ScreenHost
          key={tab === 'orders' ? `orders:${orderFilter}` : tab}
          id={tab}
          label={tx(tabName ?? COPY.thisScreen, lang)}
          screenProps={tab === 'overview' ? { onGoto: goto } : tab === 'orders' ? { initialPayment: orderFilter } : undefined}
        />

      </main>

      {/* Mobile bottom tab bar */}
      <nav className="m-tabbar">
        {ADMIN_TABS.map((tb) => (
          <button
            key={tb.id}
            className="m-tabbar__item"
            aria-current={tab === tb.id}
            onClick={() => goto(tb.id)}
            {...warmProps(tb.id)}
          >
            <span className="m-tabbar__icon"><tb.Icon size={20} /></span>
            {tx(tb.label, lang)}
          </button>
        ))}
      </nav>
    </div>
  )
}
