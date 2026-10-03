"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import WainLogo from "@/components/WainLogo";
import { IconBack, IconCheck, IconSearch } from "@/components/icons";
import { getCategory, toArabicDigits } from "@/lib/place-kit";
import {
  adminToken,
  backendEnabled,
  callSafe,
  describeApiFailure,
  setAdminToken,
} from "@/lib/backend";
import { placeToRow, rowToPlace, type PlaceRow } from "@/lib/place-rows";
import { useLatestRequest } from "@/lib/useLatest";
import PlaceForm, { type EditablePlace } from "@/components/admin/PlaceForm";
import MediaReview from "@/components/admin/MediaReview";
import Orders from "@/components/admin/Orders";
import Queue from "@/components/admin/Queue";
import Submissions, { submissionToPlace } from "@/components/admin/Submissions";
import { discardPending, publishMedia } from "@/lib/media";
import type { SubmissionRow } from "@/lib/submissions";

type View = { mode: "list" } | { mode: "edit"; place?: EditablePlace };
type Tab = "places" | "submissions" | "orders" | "queue";

/**
 * What stands between the page and the board, in the order it is found out.
 *
 *   checking    — asking the server about itself (`ping`)
 *   unreachable — nothing answered, or not with the API's JSON
 *   unset       — the server has no admin secret yet; a password cannot work
 *   signin      — a secret exists and this tab has none, or a wrong one
 *   ready       — `whoami` answered with the stored token
 *
 * «unset» is its own state on purpose: a sign-in form in front of a server that
 * would refuse every password is the kind of door this file keeps meeting
 * (a key file created empty, a variable nobody filled), and the honest answer
 * is to say which file to fill rather than to let the owner try passwords.
 */
type Gate = "checking" | "unreachable" | "unset" | "signin" | "ready";

