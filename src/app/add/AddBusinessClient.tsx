"use client";

import { useState } from "react";
import Link from "next/link";
import CategoryIcon from "@/components/CategoryIcon";
import { IconCheck, IconLocate, IconPinSolid, IconSparkle } from "@/components/icons";
import CoordinatePicker from "@/components/CoordinatePicker";
import MediaUploader from "@/components/MediaUploader";
import { categories, toArabicDigits, type CategoryId } from "@/lib/places";
import { newDraftId, uploadPending, type PickedFile } from "@/lib/media";
import { inKuwait, submitBusiness, type SubmissionInput } from "@/lib/submissions";
import { fieldClass, hintClass, labelClass } from "@/lib/form-classes";
import { supabaseEnabled } from "@/lib/supabase";
import { haptic } from "@/lib/haptics";

const field = fieldClass;
const label = labelClass;
const hint = hintClass;

const EMPTY: SubmissionInput = {
  name: "", nameAr: "", category: "restaurants", areaAr: "", addressAr: "",
  lat: null, lng: null, priceLevel: 2, taglineAr: "", descriptionAr: "",
  bioAr: "", productsAr: [], logoPath: null, imagePaths: [],
  phone: "", instagram: "", website: "",
  contactName: "", contactEmail: "", contactPhone: "",
};

type Errors = Partial<Record<keyof SubmissionInput, string>>;

function validate(v: SubmissionInput): Errors {
  const e: Errors = {};
  if (v.nameAr.trim().length < 2) e.nameAr = "اكتب اسم المكان بالعربي.";
  if (v.name.trim().length < 2) e.name = "اكتب الاسم بالإنجليزي.";
  if (v.areaAr.trim().length < 2) e.areaAr = "اكتب المنطقة.";
  if (v.taglineAr.trim().length < 4) e.taglineAr = "اكتب سطر يوصف المكان.";
  if (v.contactName.trim().length < 2) e.contactName = "اكتب اسمك.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.contactEmail.trim()))
    e.contactEmail = "اكتب إيميل صحيح عشان نرد عليك.";
  // Coordinates are optional, but if given they must actually be in Kuwait —
  // the database enforces the same box, and a rejection there is opaque.
  if (v.lat !== null || v.lng !== null) {
    if (v.lat === null || v.lng === null) e.lat = "نبي خط الطول والعرض مع بعض.";
    else if (!inKuwait(v.lat, v.lng)) e.lat = "الإحداثيات هذي مو داخل الكويت.";
  }
  return e;
}

