"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import WainLogo from "@/components/WainLogo";
import { IconBack, IconCheck, IconSearch } from "@/components/icons";
import { getCategory, toArabicDigits } from "@/lib/places";
import {
  loadSupabase,
  placeToRow,
  rowToPlace,
  supabaseEnabled,
  type PlaceRow,
} from "@/lib/supabase";
import PlaceForm, { type EditablePlace } from "@/components/admin/PlaceForm";
import MediaReview from "@/components/admin/MediaReview";
import Submissions, { submissionToPlace } from "@/components/admin/Submissions";
import { discardPending, publishMedia } from "@/lib/media";
import type { SubmissionRow } from "@/lib/submissions";

type View = { mode: "list" } | { mode: "edit"; place?: EditablePlace };
type Tab = "places" | "submissions";

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<EditablePlace[]>([]);
  const [view, setView] = useState<View>({ mode: "list" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("places");
  const [pendingCount, setPendingCount] = useState(0);
  // Set while an approved submission is being reviewed in the place editor, so
  // saving the place can close the submission out in the same step. Without it
  // an approved business would sit in the queue forever, looking unhandled.
  const [approving, setApproving] = useState<SubmissionRow | null>(null);
  // Nothing is approved by default — a photo goes public because someone chose
  // it, not because nobody looked.
  const [approvedLogo, setApprovedLogo] = useState(false);
  const [approvedImages, setApprovedImages] = useState<string[]>([]);

  // ---- auth ---------------------------------------------------------------
  useEffect(() => {
    // The client is now fetched on demand, so this has to await it. The
    // subscription is captured in a ref-like local, since the cleanup runs
    // whether or not the load finished.
    let subscription: { unsubscribe: () => void } | null = null;
    let cancelled = false;
    void (async () => {
      const sb = await loadSupabase();
      if (cancelled) return;
      if (!sb) {
        setChecking(false);
        return;
      }
      const { data } = await sb.auth.getSession();
      if (cancelled) return;
      setSession(data.session);
      setChecking(false);
      subscription = sb.auth.onAuthStateChange((_e, s) => setSession(s)).data.subscription;
      if (cancelled) subscription.unsubscribe();
    })();
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  // Being signed in is not the same as being allowed to edit; the admins table
  // is the authority, and RLS enforces it server-side regardless of this check.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sb = await loadSupabase();
      if (cancelled) return;
      if (!sb || !session) {
        setIsAdmin(null);
        return;
      }
      const { data } = await sb
        .from("admins")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (!cancelled) setIsAdmin(!!data);
    })();
    return () => { cancelled = true; };
  }, [session]);

  const load = useCallback(async () => {
    const sb = await loadSupabase();
    if (!sb) return;
    const { data, error: e } = await sb
      .from("places")
      .select("*")
      .order("sort_order", { ascending: true });
    if (e) {
      setError(e.message);
      return;
    }
    setRows(
      (data as PlaceRow[]).map((r) => ({
        ...rowToPlace(r),
        id: r.id,
        published: r.published,
        sortOrder: r.sort_order,
      }))
    );
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  // ---- states before the editor -------------------------------------------
  if (!supabaseEnabled) return <NotConfigured />;
  if (checking) return <Centered>نتحقق…</Centered>;
  if (!session) return <SignIn onError={setError} error={error} />;
  if (isAdmin === null) return <Centered>نتحقق من الصلاحيات…</Centered>;
  if (isAdmin === false) return <NotAllowed email={session.user.email ?? ""} />;

  // ---- actions ------------------------------------------------------------
  async function save(p: EditablePlace) {
    const sb = await loadSupabase();
    if (!sb) return;
    setBusy(true);
    setError("");

    // Approved media is copied into the public bucket first, so the place row
    // is written with URLs that already resolve. Doing it the other way round
    // publishes a page pointing at images that are not there yet.
    let media: { logoUrl?: string; imageUrls?: string[] } = {};
    if (approving) {
      const failures: string[] = [];
      if (approvedLogo && approving.logo_path) {
        const r = await publishMedia(approving.logo_path, p.slug, "logo");
        if (r.ok) media.logoUrl = r.url;
        else failures.push(r.message);
      }
      const urls: string[] = [];
      for (let i = 0; i < approvedImages.length; i++) {
        const r = await publishMedia(approvedImages[i], p.slug, `photo-${i + 1}`);
        if (r.ok) urls.push(r.url);
        else failures.push(r.message);
      }
      if (urls.length) media.imageUrls = urls;
      if (failures.length) {
        setBusy(false);
        setError(`ما قدرنا ننشر كل الصور: ${failures[0]}`);
        return;
      }
    }

    const payload = placeToRow({ ...p, ...media });
    const res = p.id
      ? await sb.from("places").update(payload).eq("id", p.id)
      : await sb.from("places").insert(payload);
    setBusy(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    // If this save came from approving a submission, close that submission out
    // now — same click, so the queue cannot drift from reality.
    if (approving) {
      const { error: e } = await sb
        .from("submissions")
        .update({
          status: "approved",
          published_slug: p.slug,
          reviewed_at: new Date().toISOString(),
          reviewed_by: session?.user.id ?? null,
        })
        .eq("id", approving.id);

      // The private originals have served their purpose. Rejected ones go too
      // — keeping photos nobody approved is the kind of thing that quietly
      // becomes a data-protection problem.
      await discardPending(
        [approving.logo_path, ...(approving.image_paths ?? [])].filter(Boolean) as string[]
      );

      setApproving(null);
      setApprovedLogo(false);
      setApprovedImages([]);
      if (e) {
        // The place saved; only the bookkeeping failed. Say exactly that rather
        // than implying the whole thing went wrong.
        setError(`أضفنا المكان، بس ما قدرنا نقفل الطلب: ${e.message}`);
        setView({ mode: "list" });
        void load();
        return;
      }
      setNotice(`تم اعتماد «${p.nameAr}» وإضافته. الصفحة تطلع بعد النشر.`);
      setView({ mode: "list" });
      setTab("submissions");
      void load();
      return;
    }

    setNotice(p.id ? "تم الحفظ." : "تمت الإضافة. الصفحة الخاصة فيه تطلع بعد النشر.");
    setView({ mode: "list" });
    void load();
  }

  async function remove(p: EditablePlace) {
    const sb = await loadSupabase();
    if (!sb || !p.id) return;
    if (!confirm(`تبي تحذف «${p.nameAr}»؟ ما تقدر ترجعه.`)) return;
    const { error: e } = await sb.from("places").delete().eq("id", p.id);
    if (e) setError(e.message);
    else {
      setNotice("تم الحذف.");
      void load();
    }
  }

  async function togglePublished(p: EditablePlace) {
    const sb = await loadSupabase();
    if (!sb || !p.id) return;
    const { error: e } = await sb
      .from("places")
      .update({ published: !(p.published !== false) })
      .eq("id", p.id);
    if (e) setError(e.message);
    else void load();
  }

  const filtered = q.trim()
    ? rows.filter((r) => (r.nameAr + r.name + r.areaAr).includes(q.trim()))
    : rows;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <WainLogo className="size-10" />
          <div>
            <h1 className="font-display text-2xl font-bold text-ink-900">لوحة التحكّم</h1>
            <p className="text-xs text-ink-500">{session.user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="rounded-xl border border-sand-300 bg-white px-4 py-2 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
          >
            الموقع
          </Link>
          <button
            type="button"
            onClick={() => void loadSupabase().then((sb) => sb?.auth.signOut())}
            className="rounded-xl bg-ink-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-800"
          >
            خروج
          </button>
        </div>
      </header>

      {error && <Banner tone="error" onClose={() => setError("")}>{error}</Banner>}
      {notice && <Banner tone="ok" onClose={() => setNotice("")}>{notice}</Banner>}

      {view.mode !== "edit" && (
        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="أقسام اللوحة">
          {([["places", "الأماكن"], ["submissions", "طلبات التسجيل"]] as const).map(([id, text]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition ${
                tab === id
                  ? "bg-ink-900 text-white"
                  : "border border-sand-200 bg-white text-ink-600 hover:border-sea-300"
              }`}
            >
              {text}
              {id === "submissions" && pendingCount > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  tab === id ? "bg-white/20 text-white" : "bg-sun-100 text-sun-900"
                }`}>
                  {toArabicDigits(pendingCount)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {view.mode === "edit" ? (
        <section className="rounded-3xl border border-sand-200 bg-white p-6 shadow-sm">
          <button
            type="button"
            onClick={() => { setApproving(null); setView({ mode: "list" }); }}
            className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-ink-600 transition hover:text-coral-700"
          >
            <IconBack className="size-4" />
            رجوع للقائمة
          </button>
          {approving && (
            <>
              <p className="mb-4 rounded-2xl bg-sun-50 px-4 py-3 text-sm text-sun-900">
                مراجعة طلب من <strong>{approving.contact_name}</strong> (
                <span dir="ltr">{approving.contact_email}</span>). عبّي التقييم
                والرابط، وبعد الحفظ ينقفل الطلب تلقائياً.
              </p>
              {(approving.logo_path || approving.image_paths?.length > 0) && (
                <div className="mb-5 rounded-2xl border border-sand-200 bg-sand-100/60 p-4">
                  <MediaReview
                    logoPath={approving.logo_path}
                    imagePaths={approving.image_paths ?? []}
                    selected={approvedImages}
                    onSelected={setApprovedImages}
                    logoApproved={approvedLogo}
                    onLogoApproved={setApprovedLogo}
                  />
                </div>
              )}
            </>
          )}
          <h2 className="mb-5 font-display text-xl font-semibold text-ink-900">
            {approving
              ? `اعتماد: ${approving.name_ar}`
              : view.place ? `تعديل: ${view.place.nameAr}` : "إضافة مكان جديد"}
          </h2>
          <PlaceForm
            initial={view.place}
            busy={busy}
            onSave={save}
            onCancel={() => { setApproving(null); setView({ mode: "list" }); }}
          />
        </section>
      ) : tab === "submissions" ? (
        <Submissions
          onCountChange={setPendingCount}
          onApprove={(s) => {
            setApproving(s);
            setView({ mode: "edit", place: submissionToPlace(s) });
          }}
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1">
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-500">
                <IconSearch className="size-4" />
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="ابحث في الأماكن"
                placeholder="ابحث…"
                className="w-full rounded-xl border border-sand-200 bg-white py-2.5 pe-3 ps-10 text-sm outline-none focus:border-sea-400 focus:ring-4 focus:ring-sea-100"
              />
            </div>
            <button
              type="button"
              onClick={() => setView({ mode: "edit" })}
              className="rounded-xl bg-coral-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-coral-700"
            >
              + مكان جديد
            </button>
          </div>

          <p className="mb-3 text-sm text-ink-500">
            {toArabicDigits(filtered.length)} من {toArabicDigits(rows.length)}
          </p>

          <ul className="space-y-2">
            {filtered.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-sand-200 bg-white p-3 shadow-sm"
              >
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-sand-100 text-xl">
                  {p.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink-900">{p.nameAr}</span>
                  <span className="block truncate text-xs text-ink-500">
                    {getCategory(p.category)?.ar} · {p.areaAr}
                  </span>
                </span>
                {p.featured && (
                  <span className="rounded-full bg-sun-100 px-2.5 py-1 text-[11px] font-semibold text-sun-800">مميّز</span>
                )}
                <button
                  type="button"
                  onClick={() => togglePublished(p)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                    p.published !== false
                      ? "bg-palm-500/15 text-palm-700 hover:bg-palm-500/25"
                      : "bg-sand-200 text-ink-600 hover:bg-sand-300"
                  }`}
                >
                  {p.published !== false ? "منشور" : "مخفي"}
                </button>
                <button
                  type="button"
                  onClick={() => setView({ mode: "edit", place: p })}
                  className="rounded-lg border border-sand-300 px-3 py-1.5 text-xs font-semibold text-ink-700 transition hover:border-sea-300"
                >
                  تعديل
                </button>
                <button
                  type="button"
                  onClick={() => remove(p)}
                  className="rounded-lg border border-coral-200 px-3 py-1.5 text-xs font-semibold text-coral-700 transition hover:bg-coral-50"
                >
                  حذف
                </button>
              </li>
            ))}
          </ul>

          {rows.length > 0 && (
            <p className="mt-6 rounded-2xl bg-sand-100 p-4 text-xs leading-relaxed text-ink-600">
              التعديلات على الأماكن الموجودة تظهر في الموقع مباشرة. أما المكان
              <strong className="text-ink-900"> الجديد </strong>
              فصفحته الخاصة تتولّد وقت البناء، فتحتاج نشر جديد عشان يفتح رابطه.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- small states ---------- */

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 text-sm font-semibold text-ink-500">
      {children}
    </div>
  );
}

function Banner({
  tone,
  children,
  onClose,
}: {
  tone: "error" | "ok";
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className={`mb-5 flex items-start gap-3 rounded-2xl border p-4 text-sm ${
        tone === "error"
          ? "border-coral-200 bg-coral-50 text-coral-800"
          : "border-palm-500/30 bg-palm-500/10 text-palm-800"
      }`}
    >
      {tone === "ok" && <IconCheck className="mt-0.5 size-4 shrink-0" />}
      <span className="flex-1">{children}</span>
      <button type="button" onClick={onClose} aria-label="إغلاق" className="font-bold">
        ×
      </button>
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20">
      <h1 className="font-display text-2xl font-bold text-ink-900">لوحة التحكّم غير مفعّلة</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">
        ما فيه إعداد لقاعدة البيانات في هذا البناء. الموقع يشتغل عادي من بياناته
        المدمجة، بس التحرير محتاج ربط Supabase.
      </p>
      <ol className="mt-5 space-y-2 text-sm leading-relaxed text-ink-600">
        <li>١. سوِّ مشروع في Supabase.</li>
        <li>٢. شغّل <code className="rounded bg-sand-100 px-1.5 py-0.5" dir="ltr">supabase/schema.sql</code> في محرّر SQL.</li>
        <li>
          ٣. حط{" "}
          <code className="rounded bg-sand-100 px-1.5 py-0.5" dir="ltr">NEXT_PUBLIC_SUPABASE_URL</code> و{" "}
          <code className="rounded bg-sand-100 px-1.5 py-0.5" dir="ltr">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
          ثم أعد البناء.
        </li>
      </ol>
      <p className="mt-5 text-sm text-ink-500">
        التفاصيل الكاملة في <code dir="ltr">docs/admin-setup.md</code>.
      </p>
    </div>
  );
}

function NotAllowed({ email }: { email: string }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <h1 className="font-display text-2xl font-bold text-ink-900">ما عندك صلاحية</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">
        دخلت باسم <strong dir="ltr">{email}</strong>، بس هذا الحساب مو مضاف في
        جدول <code dir="ltr">admins</code>.
      </p>
      <button
        type="button"
        onClick={() => void loadSupabase().then((sb) => sb?.auth.signOut())}
        className="mt-6 rounded-xl bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white"
      >
        خروج
      </button>
    </div>
  );
}

function SignIn({ error, onError }: { error: string; onError: (s: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const sb = await loadSupabase();
    if (!sb) return;
    setBusy(true);
    onError("");
    const { error: err } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) onError(err.message);
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <WainLogo className="size-14" />
        <h1 className="font-display text-2xl font-bold text-ink-900">لوحة التحكّم</h1>
      </div>
      <form onSubmit={submit} className="space-y-4 rounded-3xl border border-sand-200 bg-white p-6 shadow-sm">
        {error && (
          <p className="rounded-xl border border-coral-200 bg-coral-50 p-3 text-sm text-coral-800">{error}</p>
        )}
        <div>
          <label className="block text-sm font-semibold text-ink-800" htmlFor="a-email">البريد</label>
          <input
            id="a-email"
            type="email"
            dir="ltr"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-sea-400 focus:ring-4 focus:ring-sea-100"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-ink-800" htmlFor="a-pass">كلمة السر</label>
          <input
            id="a-pass"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-sea-400 focus:ring-4 focus:ring-sea-100"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:opacity-60"
        >
          {busy ? "ندخّلك…" : "دخول"}
        </button>
      </form>
    </div>
  );
}