export default function AdminApp() {
  const [gate, setGate] = useState<Gate>("checking");
  const [stage, setStage] = useState("");
  const [rows, setRows] = useState<EditablePlace[]>([]);
  const [view, setView] = useState<View>({ mode: "list" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("places");
  const [openOrders, setOpenOrders] = useState(0);
  const [waitingInQueue, setWaitingInQueue] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const { run } = useLatestRequest();
  // Set while an approved submission is being reviewed in the place editor, so
  // saving the place can close the submission out in the same step. Without it
  // an approved business would sit in the queue forever, looking unhandled.
  const [approving, setApproving] = useState<SubmissionRow | null>(null);
  // Nothing is approved by default — a photo goes public because someone chose
  // it, not because nobody looked.
  const [approvedLogo, setApprovedLogo] = useState(false);
  const [approvedImages, setApprovedImages] = useState<string[]>([]);

  // ---- the gate ------------------------------------------------------------
  useEffect(() => {
    if (!backendEnabled) return;
    let cancelled = false;
    void (async () => {
      const ping = await callSafe<{ stage: string; admin: "set" | "unset" }>("ping");
      if (cancelled) return;
      if (!ping.ok) {
        setError(describeApiFailure(ping, "ما قدرنا نوصل للسيرفر."));
        setGate("unreachable");
        return;
      }
      setStage(ping.stage);
      if (ping.admin === "unset") return setGate("unset");
      if (!adminToken()) return setGate("signin");
      // A token from an earlier visit in this tab: still good, or thrown away.
      const who = await callSafe("whoami", undefined, { admin: true });
      if (cancelled) return;
      if (who.ok) return setGate("ready");
      setAdminToken(null);
      setGate("signin");
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    await run(
      (signal) => callSafe<{ places: PlaceRow[] }>("places_all", undefined, { admin: true, signal }),
      (result) => {
        if (!result.ok) {
          setError(describeApiFailure(result, "ما قدرنا نقرأ الأماكن."));
          return;
        }
        setError("");
        setRows(
          result.places.map((r) => ({
            ...rowToPlace(r),
            id: r.id,
            published: r.published,
            sortOrder: r.sort_order,
          }))
        );
      }
    );
  }, [run]);

  useEffect(() => {
    if (gate === "ready") void load();
  }, [gate, load]);

  async function signIn(secret: string) {
    setAdminToken(secret.trim());
    const who = await callSafe("whoami", undefined, { admin: true });
    if (who.ok) {
      setError("");
      setGate("ready");
      return;
    }
    setAdminToken(null);
    setError(describeApiFailure(who, "ما قدرنا ندخّلك."));
  }

  function signOut() {
    setAdminToken(null);
    setRows([]);
    setView({ mode: "list" });
    setGate("signin");
  }

  // ---- states before the editor -------------------------------------------
  if (!backendEnabled) return <NotConfigured />;
  if (gate === "checking") return <Centered>نتحقق…</Centered>;
  if (gate === "unreachable") return <Unreachable message={error} />;
  if (gate === "unset") return <SecretUnset />;
  if (gate === "signin") return <SignIn onSubmit={signIn} error={error} />;

  // ---- actions ------------------------------------------------------------
  async function save(p: EditablePlace) {
    setBusy(true);
    setError("");

    // Approved media is published first, so the place row is written with
    // URLs that already resolve. Doing it the other way round publishes a page
    // pointing at images that are not there yet.
    const media: { logoUrl?: string; imageUrls?: string[] } = {};
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
    const res = await callSafe<{ place: PlaceRow }>(
      "place_save",
      { id: p.id ?? null, place: payload },
      { admin: true }
    );
    setBusy(false);
    if (!res.ok) {
      setError(
        res.error === "duplicate"
          ? "الرابط (slug) مستخدم لمكان ثاني. غيّره."
          : res.error === "invalid"
            ? `في حقل مو مضبوط${res.field ? ` (${res.field})` : ""}: ${res.message ?? ""}`
            : describeApiFailure(res, "ما قدرنا نحفظ المكان.")
      );
      return;
    }
    // If this save came from approving a submission, close that submission out
    // now — same click, so the queue cannot drift from reality.
    if (approving) {
      const e = await callSafe(
        "submission_approve",
        { id: approving.id, published_slug: p.slug },
        { admin: true }
      );

      // The private originals have served their purpose. Rejected ones go too
      // — keeping photos nobody approved is the kind of thing that quietly
      // becomes a data-protection problem.
      await discardPending(
        [approving.logo_path, ...(approving.image_paths ?? [])].filter(Boolean) as string[]
      );

      setApproving(null);
      setApprovedLogo(false);
      setApprovedImages([]);
      if (!e.ok) {
        // The place saved; only the bookkeeping failed. Say exactly that rather
        // than implying the whole thing went wrong.
        setError(`أضفنا المكان، بس ما قدرنا نقفل الطلب: ${describeApiFailure(e, e.error)}`);
        setView({ mode: "list" });
        void load();
        return;
      }
      setNotice(`اعتمدنا «${p.nameAr}» وأضفناه. صفحته تطلع بعد النشر.`);
      setView({ mode: "list" });
      setTab("submissions");
      void load();
      return;
    }

    setNotice(p.id ? "حفظناه." : "أضفناه. صفحته تطلع بعد النشر.");
    setView({ mode: "list" });
    void load();
  }

  async function remove(p: EditablePlace) {
    if (!p.id) return;
    if (!confirm(`تبي تحذف «${p.nameAr}»؟ ما تقدر ترجعه.`)) return;
    const r = await callSafe("place_delete", { id: p.id }, { admin: true });
    if (!r.ok) setError(describeApiFailure(r, "ما قدرنا نحذفه."));
    else {
      setNotice("حذفناه.");
      void load();
    }
  }

  async function togglePublished(p: EditablePlace) {
    if (!p.id) return;
    const r = await callSafe(
      "place_publish",
      { id: p.id, published: !(p.published !== false) },
      { admin: true }
    );
    if (!r.ok) setError(describeApiFailure(r, "ما قدرنا نغيّر النشر."));
    else void load();
  }

  /**
   * The pin, saved on its own — "تحديث الآن" beside the map in PlaceForm.
   *
   * Everything else about a place goes through save() above, which validates
   * every field and writes the whole row. A coordinate fixed on a walkthrough
   * is a different kind of edit: it has nothing to do with whether the Arabic
   * description is filled in, and making it wait on that is why this exists —
   * the full form's own "حفظ" already covers "save lat/lng along with
   * everything else."
   *
   * A partial update, not placeToRow(): sending only {lat, lng} means this can
   * never overwrite a field the caller did not touch, even if EditablePlace
   * carried something stale for it.
   */
  async function updateLocation(
    id: string,
    lat: number,
    lng: number
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const r = await callSafe("place_location", { id, lat, lng }, { admin: true });
    if (!r.ok) return { ok: false, message: describeApiFailure(r, "ما قدرنا نحفظ الموقع.") };
    // Keep the list in step without a full reload — the row the caller is
    // still editing keeps its own unsaved fields exactly as they are.
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, lat, lng } : row)));
    return { ok: true };
  }

  const filtered = q.trim()
    ? rows.filter((r) => (r.nameAr + r.name + r.areaAr).includes(q.trim()))
    : rows;

  return (
    <div className="mx-auto max-w-5xl px-2.5 py-2 sm:px-4 sm:py-3">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <WainLogo className="size-10" />
          <div>
            <h1 className="font-display text-2xl font-bold text-ink-900">لوحة التحكّم</h1>
            <p className="text-xs text-ink-500">
              {stage === "staging" ? "البيئة التجريبية" : "الموقع الحي"} · <span dir="ltr">/api/wain.php</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="rounded-xl border border-line-control bg-white px-4 py-2 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
          >
            الموقع
          </Link>
          <button
            type="button"
            onClick={signOut}
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
          {([["places", "الأماكن"], ["submissions", "طلبات التسجيل"], ["orders", "الطلبات المسبقة"], ["queue", "الطابور"]] as const).map(([id, text]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex min-h-tap items-center gap-2 rounded-full px-4 text-sm font-semibold transition ${
                tab === id
                  ? "bg-ink-900 text-white"
                  : "border border-line-control bg-white text-ink-600 hover:border-sea-300"
              }`}
            >
              {text}
              {id === "orders" && openOrders > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                  tab === id ? "bg-white/20 text-white" : "bg-sun-100 text-sun-900"
                }`}>
                  {toArabicDigits(openOrders)}
                </span>
              )}
              {id === "queue" && waitingInQueue > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                  tab === id ? "bg-white/20 text-white" : "bg-sun-100 text-sun-900"
                }`}>
                  {toArabicDigits(waitingInQueue)}
                </span>
              )}
              {id === "submissions" && pendingCount > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
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
        <section className="rounded-3xl border border-line bg-white p-6 shadow-sm">
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
                <div className="mb-5 rounded-2xl border border-line bg-sand-100/60 p-4">
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
            onUpdateLocation={updateLocation}
            onCancel={() => { setApproving(null); setView({ mode: "list" }); }}
          />
        </section>
      ) : tab === "orders" ? (
        <Orders onCountChange={setOpenOrders} />
      ) : tab === "queue" ? (
        <Queue onCountChange={setWaitingInQueue} />
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
                className="w-full rounded-xl border border-line-control bg-white py-2.5 pe-3 ps-10 text-sm outline-none focus:border-sea-400 focus:ring-4 focus:ring-sea-100"
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

          {rows.length === 0 && !error && (
            <p className="mb-3 rounded-2xl bg-sun-50 p-4 text-sm leading-relaxed text-sun-900">
              الجدول فاضي. الأماكن تنزرع من الكتالوق بأمر{" "}
              <code dir="ltr" className="rounded bg-white/70 px-1.5 py-0.5">php wain.php seed</code>{" "}
              على السيرفر — لين ذاك الوقت الموقع يعرض نسخة البناء.
            </p>
          )}

          <ul className="space-y-2">
            {filtered.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white p-3 shadow-sm"
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
                  <span className="rounded-full bg-sun-100 px-2.5 py-1 text-xs font-semibold text-sun-800">مميّز</span>
                )}
                <button
                  type="button"
                  onClick={() => togglePublished(p)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
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
                  className="rounded-lg border border-line-control px-3 py-1.5 text-xs font-semibold text-ink-700 transition hover:border-sea-300"
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

/** The build was made with the back end switched off (`NEXT_PUBLIC_WAIN_BACKEND=none`). */
function NotConfigured() {
  return (
    <div className="measure mx-auto max-w-2xl px-2.5 py-2 sm:px-4 sm:py-3">
      <h1 className="font-display text-2xl font-bold text-ink-900">لوحة التحكّم مو مفعّلة</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">
        هذا البناء مطفي فيه الخادم: الموقع يشتغل من بياناته المدمجة، بس التحرير
        والطلبات والطابور محتاجة بناء يوصل لـ <code dir="ltr">/api/wain.php</code>.
      </p>
      <ol className="mt-5 space-y-2 text-sm leading-relaxed text-ink-600">
        <li>١. ركّب الخادم: <code className="rounded bg-sand-100 px-1.5 py-0.5" dir="ltr">php wain.php install</code> على السيرفر.</li>
        <li>
          ٢. أعد البناء بدون{" "}
          <code className="rounded bg-sand-100 px-1.5 py-0.5" dir="ltr">NEXT_PUBLIC_WAIN_BACKEND=none</code>.
        </li>
      </ol>
      <p className="mt-5 text-sm text-ink-500">
        التفاصيل الكاملة في <code dir="ltr">docs/admin-setup.md</code>.
      </p>
    </div>
  );
}

/** The server answered, and said it has no admin secret yet. */
function SecretUnset() {
  return (
    <div className="measure mx-auto max-w-2xl px-2.5 py-2 sm:px-4 sm:py-3">
      <h1 className="font-display text-2xl font-bold text-ink-900">الخادم شغّال، بس بدون كلمة سر</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">
        ما فيه كلمة سر للوحة على السيرفر بعد، فأي كلمة تكتبها هني بتنرفض. الحل
        مرة واحدة، من مدير الملفات في hPanel:
      </p>
      <ol className="mt-5 space-y-2 text-sm leading-relaxed text-ink-600">
        <li>
          ١. افتح{" "}
          <code className="rounded bg-sand-100 px-1.5 py-0.5" dir="ltr">domains/wainkw.com/storage/admin.secret</code>
          {" "}(خارج <span dir="ltr">public_html</span>).
        </li>
        <li>٢. الصق فيه كلمة سر طويلة وعشوائية (٣٢ حرف أو أكثر) واحفظ.</li>
        <li>٣. حدّث هذي الصفحة وادخل بها.</li>
      </ol>
      <p className="mt-5 text-sm text-ink-500">
        لا تكتب الكلمة في أي محادثة أو ملف في المشروع. التفاصيل في{" "}
        <code dir="ltr">docs/admin-setup.md</code>.
      </p>
    </div>
  );
}

function Unreachable({ message }: { message: string }) {
  return (
    <div className="measure mx-auto max-w-2xl px-2.5 py-2 sm:px-4 sm:py-3">
      <h1 className="font-display text-2xl font-bold text-ink-900">ما وصلنا للخادم</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">{message}</p>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">
        لو هذي أول مرة: الملف <code dir="ltr">/api/wain.php</code> لازم يكون مركّب على
        السيرفر (<code dir="ltr">php wain.php install</code>). التفاصيل في{" "}
        <code dir="ltr">docs/admin-setup.md</code>.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-6 rounded-xl bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white"
      >
        جرّب مرة ثانية
      </button>
    </div>
  );
}

function SignIn({ error, onSubmit }: { error: string; onSubmit: (secret: string) => Promise<void> }) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!secret.trim()) return;
    setBusy(true);
    await onSubmit(secret);
    setBusy(false);
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-2.5">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <WainLogo className="size-14" />
        <h1 className="font-display text-2xl font-bold text-ink-900">لوحة التحكّم</h1>
      </div>
      <form onSubmit={submit} className="space-y-4 rounded-3xl border border-line bg-white p-6 shadow-sm">
        {error && (
          <p role="alert" className="rounded-xl border border-coral-200 bg-coral-50 p-3 text-sm text-coral-800">{error}</p>
        )}
        <div>
          <label className="block text-sm font-semibold text-ink-800" htmlFor="a-secret">كلمة سر اللوحة</label>
          <input
            id="a-secret"
            type="password"
            required
            autoComplete="current-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-line-control px-3 py-2 text-sm outline-none focus:border-sea-400 focus:ring-4 focus:ring-sea-100"
          />
          <p className="mt-1.5 text-xs text-ink-500">
            هي نفس اللي في <code dir="ltr">storage/admin.secret</code> على السيرفر. تنحفظ في هذا التاب بس.
          </p>
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