export default function AddBusinessClient() {
  const [v, setV] = useState<SubmissionInput>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [done, setDone] = useState(false);
  const [locating, setLocating] = useState(false);
  const [logo, setLogo] = useState<PickedFile | null>(null);
  const [photos, setPhotos] = useState<PickedFile[]>([]);
  const [uploading, setUploading] = useState("");

  const set = <K extends keyof SubmissionInput>(k: K, val: SubmissionInput[K]) => {
    setV((p) => ({ ...p, [k]: val }));
    setErrors((p) => ({ ...p, [k]: undefined }));
  };

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setV((p) => ({
          ...p,
          lat: +pos.coords.latitude.toFixed(5),
          lng: +pos.coords.longitude.toFixed(5),
        }));
        setErrors((p) => ({ ...p, lat: undefined }));
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFailure("");
    const found = validate(v);
    setErrors(found);
    if (Object.keys(found).length) {
      haptic("error");
      document.querySelector<HTMLElement>("[data-invalid='true']")?.focus();
      return;
    }
    setBusy(true);

    // Files go up only now, after the rest of the form is known good. Uploading
    // as they are picked would push megabytes into storage for submissions that
    // never get created.
    let logoPath: string | null = null;
    const imagePaths: string[] = [];
    if (logo || photos.length) {
      const draftId = newDraftId();
      const total = (logo ? 1 : 0) + photos.length;
      let done_ = 0;
      const step = () => setUploading(`نرفع الصور… ${++done_}/${total}`);

      if (logo) {
        const r = await uploadPending(draftId, "logo", logo.file);
        if (!r.ok) { setBusy(false); setUploading(""); setFailure(r.message); return; }
        logoPath = r.path;
        step();
      }
      for (let i = 0; i < photos.length; i++) {
        const r = await uploadPending(draftId, "photo", photos[i].file, i);
        if (!r.ok) { setBusy(false); setUploading(""); setFailure(r.message); return; }
        imagePaths.push(r.path);
        step();
      }
      setUploading("");
    }

    const res = await submitBusiness({ ...v, logoPath, imagePaths });
    setBusy(false);
    if (res.ok) { haptic("success"); setDone(true); }
    else { haptic("error"); setFailure(res.message); }
  }

  if (done) {
    return (
      <div className="rounded-3xl border border-line bg-white p-8 text-center shadow-sm">
        <span
          aria-hidden="true"
          className="mx-auto grid size-14 place-items-center rounded-2xl bg-palm-500/12 text-palm-600"
        >
          <IconCheck className="size-8" />
        </span>
        <h2 className="mt-4 font-display text-2xl font-bold text-ink-900">وصلنا طلبك</h2>
        <p className="mx-auto mt-2 max-w-md text-ink-500">
          بنراجع «{v.nameAr.trim()}» ونضيفه على خريطة وين. إذا احتجنا شي بنراسلك على{" "}
          <span dir="ltr" className="font-semibold text-ink-700">{v.contactEmail.trim()}</span>.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/explore"
            className="inline-flex min-h-11 items-center rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white transition hover:bg-ink-800"
          >
            شوف الأماكن
          </Link>
          <button
            type="button"
            onClick={() => { setV(EMPTY); setDone(false); }}
            className="inline-flex min-h-11 items-center rounded-xl border border-line-control bg-white px-5 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
          >
            سجّل مكان ثاني
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6 standalone:space-y-4">
      {!supabaseEnabled && (
        <p className="rounded-2xl border border-sun-300 bg-sun-50 px-4 py-3 text-sm font-semibold text-sun-900">
          التسجيل مو موصول بقاعدة البيانات بعد، فالزر ما بيرسل شي. لو تشوف هذي
          الرسالة على الموقع، خبّرنا.
        </p>
      )}

      {/* ---- the business -------------------------------------------- */}
      <fieldset className="rounded-3xl border border-line bg-white p-5 shadow-sm standalone:rounded-2xl standalone:p-4">
        <legend className="px-2 font-display text-lg font-semibold text-ink-900">
          معلومات المكان
        </legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="f-namear" className={label}>اسم المكان بالعربي *</label>
            <input
              id="f-namear" className={field} value={v.nameAr}
              data-invalid={!!errors.nameAr}
              aria-invalid={!!errors.nameAr}
              aria-describedby={errors.nameAr ? "e-namear" : undefined}
              onChange={(e) => set("nameAr", e.target.value)}
              placeholder="مقهى الديرة"
            />
            {errors.nameAr && <p id="e-namear" className="mt-1 text-xs font-semibold text-coral-700">{errors.nameAr}</p>}
          </div>

          <div>
            <label htmlFor="f-name" className={label}>الاسم بالإنجليزي *</label>
            <input
              id="f-name" dir="ltr" className={field} value={v.name}
              data-invalid={!!errors.name}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "e-name" : undefined}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Deera Cafe"
            />
            {errors.name && <p id="e-name" className="mt-1 text-xs font-semibold text-coral-700">{errors.name}</p>}
          </div>
        </div>

        <div className="mt-4">
          <span className={label}>التصنيف *</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="التصنيف">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={v.category === c.id}
                onClick={() => { haptic("tap"); set("category", c.id as CategoryId); }}
                className={`flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition ${
                  v.category === c.id
                    ? "bg-ink-900 text-white"
                    : "border border-line bg-white text-ink-600 hover:border-sea-300"
                }`}
              >
                <CategoryIcon name={c.icon} className="size-4" />
                {c.ar}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="f-area" className={label}>المنطقة *</label>
            <input
              id="f-area" className={field} value={v.areaAr}
              data-invalid={!!errors.areaAr}
              aria-invalid={!!errors.areaAr}
              onChange={(e) => set("areaAr", e.target.value)}
              placeholder="السالمية"
            />
            {errors.areaAr && <p className="mt-1 text-xs font-semibold text-coral-700">{errors.areaAr}</p>}
          </div>

          <div>
            <span className={label}>مستوى الأسعار</span>
            <div className="flex gap-2" role="radiogroup" aria-label="مستوى الأسعار">
              {([1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={v.priceLevel === n}
                  onClick={() => { haptic("tap"); set("priceLevel", n); }}
                  aria-label={`مستوى السعر ${toArabicDigits(n)} من ٣`}
                  className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition ${
                    v.priceLevel === n
                      ? "bg-ink-900 text-white"
                      : "border border-line bg-white text-ink-600 hover:border-sea-300"
                  }`}
                >
                  {/* Filled dots, the same reading the place cards use.
                      Repeating the "د.ك" glyph n times spelled د.ك.د.ك.د.ك. */}
                  <span className="flex gap-0.5" aria-hidden="true">
                    {[1, 2, 3].map((i) => (
                      <span
                        key={i}
                        className={`size-1.5 rounded-full ${
                          i <= n
                            ? v.priceLevel === n ? "bg-white" : "bg-sand-600"
                            : v.priceLevel === n ? "bg-white/30" : "bg-sand-300"
                        }`}
                      />
                    ))}
                  </span>
                  د.ك
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <label htmlFor="f-tagline" className={label}>سطر يوصف المكان *</label>
          <input
            id="f-tagline" className={field} value={v.taglineAr} maxLength={160}
            data-invalid={!!errors.taglineAr}
            aria-invalid={!!errors.taglineAr}
            onChange={(e) => set("taglineAr", e.target.value)}
            placeholder="قهوة مختصة وجلسة هادية على البحر."
          />
          {errors.taglineAr
            ? <p className="mt-1 text-xs font-semibold text-coral-700">{errors.taglineAr}</p>
            : <p className={hint}>هذا اللي يطلع تحت اسم المكان في القائمة.</p>}
        </div>

        <div className="mt-4">
          <label htmlFor="f-desc" className={label}>وصف أطول</label>
          <textarea
            id="f-desc" rows={4} maxLength={1200} className={field} value={v.descriptionAr}
            onChange={(e) => set("descriptionAr", e.target.value)}
            placeholder="شنو يميّز مكانك؟ وش أحلى وقت للزيارة؟"
          />
          <p className={hint}>اختياري — بس يساعدنا نكتب صفحة أحلى لمكانك.</p>
        </div>

        <div className="mt-4">
          <label htmlFor="f-bio" className={label}>نبذة بكلامكم</label>
          <textarea
            id="f-bio" rows={3} maxLength={800} className={field} value={v.bioAr}
            onChange={(e) => set("bioAr", e.target.value)}
            placeholder="من متى فتحتوا؟ شنو قصّة المكان؟"
          />
          <p className={hint}>
            هذي تنكتب باسمكم في الصفحة — الوصف اللي فوق نكتبه إحنا.
          </p>
        </div>

        <div>
          <label htmlFor="f-products" className={label}>المنتجات والخدمات</label>
          <textarea
            id="f-products" rows={4} className={field}
            value={v.productsAr.join("\n")}
            onChange={(e) => set("productsAr", e.target.value.split("\n").slice(0, 20))}
            placeholder={"قهوة مختصة\nحلويات فرنسية\nتوصيل داخل الكويت"}
          />
          <p className={hint}>
            سطر لكل منتج أو خدمة — تطلع على صفحتكم بعد الاعتماد. لين ٢٠ سطر.
          </p>
        </div>
      </fieldset>

      {/* ---- brand and photos ------------------------------------------ */}
      <fieldset className="rounded-3xl border border-line bg-white p-5 shadow-sm standalone:rounded-2xl standalone:p-4">
        <legend className="px-2 font-display text-lg font-semibold text-ink-900">
          الشعار والصور
        </legend>
        <MediaUploader
          logo={logo}
          photos={photos}
          onLogo={setLogo}
          onPhotos={setPhotos}
          disabled={busy}
        />
      </fieldset>

      {/* ---- where ----------------------------------------------------- */}
      <fieldset className="rounded-3xl border border-line bg-white p-5 shadow-sm standalone:rounded-2xl standalone:p-4">
        <legend className="px-2 font-display text-lg font-semibold text-ink-900">
          وين مكانه بالضبط؟
        </legend>

        <div>
          <label htmlFor="f-address" className={label}>العنوان</label>
          <input
            id="f-address" className={field} value={v.addressAr} maxLength={300}
            onChange={(e) => set("addressAr", e.target.value)}
            placeholder="شارع سالم المبارك، مجمع…"
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label htmlFor="f-lat" className={label}>خط العرض (lat)</label>
            <input
              id="f-lat" dir="ltr" inputMode="decimal" className={field}
              value={v.lat ?? ""}
              data-invalid={!!errors.lat}
              aria-invalid={!!errors.lat}
              onChange={(e) => set("lat", e.target.value === "" ? null : Number(e.target.value))}
              placeholder="29.3759"
            />
          </div>
          <div>
            <label htmlFor="f-lng" className={label}>خط الطول (lng)</label>
            <input
              id="f-lng" dir="ltr" inputMode="decimal" className={field}
              value={v.lng ?? ""}
              onChange={(e) => set("lng", e.target.value === "" ? null : Number(e.target.value))}
              placeholder="47.9774"
            />
          </div>
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line-control bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-sea-300 disabled:opacity-60"
          >
            <IconLocate className="size-4" />
            {locating ? "نحدّد موقعك…" : "خذها من موقعي"}
          </button>
        </div>
        {errors.lat
          ? <p className="mt-1 text-xs font-semibold text-coral-700">{errors.lat}</p>
          : <p className={hint}>
              اختياري. أسهل طريقة: اضغط على الخريطة تحت على مكانك بالضبط.
              بدونها بنحددها بأنفسنا من العنوان.
            </p>}

        <div className="mt-4">
          <CoordinatePicker
            lat={v.lat}
            lng={v.lng}
            onPick={(at) => {
              setV((prev) => ({ ...prev, lat: at.lat, lng: at.lng }));
              setErrors((prev) => ({ ...prev, lat: undefined }));
            }}
            label="اضغط على مكانك بالضبط"
          />
        </div>
      </fieldset>

      {/* ---- contact ---------------------------------------------------- */}
      <fieldset className="rounded-3xl border border-line bg-white p-5 shadow-sm standalone:rounded-2xl standalone:p-4">
        <legend className="px-2 font-display text-lg font-semibold text-ink-900">
          التواصل
        </legend>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="f-phone" className={label}>تلفون المكان</label>
            <input id="f-phone" dir="ltr" className={field} value={v.phone} maxLength={40}
              onChange={(e) => set("phone", e.target.value)} placeholder="+965 …" />
          </div>
          <div>
            <label htmlFor="f-insta" className={label}>إنستقرام</label>
            <input id="f-insta" dir="ltr" className={field} value={v.instagram} maxLength={80}
              onChange={(e) => set("instagram", e.target.value)} placeholder="@deeracafe" />
          </div>
          <div>
            <label htmlFor="f-web" className={label}>الموقع</label>
            <input id="f-web" dir="ltr" className={field} value={v.website} maxLength={200}
              onChange={(e) => set("website", e.target.value)} placeholder="https://…" />
          </div>
        </div>

        <p className="mt-5 rounded-2xl bg-sand-100 px-4 py-3 text-xs text-ink-600">
          بيانات التواصل تحت هذي لنا بس — عشان نرد عليك ونتأكد إنك صاحب المكان.
          ما تظهر على الموقع أبداً.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="f-cname" className={label}>اسمك *</label>
            <input
              id="f-cname" className={field} value={v.contactName} maxLength={120}
              data-invalid={!!errors.contactName}
              aria-invalid={!!errors.contactName}
              onChange={(e) => set("contactName", e.target.value)}
            />
            {errors.contactName && <p className="mt-1 text-xs font-semibold text-coral-700">{errors.contactName}</p>}
          </div>
          <div>
            <label htmlFor="f-cemail" className={label}>إيميلك *</label>
            <input
              id="f-cemail" type="email" dir="ltr" className={field} value={v.contactEmail}
              data-invalid={!!errors.contactEmail}
              aria-invalid={!!errors.contactEmail}
              onChange={(e) => set("contactEmail", e.target.value)}
            />
            {errors.contactEmail && <p className="mt-1 text-xs font-semibold text-coral-700">{errors.contactEmail}</p>}
          </div>
          <div>
            <label htmlFor="f-cphone" className={label}>تلفونك</label>
            <input id="f-cphone" dir="ltr" className={field} value={v.contactPhone} maxLength={40}
              onChange={(e) => set("contactPhone", e.target.value)} />
          </div>
        </div>
      </fieldset>

      {failure && (
        <p role="alert" className="rounded-2xl border border-coral-200 bg-coral-50 px-4 py-3 text-sm font-semibold text-coral-800">
          {failure}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink-900 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-800 disabled:opacity-60"
        >
          <IconSparkle className="size-4" />
          {uploading || (busy ? "نرسل الطلب…" : "سجّل مكاني — مجاناً")}
        </button>
        <p className="flex items-center gap-1.5 text-xs text-ink-500">
          <IconPinSolid className="size-3.5 text-coral-600/70" />
          نراجع كل طلب قبل ما ينشر على الخريطة.
        </p>
      </div>
    </form>
  );
}
